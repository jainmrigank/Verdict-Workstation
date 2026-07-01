#!/usr/bin/env python3
"""Build a paraphrased Varsity rule layer without storing copyrighted chapter text.

The script fetches configured Varsity module pages, discovers every chapter link,
reads each chapter body, classifies the chapter into a curated rule catalog, and
writes only derived metadata/rules. Raw chapter prose is intentionally discarded.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
TS_OUTPUT = ROOT / "react-day1" / "src" / "varsityKnowledge.ts"
INDEX_OUTPUT = ROOT / "data" / "reference" / "varsity_chapter_rule_index.json"

MODULES = [
    {
        "id": "innerworth",
        "label": "Innerworth",
        "url": "https://zerodha.com/varsity/module/innerworth/",
        "description": "Trading psychology, process discipline, risk acceptance, stress control, and emotional self-management.",
    },
    {
        "id": "sector-analysis",
        "label": "Sector Analysis",
        "url": "https://zerodha.com/varsity/module/sector-analysis/",
        "description": "Sector-specific operating metrics for analysing industries instead of relying only on generic ratios.",
    },
    {
        "id": "sse",
        "label": "Social Stock Exchanges",
        "url": "https://zerodha.com/varsity/module/social-stock-exchanges-sses/",
        "description": "SSE, NPO/SE eligibility, ZCZP, social impact funds, development impact bonds, and donation routes.",
    },
    {
        "id": "nps",
        "label": "National Pension System",
        "url": "https://zerodha.com/varsity/module/national-pension-scheme/",
        "description": "Retirement-goal capital, NPS account structure, asset allocation, withdrawals, tax rules, costs, and SIP discipline.",
    },
]

SOURCE_LINKS = {
    "innerworth": "https://zerodha.com/varsity/module/innerworth/",
    "sector": "https://zerodha.com/varsity/module/sector-analysis/",
    "sse": "https://zerodha.com/varsity/module/social-stock-exchanges-sses/",
    "nps": "https://zerodha.com/varsity/module/national-pension-scheme/",
}

SECTOR_OPERATING_RULES = [
    {
        "label": "Automobiles",
        "match": ["auto", "automobile", "vehicle", "passenger car", "utility vehicle", "two wheeler", "car manufacturer"],
        "metrics": ["volume growth", "market share", "realisation", "raw-material cost", "dealer inventory", "working capital"],
        "source": SOURCE_LINKS["sector"],
        "text": "Automobile analysis needs more than P/E. Demand cycles, model mix, raw-material pressure, inventory, and market share can change the quality of earnings quickly.",
    },
    {
        "label": "Banking and lenders",
        "match": ["bank", "finance", "nbfc", "lender", "housing finance", "credit"],
        "metrics": ["loan growth", "asset quality", "NPA trend", "capital adequacy", "net interest margin", "provisioning"],
        "source": SOURCE_LINKS["sector"],
        "text": "Lenders should be judged with asset quality and capital strength first. Normal industrial ratios can mislead when credit losses or leverage are the real risk.",
    },
    {
        "label": "Information Technology",
        "match": ["information technology", "software", "it services", "technology", "digital services"],
        "metrics": ["revenue growth", "client concentration", "margin trend", "deal wins", "currency exposure", "employee costs"],
        "source": SOURCE_LINKS["sector"],
        "text": "IT businesses need growth, margin, client, currency, and execution checks. A good balance sheet is not enough if growth visibility or margins are weakening.",
    },
    {
        "label": "Cement",
        "match": ["cement", "building material"],
        "metrics": ["capacity utilisation", "realisation per tonne", "power/fuel cost", "freight cost", "regional demand", "debt/capex"],
        "source": SOURCE_LINKS["sector"],
        "text": "Cement is cyclical and cost-sensitive. Capacity, utilisation, regional pricing, energy costs, and leverage deserve as much attention as headline profit.",
    },
    {
        "label": "Insurance",
        "match": ["insurance", "life insurance", "general insurance"],
        "metrics": ["premium growth", "persistency", "claims ratio", "combined ratio", "solvency", "distribution mix"],
        "source": SOURCE_LINKS["sector"],
        "text": "Insurance analysis needs operating quality metrics such as persistency, claims, solvency, and distribution mix because reported profit can hide underwriting quality.",
    },
    {
        "label": "Steel and metals",
        "match": ["steel", "metal", "iron", "ferrous", "mining"],
        "metrics": ["spread", "commodity cycle", "capacity utilisation", "raw-material linkage", "debt", "global price trend"],
        "source": SOURCE_LINKS["sector"],
        "text": "Steel and metals are cycle-heavy. The verdict should be cautious when commodity prices, spreads, debt, or global demand are not understood.",
    },
    {
        "label": "Hotels and hospitality",
        "match": ["hotel", "hospitality", "resort", "travel accommodation"],
        "metrics": ["occupancy", "ARR", "RevPAR", "room additions", "seasonality", "debt service"],
        "source": SOURCE_LINKS["sector"],
        "text": "Hotel quality depends on occupancy, pricing power, room economics, seasonality, and debt service rather than only revenue growth.",
    },
    {
        "label": "Retail",
        "match": ["retail", "store", "supermarket", "apparel", "consumer retail"],
        "metrics": ["same-store sales", "gross margin", "inventory turns", "store economics", "working capital", "lease costs"],
        "source": SOURCE_LINKS["sector"],
        "text": "Retail needs store-level discipline: sales per store, margins, inventory turns, working capital, and expansion quality decide whether growth is healthy.",
    },
    {
        "label": "Real Estate",
        "match": ["real estate", "developer", "property", "construction", "housing"],
        "metrics": ["pre-sales", "collections", "project pipeline", "net debt", "inventory", "cash-flow timing"],
        "source": SOURCE_LINKS["sector"],
        "text": "Real-estate analysis must separate bookings from cash collections. Project inventory, debt, execution, and cash-flow timing drive risk.",
    },
]

RULE_CATALOG = [
    {
        "id": "innerworth_process_before_outcome",
        "module": "innerworth",
        "title": "Process before outcome",
        "terms": ["process", "plan", "action plan", "detailed plan", "focus", "goal", "outcome", "prize", "specific", "follow"],
        "appliesTo": ["risk", "entry", "discipline"],
        "tone": "positive",
        "scoreImpact": 0.45,
        "principle": "A trade idea is stronger when the next action is pre-decided before emotion or price movement forces a reaction.",
        "checklist": ["Entry condition", "Invalidation level", "Target or review zone", "Maximum loss", "Position size"],
        "action": "Before buying, convert the idea into if-this-then-that rules and do not increase size until the plan is explicit.",
        "caution": "A high score without a defined action plan can still lead to impulsive execution.",
    },
    {
        "id": "innerworth_accept_risk_loss",
        "module": "innerworth",
        "title": "Accept risk and treat loss as feedback",
        "terms": ["risk", "loss", "fear", "failure", "uncertainty", "cut", "protect", "consequence", "wrong", "stop"],
        "appliesTo": ["risk", "exit"],
        "tone": "neutral",
        "scoreImpact": 0.5,
        "principle": "Losses are part of the process; the useful question is whether the defined loss is affordable and informative.",
        "checklist": ["Risk per share", "Maximum rupee loss", "Stop or invalidation", "Post-trade review"],
        "action": "Size the position so being wrong is survivable and reviewable instead of emotionally damaging.",
        "caution": "Avoid averaging down or revenge trading to erase the feeling of a loss.",
    },
    {
        "id": "innerworth_impulse_control",
        "module": "innerworth",
        "title": "Impulse and temptation control",
        "terms": ["impulse", "temptation", "greed", "revenge", "hot tip", "urge", "addicted", "excitement", "thrill", "overconfidence"],
        "appliesTo": ["entry", "behaviour"],
        "tone": "negative",
        "scoreImpact": -0.35,
        "principle": "The urge to act quickly is not evidence. A clean setup should survive a slower, more deliberate check.",
        "checklist": ["Reason for urgency", "Volume confirmation", "Risk budget", "News/event trigger", "Cooling-off check"],
        "action": "If the buy reason is excitement, FOMO, a hot tip, or revenge, downgrade the verdict until objective evidence confirms.",
        "caution": "Do not chase price just to avoid the discomfort of missing a move.",
    },
    {
        "id": "innerworth_objectivity_facts",
        "module": "innerworth",
        "title": "Facts over bias",
        "terms": ["facts", "objective", "denial", "hindsight", "belief", "consensus", "crowd", "herd", "realistic", "evidence"],
        "appliesTo": ["analysis", "confidence"],
        "tone": "positive",
        "scoreImpact": 0.35,
        "principle": "A decision improves when it separates observable evidence from stories, hindsight, and crowd comfort.",
        "checklist": ["Price trend", "Financial data", "Recent filings", "Thesis contradiction", "Alternative view"],
        "action": "Force the app to show both positives and cautions before accepting the verdict.",
        "caution": "Do not upgrade confidence only because the idea feels obvious after a price move.",
    },
    {
        "id": "innerworth_flexible_stand_aside",
        "module": "innerworth",
        "title": "Flexibility and standing aside",
        "terms": ["flexible", "stand aside", "fold", "walk away", "adapt", "possibilities", "change", "course", "not trade", "wait"],
        "appliesTo": ["entry", "exit", "watchlist"],
        "tone": "neutral",
        "scoreImpact": 0.25,
        "principle": "A good process allows waiting. Not buying is an active decision when evidence or reward/risk is incomplete.",
        "checklist": ["Wait condition", "Trigger to re-enter", "Reason to reject", "Review date"],
        "action": "Use watchlist verdicts as a valid output instead of forcing every analysed ticker into a buy or sell.",
        "caution": "Do not convert patience into paralysis; define what evidence would change the decision.",
    },
    {
        "id": "innerworth_stress_resilience",
        "module": "innerworth",
        "title": "Stress and resilience filter",
        "terms": ["stress", "calm", "relax", "frustration", "mood", "break", "slump", "resilient", "pressure", "energy"],
        "appliesTo": ["behaviour", "risk"],
        "tone": "neutral",
        "scoreImpact": 0.2,
        "principle": "Decision quality falls when stress is high. Smaller size and clearer rules reduce the chance of emotional decisions.",
        "checklist": ["Recent loss streak", "Sleep/stress state", "Position size", "Time pressure", "Rule clarity"],
        "action": "When uncertain or stressed, use starter size, wait for confirmation, or postpone the trade.",
        "caution": "Do not use the app to justify action when your real problem is pressure to recover quickly.",
    },
    {
        "id": "innerworth_capital_size_matters",
        "module": "innerworth",
        "title": "Capital size matters",
        "terms": ["capital", "size", "position", "stake", "money", "risk tolerance", "small", "large", "safety", "security"],
        "appliesTo": ["sizing", "risk"],
        "tone": "positive",
        "scoreImpact": 0.4,
        "principle": "Position size should follow risk capacity, not confidence alone.",
        "checklist": ["Deployable capital", "Risk budget", "Risk per share", "Liquidity", "Concentration"],
        "action": "Keep suggested quantity tied to max loss and liquidity; reduce size if the setup is thinly traded or volatile.",
        "caution": "Do not use the full capital amount simply because it is available.",
    },
    {
        "id": "sector_auto_operating_lens",
        "module": "sector-analysis",
        "title": "Automobile operating lens",
        "terms": ["automobile", "automotive", "vehicle", "volume", "production", "sales volume", "realization", "product mix", "capacity", "dealer"],
        "appliesTo": ["sector", "fundamental"],
        "tone": "positive",
        "scoreImpact": 0.45,
        "principle": "Auto companies need volume, realization, product mix, capacity, inventory, and leverage checks before the ratio score is trusted.",
        "checklist": ["Sales volume", "Production volume", "Realisation", "Product mix", "Capacity/capex", "Debt"],
        "action": "For auto names, add volume and mix commentary before increasing conviction.",
        "caution": "Revenue growth can be misleading if it comes with inventory build-up or margin pressure.",
    },
    {
        "id": "sector_banking_asset_quality",
        "module": "sector-analysis",
        "title": "Banking asset-quality lens",
        "terms": ["banking", "bank", "loan", "deposit", "npa", "asset quality", "capital adequacy", "nim", "provision", "credit"],
        "appliesTo": ["sector", "fundamental"],
        "tone": "positive",
        "scoreImpact": 0.45,
        "principle": "Banks and lenders must be judged through credit quality, capital strength, margins, and provisioning, not ordinary industrial debt ratios.",
        "checklist": ["Loan growth", "Deposit mix", "NPA trend", "Provision coverage", "NIM", "Capital adequacy"],
        "action": "For lenders, downgrade confidence if asset-quality and capital data are missing.",
        "caution": "Cheap valuation can be a trap when credit losses are rising.",
    },
    {
        "id": "sector_it_margin_client_lens",
        "module": "sector-analysis",
        "title": "IT services margin and client lens",
        "terms": ["information technology", "software", "it services", "client", "margin", "deal", "currency", "employee", "utilization"],
        "appliesTo": ["sector", "fundamental"],
        "tone": "positive",
        "scoreImpact": 0.35,
        "principle": "IT analysis should include client concentration, deal wins, margin trend, currency exposure, and employee costs.",
        "checklist": ["Revenue growth", "Margin trend", "Client concentration", "Deal wins", "Currency effect", "Attrition/costs"],
        "action": "For IT names, prefer confirmation from margins and order/deal commentary, not only P/E.",
        "caution": "A cash-rich balance sheet does not offset weak growth visibility.",
    },
    {
        "id": "sector_cyclical_cost_capacity",
        "module": "sector-analysis",
        "title": "Cyclical cost and capacity lens",
        "terms": ["cement", "steel", "commodity", "capacity", "utilisation", "utilization", "raw material", "fuel", "freight", "cycle", "spread"],
        "appliesTo": ["sector", "fundamental"],
        "tone": "neutral",
        "scoreImpact": 0.35,
        "principle": "Cyclical sectors need cost, spread, capacity, and debt checks because earnings can turn quickly across the cycle.",
        "checklist": ["Capacity utilisation", "Realisation/spread", "Input costs", "Freight/energy", "Debt", "Cycle position"],
        "action": "For cyclical names, reduce confidence unless margins and balance sheet are checked across the cycle.",
        "caution": "Peak earnings can make P/E look deceptively cheap.",
    },
    {
        "id": "sector_consumer_store_lens",
        "module": "sector-analysis",
        "title": "Consumer, hotel, and retail unit economics",
        "terms": ["hotel", "retail", "store", "occupancy", "arr", "revpar", "same-store", "inventory", "lease", "per square foot"],
        "appliesTo": ["sector", "fundamental"],
        "tone": "positive",
        "scoreImpact": 0.3,
        "principle": "Hotel and retail quality comes from unit economics: occupancy/pricing for hotels and store productivity/inventory for retail.",
        "checklist": ["Occupancy or same-store sales", "Pricing power", "Inventory turns", "Lease or debt burden", "Expansion quality"],
        "action": "Use unit-economics metrics before accepting growth as high quality.",
        "caution": "Fast expansion can hide weak store economics or debt pressure.",
    },
    {
        "id": "sector_real_estate_cash_flow",
        "module": "sector-analysis",
        "title": "Real-estate cash-flow lens",
        "terms": ["real estate", "developer", "project", "booking", "pre-sales", "collections", "inventory", "land", "rera", "debt"],
        "appliesTo": ["sector", "fundamental"],
        "tone": "neutral",
        "scoreImpact": 0.35,
        "principle": "Real-estate analysis should separate bookings from cash collections and track debt, inventory, and execution.",
        "checklist": ["Pre-sales", "Collections", "Project pipeline", "Unsold inventory", "Net debt", "Execution risk"],
        "action": "For developers, require cash collection and debt evidence before trusting accounting profits.",
        "caution": "Reported sales can be less useful than cash-flow timing and project delivery.",
    },
    {
        "id": "nps_goal_money_separation",
        "module": "nps",
        "title": "Separate retirement-goal money from trade capital",
        "terms": ["retirement", "pension", "long term", "corpus", "future", "goal", "tax", "tier i", "withdrawal", "annuity"],
        "appliesTo": ["personal-finance", "risk"],
        "tone": "neutral",
        "scoreImpact": 0.3,
        "principle": "Retirement and tax-planning capital should be protected from short-term trading decisions.",
        "checklist": ["Emergency fund separate", "Retirement contribution separate", "Trade capital marked deployable", "Time horizon clear"],
        "action": "Treat the capital input as deployable market capital only; do not include retirement or emergency money.",
        "caution": "A good stock idea is still unsuitable if it risks money assigned to a non-negotiable life goal.",
    },
    {
        "id": "nps_asset_allocation_horizon",
        "module": "nps",
        "title": "Asset allocation and horizon discipline",
        "terms": ["asset allocation", "equity", "corporate bond", "government bond", "active choice", "auto choice", "age", "horizon", "sip"],
        "appliesTo": ["personal-finance", "portfolio"],
        "tone": "positive",
        "scoreImpact": 0.25,
        "principle": "Long-term wealth plans need allocation discipline, periodic investing, and age/horizon awareness.",
        "checklist": ["Equity allocation", "Debt allocation", "Investment horizon", "Contribution schedule", "Rebalancing"],
        "action": "If the user is investing for long goals, frame the stock as part of allocation rather than a standalone bet.",
        "caution": "Aggressive concentration is weaker when the money belongs to a retirement allocation.",
    },
    {
        "id": "nps_liquidity_tax_lockin",
        "module": "nps",
        "title": "Liquidity, lock-in, and tax clarity",
        "terms": ["tax", "80ccd", "tier ii", "exit", "withdrawal", "partial withdrawal", "annuity", "lock", "fee", "corporate nps"],
        "appliesTo": ["personal-finance", "liquidity"],
        "tone": "neutral",
        "scoreImpact": 0.2,
        "principle": "Tax benefits and lock-in rules should not be confused with tradable liquidity.",
        "checklist": ["Tax regime", "Lock-in", "Withdrawal rule", "Liquidity need", "Advisor check"],
        "action": "When capital may be goal-linked, caution the user to verify liquidity and tax consequences first.",
        "caution": "Do not sell or buy equities to meet a tax idea without checking cash-flow needs.",
    },
    {
        "id": "sse_instrument_type_filter",
        "module": "sse",
        "title": "SSE instrument type filter",
        "terms": ["social stock exchange", "npo", "social enterprise", "eligible", "social impact", "fundraising", "not for profit"],
        "appliesTo": ["instrument", "risk"],
        "tone": "negative",
        "scoreImpact": -0.5,
        "principle": "SSE-related securities may have social-impact objectives and different return/liquidity expectations from ordinary equities.",
        "checklist": ["Instrument type", "Issuer eligibility", "Return objective", "Liquidity", "Disclosure"],
        "action": "Before applying normal buy/sell/hold logic, verify whether the instrument is an ordinary listed equity.",
        "caution": "Do not rely on chart signals alone for a social-impact or non-standard fundraising instrument.",
    },
    {
        "id": "sse_zczp_no_normal_return",
        "module": "sse",
        "title": "ZCZP return caution",
        "terms": ["zczp", "zero coupon", "zero principal", "bond", "donation", "development impact", "social impact fund"],
        "appliesTo": ["instrument", "risk"],
        "tone": "negative",
        "scoreImpact": -0.6,
        "principle": "ZCZP and donation-like instruments should not be analysed like equity return opportunities.",
        "checklist": ["Principal terms", "Coupon terms", "Impact report", "Exit route", "Suitability"],
        "action": "If ZCZP language appears, switch the verdict from trading analysis to suitability/donation-style due diligence.",
        "caution": "Normal valuation ratios and candle patterns may be irrelevant for zero-coupon zero-principal structures.",
    },
]


@dataclass
class Chapter:
    module_id: str
    module_label: str
    title: str
    url: str


class ChapterListParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_chapter_list = False
        self.section_depth = 0
        self.in_innerworth_table = False
        self.table_depth = 0
        self.current_href: str | None = None
        self.current_text: list[str] = []
        self.chapters: list[tuple[str, str]] = []
        self.next_url: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {name: value or "" for name, value in attrs}
        if tag == "link" and attr.get("rel") == "next" and attr.get("href"):
            self.next_url = attr["href"]
        if tag == "section" and "chapter-list" in attr.get("class", ""):
            self.in_chapter_list = True
            self.section_depth = 1
            return
        if tag == "table" and "innerworth" in attr.get("class", "").split():
            self.in_innerworth_table = True
            self.table_depth = 1
            return
        if self.in_innerworth_table and tag == "table":
            self.table_depth += 1
        if self.in_chapter_list:
            if tag == "section":
                self.section_depth += 1
            if tag == "a" and "/varsity/chapter/" in attr.get("href", ""):
                self.current_href = attr["href"]
                self.current_text = []
        if self.in_innerworth_table and tag == "a" and "/varsity/chapter/" in attr.get("href", ""):
            self.current_href = attr["href"]
            self.current_text = []

    def handle_endtag(self, tag: str) -> None:
        if (self.in_chapter_list or self.in_innerworth_table) and tag == "a" and self.current_href:
            title = clean_text(" ".join(self.current_text))
            self.chapters.append((title, self.current_href))
            self.current_href = None
            self.current_text = []
        if self.in_chapter_list and tag == "section":
            self.section_depth -= 1
            if self.section_depth <= 0:
                self.in_chapter_list = False
        if self.in_innerworth_table and tag == "table":
            self.table_depth -= 1
            if self.table_depth <= 0:
                self.in_innerworth_table = False

    def handle_data(self, data: str) -> None:
        if self.current_href:
            self.current_text.append(data)


class ChapterBodyParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_post = False
        self.post_depth = 0
        self.in_title = False
        self.title_parts: list[str] = []
        self.parts: list[str] = []
        self.skip = False
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {name: value or "" for name, value in attrs}
        if tag in {"script", "style", "noscript", "form"}:
            self.skip = True
            self.skip_depth += 1
            return
        if tag == "h1" and "title" in attr.get("class", ""):
            self.in_title = True
        if tag == "div" and "post" in attr.get("class", "").split():
            self.in_post = True
            self.post_depth = 1
            return
        if self.in_post and tag == "div":
            self.post_depth += 1
        if self.in_post and tag in {"p", "li", "h2", "h3", "h4", "tr"}:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if self.skip and tag in {"script", "style", "noscript", "form"}:
            self.skip_depth -= 1
            if self.skip_depth <= 0:
                self.skip = False
            return
        if tag == "h1":
            self.in_title = False
        if self.in_post and tag == "div":
            self.post_depth -= 1
            if self.post_depth <= 0:
                self.in_post = False
        if self.in_post and tag in {"p", "li", "h2", "h3", "h4", "tr"}:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        if self.in_title:
            self.title_parts.append(data)
        if self.in_post:
            self.parts.append(data)


def clean_text(value: str) -> str:
    value = re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()
    value = re.sub(r"^\d+\.\s*", "", value)
    return value


def fetch(url: str, timeout: int = 20, attempts: int = 4) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "VerdictWorkstation/1.0 (+personal research)"})
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
            return raw.decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
            last_error = error
            if attempt + 1 >= attempts:
                break
            time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


def discover_chapters(module: dict[str, str], delay: float) -> list[Chapter]:
    urls_to_visit = [module["url"]]
    seen_pages: set[str] = set()
    seen_chapters: set[str] = set()
    chapters: list[Chapter] = []
    while urls_to_visit:
        url = urls_to_visit.pop(0)
        if url in seen_pages:
            continue
        seen_pages.add(url)
        html = fetch(url)
        parser = ChapterListParser()
        parser.feed(html)
        for title, chapter_url in parser.chapters:
            if chapter_url in seen_chapters:
                continue
            seen_chapters.add(chapter_url)
            chapters.append(Chapter(module["id"], module["label"], title, chapter_url))
        if parser.next_url and parser.next_url not in seen_pages and parser.next_url not in urls_to_visit:
            urls_to_visit.append(parser.next_url)
        time.sleep(delay)
    return chapters


def parse_chapter(chapter: Chapter) -> dict[str, object]:
    html = fetch(chapter.url)
    parser = ChapterBodyParser()
    parser.feed(html)
    body = clean_text(" ".join(parser.parts))
    title = clean_text(" ".join(parser.title_parts)) or chapter.title
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9\-']*", body)
    return {
        "module": chapter.module_id,
        "moduleLabel": chapter.module_label,
        "title": title,
        "url": chapter.url,
        "wordCount": len(words),
        "contentHash": hashlib.sha256(body.encode("utf-8")).hexdigest()[:16],
        "text": body,
    }


def rule_score(text: str, title: str, rule: dict[str, object]) -> int:
    haystack = f"{title} {text}".lower()
    score = 0
    for term in rule["terms"]:  # type: ignore[index]
        term_text = str(term).lower()
        hits = haystack.count(term_text)
        if hits:
            score += hits * (4 if " " in term_text else 1)
    if str(rule["module"]) in {"sector-analysis", "nps", "sse"}:
        score += 2
    return score


def choose_rules(chapter_data: dict[str, object]) -> list[str]:
    text = str(chapter_data["text"])
    title = str(chapter_data["title"])
    module = str(chapter_data["module"])
    scored = []
    for rule in RULE_CATALOG:
        if rule["module"] != module:
            continue
        score = rule_score(text, title, rule)
        if score > 0:
            scored.append((score, str(rule["id"])))
    scored.sort(reverse=True)
    if not scored:
        fallback = next(rule for rule in RULE_CATALOG if rule["module"] == module)
        return [str(fallback["id"])]
    return [rule_id for _, rule_id in scored[:3]]


def limited_refs(refs: Iterable[dict[str, object]], limit: int = 8) -> list[dict[str, str]]:
    result = []
    for ref in refs:
        result.append({"title": str(ref["title"]), "url": str(ref["url"])})
        if len(result) >= limit:
            break
    return result


def build_outputs(chapters: list[Chapter], delay: float, limit: int | None) -> tuple[dict[str, object], str]:
    selected = chapters[:limit] if limit else chapters
    chapter_index = []
    rules_to_chapters: dict[str, list[dict[str, object]]] = {str(rule["id"]): [] for rule in RULE_CATALOG}
    module_counts: dict[str, int] = {str(module["id"]): 0 for module in MODULES}
    module_word_counts: dict[str, int] = {str(module["id"]): 0 for module in MODULES}
    failures = []

    for index, chapter in enumerate(selected, start=1):
        try:
            data = parse_chapter(chapter)
            rule_ids = choose_rules(data)
            module_counts[chapter.module_id] += 1
            module_word_counts[chapter.module_id] += int(data["wordCount"])
            chapter_record = {
                "module": chapter.module_id,
                "moduleLabel": chapter.module_label,
                "title": data["title"],
                "url": chapter.url,
                "wordCount": data["wordCount"],
                "contentHash": data["contentHash"],
                "derivedRuleIds": rule_ids,
            }
            chapter_index.append(chapter_record)
            for rule_id in rule_ids:
                rules_to_chapters[rule_id].append(chapter_record)
            print(f"[{index}/{len(selected)}] {chapter.module_label}: {data['title']} -> {', '.join(rule_ids)}", flush=True)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, RuntimeError, ValueError) as error:
            failures.append({"module": chapter.module_id, "title": chapter.title, "url": chapter.url, "error": str(error)})
            print(f"[warn] failed {chapter.url}: {error}", flush=True)
        time.sleep(delay)

    derived_rules = []
    for rule in RULE_CATALOG:
        refs = rules_to_chapters[str(rule["id"])]
        derived_rules.append(
            {
                "id": rule["id"],
                "module": rule["module"],
                "moduleLabel": next(module["label"] for module in MODULES if module["id"] == rule["module"]),
                "title": rule["title"],
                "source": next(module["url"] for module in MODULES if module["id"] == rule["module"]),
                "appliesTo": rule["appliesTo"],
                "matchTerms": rule["terms"],
                "tone": rule["tone"],
                "scoreImpact": rule["scoreImpact"],
                "principle": rule["principle"],
                "checklist": rule["checklist"],
                "action": rule["action"],
                "caution": rule["caution"],
                "evidenceChapterCount": len(refs),
                "chapterRefs": limited_refs(refs),
            }
        )

    module_coverage = []
    for module in MODULES:
        module_coverage.append(
            {
                "id": module["id"],
                "label": module["label"],
                "source": module["url"],
                "description": module["description"],
                "chaptersRead": module_counts[module["id"]],
                "wordCount": module_word_counts[module["id"]],
            }
        )

    generated_at = datetime.now(timezone.utc).isoformat()
    reference = {
        "generatedAt": generated_at,
        "copyrightPolicy": "Only derived rules, chapter titles, URLs, word counts, and hashes are stored. Raw Varsity chapter prose is discarded.",
        "modules": module_coverage,
        "failures": failures,
        "chapters": chapter_index,
        "derivedRules": derived_rules,
    }

    ts = render_ts(generated_at, module_coverage, derived_rules, chapter_index)
    return reference, ts


def render_ts(generated_at: str, module_coverage: list[dict[str, object]], derived_rules: list[dict[str, object]], chapter_index: list[dict[str, object]]) -> str:
    def dump(value: object) -> str:
        return json.dumps(value, ensure_ascii=True, indent=2)

    return f"""// Generated by scripts/varsity_knowledge_refresh.py. Do not edit by hand.
// Raw Varsity chapter text is not stored here; this file contains only paraphrased rules and audit metadata.

export type VarsityModuleId = 'innerworth' | 'sector-analysis' | 'sse' | 'nps'

export type VarsityDerivedRule = {{
  id: string
  module: VarsityModuleId
  moduleLabel: string
  title: string
  source: string
  appliesTo: readonly string[]
  matchTerms: readonly string[]
  tone: 'positive' | 'negative' | 'neutral'
  scoreImpact: number
  principle: string
  checklist: readonly string[]
  action: string
  caution: string
  evidenceChapterCount: number
  chapterRefs: readonly {{ title: string; url: string }}[]
}}

export const varsityKnowledgeGeneratedAt = {dump(generated_at)} as const

export const varsitySourceLinks = {dump(SOURCE_LINKS)} as const

export const sectorOperatingRules = {dump(SECTOR_OPERATING_RULES)} as const

export const varsityModuleCoverage = {dump(module_coverage)} as const

export const varsityDerivedRules = {dump(derived_rules)} as const satisfies readonly VarsityDerivedRule[]

export const varsityChapterRuleIndex = {dump(chapter_index)} as const
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--delay", type=float, default=0.08, help="Delay between requests in seconds.")
    parser.add_argument("--limit", type=int, default=None, help="Optional chapter limit for testing.")
    args = parser.parse_args()

    all_chapters: list[Chapter] = []
    for module in MODULES:
        chapters = discover_chapters(module, args.delay)
        print(f"discovered {len(chapters)} chapters for {module['label']}", flush=True)
        all_chapters.extend(chapters)

    reference, ts = build_outputs(all_chapters, args.delay, args.limit)
    TS_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    INDEX_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    TS_OUTPUT.write_text(ts, encoding="utf-8")
    INDEX_OUTPUT.write_text(json.dumps(reference, ensure_ascii=True, indent=2), encoding="utf-8")
    print(f"wrote {TS_OUTPUT}")
    print(f"wrote {INDEX_OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
