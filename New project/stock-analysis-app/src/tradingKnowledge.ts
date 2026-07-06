// Generated practical trading-rule catalogue. Do not edit by hand.
// Contains compact practical checks used by the app.

export type TradingRuleDomain = 'process' | 'sector' | 'instrument' | 'capital'

export type TradingDerivedRule = {
  id: string
  module: TradingRuleDomain
  title: string
  appliesTo: readonly string[]
  matchTerms: readonly string[]
  tone: 'positive' | 'negative' | 'neutral'
  scoreImpact: number
  principle: string
  checklist: readonly string[]
  action: string
  caution: string
}

export const tradingKnowledgeGeneratedAt = "2026-07-01T06:07:10.006709+00:00" as const

export const sectorOperatingRules = [
  {
    "label": "Automobiles",
    "match": [
      "auto",
      "automobile",
      "vehicle",
      "passenger car",
      "utility vehicle",
      "two wheeler",
      "car manufacturer"
    ],
    "metrics": [
      "volume growth",
      "market share",
      "realisation",
      "raw-material cost",
      "dealer inventory",
      "working capital"
    ],
    "text": "Automobile analysis needs more than P/E. Demand cycles, model mix, raw-material pressure, inventory, and market share can change the quality of earnings quickly."
  },
  {
    "label": "Banking and lenders",
    "match": [
      "bank",
      "finance",
      "nbfc",
      "lender",
      "housing finance",
      "credit"
    ],
    "metrics": [
      "loan growth",
      "asset quality",
      "NPA trend",
      "capital adequacy",
      "net interest margin",
      "provisioning"
    ],
    "text": "Lenders should be judged with asset quality and capital strength first. Normal industrial ratios can mislead when credit losses or leverage are the real risk."
  },
  {
    "label": "Information Technology",
    "match": [
      "information technology",
      "software",
      "it services",
      "technology",
      "digital services"
    ],
    "metrics": [
      "revenue growth",
      "client concentration",
      "margin trend",
      "deal wins",
      "currency exposure",
      "employee costs"
    ],
    "text": "IT businesses need growth, margin, client, currency, and execution checks. A good balance sheet is not enough if growth visibility or margins are weakening."
  },
  {
    "label": "Cement",
    "match": [
      "cement",
      "building material"
    ],
    "metrics": [
      "capacity utilisation",
      "realisation per tonne",
      "power/fuel cost",
      "freight cost",
      "regional demand",
      "debt/capex"
    ],
    "text": "Cement is cyclical and cost-sensitive. Capacity, utilisation, regional pricing, energy costs, and leverage deserve as much attention as headline profit."
  },
  {
    "label": "Insurance",
    "match": [
      "insurance",
      "life insurance",
      "general insurance"
    ],
    "metrics": [
      "premium growth",
      "persistency",
      "claims ratio",
      "combined ratio",
      "solvency",
      "distribution mix"
    ],
    "text": "Insurance analysis needs operating quality metrics such as persistency, claims, solvency, and distribution mix because reported profit can hide underwriting quality."
  },
  {
    "label": "Steel and metals",
    "match": [
      "steel",
      "metal",
      "iron",
      "ferrous",
      "mining"
    ],
    "metrics": [
      "spread",
      "commodity cycle",
      "capacity utilisation",
      "raw-material linkage",
      "debt",
      "global price trend"
    ],
    "text": "Steel and metals are cycle-heavy. The verdict should be cautious when commodity prices, spreads, debt, or global demand are not understood."
  },
  {
    "label": "Hotels and hospitality",
    "match": [
      "hotel",
      "hospitality",
      "resort",
      "travel accommodation"
    ],
    "metrics": [
      "occupancy",
      "ARR",
      "RevPAR",
      "room additions",
      "seasonality",
      "debt service"
    ],
    "text": "Hotel quality depends on occupancy, pricing power, room economics, seasonality, and debt service rather than only revenue growth."
  },
  {
    "label": "Retail",
    "match": [
      "retail",
      "store",
      "supermarket",
      "apparel",
      "consumer retail"
    ],
    "metrics": [
      "same-store sales",
      "gross margin",
      "inventory turns",
      "store economics",
      "working capital",
      "lease costs"
    ],
    "text": "Retail needs store-level discipline: sales per store, margins, inventory turns, working capital, and expansion quality decide whether growth is healthy."
  },
  {
    "label": "Engineering and Infrastructure",
    "match": [
      "engineering",
      "civil construction",
      "infrastructure",
      "epc",
      "project management",
      "consultancy",
      "construction services",
      "turnkey"
    ],
    "metrics": [
      "order book",
      "execution pace",
      "working capital",
      "receivables",
      "operating margin",
      "client concentration"
    ],
    "text": "Engineering and infrastructure businesses depend on order-book quality, execution pace, receivables, working capital discipline, and margin protection."
  },
  {
    "label": "Real Estate",
    "match": [
      "real estate",
      "developer",
      "property",
      "housing developer",
      "residential project",
      "commercial property"
    ],
    "metrics": [
      "pre-sales",
      "collections",
      "project pipeline",
      "net debt",
      "inventory",
      "cash-flow timing"
    ],
    "text": "Real-estate analysis must separate bookings from cash collections. Project inventory, debt, execution, and cash-flow timing drive risk."
  }
] as const

export const tradingDerivedRules = [
  {
    "id": "process_process_before_outcome",
    "module": "process",
    "title": "Process before outcome",
    "appliesTo": [
      "risk",
      "entry",
      "discipline"
    ],
    "matchTerms": [
      "process",
      "plan",
      "action plan",
      "detailed plan",
      "focus",
      "goal",
      "outcome",
      "prize",
      "specific",
      "follow"
    ],
    "tone": "positive",
    "scoreImpact": 0.45,
    "principle": "A trade idea is stronger when the next action is pre-decided before emotion or price movement forces a reaction.",
    "checklist": [
      "Entry condition",
      "Invalidation level",
      "Target or review zone",
      "Maximum loss",
      "Position size"
    ],
    "action": "Before buying, convert the idea into if-this-then-that rules and do not increase size until the plan is explicit.",
    "caution": "A good-looking setup without a defined action plan can still lead to impulsive execution."
  },
  {
    "id": "process_accept_risk_loss",
    "module": "process",
    "title": "Accept risk and treat loss as feedback",
    "appliesTo": [
      "risk",
      "exit"
    ],
    "matchTerms": [
      "risk",
      "loss",
      "fear",
      "failure",
      "uncertainty",
      "cut",
      "protect",
      "consequence",
      "wrong",
      "stop"
    ],
    "tone": "neutral",
    "scoreImpact": 0.5,
    "principle": "Losses are part of the process; the useful question is whether the defined loss is affordable and informative.",
    "checklist": [
      "Risk per share",
      "Maximum rupee loss",
      "Stop or invalidation",
      "Post-trade review"
    ],
    "action": "Size the position so being wrong is survivable and reviewable instead of emotionally damaging.",
    "caution": "Avoid averaging down or revenge trading to erase the feeling of a loss."
  },
  {
    "id": "process_impulse_control",
    "module": "process",
    "title": "Impulse and temptation control",
    "appliesTo": [
      "entry",
      "behaviour"
    ],
    "matchTerms": [
      "impulse",
      "temptation",
      "greed",
      "revenge",
      "hot tip",
      "urge",
      "addicted",
      "excitement",
      "thrill",
      "overconfidence"
    ],
    "tone": "negative",
    "scoreImpact": -0.35,
    "principle": "The urge to act quickly is not evidence. A clean setup should survive a slower, more deliberate check.",
    "checklist": [
      "Reason for urgency",
      "Volume confirmation",
      "Risk budget",
      "News/event trigger",
      "Cooling-off check"
    ],
    "action": "If the buy reason is excitement, FOMO, a hot tip, or revenge, downgrade the verdict until objective evidence confirms.",
    "caution": "Do not chase price just to avoid the discomfort of missing a move."
  },
  {
    "id": "process_objectivity_facts",
    "module": "process",
    "title": "Facts over bias",
    "appliesTo": [
      "analysis",
      "confidence"
    ],
    "matchTerms": [
      "facts",
      "objective",
      "denial",
      "hindsight",
      "belief",
      "consensus",
      "crowd",
      "herd",
      "realistic",
      "evidence"
    ],
    "tone": "positive",
    "scoreImpact": 0.35,
    "principle": "A decision improves when it separates observable evidence from stories, hindsight, and crowd comfort.",
    "checklist": [
      "Price trend",
      "Financial data",
      "Recent filings",
      "Thesis contradiction",
      "Alternative view"
    ],
    "action": "Force the app to show both positives and cautions before accepting the verdict.",
    "caution": "Do not upgrade confidence only because the idea feels obvious after a price move."
  },
  {
    "id": "process_flexible_stand_aside",
    "module": "process",
    "title": "Flexibility and standing aside",
    "appliesTo": [
      "entry",
      "exit",
      "watchlist"
    ],
    "matchTerms": [
      "flexible",
      "stand aside",
      "fold",
      "walk away",
      "adapt",
      "possibilities",
      "change",
      "course",
      "not trade",
      "wait"
    ],
    "tone": "neutral",
    "scoreImpact": 0.25,
    "principle": "A good process allows waiting. Not buying is an active decision when evidence or reward/risk is incomplete.",
    "checklist": [
      "Wait condition",
      "Trigger to re-enter",
      "Reason to reject",
      "Review date"
    ],
    "action": "Use watchlist verdicts as a valid output instead of forcing every analysed ticker into a buy or sell.",
    "caution": "Do not convert patience into paralysis; define what evidence would change the decision."
  },
  {
    "id": "process_stress_resilience",
    "module": "process",
    "title": "Stress and resilience filter",
    "appliesTo": [
      "behaviour",
      "risk"
    ],
    "matchTerms": [
      "stress",
      "calm",
      "relax",
      "frustration",
      "mood",
      "break",
      "slump",
      "resilient",
      "pressure",
      "energy"
    ],
    "tone": "neutral",
    "scoreImpact": 0.2,
    "principle": "Decision quality falls when stress is high. Smaller size and clearer rules reduce the chance of emotional decisions.",
    "checklist": [
      "Recent loss streak",
      "Sleep/stress state",
      "Position size",
      "Time pressure",
      "Rule clarity"
    ],
    "action": "When uncertain or stressed, use starter size, wait for confirmation, or postpone the trade.",
    "caution": "Do not use the app to justify action when your real problem is pressure to recover quickly."
  },
  {
    "id": "process_capital_size_matters",
    "module": "process",
    "title": "Capital size matters",
    "appliesTo": [
      "sizing",
      "risk"
    ],
    "matchTerms": [
      "capital",
      "size",
      "position",
      "stake",
      "money",
      "risk tolerance",
      "small",
      "large",
      "safety",
      "security"
    ],
    "tone": "positive",
    "scoreImpact": 0.4,
    "principle": "Position size should follow risk capacity, not confidence alone.",
    "checklist": [
      "Deployable capital",
      "Risk budget",
      "Risk per share",
      "Liquidity",
      "Concentration"
    ],
    "action": "Keep suggested quantity tied to max loss and liquidity; reduce size if the setup is thinly traded or volatile.",
    "caution": "Do not use the full capital amount simply because it is available."
  },
  {
    "id": "sector_auto_operating_lens",
    "module": "sector",
    "title": "Automobile operating lens",
    "appliesTo": [
      "sector",
      "fundamental"
    ],
    "matchTerms": [
      "automobile",
      "automotive",
      "vehicle",
      "volume",
      "production",
      "sales volume",
      "realization",
      "product mix",
      "capacity",
      "dealer"
    ],
    "tone": "positive",
    "scoreImpact": 0.45,
    "principle": "Auto companies need volume, realization, product mix, capacity, inventory, and leverage checks before the ratio picture is trusted.",
    "checklist": [
      "Sales volume",
      "Production volume",
      "Realisation",
      "Product mix",
      "Capacity/capex",
      "Debt"
    ],
    "action": "For auto names, add volume and mix commentary before increasing conviction.",
    "caution": "Revenue growth can be misleading if it comes with inventory build-up or margin pressure."
  },
  {
    "id": "sector_banking_asset_quality",
    "module": "sector",
    "title": "Banking asset-quality lens",
    "appliesTo": [
      "sector",
      "fundamental"
    ],
    "matchTerms": [
      "banking",
      "bank",
      "loan",
      "deposit",
      "npa",
      "asset quality",
      "capital adequacy",
      "nim",
      "provision",
      "credit"
    ],
    "tone": "positive",
    "scoreImpact": 0.45,
    "principle": "Banks and lenders must be judged through credit quality, capital strength, margins, and provisioning, not ordinary industrial debt ratios.",
    "checklist": [
      "Loan growth",
      "Deposit mix",
      "NPA trend",
      "Provision coverage",
      "NIM",
      "Capital adequacy"
    ],
    "action": "For lenders, downgrade confidence if asset-quality and capital data are missing.",
    "caution": "Cheap valuation can be a trap when credit losses are rising."
  },
  {
    "id": "sector_it_margin_client_lens",
    "module": "sector",
    "title": "IT services margin and client lens",
    "appliesTo": [
      "sector",
      "fundamental"
    ],
    "matchTerms": [
      "information technology",
      "software",
      "it services",
      "client",
      "margin",
      "deal",
      "currency",
      "employee",
      "utilization"
    ],
    "tone": "positive",
    "scoreImpact": 0.35,
    "principle": "IT analysis should include client concentration, deal wins, margin trend, currency exposure, and employee costs.",
    "checklist": [
      "Revenue growth",
      "Margin trend",
      "Client concentration",
      "Deal wins",
      "Currency effect",
      "Attrition/costs"
    ],
    "action": "For IT names, prefer confirmation from margins and order/deal commentary, not only P/E.",
    "caution": "A cash-rich balance sheet does not offset weak growth visibility."
  },
  {
    "id": "sector_cyclical_cost_capacity",
    "module": "sector",
    "title": "Cyclical cost and capacity lens",
    "appliesTo": [
      "sector",
      "fundamental"
    ],
    "matchTerms": [
      "cement",
      "steel",
      "commodity",
      "capacity",
      "utilisation",
      "utilization",
      "raw material",
      "fuel",
      "freight",
      "cycle",
      "spread"
    ],
    "tone": "neutral",
    "scoreImpact": 0.35,
    "principle": "Cyclical sectors need cost, spread, capacity, and debt checks because earnings can turn quickly across the cycle.",
    "checklist": [
      "Capacity utilisation",
      "Realisation/spread",
      "Input costs",
      "Freight/energy",
      "Debt",
      "Cycle position"
    ],
    "action": "For cyclical names, reduce confidence unless margins and balance sheet are checked across the cycle.",
    "caution": "Peak earnings can make P/E look deceptively cheap."
  },
  {
    "id": "sector_consumer_store_lens",
    "module": "sector",
    "title": "Consumer, hotel, and retail unit economics",
    "appliesTo": [
      "sector",
      "fundamental"
    ],
    "matchTerms": [
      "hotel",
      "retail",
      "store",
      "occupancy",
      "arr",
      "revpar",
      "same-store",
      "inventory",
      "lease",
      "per square foot"
    ],
    "tone": "positive",
    "scoreImpact": 0.3,
    "principle": "Hotel and retail quality comes from unit economics: occupancy/pricing for hotels and store productivity/inventory for retail.",
    "checklist": [
      "Occupancy or same-store sales",
      "Pricing power",
      "Inventory turns",
      "Lease or debt burden",
      "Expansion quality"
    ],
    "action": "Use unit-economics metrics before accepting growth as high quality.",
    "caution": "Fast expansion can hide weak store economics or debt pressure."
  },
  {
    "id": "sector_real_estate_cash_flow",
    "module": "sector",
    "title": "Real-estate cash-flow lens",
    "appliesTo": [
      "sector",
      "fundamental"
    ],
    "matchTerms": [
      "real estate",
      "developer",
      "project",
      "booking",
      "pre-sales",
      "collections",
      "inventory",
      "land",
      "rera",
      "debt"
    ],
    "tone": "neutral",
    "scoreImpact": 0.35,
    "principle": "Real-estate analysis should separate bookings from cash collections and track debt, inventory, and execution.",
    "checklist": [
      "Pre-sales",
      "Collections",
      "Project pipeline",
      "Unsold inventory",
      "Net debt",
      "Execution risk"
    ],
    "action": "For developers, require cash collection and debt evidence before trusting accounting profits.",
    "caution": "Reported sales can be less useful than cash-flow timing and project delivery."
  },
  {
    "id": "capital_goal_money_separation",
    "module": "capital",
    "title": "Separate retirement-goal money from trade capital",
    "appliesTo": [
      "personal-finance",
      "risk"
    ],
    "matchTerms": [
      "retirement",
      "pension",
      "long term",
      "corpus",
      "future",
      "goal",
      "tax",
      "tier i",
      "withdrawal",
      "annuity"
    ],
    "tone": "neutral",
    "scoreImpact": 0.3,
    "principle": "Retirement and tax-planning capital should be protected from short-term trading decisions.",
    "checklist": [
      "Emergency fund separate",
      "Retirement contribution separate",
      "Trade capital marked deployable",
      "Time horizon clear"
    ],
    "action": "Treat the capital input as deployable market capital only; do not include retirement or emergency money.",
    "caution": "A good stock idea is still unsuitable if it risks money assigned to a non-negotiable life goal."
  },
  {
    "id": "capital_asset_allocation_horizon",
    "module": "capital",
    "title": "Asset allocation and horizon discipline",
    "appliesTo": [
      "personal-finance",
      "portfolio"
    ],
    "matchTerms": [
      "asset allocation",
      "equity",
      "corporate bond",
      "government bond",
      "active choice",
      "auto choice",
      "age",
      "horizon",
      "sip"
    ],
    "tone": "positive",
    "scoreImpact": 0.25,
    "principle": "Long-term wealth plans need allocation discipline, periodic investing, and age/horizon awareness.",
    "checklist": [
      "Equity allocation",
      "Debt allocation",
      "Investment horizon",
      "Contribution schedule",
      "Rebalancing"
    ],
    "action": "If the user is investing for long goals, frame the stock as part of allocation rather than a standalone bet.",
    "caution": "Aggressive concentration is weaker when the money belongs to a retirement allocation."
  },
  {
    "id": "capital_liquidity_tax_lockin",
    "module": "capital",
    "title": "Liquidity, lock-in, and tax clarity",
    "appliesTo": [
      "personal-finance",
      "liquidity"
    ],
    "matchTerms": [
      "tax",
      "80ccd",
      "tier ii",
      "exit",
      "withdrawal",
      "partial withdrawal",
      "annuity",
      "lock",
      "fee",
      "corporate nps"
    ],
    "tone": "neutral",
    "scoreImpact": 0.2,
    "principle": "Tax benefits and lock-in rules should not be confused with tradable liquidity.",
    "checklist": [
      "Tax regime",
      "Lock-in",
      "Withdrawal rule",
      "Liquidity need",
      "Advisor check"
    ],
    "action": "When capital may be goal-linked, caution the user to verify liquidity and tax consequences first.",
    "caution": "Do not sell or buy equities to meet a tax idea without checking cash-flow needs."
  },
  {
    "id": "instrument_instrument_type_filter",
    "module": "instrument",
    "title": "SSE instrument type filter",
    "appliesTo": [
      "instrument",
      "risk"
    ],
    "matchTerms": [
      "social stock exchange",
      "npo",
      "social enterprise",
      "eligible",
      "social impact",
      "fundraising",
      "not for profit"
    ],
    "tone": "negative",
    "scoreImpact": -0.5,
    "principle": "SSE-related securities may have social-impact objectives and different return/liquidity expectations from ordinary equities.",
    "checklist": [
      "Instrument type",
      "Issuer eligibility",
      "Return objective",
      "Liquidity",
      "Disclosure"
    ],
    "action": "Before applying normal buy/sell/hold logic, verify whether the instrument is an ordinary listed equity.",
    "caution": "Do not rely on chart signals alone for a social-impact or non-standard fundraising instrument."
  },
  {
    "id": "instrument_zczp_no_normal_return",
    "module": "instrument",
    "title": "ZCZP return caution",
    "appliesTo": [
      "instrument",
      "risk"
    ],
    "matchTerms": [
      "zczp",
      "zero coupon",
      "zero principal",
      "bond",
      "donation",
      "development impact",
      "social impact fund"
    ],
    "tone": "negative",
    "scoreImpact": -0.6,
    "principle": "ZCZP and donation-like instruments should not be analysed like equity return opportunities.",
    "checklist": [
      "Principal terms",
      "Coupon terms",
      "Impact report",
      "Exit route",
      "Suitability"
    ],
    "action": "If ZCZP language appears, switch the verdict from trading analysis to suitability/donation-style due diligence.",
    "caution": "Normal valuation ratios and candle patterns may be irrelevant for zero-coupon zero-principal structures."
  }
] as const satisfies readonly TradingDerivedRule[]
