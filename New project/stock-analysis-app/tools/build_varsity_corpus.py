#!/usr/bin/env python3
"""Build the tracked, paraphrased Varsity rulebook and coverage manifest.

Raw chapter prose remains in the user-supplied source files and is never written to
the generated outputs. The generated corpus contains chapter identity, source
metadata, and curated analytical guidance only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


APP_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = APP_ROOT.parent
LOCAL_MODULE_ROOT = REPO_ROOT / "tmp" / "pdfs" / "zerodha_varsity_modules"
LOCAL_TEXT_ROOT = LOCAL_MODULE_ROOT / "extracted_text"
LEGACY_RULES = REPO_ROOT / "data" / "reference" / "trading_rule_index.json"
OUTPUT = APP_ROOT / "data" / "reference" / "varsity_rulebook.json"
COVERAGE_OUTPUT = APP_ROOT / "data" / "reference" / "varsity_coverage.json"

WEB_MODULES = [
    ("innerworth", "Innerworth", "https://zerodha.com/varsity/module/innerworth/", "process"),
    ("sector-analysis", "Sector Analysis", "https://zerodha.com/varsity/module/sector-analysis/", "company"),
    ("social-stock-exchange", "Social Stock Exchanges", "https://zerodha.com/varsity/module/social-stock-exchanges-sses/", "instrument"),
    ("national-pension-system", "National Pension System", "https://zerodha.com/varsity/module/national-pension-scheme/", "portfolio"),
]

MODULE_PROFILES: dict[int, dict[str, Any]] = {
    1: {
        "label": "Introduction to Stock Markets",
        "tabs": ["decision", "portfolio", "reasoning"],
        "principle": "Confirm the instrument, market structure, liquidity, ownership context, and investment purpose before treating price as an opportunity.",
        "checklist": ["Instrument and exchange", "Liquidity", "Market participant context", "Investment versus speculation", "Capital at risk"],
        "action": "Define why the instrument belongs in the portfolio before deciding entry size.",
        "caution": "Basic market familiarity does not remove company, liquidity, or valuation risk.",
    },
    2: {
        "label": "Technical Analysis",
        "tabs": ["chart", "decision", "reasoning"],
        "principle": "Read trend, levels, candles, volume, and indicators together; use confirmation and invalidation instead of a single-signal trade call.",
        "checklist": ["Trend", "Support and resistance", "Volume", "Momentum", "Volatility", "Invalidation"],
        "action": "Translate the chart into an entry condition, review level, and invalidation point.",
        "caution": "Patterns and indicators are probabilistic and can fail without follow-through.",
    },
    3: {
        "label": "Fundamental Analysis",
        "tabs": ["company", "decision", "reasoning"],
        "principle": "Study the business, management, statements, cash conversion, balance sheet, growth, and valuation as one connected evidence set.",
        "checklist": ["Business model", "Management quality", "Income statement", "Balance sheet", "Cash flow", "Valuation"],
        "action": "Require business and financial evidence to support the price thesis before increasing conviction.",
        "caution": "A cheap ratio or one strong quarter is not a complete fundamental thesis.",
    },
    4: {
        "label": "Futures Trading",
        "tabs": ["decision", "portfolio", "reasoning"],
        "principle": "Futures exposure must account for leverage, margin, mark-to-market movement, basis, liquidity, expiry, and rollover.",
        "checklist": ["Contract specification", "Leverage", "Margin buffer", "Basis", "Expiry", "Maximum loss"],
        "action": "Use futures only for a defined directional view or hedge with a survivable loss limit.",
        "caution": "Leverage can turn a modest underlying move into a large capital loss.",
    },
    5: {
        "label": "Options Theory",
        "tabs": ["decision", "chart", "reasoning"],
        "principle": "Option value depends on direction, time, volatility, strike, expiry, and Greeks rather than direction alone.",
        "checklist": ["Intrinsic value", "Time value", "Volatility", "Delta", "Theta", "Expiry"],
        "action": "Match the option structure and holding period to the expected move and volatility regime.",
        "caution": "A correct directional view can still lose when timing, volatility, or strike selection is wrong.",
    },
    6: {
        "label": "Option Strategies",
        "tabs": ["decision", "portfolio", "reasoning"],
        "principle": "Choose an option strategy only after defining direction, volatility expectation, time horizon, break-even, and maximum loss.",
        "checklist": ["Payoff shape", "Break-even", "Maximum gain", "Maximum loss", "Volatility view", "Exit rule"],
        "action": "Write down the payoff and adjustment or exit condition before opening the structure.",
        "caution": "Complexity does not improve a strategy when the market view and risk limit are unclear.",
    },
    7: {
        "label": "Markets and Taxation",
        "tabs": ["decision", "portfolio", "reasoning"],
        "principle": "Judge market returns after applicable taxes, charges, classification, turnover, record keeping, and compliance requirements.",
        "checklist": ["Holding period", "Tax treatment", "Transaction costs", "Turnover", "Records", "Post-tax return"],
        "action": "Compare the expected post-tax result with the risk and effort required.",
        "caution": "Tax rules change; verify current law rather than relying on historical educational examples.",
    },
    8: {
        "label": "Currency and Commodity Futures",
        "tabs": ["decision", "chart", "reasoning"],
        "principle": "Currency and commodity instruments require macro drivers, contract specifications, global events, leverage, expiry, and underlying-market context.",
        "checklist": ["Macro driver", "Contract unit", "Expiry", "Leverage", "Global event risk", "Liquidity"],
        "action": "Use instrument-specific drivers rather than applying an equity-only thesis.",
        "caution": "Macro-linked contracts can gap or reprice quickly around global events.",
    },
    9: {
        "label": "Risk Management and Trading Psychology",
        "tabs": ["decision", "portfolio", "reasoning", "coach"],
        "principle": "Define maximum loss, position size, diversification, invalidation, and behavioural safeguards before capital is exposed.",
        "checklist": ["Risk per position", "Portfolio risk", "Correlation", "Drawdown", "Bias check", "Review process"],
        "action": "Size the position so being wrong is financially and emotionally survivable.",
        "caution": "Averaging, revenge trading, and outcome bias can convert a manageable loss into a portfolio problem.",
    },
    10: {
        "label": "Trading Systems",
        "tabs": ["chart", "decision", "reasoning"],
        "principle": "Evaluate a trading system through rules, sample size, expectancy, drawdown, costs, robustness, and live execution constraints.",
        "checklist": ["Signal definition", "Sample size", "Expectancy", "Drawdown", "Costs", "Out-of-sample behaviour"],
        "action": "Test the rule set across different periods before trusting it with capital.",
        "caution": "Overfitting can make historical results look precise while failing in live conditions.",
    },
    11: {
        "label": "Personal Finance",
        "tabs": ["portfolio", "decision", "coach"],
        "principle": "Separate emergency, goal, insurance, retirement, and market-risk capital before selecting investments.",
        "checklist": ["Emergency reserve", "Goal horizon", "Asset allocation", "Debt", "Insurance", "Risk capacity"],
        "action": "Invest only the capital whose time horizon and loss tolerance fit the instrument.",
        "caution": "A promising stock should not endanger essential goals or emergency liquidity.",
    },
    13: {
        "label": "Integrated Financial Modelling",
        "tabs": ["company", "decision", "reasoning"],
        "principle": "Connect assumptions, operating drivers, statements, cash flow, and valuation so changes in the business flow consistently through the model.",
        "checklist": ["Operating assumptions", "Revenue drivers", "Margins", "Working capital", "Cash flow", "Valuation sensitivity"],
        "action": "Make assumptions explicit and test bear, base, and bull outcomes before relying on a valuation.",
        "caution": "A detailed model is still fragile when its assumptions are unsupported or internally inconsistent.",
    },
    14: {
        "label": "Insurance",
        "tabs": ["portfolio", "decision", "coach"],
        "principle": "Use insurance to transfer catastrophic risk and keep protection decisions separate from return-seeking investments.",
        "checklist": ["Protection need", "Coverage", "Exclusions", "Premium affordability", "Claim process", "Product purpose"],
        "action": "Protect essential financial risks before increasing market exposure.",
        "caution": "Do not treat protection products as substitutes for a transparent investment plan.",
    },
}

WEB_PROFILES = {
    "process": MODULE_PROFILES[9],
    "company": MODULE_PROFILES[3],
    "instrument": MODULE_PROFILES[1],
    "portfolio": MODULE_PROFILES[11],
}

PAGE_RE = re.compile(r"^--- PAGE (\d+) ---$", re.MULTILINE)
CHAPTER_RE = re.compile(r"^(?:CHAPTER|Chapter)\s+(\d+)(?:\s*[-:–]\s*(.+))?$", re.MULTILINE)
NUMBERED_CHAPTER_RE = re.compile(r"^(\d+)\s+[-–]\s+([^\n]{3,100})$", re.MULTILINE)


@dataclass(frozen=True)
class Chapter:
    source_id: str
    module: str
    title: str
    page: int | None
    source_url: str
    source_file: str


class ChapterLinkParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.links: list[tuple[str, str]] = []
        self.next_url = ""
        self.in_chapter_list = False
        self.chapter_list_depth = 0
        self.in_innerworth_table = False
        self.table_depth = 0
        self.current_href = ""
        self.current_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {name: value or "" for name, value in attrs}
        if tag == "link" and attr.get("rel") == "next" and attr.get("href"):
            self.next_url = urljoin(self.base_url, attr["href"])
        if tag == "section" and "chapter-list" in attr.get("class", ""):
            self.in_chapter_list = True
            self.chapter_list_depth = 1
            return
        if tag == "table" and "innerworth" in attr.get("class", "").split():
            self.in_innerworth_table = True
            self.table_depth = 1
            return
        if self.in_chapter_list and tag == "section":
            self.chapter_list_depth += 1
        if self.in_innerworth_table and tag == "table":
            self.table_depth += 1
        href = attr.get("href", "")
        if (self.in_chapter_list or self.in_innerworth_table) and tag == "a" and "/varsity/chapter/" in href:
            self.current_href = urljoin(self.base_url, href)
            self.current_text = []

    def handle_data(self, data: str) -> None:
        if self.current_href:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.current_href:
            title = " ".join(" ".join(self.current_text).split())
            self.links.append((self.current_href, title or self.current_href.rstrip("/").split("/")[-1].replace("-", " ").title()))
            self.current_href = ""
            self.current_text = []
        if self.in_chapter_list and tag == "section":
            self.chapter_list_depth -= 1
            if self.chapter_list_depth <= 0:
                self.in_chapter_list = False
        if self.in_innerworth_table and tag == "table":
            self.table_depth -= 1
            if self.table_depth <= 0:
                self.in_innerworth_table = False


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:64]


def page_for_offset(text: str, offset: int) -> int | None:
    pages = [(match.start(), int(match.group(1))) for match in PAGE_RE.finditer(text)]
    current = None
    for position, page in pages:
        if position > offset:
            break
        current = page
    return current


def next_title(text: str, offset: int) -> str:
    for line in text[offset:].splitlines()[1:8]:
        clean = " ".join(line.split()).strip(" -–")
        if clean and not clean.lower().startswith(("chapter", "page")) and len(clean) <= 120:
            return clean
    return "Chapter"


def local_chapters(path: Path, module_number: int, module_label: str) -> list[Chapter]:
    text = path.read_text(encoding="utf-8", errors="replace")
    found: list[Chapter] = []
    for match in CHAPTER_RE.finditer(text):
        number = match.group(1)
        title = " ".join((match.group(2) or next_title(text, match.start())).split())
        found.append(
            Chapter(
                source_id=f"pdf-m{module_number}-c{number}-{slug(title)}",
                module=module_label,
                title=title,
                page=page_for_offset(text, match.start()),
                source_url="",
                source_file=str(path.relative_to(REPO_ROOT)),
            )
        )
    if not found:
        for match in NUMBERED_CHAPTER_RE.finditer(text[: min(len(text), 24000)]):
            title = " ".join(match.group(2).split())
            found.append(
                Chapter(
                    source_id=f"pdf-m{module_number}-c{match.group(1)}-{slug(title)}",
                    module=module_label,
                    title=title,
                    page=page_for_offset(text, match.start()),
                    source_url="",
                    source_file=str(path.relative_to(REPO_ROOT)),
                )
            )
    if not found:
        found.append(
            Chapter(
                source_id=f"pdf-m{module_number}-overview",
                module=module_label,
                title="Module overview",
                page=1,
                source_url="",
                source_file=str(path.relative_to(REPO_ROOT)),
            )
        )
    unique: dict[str, Chapter] = {}
    for chapter in found:
        unique.setdefault(f"{chapter.source_id}:{chapter.page}", chapter)
    return list(unique.values())


def fetch_web_chapters(module_id: str, label: str, url: str) -> tuple[list[Chapter], str]:
    chapters: dict[str, Chapter] = {}
    pending = [url]
    visited: set[str] = set()
    try:
        while pending:
            page_url = pending.pop(0)
            if page_url in visited:
                continue
            visited.add(page_url)
            request = Request(page_url, headers={"User-Agent": "StockAnalysisAgentKnowledgeBuilder/1.0"})
            with urlopen(request, timeout=30) as response:
                html = response.read().decode("utf-8", errors="replace")
            parser = ChapterLinkParser(page_url)
            parser.feed(html)
            for chapter_url, title in parser.links:
                chapter_id = f"web-{module_id}-{slug(chapter_url.rstrip('/').split('/')[-1])}"
                chapters.setdefault(
                    chapter_url,
                    Chapter(
                        source_id=chapter_id,
                        module=label,
                        title=title,
                        page=None,
                        source_url=chapter_url,
                        source_file="",
                    ),
                )
            if parser.next_url and parser.next_url not in visited:
                pending.append(parser.next_url)
    except (HTTPError, URLError, TimeoutError) as exc:
        return list(chapters.values()), str(exc)
    return list(chapters.values()), ""


def chapter_rule(chapter: Chapter, profile: dict[str, Any], module_id: str) -> dict[str, Any]:
    pages = str(chapter.page) if chapter.page else ""
    return {
        "id": chapter.source_id,
        "module": chapter.module,
        "moduleId": module_id,
        "chapter": chapter.title,
        "pages": pages,
        "sourceUrl": chapter.source_url,
        "sourceFile": chapter.source_file,
        "appliesTo": profile["tabs"],
        "instrumentTypes": ["equity", "etf", "index", "fund", "unknown"],
        "horizons": ["3-6m", "6-12m", "1-3y", "3y+"],
        "title": chapter.title,
        "principle": f"{profile['principle']} Use the {chapter.title} framework only where the current evidence makes it applicable.",
        "checklist": profile["checklist"],
        "action": profile["action"],
        "caution": profile["caution"],
    }


def content_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(include_web: bool) -> tuple[dict[str, Any], dict[str, Any]]:
    generated_at = datetime.now(timezone.utc).isoformat()
    rules: list[dict[str, Any]] = []
    coverage_sources: list[dict[str, Any]] = []
    duplicate_ids: list[str] = []

    for path in sorted(LOCAL_TEXT_ROOT.glob("*.txt")):
        number_match = re.search(r"Module_?(\d+)", path.name, re.IGNORECASE)
        if not number_match:
            continue
        module_number = int(number_match.group(1))
        profile = MODULE_PROFILES.get(module_number, MODULE_PROFILES[1])
        chapters = local_chapters(path, module_number, profile["label"])
        coverage_sources.append(
            {
                "id": f"pdf-module-{module_number}",
                "type": "local-pdf-extract",
                "label": profile["label"],
                "sourceFile": str(path.relative_to(REPO_ROOT)),
                "contentHash": content_hash(path),
                "status": "ready",
                "chapterCount": len(chapters),
            }
        )
        rules.extend(chapter_rule(chapter, profile, f"module-{module_number}") for chapter in chapters)

    for module_id, label, url, profile_key in WEB_MODULES:
        if include_web:
            chapters, error = fetch_web_chapters(module_id, label, url)
            status = "ready" if chapters else "error"
        else:
            chapters, error, status = [], "Web discovery skipped", "pending"
        coverage_sources.append(
            {
                "id": f"web-module-{module_id}",
                "type": "web-module",
                "label": label,
                "sourceUrl": url,
                "status": status,
                "error": error,
                "chapterCount": len(chapters),
            }
        )
        rules.extend(chapter_rule(chapter, WEB_PROFILES[profile_key], module_id) for chapter in chapters)

    if LEGACY_RULES.exists():
        legacy = json.loads(LEGACY_RULES.read_text(encoding="utf-8"))
        for raw in legacy.get("derivedRules") or []:
            if not isinstance(raw, dict):
                continue
            rules.append(
                {
                    **raw,
                    "chapter": raw.get("title") or "Curated practical check",
                    "pages": "",
                    "sourceUrl": "",
                    "sourceFile": "",
                    "instrumentTypes": ["equity", "etf", "index", "fund", "unknown"],
                    "horizons": ["3-6m", "6-12m", "1-3y", "3y+"],
                }
            )

    unique_rules: dict[str, dict[str, Any]] = {}
    for rule in rules:
        rule_id = str(rule["id"])
        if rule_id in unique_rules:
            duplicate_ids.append(rule_id)
            continue
        unique_rules[rule_id] = rule

    rulebook = {
        "schemaVersion": "varsity-rulebook.v1",
        "generatedAt": generated_at,
        "rawSourceTextStored": False,
        "rules": list(unique_rules.values()),
    }
    coverage = {
        "schemaVersion": "varsity-coverage.v1",
        "generatedAt": generated_at,
        "sources": coverage_sources,
        "readySources": sum(source["status"] == "ready" for source in coverage_sources),
        "pendingOrFailedSources": sum(source["status"] != "ready" for source in coverage_sources),
        "chapterRuleCount": len(unique_rules),
        "duplicates": duplicate_ids,
    }
    return rulebook, coverage


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include-web", action="store_true", help="Discover configured online module chapter links.")
    args = parser.parse_args()
    rulebook, coverage = build(include_web=args.include_web)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(rulebook, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    COVERAGE_OUTPUT.write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"rules": len(rulebook["rules"]), "coverage": coverage}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
