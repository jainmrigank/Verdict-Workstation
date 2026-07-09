import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { FlashcardDeck, FlashcardStack } from './FlashcardDeck'
import { PriceChart } from './PriceChart'
import {
  sectorOperatingRules,
  tradingDerivedRules,
  type TradingDerivedRule,
} from './tradingKnowledge'

type Exchange = 'NSE' | 'BSE'
type RiskMode = 'percent' | 'amount'
type RiskProfile = 'conservative' | 'balanced' | 'balanced_aggressive' | 'aggressive'
type Horizon = '3-6m' | '6-12m' | '1-3y' | '3y+'
type TradeAccess = 'delivery' | 'fo_context' | 'hedging'
type ProfitTrend = 'unknown' | 'growing' | 'stable' | 'declining' | 'loss_making'
type View = 'setup' | 'verdict' | 'coach' | 'technicals' | 'fundamentals' | 'reasoning' | 'data' | 'glossary'
type CacheState = 'loading' | 'live' | 'free' | 'sample'
export type { CacheState, Exchange, RiskMode, RiskProfile, Horizon, TradeAccess, ProfitTrend, ConstraintKey, AnalysisForm, AnalysisResult, Snapshot }
type RefreshState = 'idle' | 'refreshing' | 'done' | 'error'
type UploadState = 'idle' | 'uploading' | 'done' | 'error'
type ThemeMode = 'dark' | 'light'
type AiCoachScope = 'verdict' | 'technical' | 'fundamental'
type ChartTimeframe = '1D' | '1M' | '3M' | '6M' | '1Y' | 'ALL'
type ForecastHorizon = '5D' | '15D' | '1M' | '6M' | '1Y' | '3Y' | '5Y' | '10Y'
type ForecastMode = 'adaptive' | 'technical' | 'fundamental' | 'custom'
type EventRisk = 'low' | 'normal' | 'high'
type IndicatorKey =
  | 'sma20'
  | 'sma50'
  | 'sma100'
  | 'sma200'
  | 'ema20'
  | 'ema50'
  | 'vwap'
  | 'bbands'
  | 'volume'
  | 'range'
  | 'rsi'
  | 'macd'
  | 'atr'
  | 'patterns'

// Primary tabs: the everyday path a first-time user follows, ticker in, verdict out.
const primaryWorkspaceTabs: Array<{ id: View; label: string; caption: string }> = [
  { id: 'setup', label: 'Start', caption: 'Set context' },
  { id: 'verdict', label: 'Decision', caption: 'Action plan' },
  { id: 'technicals', label: 'Chart', caption: 'Price map' },
  { id: 'fundamentals', label: 'Company', caption: 'Business' },
  { id: 'data', label: 'Portfolio', caption: 'Holdings' },
  { id: 'coach', label: 'AI Coach', caption: 'Ask why' },
]

const utilityWorkspaceTabs: Array<{ id: View; label: string }> = [
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'glossary', label: 'Glossary' },
]

const aiCoachScopeCopy: Record<AiCoachScope, { label: string; title: string; message: string; empty: string }> = {
  verdict: {
    label: 'Verdict',
    title: 'Decision explanation',
    message: 'Preparing the decision, chart, company, and risk context...',
    empty: 'Click Generate AI Review after loading market data. The coach will explain what this decision means for future price, action, and risk.',
  },
  technical: {
    label: 'Charts',
    title: 'Price-action explanation',
    message: 'Preparing price action, indicators, candles, patterns, liquidity, and risk context...',
    empty: 'Click Generate AI Review to explain what the chart says about possible future price direction and timing risk.',
  },
  fundamental: {
    label: 'Company',
    title: 'Business quality explanation',
    message: 'Preparing company profile, ratios, statements, updates, and business-quality context...',
    empty: 'Click Generate AI Review to explain whether the business can support higher prices, cap upside, or needs more proof.',
  },
}

type GlossaryEntry = { term: string; definition: string; category: string }
const glossaryEntries: GlossaryEntry[] = [
  { category: 'Verdict basics', term: 'Verdict', definition: 'The app\'s current action label: Buy, Watchlist, Hold, Reduce, Avoid, or Needs Input. It is a decision aid, not a guarantee.' },
  { category: 'Verdict basics', term: 'Evidence read', definition: 'A compact health read of technicals, business quality, statement flow, risk plan, and updates. Higher means stronger evidence, but the action plan still matters.' },
  { category: 'Verdict basics', term: 'Data confidence', definition: 'How complete the loaded evidence is. Low confidence means key data is missing or stale, not automatically that the stock is bad.' },
  { category: 'Verdict basics', term: 'Needs Input', definition: 'The app needs a required input such as ticker, capital, quantity, price, or refreshed market data before it can give a useful answer.' },
  { category: 'Price and market data', term: 'LTP', definition: 'Last traded price. This is the price the app uses for current value, P&L, range location, and position sizing.' },
  { category: 'Price and market data', term: 'OHLC', definition: 'Open, high, low, and close for a candle. These show where price started, stretched, and ended during the selected period.' },
  { category: 'Price and market data', term: 'Candle', definition: 'One price bar for a day or period. It compresses open, high, low, close, and sometimes volume into one visual unit.' },
  { category: 'Price and market data', term: 'Volume', definition: 'How many shares traded. Rising price with healthy volume is more trustworthy than rising price on thin trading.' },
  { category: 'Price and market data', term: 'Liquidity', definition: 'How easy it may be to enter or exit without moving price too much. Low liquidity increases slippage and exit risk.' },
  { category: 'Price and market data', term: 'Delayed EOD data', definition: 'End-of-day or delayed market data, not live ticks. It is useful for non-intraday analysis but should be refreshed before action.' },
  { category: 'Chart structure', term: 'Trend', definition: 'The broad direction of price. Uptrends support holding or buying on pullbacks; downtrends demand caution.' },
  { category: 'Chart structure', term: 'Support', definition: 'A price area where buyers have previously stepped in. If it breaks, downside risk can increase quickly.' },
  { category: 'Chart structure', term: 'Resistance', definition: 'A price area where sellers have previously appeared. Breakouts above it need confirmation from price and volume.' },
  { category: 'Chart structure', term: 'Breakout', definition: 'Price moving above a resistance zone. It is stronger when volume expands and price holds above the breakout level.' },
  { category: 'Chart structure', term: 'Pullback', definition: 'A controlled fall inside an uptrend. It can offer better entry only if the trend and business evidence remain healthy.' },
  { category: 'Chart structure', term: 'Consolidation', definition: 'Price moving sideways after a rise or fall. It can reduce noise, but direction is unclear until price breaks the range.' },
  { category: 'Chart indicators', term: 'SMA', definition: 'Simple moving average. It smooths price over a fixed window and helps judge whether price is above or below its recent base.' },
  { category: 'Chart indicators', term: 'EMA', definition: 'Exponential moving average. It reacts faster than SMA because recent prices carry more weight.' },
  { category: 'Chart indicators', term: 'VWAP', definition: 'Volume-weighted average price. Price above VWAP means buyers are accepting higher prices than the recent volume-weighted reference.' },
  { category: 'Chart indicators', term: 'Bollinger Bands', definition: 'A moving average with volatility bands. Bands show whether price is stretched, compressed, or near a volatility edge.' },
  { category: 'Chart indicators', term: 'Bollinger squeeze', definition: 'A period where bands narrow. It often warns that a larger move may come, but not the direction by itself.' },
  { category: 'Chart indicators', term: 'RSI', definition: 'Relative Strength Index. It measures momentum from 0 to 100; very high can be strong but stretched, very low can be weak but oversold.' },
  { category: 'Chart indicators', term: 'MACD', definition: 'A momentum indicator comparing faster and slower moving averages. Crossovers and distance from the signal line show momentum shifts.' },
  { category: 'Chart indicators', term: 'MACD signal line', definition: 'The reference line MACD is compared against. MACD above the signal line is usually healthier than below it.' },
  { category: 'Chart indicators', term: 'ATR', definition: 'Average True Range. It shows typical daily movement and helps set exits that are not too tight for normal volatility.' },
  { category: 'Candlesticks', term: 'Bullish pattern', definition: 'A candle pattern suggesting buyers may be gaining control. It still needs confirmation from the next close and volume.' },
  { category: 'Candlesticks', term: 'Bearish pattern', definition: 'A candle pattern suggesting sellers may be gaining control. It is a warning, not an automatic sell signal.' },
  { category: 'Candlesticks', term: 'Neutral pattern', definition: 'A candle pattern showing indecision. It usually means wait for a clearer break before acting.' },
  { category: 'Risk and sizing', term: 'Exit line', definition: 'The price where the original idea is considered wrong. If price reaches it, the plan should shift from hope to action.' },
  { category: 'Risk and sizing', term: 'Reward/risk', definition: 'Potential upside divided by potential downside. A trade with poor reward/risk needs either a better entry or a smaller size.' },
  { category: 'Risk and sizing', term: 'Risk budget', definition: 'The maximum rupee loss allowed for the idea. Quantity should be sized so this limit is respected.' },
  { category: 'Risk and sizing', term: 'Quantity plan', definition: 'The number of shares suggested from capital, risk budget, LTP, and exit line.' },
  { category: 'Risk and sizing', term: 'Max risk %', definition: 'The percentage of deployable capital you are willing to lose if the idea fails.' },
  { category: 'Risk and sizing', term: 'Drawdown', definition: 'The fall from a previous high or your entry value. Deep drawdowns require fresh evidence before adding money.' },
  { category: 'Risk and sizing', term: 'Breakeven move', definition: 'How far price must rise from the current level to reach your average buy price again.' },
  { category: 'Portfolio', term: 'Portfolio weight', definition: 'The share of your portfolio value in one stock. High weight increases company-specific risk.' },
  { category: 'Portfolio', term: 'Concentration', definition: 'Too much capital in one stock, sector, or theme. Concentration can magnify both gains and losses.' },
  { category: 'Portfolio', term: 'P&L', definition: 'Profit or loss on the position. Negative P&L should not by itself justify averaging down.' },
  { category: 'Fundamentals', term: 'Market cap', definition: 'Total market value of the company. Larger companies are often more liquid and better covered, but not automatically better investments.' },
  { category: 'Fundamentals', term: 'P/E', definition: 'Price divided by earnings per share. It helps judge valuation only when compared with growth, quality, peers, and history.' },
  { category: 'Fundamentals', term: 'P/B', definition: 'Price divided by book value per share. It is more useful for asset-heavy businesses and financial companies.' },
  { category: 'Fundamentals', term: 'EPS', definition: 'Earnings per share. Rising EPS can support price if quality and valuation are reasonable.' },
  { category: 'Fundamentals', term: 'PAT', definition: 'Profit after tax. It is the final accounting profit available to shareholders after expenses and taxes.' },
  { category: 'Fundamentals', term: 'ROE', definition: 'Return on equity. It shows how efficiently shareholder money is converted into profit.' },
  { category: 'Fundamentals', term: 'ROA', definition: 'Return on assets. It shows how efficiently the company uses its asset base.' },
  { category: 'Fundamentals', term: 'ROCE', definition: 'Return on capital employed. It checks whether the business earns enough on all long-term capital, including debt.' },
  { category: 'Fundamentals', term: 'Debt/Equity', definition: 'Borrowed money compared with shareholder money. High leverage can turn a temporary slowdown into permanent capital damage.' },
  { category: 'Fundamentals', term: 'Current ratio', definition: 'Current assets divided by current liabilities. It is a quick check of short-term balance-sheet comfort.' },
  { category: 'Fundamentals', term: 'Dividend yield', definition: 'Dividend per share divided by price. It can support returns, but very high yield may also signal low growth or stress.' },
  { category: 'Statements and cash flow', term: 'CFO', definition: 'Cash flow from operations. Good companies should eventually convert profits into operating cash.' },
  { category: 'Statements and cash flow', term: 'FCF', definition: 'Free cash flow after capital spending. Positive FCF gives the business more room for dividends, debt reduction, or growth.' },
  { category: 'Statements and cash flow', term: 'Reserves', definition: 'Accumulated retained profits and other reserves. Rising reserves can strengthen the balance sheet if backed by real cash and assets.' },
  { category: 'Statements and cash flow', term: 'Borrowings', definition: 'Debt taken by the company. Borrowings must be judged against profits, cash flow, interest cost, and business cyclicality.' },
  { category: 'Statements and cash flow', term: 'Revenue growth', definition: 'Growth in sales. It supports price only if margins, cash flow, and capital efficiency do not deteriorate.' },
  { category: 'Statements and cash flow', term: 'Earnings growth', definition: 'Growth in profit. It is more valuable when backed by cash flow and not just one-time accounting gains.' },
  { category: 'Data quality', term: 'Stale data', definition: 'Data that may be old enough to make the current price view unreliable. Refresh before making a decision.' },
  { category: 'Data quality', term: 'Missing data', definition: 'Evidence the app could not fetch. Missing data should reduce confidence rather than be guessed.' },
  { category: 'Data quality', term: 'Data bridge', definition: 'The local or hosted server that fetches market data, parses holdings, and calls the AI provider without exposing secrets in the browser.' },
  { category: 'AI Coach', term: 'Chart coach', definition: 'AI explanation focused only on price action, indicators, candles, volatility, and liquidity.' },
  { category: 'AI Coach', term: 'Company coach', definition: 'AI explanation focused only on business model, ratios, statements, updates, and missing fundamental evidence.' },
  { category: 'AI Coach', term: 'Verdict coach', definition: 'AI explanation of the final action plan, risk controls, and the evidence that matters most now.' },
]

type PatternBias = 'bullish' | 'bearish' | 'neutral'
type SignalTone = 'positive' | 'negative' | 'neutral'

type Candle = { date: string; close: number; volume: number; open?: number; high?: number; low?: number }

type NormalisedCandle = Candle & { open: number; high: number; low: number; close: number; volume: number }

type PatternSignal = {
  action: string
  bias: PatternBias
  explanation: string
  index: number
  kind: 'Single candle' | 'Multi candle'
  name: string
  stopHint: string
}

type ReasoningStep = {
  title: string
  plainEnglish: string
  formula: string
  rationale: string
  takeaway: string
}

type SignalGroup = 'Technical' | 'Fundamental' | 'Statements' | 'News' | 'Risk' | 'Process'

type AdaptiveSignal = {
  group: SignalGroup
  label: string
  value: string
  score: number
  weight: number
  tone: SignalTone
  rationale: string
}

type ScoreComponent = {
  label: string
  score: number
  weight: number
  tone: SignalTone
  rationale: string
}

type TradingLesson = {
  module: 'Process' | 'Sector' | 'Instrument' | 'Capital'
  title: string
  tone: SignalTone
  text: string
  action: string
}

type SectorRule = (typeof sectorOperatingRules)[number]

type SyncCoverage = {
  technicalLoaded: string[]
  technicalMissing: string[]
  fundamentalsLoaded: string[]
  fundamentalsMissing: string[]
}

type MissingDataIssueAction = 'mapping' | 'retry' | 'unsupported'

type MissingDataIssue = {
  action: MissingDataIssueAction
  errors: string[]
  fundamentalsMissing: boolean
  reason: string
  suggestion: string
  symbol: string
  technicalMissing: boolean
}

type SymbolMappingDraft = {
  name: string
  screener: string
  yahoo: string
}

type MappingSaveState = 'idle' | 'saving' | 'done' | 'error'

type LlmReview = {
  headline?: string
  plainEnglishVerdict?: string
  whatToDoNext?: string[]
  whatNotToDo?: string[]
  keyEvidence?: string[]
  practicalPrinciples?: string[]
  riskPlan?: string[]
  dataGaps?: string[]
  questionsBeforeAction?: string[]
  confidenceNote?: string
}

type LlmVerdictResponse = {
  ok?: boolean
  configured?: boolean
  scope?: AiCoachScope
  message?: string
  setup?: string[]
  model?: string
  generated_at?: string
  review?: LlmReview
  error?: string
}

type BrowserWorkspace = {
  version: 1
  snapshot: Snapshot
  form: AnalysisForm
  days: number
}

type ForecastSettings = {
  enabled: boolean
  horizon: ForecastHorizon
  mode: ForecastMode
  volatilityMultiplier: string
  trendWeight: string
  fundamentalGrowth: string
  valuationShift: string
  customBearAnnualReturn: string
  customBaseAnnualReturn: string
  customBullAnnualReturn: string
  eventRisk: EventRisk
}

type ForecastPoint = {
  label: string
  price: number
  progress: number
}

type ForecastCase = {
  key: 'bear' | 'base' | 'bull'
  label: string
  tone: SignalTone
  endPrice: number
  endReturn: number
  annualReturn: number
  points: ForecastPoint[]
  rationale: string
}

type ForecastProjection = {
  assumptions: string[]
  confidence: string
  horizon: ForecastHorizon
  horizonLabel: string
  mode: ForecastMode
  modeLabel: string
  rangeLabel: string
  tradingDays: number
  years: number
  cases: ForecastCase[]
}

type MarketQuote = {
  last_price?: number
  last_trade_time?: string
  volume?: number
  average_price?: number
  net_change?: number
  lower_circuit_limit?: number
  upper_circuit_limit?: number
  ohlc?: {
    open?: number
    high?: number
    low?: number
    close?: number
  }
}

type Holding = {
  tradingsymbol?: string
  exchange?: string
  isin?: string
  sector?: string
  quantity?: number
  average_price?: number
  bought_on?: string | null
  last_price?: number
  pnl?: number
  product?: string
  resolved_from_exchange?: string
}

type CompanyFundamentals = {
  name?: string
  currency?: string
  exchange_name?: string
  sector?: string
  industry?: string
  website?: string
  country?: string
  employees?: number
  business_summary?: string
  market_cap?: number
  enterprise_value?: number
  trailing_pe?: number
  forward_pe?: number
  price_to_book?: number
  book_value?: number
  dividend_yield?: number
  profit_margins?: number
  gross_margins?: number
  ebitda_margins?: number
  operating_margins?: number
  return_on_equity?: number
  return_on_assets?: number
  roce?: number
  debt_to_equity?: number
  current_ratio?: number
  total_debt?: number
  total_cash?: number
  operating_cashflow?: number
  free_cashflow?: number
  revenue?: number
  net_profit?: number
  revenue_growth?: number
  earnings_growth?: number
  key_points?: string
  meta_description?: string
  top_ratios?: Record<string, string>
  pros?: string[]
  cons?: string[]
  company_updates?: Array<{
    title: string
    summary?: string
    date?: string
    url?: string
    category?: string
    tone?: SignalTone
  }>
  statement_summary?: Record<string, { metric?: string; period?: string; value?: string; numeric?: number }>
  statement_tables?: Record<string, { periods: string[]; rows: Array<{ metric: string; values: Array<{ period: string; value: string; numeric?: number }> }> }>
  source_url?: string
  source?: string
}

type Snapshot = {
  provider: string
  generated_at: string
  symbols: Array<{
    input: string
    exchange: string
    tradingsymbol: string
    instrument_token?: string
    instrument_type?: string
    kite_key: string
    name?: string
    segment?: string
    fundamentals_applicable?: boolean
    screener?: string
    unsupported_reason?: string
    yahoo?: string
  }>
  quotes: Record<string, MarketQuote>
  candles: Record<string, Candle[]>
  fundamentals?: Record<string, CompanyFundamentals>
  holdings: Holding[]
  errors: string[]
  upload?: {
    filename: string
    holdings_count: number
    symbols: string[]
  }
}

type ConstraintKey = 'avoidHighDebt' | 'avoidSmallCaps' | 'avoidLowLiquidity' | 'avoidIntraday' | 'noAveragingDown'

type AnalysisForm = {
  ticker: string
  exchange: Exchange
  capital: string
  horizon: Horizon
  alreadyHold: boolean
  boughtOn: string
  quantity: string
  averagePrice: string
  maxRisk: string
  riskMode: RiskMode
  riskProfile: RiskProfile
  tradeAccess: TradeAccess
  invalidationPrice: string
  targetPrice: string
  manualLtp: string
  marketCapCr: string
  debtEquity: string
  roce: string
  pe: string
  profitTrend: ProfitTrend
  thesis: string
  constraints: Record<ConstraintKey, boolean>
}

type AnalysisResult = {
  verdict: string
  verdictClass: 'needs-data' | 'avoid' | 'reduce' | 'watch' | 'hold' | 'buy'
  decisionMode: 'fresh-entry' | 'holding-review'
  score: number
  confidence: number
  confidenceLabel: string
  quoteKey: string
  ltp?: number
  positionPnl?: number
  positionPnlPct?: number
  portfolioWeight?: number
  riskCapital?: number
  defaultRiskPercent?: number
  capitalShares?: number
  starterShares?: number
  suggestedShares?: number
  suggestedDeployment?: number
  suggestedQuantityLabel: string
  entryPlan: string
  exitPlan: string
  missing: string[]
  actions: string[]
  positives: string[]
  cautions: string[]
  doItems: string[]
  dontItems: string[]
  whyItems: string[]
  steps: ReasoningStep[]
  adaptiveSignals: AdaptiveSignal[]
  scoreComponents: ScoreComponent[]
  tradingLessons: TradingLesson[]
}

const starterSnapshot: Snapshot = {
  provider: 'starter_workspace',
  generated_at: new Date().toISOString(),
  symbols: [],
  quotes: {},
  candles: {},
  fundamentals: {},
  holdings: [],
  errors: [],
}

const emptyCandles: Candle[] = []

const initialForm: AnalysisForm = {
  ticker: '',
  exchange: 'NSE',
  capital: '',
  horizon: '1-3y',
  alreadyHold: false,
  boughtOn: '',
  quantity: '',
  averagePrice: '',
  maxRisk: '2.5',
  riskMode: 'percent',
  riskProfile: 'balanced_aggressive',
  tradeAccess: 'hedging',
  invalidationPrice: '',
  targetPrice: '',
  manualLtp: '',
  marketCapCr: '',
  debtEquity: '',
  roce: '',
  pe: '',
  profitTrend: 'unknown',
  thesis: '',
  constraints: {
    avoidHighDebt: true,
    avoidSmallCaps: true,
    avoidLowLiquidity: true,
    avoidIntraday: true,
    noAveragingDown: true,
  },
}

const browserWorkspaceKey = 'verdict-workstation:browser-workspace:v1'

function readBrowserWorkspace(): BrowserWorkspace | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(browserWorkspaceKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BrowserWorkspace>
    if (parsed.version !== 1 || !parsed.snapshot || !Array.isArray(parsed.snapshot.holdings)) return null
    const upload = parsed.snapshot.upload
    const holdings = upload ? (parsed.snapshot.holdings ?? []) : []
    return {
      version: 1,
      snapshot: {
        ...starterSnapshot,
        ...parsed.snapshot,
        holdings,
        upload,
        quotes: parsed.snapshot.quotes ?? {},
        candles: parsed.snapshot.candles ?? {},
        fundamentals: parsed.snapshot.fundamentals ?? {},
        errors: parsed.snapshot.errors ?? [],
      },
      form: { ...initialForm, ...(parsed.form ?? {}) },
      days: typeof parsed.days === 'number' && Number.isFinite(parsed.days) ? parsed.days : 730,
    }
  } catch {
    return null
  }
}

function writeBrowserWorkspace(workspace: BrowserWorkspace) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(browserWorkspaceKey, JSON.stringify(workspace))
  } catch {
    // Browser storage can be disabled or full; the app should still work for the current session.
  }
}

const riskProfileLabels: Record<RiskProfile, string> = {
  conservative: 'Conservative',
  balanced: 'Balanced',
  balanced_aggressive: 'Balanced + aggressive',
  aggressive: 'Aggressive',
}

const horizonLabels: Record<Horizon, string> = {
  '3-6m': '3-6 months',
  '6-12m': '6-12 months',
  '1-3y': '1-3 years',
  '3y+': '3+ years',
}

const tradeAccessLabels: Record<TradeAccess, string> = {
  delivery: 'Delivery only',
  fo_context: 'F&O context',
  hedging: 'Hedging allowed',
}

const profitTrendLabels: Record<ProfitTrend, string> = {
  unknown: 'Unknown',
  growing: 'Growing',
  stable: 'Stable',
  declining: 'Declining',
  loss_making: 'Loss making',
}

const constraintLabels: Array<{ key: ConstraintKey; label: string; help: string }> = [
  { key: 'avoidHighDebt', label: 'Avoid high debt', help: 'Penalises companies with debt/equity above your comfort zone.' },
  { key: 'avoidSmallCaps', label: 'Avoid small caps', help: 'Penalises lower market-cap companies because exits and disclosure quality can be weaker.' },
  { key: 'avoidLowLiquidity', label: 'Avoid low liquidity', help: 'Penalises thinly traded stocks where entry/exit slippage can hurt returns.' },
  { key: 'avoidIntraday', label: 'No intraday or swing', help: 'Keeps the guidance focused on delivery and non-intraday analysis.' },
  { key: 'noAveragingDown', label: 'No averaging losers', help: 'Warns against adding to losing positions unless the thesis has been freshly proven.' },
]

const chartTimeframes: Record<ChartTimeframe, { label: string; candles?: number }> = {
  '1D': { label: '1D', candles: 1 },
  '1M': { label: '1M', candles: 22 },
  '3M': { label: '3M', candles: 66 },
  '6M': { label: '6M', candles: 132 },
  '1Y': { label: '1Y', candles: 252 },
  ALL: { label: 'All' },
}

const forecastHorizons: Record<ForecastHorizon, { label: string; tradingDays: number; years: number }> = {
  '5D': { label: 'Next 5 days', tradingDays: 5, years: 5 / 252 },
  '15D': { label: 'Next 15 days', tradingDays: 15, years: 15 / 252 },
  '1M': { label: 'Next 1 month', tradingDays: 22, years: 22 / 252 },
  '6M': { label: 'Next 6 months', tradingDays: 126, years: 0.5 },
  '1Y': { label: 'Next 1 year', tradingDays: 252, years: 1 },
  '3Y': { label: 'Next 3 years', tradingDays: 756, years: 3 },
  '5Y': { label: 'Next 5 years', tradingDays: 1260, years: 5 },
  '10Y': { label: 'Next 10 years', tradingDays: 2520, years: 10 },
}

const forecastModeLabels: Record<ForecastMode, { label: string; help: string }> = {
  adaptive: {
    label: 'Adaptive hybrid',
    help: 'Blends chart behaviour, business quality, valuation, event risk, and the current price setup. Best default for sensible ranges.',
  },
  technical: {
    label: 'Technical range',
    help: 'Uses recent trend, ATR/volatility, momentum, and support/resistance style evidence. More useful for short horizons.',
  },
  fundamental: {
    label: 'Fundamental valuation',
    help: 'Uses growth, valuation rerating, ROCE/quality, debt, and statement evidence. More useful for 1 year and longer horizons.',
  },
  custom: {
    label: 'Custom scenario',
    help: 'Uses your own annual bear/base/bull return assumptions while still showing confidence and risk context.',
  },
}

const eventRiskLabels: Record<EventRisk, string> = {
  low: 'Low event risk',
  normal: 'Normal event risk',
  high: 'High event risk',
}

const initialForecastSettings: ForecastSettings = {
  enabled: false,
  horizon: '1M',
  mode: 'adaptive',
  volatilityMultiplier: '1.0',
  trendWeight: '55',
  fundamentalGrowth: '',
  valuationShift: '0',
  customBearAnnualReturn: '-10',
  customBaseAnnualReturn: '12',
  customBullAnnualReturn: '25',
  eventRisk: 'normal',
}

const indicatorLabels: Record<IndicatorKey, { label: string; help: string }> = {
  sma20: { label: 'SMA 20', help: 'Shorter moving average. It shows the recent trend and reacts faster to price changes.' },
  sma50: { label: 'SMA 50', help: 'Medium moving average. It helps separate temporary noise from a broader trend.' },
  sma100: { label: 'SMA 100', help: 'Slower trend average. Useful for positional trend health and major mean-reversion zones.' },
  sma200: { label: 'SMA 200', help: 'Long-term trend average. Price above it usually signals a healthier long-term structure.' },
  ema20: { label: 'EMA 20', help: 'Faster average that gives more weight to recent closes. Useful for active trend following.' },
  ema50: { label: 'EMA 50', help: 'Medium exponential average. Useful for trend pullbacks and smoother direction checks.' },
  vwap: { label: 'VWAP', help: 'Volume-weighted average price over the displayed window. Price above it suggests buyers paid higher average prices.' },
  bbands: { label: 'Bollinger', help: '20-period average with volatility bands. Wide bands mean expansion; narrow bands mean compression.' },
  volume: { label: 'Volume', help: 'Shows traded shares below price. Thin volume makes exits harder and raises slippage risk.' },
  range: { label: 'Range', help: 'Marks the current chart high and low so support and resistance zones are easier to see.' },
  rsi: { label: 'RSI 14', help: 'Momentum oscillator from 0 to 100. Above 70 is strong/overbought; below 30 is weak/oversold, depending on trend.' },
  macd: { label: 'MACD', help: 'Trend momentum from EMA 12 minus EMA 26, compared with a 9-period signal line.' },
  atr: { label: 'ATR 14', help: 'Average true range. It measures volatility and helps estimate practical stop-loss distance.' },
  patterns: { label: 'Patterns', help: 'Marks recent single and multi-candle reversal/strength patterns. Context and volume still matter.' },
}
// Common overlays lead the row; the rest of indicatorLabels follows in one flat list.
const commonIndicatorKeys: IndicatorKey[] = ['volume', 'range', 'patterns', 'sma20', 'ema20']
const allIndicatorKeys: IndicatorKey[] = commonIndicatorKeys.concat(
  (Object.keys(indicatorLabels) as IndicatorKey[]).filter((key) => !commonIndicatorKeys.includes(key)),
)

const requiredHelp = {
  ticker: 'Company symbol to analyse. It controls which quote, candles, and holding row the app matches.',
  exchange: 'NSE or BSE route for the ticker. The wrong exchange can fetch the wrong security or no data.',
  capital:
    'For a new position, this is the cash you are willing to deploy and is required for sizing. It should be deployable market capital only, not emergency money, fixed-goal money, or retirement-style capital. For an existing holding, it is optional fresh/additional capital only if you are considering adding more.',
  horizon: 'Your intended holding period. Longer horizons give more weight to fundamentals and less to short-term noise.',
  alreadyHold: 'Buy analyses a new position. Sell reviews an existing holding and enables quantity, average price, P&L, and portfolio-weight logic.',
  boughtOn: 'Reference date for your original entry. It is useful context for reviewing whether the thesis has had enough time to work.',
  quantity: 'Current number of shares. It drives current value, P&L, portfolio concentration, and exposure risk.',
  averagePrice: 'Your average buy price. It is used to calculate unrealized gain/loss and breakeven recovery needed.',
  riskProfile: 'Adjusts how strict the verdict is. Conservative penalises risk more; aggressive allows more risk but still requires evidence.',
  marketAccess: 'Tells the app whether to stay delivery-only or mention F&O only as context/hedging.',
  maxRisk:
    'Maximum fresh loss you are willing to take on this idea. It is needed for new entry sizing or add-more sizing, but not required just to review an existing holding.',
  riskUnit: 'Choose whether max risk is a percentage of deployable capital or a fixed rupee amount.',
}

const optionalHelp = {
  manualLtp: 'Overrides cached price when you want to analyse from a specific current or planned entry price.',
  invalidationPrice: 'The price where the thesis is considered wrong. Required for proper risk-based sizing.',
  targetPrice: 'Expected upside price. Used with invalidation to calculate reward/risk.',
  marketCapCr: 'Manual override only. Normally this is auto-filled from refreshed company data; type here only when data is missing or you want to test a scenario.',
  debtEquity: 'Manual override only. Normally this is auto-filled from company fundamentals; use this when fetched debt data is missing or clearly stale.',
  roce: 'Manual override only. Normally this is auto-filled from fundamentals. Higher ROCE usually means the business uses capital more efficiently.',
  pe: 'Manual override only. Normally this comes from fetched valuation data. Very high P/E can mean expensive; very low P/E can mean cyclicality or hidden risk.',
  profitTrend: 'Manual override only. Use this when fetched statements are unavailable or you want to force a conservative scenario.',
  constraints: 'Personal rules. Enabled filters penalise companies or setups that violate your preferences.',
  thesis: 'Your notes do not change numbers automatically yet, but they keep the decision checklist anchored to your actual investment reason.',
  holdingsRefresh:
    'When checked, sync refreshes every listed ticker from the uploaded holdings file along with the current decision ticker. Your imported portfolio table stays loaded either way.',
}

const verdictLogicHelp =
  'Unavailable numbers are not guessed. Missing required inputs pause the decision; optional gaps lower confidence or add caution. The verdict combines chart behaviour, business quality, statements, updates, portfolio exposure, risk plan, horizon, and your personal filters.'

const forecastHelp = {
  horizon: 'How far into the future the scenario range should extend. Short horizons rely more on volatility and technicals; long horizons rely more on fundamentals and valuation assumptions.',
  mode: 'Adaptive blends technicals and fundamentals. Technical focuses on chart and volatility. Fundamental focuses on business growth and valuation. Custom uses your own bear/base/bull return assumptions.',
  volatilityMultiplier: 'Controls the width of the bear-to-bull range. Raise it for uncertain or news-sensitive stocks; lower it for stable, liquid stocks.',
  trendWeight: 'How much recent price trend should influence the central path. Higher values make the forecast follow recent momentum more strongly.',
  fundamentalGrowth: 'Expected annual business growth. Leave blank to use fetched revenue/earnings growth when available, with a conservative fallback.',
  valuationShift: 'Expected valuation re-rating over the full selected horizon. Positive means market pays a higher multiple; negative means multiple compression.',
  eventRisk: 'Adjusts forecast range width and price caution for pending results, leadership changes, orders, regulation, litigation, or other company events.',
  customBearAnnualReturn: 'Your annualized downside assumption for custom mode. Use this to model a specific bear thesis.',
  customBaseAnnualReturn: 'Your annualized central return assumption for custom mode. This becomes the custom base case.',
  customBullAnnualReturn: 'Your annualized upside assumption for custom mode. Use this to model a strong execution or re-rating case.',
}

function HelpTip({ text }: { text: string }) {
  // Anchor the fixed-position tooltip to this dot and flip it below when the
  // dot sits too close to the top of the viewport for the bubble to fit above.
  function placeTip(event: { currentTarget: HTMLElement }) {
    const dot = event.currentTarget
    const rect = dot.getBoundingClientRect()
    const showBelow = rect.top < 320
    dot.dataset.tipPos = showBelow ? 'below' : 'above'
    dot.style.setProperty('--tip-x', `${rect.left + rect.width / 2}px`)
    dot.style.setProperty('--tip-y', `${showBelow ? rect.bottom + 10 : rect.top - 10}px`)
  }

  return (
    <span
      className="help-tip"
      data-tip={text}
      tabIndex={0}
      aria-label={text}
      onFocus={placeTip}
      onPointerEnter={placeTip}
    >
      ?
    </span>
  )
}

function FieldLabel({ children, help }: { children: string; help: string }) {
  return (
    <span className="field-label">
      {children}
      <HelpTip text={help} />
    </span>
  )
}

function CollapsibleSection({
  action,
  bodyClassName = 'collapsible-body',
  children,
  className,
  defaultOpen = false,
  description,
  eyebrow,
  headingClassName = 'panel-heading',
  headingLevel = 2,
  id,
  staticOpen = false,
  title,
  titleAddon,
}: {
  action?: ReactNode
  bodyClassName?: string
  children: ReactNode
  className: string
  defaultOpen?: boolean
  description?: string
  eyebrow?: string
  headingClassName?: string
  headingLevel?: 2 | 3 | 4
  id: string
  staticOpen?: boolean
  title: string
  titleAddon?: ReactNode
}) {
  const [openState, setOpenState] = useState({ id, isOpen: defaultOpen })
  const isOpen = staticOpen ? true : openState.id === id ? openState.isOpen : defaultOpen
  const HeadingTag = headingLevel === 3 ? 'h3' : headingLevel === 4 ? 'h4' : 'h2'
  const bodyId = `${id}-body`

  return (
    <section className={`${className} collapsible-section ${staticOpen ? 'static-section' : ''} ${isOpen ? 'is-open' : 'is-collapsed'}`} aria-labelledby={id}>
      <div className={`${headingClassName} collapsible-heading`}>
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <HeadingTag id={id}>
            {staticOpen ? (
              <span className="static-section-title title-with-addon">
                {title}
                {titleAddon}
              </span>
            ) : (
              <button
                className="collapse-title-button"
                type="button"
                aria-controls={bodyId}
                aria-expanded={isOpen}
                onClick={() => {
                  const nextOpen = !isOpen
                  setOpenState({ id, isOpen: nextOpen })
                  if (nextOpen) {
                    // Keep the newly opened section's heading in view instead of forcing the reader to scroll back.
                    window.requestAnimationFrame(() => {
                      document.getElementById(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
                    })
                  }
                }}
              >
                <span className="collapse-icon" aria-hidden="true">
                  {isOpen ? '-' : '+'}
                </span>
                <span className="title-with-addon">
                  {title}
                  {titleAddon}
                </span>
              </button>
            )}
          </HeadingTag>
          {description && <p className="collapse-description">{description}</p>}
        </div>
        {action && <div className="collapsible-action">{action}</div>}
      </div>

      {isOpen && (
        <div className={bodyClassName} id={bodyId}>
          {children}
        </div>
      )}
    </section>
  )
}

function reviewItems(items?: string[]) {
  return Array.isArray(items) ? items.filter((item) => item.trim()) : []
}

function AiReviewListCard({
  emptyLabel,
  items,
  title,
  tone = 'neutral',
}: {
  emptyLabel: string
  items?: string[]
  title: string
  tone?: SignalTone
}) {
  const filteredItems = reviewItems(items)
  return (
    <article className={`ai-review-card tone-${tone}`}>
      <span>{title}</span>
      {filteredItems.length ? (
        <ul>
          {filteredItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{emptyLabel}</p>
      )}
    </article>
  )
}

function SymbolCoverageList({ emptyLabel, items, tone }: { emptyLabel: string; items: string[]; tone: SignalTone }) {
  if (!items.length) {
    return <span className="coverage-empty">{emptyLabel}</span>
  }
  return (
    <div className="coverage-chip-list">
      {items.map((symbol) => (
        <span className={`coverage-chip tone-${tone}`} key={symbol}>
          {symbol}
        </span>
      ))}
    </div>
  )
}

function SyncCoveragePanel({ coverage }: { coverage: SyncCoverage }) {
  const technicalMissing = coverage.technicalMissing.filter((symbol) => !isUnsupportedCoverageSymbol(symbol))
  const fundamentalsMissing = coverage.fundamentalsMissing.filter((symbol) => !isUnsupportedCoverageSymbol(symbol))
  const excludedSymbols = uniqueSymbols(
    [...coverage.technicalMissing, ...coverage.fundamentalsMissing].filter((symbol) => isUnsupportedCoverageSymbol(symbol)),
  )
  return (
    <div className="sync-coverage-panel">
      <div className="sync-coverage-heading">
        <span>Sync coverage</span>
        <small>Technical means quote plus candle history. Fundamentals means company profile/ratios/statements data was loaded. Unlisted or ISIN-only rows stay in the portfolio but are excluded from listed-stock analysis.</small>
      </div>
      <div className="coverage-grid">
        <article className="coverage-card">
          <div className="coverage-card-title">
            <span>Technical data loaded</span>
            <strong>{coverage.technicalLoaded.length}</strong>
          </div>
          <SymbolCoverageList emptyLabel="No technical data loaded yet." items={coverage.technicalLoaded} tone="positive" />
        </article>
        <article className="coverage-card">
          <div className="coverage-card-title">
            <span>Technical still missing</span>
            <strong>{technicalMissing.length}</strong>
          </div>
          <SymbolCoverageList emptyLabel="None missing." items={technicalMissing} tone="negative" />
        </article>
        <article className="coverage-card">
          <div className="coverage-card-title">
            <span>Fundamentals loaded</span>
            <strong>{coverage.fundamentalsLoaded.length}</strong>
          </div>
          <SymbolCoverageList emptyLabel="No fundamentals loaded yet." items={coverage.fundamentalsLoaded} tone="positive" />
        </article>
        <article className="coverage-card">
          <div className="coverage-card-title">
            <span>Fundamentals still missing</span>
            <strong>{fundamentalsMissing.length}</strong>
          </div>
          <SymbolCoverageList emptyLabel="None missing." items={fundamentalsMissing} tone="neutral" />
        </article>
        <article className="coverage-card">
          <div className="coverage-card-title">
            <span>Excluded from analysis</span>
            <strong>{excludedSymbols.length}</strong>
          </div>
          <SymbolCoverageList emptyLabel="No unlisted or unsupported rows." items={excludedSymbols} tone="neutral" />
        </article>
      </div>
    </div>
  )
}

function MissingDataResolverPanel({
  drafts,
  issues,
  mappingState,
  mappingStatus,
  onDraftChange,
  onMarkUnsupported,
  onRetryMissing,
  onSaveMapping,
  retryDisabled,
}: {
  drafts: Record<string, SymbolMappingDraft>
  issues: MissingDataIssue[]
  mappingState: MappingSaveState
  mappingStatus: string
  onDraftChange: (symbol: string, field: keyof SymbolMappingDraft, value: string) => void
  onMarkUnsupported: (symbol: string) => void
  onRetryMissing: () => void
  onSaveMapping: (symbol: string) => void
  retryDisabled: boolean
}) {
  if (!issues.length) return null
  const retryableCount = issues.filter((issue) => issue.action !== 'unsupported').length
  return (
    <div className="missing-data-panel">
      <div className="sync-coverage-heading">
        <span>Missing Data Resolver</span>
        <small>
          Use this when a symbol did not return quote/candle history or Screener fundamentals. Mapped symbols are saved on your data bridge
          and used for future portfolio uploads.
        </small>
      </div>
      <div className="resolver-toolbar">
        <button type="button" onClick={onRetryMissing} disabled={retryDisabled || retryableCount === 0}>
          Retry Missing Only
        </button>
        <span>{retryableCount} retryable symbols</span>
      </div>
      {mappingStatus && <p className={`resolver-status ${mappingState}`}>{mappingStatus}</p>}
      <div className="missing-issue-list">
        {issues.map((issue) => {
          const draft = drafts[issue.symbol] ?? mappingDraftForSymbol({ ...starterSnapshot, symbols: [], errors: [], holdings: [] }, issue.symbol)
          return (
            <article className={`missing-issue-card tone-${issue.action === 'unsupported' ? 'neutral' : issue.action === 'mapping' ? 'negative' : 'positive'}`} key={issue.symbol}>
              <div className="missing-issue-header">
                <div>
                  <strong>{issue.symbol}</strong>
                  <span>{issue.action === 'unsupported' ? 'Unsupported or unlisted' : issue.action === 'mapping' ? 'Needs symbol mapping' : 'Retry candidate'}</span>
                </div>
                <div className="coverage-chip-list">
                  {issue.technicalMissing && <span className="coverage-chip tone-negative">Technical missing</span>}
                  {issue.fundamentalsMissing && <span className="coverage-chip tone-neutral">Fundamentals missing</span>}
                </div>
              </div>
              <p>{issue.reason}</p>
              <p className="issue-suggestion">{issue.suggestion}</p>
              {issue.action === 'unsupported' ? (
                <div className="resolver-actions">
                  <button className="secondary-action" type="button" onClick={() => onMarkUnsupported(issue.symbol)}>
                    Remove From Sync List
                  </button>
                </div>
              ) : (
                <>
                  <div className="mapping-grid">
                    <label className="field compact">
                      Yahoo code
                      <input value={draft.yahoo} placeholder="Example: TCS.NS" onChange={(event) => onDraftChange(issue.symbol, 'yahoo', event.target.value)} />
                    </label>
                    <label className="field compact">
                      Screener code
                      <input value={draft.screener} placeholder="Example: TCS" onChange={(event) => onDraftChange(issue.symbol, 'screener', event.target.value)} />
                    </label>
                    <label className="field compact">
                      Company name
                      <input value={draft.name} placeholder="Optional" onChange={(event) => onDraftChange(issue.symbol, 'name', event.target.value)} />
                    </label>
                  </div>
                  <div className="resolver-actions">
                    <button type="button" onClick={() => onSaveMapping(issue.symbol)} disabled={mappingState === 'saving'}>
                      {mappingState === 'saving' ? 'Saving...' : 'Save Mapping'}
                    </button>
                  </div>
                </>
              )}
              {issue.errors.length > 1 && (
                <details className="resolver-error-details">
                  <summary>Show technical warnings</summary>
                  {issue.errors.slice(0, 4).map((error) => (
                    <code key={error}>{compactSyncError(error, issue.symbol)}</code>
                  ))}
                </details>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}

function numberFrom(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[,%₹\s]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseNumber(value: string | number | undefined) {
  return numberFrom(value)
}

function formatInr(value?: number | string) {
  const numeric = numberFrom(value)
  if (numeric === undefined) return '-'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: Math.abs(numeric) < 100 ? 2 : 0,
  }).format(numeric)
}

function formatNumber(value?: number | string) {
  const numeric = numberFrom(value)
  if (numeric === undefined) return '-'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(numeric)
}

function formatLargeInr(value?: number | string) {
  const numeric = numberFrom(value)
  if (numeric === undefined) return '-'
  const abs = Math.abs(numeric)
  if (abs >= 10000000) return `${formatNumber(numeric / 10000000)} cr`
  if (abs >= 100000) return `${formatNumber(numeric / 100000)} lakh`
  return formatInr(numeric)
}

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatDecimalPercent(value?: number | string) {
  const numeric = numberFrom(value)
  if (numeric === undefined) return '-'
  return `${(numeric * 100).toFixed(2)}%`
}

function formatPlainPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) return '-'
  return `${Math.abs(value).toFixed(2)}%`
}

function cacheAge(generatedAt: string) {
  const generated = new Date(generatedAt).getTime()
  if (Number.isNaN(generated)) return 'Unknown'
  const minutes = Math.max(0, Math.round((Date.now() - generated) / 60000))
  if (minutes < 60) return `${minutes} min`
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr`
  return `${Math.round(minutes / 1440)} days`
}

function cacheLabel(cacheState: CacheState) {
  if (cacheState === 'free') return 'Market data'
  if (cacheState === 'live') return 'Connected data'
  if (cacheState === 'loading') return 'Loading data'
  return 'Sample data'
}

function marketDataBaseUrl() {
  const configured = import.meta.env.VITE_MARKET_DATA_BASE_URL
  if (configured) return configured.replace(/\/$/, '')
  const hostname = window.location.hostname || '127.0.0.1'
  const normalizedHost = hostname.toLowerCase()
  const isLocalBridgeHost =
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost === '0.0.0.0' ||
    normalizedHost === '::1' ||
    normalizedHost.endsWith('.local') ||
    /^10\./.test(normalizedHost) ||
    /^192\.168\./.test(normalizedHost) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalizedHost)
  if (window.location.protocol === 'https:' && !isLocalBridgeHost) return ''
  const apiHost = hostname === 'localhost' ? '127.0.0.1' : hostname
  return `http://${apiHost}:8787`
}

function apiUrl(baseUrl: string, path: string) {
  if (!baseUrl) return path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

function cacheStateFromProvider(provider: string): CacheState {
  if (provider.startsWith('free_')) return 'free'
  if (provider.includes('starter')) return 'sample'
  if (provider.includes('sample')) return 'sample'
  return 'live'
}

function filledFundamentalsRecordCount(fundamentals?: Record<string, CompanyFundamentals>) {
  return Object.values(fundamentals ?? {}).filter((row) => Object.keys(row ?? {}).length > 0).length
}

function filledFundamentalsCount(snapshot: Snapshot) {
  return filledFundamentalsRecordCount(snapshot.fundamentals)
}

function holdingKey(holding: Holding) {
  const exchange = String(holding.exchange ?? '').trim().toUpperCase()
  const tradingsymbol = String(holding.tradingsymbol ?? '').trim().toUpperCase()
  return exchange && tradingsymbol ? `${exchange}:${tradingsymbol}` : ''
}

function dateInputValue(value?: string | null) {
  if (!value) return ''
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : ''
}

function uniqueSymbols(values: Array<string | undefined>) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const clean = (value ?? '').trim().toUpperCase()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    output.push(clean)
  }
  return output
}

function decisionInputSymbol(form: AnalysisForm) {
  const ticker = form.ticker.trim().toUpperCase()
  if (!ticker) return ''
  if (ticker.startsWith('^') || ticker.includes(':')) return ticker
  return `${form.exchange}:${ticker}`
}

function portfolioSymbolsForSync(snapshot: Snapshot) {
  const uploadSymbols = snapshot.upload?.symbols ?? []
  if (uploadSymbols.length) return uniqueSymbols(uploadSymbols)
  return uniqueSymbols(
    snapshot.holdings
      .map(holdingKey)
      .filter((key) => key && !key.startsWith('UNLISTED:')),
  )
}

function mergeHoldingsPrices(holdings: Holding[], quotes: Record<string, MarketQuote>) {
  return holdings.map((holding) => {
    const key = holdingKey(holding)
    const quote = key ? quotes[key] : undefined
    if (!quote || quote.last_price === undefined || quote.last_price === null) return holding
    const quantity = holding.quantity ?? 0
    const averagePrice = holding.average_price ?? 0
    const lastPrice = quote.last_price
    return {
      ...holding,
      last_price: lastPrice,
      pnl: quantity * lastPrice - quantity * averagePrice,
    }
  })
}

function quotedHoldingsCount(snapshot: Snapshot) {
  return snapshot.holdings.filter((holding) => Boolean(snapshot.quotes[holdingKey(holding)])).length
}

function hasTechnicalData(snapshot: Snapshot, symbol: string) {
  return Boolean(snapshot.quotes[symbol]) && (snapshot.candles[symbol]?.length ?? 0) > 0
}

function hasFundamentalData(snapshot: Snapshot, symbol: string) {
  return Object.keys(snapshot.fundamentals?.[symbol] ?? {}).length > 0
}

function symbolMetadata(snapshot: Snapshot, symbol: string) {
  const normalized = symbol.trim().toUpperCase()
  return snapshot.symbols.find((row) => (row.kite_key || row.input).trim().toUpperCase() === normalized)
}

function fundamentalsApplicable(snapshot: Snapshot, symbol: string) {
  const row = symbolMetadata(snapshot, symbol)
  if (row?.fundamentals_applicable === false) return false
  if (row?.instrument_type === 'INDEX' || row?.exchange === 'INDEX') return false
  return !symbol.trim().toUpperCase().startsWith('INDEX:')
}

function hasAnyMarketData(snapshot: Snapshot, symbol: string) {
  return hasTechnicalData(snapshot, symbol) || hasFundamentalData(snapshot, symbol)
}

function symbolTradingsymbol(symbol: string) {
  const [, ...rest] = symbol.trim().toUpperCase().split(':')
  return rest.length ? rest.join(':') : symbol.trim().toUpperCase()
}

function coverageAliasMap(snapshot: Snapshot) {
  const aliases = new Map<string, string>()
  for (const row of snapshot.symbols) {
    const canonical = (row.kite_key || row.input || '').trim().toUpperCase()
    const input = (row.input || '').trim().toUpperCase()
    const tradingsymbol = (row.tradingsymbol || '').trim().toUpperCase()
    if (!canonical) continue
    if (input && input !== canonical) aliases.set(input, canonical)
    if (tradingsymbol && row.exchange !== 'AUTO') aliases.set(`AUTO:${tradingsymbol}`, canonical)
    if (tradingsymbol && row.exchange === 'UNLISTED') {
      aliases.set(`NSE:${tradingsymbol}`, canonical)
      aliases.set(`BSE:${tradingsymbol}`, canonical)
    }
  }
  for (const holding of snapshot.holdings) {
    const canonical = holdingKey(holding)
    const originalExchange = String(holding.resolved_from_exchange ?? '').trim().toUpperCase()
    const tradingsymbol = String(holding.tradingsymbol ?? '').trim().toUpperCase()
    if (canonical && originalExchange && tradingsymbol) aliases.set(`${originalExchange}:${tradingsymbol}`, canonical)
  }
  return aliases
}

function loadedSymbolByTradingsymbol(snapshot: Snapshot) {
  const loaded = new Map<string, string>()
  const candidates = [
    ...Object.keys(snapshot.quotes),
    ...Object.keys(snapshot.candles),
    ...Object.keys(snapshot.fundamentals ?? {}).filter((symbol) => hasFundamentalData(snapshot, symbol)),
  ]
  for (const symbol of candidates) {
    if (!hasAnyMarketData(snapshot, symbol)) continue
    const tradingsymbol = symbolTradingsymbol(symbol)
    if (!loaded.has(tradingsymbol) || hasTechnicalData(snapshot, symbol)) loaded.set(tradingsymbol, symbol)
  }
  return loaded
}

function canonicalCoverageSymbol(snapshot: Snapshot, symbol: string, aliases: Map<string, string>, loadedBySymbol: Map<string, string>) {
  const normalized = symbol.trim().toUpperCase()
  const directAlias = aliases.get(normalized)
  if (directAlias && (hasAnyMarketData(snapshot, directAlias) || !hasAnyMarketData(snapshot, normalized))) return directAlias
  if (!hasAnyMarketData(snapshot, normalized)) {
    const loadedPeer = loadedBySymbol.get(symbolTradingsymbol(normalized))
    if (loadedPeer) return loadedPeer
  }
  return normalized
}

function orderedSnapshotSymbols(snapshot: Snapshot, options: { includeCachedFundamentals?: boolean } = {}) {
  const seen = new Set<string>()
  const symbols: string[] = []
  const aliases = coverageAliasMap(snapshot)
  const loadedBySymbol = loadedSymbolByTradingsymbol(snapshot)
  const add = (symbol?: string) => {
    if (!symbol) return
    const canonical = canonicalCoverageSymbol(snapshot, symbol, aliases, loadedBySymbol)
    if (seen.has(canonical)) return
    seen.add(canonical)
    symbols.push(canonical)
  }
  snapshot.symbols.forEach((symbol) => add(symbol.kite_key || symbol.input))
  snapshot.upload?.symbols.forEach(add)
  snapshot.holdings.forEach((holding) => {
    const key = holdingKey(holding)
    if (key && !key.startsWith('UNLISTED:')) add(key)
  })
  Object.keys(snapshot.quotes).forEach(add)
  Object.keys(snapshot.candles).forEach(add)
  if (options.includeCachedFundamentals) {
    Object.keys(snapshot.fundamentals ?? {}).forEach(add)
  }
  return symbols
}

function buildSyncCoverage(snapshot: Snapshot): SyncCoverage {
  const symbols = orderedSnapshotSymbols(snapshot)
  const fundamentalSymbols = symbols.filter((symbol) => fundamentalsApplicable(snapshot, symbol))
  return {
    technicalLoaded: symbols.filter((symbol) => hasTechnicalData(snapshot, symbol)),
    technicalMissing: symbols.filter((symbol) => !hasTechnicalData(snapshot, symbol)),
    fundamentalsLoaded: fundamentalSymbols.filter((symbol) => hasFundamentalData(snapshot, symbol)),
    fundamentalsMissing: fundamentalSymbols.filter((symbol) => !hasFundamentalData(snapshot, symbol)),
  }
}

function hasFundamentalScope(snapshot: Snapshot) {
  return orderedSnapshotSymbols(snapshot).some((symbol) => fundamentalsApplicable(snapshot, symbol))
}

function splitMarketSymbol(symbol: string) {
  const [rawExchange, ...rest] = symbol.trim().toUpperCase().split(':')
  const tradingsymbol = rest.length ? rest.join(':') : rawExchange
  const exchange = rest.length && (rawExchange === 'BSE' || rawExchange === 'NSE') ? rawExchange : 'NSE'
  return { exchange, tradingsymbol }
}

function defaultYahooSymbol(symbol: string) {
  const { exchange, tradingsymbol } = splitMarketSymbol(symbol)
  if (!tradingsymbol) return ''
  return `${tradingsymbol}${exchange === 'BSE' ? '.BO' : '.NS'}`
}

function defaultScreenerSymbol(symbol: string) {
  const { tradingsymbol } = splitMarketSymbol(symbol)
  return tradingsymbol.replace(/-(BE|EQ|SM|ST)$/i, '')
}

function isLikelyIsinSymbol(symbol: string) {
  const { tradingsymbol } = splitMarketSymbol(symbol)
  return /^IN[A-Z0-9]{10}$/i.test(tradingsymbol)
}

function isUnsupportedCoverageSymbol(symbol: string) {
  return symbol.trim().toUpperCase().startsWith('UNLISTED:') || isLikelyIsinSymbol(symbol)
}

function syncErrorsForSymbol(snapshot: Snapshot, symbol: string) {
  const normalizedSymbol = symbol.toUpperCase()
  return snapshot.errors.filter((error) => error.toUpperCase().startsWith(`${normalizedSymbol}:`))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compactSyncError(error: string, symbol: string) {
  return error.replace(new RegExp(`^${escapeRegExp(symbol)}:\\s*`, 'i'), '').replace(/\s+/g, ' ').slice(0, 180)
}

function mappingDraftForSymbol(snapshot: Snapshot, symbol: string): SymbolMappingDraft {
  const resolved = snapshot.symbols.find((row) => (row.kite_key || row.input).toUpperCase() === symbol.toUpperCase())
  return {
    name: '',
    screener: resolved?.screener || defaultScreenerSymbol(symbol),
    yahoo: resolved?.yahoo || defaultYahooSymbol(symbol),
  }
}

function buildMissingDataIssues(snapshot: Snapshot, coverage: SyncCoverage): MissingDataIssue[] {
  const symbols = Array.from(new Set([...coverage.technicalMissing, ...coverage.fundamentalsMissing]))
  return symbols.map((symbol) => {
    const errors = syncErrorsForSymbol(snapshot, symbol)
    const technicalMissing = coverage.technicalMissing.includes(symbol)
    const fundamentalsMissing = coverage.fundamentalsMissing.includes(symbol)
    const errorText = errors.join(' ').toLowerCase()
    const unsupported =
      isLikelyIsinSymbol(symbol) ||
      errorText.includes('unsupported') ||
      errorText.includes('unlisted') ||
      errorText.includes('isin')
    const likelyMappingIssue =
      errorText.includes('404') ||
      errorText.includes('not found') ||
      errorText.includes('no price data') ||
      errorText.includes('no historical data') ||
      errorText.includes('screener')
    const action: MissingDataIssueAction = unsupported ? 'unsupported' : likelyMappingIssue ? 'mapping' : 'retry'
    const reason = errors.length
      ? compactSyncError(errors[0], symbol)
      : unsupported
        ? 'Looks like an unlisted/ISIN-only holding rather than a directly tradable NSE/BSE symbol.'
        : 'The last sync did not return the required quote, candle, or company data.'
    const suggestion =
      action === 'unsupported'
        ? 'Keep it in portfolio value if needed, but exclude it from technical/fundamental analysis unless you can map it to a listed NSE/BSE symbol.'
        : action === 'mapping'
          ? 'Add the correct Yahoo price code and Screener company code, save the mapping, then retry missing symbols only.'
          : 'Retry just this missing set first. If it still fails, add a manual mapping.'
    return {
      action,
      errors,
      fundamentalsMissing,
      reason,
      suggestion,
      symbol,
      technicalMissing,
    }
  })
}

function currentSnapshotSymbolSet(snapshot: Snapshot) {
  return new Set(orderedSnapshotSymbols(snapshot).map((symbol) => symbol.toUpperCase()))
}

function mergeFundamentals(refreshedSnapshot: Snapshot, previousSnapshot: Snapshot, options: { retainAllPrevious?: boolean } = {}) {
  const merged: Record<string, CompanyFundamentals> = {}
  const currentSymbols = options.retainAllPrevious ? null : currentSnapshotSymbolSet(refreshedSnapshot)
  for (const [key, fundamentals] of Object.entries(previousSnapshot.fundamentals ?? {})) {
    if (Object.keys(fundamentals ?? {}).length > 0 && (options.retainAllPrevious || currentSymbols?.has(key.toUpperCase()))) {
      merged[key] = fundamentals
    }
  }
  for (const [key, fundamentals] of Object.entries(refreshedSnapshot.fundamentals ?? {})) {
    if (Object.keys(fundamentals ?? {}).length > 0) {
      merged[key] = fundamentals
    }
  }
  return merged
}

function mergeSymbolRows(previousRows: Snapshot['symbols'], refreshedRows: Snapshot['symbols']) {
  const merged = new Map<string, Snapshot['symbols'][number]>()
  for (const row of previousRows) merged.set((row.kite_key || row.input).toUpperCase(), row)
  for (const row of refreshedRows) merged.set((row.kite_key || row.input).toUpperCase(), row)
  return Array.from(merged.values())
}

function uniqueMessages(messages: string[]) {
  return Array.from(new Set(messages.filter(Boolean))).slice(-80)
}

function mergeRefreshedSnapshot(refreshedSnapshot: Snapshot, previousSnapshot: Snapshot, options: { retainMarketData?: boolean } = {}) {
  const refreshedCount = filledFundamentalsCount(refreshedSnapshot)
  const previousCount = filledFundamentalsCount(previousSnapshot)
  const fundamentals = mergeFundamentals(refreshedSnapshot, previousSnapshot, { retainAllPrevious: Boolean(options.retainMarketData) })
  const retainedCount = filledFundamentalsRecordCount(fundamentals)
  const quotes = options.retainMarketData
    ? { ...(previousSnapshot.quotes ?? {}), ...(refreshedSnapshot.quotes ?? {}) }
    : (refreshedSnapshot.quotes ?? {})
  const candles = options.retainMarketData
    ? { ...(previousSnapshot.candles ?? {}), ...(refreshedSnapshot.candles ?? {}) }
    : (refreshedSnapshot.candles ?? {})
  const previousHoldings = previousSnapshot.upload ? (previousSnapshot.holdings ?? []) : []
  const refreshedHoldings = refreshedSnapshot.holdings ?? []
  const refreshedHasHoldings = refreshedHoldings.length > 0
  const retainedHoldings =
    Boolean(previousSnapshot.upload) &&
    !refreshedSnapshot.upload &&
    !refreshedHasHoldings &&
    previousHoldings.length > 0 &&
    !previousSnapshot.provider.includes('sample')
  const carriesUploadedPortfolio = Boolean(refreshedSnapshot.upload) || (Boolean(previousSnapshot.upload) && (refreshedHasHoldings || retainedHoldings))
  const upload = refreshedSnapshot.upload ?? (carriesUploadedPortfolio ? previousSnapshot.upload : undefined)
  const holdings = refreshedSnapshot.upload
    ? mergeHoldingsPrices(refreshedHoldings, quotes)
    : refreshedHasHoldings && previousSnapshot.upload
      ? mergeHoldingsPrices(refreshedHoldings, quotes)
      : retainedHoldings
        ? mergeHoldingsPrices(previousHoldings, quotes)
        : []

  return {
    refreshedCount,
    retainedCount,
    retainedExisting: previousCount > 0 && retainedCount > refreshedCount,
    retainedHoldings,
    snapshot: {
      ...refreshedSnapshot,
      candles,
      errors: options.retainMarketData
        ? uniqueMessages([...(previousSnapshot.errors ?? []), ...(refreshedSnapshot.errors ?? [])])
        : (refreshedSnapshot.errors ?? []),
      fundamentals,
      holdings,
      quotes,
      symbols: options.retainMarketData ? mergeSymbolRows(previousSnapshot.symbols ?? [], refreshedSnapshot.symbols ?? []) : (refreshedSnapshot.symbols ?? []),
      upload,
    },
  }
}

function holdingValue(holding: Holding) {
  return (holding.quantity ?? 0) * (holding.last_price ?? 0)
}

function holdingCost(holding: Holding) {
  return (holding.quantity ?? 0) * (holding.average_price ?? 0)
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
}

function percentStyle(value?: number, variable = '--value') {
  const safeValue = value === undefined || Number.isNaN(value) ? 0 : clamp(value)
  return { [variable]: `${safeValue}%` } as CSSProperties
}

function latestCandle(candles: Candle[]) {
  return candles.length ? candles[candles.length - 1] : undefined
}

function previousCandle(candles: Candle[]) {
  return candles.length > 1 ? candles[candles.length - 2] : undefined
}

function candleTrendPct(candles: Candle[], lookback = 30) {
  const window = candles.slice(-lookback).filter((candle) => candle.close !== undefined)
  if (window.length < 2) return undefined
  const first = window[0].close
  const last = window[window.length - 1].close
  if (!first) return undefined
  return ((last - first) / first) * 100
}

function averageVolume(candles: Candle[], lookback = 20) {
  const volumes = candles
    .slice(-lookback)
    .map((candle) => candle.volume)
    .filter((volume) => typeof volume === 'number' && !Number.isNaN(volume))
  if (!volumes.length) return undefined
  return volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length
}

function candleRange(candles: Candle[], lookback = 252) {
  const window = candles.slice(-lookback)
  const highs = window.map((candle) => candle.high ?? candle.close).filter((value) => value !== undefined)
  const lows = window.map((candle) => candle.low ?? candle.close).filter((value) => value !== undefined)
  if (!highs.length || !lows.length) return { high: undefined, low: undefined }
  return {
    high: Math.max(...highs),
    low: Math.min(...lows),
  }
}

function rangePosition(value?: number, low?: number, high?: number) {
  if (value === undefined || low === undefined || high === undefined || high === low) return undefined
  return clamp(((value - low) / (high - low)) * 100)
}

function buildSparkline(candles: Candle[], width = 320, height = 110) {
  const window = candles.slice(-60)
  if (window.length < 2) return { line: '', area: '', points: '', trend: undefined as number | undefined }
  const closes = window.map((candle) => candle.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const span = max - min || 1
  const points = window.map((candle, index) => {
    const x = (index / (window.length - 1)) * width
    const y = height - ((candle.close - min) / span) * (height - 18) - 9
    return { x, y }
  })
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
  const area = `${line} L ${width} ${height} L 0 ${height} Z`
  const trend = candleTrendPct(window, window.length)
  return {
    line,
    area,
    points: `${points[0].x},${points[0].y} ${points[points.length - 1].x},${points[points.length - 1].y}`,
    trend,
  }
}

function normaliseCandle(candle: Candle): NormalisedCandle {
  const close = candle.close
  const open = candle.open ?? close
  const high = Math.max(candle.high ?? Math.max(open, close), open, close)
  const low = Math.min(candle.low ?? Math.min(open, close), open, close)
  return {
    ...candle,
    open,
    high,
    low,
    close,
    volume: candle.volume ?? 0,
  }
}

function candlesForTimeframe(candles: Candle[], timeframe: ChartTimeframe, zoomLevel = 1, windowEnd?: number | null) {
  const limit = chartTimeframes[timeframe].candles
  const baseWindow = (limit ? candles.slice(-limit) : candles).map(normaliseCandle)
  const baseLength = baseWindow.length
  const fullWindow = zoomLevel <= 1 || baseLength <= 1
  const visibleLength = fullWindow ? baseLength : Math.max(1, Math.ceil(baseLength / zoomLevel))
  const safeEnd = clamp(windowEnd ?? baseLength, visibleLength, baseLength)
  const windowStart = fullWindow ? 0 : Math.max(0, safeEnd - visibleLength)
  const windowStop = fullWindow ? baseLength : windowStart + visibleLength
  return {
    baseLength,
    candles: baseWindow.slice(windowStart, windowStop),
    windowEnd: windowStop,
    windowStart,
  }
}

function movingAverage(candles: NormalisedCandle[], period: number) {
  return candles.map((_, index) => {
    if (index + 1 < period) return undefined
    const window = candles.slice(index + 1 - period, index + 1)
    return window.reduce((sum, candle) => sum + candle.close, 0) / period
  })
}

function standardDeviation(values: number[]) {
  if (!values.length) return 0
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function exponentialMovingAverage(values: Array<number | undefined>, period: number) {
  const multiplier = 2 / (period + 1)
  const output: Array<number | undefined> = Array(values.length).fill(undefined)
  let ema: number | undefined
  const seed: number[] = []
  values.forEach((value, index) => {
    if (value === undefined) return
    if (ema === undefined) {
      seed.push(value)
      if (seed.length === period) {
        ema = seed.reduce((sum, item) => sum + item, 0) / period
        output[index] = ema
      }
      return
    }
    ema = (value - ema) * multiplier + ema
    output[index] = ema
  })
  return output
}

function bollingerBands(candles: NormalisedCandle[], period = 20, multiplier = 2) {
  const middle = movingAverage(candles, period)
  const upper = candles.map((_, index) => {
    if (index + 1 < period || middle[index] === undefined) return undefined
    const closes = candles.slice(index + 1 - period, index + 1).map((candle) => candle.close)
    return middle[index] + standardDeviation(closes) * multiplier
  })
  const lower = candles.map((_, index) => {
    if (index + 1 < period || middle[index] === undefined) return undefined
    const closes = candles.slice(index + 1 - period, index + 1).map((candle) => candle.close)
    return middle[index] - standardDeviation(closes) * multiplier
  })
  return { lower, middle, upper }
}

function vwapSeries(candles: NormalisedCandle[]) {
  let cumulativePriceVolume = 0
  let cumulativeVolume = 0
  return candles.map((candle) => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    cumulativePriceVolume += typicalPrice * candle.volume
    cumulativeVolume += candle.volume
    return cumulativeVolume ? cumulativePriceVolume / cumulativeVolume : undefined
  })
}

function atrSeries(candles: NormalisedCandle[], period = 14) {
  const trueRanges = candles.map((candle, index) => {
    const previousClose = index > 0 ? candles[index - 1].close : candle.close
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose))
  })
  return exponentialMovingAverage(trueRanges, period)
}

function rsiSeries(candles: NormalisedCandle[], period = 14) {
  const changes = candles.map((candle, index) => (index === 0 ? 0 : candle.close - candles[index - 1].close))
  const gains = changes.map((change) => Math.max(change, 0))
  const losses = changes.map((change) => Math.max(-change, 0))
  const averageGains = exponentialMovingAverage(gains, period)
  const averageLosses = exponentialMovingAverage(losses, period)
  return changes.map((_, index) => {
    const averageGain = averageGains[index]
    const averageLoss = averageLosses[index]
    if (averageGain === undefined || averageLoss === undefined) return undefined
    if (averageLoss === 0) return 100
    const relativeStrength = averageGain / averageLoss
    return 100 - 100 / (1 + relativeStrength)
  })
}

function macdSeries(candles: NormalisedCandle[]) {
  const closes = candles.map((candle) => candle.close)
  const ema12 = exponentialMovingAverage(closes, 12)
  const ema26 = exponentialMovingAverage(closes, 26)
  const macd = closes.map((_, index) => (ema12[index] !== undefined && ema26[index] !== undefined ? ema12[index] - ema26[index] : undefined))
  const signal = exponentialMovingAverage(macd, 9)
  const histogram = macd.map((value, index) => (value !== undefined && signal[index] !== undefined ? value - signal[index] : undefined))
  return { histogram, macd, signal }
}

function latestDefined(values: Array<number | undefined>) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== undefined) return values[index]
  }
  return undefined
}

function candleStats(candle: NormalisedCandle) {
  const body = Math.abs(candle.close - candle.open)
  const range = Math.max(candle.high - candle.low, 0.01)
  const upperShadow = candle.high - Math.max(candle.open, candle.close)
  const lowerShadow = Math.min(candle.open, candle.close) - candle.low
  return {
    body,
    bodyPct: body / range,
    bullish: candle.close >= candle.open,
    lowerShadow,
    range,
    upperShadow,
  }
}

function localTrend(candles: NormalisedCandle[], index: number, lookback = 5) {
  const start = Math.max(0, index - lookback)
  if (index - start < 2) return 'range'
  const first = candles[start].close
  const last = candles[Math.max(start, index - 1)].close
  const change = first ? ((last - first) / first) * 100 : 0
  if (change > 2) return 'uptrend'
  if (change < -2) return 'downtrend'
  return 'range'
}

function patternSignal(
  candles: NormalisedCandle[],
  index: number,
  name: string,
  kind: PatternSignal['kind'],
  bias: PatternBias,
  explanation: string,
): PatternSignal {
  const window = candles.slice(Math.max(0, index - (kind === 'Multi candle' ? 2 : 0)), index + 1)
  const low = Math.min(...window.map((candle) => candle.low))
  const high = Math.max(...window.map((candle) => candle.high))
  const action =
    bias === 'bullish'
      ? 'Bullish only if it appears near support and is confirmed by the next close/volume.'
      : bias === 'bearish'
        ? 'Bearish only if it appears near resistance and is confirmed by the next close/volume.'
        : 'Indecision signal; wait for breakout or breakdown confirmation.'
  const stopHint = bias === 'bullish' ? `Pattern low ${formatInr(low)} can guide invalidation.` : bias === 'bearish' ? `Pattern high ${formatInr(high)} can guide invalidation.` : 'Avoid acting on this alone.'
  return { action, bias, explanation, index, kind, name, stopHint }
}

function detectCandlestickPatterns(candles: NormalisedCandle[]) {
  const signals: PatternSignal[] = []
  candles.forEach((candle, index) => {
    const stats = candleStats(candle)
    const trend = localTrend(candles, index)
    const bodyTop = Math.max(candle.open, candle.close)
    const bodyBottom = Math.min(candle.open, candle.close)

    if (stats.bodyPct <= 0.08) {
      signals.push(patternSignal(candles, index, 'Doji', 'Single candle', 'neutral', 'Open and close are almost equal, showing indecision between buyers and sellers.'))
    } else if (stats.bodyPct <= 0.28 && stats.upperShadow > stats.body * 0.8 && stats.lowerShadow > stats.body * 0.8) {
      signals.push(patternSignal(candles, index, 'Spinning Top', 'Single candle', 'neutral', 'Small body with shadows on both sides, usually warning that the current trend is losing certainty.'))
    }

    if (stats.bodyPct >= 0.82 && stats.upperShadow <= stats.range * 0.08 && stats.lowerShadow <= stats.range * 0.08) {
      signals.push(
        patternSignal(
          candles,
          index,
          stats.bullish ? 'Bullish Marubozu' : 'Bearish Marubozu',
          'Single candle',
          stats.bullish ? 'bullish' : 'bearish',
          stats.bullish ? 'Strong close near the high shows buyers controlled the full session.' : 'Strong close near the low shows sellers controlled the full session.',
        ),
      )
    }

    if (stats.lowerShadow >= stats.body * 2 && stats.upperShadow <= Math.max(stats.body, stats.range * 0.12) && bodyTop >= candle.low + stats.range * 0.6) {
      signals.push(
        patternSignal(
          candles,
          index,
          trend === 'uptrend' ? 'Hanging Man' : 'Hammer',
          'Single candle',
          trend === 'uptrend' ? 'bearish' : 'bullish',
          trend === 'uptrend' ? 'Long lower shadow after an uptrend warns that sellers tested lower prices.' : 'Long lower shadow after a decline shows buyers absorbed lower prices.',
        ),
      )
    }

    if (stats.upperShadow >= stats.body * 2 && stats.lowerShadow <= Math.max(stats.body, stats.range * 0.12) && bodyBottom <= candle.low + stats.range * 0.4) {
      signals.push(
        patternSignal(
          candles,
          index,
          'Shooting Star',
          'Single candle',
          'bearish',
          'Long upper shadow shows buyers pushed price up but sellers rejected the higher level.',
        ),
      )
    }

    if (index >= 1) {
      const previous = candles[index - 1]
      const previousStats = candleStats(previous)
      const previousBodyTop = Math.max(previous.open, previous.close)
      const previousBodyBottom = Math.min(previous.open, previous.close)
      const midpoint = (previous.open + previous.close) / 2

      if (!previousStats.bullish && stats.bullish && candle.open <= previous.close && candle.close >= previous.open) {
        signals.push(patternSignal(candles, index, 'Bullish Engulfing', 'Multi candle', 'bullish', 'The second candle fully overpowers the prior bearish body, suggesting demand has returned.'))
      }
      if (previousStats.bullish && !stats.bullish && candle.open >= previous.close && candle.close <= previous.open) {
        signals.push(patternSignal(candles, index, 'Bearish Engulfing', 'Multi candle', 'bearish', 'The second candle fully overpowers the prior bullish body, suggesting supply has returned.'))
      }
      if (!previousStats.bullish && stats.bullish && candle.close > midpoint && candle.close < previous.open) {
        signals.push(patternSignal(candles, index, 'Piercing Pattern', 'Multi candle', 'bullish', 'Bullish recovery closes above the prior candle midpoint, but does not fully engulf it.'))
      }
      if (previousStats.bullish && !stats.bullish && candle.close < midpoint && candle.close > previous.open) {
        signals.push(patternSignal(candles, index, 'Dark Cloud Cover', 'Multi candle', 'bearish', 'Bearish close below the prior candle midpoint warns that the up move is being rejected.'))
      }
      if (!previousStats.bullish && previousStats.bodyPct > 0.45 && bodyTop < previousBodyTop && bodyBottom > previousBodyBottom) {
        signals.push(patternSignal(candles, index, 'Bullish Harami', 'Multi candle', 'bullish', 'A smaller candle contained inside a prior bearish body suggests selling pressure is pausing.'))
      }
      if (previousStats.bullish && previousStats.bodyPct > 0.45 && bodyTop < previousBodyTop && bodyBottom > previousBodyBottom) {
        signals.push(patternSignal(candles, index, 'Bearish Harami', 'Multi candle', 'bearish', 'A smaller candle contained inside a prior bullish body suggests buying pressure is pausing.'))
      }
    }

    if (index >= 2) {
      const first = candles[index - 2]
      const second = candles[index - 1]
      const firstStats = candleStats(first)
      const secondStats = candleStats(second)
      const midpoint = (first.open + first.close) / 2
      if (!firstStats.bullish && secondStats.bodyPct <= 0.32 && stats.bullish && candle.close > midpoint) {
        signals.push(patternSignal(candles, index, 'Morning Star', 'Multi candle', 'bullish', 'Bearish candle, indecision candle, then bullish recovery above the first candle midpoint.'))
      }
      if (firstStats.bullish && secondStats.bodyPct <= 0.32 && !stats.bullish && candle.close < midpoint) {
        signals.push(patternSignal(candles, index, 'Evening Star', 'Multi candle', 'bearish', 'Bullish candle, indecision candle, then bearish rejection below the first candle midpoint.'))
      }
    }
  })
  return signals
}

function patternUseText(signal: PatternSignal) {
  if (signal.bias === 'bullish') {
    return 'Use it as a watchlist trigger near support: prefer the next candle closing above the pattern high, rising volume, and alignment with the broader trend before buying or adding.'
  }
  if (signal.bias === 'bearish') {
    return 'Use it as a risk warning near resistance: avoid fresh buying until price reclaims the pattern high, and consider reducing risk if the next close breaks lower.'
  }
  return 'Use it as an indecision alert: wait for price to break above the candle high or below the candle low before taking a directional view.'
}

function patternCautionText(signal: PatternSignal) {
  if (signal.bias === 'bullish') {
    return 'Be cautious if the stock is below falling moving averages, volume is weak, or the next candle breaks the pattern low. A bullish candle inside a weak trend can become only a temporary bounce.'
  }
  if (signal.bias === 'bearish') {
    return 'Be cautious if the stock is in a strong uptrend with high demand, because bearish reversal candles can fail. Confirmation matters more than the candle name.'
  }
  return 'Be cautious because neutral patterns do not predict direction. They only show that buyers and sellers are temporarily balanced.'
}

function patternSpotText(signal: PatternSignal) {
  const name = signal.name.toLowerCase()
  if (name.includes('doji')) {
    return 'Spot it by looking for a candle where the open and close are almost the same price. The candle body looks like a tiny line or cross because neither side could finish in control.'
  }
  if (name.includes('spinning')) {
    return 'Spot it by looking for a small real body with visible upper and lower shadows. It says price moved both ways during the session but closed near the middle.'
  }
  if (name.includes('marubozu')) {
    return 'Spot it by looking for a long candle body with very small or no shadows. A bullish one opens near the low and closes near the high; a bearish one does the opposite.'
  }
  if (name.includes('hammer') || name.includes('hanging')) {
    return 'Spot it by looking for a small body near the top of the candle and a long lower shadow. The same shape can be a Hammer after a fall or a Hanging Man after a rise.'
  }
  if (name.includes('shooting')) {
    return 'Spot it by looking for a small body near the lower end of the candle and a long upper shadow. It shows price tried to rise but was pushed back down.'
  }
  if (name.includes('engulfing')) {
    return 'Spot it by comparing two candles: the second candle body should fully cover the prior candle body. The colour and location decide whether it is bullish or bearish.'
  }
  if (name.includes('piercing') || name.includes('dark cloud')) {
    return 'Spot it with two candles. The second candle reverses into the first candle body and closes beyond its midpoint, but does not fully engulf it.'
  }
  if (name.includes('harami')) {
    return 'Spot it with two candles where the second body is small and sits inside the previous large body. It looks like the move has suddenly become unsure.'
  }
  if (name.includes('morning') || name.includes('evening')) {
    return 'Spot it with three candles: a strong trend candle, a small indecision candle, and then a reversal candle that pushes back through the first candle midpoint.'
  }
  return signal.kind === 'Multi candle'
    ? 'Spot it by reading the last two or three candles together, not in isolation. The pattern needs the current candle to change the message of the prior candle.'
    : 'Spot it by checking the candle body, the upper shadow, and the lower shadow. The shape matters only after you know the prior trend and price level.'
}

function patternLooksText(signal: PatternSignal) {
  const name = signal.name.toLowerCase()
  if (name.includes('doji')) return 'It looks like a cross, plus sign, or very thin body. On the chart marker it is neutral, so treat it as a pause rather than a buy or sell signal.'
  if (name.includes('spinning')) return 'It looks like a small candle body with wicks on both sides, almost like the market pulled in both directions and ended undecided.'
  if (name.includes('bullish marubozu')) return 'It looks like a tall green candle with almost no wick. Buyers controlled most of the day from open to close.'
  if (name.includes('bearish marubozu')) return 'It looks like a tall red candle with almost no wick. Sellers controlled most of the day from open to close.'
  if (name.includes('hammer')) return 'It looks like a small umbrella after weakness: a small body on top, long lower wick below, and very little upper wick.'
  if (name.includes('hanging')) return 'It looks like the Hammer shape after a rise. That context changes the meaning from possible support to possible exhaustion.'
  if (name.includes('shooting')) return 'It looks like an upside-down Hammer after a rise or near resistance: small body below, long wick above.'
  if (name.includes('bullish engulfing')) return 'It looks like a red candle followed by a larger green body that swallows the prior body.'
  if (name.includes('bearish engulfing')) return 'It looks like a green candle followed by a larger red body that swallows the prior body.'
  if (name.includes('piercing')) return 'It looks like a down candle followed by a green recovery candle that closes above the prior body midpoint.'
  if (name.includes('dark cloud')) return 'It looks like an up candle followed by a red rejection candle that closes below the prior body midpoint.'
  if (name.includes('bullish harami')) return 'It looks like a large red candle followed by a smaller candle tucked inside it, showing selling pressure has paused.'
  if (name.includes('bearish harami')) return 'It looks like a large green candle followed by a smaller candle tucked inside it, showing buying pressure has paused.'
  if (name.includes('morning')) return 'It looks like a three-candle bottoming attempt: red pressure, a small pause, then a green recovery.'
  if (name.includes('evening')) return 'It looks like a three-candle topping attempt: green strength, a small pause, then a red rejection.'
  return signal.bias === 'bullish'
    ? 'It should visually show demand returning, preferably near a known support zone.'
    : signal.bias === 'bearish'
      ? 'It should visually show supply returning, preferably near a known resistance zone.'
      : 'It should visually show indecision rather than clear control by buyers or sellers.'
}

function buildLinePath(values: Array<number | undefined>, xForIndex: (index: number) => number, yForPrice: (value: number) => number) {
  return values
    .map((value, index) => (value === undefined ? '' : `${index === 0 || values[index - 1] === undefined ? 'M' : 'L'} ${xForIndex(index).toFixed(2)} ${yForPrice(value).toFixed(2)}`))
    .filter(Boolean)
    .join(' ')
}

function buildCandleChart(
  candles: Candle[],
  timeframe: ChartTimeframe,
  zoomLevel = 1,
  windowEnd?: number | null,
  forecast?: ForecastProjection,
  width = 760,
  priceHeight = 232,
  volumeHeight = 52,
) {
  const chartWindow = candlesForTimeframe(candles, timeframe, zoomLevel, windowEnd)
  const chartCandles = chartWindow.candles
  const forecastCases = forecast?.cases ?? []
  const plotLeft = 54
  const plotRight = 66
  const plotWidth = width - plotLeft - plotRight
  const volumeGap = 12
  const volumeBase = priceHeight + volumeGap + volumeHeight
  const totalHeight = volumeBase + 42
  if (!chartCandles.length) {
    return {
      baseLength: chartWindow.baseLength,
      candles: [],
      candleWidth: 0,
      grid: [],
      highLine: undefined,
      lowLine: undefined,
      priceHeight,
      sma20Path: '',
      sma50Path: '',
      sma100Path: '',
      sma200Path: '',
      ema20Path: '',
      ema50Path: '',
      forecast: undefined,
      vwapPath: '',
      bbUpperPath: '',
      bbMiddlePath: '',
      bbLowerPath: '',
      latestRsi: undefined,
      latestMacd: undefined,
      latestMacdSignal: undefined,
      latestMacdHistogram: undefined,
      latestAtr: undefined,
      latestVwap: undefined,
      step: 0,
      totalHeight,
      plotLeft,
      plotRight,
      plotWidth,
      volumeBase,
      volumeHeight,
      windowEnd: chartWindow.windowEnd,
      windowStart: chartWindow.windowStart,
      width,
      xTicks: [],
    }
  }

  const sma20 = movingAverage(chartCandles, 20)
  const sma50 = movingAverage(chartCandles, 50)
  const sma100 = movingAverage(chartCandles, 100)
  const sma200 = movingAverage(chartCandles, 200)
  const closes = chartCandles.map((candle) => candle.close)
  const ema20 = exponentialMovingAverage(closes, 20)
  const ema50 = exponentialMovingAverage(closes, 50)
  const vwap = vwapSeries(chartCandles)
  const bollinger = bollingerBands(chartCandles)
  const rsi = rsiSeries(chartCandles)
  const macd = macdSeries(chartCandles)
  const atr = atrSeries(chartCandles)
  const allPrices = [
    ...chartCandles.flatMap((candle) => [candle.high, candle.low]),
    ...forecastCases.flatMap((forecastCase) => forecastCase.points.map((point) => point.price)),
    ...sma20.filter((value): value is number => value !== undefined),
    ...sma50.filter((value): value is number => value !== undefined),
    ...sma100.filter((value): value is number => value !== undefined),
    ...sma200.filter((value): value is number => value !== undefined),
    ...ema20.filter((value): value is number => value !== undefined),
    ...ema50.filter((value): value is number => value !== undefined),
    ...vwap.filter((value): value is number => value !== undefined),
    ...bollinger.upper.filter((value): value is number => value !== undefined),
    ...bollinger.lower.filter((value): value is number => value !== undefined),
  ]
  const rawMin = Math.min(...allPrices)
  const rawMax = Math.max(...allPrices)
  const padding = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.01, 1)
  const minPrice = rawMin - padding
  const maxPrice = rawMax + padding
  const priceSpan = maxPrice - minPrice || 1
  const forecastSpace = forecast && forecastCases.length ? Math.min(plotWidth * 0.24, 176) : 0
  const historicalWidth = Math.max(plotWidth - forecastSpace, plotWidth * 0.62)
  const step = historicalWidth / chartCandles.length
  const candleWidth = clamp(step * 0.58, 2, 10)
  const maxVolume = Math.max(...chartCandles.map((candle) => candle.volume), 1)
  const xForIndex = (index: number) => plotLeft + index * step + step / 2
  const yForPrice = (value: number) => priceHeight - ((value - minPrice) / priceSpan) * (priceHeight - 18) + 9
  const forecastStartX = xForIndex(chartCandles.length - 1)
  const forecastEndX = width - plotRight
  const xForForecast = (progress: number) => forecastStartX + (forecastEndX - forecastStartX) * progress
  const grid = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4
    const value = maxPrice - ratio * priceSpan
    return { value, y: yForPrice(value) }
  })
  const high = Math.max(...chartCandles.map((candle) => candle.high))
  const low = Math.min(...chartCandles.map((candle) => candle.low))
  const tickCount = Math.min(5, chartCandles.length)
  const xTicks = Array.from({ length: tickCount }, (_, index) => {
    const candleIndex = tickCount === 1 ? 0 : Math.round((index / (tickCount - 1)) * (chartCandles.length - 1))
    return {
      date: chartCandles[candleIndex].date,
      x: xForIndex(candleIndex),
    }
  })
  const forecastLines = forecastCases.map((forecastCase) => {
    const points = forecastCase.points.map((point) => ({
      ...point,
      x: xForForecast(point.progress),
      y: yForPrice(point.price),
    }))
    return {
      ...forecastCase,
      path: points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' '),
      points,
    }
  })
  const bullLine = forecastLines.find((line) => line.key === 'bull')
  const bearLine = forecastLines.find((line) => line.key === 'bear')
  const forecastBandPath =
    bullLine && bearLine
      ? `${bullLine.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} ${bearLine.points
          .slice()
          .reverse()
          .map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
          .join(' ')} Z`
      : ''

  return {
    baseLength: chartWindow.baseLength,
    candles: chartCandles.map((candle, index) => {
      const x = xForIndex(index)
      const openY = yForPrice(candle.open)
      const closeY = yForPrice(candle.close)
      const highY = yForPrice(candle.high)
      const lowY = yForPrice(candle.low)
      const bodyY = Math.min(openY, closeY)
      const bodyHeight = Math.max(Math.abs(openY - closeY), 2)
      const volumeBarHeight = (candle.volume / maxVolume) * volumeHeight
      return {
        bodyHeight,
        bodyY,
        candle,
        closeY,
        ema20: ema20[index],
        ema50: ema50[index],
        highY,
        lowY,
        macd: macd.macd[index],
        macdSignal: macd.signal[index],
        openY,
        rsi: rsi[index],
        up: candle.close >= candle.open,
        atr: atr[index],
        sma20: sma20[index],
        sma50: sma50[index],
        sma100: sma100[index],
        sma200: sma200[index],
        vwap: vwap[index],
        volumeBarHeight,
        volumeY: volumeBase - volumeBarHeight,
        x,
      }
    }),
    candleWidth,
    grid,
    highLine: { value: high, y: yForPrice(high) },
    lowLine: { value: low, y: yForPrice(low) },
    priceHeight,
    plotLeft,
    plotRight,
    plotWidth,
    sma20Path: buildLinePath(sma20, xForIndex, yForPrice),
    sma50Path: buildLinePath(sma50, xForIndex, yForPrice),
    sma100Path: buildLinePath(sma100, xForIndex, yForPrice),
    sma200Path: buildLinePath(sma200, xForIndex, yForPrice),
    ema20Path: buildLinePath(ema20, xForIndex, yForPrice),
    ema50Path: buildLinePath(ema50, xForIndex, yForPrice),
    forecast:
      forecast && forecastLines.length
        ? {
            bandPath: forecastBandPath,
            endLabel: forecast.horizonLabel,
            lines: forecastLines,
            separatorX: plotLeft + historicalWidth + 3,
          }
        : undefined,
    vwapPath: buildLinePath(vwap, xForIndex, yForPrice),
    bbUpperPath: buildLinePath(bollinger.upper, xForIndex, yForPrice),
    bbMiddlePath: buildLinePath(bollinger.middle, xForIndex, yForPrice),
    bbLowerPath: buildLinePath(bollinger.lower, xForIndex, yForPrice),
    latestRsi: latestDefined(rsi),
    latestMacd: latestDefined(macd.macd),
    latestMacdSignal: latestDefined(macd.signal),
    latestMacdHistogram: latestDefined(macd.histogram),
    latestAtr: latestDefined(atr),
    latestVwap: latestDefined(vwap),
    step,
    totalHeight,
    volumeBase,
    volumeHeight,
    windowEnd: chartWindow.windowEnd,
    windowStart: chartWindow.windowStart,
    width,
    xTicks,
  }
}

function factorStatus(value: number | undefined, good: (value: number) => boolean, caution: (value: number) => boolean) {
  if (value === undefined) return 'needs data'
  if (good(value)) return 'strong'
  if (caution(value)) return 'watch'
  return 'weak'
}

function toneFromNumber(value: number | undefined, good: (value: number) => boolean, bad?: (value: number) => boolean): SignalTone {
  if (value === undefined) return 'neutral'
  if (good(value)) return 'positive'
  if (bad?.(value)) return 'negative'
  return 'neutral'
}

function toneFromScore(score: number): SignalTone {
  if (score >= 62) return 'positive'
  if (score <= 42) return 'negative'
  return 'neutral'
}

function addSignal(
  signals: AdaptiveSignal[],
  group: SignalGroup,
  label: string,
  value: string,
  score: number,
  weight: number,
  rationale: string,
) {
  signals.push({
    group,
    label,
    value,
    score: Math.round(clamp(score)),
    weight,
    tone: toneFromScore(score),
    rationale,
  })
}

function weightedSignalScore(signals: AdaptiveSignal[]) {
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0)
  if (!totalWeight) return 50
  return signals.reduce((sum, signal) => sum + signal.score * signal.weight, 0) / totalWeight
}

function scoreMetric(value: number | undefined, scoreForValue: (value: number) => number, missingScore = 48) {
  return value === undefined ? missingScore : scoreForValue(value)
}

function defaultRiskPercentForProfile(profile: RiskProfile) {
  if (profile === 'conservative') return 1
  if (profile === 'balanced_aggressive') return 2
  if (profile === 'aggressive') return 3
  return 1.5
}

function starterFractionForProfile(profile: RiskProfile) {
  if (profile === 'conservative') return 0.25
  if (profile === 'balanced_aggressive') return 0.4
  if (profile === 'aggressive') return 0.5
  return 0.33
}

function latestStatementNumber(fundamentals: CompanyFundamentals | undefined, key: string) {
  return fundamentals?.statement_summary?.[key]?.numeric
}

function previousStatementNumber(fundamentals: CompanyFundamentals | undefined, tableKey: string, metricNames: string[]) {
  const table = fundamentals?.statement_tables?.[tableKey]
  if (!table) return undefined
  const lowered = metricNames.map((name) => name.toLowerCase())
  const row = table.rows.find((item) => lowered.some((name) => item.metric.toLowerCase().includes(name)))
  if (!row) return undefined
  const numericValues = row.values.filter((value) => value.numeric !== undefined)
  return numericValues.length > 1 ? numericValues[numericValues.length - 2].numeric : undefined
}

function meaningfulCompanyUpdates(updates: CompanyFundamentals['company_updates'] | undefined) {
  const junkExactTitles = ['premium', "what's new", 'learn', 'changelog', 'login', 'register']
  const junkUrlMatches = ['/premium', '/docs/changelog', 'bit.ly/learnscreener', '/login', '/register']
  return (updates ?? [])
    .filter((update) => {
      const title = (update.title ?? '').trim().toLowerCase()
      const url = (update.url ?? '').trim().toLowerCase()
      const summary = (update.summary ?? '').trim().toLowerCase()
      if (!title && !summary) return false
      if (junkExactTitles.includes(title)) return false
      if (junkUrlMatches.some((term) => url.includes(term))) return false
      return true
    })
    .slice(0, 10)
}

function updateToneScore(updates: CompanyFundamentals['company_updates'] | undefined) {
  const meaningfulUpdates = meaningfulCompanyUpdates(updates)
  if (!meaningfulUpdates.length) return 50
  const toneScore = meaningfulUpdates.reduce((sum, update) => {
    if (update.tone === 'positive') return sum + 68
    if (update.tone === 'negative') return sum + 32
    return sum + 52
  }, 0)
  return toneScore / meaningfulUpdates.length
}

type CompanyUpdate = NonNullable<CompanyFundamentals['company_updates']>[number]

function updateText(update: CompanyUpdate) {
  return `${update.title ?? ''} ${update.summary ?? ''} ${update.category ?? ''}`.toLowerCase()
}

function updateKind(update: CompanyUpdate) {
  const text = updateText(update)
  if (/(result|financial|quarter|earnings|profit|revenue|sales|eps|margin)/.test(text)) return 'Earnings or results update'
  if (/(order|contract|award|project|tender|capacity|launch|approval)/.test(text)) return 'Business or order update'
  if (/(director|management|ceo|cfo|md|resign|appoint|leadership|governance)/.test(text)) return 'Leadership or governance update'
  if (/(dividend|bonus|split|buyback|rights|fund.?raise|preferential|allotment)/.test(text)) return 'Corporate action update'
  if (/(pledge|litigation|default|downgrade|penalty|inspection|regulator|show cause)/.test(text)) return 'Risk or compliance update'
  if (/(regulation|lodr|press release|announcement|investor presentation)/.test(text)) return 'Exchange disclosure'
  return update.category || 'Company update'
}

function updateBusinessMeaning(update: CompanyUpdate) {
  const kind = updateKind(update)
  const summary = compactSignalText(update.summary, 155)
  if (summary && summary.toLowerCase() !== (update.title ?? '').toLowerCase()) return summary
  if (kind.includes('Earnings')) return 'This is about reported performance. Check whether sales, margins, profit, and cash flow improved together or only one number looked good.'
  if (kind.includes('Business')) return 'This may affect revenue visibility or execution confidence. It matters more if the order size, margin, and delivery timeline are clear.'
  if (kind.includes('Leadership')) return 'This is about who is running or overseeing the business. Smooth transitions are usually neutral; sudden exits can make investors cautious.'
  if (kind.includes('Corporate')) return 'This changes shareholder economics or capital structure. The price impact depends on dilution, cash payout, and why the action is being taken.'
  if (kind.includes('Risk')) return 'This can change perceived business risk. Read the filing carefully because unclear compliance or legal risk can pressure valuation.'
  return 'This is a market disclosure. Treat it as an alert to read the filing and check whether it changes earnings, governance, debt, or growth expectations.'
}

function updatePriceImpact(update: CompanyUpdate) {
  const kind = updateKind(update)
  if (update.tone === 'negative') return 'Likely price effect: can create selling pressure or cap rallies until the market sees evidence that the issue is contained.'
  if (update.tone === 'positive') return 'Likely price effect: can support demand if volume confirms and investors believe it improves earnings or confidence.'
  if (kind.includes('Leadership')) return 'Likely price effect: usually neutral at first, but can turn negative if the change looks sudden or unexplained.'
  if (kind.includes('Business')) return 'Likely price effect: can help upside only when the market sees revenue visibility, margin comfort, and execution confidence.'
  if (kind.includes('Earnings')) return 'Likely price effect: can re-rate the stock if profit and cash flow improve together; weak cash or margins can cap the reaction.'
  if (kind.includes('Corporate')) return 'Likely price effect: depends on whether shareholders gain value or face dilution; wait for price and volume confirmation.'
  return 'Likely price effect: not a clear catalyst by itself; use it as context and let price/volume confirm whether the market cares.'
}

function compactSignalText(text: string | undefined, limit = 130) {
  if (!text) return ''
  const compacted = text.replace(/\s+/g, ' ').trim()
  return compacted.length > limit ? `${compacted.slice(0, limit - 1)}...` : compacted
}

function searchableCompanyText(fundamentals: CompanyFundamentals | undefined, quoteKey: string) {
  return [
    quoteKey,
    fundamentals?.name,
    fundamentals?.sector,
    fundamentals?.industry,
    fundamentals?.business_summary,
    fundamentals?.meta_description,
    fundamentals?.key_points,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function findSectorRule(fundamentals: CompanyFundamentals | undefined, quoteKey: string) {
  const haystack = searchableCompanyText(fundamentals, quoteKey)
  return sectorOperatingRules.find((rule) => rule.match.some((term) => haystack.includes(term)))
}

function isSseLikeInstrument(fundamentals: CompanyFundamentals | undefined, quoteKey: string) {
  const haystack = searchableCompanyText(fundamentals, quoteKey)
  return ['social stock', 'zczp', 'zero coupon zero principal', 'non profit', 'npo ', 'development impact', 'donation'].some((term) =>
    haystack.includes(term),
  )
}

function isSpecialListedInstrument(fundamentals: CompanyFundamentals | undefined, holding: Holding | undefined, quoteKey: string) {
  const text = [
    quoteKey,
    fundamentals?.name,
    fundamentals?.business_summary,
    holding?.tradingsymbol,
    holding?.sector,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const isPartlyPaid = ['partly paid', 'partly-paid', 'partlypaid', '-e1', ' pp'].some((term) => text.includes(term))
  const isDebtClass = (holding?.sector ?? '').trim().toUpperCase() === 'DEBT'
  return isPartlyPaid || isDebtClass
}

function processDisciplineScore(form: AnalysisForm, riskPlanDefined: boolean, rewardRisk: number | undefined) {
  const hasDeployableOrAddMoreCapital = Boolean(parseNumber(form.capital))
  const maxRiskApplies = !form.alreadyHold || hasDeployableOrAddMoreCapital
  let score = 42
  if (form.ticker.trim()) score += 5
  if (form.alreadyHold || hasDeployableOrAddMoreCapital) score += 8
  if (maxRiskApplies && parseNumber(form.maxRisk)) score += 8
  if (riskPlanDefined) score += 14
  if (parseNumber(form.targetPrice)) score += 6
  if (rewardRisk !== undefined) score += rewardRisk >= 2 ? 10 : rewardRisk >= 1.5 ? 5 : -7
  if (form.thesis.trim().length > 30) score += 5
  if (!form.alreadyHold && !hasDeployableOrAddMoreCapital) score -= 12
  return clamp(score)
}

function tradingRule(ruleId: string) {
  return tradingDerivedRules.find((rule) => rule.id === ruleId)
}

function compactRuleValue(rule: TradingDerivedRule) {
  if (rule.module === 'sector') return 'Business driver'
  if (rule.module === 'instrument') return 'Instrument caution'
  if (rule.module === 'capital') return 'Money boundary'
  return 'Action plan'
}

function tradingRuleScore(rule: TradingDerivedRule, processScore: number) {
  if (rule.module === 'process') {
    return rule.tone === 'negative' ? Math.min(48, processScore) : Math.max(42, processScore)
  }
  if (rule.tone === 'negative') return 34
  if (rule.tone === 'positive') return 62
  return 52
}

function tradingRuleWeight(rule: TradingDerivedRule) {
  return Math.round((0.26 + Math.abs(rule.scoreImpact) * 0.35) * 100) / 100
}

function publicRuleCategory(rule: TradingDerivedRule): TradingLesson['module'] {
  if (rule.module === 'sector') return 'Sector'
  if (rule.module === 'instrument') return 'Instrument'
  if (rule.module === 'capital') return 'Capital'
  return 'Process'
}

function displayTradingDomain(rule: TradingDerivedRule): TradingLesson['module'] {
  return publicRuleCategory(rule)
}

function tradingLessonLabel(lesson: TradingLesson) {
  if (lesson.module === 'Sector') return 'Business driver'
  if (lesson.module === 'Instrument') return 'Instrument caution'
  if (lesson.module === 'Capital') return 'Money boundary'
  return 'Action plan'
}

function selectTradingRulesForAnalysis(options: {
  form: AnalysisForm
  fundamentals?: CompanyFundamentals
  riskPlanDefined: boolean
  rewardRisk?: number
  sectorRule?: SectorRule
  sseLike: boolean
  processScore: number
}) {
  const selected: TradingDerivedRule[] = []
  const add = (ruleId: string) => {
    const rule = tradingRule(ruleId)
    if (rule && !selected.some((item) => item.id === rule.id)) selected.push(rule)
  }

  add('process_process_before_outcome')
  if (!options.riskPlanDefined || options.rewardRisk === undefined || options.rewardRisk < 1.5) add('process_accept_risk_loss')
  if (options.processScore < 58 || !options.form.thesis.trim()) add('process_objectivity_facts')
  if (!options.form.alreadyHold && !parseNumber(options.form.capital)) add('process_capital_size_matters')
  if (options.form.riskProfile === 'aggressive' || options.form.riskProfile === 'balanced_aggressive') add('process_impulse_control')
  if (options.processScore < 52) add('process_flexible_stand_aside')
  if (options.processScore < 48) add('process_stress_resilience')

  const sectorLabel = options.sectorRule?.label.toLowerCase() ?? ''
  if (sectorLabel.includes('auto')) add('sector_auto_operating_lens')
  else if (sectorLabel.includes('bank') || sectorLabel.includes('lender')) add('sector_banking_asset_quality')
  else if (sectorLabel.includes('information technology')) add('sector_it_margin_client_lens')
  else if (sectorLabel.includes('cement') || sectorLabel.includes('steel') || sectorLabel.includes('metal')) add('sector_cyclical_cost_capacity')
  else if (sectorLabel.includes('hotel') || sectorLabel.includes('retail')) add('sector_consumer_store_lens')
  else if (sectorLabel.includes('real estate')) add('sector_real_estate_cash_flow')

  add('capital_goal_money_separation')
  if (options.form.horizon === '1-3y' || options.form.horizon === '3y+') add('capital_asset_allocation_horizon')
  if (!options.form.alreadyHold && parseNumber(options.form.capital)) add('capital_liquidity_tax_lockin')
  if (options.sseLike) {
    add('instrument_instrument_type_filter')
    add('instrument_zczp_no_normal_return')
  }

  return selected.slice(0, 9)
}

function buildTradingLessons(
  form: AnalysisForm,
  fundamentals: CompanyFundamentals | undefined,
  riskPlanDefined: boolean,
  rewardRisk: number | undefined,
  sectorRule: SectorRule | undefined,
  sseLike: boolean,
  selectedRules: readonly TradingDerivedRule[],
): TradingLesson[] {
  const processScore = processDisciplineScore(form, riskPlanDefined, rewardRisk)
  const lessons: TradingLesson[] = [
    {
      module: 'Process',
      title: 'Plan before reacting',
      tone: toneFromScore(processScore),
      text:
        processScore >= 62
          ? 'Your setup has enough structure to reduce impulsive buying or panic selling. That helps you wait for confirmation instead of reacting to one candle.'
          : 'The plan is still incomplete. Without a clear thesis, exit line, and maximum loss, price noise can push you into emotional buying or selling.',
      action: riskPlanDefined
        ? 'Keep the invalidation line visible and do not change it after price moves against you unless the thesis genuinely changes.'
        : 'Before buying, define the invalidation line, target zone, and maximum rupee loss. Without those, quantity is only a guess.',
    },
    {
      module: 'Sector',
      title: sectorRule ? `${sectorRule.label} drivers checked` : 'Sector drivers pending',
      tone: sectorRule && fundamentals ? 'positive' : 'neutral',
      text: sectorRule
        ? `${sectorRule.text} Cross-check ${sectorRule.metrics.join(', ')} before assuming the price can sustain a rerating.`
        : 'The company did not map cleanly to a specialised operating checklist. Treat broad ratios as a first pass and verify sector-specific drivers manually.',
      action: sectorRule
        ? 'Use the sector checklist before increasing position size; a chart bounce is weaker if the operating drivers are deteriorating.'
        : 'If this is a sector with special metrics, add them in the thesis field or verify them from filings before treating the verdict as high conviction.',
    },
    {
      module: 'Capital',
      title: 'Goal money separation',
      tone: 'neutral',
      text:
        'Retirement, emergency, or fixed-goal money should not be treated like trade capital. Mixing them can force bad exits when price moves against you.',
      action:
        'Use the capital field only for deployable market capital. Keep retirement allocations, emergency funds, and fixed-goal money outside this decision unless you deliberately mark them as investable risk capital.',
    },
    {
      module: 'Instrument',
      title: sseLike ? 'Special instrument caution' : 'Standard equity workflow',
      tone: sseLike ? 'negative' : 'neutral',
      text: sseLike
        ? 'This looks like a non-standard or social-impact style instrument. Normal buy/sell/hold stock logic may not apply.'
        : 'The symbol looks suitable for the normal NSE/BSE equity workflow from the current data.',
      action: sseLike
        ? 'Do not use chart patterns or ordinary valuation ratios alone. Confirm instrument type, liquidity, redemption terms, disclosures, and whether financial return is even the right objective.'
        : 'No special instrument handling is needed from the current data.',
    },
  ]
  selectedRules.forEach((rule) => {
    if (lessons.some((lesson) => lesson.title === rule.title && lesson.module === displayTradingDomain(rule))) return
    lessons.push({
      module: displayTradingDomain(rule),
      title: rule.title,
      tone: rule.tone,
      text: rule.principle,
      action: `${rule.action} Caution: ${rule.caution}`,
    })
  })
  return lessons
}

function dailyVolatilityPct(candles: Candle[], lookback = 90) {
  const window = candles.slice(-lookback).filter((candle) => candle.close > 0)
  if (window.length < 3) return undefined
  const returns = window
    .slice(1)
    .map((candle, index) => {
      const previous = window[index].close
      return previous ? ((candle.close - previous) / previous) * 100 : undefined
    })
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
  if (returns.length < 2) return undefined
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / returns.length
  return Math.sqrt(variance)
}

function annualizedTrendPct(candles: Candle[], lookback: number) {
  const trend = candleTrendPct(candles, lookback)
  if (trend === undefined || lookback <= 0) return undefined
  return clamp((trend / lookback) * 252, -60, 80)
}

function decimalToAnnualPct(value?: number) {
  if (value === undefined) return undefined
  return Math.abs(value) <= 1 ? value * 100 : value
}

function compoundAnnualReturnPct(annualReturnPct: number, years: number) {
  const safeYears = Math.max(years, 1 / 252)
  return (Math.pow(Math.max(0.05, 1 + annualReturnPct / 100), safeYears) - 1) * 100
}

function priceFromReturn(startPrice: number, totalReturnPct: number) {
  return Math.max(0.01, startPrice * (1 + totalReturnPct / 100))
}

function buildForecastPoints(startPrice: number, endPrice: number, horizon: ForecastHorizon) {
  const labels: Record<ForecastHorizon, string[]> = {
    '5D': ['Today', '+1D', '+2D', '+3D', '+5D'],
    '15D': ['Today', '+4D', '+8D', '+11D', '+15D'],
    '1M': ['Today', '+1W', '+2W', '+3W', '+1M'],
    '6M': ['Today', '+6W', '+3M', '+4.5M', '+6M'],
    '1Y': ['Today', '+3M', '+6M', '+9M', '+1Y'],
    '3Y': ['Today', '+9M', '+18M', '+27M', '+3Y'],
    '5Y': ['Today', '+15M', '+2.5Y', '+45M', '+5Y'],
    '10Y': ['Today', '+2.5Y', '+5Y', '+7.5Y', '+10Y'],
  }
  return labels[horizon].map((label, index) => {
    const progress = index / (labels[horizon].length - 1)
    const curvedProgress = progress === 0 || progress === 1 ? progress : progress * 0.88 + progress ** 1.4 * 0.12
    return {
      label,
      price: startPrice + (endPrice - startPrice) * curvedProgress,
      progress,
    }
  })
}

function componentScore(analysis: AnalysisResult, label: string) {
  return analysis.scoreComponents.find((component) => component.label === label)?.score
}

function buildScenarioForecast(
  candles: Candle[],
  analysis: AnalysisResult,
  fundamentals: CompanyFundamentals | undefined,
  settings: ForecastSettings,
): ForecastProjection | undefined {
  if (!settings.enabled) return undefined
  const startPrice = analysis.ltp ?? latestCandle(candles)?.close
  if (!startPrice) return undefined

  const horizon = forecastHorizons[settings.horizon]
  const years = Math.max(horizon.years, 1 / 252)
  const volatilityMultiplier = clamp(parseNumber(settings.volatilityMultiplier) ?? 1, 0.2, 3)
  const trendWeight = clamp(parseNumber(settings.trendWeight) ?? 55, 0, 100) / 100
  const valuationShift = clamp(parseNumber(settings.valuationShift) ?? 0, -75, 150)
  const eventRiskAdjustment = settings.eventRisk === 'low' ? 2 : settings.eventRisk === 'high' ? -6 : 0
  const eventRiskRangeBoost = settings.eventRisk === 'low' ? 0.85 : settings.eventRisk === 'high' ? 1.35 : 1
  const technicalScore = componentScore(analysis, 'Technical structure') ?? analysis.score
  const fundamentalScore = componentScore(analysis, 'Fundamental quality') ?? analysis.score
  const statementScore = componentScore(analysis, 'Statement flow') ?? analysis.score
  const recentTrendAnnual =
    annualizedTrendPct(candles, horizon.tradingDays <= 22 ? 22 : horizon.tradingDays <= 126 ? 66 : 126) ??
    annualizedTrendPct(candles, Math.min(candles.length, 252)) ??
    0
  const dailyVol = dailyVolatilityPct(candles) ?? 2.4
  const manualGrowth = parseNumber(settings.fundamentalGrowth)
  const fetchedGrowthValues = [
    decimalToAnnualPct(numberFrom(fundamentals?.earnings_growth)),
    decimalToAnnualPct(numberFrom(fundamentals?.revenue_growth)),
  ].filter((value): value is number => value !== undefined)
  const fetchedGrowth = fetchedGrowthValues.length ? fetchedGrowthValues.reduce((sum, value) => sum + value, 0) / fetchedGrowthValues.length : undefined
  const qualityTilt = ((fundamentalScore + statementScore) / 2 - 50) * 0.35
  const verdictTilt = (analysis.score - 50) * 0.28
  const technicalAnnual = clamp(recentTrendAnnual * trendWeight + (technicalScore - 50) * 0.45 + eventRiskAdjustment, -55, 75)
  const fundamentalAnnual = clamp((manualGrowth ?? fetchedGrowth ?? 10) + qualityTilt + eventRiskAdjustment, -35, 45)
  const horizonTechnicalWeight = horizon.tradingDays <= 22 ? 0.78 : horizon.tradingDays <= 126 ? 0.58 : horizon.tradingDays <= 252 ? 0.42 : 0.24
  const adaptiveAnnual = clamp(
    technicalAnnual * horizonTechnicalWeight + fundamentalAnnual * (1 - horizonTechnicalWeight) + verdictTilt * 0.45,
    -45,
    65,
  )
  const baseAnnual =
    settings.mode === 'technical'
      ? technicalAnnual
      : settings.mode === 'fundamental'
        ? fundamentalAnnual
        : settings.mode === 'custom'
          ? clamp(parseNumber(settings.customBaseAnnualReturn) ?? 12, -80, 120)
          : adaptiveAnnual
  const baseTotal =
    settings.mode === 'technical'
      ? compoundAnnualReturnPct(baseAnnual, years)
      : settings.mode === 'custom'
        ? compoundAnnualReturnPct(baseAnnual, years)
        : compoundAnnualReturnPct(baseAnnual, years) + valuationShift
  const statisticalRange = clamp(dailyVol * Math.sqrt(horizon.tradingDays) * volatilityMultiplier * eventRiskRangeBoost, 3, settings.mode === 'fundamental' ? 95 : 130)
  const longRangeBoost = horizon.tradingDays > 252 ? Math.min(1.45, Math.sqrt(years) * 0.55) : 1
  const rangeTotal = clamp(statisticalRange * longRangeBoost, 3, 180)
  const customBearAnnual = clamp(parseNumber(settings.customBearAnnualReturn) ?? -10, -90, 120)
  const customBullAnnual = clamp(parseNumber(settings.customBullAnnualReturn) ?? 25, -90, 180)
  const bearTotal = settings.mode === 'custom' ? compoundAnnualReturnPct(customBearAnnual, years) : baseTotal - rangeTotal
  const bullTotal = settings.mode === 'custom' ? compoundAnnualReturnPct(customBullAnnual, years) : baseTotal + rangeTotal
  const orderedBear = Math.min(bearTotal, baseTotal, bullTotal)
  const orderedBull = Math.max(bearTotal, baseTotal, bullTotal)
  const orderedBase = clamp(baseTotal, orderedBear, orderedBull)
  const cases: ForecastCase[] = [
    {
      key: 'bear',
      label: 'Bear case',
      tone: 'negative',
      endPrice: priceFromReturn(startPrice, orderedBear),
      endReturn: orderedBear,
      annualReturn: settings.mode === 'custom' ? customBearAnnual : baseAnnual - rangeTotal / years,
      points: buildForecastPoints(startPrice, priceFromReturn(startPrice, orderedBear), settings.horizon),
      rationale: 'Uses the downside side of volatility/risk bands, or your custom bear return if custom mode is selected.',
    },
    {
      key: 'base',
      label: 'Base case',
      tone: toneFromScore(50 + orderedBase / Math.max(years, 0.25)),
      endPrice: priceFromReturn(startPrice, orderedBase),
      endReturn: orderedBase,
      annualReturn: baseAnnual,
      points: buildForecastPoints(startPrice, priceFromReturn(startPrice, orderedBase), settings.horizon),
      rationale: 'Central scenario from the selected method. Treat it as a working range, not a promised target.',
    },
    {
      key: 'bull',
      label: 'Bull case',
      tone: 'positive',
      endPrice: priceFromReturn(startPrice, orderedBull),
      endReturn: orderedBull,
      annualReturn: settings.mode === 'custom' ? customBullAnnual : baseAnnual + rangeTotal / years,
      points: buildForecastPoints(startPrice, priceFromReturn(startPrice, orderedBull), settings.horizon),
      rationale: 'Uses the upside side of volatility/risk bands, or your custom bull return if custom mode is selected.',
    },
  ]
  const rangeLabel = `${formatInr(cases[0].endPrice)} to ${formatInr(cases[2].endPrice)}`
  const confidenceParts = [
    analysis.confidenceLabel,
    candles.length >= 180 ? 'good candle depth' : candles.length ? 'limited candle depth' : 'no candle depth',
    fundamentals ? 'fundamentals loaded' : 'fundamentals missing',
  ]

  return {
    assumptions: [
      `Mode: ${forecastModeLabels[settings.mode].label}`,
      `Volatility multiplier: ${volatilityMultiplier.toFixed(2)}x`,
      `Trend influence: ${Math.round(trendWeight * 100)}%`,
      `Fundamental growth: ${manualGrowth === undefined ? `${formatPercent(fetchedGrowth)} fetched/default` : `${manualGrowth.toFixed(2)}% manual`}`,
      `Valuation rerating over horizon: ${formatPercent(valuationShift)}`,
      `Event risk: ${eventRiskLabels[settings.eventRisk]}`,
    ],
    confidence: confidenceParts.join(' | '),
    horizon: settings.horizon,
    horizonLabel: horizon.label,
    mode: settings.mode,
    modeLabel: forecastModeLabels[settings.mode].label,
    rangeLabel,
    tradingDays: horizon.tradingDays,
    years,
    cases,
  }
}

function normaliseDebtEquity(value?: unknown) {
  const numeric = numberFrom(value)
  if (numeric === undefined) return undefined
  return numeric > 10 ? numeric / 100 : numeric
}

function inferProfitTrend(earningsGrowth?: number, revenueGrowth?: number, netProfit?: number): ProfitTrend {
  if (netProfit !== undefined && netProfit < 0) return 'loss_making'
  if (earningsGrowth !== undefined) {
    if (earningsGrowth > 0.08) return 'growing'
    if (earningsGrowth < -0.08) return 'declining'
    return netProfit !== undefined && netProfit > 0 ? 'stable' : 'unknown'
  }
  if (revenueGrowth !== undefined) {
    if (revenueGrowth > 0.08) return 'growing'
    if (revenueGrowth < -0.08) return 'declining'
    return netProfit !== undefined && netProfit > 0 ? 'stable' : 'unknown'
  }
  return netProfit !== undefined && netProfit > 0 ? 'stable' : 'unknown'
}

function findQuote(snapshot: Snapshot, exchange: Exchange, ticker: string) {
  const cleanTicker = ticker.trim().toUpperCase()
  const exactKey = `${exchange}:${cleanTicker}`
  if (snapshot.quotes[exactKey]) {
    return { key: exactKey, quote: snapshot.quotes[exactKey] }
  }
  const fallback = Object.entries(snapshot.quotes).find(([key]) => key.endsWith(`:${cleanTicker}`))
  return fallback ? { key: fallback[0], quote: fallback[1] } : { key: exactKey, quote: undefined }
}

function findHolding(snapshot: Snapshot, exchange: Exchange, ticker: string) {
  const cleanTicker = ticker.trim().toUpperCase()
  return snapshot.holdings.find(
    (holding) => holding.tradingsymbol?.toUpperCase() === cleanTicker && holding.exchange?.toUpperCase() === exchange,
  )
}

function portfolioSummary(snapshot: Snapshot) {
  return snapshot.holdings.reduce<{ value: number; cost: number; pnl: number }>(
    (summary, holding) => {
      summary.value += holdingValue(holding)
      summary.cost += holdingCost(holding)
      summary.pnl += holding.pnl ?? holdingValue(holding) - holdingCost(holding)
      return summary
    },
    { value: 0, cost: 0, pnl: 0 },
  )
}

function buildAnalysis(form: AnalysisForm, snapshot: Snapshot, cacheState: CacheState): AnalysisResult {
  const ticker = form.ticker.trim().toUpperCase()
  const capital = parseNumber(form.capital)
  const manualLtp = parseNumber(form.manualLtp)
  const { key: quoteKey, quote } = findQuote(snapshot, form.exchange, ticker)
  const holding = findHolding(snapshot, form.exchange, ticker)
  const ltp = manualLtp ?? quote?.last_price ?? holding?.last_price
  const quantity = form.alreadyHold ? (parseNumber(form.quantity) ?? holding?.quantity ?? 0) : 0
  const avgPrice = form.alreadyHold ? (parseNumber(form.averagePrice) ?? holding?.average_price ?? 0) : 0
  const positionValue = quantity && ltp ? quantity * ltp : undefined
  const positionCost = quantity && avgPrice ? quantity * avgPrice : undefined
  const positionPnl = positionValue !== undefined && positionCost !== undefined ? positionValue - positionCost : undefined
  const positionPnlPct = positionPnl !== undefined && positionCost ? (positionPnl / positionCost) * 100 : undefined
  const portfolio = portfolioSummary(snapshot)
  const portfolioWeight = positionValue && portfolio.value ? (positionValue / portfolio.value) * 100 : undefined
  const candles = snapshot.candles[quoteKey] ?? []
  const candleCount = candles.length
  const recentTrendPct = candleTrendPct(candles, 30)
  const avgVolume20 = averageVolume(candles, 20)
  const companyFundamentals = snapshot.fundamentals?.[quoteKey]
  const sectorRule = findSectorRule(companyFundamentals, quoteKey)
  const sseLikeInstrument = isSseLikeInstrument(companyFundamentals, quoteKey)
  const specialListedInstrument = isSpecialListedInstrument(companyFundamentals, holding, quoteKey)
  const companyMarketCap = numberFrom(companyFundamentals?.market_cap)
  const companyDebtEquity = normaliseDebtEquity(companyFundamentals?.debt_to_equity)
  const companyTrailingPe = numberFrom(companyFundamentals?.trailing_pe)
  const companyForwardPe = numberFrom(companyFundamentals?.forward_pe)
  const companyPriceToBook = numberFrom(companyFundamentals?.price_to_book)
  const companyRoe = numberFrom(companyFundamentals?.return_on_equity)
  const companyRoa = numberFrom(companyFundamentals?.return_on_assets)
  const companyRoce = numberFrom(companyFundamentals?.roce)
  const companyProfitMargin = numberFrom(companyFundamentals?.profit_margins)
  const companyGrossMargin = numberFrom(companyFundamentals?.gross_margins)
  const companyOperatingMargin = numberFrom(companyFundamentals?.operating_margins)
  const companyCurrentRatio = numberFrom(companyFundamentals?.current_ratio)
  const companyOperatingCashflow = numberFrom(companyFundamentals?.operating_cashflow)
  const companyFreeCashflow = numberFrom(companyFundamentals?.free_cashflow)
  const companyRevenue = numberFrom(companyFundamentals?.revenue)
  const companyNetProfit = numberFrom(companyFundamentals?.net_profit)
  const companyDividendYield = numberFrom(companyFundamentals?.dividend_yield)
  const companyRevenueGrowth = numberFrom(companyFundamentals?.revenue_growth)
  const companyEarningsGrowth = numberFrom(companyFundamentals?.earnings_growth)
  const inferredProfitTrend = inferProfitTrend(companyEarningsGrowth, companyRevenueGrowth, companyNetProfit)
  const effectiveProfitTrend = form.profitTrend === 'unknown' ? inferredProfitTrend : form.profitTrend
  const marketCapCr = parseNumber(form.marketCapCr) ?? (companyMarketCap === undefined ? undefined : companyMarketCap / 10000000)
  const debtEquity = parseNumber(form.debtEquity) ?? companyDebtEquity
  const roce = parseNumber(form.roce) ?? companyRoce
  const pe = parseNumber(form.pe) ?? companyTrailingPe
  const maxRisk = parseNumber(form.maxRisk)
  const invalidationPrice = parseNumber(form.invalidationPrice)
  const targetPrice = parseNumber(form.targetPrice)
  const decisionMode: AnalysisResult['decisionMode'] = form.alreadyHold ? 'holding-review' : 'fresh-entry'
  const defaultRiskPercent = defaultRiskPercentForProfile(form.riskProfile)
  const fallbackRiskCapital = capital ? capital * (defaultRiskPercent / 100) : undefined
  const riskCapital = capital
    ? maxRisk
      ? form.riskMode === 'percent'
        ? capital * (maxRisk / 100)
        : maxRisk
      : fallbackRiskCapital
    : undefined
  const capitalShares = capital && ltp ? Math.floor(capital / ltp) : undefined
  const starterShares = capitalShares ? Math.max(1, Math.floor(capitalShares * starterFractionForProfile(form.riskProfile))) : undefined
  const needsFreshCapital = !form.alreadyHold
  const riskPlanDefined = Boolean(invalidationPrice && (form.alreadyHold || riskCapital))

  const missing: string[] = []
  if (!ticker) missing.push('Ticker')
  if (needsFreshCapital && !capital) missing.push('Capital for new position')
  if (!ltp) missing.push('LTP from loaded market data or manual input')
  if (form.alreadyHold && !quantity) missing.push('Holding quantity')
  if (form.alreadyHold && !avgPrice) missing.push('Average buy price')

  let score = 50
  const positives: string[] = []
  const cautions: string[] = []
  const actions: string[] = []

  if (cacheState === 'sample') cautions.push('No personal market cache is loaded yet. Upload holdings or sync delayed market data before taking action.')
  if (cacheState === 'free') positives.push('Delayed end-of-day price data is cached for non-intraday analysis.')
  if (!quote) cautions.push('No quote was found in the current cache for this symbol.')
  if (form.alreadyHold && !form.boughtOn) {
    score -= 2
    cautions.push(
      'Bought date is missing, so the app cannot judge how long the thesis has had to work. Add it in Get Started if you know it; the verdict stays usable but time-in-position context is weaker.',
    )
  }
  if (candleCount >= 180) positives.push('Daily candles are available for trend and support/resistance checks.')
  if (candleCount === 0) cautions.push('No historical candles are cached yet, so the technical view is incomplete.')
  if (!companyFundamentals || Object.keys(companyFundamentals).length === 0) {
    cautions.push('Fundamental data is missing. The verdict treats this as lower confidence and incomplete evidence, not as proof that the company is weak.')
  }
  if (sectorRule) {
        positives.push(`Sector drivers checked: ${sectorRule.label} needs checks such as ${sectorRule.metrics.slice(0, 3).join(', ')}.`)
  }
  if (sseLikeInstrument) {
    cautions.push('Special-instrument filter triggered. Normal listed-equity buy/sell logic may not apply without checking instrument terms and disclosures.')
  }
  if (specialListedInstrument) {
    score -= 8
    cautions.push(
      'This looks like a special, partly-paid, or debt-class listed instrument. Ordinary equity chart and valuation signals are downgraded until instrument terms, call-money obligations, liquidity, and entitlement rules are checked.',
    )
  }

  if (form.riskProfile === 'conservative') score -= 5
  if (form.riskProfile === 'balanced_aggressive') score += 3
  if (form.riskProfile === 'aggressive') score += 5
  if (form.horizon === '1-3y' || form.horizon === '3y+') score += 3

  if (positionPnlPct !== undefined) {
    if (positionPnlPct < -50) {
      score -= 18
      cautions.push('The existing position is in a deep drawdown; breakeven needs a very large recovery.')
    } else if (positionPnlPct < -20) {
      score -= 10
      cautions.push('The position has a large unrealized loss and should not be averaged mechanically.')
    } else if (positionPnlPct < -8) {
      score -= 4
      cautions.push('The position is below cost; new buying needs a fresh thesis.')
    } else if (positionPnlPct > 12) {
      score += 5
      positives.push('The position is profitable, which gives more flexibility to trail risk.')
    }
  }

  if (portfolioWeight !== undefined) {
    if (portfolioWeight > 20) {
      score -= 8
      cautions.push('Portfolio concentration is high for one stock.')
    } else if (portfolioWeight > 12) {
      score -= 4
      cautions.push('Portfolio weight is meaningful; add only if conviction improves.')
    }
  }

  if (marketCapCr !== undefined) {
    if (form.constraints.avoidSmallCaps && marketCapCr < 1000) {
      score -= marketCapCr < 500 ? 12 : 8
      cautions.push('Market cap conflicts with the small-cap avoidance rule.')
    } else if (marketCapCr >= 10000) {
      score += 4
      positives.push('Market cap is comfortably above small-cap territory.')
    }
  }

  if (debtEquity !== undefined) {
    if (form.constraints.avoidHighDebt && debtEquity > 1) {
      score -= 12
      cautions.push('Debt/equity is high for the stated constraint.')
    } else if (debtEquity > 0.5) {
      score -= 4
      cautions.push('Debt is not excessive, but it deserves monitoring.')
    } else {
      score += 5
      positives.push('Debt/equity looks comfortable for a balance-sheet filter.')
    }
  }

  if (roce !== undefined) {
    if (roce >= 18) {
      score += 8
      positives.push('ROCE is strong, which usually signals better capital efficiency.')
    } else if (roce >= 10) {
      score += 3
      positives.push('ROCE is acceptable but not exceptional.')
    } else {
      score -= 7
      cautions.push('ROCE is weak, so capital efficiency is a concern.')
    }
  }

  if (pe !== undefined) {
    if (pe > 55) {
      score -= 5
      cautions.push('Valuation looks stretched on P/E unless growth quality is excellent.')
    } else if (pe > 0 && pe < 8) {
      score -= 3
      cautions.push('Very low P/E can indicate risk or cyclicality, not just cheapness.')
    } else if (pe > 8 && pe < 30) {
      score += 2
      positives.push('P/E is within a more workable range.')
    }
  }

  if (effectiveProfitTrend === 'growing') {
    score += 8
    positives.push(form.profitTrend === 'unknown' ? 'Profit trend is inferred as growing from fetched company data.' : 'Profit trend is marked as growing.')
  }
  if (effectiveProfitTrend === 'declining') {
    score -= 8
    cautions.push(form.profitTrend === 'unknown' ? 'Profit trend is inferred as declining from fetched company data.' : 'Profit trend is declining.')
  }
  if (effectiveProfitTrend === 'loss_making') {
    score -= 15
    cautions.push(form.profitTrend === 'unknown' ? 'Fetched company data indicates loss-making status, which is a major quality red flag.' : 'Loss-making status is a major quality red flag.')
  }
  if (effectiveProfitTrend === 'stable') {
    score += 2
    positives.push(form.profitTrend === 'unknown' ? 'Profit trend is inferred as stable from fetched company data.' : 'Profit trend is stable.')
  }

  if (form.constraints.avoidLowLiquidity && quote?.volume !== undefined && quote.volume > 0 && quote.volume < 25000) {
    score -= 7
    cautions.push('Volume is low, so entries and exits may need limit orders.')
  }

  if (form.constraints.noAveragingDown && positionPnlPct !== undefined && positionPnlPct < -15) {
    actions.push('Do not average down until business quality and price structure both improve.')
  }

  if (riskCapital && ltp && invalidationPrice && invalidationPrice < ltp) {
    const riskPerShare = ltp - invalidationPrice
    const suggestedShares = Math.floor(riskCapital / riskPerShare)
    if (suggestedShares > 0) {
      actions.push(`Risk-based size is up to ${suggestedShares} shares if invalidation is ${formatInr(invalidationPrice)}.`)
    }
  } else if (form.alreadyHold && !capital) {
    actions.push('Capital is optional for a holding review. Add fresh capital only if you want add-more sizing.')
  } else {
    actions.push('Add an invalidation price to calculate risk-based share quantity.')
  }

  if (targetPrice && ltp && invalidationPrice && invalidationPrice < ltp) {
    const reward = targetPrice - ltp
    const risk = ltp - invalidationPrice
    const rr = reward / risk
    if (rr >= 2) positives.push(`Reward/risk is ${rr.toFixed(1)}x based on the target and invalidation prices.`)
    if (rr > 0 && rr < 1.5) cautions.push(`Reward/risk is only ${rr.toFixed(1)}x; entry may need a better price.`)
  }

  if (form.tradeAccess !== 'delivery' && form.alreadyHold && positionPnlPct !== undefined && positionPnlPct < -20) {
    actions.push('Use F&O only for hedging context; avoid converting a weak cash thesis into leveraged exposure.')
  }

  const normalisedCandles = candles.map(normaliseCandle)
  const verdictWindow = normalisedCandles.slice(-252)
  const closeForSignals = ltp ?? latestCandle(verdictWindow)?.close
  const sma20 = latestDefined(movingAverage(verdictWindow, 20))
  const sma50 = latestDefined(movingAverage(verdictWindow, 50))
  const sma200 = latestDefined(movingAverage(verdictWindow, 200))
  const ema20 = latestDefined(exponentialMovingAverage(verdictWindow.map((candle) => candle.close), 20))
  const ema50 = latestDefined(exponentialMovingAverage(verdictWindow.map((candle) => candle.close), 50))
  const verdictVwap = latestDefined(vwapSeries(verdictWindow.slice(-90)))
  const verdictRsi = latestDefined(rsiSeries(verdictWindow, 14))
  const verdictMacd = macdSeries(verdictWindow)
  const verdictMacdValue = latestDefined(verdictMacd.macd)
  const verdictMacdSignal = latestDefined(verdictMacd.signal)
  const verdictMacdHistogram = latestDefined(verdictMacd.histogram)
  const verdictAtr = latestDefined(atrSeries(verdictWindow, 14))
  const verdictAtrPct = verdictAtr && closeForSignals ? (verdictAtr / closeForSignals) * 100 : undefined
  const verdictBands = bollingerBands(verdictWindow, 20, 2)
  const bbUpper = latestDefined(verdictBands.upper)
  const bbMiddle = latestDefined(verdictBands.middle)
  const bbLower = latestDefined(verdictBands.lower)
  const verdictPatternWindow = verdictWindow.slice(-80)
  const verdictPatterns = detectCandlestickPatterns(verdictPatternWindow).slice(-6)

  const technicalSignals: AdaptiveSignal[] = []
  addSignal(
    technicalSignals,
    'Technical',
    '30-day trend',
    formatPercent(recentTrendPct),
    scoreMetric(recentTrendPct, (value) => (value > 8 ? 78 : value > 3 ? 66 : value > -3 ? 52 : value > -10 ? 40 : 28)),
    1.15,
    'Trend context matters because price strength is more useful when it agrees with the intended direction.',
  )
  const maVotes = [sma20, sma50, sma200, ema20, ema50].filter((average) => average !== undefined)
  const maPositiveVotes = maVotes.filter((average) => closeForSignals !== undefined && closeForSignals >= average).length
  addSignal(
    technicalSignals,
    'Technical',
    'Moving-average structure',
    maVotes.length ? `${maPositiveVotes}/${maVotes.length} reclaimed` : '-',
    maVotes.length ? 35 + (maPositiveVotes / maVotes.length) * 42 : 48,
    1.05,
    'SMA/EMA alignment checks whether price is above commonly watched trend references instead of fighting the broader trend.',
  )
  addSignal(
    technicalSignals,
    'Technical',
    'RSI 14',
    formatNumber(verdictRsi),
    scoreMetric(verdictRsi, (value) => (value >= 50 && value <= 68 ? 72 : value >= 42 && value < 50 ? 58 : value > 68 && value <= 76 ? 58 : value < 32 || value > 82 ? 34 : 46)),
    0.8,
    'RSI is treated as momentum context, not a standalone buy/sell rule. Extremely stretched or very weak readings can make price pull back or stall.',
  )
  addSignal(
    technicalSignals,
    'Technical',
    'MACD momentum',
    verdictMacdValue === undefined || verdictMacdSignal === undefined ? '-' : `${verdictMacdValue.toFixed(2)} / ${verdictMacdSignal.toFixed(2)}`,
    verdictMacdValue === undefined || verdictMacdSignal === undefined
      ? 48
      : verdictMacdValue > verdictMacdSignal && (verdictMacdHistogram ?? 0) >= 0
        ? 70
        : verdictMacdValue > verdictMacdSignal
          ? 60
          : 38,
    0.8,
    'MACD adds trend-momentum confirmation. Positive MACD versus signal supports holding/add setups; negative alignment asks for caution.',
  )
  addSignal(
    technicalSignals,
    'Technical',
    'ATR risk',
    verdictAtrPct === undefined ? '-' : `${formatInr(verdictAtr)} / ${formatPercent(verdictAtrPct)}`,
    scoreMetric(verdictAtrPct, (value) => (value <= 3 ? 68 : value <= 6 ? 54 : value <= 9 ? 42 : 30)),
    0.75,
    'ATR measures normal daily movement. High ATR means stops and position size need more room, so uncontrolled risk is penalised.',
  )
  addSignal(
    technicalSignals,
    'Technical',
    'VWAP acceptance',
    formatInr(verdictVwap),
    closeForSignals === undefined || verdictVwap === undefined ? 48 : closeForSignals >= verdictVwap ? 65 : 40,
    0.65,
    'VWAP is used as a participation-weighted reference. Price above displayed-window VWAP means buyers are accepting higher prices.',
  )
  const bollingerScore =
    closeForSignals === undefined || bbUpper === undefined || bbMiddle === undefined || bbLower === undefined
      ? 48
      : closeForSignals < bbLower
        ? 34
        : closeForSignals < bbMiddle
          ? 43
          : closeForSignals <= bbUpper
            ? 64
            : 52
  addSignal(
    technicalSignals,
    'Technical',
    'Bollinger position',
    closeForSignals === undefined || bbMiddle === undefined ? '-' : `${formatInr(closeForSignals)} vs mid ${formatInr(bbMiddle)}`,
    bollingerScore,
    0.65,
    'Bollinger Bands measure volatility and price location. Above the middle band is healthier; below the lower band is weak unless reversal confirms.',
  )
  const bullishPatterns = verdictPatterns.filter((signal) => signal.bias === 'bullish').length
  const bearishPatterns = verdictPatterns.filter((signal) => signal.bias === 'bearish').length
  addSignal(
    technicalSignals,
    'Technical',
    'Candlestick patterns',
    verdictPatterns.length ? `${bullishPatterns} bullish / ${bearishPatterns} bearish` : 'None recent',
    verdictPatterns.length ? clamp(50 + bullishPatterns * 10 - bearishPatterns * 12) : 50,
    0.65,
    'Candlestick patterns are alerts, not commands. They matter most when they appear at support/resistance with confirmation.',
  )
  verdictPatterns.forEach((signal, patternIndex) => {
    const candleDate = verdictPatternWindow[signal.index]?.date
    const patternScore = signal.bias === 'bullish' ? 62 : signal.bias === 'bearish' ? 38 : 50
    addSignal(
      technicalSignals,
      'Technical',
      `Pattern ${patternIndex + 1}: ${signal.name}`,
      `${signal.kind}${candleDate ? ` on ${candleDate}` : ''} | ${signal.bias}`,
      patternScore,
      0.18,
      `${signal.explanation} ${signal.action} ${signal.stopHint}`,
    )
  })
  addSignal(
    technicalSignals,
    'Technical',
    'Liquidity',
    formatNumber(avgVolume20),
    scoreMetric(avgVolume20, (value) => (value >= 100000 ? 72 : value >= 25000 ? 56 : value > 0 ? 32 : 42)),
    1,
    'Liquidity affects execution and exit risk. A technically attractive stock can still be dangerous if traded volume is thin.',
  )

  const fundamentalSignals: AdaptiveSignal[] = []
  addSignal(
    fundamentalSignals,
    'Process',
    'Sector-specific checklist',
    sectorRule ? sectorRule.label : 'Pending',
    sectorRule && companyFundamentals ? 62 : sectorRule ? 54 : 47,
    0.55,
    sectorRule
      ? `${sectorRule.text} Check ${sectorRule.metrics.join(', ')} before assuming the business can support higher prices.`
      : 'The app could not map this company to a specialised sector checklist, so sector-specific operating metrics need manual review.',
  )
  addSignal(fundamentalSignals, 'Fundamental', 'Market cap', marketCapCr === undefined ? '-' : `${formatNumber(marketCapCr)} cr`, scoreMetric(marketCapCr, (value) => (value >= 10000 ? 74 : value >= 1000 ? 56 : value >= 500 ? 42 : 30)), 0.8, 'Company size influences disclosure depth, liquidity, and fragility.')
  addSignal(fundamentalSignals, 'Fundamental', 'Trailing P/E', formatNumber(companyTrailingPe), scoreMetric(companyTrailingPe, (value) => (value > 8 && value < 30 ? 66 : value >= 30 && value <= 55 ? 50 : value > 55 ? 34 : value > 0 ? 42 : 35)), 0.75, 'P/E is valuation context and must be read with growth and earnings quality.')
  addSignal(fundamentalSignals, 'Fundamental', 'Forward P/E', formatNumber(companyForwardPe), scoreMetric(companyForwardPe, (value) => (value > 8 && value < 28 ? 66 : value >= 28 && value <= 50 ? 50 : value > 50 ? 34 : value > 0 ? 42 : 35)), 0.55, 'Forward P/E is useful when estimates are credible, but optimism deserves caution.')
  addSignal(fundamentalSignals, 'Fundamental', 'Price/book', formatNumber(companyPriceToBook), scoreMetric(companyPriceToBook, (value) => (value > 0 && value <= 4 ? 64 : value <= 10 ? 50 : 35)), 0.45, 'P/B helps more in asset-heavy businesses, but very high P/B raises expectation risk.')
  addSignal(fundamentalSignals, 'Fundamental', 'ROE', formatDecimalPercent(companyRoe), scoreMetric(companyRoe, (value) => (value >= 0.15 ? 72 : value >= 0.08 ? 58 : value >= 0 ? 42 : 28)), 0.8, 'ROE shows return on shareholder capital, but high debt can inflate it.')
  addSignal(fundamentalSignals, 'Fundamental', 'ROCE', formatPercent(roce), scoreMetric(roce, (value) => (value >= 18 ? 78 : value >= 10 ? 60 : value >= 6 ? 42 : 30)), 1.05, 'ROCE checks return on total capital employed; stronger ROCE helps the market trust higher valuations.')
  addSignal(fundamentalSignals, 'Fundamental', 'ROA', formatDecimalPercent(companyRoa), scoreMetric(companyRoa, (value) => (value >= 0.08 ? 70 : value >= 0.03 ? 55 : value >= 0 ? 42 : 28)), 0.5, 'ROA helps judge how productively the company uses its asset base.')
  addSignal(fundamentalSignals, 'Fundamental', 'Profit margin', formatDecimalPercent(companyProfitMargin), scoreMetric(companyProfitMargin, (value) => (value >= 0.1 ? 70 : value >= 0.03 ? 55 : value >= 0 ? 42 : 25)), 0.7, 'Profit margin captures how much revenue survives as profit.')
  addSignal(fundamentalSignals, 'Fundamental', 'Gross margin', formatDecimalPercent(companyGrossMargin), scoreMetric(companyGrossMargin, (value) => (value >= 0.25 ? 68 : value >= 0.1 ? 54 : value >= 0 ? 42 : 28)), 0.45, 'Gross margin helps detect raw-material or execution pressure.')
  addSignal(fundamentalSignals, 'Fundamental', 'Operating margin', formatDecimalPercent(companyOperatingMargin), scoreMetric(companyOperatingMargin, (value) => (value >= 0.12 ? 70 : value >= 0.05 ? 55 : value >= 0 ? 42 : 28)), 0.7, 'Operating margin focuses on the core business before finance and tax effects.')
  addSignal(fundamentalSignals, 'Fundamental', 'Debt/equity', formatNumber(debtEquity), scoreMetric(debtEquity, (value) => (value <= 0.5 ? 76 : value <= 1 ? 58 : value <= 1.5 ? 44 : 28)), 1.05, 'Debt/equity is penalised strongly because leverage can turn a temporary slowdown into permanent damage.')
  addSignal(fundamentalSignals, 'Fundamental', 'Current ratio', formatNumber(companyCurrentRatio), scoreMetric(companyCurrentRatio, (value) => (value >= 1.2 && value <= 3 ? 66 : value >= 1 ? 54 : value > 3 ? 56 : 34)), 0.55, 'Current ratio is a short-term liquidity check.')
  addSignal(fundamentalSignals, 'Fundamental', 'FCF', formatLargeInr(companyFreeCashflow), scoreMetric(companyFreeCashflow, (value) => (value > 0 ? 70 : 30)), 0.95, 'FCF confirms whether accounting profits leave usable cash after capex.')
  addSignal(fundamentalSignals, 'Fundamental', 'Revenue', formatLargeInr(companyRevenue), companyRevenue === undefined ? 48 : companyRevenue > 0 ? 56 : 30, 0.35, 'Revenue gives scale; its quality depends on margins and cash conversion.')
  addSignal(fundamentalSignals, 'Fundamental', 'Net profit', formatLargeInr(companyNetProfit), scoreMetric(companyNetProfit, (value) => (value > 0 ? 66 : 28)), 0.75, 'Positive net profit supports quality, but it must be backed by cash flow.')
  addSignal(fundamentalSignals, 'Fundamental', 'Operating cash flow', formatLargeInr(companyOperatingCashflow), scoreMetric(companyOperatingCashflow, (value) => (value > 0 ? 72 : 28)), 0.95, 'CFO is important because profits without operating cash can be fragile.')
  addSignal(fundamentalSignals, 'Fundamental', 'Dividend yield', formatDecimalPercent(companyDividendYield), scoreMetric(companyDividendYield, (value) => (value > 0 && value <= 0.08 ? 58 : value > 0.15 ? 40 : 50)), 0.25, 'Dividend yield is a supporting clue, not a core buy signal.')
  addSignal(fundamentalSignals, 'Fundamental', 'Revenue growth', formatDecimalPercent(companyRevenueGrowth), scoreMetric(companyRevenueGrowth, (value) => (value > 0.08 ? 70 : value >= 0 ? 55 : 34)), 0.7, 'Sales growth is healthier when margins and cash flow also improve.')
  addSignal(fundamentalSignals, 'Fundamental', 'Earnings growth', formatDecimalPercent(companyEarningsGrowth), scoreMetric(companyEarningsGrowth, (value) => (value > 0.08 ? 72 : value >= 0 ? 55 : 30)), 0.85, 'Earnings growth helps future price only when it is not contradicted by weak cash flow.')

  const statementSignals: AdaptiveSignal[] = []
  const latestSales = latestStatementNumber(companyFundamentals, 'sales')
  const previousSales = previousStatementNumber(companyFundamentals, 'profit_loss', ['Sales'])
  const latestPat = latestStatementNumber(companyFundamentals, 'net_profit')
  const latestCfo = latestStatementNumber(companyFundamentals, 'cash_from_operations')
  const latestEps = latestStatementNumber(companyFundamentals, 'eps')
  const latestBorrowings = latestStatementNumber(companyFundamentals, 'borrowings')
  const latestReserves = latestStatementNumber(companyFundamentals, 'reserves')
  const latestNetCashFlow = latestStatementNumber(companyFundamentals, 'net_cash_flow')
  addSignal(statementSignals, 'Statements', 'Sales trend', latestSales === undefined ? '-' : `${formatNumber(latestSales)} cr`, latestSales === undefined || previousSales === undefined ? 48 : latestSales > previousSales ? 66 : 38, 0.75, 'P&L trend checks whether sales are expanding or shrinking versus the prior reported period.')
  addSignal(statementSignals, 'Statements', 'CFO vs PAT', latestCfo === undefined || latestPat === undefined ? '-' : `${formatNumber(latestCfo)} cr vs ${formatNumber(latestPat)} cr`, latestCfo === undefined || latestPat === undefined ? 48 : latestCfo > 0 && latestCfo >= latestPat * 0.65 ? 72 : latestCfo > 0 ? 54 : 28, 1.1, 'Profit is more trustworthy when operating cash flow broadly supports it.')
  addSignal(statementSignals, 'Statements', 'Reserves vs borrowings', latestReserves === undefined || latestBorrowings === undefined ? '-' : `${formatNumber(latestReserves)} cr / ${formatNumber(latestBorrowings)} cr`, latestReserves === undefined || latestBorrowings === undefined ? 48 : latestBorrowings <= latestReserves * 0.5 ? 72 : latestBorrowings <= latestReserves ? 56 : 34, 0.85, 'Balance-sheet strength improves when reserves comfortably exceed borrowings.')
  addSignal(statementSignals, 'Statements', 'EPS', formatNumber(latestEps), scoreMetric(latestEps, (value) => (value > 0 ? 64 : 28)), 0.55, 'EPS is a compact profitability clue, but it still needs valuation and cash-flow context.')
  addSignal(statementSignals, 'Statements', 'Net cash flow', latestNetCashFlow === undefined ? '-' : `${formatNumber(latestNetCashFlow)} cr`, scoreMetric(latestNetCashFlow, (value) => (value > 0 ? 62 : value > -100 ? 48 : 36)), 0.4, 'Net cash flow is noisy, but a very weak value asks for cash-flow review.')

  const newsSignals: AdaptiveSignal[] = []
  const updates = meaningfulCompanyUpdates(companyFundamentals?.company_updates)
  addSignal(
    newsSignals,
    'News',
    'Recent company updates',
    updates.length ? updates.map((update) => updateKind(update)).join(', ') : 'No major updates found',
    updateToneScore(updates),
    1,
    updates.length
      ? `Recent filings can change expectations before ratios catch up. ${updates.slice(0, 2).map(updatePriceImpact).join(' ')}`
      : 'No meaningful update was found in the fetched feed, so price still needs confirmation from chart, results, and filings.',
  )
  updates.slice(0, 3).forEach((update, updateIndex) => {
    const updateScore = update.tone === 'positive' ? 68 : update.tone === 'negative' ? 32 : 52
    addSignal(
      newsSignals,
      'News',
      `Update ${updateIndex + 1}: ${compactSignalText(update.title, 56) || 'Company update'}`,
      `${update.date ?? 'Recent'}${update.category ? ` | ${update.category}` : ''}`,
      updateScore,
      0.35,
      `${updateBusinessMeaning(update)} ${updatePriceImpact(update)}`,
    )
  })

  const riskSignals: AdaptiveSignal[] = []
  if (decisionMode === 'fresh-entry') {
    addSignal(
      riskSignals,
      'Risk',
      'Fresh quantity discipline',
      capitalShares === undefined ? '-' : `${formatNumber(starterShares)} starter / ${formatNumber(capitalShares)} max`,
      capitalShares === undefined ? 38 : starterShares !== undefined && starterShares < capitalShares ? 66 : 50,
      1,
      'Fresh-entry risk starts with not oversizing. The app favours staged buying unless the setup has a complete risk plan.',
    )
  } else {
    addSignal(riskSignals, 'Risk', 'Position drawdown', formatPercent(positionPnlPct), scoreMetric(positionPnlPct, (value) => (value > 12 ? 70 : value > -8 ? 56 : value > -20 ? 42 : value > -50 ? 28 : 18)), 1, 'Deep drawdowns matter because breakeven needs a large recovery and averaging down becomes dangerous.')
    addSignal(riskSignals, 'Risk', 'Portfolio weight', formatPercent(portfolioWeight), scoreMetric(portfolioWeight, (value) => (value <= 8 ? 70 : value <= 12 ? 58 : value <= 20 ? 42 : 28)), 0.9, 'Concentration controls how much one company-specific error can hurt the full portfolio.')
  }
  const riskPerShareForScore = ltp && invalidationPrice && invalidationPrice < ltp ? ltp - invalidationPrice : undefined
  const rewardRiskForScore = targetPrice && ltp && riskPerShareForScore && targetPrice > ltp ? (targetPrice - ltp) / riskPerShareForScore : undefined
  addSignal(riskSignals, 'Risk', 'Reward/risk', rewardRiskForScore === undefined ? '-' : `${rewardRiskForScore.toFixed(1)}x`, scoreMetric(rewardRiskForScore, (value) => (value >= 2 ? 74 : value >= 1.5 ? 60 : value > 0 ? 36 : 28), 40), 0.9, 'Reward/risk decides whether the potential upside justifies the defined downside.')
  addSignal(
    riskSignals,
    'Risk',
    'Risk plan',
    riskPlanDefined ? 'Defined' : 'Incomplete',
    riskPlanDefined ? 68 : 34,
    0.75,
    form.alreadyHold
      ? 'For an existing holding, a clear invalidation level is the key risk-control input; fresh capital is only needed if you plan to add more.'
      : 'For a new position, defined invalidation plus a capital/risk budget turn opinion into a controllable trade plan.',
  )
  const processDisciplineRead = processDisciplineScore(form, riskPlanDefined, rewardRiskForScore)
  const selectedTradingRules = selectTradingRulesForAnalysis({
    form,
    fundamentals: companyFundamentals,
    riskPlanDefined,
    rewardRisk: rewardRiskForScore,
    sectorRule,
    sseLike: sseLikeInstrument,
    processScore: processDisciplineRead,
  })
  addSignal(
    riskSignals,
    'Process',
    'Decision discipline',
    processDisciplineRead >= 62 ? 'Structured' : 'Incomplete',
    processDisciplineRead,
    0.8,
    'Process checks keep the decision from becoming emotional: define risk before action, avoid regret trades, keep goals realistic, and stand aside when the plan is incomplete.',
  )
  const npsCapitalLabel = capital
    ? decisionMode === 'holding-review'
      ? 'Add-more capital entered'
      : 'Deployable capital entered'
    : decisionMode === 'holding-review'
      ? 'No add-more capital'
      : 'No deployable capital'
  addSignal(
    riskSignals,
    'Process',
    'Capital guardrail',
    npsCapitalLabel,
    capital ? 56 : decisionMode === 'holding-review' ? 54 : 44,
    0.25,
    decisionMode === 'holding-review'
      ? 'Existing holdings can be reviewed without new cash; enter add-more capital only when that money is genuinely deployable market capital.'
      : 'Retirement, emergency, tax-planning, or locked-goal money should not be mixed with trade capital.',
  )
  if (sseLikeInstrument) {
    addSignal(
      riskSignals,
      'Process',
      'Instrument fit',
      'Special instrument caution',
      22,
      1,
      'Some non-standard instruments may not behave like ordinary listed equities; chart and valuation logic should be downgraded until instrument terms are verified.',
    )
  }
  selectedTradingRules.forEach((rule) => {
    addSignal(
      riskSignals,
      'Process',
      rule.title,
      compactRuleValue(rule),
      tradingRuleScore(rule, processDisciplineRead),
      tradingRuleWeight(rule),
      `${rule.principle} Watch these practical checks: ${rule.checklist.join(', ')}. ${rule.action}`,
    )
  })
  addSignal(riskSignals, 'Risk', 'Plan discipline', `${Math.round(clamp(score))}/100`, clamp(score), 1, 'Checks whether the decision has enough risk control, holding context, liquidity comfort, and useful evidence before capital is added.')

  const profileWeights =
    form.horizon === '3-6m'
      ? { technical: 0.32, fundamental: 0.24, statements: 0.12, risk: 0.24, news: 0.08 }
      : form.horizon === '6-12m'
        ? { technical: 0.29, fundamental: 0.28, statements: 0.14, risk: 0.21, news: 0.08 }
        : form.horizon === '1-3y'
          ? { technical: 0.22, fundamental: 0.34, statements: 0.18, risk: 0.18, news: 0.08 }
          : { technical: 0.18, fundamental: 0.38, statements: 0.2, risk: 0.16, news: 0.08 }
  const riskBoost = (portfolioWeight !== undefined && portfolioWeight > 20) || (positionPnlPct !== undefined && positionPnlPct < -20) ? 0.06 : 0
  const weights = {
    technical: Math.max(0.12, profileWeights.technical - riskBoost / 3),
    fundamental: profileWeights.fundamental,
    statements: profileWeights.statements,
    risk: profileWeights.risk + riskBoost,
    news: profileWeights.news,
  }
  const weightTotal = weights.technical + weights.fundamental + weights.statements + weights.risk + weights.news
  const normalisedWeights = {
    technical: weights.technical / weightTotal,
    fundamental: weights.fundamental / weightTotal,
    statements: weights.statements / weightTotal,
    risk: weights.risk / weightTotal,
    news: weights.news / weightTotal,
  }
  const technicalScore = weightedSignalScore(technicalSignals)
  const fundamentalScore = weightedSignalScore(fundamentalSignals)
  const statementScore = weightedSignalScore(statementSignals)
  const newsScore = weightedSignalScore(newsSignals)
  const riskScore = weightedSignalScore(riskSignals)
  const scoreComponents: ScoreComponent[] = [
    { label: 'Technical structure', score: Math.round(technicalScore), weight: normalisedWeights.technical, tone: toneFromScore(technicalScore), rationale: 'Trend, moving averages, RSI, MACD, ATR, VWAP, Bollinger position, patterns, and liquidity.' },
    { label: 'Fundamental quality', score: Math.round(fundamentalScore), weight: normalisedWeights.fundamental, tone: toneFromScore(fundamentalScore), rationale: 'All 19 ratio-card metrics, including valuation, profitability, debt, growth, and cash flow.' },
    { label: 'Statement flow', score: Math.round(statementScore), weight: normalisedWeights.statements, tone: toneFromScore(statementScore), rationale: 'Sales, PAT, CFO, EPS, reserves, borrowings, and cash-flow evidence.' },
    {
      label: decisionMode === 'fresh-entry' ? 'Risk and entry plan' : 'Risk and portfolio',
      score: Math.round(riskScore),
      weight: normalisedWeights.risk,
      tone: toneFromScore(riskScore),
      rationale:
        decisionMode === 'fresh-entry'
          ? 'Capital, starter quantity, reward/risk, invalidation, risk budget, and trade-plan discipline.'
          : capital
            ? 'Drawdown, concentration, reward/risk, invalidation, add-more risk budget, and trade-plan discipline.'
            : 'Drawdown, concentration, reward/risk, invalidation, and trade-plan discipline. Add-more risk budget is ignored until add-more capital is entered.',
    },
    { label: 'Updates and events', score: Math.round(newsScore), weight: normalisedWeights.news, tone: toneFromScore(newsScore), rationale: 'Top company/exchange updates and event tone.' },
  ]
  const tradingLessons = buildTradingLessons(
    form,
    companyFundamentals,
    riskPlanDefined,
    rewardRiskForScore,
    sectorRule,
    sseLikeInstrument,
    selectedTradingRules,
  )
  const adaptiveSignals = [...technicalSignals, ...fundamentalSignals, ...statementSignals, ...riskSignals, ...newsSignals]
  const adaptiveScore =
    technicalScore * normalisedWeights.technical +
    fundamentalScore * normalisedWeights.fundamental +
    statementScore * normalisedWeights.statements +
    riskScore * normalisedWeights.risk +
    newsScore * normalisedWeights.news

  if (technicalScore >= 62) positives.push('The chart has enough buyer-side clues for price to attempt higher levels if support and volume continue to hold.')
  if (technicalScore <= 42) cautions.push('The chart is not yet giving clean price support; rallies can fade unless trend, momentum, or volume improves.')
  if (fundamentalScore >= 62) positives.push('Business quality is supportive enough that a price rise has a better chance of being trusted by longer-term buyers.')
  if (fundamentalScore <= 42) cautions.push('Business quality is not strong enough yet; weak ratios can make the market demand a lower price or clearer growth proof.')
  if (statementScore <= 42) cautions.push('Sales, profit, cash, or balance-sheet evidence is weak or incomplete, which can cap price even when the chart improves.')
  if (newsScore <= 42) cautions.push('Recent updates carry negative or unresolved event risk, so price can stay under pressure until the market gets clarity.')

  if (positives.length === 0) positives.push('No strong positive filter has been supplied yet.')
  if (cautions.length === 0) cautions.push('No major caution was triggered by the current inputs.')

  const finalScore = missing.length > 0 ? 0 : Math.round(clamp(adaptiveScore))
  let verdict: AnalysisResult['verdict'] = 'Needs Input'
  let verdictClass: AnalysisResult['verdictClass'] = 'needs-data'

  if (missing.length === 0) {
    if (decisionMode === 'fresh-entry') {
      if (finalScore >= 75) {
        verdict = 'Buy Candidate'
        verdictClass = 'buy'
      } else if (finalScore >= 62) {
        verdict = 'Buy on Pullback'
        verdictClass = 'hold'
      } else if (finalScore >= 48) {
        verdict = 'Watchlist: Wait for Entry'
        verdictClass = 'watch'
      } else if (finalScore >= 32) {
        verdict = 'Avoid Fresh Buy for Now'
        verdictClass = 'reduce'
      } else {
        verdict = 'Do Not Buy'
        verdictClass = 'avoid'
      }
    } else {
      const severeDrawdown = positionPnlPct !== undefined && positionPnlPct < -50
      if (finalScore >= 75) {
        verdict = severeDrawdown ? 'Continue, Add Only on New Thesis' : 'Add / Continue Holding'
        verdictClass = 'buy'
      } else if (finalScore >= 62) {
        verdict = severeDrawdown ? 'Hold, No Averaging Yet' : 'Hold or Add on Dips'
        verdictClass = 'hold'
      } else if (finalScore >= 48) {
        verdict = severeDrawdown ? 'Hold Under Review' : 'Hold and Watch'
        verdictClass = 'watch'
      } else if (finalScore >= 32) {
        verdict = 'Reduce Risk'
        verdictClass = 'reduce'
      } else {
        verdict = 'Exit Review'
        verdictClass = 'avoid'
      }
    }
  }

  const evidenceSignals = adaptiveSignals.filter((signal) => signal.value !== '-' && signal.value !== 'None loaded').length
  let confidence = cacheState === 'live' || cacheState === 'free' ? 50 : 30
  if (quote) confidence += 12
  if (holding) confidence += 8
  if (candleCount >= 180) confidence += 14
  else if (candleCount > 0) confidence += 7
  confidence += Math.min(evidenceSignals * 1.25, 30)
  if (effectiveProfitTrend !== 'unknown') confidence += 6
  confidence = clamp(confidence)
  const confidenceLabel = confidence >= 75 ? 'High' : confidence >= 50 ? 'Medium' : 'Low'

  const suggestedShares =
    riskCapital && ltp && invalidationPrice && invalidationPrice < ltp ? Math.floor(riskCapital / (ltp - invalidationPrice)) : undefined
  const suggestedDeployment = suggestedShares && ltp ? suggestedShares * ltp : undefined
  const breakevenMove = form.alreadyHold && avgPrice && ltp ? ((avgPrice - ltp) / ltp) * 100 : undefined
  const positionValueText = positionValue !== undefined ? formatInr(positionValue) : '-'
  const positionCostText = positionCost !== undefined ? formatInr(positionCost) : '-'
  const riskPerShare = ltp && invalidationPrice && invalidationPrice < ltp ? ltp - invalidationPrice : undefined
  const rewardRisk =
    targetPrice && ltp && riskPerShare && targetPrice > ltp ? (targetPrice - ltp) / riskPerShare : undefined
  const riskBudgetSourceText = maxRisk
    ? form.riskMode === 'percent'
      ? formatPlainPercent(maxRisk)
      : formatInr(maxRisk)
    : `${riskProfileLabels[form.riskProfile]} default of ${formatPlainPercent(defaultRiskPercent)}`
  const suggestedQuantityLabel =
    suggestedShares !== undefined && suggestedShares > 0
      ? `${formatNumber(suggestedShares)} risk-sized`
      : starterShares !== undefined && decisionMode === 'fresh-entry'
        ? `${formatNumber(starterShares)} starter / ${formatNumber(capitalShares)} max by capital`
        : '-'
  const nearestTrendReference = [sma20, ema20, verdictVwap].find((value) => value !== undefined && ltp !== undefined && Math.abs(value - ltp) / Math.max(ltp, 1) <= 0.08)
  const confirmationReference = nearestTrendReference !== undefined ? formatInr(nearestTrendReference) : 'recent resistance with above-normal volume'
  const downsideReference =
    invalidationPrice && ltp && invalidationPrice < ltp
      ? formatInr(invalidationPrice)
      : verdictAtr && ltp
        ? formatInr(Math.max(0, ltp - verdictAtr * 2))
        : 'a support level you can defend before buying'
  const targetReference = targetPrice && ltp && targetPrice > ltp ? formatInr(targetPrice) : 'the next visible resistance zone'
  const entryPlan =
    missing.length > 0
      ? `Complete the missing inputs first: ${missing.join(', ')}.`
      : decisionMode === 'fresh-entry'
        ? finalScore >= 75
          ? `Fresh buy candidate. Prefer staged entry: start with about ${formatNumber(starterShares)} shares, then add only if price holds above ${confirmationReference} and the next upside zone remains near ${targetReference}.`
          : finalScore >= 62
            ? `Keep it on the buy list, but do not chase. A better entry is either a pullback that respects ${confirmationReference}, or a strong close above resistance with volume.`
            : finalScore >= 48
              ? `Watchlist only. Price needs to prove demand first: reclaim ${confirmationReference}, hold it, and show that downside is limited near ${downsideReference}.`
              : `No fresh buy yet. At this price, the risk of a failed move is too high; wait for price to reclaim ${confirmationReference} or for fundamentals to improve.`
        : finalScore >= 62
          ? `Existing holding can be continued while price respects ${downsideReference}. Add only if price reclaims/holds ${confirmationReference} and the upside zone still justifies the risk.`
        : finalScore >= 48
            ? positionPnlPct !== undefined && positionPnlPct < -50
              ? `Hold under review, not hold with comfort. Do not average down unless price first reclaims ${confirmationReference}; a break below ${downsideReference} should trigger an exit/reduce review.`
              : `Hold only with discipline. Price must either hold ${downsideReference} or reclaim ${confirmationReference}; otherwise upside can stay capped.`
            : `Review whether to reduce or exit. If price cannot defend ${downsideReference}, the next move can damage capital faster than the current evidence suggests.`
  const exitPlan =
    missing.length > 0
      ? 'Exit planning will appear after price and risk inputs are available.'
      : invalidationPrice && ltp && invalidationPrice < ltp
        ? `Risk line: review or exit if price closes below ${formatInr(invalidationPrice)}. This is the point where the thesis needs to be considered wrong or delayed.`
        : verdictAtr && ltp
          ? `No invalidation entered. A rough ATR-based review zone is near ${formatInr(Math.max(0, ltp - verdictAtr * 2))}; replace this with your actual support/invalidation level before buying.`
          : 'Set an invalidation level before buying. Without a defined exit line, quantity and risk are guesswork.'

  const doItems =
    decisionMode === 'fresh-entry'
      ? [
          missing.length > 0
            ? `Complete the missing inputs first: ${missing.join(', ')}. The app waits for enough data before giving a fair read.`
            : entryPlan,
          suggestedShares !== undefined && suggestedShares > 0
            ? `Quantity plan: cap the first buy near ${formatNumber(suggestedShares)} shares, about ${formatInr(suggestedDeployment)}. If price falls to ${downsideReference}, the loss should stay near your planned risk budget instead of becoming an emotional hold.`
            : starterShares !== undefined
              ? `Quantity plan: full capital can buy about ${formatNumber(capitalShares)} shares at current LTP. For a calmer first entry, start nearer ${formatNumber(starterShares)} shares and add only if price confirms above ${confirmationReference}.`
              : 'Quantity plan needs capital and LTP. Enter capital and sync data to calculate a practical share count.',
          exitPlan,
          rewardRisk !== undefined
            ? rewardRisk >= 2
              ? `Reward/risk is ${rewardRisk.toFixed(1)}x. That means the upside toward ${targetReference} is meaningfully larger than the downside near ${downsideReference}, if the chart trigger confirms.`
              : `Reward/risk is only ${rewardRisk.toFixed(1)}x. At this price, the stock may need either a lower entry or a higher-confidence upside zone before buying.`
            : `Enter target and invalidation to see whether price has enough upside beyond ${targetReference} versus downside near ${downsideReference}.`,
          marketCapCr === undefined || debtEquity === undefined || roce === undefined || pe === undefined || effectiveProfitTrend === 'unknown'
            ? 'Company-quality data is incomplete. Until market cap, debt/equity, ROCE, P/E, and profit trend are clearer, treat any price rise as less trustworthy.'
            : 'Use the company data to judge whether a price rise can last: strong cash/profit quality supports holding gains; weak quality can make rallies fade.',
        ]
      : [
          missing.length > 0
            ? `Complete the missing inputs first: ${missing.join(', ')}. The app waits for enough data before giving a fair read.`
            : entryPlan,
          invalidationPrice && ltp && invalidationPrice < ltp
            ? `Use ${formatInr(invalidationPrice)} as the current invalidation reference. If price closes below it, treat the next bounce as a reduce/exit review instead of an automatic hold.`
            : `Set an invalidation level for the existing holding. Until then, use the rough review zone near ${downsideReference} as a temporary warning line, not a final stop.`,
          suggestedShares !== undefined && suggestedShares > 0
            ? `If adding more, cap the fresh deployment near ${formatNumber(suggestedShares)} shares, about ${formatInr(suggestedDeployment)}, and add only after price confirms above ${confirmationReference}.`
            : !capital
              ? `Because this is a holding review with no fresh capital entered, focus on whether price holds ${downsideReference} or reclaims ${confirmationReference}, not on add-more sizing.`
              : `Keep any add-more sizing conservative until target, invalidation, and capital risk show that a move toward ${targetReference} is worth the downside.`,
          marketCapCr === undefined || debtEquity === undefined || roce === undefined || pe === undefined || effectiveProfitTrend === 'unknown'
            ? 'Company-quality data is incomplete. A bounce in price should be treated carefully until market cap, debt/equity, ROCE, P/E, and profit trend are clearer.'
            : 'Use the supplied fundamentals to judge whether a recovery can sustain: price recovery is more believable when profit, cash flow, and debt quality agree.',
        ]

  if (positionPnlPct !== undefined && positionPnlPct < -15) {
    doItems.push(`Because the position is down ${formatPercent(positionPnlPct)}, only stay/add if today's price near ${formatInr(ltp)} would still look buyable from zero. If not, the old buy price should not control the next decision.`)
  }
  if (decisionMode === 'holding-review' && rewardRisk !== undefined && rewardRisk < 1.5) {
    doItems.push(`Current reward/risk is weak at ${rewardRisk.toFixed(1)}x. Wait for a lower entry, a stronger breakout above ${confirmationReference}, or a clearer target before adding.`)
  }
  if (portfolioWeight !== undefined && portfolioWeight > 12) {
    doItems.push(`Portfolio weight is high at ${formatPercent(portfolioWeight)}. Even a small price fall now affects the full portfolio, so additions need unusually strong confirmation.`)
  }
  if (sectorRule) {
    doItems.push(`Before increasing conviction, check the ${sectorRule.label} drivers (${sectorRule.metrics.join(', ')}). If these sector drivers weaken, the stock price can stay capped even when generic ratios look fine.`)
  }
  if (sseLikeInstrument) {
    doItems.push('Verify whether this is a special or social-impact style instrument before using ordinary equity valuation or chart signals.')
  }
  if (specialListedInstrument) {
    doItems.push('Verify the instrument type before acting: check whether it is partly paid, debt-class, rights-linked, or otherwise different from a regular fully paid equity share.')
  }

  const dontItems =
    decisionMode === 'fresh-entry'
      ? [
          `Do not buy only because the stock is familiar or the setup looks acceptable. Price still needs to hold/reclaim ${confirmationReference}, and downside must be clear near ${downsideReference}.`,
          `Do not deploy the full capital in one shot if the next likely move is still uncertain. Stage the buy so a failed move toward ${downsideReference} does not trap too much capital.`,
          `Do not chase a sharp green candle after the move has already happened. A pullback that respects ${confirmationReference} or a confirmed breakout gives a cleaner future price path.`,
          'Do not use F&O for a new idea unless the purpose is a defined hedge. Leverage can turn a normal price pullback into a forced exit.',
          'Do not ignore liquidity. Thinly traded stocks can rise quickly on paper but fall or gap down when you actually need to exit.',
          'Do not treat the verdict number as a price target. It reflects decision quality, not a guarantee that price must rise.',
        ]
      : [
          `Do not average down only because your buy price is higher. Add only if price reclaims ${confirmationReference}, downside is defined near ${downsideReference}, and fundamentals are not deteriorating.`,
          'Do not use F&O to recover losses from a weak cash position. Leverage can make a normal adverse price move force a larger loss.',
          'Do not ignore liquidity. A stock can look cheap after falling, but weak volume can make the next exit harder if price breaks down again.',
          'Do not treat the verdict number as a prediction. It is decision quality, not a guarantee that price must rise.',
        ]

  if (form.constraints.avoidHighDebt) {
    dontItems.push('Do not relax the high-debt rule casually. If earnings weaken, leverage can pressure the stock price faster and for longer than a debt-light company.')
  }
  if (form.constraints.avoidSmallCaps) {
    dontItems.push('Do not force a small-cap exception unless the upside is very clear. Small-cap prices can move sharply on low volume and negative news.')
  }
  dontItems.push('Do not use retirement, emergency, tax-planning, or fixed-goal money as trade capital. A bad price move should not disturb money needed for fixed life goals.')
  if (sseLikeInstrument) {
    dontItems.push('Do not treat a special or social-impact style instrument like a normal equity trade unless instrument terms, return objective, and liquidity are clear.')
  }
  if (specialListedInstrument) {
    dontItems.push('Do not use ordinary equity valuation or chart signals alone for a special/partly-paid/debt-class holding; first confirm the contract terms and exit liquidity.')
  }

  const whyItems = [
    `The practical question is simple: from ${formatInr(ltp)}, does a future move up look more believable than a move down? The verdict stays cautious whenever chart, business quality, risk, or updates do not agree.`,
    confidence >= 75
      ? 'Confidence is high because the app has enough price, holding, candle, and/or company evidence to judge the setup without guessing heavily.'
      : confidence >= 50
        ? 'Confidence is medium because the price evidence is workable, but missing company or risk inputs can still change the future-price view.'
        : 'Confidence is low because important quote, candle, holding, or company evidence is missing, so the next price move is harder to judge.',
    decisionMode === 'holding-review' && positionPnlPct !== undefined && positionPnlPct < -20
      ? `The position is already down ${formatPercent(positionPnlPct)}. That matters because recovering to your average price needs a large price move, so averaging without confirmation is dangerous.`
      : decisionMode === 'holding-review'
        ? `The existing position is being judged from today's price near ${formatInr(ltp)}, not from hope around the old buy price.`
        : `Fresh-entry sizing uses deployable capital and a ${riskBudgetSourceText} risk budget so a wrong price move does not become oversized.`,
    recentTrendPct !== undefined
      ? `Recent price trend is ${formatPercent(recentTrendPct)}. A positive trend can pull in buyers; a negative trend means rallies still need proof before they are trusted.`
      : 'Trend evidence is incomplete because there are not enough cached candles.',
    sectorRule
      ? `Sector drivers matter for future price here: if ${sectorRule.metrics.join(', ')} weaken, the stock can stay capped even with a decent chart.`
      : 'No specialised sector mapping is loaded, so the future-price view depends more on generic ratios, statements, price action, and updates.',
    processDisciplineRead >= 62
      ? 'The trade plan is reasonably defined. That does not make price rise, but it makes a wrong move easier to control instead of becoming repeated averaging.'
      : 'The trade plan is still loose. Before adding or buying, define what would prove the idea wrong and how much capital can be lost if price moves against you.',
  ]

  const steps = [
    {
      title: '1. Instrument and price',
      plainEnglish: `${ticker || 'Ticker'} is being analysed as ${quoteKey}. The price used for all calculations is ${formatInr(ltp)}.`,
      formula: `Price source = manual LTP if entered, otherwise cached EOD quote, otherwise uploaded holding price.`,
      rationale:
        'LTP means last traded price. Because this app is for non-intraday decisions, end-of-day data is good enough for position sizing, trend checks, and portfolio exposure. It is not meant for minute-by-minute entry timing.',
      takeaway: quote
        ? `The latest cached quote date is ${quote.last_trade_time || 'available in cache'}.`
        : 'No cached quote was found, so the verdict needs either a manual LTP or a successful market-data sync.',
    },
    {
      title: decisionMode === 'fresh-entry' ? '2. Fresh buy sizing' : '2. Position math',
      plainEnglish: form.alreadyHold
        ? `Quantity ${formatNumber(quantity)}, average ${formatInr(avgPrice)}, unrealized P&L ${formatInr(positionPnl)} (${formatPercent(positionPnlPct)}).`
        : `No current holding was marked, so this is a fresh buy decision. At ${formatInr(ltp)}, ${formatInr(capital)} can buy about ${formatNumber(capitalShares)} shares; a calmer starter tranche is about ${formatNumber(starterShares)} shares.`,
      formula: form.alreadyHold
        ? `Cost = quantity x average price = ${positionCostText}. Value = quantity x LTP = ${positionValueText}. P&L = value - cost.`
        : `Maximum shares = capital / LTP. Starter tranche = maximum shares x risk-profile fraction. Risk-sized shares need invalidation and risk per share.`,
      rationale:
        form.alreadyHold
          ? 'A loss is not automatically a reason to sell, and a profit is not automatically a reason to hold. The important question is whether the business and price still justify fresh capital today.'
          : 'For a fresh buy, the first job is not to predict perfectly. It is to avoid oversizing before the entry trigger and exit line are clear.',
      takeaway:
        form.alreadyHold
          ? breakevenMove !== undefined && breakevenMove > 0
            ? `The stock needs roughly ${formatPlainPercent(breakevenMove)} upside from the current price just to reach your average price.`
            : 'The position is not below breakeven based on the current inputs.'
          : entryPlan,
    },
    {
      title: decisionMode === 'fresh-entry' ? '3. Capital at risk' : '3. Portfolio risk',
      plainEnglish: form.alreadyHold
        ? portfolioWeight === undefined
          ? `No holdings file is loaded, so portfolio concentration is unknown. ${capital ? `Fresh add-more risk budget is ${formatInr(riskCapital)}.` : 'No add-more capital was entered, so this is treated as a holding review.'}`
          : `This stock is currently about ${formatPercent(portfolioWeight)} of the loaded portfolio value. ${capital ? `Fresh add-more risk budget is ${formatInr(riskCapital)}.` : 'No add-more capital was entered, so this is treated as a holding review.'}`
        : `This is being treated as a new position. Your risk budget is ${formatInr(riskCapital)}, using ${riskBudgetSourceText}.`,
      formula: form.alreadyHold
        ? 'Portfolio weight = position value / total portfolio value. Fresh risk budget is calculated only if additional capital is supplied.'
        : 'Risk budget = capital x max-risk %. If max risk is blank, the app uses a conservative profile-based default.',
      rationale:
        form.alreadyHold
          ? 'Concentration matters because one company-specific problem can damage the whole portfolio. A high weight deserves stricter evidence before adding more.'
          : 'Capital tells us how much you can deploy, but risk budget tells us how much you can afford to be wrong by. That is the number that controls quantity.',
      takeaway:
        form.alreadyHold
          ? portfolioWeight === undefined
            ? 'Upload holdings before using concentration as a comfort signal; until then, do not assume the position is small.'
            : portfolioWeight > 20
              ? 'This is a high-concentration position, so the app penalises aggressive adding.'
              : 'The loaded portfolio does not show extreme concentration, but adding still needs a fresh thesis and risk plan.'
          : suggestedShares !== undefined
            ? `Risk-sized quantity is ${formatNumber(suggestedShares)} shares from the current inputs.`
            : 'Enter invalidation to convert the capital amount into a true risk-sized quantity.',
    },
    {
      title: '4. Price behaviour and liquidity',
      plainEnglish: `${candleCount} daily candles are cached. The recent 30-day trend is ${formatPercent(recentTrendPct)} and the 20-day average volume is ${formatNumber(avgVolume20)} shares.`,
      formula: `Recent trend = latest close / close 30 trading days ago - 1. Liquidity = average daily traded shares.`,
      rationale:
        'Trend shows whether the market is currently rewarding or punishing the stock. Liquidity tells us whether we can enter or exit without getting trapped in a thinly traded counter.',
      takeaway:
        quote?.volume !== undefined && quote.volume > 0 && quote.volume < 25000
          ? 'Liquidity is thin; limit orders and smaller position sizes are safer.'
          : 'Liquidity is not the main red flag from the currently loaded data.',
    },
    {
      title: '5. Business quality and valuation',
      plainEnglish: `The quality evidence used is market cap ${formatNumber(marketCapCr)} cr, debt/equity ${formatNumber(debtEquity)}, ROCE ${formatPercent(roce)}, P/E ${formatNumber(pe)}, and profit trend ${profitTrendLabels[effectiveProfitTrend]}. Manual fields only override missing or stale fetched data.`,
      formula: 'The quality read improves with stronger ROCE, manageable debt, sufficient market cap, sensible valuation, and improving or stable profit trend.',
      rationale:
        'Price can move for many reasons, but over a non-intraday horizon the business matters. A weak balance sheet, poor capital efficiency, or falling profits reduces the margin of safety.',
      takeaway:
        marketCapCr === undefined && debtEquity === undefined && roce === undefined && pe === undefined && effectiveProfitTrend === 'unknown'
          ? 'Refresh fundamentals first; use manual overrides only if the data source cannot fetch the company.'
          : 'Fetched fundamentals and any explicit overrides are included in the verdict, but filings should still be checked before committing more capital.',
    },
    {
      title: '6. Risk plan',
      plainEnglish:
        riskPerShare !== undefined
          ? riskCapital
            ? `If invalidation is ${formatInr(invalidationPrice)}, the risk per share is ${formatInr(riskPerShare)} and the suggested risk-sized quantity is ${formatNumber(suggestedShares)} shares.`
            : form.alreadyHold
              ? `If invalidation is ${formatInr(invalidationPrice)}, the existing holding has a clear review level. Add fresh capital only if you want risk-sized add-more quantity.`
              : `If invalidation is ${formatInr(invalidationPrice)}, the app can define risk per share, but capital/risk budget is still needed for exact quantity.`
          : 'No invalidation price is entered, so the app cannot compute proper risk-sized quantity.',
      formula: form.alreadyHold && !riskCapital
        ? 'Existing holding review = check invalidation, drawdown, concentration, and thesis quality. Add-more sizing needs fresh capital plus max risk.'
        : 'Risk per share = LTP - invalidation price. Suggested shares = risk budget / risk per share. Reward/risk = target upside / risk per share.',
      rationale:
        'Invalidation is the price or condition where the thesis is considered wrong. Without it, position sizing becomes guesswork.',
      takeaway:
        rewardRisk !== undefined
          ? `Current reward/risk from your target and invalidation is ${rewardRisk.toFixed(1)}x.`
          : 'Enter both target and invalidation to judge whether the payoff is worth the risk.',
    },
    {
      title: '7. Trade-plan checks',
      plainEnglish: sectorRule
        ? `For this sector, keep an eye on ${sectorRule.metrics.join(', ')} because those drivers can decide whether price strength lasts. ${processDisciplineRead >= 62 ? 'Your plan has enough structure to avoid an emotional add or late exit.' : 'Your plan still needs clearer downside and action rules before fresh capital is added.'}`
        : `${processDisciplineRead >= 62 ? 'Your plan has enough structure to avoid an emotional add or late exit.' : 'Your plan still needs clearer downside and action rules before fresh capital is added.'} ${sseLikeInstrument ? 'This instrument may not behave like a normal equity, so price and liquidity need extra caution.' : 'The instrument looks suitable for normal listed-equity analysis.'}`,
      formula: 'Read this as a practical sanity check: sector drivers, downside line, capital separation, and whether the instrument behaves like a normal listed stock.',
      rationale:
        'This does not predict price by itself. It prevents common mistakes: ignoring sector drivers, adding before risk is defined, mixing goal money with trade capital, or treating a special instrument like a normal equity.',
      takeaway: sectorRule
        ? `Before acting, verify these ${sectorRule.label} drivers: ${sectorRule.metrics.join(', ')}.`
        : 'Before acting, add any special sector drivers you know in the thesis field or check filings manually.',
    },
    {
      title: '8. Verdict synthesis',
      plainEnglish: `The final verdict is ${verdict} with ${confidenceLabel.toLowerCase()} confidence in the loaded data.`,
      formula: 'What mattered most: price action, business quality, statement health, risk/position context, and recent updates were read together according to your horizon and holding state.',
      rationale:
        'The verdict is not a promise that price must rise or fall. It is a decision aid that asks whether the current setup makes a future upside move believable enough, while keeping downside and concentration under control.',
      takeaway: `Treat the result as a decision aid. Final action should still confirm recent filings, corporate announcements, and your personal risk tolerance.`,
    },
  ]

  return {
    verdict,
    verdictClass,
    decisionMode,
    score: finalScore,
    confidence,
    confidenceLabel,
    quoteKey,
    ltp,
    positionPnl,
    positionPnlPct,
    portfolioWeight,
    riskCapital,
    defaultRiskPercent,
    capitalShares,
    starterShares,
    suggestedShares,
    suggestedDeployment,
    suggestedQuantityLabel,
    entryPlan,
    exitPlan,
    missing,
    actions,
    positives,
    cautions,
    doItems,
    dontItems,
    whyItems,
    steps,
    adaptiveSignals,
    scoreComponents,
    tradingLessons,
  }
}

function App() {
  const [storedWorkspace] = useState<BrowserWorkspace | null>(() => readBrowserWorkspace())
  const [snapshot, setSnapshot] = useState<Snapshot>(() => storedWorkspace?.snapshot ?? starterSnapshot)
  const [cacheState, setCacheState] = useState<CacheState>(() => cacheStateFromProvider((storedWorkspace?.snapshot ?? starterSnapshot).provider))
  const [view, setView] = useState<View>('setup')
  const viewAnnouncementRef = useRef<HTMLDivElement>(null)
  const isFirstViewRender = useRef(true)
  const autoCompanyOverrideKeyRef = useRef('')

  useEffect(() => {
    if (isFirstViewRender.current) {
      isFirstViewRender.current = false
      return
    }
    viewAnnouncementRef.current?.focus()
  }, [view])
  const [glossarySearch, setGlossarySearch] = useState('')
  const [mobileContextExpanded, setMobileContextExpanded] = useState(false)
  const [workspaceDrawerOpen, setWorkspaceDrawerOpen] = useState(false)
  const [form, setForm] = useState<AnalysisForm>(() => storedWorkspace?.form ?? initialForm)
  const [days, setDays] = useState(() => storedWorkspace?.days ?? 730)
  const [copied, setCopied] = useState<string | null>(null)
  const [freeRefreshState, setFreeRefreshState] = useState<RefreshState>('idle')
  const [freeRefreshMessage, setFreeRefreshMessage] = useState('')
  const [syncProgress, setSyncProgress] = useState(0)
  const [syncCoverage, setSyncCoverage] = useState<SyncCoverage | null>(null)
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, SymbolMappingDraft>>({})
  const [mappingState, setMappingState] = useState<MappingSaveState>('idle')
  const [mappingStatus, setMappingStatus] = useState('')
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [uploadMessage, setUploadMessage] = useState('')
  const [llmState, setLlmState] = useState<RefreshState>('idle')
  const [llmMessage, setLlmMessage] = useState('')
  const [llmResponse, setLlmResponse] = useState<LlmVerdictResponse | null>(null)
  const [llmScope, setLlmScope] = useState<AiCoachScope>('verdict')
  const [holdingContextMessage, setHoldingContextMessage] = useState('')
  const [theme, setTheme] = useState<ThemeMode>('dark')
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>('6M')
  const [forecastSettings, setForecastSettings] = useState<ForecastSettings>(initialForecastSettings)
  const [chartIndicators, setChartIndicators] = useState<Record<IndicatorKey, boolean>>({
    sma20: true,
    sma50: false,
    sma100: false,
    sma200: false,
    ema20: true,
    ema50: false,
    vwap: false,
    bbands: false,
    volume: true,
    range: true,
    rsi: true,
    macd: false,
    atr: true,
    patterns: true,
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (freeRefreshState !== 'refreshing') return undefined
    setSyncProgress(8)
    const timer = window.setInterval(() => {
      setSyncProgress((current) => Math.min(92, current + Math.max(1, Math.round((92 - current) * 0.12))))
    }, 650)
    return () => window.clearInterval(timer)
  }, [freeRefreshState])

  useEffect(() => {
    writeBrowserWorkspace({
      version: 1,
      snapshot,
      form,
      days,
    })
  }, [days, form, snapshot])

  const activeSnapshot = snapshot
  const activeHoldings = useMemo(() => (activeSnapshot.upload ? (activeSnapshot.holdings ?? []) : []), [activeSnapshot.holdings, activeSnapshot.upload])
  const activeSnapshotForAnalysis = useMemo<Snapshot>(
    () => (activeSnapshot.upload ? activeSnapshot : { ...activeSnapshot, holdings: [], upload: undefined }),
    [activeSnapshot],
  )
  const missingDataIssues = useMemo(
    () => (syncCoverage ? buildMissingDataIssues(activeSnapshotForAnalysis, syncCoverage) : []),
    [activeSnapshotForAnalysis, syncCoverage],
  )
  useEffect(() => {
    if (!missingDataIssues.length) return
    setMappingDrafts((current) => {
      let changed = false
      const next = { ...current }
      for (const issue of missingDataIssues) {
        if (next[issue.symbol]) continue
        next[issue.symbol] = mappingDraftForSymbol(activeSnapshotForAnalysis, issue.symbol)
        changed = true
      }
      return changed ? next : current
    })
  }, [activeSnapshotForAnalysis, missingDataIssues])

  const hasUploadedHoldingsFeed = Boolean(activeSnapshot.upload)
  const loadedHoldingsFilename = activeSnapshot.upload?.filename ?? ''
  const loadedHoldingsCount = activeSnapshot.upload?.holdings_count ?? activeHoldings.length
  const decisionSymbol = decisionInputSymbol(form)
  const portfolioSyncSymbols = useMemo(() => portfolioSymbolsForSync(activeSnapshotForAnalysis), [activeSnapshotForAnalysis])
  const syncTargetSymbols = useMemo(
    () => uniqueSymbols([decisionSymbol, ...portfolioSyncSymbols]),
    [decisionSymbol, portfolioSyncSymbols],
  )
  const isHoldingReview = form.alreadyHold
  const analysis = useMemo(() => buildAnalysis(form, activeSnapshotForAnalysis, cacheState), [activeSnapshotForAnalysis, cacheState, form])
  const portfolio = useMemo(() => portfolioSummary(activeSnapshotForAnalysis), [activeSnapshotForAnalysis])
  const portfolioReturn = portfolio.cost ? (portfolio.pnl / portfolio.cost) * 100 : 0
  const capitalNum = parseNumber(form.capital)
  const maxRiskNum = parseNumber(form.maxRisk)
  const addMoreRiskControlsActive = !isHoldingReview || Boolean(capitalNum)
  const riskSliderMax = form.riskMode === 'percent' ? 10 : Math.max(5000, Math.ceil((capitalNum || 100000) * 0.12))
  const riskSliderStep = form.riskMode === 'percent' ? 0.25 : 500
  const riskSliderDefault = form.riskMode === 'percent' ? defaultRiskPercentForProfile(form.riskProfile) : 2500
  const riskSliderValue = clamp(maxRiskNum ?? riskSliderDefault, form.riskMode === 'percent' ? 0.25 : 500, riskSliderMax)
  const riskSliderDisplay = form.riskMode === 'percent' ? `${riskSliderValue.toFixed(2)}%` : formatInr(riskSliderValue)
  const capitalHelpText = isHoldingReview
    ? 'Optional. Use this only if you are considering adding more money to the existing holding. For a plain hold/reduce/exit review, quantity and average price matter more than add-more capital. If you enter a value, the app uses it only for add-more sizing and risk budget.'
    : 'Required for a fresh entry. This is the deployable money for the new idea, used to estimate practical quantity, starter tranche, and risk budget. Do not put emergency, retirement, tax, or fixed-goal money here.'
  const boughtOnHelpText =
    'Optional. This date helps judge how long the thesis has had to work before you call it a failure or success. It does not decide the verdict alone.'
  const boughtOnPrompt =
    isHoldingReview && !form.boughtOn
      ? holdingContextMessage ||
        'Bought on is empty. Add the date if you know it so the app can judge holding period, thesis patience, and exit timing with better context.'
      : ''

  const marketDataUrl = useMemo(() => marketDataBaseUrl(), [])
  const marketDataDisplayUrl = marketDataUrl || 'Set VITE_MARKET_DATA_BASE_URL to your HTTPS data bridge'
  const freeServerCommand = 'python3 scripts/market_data_server.py'
  const lanAppCommand = 'cd stock-analysis-app && npm run dev:lan'
  const productionBuildCommand = 'cd stock-analysis-app && npm run build'
  const publicAppCommand = 'cd stock-analysis-app && npm run preview:lan'
  const freeCliCommand = useMemo(() => {
    const holdingsFlag = hasUploadedHoldingsFeed ? '' : ' --no-holdings'
    const cliSymbols = syncTargetSymbols.length ? syncTargetSymbols.join(' ') : '<decision-symbol-or-uploaded-holdings>'
    return `python3 scripts/market_data_refresh.py --symbols ${cliSymbols} --days ${days}${holdingsFlag}`
  }, [days, hasUploadedHoldingsFeed, syncTargetSymbols])

  const marketRows = useMemo(() => {
    const rows = new Map<
      string,
      {
        canAnalyze: boolean
        candleCount: number
        changePct?: number
        holding?: Holding
        quote?: MarketQuote
        source: 'holding-and-quote' | 'holding-only' | 'quote-only'
        status: string
        symbol: string
      }
    >()
    const visibleQuoteSymbols = new Set(
      uniqueSymbols([
        decisionSymbol,
        ...activeHoldings.map((holding) => {
          const exchange = String(holding.exchange ?? 'UNLISTED').toUpperCase()
          const ticker = String(holding.tradingsymbol ?? holding.isin ?? 'UNKNOWN').toUpperCase()
          return `${exchange}:${ticker}`
        }),
      ]),
    )
    const quoteSummary = (symbol: string, quote?: MarketQuote) => {
      const close = quote?.ohlc?.close
      const changePct = close && quote?.last_price ? ((quote.last_price - close) / close) * 100 : undefined
      return { candleCount: activeSnapshotForAnalysis.candles[symbol]?.length ?? 0, changePct }
    }

    activeHoldings.forEach((holding) => {
      const exchange = String(holding.exchange ?? 'UNLISTED').toUpperCase()
      const ticker = String(holding.tradingsymbol ?? holding.isin ?? 'UNKNOWN').toUpperCase()
      const symbol = `${exchange}:${ticker}`
      const quote = activeSnapshotForAnalysis.quotes[symbol]
      const { candleCount, changePct } = quoteSummary(symbol, quote)
      const canAnalyze = ['NSE', 'BSE'].includes(exchange) && Boolean(holding.tradingsymbol)
      rows.set(symbol, {
        canAnalyze,
        candleCount,
        changePct,
        holding,
        quote,
        source: quote ? 'holding-and-quote' : 'holding-only',
        status: quote ? 'Holding + market data' : 'Holding only: sync or map symbol',
        symbol,
      })
    })

    Object.entries(activeSnapshotForAnalysis.quotes).forEach(([symbol, quote]) => {
      if (rows.has(symbol) || !visibleQuoteSymbols.has(symbol)) return
      const exchange = symbol.split(':')[0]
      const { candleCount, changePct } = quoteSummary(symbol, quote)
      rows.set(symbol, {
        canAnalyze: exchange === 'NSE' || exchange === 'BSE',
        candleCount,
        changePct,
        quote,
        source: 'quote-only',
        status: 'Market data only',
        symbol,
      })
    })

    return Array.from(rows.values())
  }, [activeHoldings, activeSnapshotForAnalysis, decisionSymbol])

  const activeQuote = activeSnapshotForAnalysis.quotes[analysis.quoteKey]
  const activeFundamentals = activeSnapshotForAnalysis.fundamentals?.[analysis.quoteKey]
  const activeCandles = activeSnapshotForAnalysis.candles[analysis.quoteKey] ?? emptyCandles
  const hasPortfolioContext = analysis.portfolioWeight !== undefined
  const activeTickerDisplay = decisionSymbol || 'No ticker selected'
  const specialInstrumentWarning = analysis.cautions.find((item) => /special|partly-paid|partly paid|debt-class|call-money/i.test(item))
  const activeInstrumentName = activeFundamentals?.name || (form.ticker.trim() ? 'Company data pending' : 'Choose a fund or index')
  const activeInstrumentSector = [activeFundamentals?.sector, activeFundamentals?.industry].filter(Boolean).join(' - ')
  const activeChangePct =
    activeQuote?.ohlc?.close && activeQuote.last_price ? ((activeQuote.last_price - activeQuote.ohlc.close) / activeQuote.ohlc.close) * 100 : undefined
  const activePriceTone: SignalTone = activeChangePct === undefined ? 'neutral' : activeChangePct >= 0 ? 'positive' : 'negative'
  const activeAiCoachCopy = aiCoachScopeCopy[llmScope]

  useEffect(() => {
    setLlmState('idle')
    setLlmMessage('')
    setLlmResponse(null)
    setLlmScope('verdict')
  }, [
    activeSnapshot.generated_at,
    analysis.quoteKey,
    analysis.score,
    analysis.verdict,
    form.alreadyHold,
    form.averagePrice,
    form.capital,
    form.horizon,
    form.quantity,
    form.riskProfile,
  ])

  useEffect(() => {
    if (!form.alreadyHold || form.boughtOn) {
      setHoldingContextMessage('')
    }
  }, [form.alreadyHold, form.boughtOn])

  const sparkline = useMemo(() => buildSparkline(activeCandles), [activeCandles])
  const forecastProjection = useMemo(
    () => buildScenarioForecast(activeCandles, analysis, activeFundamentals, forecastSettings),
    [activeCandles, activeFundamentals, analysis, forecastSettings],
  )
  const chartModel = useMemo(
    () => buildCandleChart(activeCandles, chartTimeframe, 1, null, forecastProjection),
    [activeCandles, chartTimeframe, forecastProjection],
  )
  const activeRange = useMemo(() => candleRange(activeCandles, 252), [activeCandles])

  const priceRangePercent = rangePosition(analysis.ltp, activeRange.low, activeRange.high)
  const recentTrendPct = candleTrendPct(activeCandles, 30)
  const avgVolume20 = averageVolume(activeCandles, 20)
  const lastCandle = latestCandle(activeCandles)
  const prevCandle = previousCandle(activeCandles)
  const chartWindowCandles = useMemo(() => chartModel.candles.map((point) => point.candle), [chartModel])
  const patternSignals = useMemo(() => detectCandlestickPatterns(chartWindowCandles), [chartWindowCandles])
  const recentPatternSignals = patternSignals.slice(-8).reverse()
  const chartTrendPct = candleTrendPct(chartWindowCandles, chartWindowCandles.length)
  const avgPriceNum = parseNumber(form.averagePrice)
  const quantityNum = parseNumber(form.quantity)
  const investedValue = form.alreadyHold && avgPriceNum && quantityNum ? avgPriceNum * quantityNum : undefined
  const currentValue = form.alreadyHold && analysis.ltp && quantityNum ? analysis.ltp * quantityNum : undefined
  const breakevenMove = form.alreadyHold && avgPriceNum && analysis.ltp ? ((avgPriceNum - analysis.ltp) / analysis.ltp) * 100 : undefined
  const invalidationPriceNum = parseNumber(form.invalidationPrice)
  const targetPriceNum = parseNumber(form.targetPrice)
  const riskPerShare = analysis.ltp && invalidationPriceNum && invalidationPriceNum < analysis.ltp ? analysis.ltp - invalidationPriceNum : undefined
  const rewardRisk =
    targetPriceNum && analysis.ltp && riskPerShare && targetPriceNum > analysis.ltp ? (targetPriceNum - analysis.ltp) / riskPerShare : undefined
  const pnlTone = (analysis.positionPnl ?? 0) >= 0 ? 'tone-positive' : 'tone-negative'
  const pnlPercentTone = (analysis.positionPnlPct ?? 0) >= 0 ? 'tone-positive' : 'tone-negative'
  const trendTone = toneFromNumber(recentTrendPct, (value) => value > 3, (value) => value < -3)
  const portfolioWeightTone = toneFromNumber(analysis.portfolioWeight, (value) => value <= 10, (value) => value > 20)
  const confidenceTone = analysis.confidence >= 70 ? 'positive' : analysis.confidence < 45 ? 'negative' : 'neutral'
  const riskSetupTone = riskPerShare && rewardRisk ? (rewardRisk >= 2 ? 'positive' : rewardRisk < 1 ? 'negative' : 'neutral') : 'negative'
  const liquidityTone = toneFromNumber(avgVolume20, (value) => value >= 100000, (value) => value > 0 && value < 25000)
  const candleCountTone = activeCandles.length >= 180 ? 'positive' : activeCandles.length > 0 ? 'neutral' : 'negative'
  const companyMarketCap = numberFrom(activeFundamentals?.market_cap)
  const companyDebtEquity = normaliseDebtEquity(activeFundamentals?.debt_to_equity)
  const companyTrailingPe = numberFrom(activeFundamentals?.trailing_pe)
  const companyForwardPe = numberFrom(activeFundamentals?.forward_pe)
  const companyPriceToBook = numberFrom(activeFundamentals?.price_to_book)
  const companyRoe = numberFrom(activeFundamentals?.return_on_equity)
  const companyRoa = numberFrom(activeFundamentals?.return_on_assets)
  const companyRoce = numberFrom(activeFundamentals?.roce)
  const companyProfitMargin = numberFrom(activeFundamentals?.profit_margins)
  const companyGrossMargin = numberFrom(activeFundamentals?.gross_margins)
  const companyOperatingMargin = numberFrom(activeFundamentals?.operating_margins)
  const companyCurrentRatio = numberFrom(activeFundamentals?.current_ratio)
  const companyOperatingCashflow = numberFrom(activeFundamentals?.operating_cashflow)
  const companyFreeCashflow = numberFrom(activeFundamentals?.free_cashflow)
  const companyRevenue = numberFrom(activeFundamentals?.revenue)
  const companyNetProfit = numberFrom(activeFundamentals?.net_profit)
  const companyDividendYield = numberFrom(activeFundamentals?.dividend_yield)
  const companyRevenueGrowth = numberFrom(activeFundamentals?.revenue_growth)
  const companyEarningsGrowth = numberFrom(activeFundamentals?.earnings_growth)
  const inferredProfitTrend = inferProfitTrend(companyEarningsGrowth, companyRevenueGrowth, companyNetProfit)
  const effectiveProfitTrend = form.profitTrend === 'unknown' ? inferredProfitTrend : form.profitTrend
  const marketCapCr = parseNumber(form.marketCapCr) ?? (companyMarketCap === undefined ? undefined : companyMarketCap / 10000000)
  const debtEquity = parseNumber(form.debtEquity) ?? companyDebtEquity
  const roce = parseNumber(form.roce) ?? companyRoce
  const pe = parseNumber(form.pe) ?? companyTrailingPe
  const fundamentalLayerScore = componentScore(analysis, 'Fundamental quality') ?? analysis.score
  const qualityChecklistTone = toneFromScore(fundamentalLayerScore)
  const qualityChecklistLabel = fundamentalLayerScore >= 62 ? 'Supportive' : fundamentalLayerScore >= 48 ? 'Mixed' : 'Weak'
  const profitStatus =
    effectiveProfitTrend === 'growing' || effectiveProfitTrend === 'stable'
      ? 'strong'
      : effectiveProfitTrend === 'declining'
        ? 'watch'
        : effectiveProfitTrend === 'loss_making'
          ? 'weak'
          : 'needs data'
  const qualityFactors = [
    {
      label: 'Market cap',
      value: marketCapCr === undefined ? 'Needed' : `${formatNumber(marketCapCr)} cr`,
      status: factorStatus(marketCapCr, (value) => value >= 10000, (value) => value >= 1000),
      caption: 'Larger companies are usually easier to exit and less fragile than micro caps.',
    },
    {
      label: 'Debt/equity',
      value: formatNumber(debtEquity),
      status: factorStatus(debtEquity, (value) => value <= 0.5, (value) => value <= 1),
      caption: 'Lower debt gives the company more room to survive weak cycles.',
    },
    {
      label: 'ROCE',
      value: formatPercent(roce),
      status: factorStatus(roce, (value) => value >= 18, (value) => value >= 10),
      caption: 'ROCE shows how efficiently the business converts capital into profit.',
    },
    {
      label: 'P/E',
      value: formatNumber(pe),
      status: factorStatus(pe, (value) => value > 8 && value < 30, (value) => value > 0 && value <= 55),
      caption: 'P/E helps check whether price is reasonable versus earnings.',
    },
    {
      label: 'Profit trend',
      value: profitTrendLabels[effectiveProfitTrend],
      status: profitStatus,
      caption: 'Improving or stable profit trend reduces the chance of a value trap.',
    },
  ]
  useEffect(() => {
    const autoMarketCapCr = companyMarketCap === undefined ? undefined : companyMarketCap / 10000000
    const cleanNumber = (value: number | undefined, decimals = 4) =>
      value === undefined || !Number.isFinite(value) ? '' : Number(value.toFixed(decimals)).toString()
    const key = [
      decisionSymbol,
      cleanNumber(autoMarketCapCr, 2),
      cleanNumber(companyDebtEquity),
      cleanNumber(companyRoce),
      cleanNumber(companyTrailingPe),
      inferredProfitTrend,
    ].join('|')

    if (autoCompanyOverrideKeyRef.current === key) return
    autoCompanyOverrideKeyRef.current = key

    setForm((current) => {
      const next: Partial<AnalysisForm> = {}
      if (!current.marketCapCr && autoMarketCapCr !== undefined) next.marketCapCr = cleanNumber(autoMarketCapCr, 2)
      if (!current.debtEquity && companyDebtEquity !== undefined) next.debtEquity = cleanNumber(companyDebtEquity)
      if (!current.roce && companyRoce !== undefined) next.roce = cleanNumber(companyRoce)
      if (!current.pe && companyTrailingPe !== undefined) next.pe = cleanNumber(companyTrailingPe)
      if (current.profitTrend === 'unknown' && inferredProfitTrend !== 'unknown') next.profitTrend = inferredProfitTrend
      return Object.keys(next).length ? { ...current, ...next } : current
    })
  }, [companyDebtEquity, companyMarketCap, companyRoce, companyTrailingPe, decisionSymbol, inferredProfitTrend])

  const rsiInterpretation =
    chartModel.latestRsi === undefined
      ? 'Needs at least 14 candles.'
      : chartModel.latestRsi >= 70
        ? 'Strong momentum, but fresh buying needs pullback or breakout confirmation.'
        : chartModel.latestRsi <= 30
          ? 'Oversold zone; avoid assuming reversal until price confirms support.'
          : 'Neutral momentum; trend and support/resistance matter more.'
  const macdInterpretation =
    chartModel.latestMacd === undefined || chartModel.latestMacdSignal === undefined
      ? 'Needs a longer candle history.'
      : chartModel.latestMacd > chartModel.latestMacdSignal
        ? 'MACD is above signal, so momentum is leaning bullish.'
        : 'MACD is below signal, so momentum is leaning cautious.'
  const atrPercent = chartModel.latestAtr && analysis.ltp ? (chartModel.latestAtr / analysis.ltp) * 100 : undefined
  const atrInterpretation =
    chartModel.latestAtr === undefined
      ? 'Needs at least 14 candles.'
      : `Recent average daily range is about ${formatInr(chartModel.latestAtr)} (${formatPercent(atrPercent)} of price). Use it for practical stops.`
  const vwapInterpretation =
    chartModel.latestVwap === undefined || analysis.ltp === undefined
      ? 'Needs price and volume data.'
      : analysis.ltp >= chartModel.latestVwap
        ? 'Price is above displayed-window VWAP, which says buyers are accepting higher prices.'
        : 'Price is below displayed-window VWAP, so buyers have not yet reclaimed the volume-weighted average.'
  const chartIndicatorSummaries = [
    {
      label: 'RSI 14',
      value: formatNumber(chartModel.latestRsi),
      text: rsiInterpretation,
      tone: toneFromNumber(chartModel.latestRsi, (value) => value > 45 && value < 70, (value) => value <= 30 || value >= 78),
      visible: chartIndicators.rsi,
    },
    {
      label: 'MACD',
      value:
        chartModel.latestMacd === undefined || chartModel.latestMacdSignal === undefined
          ? '-'
          : `${chartModel.latestMacd.toFixed(2)} / ${chartModel.latestMacdSignal.toFixed(2)}`,
      text: macdInterpretation,
      tone: chartModel.latestMacd === undefined || chartModel.latestMacdSignal === undefined ? 'neutral' : chartModel.latestMacd > chartModel.latestMacdSignal ? 'positive' : 'negative',
      visible: chartIndicators.macd,
    },
    { label: 'ATR 14', value: formatInr(chartModel.latestAtr), text: atrInterpretation, tone: 'neutral', visible: chartIndicators.atr },
    {
      label: 'VWAP',
      value: formatInr(chartModel.latestVwap),
      text: vwapInterpretation,
      tone: chartModel.latestVwap === undefined || analysis.ltp === undefined ? 'neutral' : analysis.ltp >= chartModel.latestVwap ? 'positive' : 'negative',
      visible: chartIndicators.vwap,
    },
    {
      label: 'Patterns',
      value: recentPatternSignals.length ? 'Explained below' : 'None recent',
      text: recentPatternSignals.length
        ? 'Each detected pattern is listed below with its date, bias, usage rule, and caution.'
        : 'No major candle pattern is visible in this zoom window.',
      tone: recentPatternSignals.some((signal) => signal.bias === 'bullish') ? 'positive' : recentPatternSignals.some((signal) => signal.bias === 'bearish') ? 'negative' : 'neutral',
      visible: chartIndicators.patterns,
    },
  ].filter((item) => item.visible)

  function signalHasUsefulValue(signal: AdaptiveSignal) {
    return Boolean(signal.value && signal.value !== '-' && signal.value !== 'None loaded' && signal.value !== 'Pending')
  }

  function compactDriver(signal: AdaptiveSignal) {
    const value = signalHasUsefulValue(signal) ? ` ${signal.value}` : ' missing'
    return `${signal.label}${value}`
  }

  function componentSignals(component: ScoreComponent) {
    const label = component.label.toLowerCase()
    if (label.includes('technical')) return analysis.adaptiveSignals.filter((signal) => signal.group === 'Technical')
    if (label.includes('fundamental')) return analysis.adaptiveSignals.filter((signal) => signal.group === 'Fundamental' || signal.label === 'Sector-specific checklist')
    if (label.includes('statement')) return analysis.adaptiveSignals.filter((signal) => signal.group === 'Statements')
    if (label.includes('risk')) return analysis.adaptiveSignals.filter((signal) => signal.group === 'Risk' || (signal.group === 'Process' && signal.label !== 'Sector-specific checklist'))
    if (label.includes('updates')) return analysis.adaptiveSignals.filter((signal) => signal.group === 'News')
    return []
  }

  function componentTradingUse(component: ScoreComponent) {
    const label = component.label.toLowerCase()
    if (label.includes('technical')) return isHoldingReview
      ? 'For price, this means the holding needs key averages/support to hold; if they fail, rallies are more likely to be sold.'
      : 'For price, this means an entry should wait for a clean trigger; without it, the stock can drift or reverse after a quick move.'
    if (label.includes('fundamental')) return 'For price, stronger business quality can attract patient buyers; weak quality means rallies need extra proof from earnings and cash flow.'
    if (label.includes('statement')) return 'For price, clean sales-profit-cash alignment makes valuation easier to trust; weak cash or debt clues can make the market discount the stock.'
    if (label.includes('risk')) return isHoldingReview
      ? capitalNum
        ? 'For price, this separates a controlled add from emotional averaging; without a clear invalidation, a further fall can hurt the portfolio more than expected.'
        : 'For price, this is mainly about protecting capital if the stock breaks support or stays weak; no add-more capital is active.'
      : 'For price, this converts the idea into an entry size and exit line so a wrong move does not become a large portfolio problem.'
    return 'For price, fresh news, filings, or events can quickly re-rate or de-rate the stock, even when charts and ratios looked calm.'
  }

  function componentNarrative(component: ScoreComponent) {
    const drivers = componentSignals(component)
    const supports = drivers
      .filter((signal) => signal.score >= 62 && signalHasUsefulValue(signal))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
    const drags = drivers
      .filter((signal) => signal.score <= 48 || !signalHasUsefulValue(signal))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
    const supportText = supports.length
      ? `What can help price: ${supports.map(compactDriver).join('; ')}.`
      : 'No strong upside clue is loaded here yet.'
    const dragText = drags.length
      ? `What can cap or hurt price: ${drags.map(compactDriver).join('; ')}.`
      : 'No major price drag is visible here.'
    return `${supportText} ${dragText} ${componentTradingUse(component)}`
  }

  function componentDefinition(component: ScoreComponent) {
    const label = component.label.toLowerCase()
    if (label.includes('technical')) return 'Checks whether price action, trend, volume, volatility, and candle behaviour show buyers gaining control or sellers still dominating.'
    if (label.includes('fundamental')) return 'Checks whether the business quality, valuation, profitability, debt, and sector context can support the share price beyond short-term chart moves.'
    if (label.includes('statement')) return 'Checks whether sales, profit, balance sheet strength, and cash flow agree with each other instead of telling conflicting stories.'
    if (label.includes('risk')) return 'Checks whether the position has a practical entry, exit line, quantity, drawdown control, and portfolio concentration discipline.'
    if (label.includes('updates')) return 'Checks whether recent company or exchange updates can change market expectations and therefore future price behaviour.'
    return component.rationale
  }

  function signalReason(signal: AdaptiveSignal) {
    const label = signal.label.toLowerCase()
    if (!signalHasUsefulValue(signal)) return 'the app does not have a reliable value for it yet'
    if (label.includes('30-day trend')) return signal.score >= 62 ? 'recent price is advancing enough to support momentum' : signal.score <= 42 ? 'recent price action is weak or falling' : 'recent price action is not decisive'
    if (label.includes('moving-average')) return signal.score >= 62 ? 'price has reclaimed most key trend averages' : signal.score <= 42 ? 'price is still below too many watched averages' : 'price is only partially aligned with key averages'
    if (label.includes('rsi')) return signal.score >= 62 ? 'momentum is positive without being extremely stretched' : signal.score <= 42 ? 'momentum is either weak or too stretched to chase' : 'momentum is usable but not clean'
    if (label.includes('macd')) return signal.score >= 62 ? 'MACD is confirming improving momentum' : signal.score <= 42 ? 'MACD is not confirming the move' : 'MACD gives partial confirmation only'
    if (label.includes('atr')) return signal.score >= 62 ? 'volatility is manageable for position sizing' : signal.score <= 42 ? 'volatility is high enough to demand smaller size or wider stops' : 'volatility needs normal caution'
    if (label.includes('vwap')) return signal.score >= 62 ? 'price is accepted above the volume-weighted reference' : signal.score <= 42 ? 'price is below the volume-weighted reference' : 'VWAP is not giving a clear edge'
    if (label.includes('bollinger')) return signal.score >= 62 ? 'price is holding in a healthier part of its volatility band' : signal.score <= 42 ? 'price is sitting in a weak band location' : 'band location is only mildly supportive'
    if (label.includes('candlestick') || label.startsWith('pattern')) return signal.score >= 62 ? 'recent candles lean bullish' : signal.score <= 42 ? 'recent candles warn about supply or failed demand' : 'the candle setup is mixed or only an alert'
    if (label.includes('liquidity')) return signal.score >= 62 ? 'traded volume gives more practical entry and exit comfort' : signal.score <= 42 ? 'thin volume can make exits harder' : 'liquidity is only adequate'
    if (label.includes('debt')) return signal.score >= 62 ? 'leverage looks manageable under the balance-sheet check' : signal.score <= 42 ? 'leverage is a meaningful business-risk drag' : 'leverage is not clearly good or bad'
    if (label.includes('roce') || label.includes('roe')) return signal.score >= 62 ? 'return on capital is supportive' : signal.score <= 42 ? 'return on capital is too weak for high conviction' : 'return on capital is only middling'
    if (label.includes('p/e') || label.includes('price/book')) return signal.score >= 62 ? 'valuation is inside the app comfort band' : signal.score <= 42 ? 'valuation asks for stronger growth or a better entry price' : 'valuation is not cheap enough to drive action alone'
    if (label.includes('cfo') || label.includes('cash')) return signal.score >= 62 ? 'cash generation supports reported profits' : signal.score <= 42 ? 'cash conversion is weak or missing' : 'cash evidence is incomplete'
    if (label.includes('risk plan')) return signal.score >= 62 ? 'the downside-control plan is defined' : 'the risk plan is incomplete'
    if (label.includes('reward/risk')) return signal.score >= 62 ? 'upside justifies the defined downside better' : signal.score <= 42 ? 'payoff is not attractive enough yet' : 'payoff is only partly acceptable'
    if (label.includes('update')) return signal.score >= 62 ? 'recent updates are not hurting the price setup' : signal.score <= 42 ? 'recent updates add event risk that can pressure price' : 'recent updates are neutral or unresolved'
    return signal.score >= 62 ? 'the current evidence is supportive' : signal.score <= 42 ? 'the current evidence is risky' : 'the current evidence is mixed'
  }

  function signalTradingUse(signal: AdaptiveSignal) {
    const label = signal.label.toLowerCase()
    const supportive = signal.score >= 62
    const weak = signal.score <= 42
    if (label.includes('30-day trend')) {
      if (supportive) return 'If this trend holds, the stock can attract follow-through buying and test the next resistance zone.'
      if (weak) return 'If this weakness continues, rallies are more likely to face selling pressure before price can recover.'
      return 'Trend is not decisive, so price may stay range-bound until a breakout or breakdown appears.'
    }
    if (label.includes('moving-average')) {
      if (supportive) return 'Holding above key averages usually keeps buyers interested and makes pullbacks more buyable.'
      if (weak) return 'Staying below key averages turns those levels into overhead resistance and can slow any recovery.'
      return 'Partial average alignment means price still needs a stronger close to prove buyers have control.'
    }
    if (label.includes('rsi')) {
      if (supportive) return 'Momentum is positive enough to help price continue, but a very fast move can still cool off.'
      if (weak) return 'Weak or stretched momentum can lead to sideways consolidation or a pullback before the next good entry.'
      return 'Momentum is not giving a clear push, so price needs help from trend or volume.'
    }
    if (label.includes('macd')) {
      if (supportive) return 'Improving MACD can pull more trend-following buyers in if price also holds support.'
      if (weak) return 'Weak MACD warns that price strength may fade instead of extending.'
      return 'MACD is only partly confirming, so price needs another candle or volume signal.'
    }
    if (label.includes('atr')) {
      if (supportive) return 'Manageable volatility makes it easier to set a stop without normal noise forcing an exit.'
      if (weak) return 'High volatility means price can swing sharply against you, so quantity should be smaller or the entry should improve.'
      return 'Volatility is normal caution; future price swings may look dramatic without changing the thesis.'
    }
    if (label.includes('vwap')) {
      if (supportive) return 'Price above VWAP suggests buyers are accepting higher prices, which can support continuation.'
      if (weak) return 'Price below VWAP suggests sellers still have influence, so upside may stall until VWAP is reclaimed.'
      return 'VWAP is not decisive, so do not use it to justify entry or exit by itself.'
    }
    if (label.includes('bollinger')) {
      if (supportive) return 'A healthier band position can let price grind higher, especially if volume confirms.'
      if (weak) return 'A weak band position can keep price under pressure or signal that a bounce needs confirmation.'
      return 'Band location is neutral; watch for a squeeze, breakout, or breakdown before acting.'
    }
    if (label.includes('candlestick') || label.startsWith('pattern')) {
      if (supportive) return 'Bullish candles can trigger short-term demand, but the next close must confirm.'
      if (weak) return 'Bearish candles can invite selling or failed bounces, especially near resistance.'
      return 'Mixed candles mean price has not chosen direction; wait for confirmation.'
    }
    if (label.includes('liquidity') || label.includes('volume')) {
      if (supportive) return 'Better volume makes price moves more believable and exits more practical.'
      if (weak) return 'Thin volume can exaggerate price jumps and make exits painful if sellers appear.'
      return 'Liquidity is only adequate, so size should stay practical.'
    }
    if (label.includes('market cap')) {
      if (supportive) return 'Larger size can reduce fragility and attract steadier institutional attention.'
      if (weak) return 'Small size can make price more volatile and more sensitive to bad news or low volume.'
      return 'Company size is not a strong price support; liquidity and disclosures still matter.'
    }
    if (label.includes('debt')) {
      if (supportive) return 'Manageable debt lowers the chance that bad quarters permanently hurt the stock.'
      if (weak) return 'High debt can make price fall harder when earnings or cash flow disappoint.'
      return 'Debt evidence is not clean enough to raise confidence in future price support.'
    }
    if (label.includes('roce') || label.includes('roe')) {
      if (supportive) return 'Good returns on capital can justify a stronger valuation if growth continues.'
      if (weak) return 'Weak returns make it harder for the market to pay a premium price.'
      return 'Middling returns mean price needs either better growth or a cheaper entry.'
    }
    if (label.includes('p/e') || label.includes('price/book')) {
      if (supportive) return 'Valuation is not blocking the setup, so price can respond better to good earnings or chart strength.'
      if (weak) return 'Expensive valuation can cap upside because buyers may wait for growth proof or a lower price.'
      return 'Valuation is fair/mixed, so future price depends more on earnings delivery and chart structure.'
    }
    if (label.includes('cfo') || label.includes('cash')) {
      if (supportive) return 'Cash-backed profit can support rerating because the market trusts earnings more.'
      if (weak) return 'Weak cash conversion can pressure price even when reported profit looks fine.'
      return 'Cash evidence is incomplete, so the stock may need more filings before conviction improves.'
    }
    if (label.includes('risk plan') || label.includes('reward/risk')) {
      if (supportive) return 'A cleaner risk/reward setup means the stock can be traded with a defined downside if price moves wrong.'
      if (weak) return 'Poor risk/reward means even a good story may not be worth buying at this price.'
      return 'Risk/reward is only partial; price needs a clearer entry or exit level.'
    }
    if (label.includes('update')) {
      if (supportive) return 'Neutral or positive updates reduce the chance of sudden expectation damage.'
      if (weak) return 'Negative or unclear updates can pressure price until the market sees better evidence.'
      return 'Updates are not giving a strong price catalyst either way.'
    }
    if (supportive) return 'This can improve demand if the rest of the setup agrees.'
    if (weak) return 'This can add supply pressure or reduce buyer confidence.'
    return 'This is mixed, so price needs clearer confirmation from stronger signals.'
  }

  function signalNarrative(signal: AdaptiveSignal) {
    if (signal.label.toLowerCase().includes('top 3 updates')) {
      if (!companyUpdates.length) {
        return `${activeTickerDisplay} has no recent update strong enough to change the price view yet. That means the next move will probably depend more on chart structure, earnings delivery, and liquidity than on a fresh event.`
      }
      const updateReads = companyUpdates
        .slice(0, 3)
        .map((update, index) => `Update ${index + 1}: ${updateKind(update)}${update.date ? ` on ${update.date}` : ''}. ${updatePriceImpact(update)}`)
        .join(' ')
      return `${activeTickerDisplay} has recent filing/event inputs. ${updateReads}`
    }
    const valueText = signalHasUsefulValue(signal) ? signal.value : 'missing'
    return `${signal.label}: ${valueText}. ${signalReason(signal)}. ${signalTradingUse(signal)}`
  }

  function signalDefinition(signal: AdaptiveSignal) {
    const label = signal.label.toLowerCase()
    if (label.includes('30-day trend')) return 'Shows whether the recent price direction is rising, falling, or sideways.'
    if (label.includes('moving-average')) return 'Compares price with commonly watched trend averages to see whether buyers or sellers control the broader trend.'
    if (label.includes('rsi')) return 'Measures price momentum. Very high can mean stretched; very low can mean weak or oversold.'
    if (label.includes('macd')) return 'Compares faster and slower moving averages to show whether momentum is improving or fading.'
    if (label.includes('atr')) return 'Estimates normal daily movement, helping decide stop distance and position size.'
    if (label.includes('vwap')) return 'Shows the volume-weighted average price. Price above it suggests buyers are accepting higher levels.'
    if (label.includes('bollinger')) return 'Shows whether price is near the high, middle, or low part of its recent volatility range.'
    if (label.includes('candlestick') || label.startsWith('pattern')) return 'Reads recent candle shapes as buyer/seller pressure alerts that still need confirmation.'
    if (label.includes('liquidity') || label.includes('volume')) return 'Checks whether enough shares trade to make price moves and exits more reliable.'
    if (label.includes('market cap')) return 'Shows company size, which affects liquidity, fragility, and institutional participation.'
    if (label.includes('debt')) return 'Shows balance-sheet leverage. High debt can make bad cycles more dangerous.'
    if (label.includes('roce') || label.includes('roe')) return 'Shows how efficiently the company earns profit on the capital it uses.'
    if (label.includes('p/e') || label.includes('price/book')) return 'Compares market price with earnings or book value to judge whether expectations are already high.'
    if (label.includes('cfo') || label.includes('cash')) return 'Checks whether accounting profit is turning into real operating cash.'
    if (label.includes('risk plan')) return 'Checks whether there is a clear downside line before adding or buying.'
    if (label.includes('reward/risk')) return 'Compares likely upside with planned downside.'
    if (label.includes('update')) return 'Checks whether recent news or filings could change market expectations.'
    return signal.rationale
  }

  function adaptiveSignalCategory(signal: AdaptiveSignal) {
    const label = signal.label.toLowerCase()
    const group = signal.group.toLowerCase()
    // Group-first: business, news, and process evidence get their own decks
    // instead of falling through into one oversized technical bucket.
    if (group === 'news') return 'News & Updates'
    if (group === 'process') return 'Process & Discipline'
    if (group === 'fundamental' || group === 'statements') {
      if (
        label.includes('p/e') ||
        label.includes('price/book') ||
        label.includes('valuation') ||
        label.includes('market cap') ||
        label.includes('dividend') ||
        label.includes('debt') ||
        label.includes('current ratio') ||
        label.includes('reserves') ||
        label.includes('borrowings')
      ) {
        return 'Valuation & Balance Sheet'
      }
      if (label.includes('growth') || label.includes('fcf') || label.includes('cfo') || label.includes('cash')) return 'Growth & Cash Flow'
      return 'Profitability & Earnings'
    }
    if (label.includes('pattern') || label.includes('candle')) return 'Candles & Patterns'
    if (label.includes('trend') || label.includes('moving-average') || label.includes('rsi') || label.includes('macd') || label.includes('momentum')) return 'Trend & Momentum'
    if (group === 'risk' || label.includes('atr') || label.includes('bollinger') || label.includes('drawdown') || label.includes('risk') || label.includes('reward') || label.includes('concentration')) return 'Volatility & Risk'
    if (label.includes('liquidity') || label.includes('volume') || label.includes('vwap')) return 'Liquidity & Execution'
    return 'Levels & Structure'
  }

  const adaptiveSignalGroups = [
    'Trend & Momentum',
    'Candles & Patterns',
    'Levels & Structure',
    'Volatility & Risk',
    'Liquidity & Execution',
    'Profitability & Earnings',
    'Valuation & Balance Sheet',
    'Growth & Cash Flow',
    'News & Updates',
    'Process & Discipline',
  ]
    .map((title) => ({
      title,
      signals: analysis.adaptiveSignals.filter((signal) => adaptiveSignalCategory(signal) === title),
    }))
    .filter((group) => group.signals.length > 0)

  function indicatorDefinition(label: string) {
    if (label.startsWith('RSI')) return 'RSI measures momentum from 0 to 100. Above 70 can be stretched; below 30 can be oversold; confirmation matters more than the number alone.'
    if (label === 'MACD') return 'MACD compares fast and slow moving averages. Above the signal line leans bullish; below it leans cautious.'
    if (label.startsWith('ATR')) return 'ATR estimates the stock’s average daily movement. It helps set practical stops and position sizes.'
    if (label === 'VWAP') return 'VWAP is the volume-weighted average price for the displayed window. Price above it suggests stronger buyer acceptance.'
    return 'Pattern count is only a prompt to inspect the actual candle setup. Patterns need location, volume, trend, and next-candle confirmation.'
  }

  function indicatorNarrative(item: { label: string; text: string; tone: string; value: string }) {
    if (item.label.startsWith('RSI')) {
      return `${activeTickerDisplay} has RSI at ${item.value}. ${item.tone === 'positive' ? 'Momentum can help price continue higher if the next candles hold support.' : item.tone === 'negative' ? 'Momentum is either weak or stretched, so price can pull back or move sideways before a cleaner entry appears.' : 'Momentum is not pushing price clearly, so the next move depends more on trend, volume, and support.'}`
    }
    if (item.label === 'MACD') {
      return `${activeTickerDisplay} has MACD at ${item.value}. ${item.tone === 'positive' ? 'Momentum is improving, which can attract trend buyers if price stays above support.' : item.tone === 'negative' ? 'Momentum is not confirming the move, so price strength may fade unless MACD improves.' : 'MACD is neutral or incomplete, so price needs another confirmation candle or volume signal.'}`
    }
    if (item.label.startsWith('ATR')) {
      return `${activeTickerDisplay} has ATR around ${item.value}. This is the normal daily swing size; if ATR is large, future price can move against you quickly, so quantity and stops need more room.`
    }
    if (item.label === 'VWAP') {
      return `${activeTickerDisplay} has VWAP near ${item.value}. ${item.tone === 'positive' ? 'Price is above the volume-weighted reference, so buyers are accepting higher prices in this window.' : item.tone === 'negative' ? 'Price is below the volume-weighted reference, so demand has not fully reclaimed control.' : 'VWAP is not loaded clearly enough to influence the decision.'}`
    }
    if (item.label === 'Patterns') {
      return recentPatternSignals.length
        ? `${activeTickerDisplay} has ${recentPatternSignals.length} recent candle pattern alert${recentPatternSignals.length === 1 ? '' : 's'}. Bullish patterns can trigger demand and bearish patterns can invite supply, but the next candle must confirm direction.`
        : `${activeTickerDisplay} has no major recent candlestick pattern in this window, so the next price move depends more on trend, volume, and support/resistance.`
    }
    return `${activeTickerDisplay}: ${item.text}`
  }

  const patternFindings = recentPatternSignals.map((signal) => {
    const candle = chartWindowCandles[signal.index]
    return {
      ...signal,
      caution: patternCautionText(signal),
      date: candle?.date ?? '-',
      looks: patternLooksText(signal),
      price: candle?.close,
      spot: patternSpotText(signal),
      use: patternUseText(signal),
    }
  })
  const chartGuideSections = [
    {
      title: 'Trend and moving averages',
      spot: 'First look at the direction of price, then compare it with SMA/EMA 20, 50, 100, and 200. A healthy positional trend usually has price above rising averages, with shorter averages above longer averages.',
      looks: 'On the chart, this looks like candles travelling above smooth rising lines. A weak setup looks like candles trapped below falling averages or repeatedly failing at the same average.',
      means: 'Moving averages are not magic support; they are a quick way to see whether market participants are accepting higher prices over time.',
      use: 'For buying or holding, prefer pullbacks that respect a rising average and then close back up. For exits or no-add decisions, watch repeated closes below key averages.',
      caution: 'Averages lag. A stock can cross above an average after much of the move is already done, so combine it with volume, structure, and fundamentals.',
    },
    {
      title: 'Support and resistance',
      spot: 'Support is an area where price has stopped falling earlier. Resistance is an area where price has stopped rising earlier. Use zones, not exact single-rupee lines.',
      looks: 'Support often appears as multiple lows around the same band. Resistance often appears as repeated highs, failed breakouts, or long upper wicks near the same band.',
      means: 'These zones show where buyers or sellers previously became active. A breakout means price is trying to leave the old zone; a rejection means the old force is still present.',
      use: 'Prefer entries near support after confirmation, or after a breakout that holds above resistance. For existing holdings, a support break gives a cleaner invalidation point.',
      caution: 'A level is weaker after being tested many times. False breakouts are common, so look for closing price and volume confirmation rather than reacting to an intraday spike.',
    },
    {
      title: 'Volume confirmation',
      spot: 'Look below the candles. Compare today’s volume with recent bars and the 20-day average feel. Big price moves on thin volume deserve suspicion.',
      looks: 'A stronger breakout usually has a tall volume bar with a strong close. A weak bounce often has small volume bars and fades quickly.',
      means: 'Volume tells you how much participation is behind the move. Price rising with volume means demand is more believable; price falling with volume means supply is serious.',
      use: 'Use volume as a vote of confidence. For buying, prefer breakouts and reversals with above-average volume. For holding, volume helps decide whether a fall is ordinary noise or distribution.',
      caution: 'One high-volume day can be news-driven or block-deal related. Read it with price action and company news, not in isolation.',
    },
    {
      title: 'RSI and MACD momentum',
      spot: 'RSI sits between 0 and 100. MACD compares a fast EMA with a slow EMA and then plots a signal line. Watch the direction and crossovers, not only the latest number.',
      looks: 'RSI above 50 with higher lows supports positive momentum. MACD above its signal line looks like momentum improving; below the signal line looks like momentum cooling.',
      means: 'Momentum indicators show the speed and persistence of price movement. They help avoid buying a stock that is still losing strength.',
      use: 'For non-intraday trades, use RSI/MACD to support a price setup. A breakout with RSI holding above 50 and MACD improving is better than a breakout with fading momentum.',
      caution: 'RSI above 70 is not an automatic sell and RSI below 30 is not an automatic buy. Strong trends can stay overbought or oversold for longer than expected.',
    },
    {
      title: 'ATR, Bollinger Bands, and volatility',
      spot: 'ATR measures the stock’s normal daily movement. Bollinger Bands widen when volatility expands and narrow when volatility contracts.',
      looks: 'High ATR means candles are swinging widely. Narrow Bollinger Bands look like price is squeezed; wide bands look like price is moving with force.',
      means: 'Volatility tells you how much room price needs to breathe. A normal daily swing should not be treated as thesis failure.',
      use: 'Place invalidation beyond a real support/resistance zone with enough ATR room. Use Bollinger compression as an alert that a bigger move may be coming, then wait for direction.',
      caution: 'A stop that is too tight gets hit by normal noise. A stop that is too wide can make position size too large for your risk budget.',
    },
    {
      title: 'VWAP and average price',
      spot: 'VWAP is the volume-weighted average price for the displayed window. Compare current price with VWAP to see whether buyers are accepting prices above the average paid level.',
      looks: 'Price above VWAP looks like candles holding over the VWAP line. Price below VWAP looks like rallies failing under the line.',
      means: 'VWAP gives a participation-weighted reference point. Above it, buyers are currently paying up; below it, sellers still have influence.',
      use: 'Use VWAP as a supporting clue, especially after a fall. A reclaim of VWAP plus higher volume can support a watchlist upgrade.',
      caution: 'This app’s VWAP is based on the displayed EOD window, not live intraday VWAP. It is useful for context, not precise execution.',
    },
    {
      title: 'Candlestick patterns',
      spot: 'Look at the body, upper shadow, lower shadow, and the candles before it. A single candle is only an alert; two- and three-candle patterns carry more context.',
      looks: 'A Hammer has a long lower wick. A Shooting Star has a long upper wick. Engulfing has a second candle body swallowing the first. Morning/Evening Star has three clear steps.',
      means: 'Patterns show a shift in control between buyers and sellers. They do not guarantee direction; they tell you where to look closer.',
      use: 'Use patterns only with location. Bullish patterns near support and bearish patterns near resistance are more useful than random patterns in the middle of a range.',
      caution: 'Always wait for confirmation: next close, volume, and invalidation level. Never average down only because a bullish candle name appears.',
    },
    {
      title: 'Final decision rule',
      spot: 'Look for confluence: trend, support/resistance, volume, momentum, fundamentals, portfolio exposure, and a defined invalidation price.',
      looks: 'A cleaner setup has several boxes agreeing. A messy setup has one bullish clue fighting multiple bearish or missing-data clues.',
      means: 'The goal is not to predict perfectly. The goal is to take trades where evidence, risk, and position size make sense together.',
      use: 'For buying or adding, demand stronger evidence. For holding, define what would prove the thesis wrong. For reducing, act when risk is high and confirmation is weak.',
      caution: 'Do not let hope replace evidence. If the chart, fundamentals, and risk plan disagree, reduce decision size or wait.',
    },
  ]
  const factorScore = (status: string) => (status === 'strong' ? 100 : status === 'watch' ? 62 : status === 'weak' ? 28 : 0)
  const fundamentalScore = Math.round(qualityFactors.reduce((sum, factor) => sum + factorScore(factor.status), 0) / qualityFactors.length)
  const fundamentalPillars = [
    {
      label: 'Business quality',
      value: activeFundamentals?.business_summary ? 'Profile loaded' : form.thesis.trim() ? 'Thesis noted' : 'Add thesis',
      score: activeFundamentals?.business_summary ? 78 : form.thesis.trim() ? 72 : 22,
      tone: activeFundamentals?.business_summary ? 'positive' : 'neutral',
      caption: activeFundamentals?.key_points || 'Start by understanding what the company sells, who buys it, what drives costs, and how strong its industry position is.',
    },
    {
      label: 'Profitability',
      value: formatPercent(roce),
      score: factorScore(qualityFactors.find((factor) => factor.label === 'ROCE')?.status ?? 'needs data'),
      tone: toneFromNumber(roce, (value) => value >= 18, (value) => value < 8),
      caption: 'ROCE checks whether the business earns enough on total capital employed, not just equity.',
    },
    {
      label: 'Balance sheet',
      value: formatNumber(debtEquity),
      score: factorScore(qualityFactors.find((factor) => factor.label === 'Debt/equity')?.status ?? 'needs data'),
      tone: toneFromNumber(debtEquity, (value) => value <= 0.5, (value) => value > 1.5),
      caption: 'Debt must be weighed with earnings ability; high leverage reduces room for mistakes.',
    },
    {
      label: 'Valuation',
      value: formatNumber(pe),
      score: factorScore(qualityFactors.find((factor) => factor.label === 'P/E')?.status ?? 'needs data'),
      tone: toneFromNumber(pe, (value) => value > 0 && value <= 30, (value) => value > 60 || value <= 0),
      caption: 'P/E is useful only with earnings quality, peer comparison, and growth context.',
    },
    {
      label: 'Cash conversion',
      value: companyFreeCashflow === undefined ? 'CFO/FCF needed' : formatLargeInr(companyFreeCashflow),
      score: companyFreeCashflow === undefined ? 18 : companyFreeCashflow > 0 ? 72 : 26,
      tone: toneFromNumber(companyFreeCashflow, (value) => value > 0, (value) => value < 0),
      caption: 'Operating cash flow and FCF matter because profits without cash can be fragile.',
    },
  ]
  const summaryValue = (key: string) => activeFundamentals?.statement_summary?.[key]
  const salesSummary = summaryValue('sales')
  const operatingProfitSummary = summaryValue('operating_profit')
  const netProfitSummary = summaryValue('net_profit')
  const epsSummary = summaryValue('eps')
  const borrowingsSummary = summaryValue('borrowings')
  const reservesSummary = summaryValue('reserves')
  const totalAssetsSummary = summaryValue('total_assets')
  const cfoSummary = summaryValue('cash_from_operations')
  const cfiSummary = summaryValue('cash_from_investing')
  const netCashFlowSummary = summaryValue('net_cash_flow')
  const fundamentalStatementFlow = [
    {
      label: 'P&L',
      title: salesSummary ? `Sales ${salesSummary.value} cr (${salesSummary.period})` : 'Revenue, margins, PAT',
      tone: toneFromNumber(companyEarningsGrowth, (value) => value > 0.08, (value) => value < 0),
      text:
        netProfitSummary || operatingProfitSummary
          ? `Latest fetched statement shows operating profit ${operatingProfitSummary?.value ?? '-'} cr, net profit ${netProfitSummary?.value ?? '-'} cr, and EPS ${epsSummary?.value ?? '-'} for ${netProfitSummary?.period ?? operatingProfitSummary?.period ?? salesSummary?.period ?? 'the latest period'}.`
          : 'Shows sales growth and profitability. Watch whether profit growth comes from core operations rather than one-off other income.',
    },
    {
      label: 'Balance sheet',
      title: totalAssetsSummary ? `Assets ${totalAssetsSummary.value} cr (${totalAssetsSummary.period})` : 'Assets, debt, equity',
      tone: toneFromNumber(debtEquity, (value) => value <= 0.5, (value) => value > 1.5),
      text:
        borrowingsSummary || reservesSummary
          ? `Latest fetched balance sheet shows borrowings ${borrowingsSummary?.value ?? '-'} cr and reserves ${reservesSummary?.value ?? '-'} cr. Debt must still be checked with interest coverage and cash generation.`
          : 'Shows what funds the business and where capital sits. Debt, inventory, and receivables deserve special attention.',
    },
    {
      label: 'Cash flow',
      title: cfoSummary ? `CFO ${cfoSummary.value} cr (${cfoSummary.period})` : 'CFO, capex, FCF',
      tone: toneFromNumber(companyOperatingCashflow, (value) => value > 0, (value) => value < 0),
      text:
        cfoSummary || cfiSummary
          ? `Latest fetched cash flow shows operating cash ${cfoSummary?.value ?? '-'} cr, investing cash ${cfiSummary?.value ?? '-'} cr, and net cash flow ${netCashFlowSummary?.value ?? '-'} cr. Prefer profit backed by operating cash.`
          : 'Shows whether accounting profit becomes real cash. Positive CFO and healthy FCF improve margin of safety.',
    },
    {
      label: 'Valuation',
      title: pe === undefined ? 'Price vs worth' : `P/E ${formatNumber(pe)} | P/B ${formatNumber(companyPriceToBook)}`,
      tone: toneFromNumber(pe, (value) => value > 0 && value <= 30, (value) => value > 60 || value <= 0),
      text: `Market cap ${formatLargeInr(companyMarketCap)}, dividend yield ${formatDecimalPercent(companyDividendYield)}, ROE ${formatDecimalPercent(companyRoe)}, and ROCE ${formatPercent(roce)} are quick valuation/quality anchors. Compare them with peers and history before concluding cheap or expensive.`,
    },
  ]
  const fetchedPros = activeFundamentals?.pros ?? []
  const fetchedCons = activeFundamentals?.cons ?? []
  const companyUpdates = meaningfulCompanyUpdates(activeFundamentals?.company_updates)
  const fundamentalChecklist = [
    {
      title: fetchedPros.length ? 'Fetched strengths' : 'Annual report review',
      tone: fetchedPros.length ? 'positive' : 'neutral',
      text: fetchedPros.length
        ? fetchedPros.join(' ')
        : 'Read at least the latest annual report, and ideally five years, for business model, risks, MD&A, related-party items, and auditor notes.',
    },
    {
      title: fetchedCons.length ? 'Fetched concerns' : 'Working capital',
      tone: fetchedCons.length ? 'negative' : 'neutral',
      text: fetchedCons.length
        ? fetchedCons.join(' ')
        : 'Track inventory days and receivable days. Rising inventory or receivables can signal weak demand, aggressive sales, or cash collection stress.',
    },
    {
      title: 'Leverage and coverage',
      tone: toneFromNumber(debtEquity, (value) => value <= 0.5, (value) => value > 1.5),
      text:
        borrowingsSummary || debtEquity !== undefined
          ? `Fetched debt evidence: borrowings ${borrowingsSummary?.value ?? '-'} cr and debt/equity ${formatNumber(debtEquity)}. Still verify interest coverage, repayment schedule, and contingent liabilities.`
          : 'Debt/equity is only the first filter. Interest coverage, debt/EBIT, and repayment schedule show whether debt is manageable.',
    },
    {
      title: 'Cash-flow quality',
      tone: toneFromNumber(companyOperatingCashflow, (value) => value > 0, (value) => value < 0),
      text:
        cfoSummary || netProfitSummary
          ? `Fetched cash/profit evidence: CFO ${cfoSummary?.value ?? '-'} cr versus net profit ${netProfitSummary?.value ?? '-'} cr. If profit rises but CFO stays weak, inspect receivables and working capital.`
          : 'Compare PAT with CFO and FCF. A company that earns profit but fails to generate operating cash needs deeper review.',
    },
    {
      title: 'Governance',
      tone: 'neutral',
      text: activeFundamentals?.source_url
        ? 'Company data is available. Still check promoter holding, pledge, remuneration, capital allocation, dilution, and auditor notes from exchange filings.'
        : 'Check promoter holding, pledge, remuneration, capital allocation, dilution, and whether communication matches reported numbers.',
    },
    {
      title: 'Peer and history comparison',
      tone:
        companyRevenueGrowth === undefined && companyEarningsGrowth === undefined
          ? 'neutral'
          : (companyRevenueGrowth ?? 0) > 0 && (companyEarningsGrowth ?? 0) > 0
            ? 'positive'
            : 'negative',
      text: `Fetched growth anchors: revenue growth ${formatDecimalPercent(companyRevenueGrowth)} and earnings growth ${formatDecimalPercent(companyEarningsGrowth)}. Ratios are not useful alone; compare them with peers and the company’s own history.`,
    },
  ]
  const companyProfileFacts = [
    { label: 'Official name', value: activeFundamentals?.name || analysis.quoteKey },
    { label: 'Sector', value: activeFundamentals?.sector || 'Refresh needed' },
    { label: 'Industry', value: activeFundamentals?.industry || 'Refresh needed' },
    { label: 'Country', value: activeFundamentals?.country || 'Refresh needed' },
    { label: 'Employees', value: formatNumber(activeFundamentals?.employees) },
  ]
  const companyRatioFacts = [
    {
      label: 'Market cap',
      value: formatLargeInr(companyMarketCap),
      tone: toneFromNumber(companyMarketCap, (value) => value >= 100_000_000_000, (value) => value < 10_000_000_000),
      helper: 'Shows company size. Larger size usually improves liquidity and disclosure comfort, but does not make the stock cheap.',
    },
    {
      label: 'Trailing P/E',
      value: formatNumber(companyTrailingPe),
      tone: toneFromNumber(companyTrailingPe, (value) => value > 0 && value <= 30, (value) => value > 60 || value <= 0),
      helper: 'Price paid for each rupee of recent earnings. High P/E means the market already expects growth; low P/E needs quality checks.',
    },
    {
      label: 'Forward P/E',
      value: formatNumber(companyForwardPe),
      tone: toneFromNumber(companyForwardPe, (value) => value > 0 && value <= 30, (value) => value > 60 || value <= 0),
      helper: 'Market expectation of future earnings. Useful only when estimates are reliable and not overly optimistic.',
    },
    {
      label: 'Price/book',
      value: formatNumber(companyPriceToBook),
      tone: toneFromNumber(companyPriceToBook, (value) => value > 0 && value <= 4, (value) => value > 10 || value <= 0),
      helper: 'Price compared with accounting net worth. More useful for asset-heavy or financial companies than asset-light firms.',
    },
    {
      label: 'ROE',
      value: formatDecimalPercent(companyRoe),
      tone: toneFromNumber(companyRoe, (value) => value >= 0.15, (value) => value < 0),
      helper: 'Profit generated on shareholder equity. Strong ROE is better when it is not inflated by excessive debt.',
    },
    {
      label: 'ROCE',
      value: formatPercent(companyRoce),
      tone: toneFromNumber(companyRoce, (value) => value >= 18, (value) => value < 8),
      helper: 'Return on total capital employed. This is one of the cleaner quality checks for non-financial businesses.',
    },
    {
      label: 'ROA',
      value: formatDecimalPercent(companyRoa),
      tone: toneFromNumber(companyRoa, (value) => value >= 0.08, (value) => value < 0),
      helper: 'Profit generated on total assets. Helps judge how productively the company uses its asset base.',
    },
    {
      label: 'Profit margin',
      value: formatDecimalPercent(companyProfitMargin),
      tone: toneFromNumber(companyProfitMargin, (value) => value >= 0.1, (value) => value < 0),
      helper: 'Share of revenue that becomes profit. Stable or rising margins usually show pricing power or cost control.',
    },
    {
      label: 'Gross margin',
      value: formatDecimalPercent(companyGrossMargin),
      tone: toneFromNumber(companyGrossMargin, (value) => value >= 0.25, (value) => value < 0),
      helper: 'Profit left after direct costs. It helps reveal pressure from raw material or execution costs.',
    },
    {
      label: 'Operating margin',
      value: formatDecimalPercent(companyOperatingMargin),
      tone: toneFromNumber(companyOperatingMargin, (value) => value >= 0.12, (value) => value < 0),
      helper: 'Profit from core operations before finance and tax effects. Useful for judging business engine strength.',
    },
    {
      label: 'Debt/equity',
      value: formatNumber(companyDebtEquity),
      tone: toneFromNumber(companyDebtEquity, (value) => value <= 0.5, (value) => value > 1.5),
      helper: 'Debt compared with equity. Lower is usually safer; high debt needs interest coverage and cash-flow checks.',
    },
    {
      label: 'Current ratio',
      value: formatNumber(companyCurrentRatio),
      tone: toneFromNumber(companyCurrentRatio, (value) => value >= 1.2, (value) => value < 1),
      helper: 'Short-term assets compared with short-term liabilities. Very low values can signal liquidity stress.',
    },
    {
      label: 'FCF',
      value: formatLargeInr(companyFreeCashflow),
      tone: toneFromNumber(companyFreeCashflow, (value) => value > 0, (value) => value < 0),
      helper: 'Cash left after capital spending. Positive FCF gives more room for dividends, debt reduction, and reinvestment.',
    },
    {
      label: 'Revenue',
      value: formatLargeInr(companyRevenue),
      tone: toneFromNumber(companyRevenueGrowth, (value) => value > 0.08, (value) => value < 0),
      helper: 'Latest fetched annual sales. Growth is healthier when margins and cash flow also improve.',
    },
    {
      label: 'Net profit',
      value: formatLargeInr(companyNetProfit),
      tone: toneFromNumber(companyEarningsGrowth, (value) => value > 0.08, (value) => value < 0),
      helper: 'Latest fetched annual profit after tax. Compare this with CFO to judge profit quality.',
    },
    {
      label: 'Operating cash flow',
      value: formatLargeInr(companyOperatingCashflow),
      tone: toneFromNumber(companyOperatingCashflow, (value) => value > 0, (value) => value < 0),
      helper: 'Cash generated by the core business. It should broadly support reported profit over time.',
    },
    {
      label: 'Dividend yield',
      value: formatDecimalPercent(companyDividendYield),
      tone: toneFromNumber(companyDividendYield, (value) => value > 0 && value <= 0.08, (value) => value > 0.15),
      helper: 'Dividend as a percentage of price. A payout is more reliable when backed by cash flow.',
    },
    {
      label: 'Revenue growth',
      value: formatDecimalPercent(companyRevenueGrowth),
      tone: toneFromNumber(companyRevenueGrowth, (value) => value > 0.08, (value) => value < 0),
      helper: 'Recent sales growth. Strong revenue growth is healthier when margins and cash flow also hold up.',
    },
    {
      label: 'Earnings growth',
      value: formatDecimalPercent(companyEarningsGrowth),
      tone: toneFromNumber(companyEarningsGrowth, (value) => value > 0.08, (value) => value < 0),
      helper: 'Recent profit growth. Check whether it came from core operations rather than one-off income.',
    },
  ]

  const companyRatioGroups = [
    {
      title: 'Valuation',
      facts: companyRatioFacts.filter((fact) => ['Market cap', 'Trailing P/E', 'Forward P/E', 'Price/book', 'Dividend yield'].includes(fact.label)),
    },
    {
      title: 'Profitability',
      facts: companyRatioFacts.filter((fact) => ['ROE', 'ROA', 'ROCE', 'Profit margin', 'Gross margin', 'Operating margin', 'EPS', 'Net profit'].includes(fact.label)),
    },
    {
      title: 'Balance Sheet & Cash',
      facts: companyRatioFacts.filter((fact) => ['Debt/equity', 'Current ratio', 'Reserves', 'Borrowings', 'Operating cash flow', 'FCF'].includes(fact.label)),
    },
    {
      title: 'Growth / Missing Context',
      facts: companyRatioFacts.filter((fact) => ['Revenue', 'Revenue growth', 'Earnings growth'].includes(fact.label) || fact.value === '-'),
    },
  ].map((group) => ({
    ...group,
    facts: Array.from(new Map(group.facts.map((fact) => [fact.label, fact])).values()),
  })).filter((group) => group.facts.length > 0)

  function ratioNarrative(fact: { label: string; value: string; tone: SignalTone }) {
    if (fact.value === '-') return `${activeTickerDisplay} does not have a reliable ${fact.label.toLowerCase()} value loaded yet. Treat it as a blind spot: price can still move, but buying or adding needs stronger confirmation from the data that is loaded.`
    const label = fact.label.toLowerCase()
    if (label.includes('market cap')) {
      return `${activeTickerDisplay} has market cap of ${fact.value}. ${fact.tone === 'positive' ? 'Size and liquidity comfort are supportive, but this does not prove the stock is cheap.' : fact.tone === 'negative' ? 'The company-size filter is weak, so keep position size smaller and demand stronger evidence.' : 'Size is only moderate, so check liquidity and disclosures before relying on this as a price-support clue.'}`
    }
    if (label.includes('p/e')) {
      return `${activeTickerDisplay} trades at ${fact.value} ${fact.label}. ${fact.tone === 'negative' ? 'The market is already pricing in a lot of future growth, so any earnings miss can cap upside or trigger a sharp de-rating.' : fact.tone === 'positive' ? 'Valuation is inside the comfort band, so good earnings or chart strength can translate into price upside more easily.' : 'Valuation is mixed, so future price needs proof from earnings quality, growth, and chart strength.'}`
    }
    if (label.includes('price/book')) {
      return `${activeTickerDisplay} has price/book of ${fact.value}. Use this mainly with asset-heavy businesses; if it is high, demand better ROE/ROCE and growth proof.`
    }
    if (label.includes('roe') || label.includes('roce') || label.includes('roa')) {
      return `${activeTickerDisplay} shows ${fact.label} of ${fact.value}. ${fact.tone === 'positive' ? 'Good return quality can support a higher market valuation if growth continues.' : fact.tone === 'negative' ? 'Weak return quality makes it harder for price to sustain a premium; rallies can fade unless returns improve.' : 'Return quality is middling, so price may need either a cheaper entry or stronger growth proof.'}`
    }
    if (label.includes('margin')) {
      return `${activeTickerDisplay} has ${fact.label.toLowerCase()} of ${fact.value}. ${fact.tone === 'positive' ? 'Margins support the business-quality case, but confirm they are stable across cycles.' : fact.tone === 'negative' ? 'Margin pressure is a drag; check raw-material, pricing, and operating-cost trends.' : 'Margins are not strong enough to drive the decision alone.'}`
    }
    if (label.includes('debt') || label.includes('current ratio')) {
      return `${activeTickerDisplay} has ${fact.label.toLowerCase()} of ${fact.value}. ${fact.tone === 'positive' ? 'Balance-sheet risk looks manageable, which gives more room for business volatility.' : fact.tone === 'negative' ? 'Balance-sheet risk is a caution; check interest coverage, repayment schedule, and cash generation before adding.' : 'Balance-sheet evidence is mixed or incomplete, so keep risk conservative.'}`
    }
    if (label.includes('cash') || label.includes('fcf')) {
      return `${activeTickerDisplay} shows ${fact.label.toLowerCase()} of ${fact.value}. ${fact.tone === 'positive' ? 'Cash generation supports reported profits and improves comfort.' : fact.tone === 'negative' ? 'Cash conversion is weak, so profits need deeper verification before buying or adding.' : 'Cash evidence is incomplete, so do not treat accounting profit as fully proven.'}`
    }
    if (label.includes('growth') || label.includes('revenue') || label.includes('profit')) {
      return `${activeTickerDisplay} shows ${fact.label.toLowerCase()} of ${fact.value}. ${fact.tone === 'positive' ? 'Growth can pull future price higher if margins and cash flow also stay healthy.' : fact.tone === 'negative' ? 'Weak or declining growth can cap upside because buyers may wait for turnaround proof.' : 'Growth is mixed, so price needs confirmation from peers, recent quarters, and margins.'}`
    }
    if (fact.tone === 'positive') return `${activeTickerDisplay} is strong on ${fact.label.toLowerCase()} at ${fact.value}; that can help future price if peers, history, cash flow, and chart structure agree.`
    if (fact.tone === 'negative') return `${activeTickerDisplay} is weak on ${fact.label.toLowerCase()} at ${fact.value}; that can cap upside or make buyers demand a lower entry price.`
    return `${activeTickerDisplay} is mixed on ${fact.label.toLowerCase()} at ${fact.value}; future price needs stronger confirmation from related metrics before this becomes useful.`
  }

  function pillarNarrative(pillar: { label: string; score: number; value: string }) {
    const label = pillar.label.toLowerCase()
    if (label.includes('business')) {
      return `${activeTickerDisplay} ${pillar.value === 'Profile loaded' ? 'has enough company profile context to read ratios with sector and business background; this reduces the risk of misreading a number in isolation.' : 'has an incomplete business description, so price conviction should stay lower until the business model is clear.'}`
    }
    if (label.includes('profitability')) {
      return `${activeTickerDisplay} has ROCE at ${pillar.value}. Stronger ROCE means the business earns more on total capital, which can support a better valuation if growth continues.`
    }
    if (label.includes('balance')) {
      return `${activeTickerDisplay} has debt/equity at ${pillar.value}. Use this to judge how much room the company has to survive a weak cycle without pressuring the share price.`
    }
    if (label.includes('valuation')) {
      return `${activeTickerDisplay} has P/E at ${pillar.value}. A comfortable valuation gives price more room to rise on good news; an expensive valuation needs stronger growth proof or a lower entry.`
    }
    if (label.includes('cash')) {
      return `${activeTickerDisplay} has ${pillar.value} for cash conversion. Profit backed by cash is more reliable and can help the market trust earnings more.`
    }
    return `${activeTickerDisplay} has ${pillar.label.toLowerCase()} at ${pillar.value}. Read it as a price-support clue only after it agrees with earnings quality, cash flow, valuation, and the chart.`
  }

  const analysisBrief = useMemo(() => {
    const enabledConstraints = constraintLabels
      .filter((constraint) => form.constraints[constraint.key])
      .map((constraint) => constraint.label)
      .join(', ')

    return [
      `Ticker: ${form.exchange}:${form.ticker.toUpperCase()}`,
      `Exchange: ${form.exchange}`,
      `Horizon: ${horizonLabels[form.horizon]}`,
      `Action: ${form.alreadyHold ? 'Sell' : 'Buy'}`,
      `${form.alreadyHold ? 'Add-more capital' : 'Capital to deploy'}: ${form.alreadyHold && !parseNumber(form.capital) ? 'Not adding' : formatInr(parseNumber(form.capital))}`,
      `Bought on: ${form.boughtOn || '-'}`,
      `Quantity: ${form.quantity || '-'}`,
      `Average price: ${form.averagePrice || '-'}`,
      `Risk profile: ${riskProfileLabels[form.riskProfile]}`,
      `Market access: ${tradeAccessLabels[form.tradeAccess]}`,
      `History window: ${days} daily candles`,
      `${form.alreadyHold ? 'Add-more max risk' : 'Max risk'}: ${form.maxRisk || '-'} ${form.riskMode === 'percent' ? '% of capital' : 'rupee amount'}`,
      `Manual LTP: ${form.manualLtp || '-'}`,
      `Invalidation price: ${form.invalidationPrice || '-'}`,
      `Target price: ${form.targetPrice || '-'}`,
      `Market cap override: ${form.marketCapCr || (marketCapCr === undefined ? '-' : `${formatNumber(marketCapCr)} cr`)}`,
      `Debt/equity override: ${form.debtEquity || formatNumber(debtEquity)}`,
      `ROCE override: ${form.roce || formatPercent(roce)}`,
      `P/E override: ${form.pe || formatNumber(pe)}`,
      `Profit trend: ${profitTrendLabels[effectiveProfitTrend]}`,
      `Personal filters: ${enabledConstraints || 'None'}`,
      `Thesis or notes: ${form.thesis || '-'}`,
      `Verdict: ${analysis.verdict} (${analysis.confidenceLabel} confidence, evidence strength ${analysis.score}/100)`,
      `LTP used: ${formatInr(analysis.ltp)}`,
      `Position P&L: ${formatInr(analysis.positionPnl)} (${formatPercent(analysis.positionPnlPct)})`,
      `Actions: ${analysis.actions.join(' ')}`,
      `Cautions: ${analysis.cautions.join(' ')}`,
    ].join('\n')
  }, [analysis, days, debtEquity, effectiveProfitTrend, form, marketCapCr, pe, roce])

  function clipText(value: string | undefined, max = 900) {
    if (!value) return undefined
    return value.length > max ? `${value.slice(0, max).trim()}...` : value
  }

  function buildAiCoachContext(scope: AiCoachScope = 'verdict') {
    const importantSignals = [...analysis.adaptiveSignals]
      .sort((a, b) => Math.abs(b.score - 50) * b.weight - Math.abs(a.score - 50) * a.weight)
      .slice(0, 24)
      .map((signal) => ({
        group: signal.group,
        label: signal.label,
        value: signal.value,
        evidenceRead: signal.score,
        tone: signal.tone,
        rationale: signal.rationale,
        companySpecificRead: signalNarrative(signal),
      }))
    const ratioEvidence = companyRatioFacts.map((fact) => ({
      label: fact.label,
      value: fact.value,
      tone: fact.tone,
      definition: fact.helper,
      companySpecificRead: ratioNarrative(fact),
    }))
    const tradingRuleCatalog = tradingDerivedRules.map((rule) => ({
      id: rule.id,
      category: publicRuleCategory(rule),
      appliesTo: rule.appliesTo,
      tone: rule.tone,
      principle: rule.principle,
      checklist: rule.checklist,
      action: rule.action,
      caution: rule.caution,
    }))
    return {
      generatedAt: new Date().toISOString(),
      coachRequest: {
        scope,
        label: aiCoachScopeCopy[scope].label,
        requestedOutput:
          scope === 'technical'
            ? 'Explain only the technical/chart picture, including trend, candles, indicators, patterns, liquidity, volatility, timing risk, and possible future price impact. Do not rewrite the full verdict.'
          : scope === 'fundamental'
              ? 'Explain only the business/fundamental picture, including company profile, sector, ratios, statements, updates, quality, data gaps, and possible future price impact. Do not rewrite the full verdict.'
              : 'Explain the full decision in plain English, with action, risk, price-impact evidence, and data gaps.',
      },
      roleBoundary: {
        appVerdictRemainsPrimary: true,
        instruction:
          'Use the supplied facts, app verdict, technical/fundamental evidence, and practical trading checks to explain the decision. Do not invent unavailable data, reveal internal source labels, or replace the app verdict.',
      },
      selectedInstrument: {
        symbol: analysis.quoteKey,
        displaySymbol: activeTickerDisplay,
        name: activeInstrumentName,
        sector: activeFundamentals?.sector,
        industry: activeFundamentals?.industry,
        ltp: analysis.ltp,
        changePct: activeChangePct,
      },
      userContext: {
        decisionMode: analysis.decisionMode,
        horizon: horizonLabels[form.horizon],
        alreadyHolding: form.alreadyHold,
        boughtOn: form.boughtOn || undefined,
        quantity: quantityNum,
        averagePrice: avgPriceNum,
        freshOrAddMoreCapital: capitalNum,
        riskProfile: riskProfileLabels[form.riskProfile],
        marketAccess: tradeAccessLabels[form.tradeAccess],
        invalidationPrice: invalidationPriceNum,
        targetPrice: targetPriceNum,
        constraints: constraintLabels.filter((constraint) => form.constraints[constraint.key]).map((constraint) => constraint.label),
        thesisNotes: clipText(form.thesis, 1200),
      },
      appVerdict: {
        verdict: analysis.verdict,
        verdictClass: analysis.verdictClass,
        evidenceRead: analysis.score,
        confidence: analysis.confidenceLabel,
        evidenceComponents: analysis.scoreComponents.map((component) => ({
          label: component.label,
          evidenceRead: component.score,
          tone: component.tone,
          definition: component.rationale,
          companySpecificRead: componentNarrative(component),
        })),
        doItems: analysis.doItems,
        dontItems: analysis.dontItems,
        whyItems: analysis.whyItems,
        actions: analysis.actions,
        positives: analysis.positives,
        cautions: analysis.cautions,
        missingInputsOrEvidence: analysis.missing,
        entryPlan: analysis.entryPlan,
        exitPlan: analysis.exitPlan,
      },
      positionAndRisk: {
        positionPnl: analysis.positionPnl,
        positionPnlPct: analysis.positionPnlPct,
        portfolioWeight: analysis.portfolioWeight,
        investedValue,
        currentValue,
        breakevenMove,
        riskCapital: analysis.riskCapital,
        riskPerShare,
        rewardRisk,
        suggestedShares: analysis.suggestedShares,
        suggestedDeployment: analysis.suggestedDeployment,
        suggestedQuantityLabel: analysis.suggestedQuantityLabel,
      },
      technicalEvidence: {
        candlesLoaded: activeCandles.length,
        latestCandle: lastCandle,
        recentTrendPct,
        averageVolume20: avgVolume20,
        priceRange: {
          low: activeRange.low,
          current: analysis.ltp,
          high: activeRange.high,
          rangePositionPct: priceRangePercent,
        },
        indicators: {
          rsi14: chartModel.latestRsi,
          macd: chartModel.latestMacd,
          macdSignal: chartModel.latestMacdSignal,
          atr14: chartModel.latestAtr,
          vwap: chartModel.latestVwap,
        },
        selectedIndicatorSummaries: chartIndicatorSummaries.map((item) => ({
          label: item.label,
          value: item.value,
          tone: item.tone,
          companySpecificRead: indicatorNarrative(item),
        })),
        patternFindings: patternFindings.slice(0, 8).map((pattern) => ({
          name: pattern.name,
          kind: pattern.kind,
          bias: pattern.bias,
          date: pattern.date,
          close: pattern.price,
          meaning: pattern.explanation,
          usageRule: pattern.use,
          caution: pattern.caution,
        })),
      },
      importantSignals,
      fundamentalEvidence: {
        profile: {
          name: activeFundamentals?.name,
          sector: activeFundamentals?.sector,
          industry: activeFundamentals?.industry,
          businessSummary: clipText(activeFundamentals?.business_summary, 1200),
          keyPoints: clipText(activeFundamentals?.key_points, 600),
        },
        ratios: ratioEvidence,
        statementFlow: fundamentalStatementFlow,
        businessQualityPillars: fundamentalPillars.map((pillar) => ({
          label: pillar.label,
          value: pillar.value,
          evidenceRead: pillar.score,
          tone: pillar.tone,
          companySpecificRead: pillarNarrative(pillar),
        })),
        annualReportChecklist: fundamentalChecklist,
        fetchedPros: fetchedPros.slice(0, 5),
        fetchedCons: fetchedCons.slice(0, 5),
        companyUpdates: companyUpdates.map((update) => ({
          title: update.title,
          summary: update.summary,
          date: update.date,
          category: update.category,
          tone: update.tone,
          businessMeaning: updateBusinessMeaning(update),
          possiblePriceEffect: updatePriceImpact(update),
        })),
      },
      practicalPriceChecks: {
        focus: ['price action', 'business quality', 'cash flow', 'risk control', 'position sizing', 'news impact', 'sector drivers'],
        instrumentChecks: analysis.tradingLessons,
        sectorOperatingRules,
        referenceChecks: tradingRuleCatalog,
      },
      reasoningTrace: analysis.steps.map((step) => ({
        title: step.title,
        plainEnglish: step.plainEnglish,
        formula: step.formula,
        rationale: step.rationale,
        takeaway: step.takeaway,
      })),
    }
  }

  async function generateAiCoachReview(scope: AiCoachScope = llmScope) {
    setLlmScope(scope)
    setLlmState('refreshing')
    setLlmResponse(null)
    setLlmMessage(aiCoachScopeCopy[scope].message)
    try {
      const bridgeUrl = requireMarketDataBridge('AI Coach')
      const response = await fetch(apiUrl(bridgeUrl, '/api/llm/verdict'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: buildAiCoachContext(scope) }),
      })
      const data = (await readResponseJson(response)) as LlmVerdictResponse
      if (!response.ok) {
        throw new Error(data.error || 'AI Coach request failed.')
      }
      setLlmResponse({ ...data, scope })
      setLlmState(data.configured === false ? 'error' : 'done')
      setLlmMessage(
        data.configured === false
          ? data.message || 'AI Coach is not configured on the data bridge yet.'
          : `${aiCoachScopeCopy[scope].label} explanation is ready for the current stock context.`,
      )
    } catch (error) {
      setLlmState('error')
      setLlmResponse(null)
      setLlmMessage(bridgeFailureMessage(error, 'Could not generate the AI Coach review.'))
    }
  }

  function updateForm<K extends keyof AnalysisForm>(key: K, value: AnalysisForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateConstraint(key: ConstraintKey, value: boolean) {
    setForm((current) => ({
      ...current,
      constraints: { ...current.constraints, [key]: value },
    }))
  }

  function copyCommand(label: string, value: string) {
    void navigator.clipboard.writeText(value)
    setCopied(label)
    window.setTimeout(() => setCopied(null), 1500)
  }

  async function readResponseJson(response: Response) {
    try {
      return (await response.json()) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  function requireMarketDataBridge(action: string) {
    if (marketDataUrl) return marketDataUrl
    throw new Error(
      `${action} needs a reachable HTTPS data bridge. Set VITE_MARKET_DATA_BASE_URL to the hosted bridge URL, or use the app in local/LAN mode for refresh and upload actions.`,
    )
  }

  function bridgeFailureMessage(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback
    if (message.includes('HTTPS data bridge')) return message
    const hint = marketDataUrl
      ? `Start the local server with: ${freeServerCommand}`
      : 'Set VITE_MARKET_DATA_BASE_URL to a reachable HTTPS data bridge, or use local/LAN mode.'
    return `${message}. ${hint}`
  }

  async function refreshFreeData(options: { symbolsOverride?: string[]; includeHoldingsOverride?: boolean; source?: 'decision' | 'data' } = {}) {
    const requestedSymbols = uniqueSymbols(options.symbolsOverride ?? syncTargetSymbols)
    const includeHoldingsForRequest = options.includeHoldingsOverride ?? hasUploadedHoldingsFeed
    if (!requestedSymbols.length) {
      setFreeRefreshState('error')
      setSyncProgress(0)
      setSyncCoverage(null)
      setFreeRefreshMessage('Enter a ticker in Decision Setup or upload a holdings XLSX before syncing market data.')
      return
    }
    setFreeRefreshState('refreshing')
    setFreeRefreshMessage(
      options.source === 'decision'
        ? `Loading ${requestedSymbols[0]} and rebuilding the verdict evidence...`
        : 'Syncing EOD prices, candles, fundamentals, company updates, and portfolio matches...',
    )
    setSyncProgress(8)
    setSyncCoverage(null)
    try {
      const bridgeUrl = requireMarketDataBridge('Market-data sync')
      const response = await fetch(apiUrl(bridgeUrl, '/api/free-data/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: requestedSymbols,
          days,
          includeHoldings: includeHoldingsForRequest,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Market-data sync failed.')
      }
      const refreshedSnapshot = data as Snapshot
      const mergedRefresh = mergeRefreshedSnapshot(refreshedSnapshot, activeSnapshotForAnalysis)
      setSnapshot(mergedRefresh.snapshot)
      setCacheState(cacheStateFromProvider(mergedRefresh.snapshot.provider))
      setSyncCoverage(buildSyncCoverage(mergedRefresh.snapshot))
      setSyncProgress(100)
      setFreeRefreshState('done')
      const fundamentalsMessage = !hasFundamentalScope(mergedRefresh.snapshot)
        ? 'Company fundamentals are not applicable for index symbols.'
        : mergedRefresh.refreshedCount
          ? `Fundamentals loaded for ${mergedRefresh.refreshedCount} symbols.`
          : mergedRefresh.retainedExisting
            ? `Refresh returned no fundamentals, so existing fundamentals for ${mergedRefresh.retainedCount} symbols were kept. Restart the local data server once to activate the Screener-backed fundamentals fetcher.`
            : `No fundamentals returned yet. Restart the local data server once, then refresh again to activate the Screener-backed fundamentals fetcher.`
      const holdingsMessage = mergedRefresh.snapshot.holdings.length
        ? mergedRefresh.retainedHoldings
          ? `Imported portfolio kept with ${mergedRefresh.snapshot.holdings.length} holdings; ${quotedHoldingsCount(mergedRefresh.snapshot)} have refreshed prices.`
          : `Portfolio shows ${mergedRefresh.snapshot.holdings.length} holdings; ${quotedHoldingsCount(mergedRefresh.snapshot)} have refreshed prices.`
        : 'No uploaded holdings are loaded.'
      const followUpMessage = mergedRefresh.snapshot.errors.length
        ? ' Some symbols still need mapping or provider follow-up; check Coverage and Missing Data.'
        : ''
      setFreeRefreshMessage(
        `Updated ${Object.keys(mergedRefresh.snapshot.quotes).length} priced symbols. ${holdingsMessage} ${fundamentalsMessage}${followUpMessage}`,
      )
    } catch (error) {
      setFreeRefreshState('error')
      setSyncProgress(0)
      setSyncCoverage(null)
      setFreeRefreshMessage(bridgeFailureMessage(error, 'Market-data sync failed.'))
    }
  }

  async function loadDecisionData() {
    if (!decisionSymbol) {
      setFreeRefreshState('error')
      setSyncProgress(0)
      setSyncCoverage(null)
      setFreeRefreshMessage('Enter a ticker before loading analysis data.')
      return
    }
    await refreshFreeData({ symbolsOverride: [decisionSymbol], includeHoldingsOverride: false, source: 'decision' })
    setView('verdict')
  }

  function updateMappingDraft(symbol: string, field: keyof SymbolMappingDraft, value: string) {
    setMappingDrafts((current) => ({
      ...current,
      [symbol]: {
        ...(current[symbol] ?? mappingDraftForSymbol(activeSnapshotForAnalysis, symbol)),
        [field]: value,
      },
    }))
  }

  async function saveSymbolMapping(symbol: string) {
    setMappingState('saving')
    setMappingStatus(`Saving mapping for ${symbol}...`)
    try {
      const bridgeUrl = requireMarketDataBridge('Symbol mapping')
      const draft = mappingDrafts[symbol] ?? mappingDraftForSymbol(activeSnapshotForAnalysis, symbol)
      const response = await fetch(apiUrl(bridgeUrl, '/api/symbol-map/upsert'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: symbol,
          name: draft.name.trim(),
          screener: draft.screener.trim(),
          yahoo: draft.yahoo.trim(),
        }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Could not save symbol mapping.')
      }
      setMappingState('done')
      setMappingStatus(`Saved mapping for ${symbol}. Click Retry Missing Only to fetch it with the corrected codes.`)
    } catch (error) {
      setMappingState('error')
      setMappingStatus(bridgeFailureMessage(error, 'Could not save symbol mapping.'))
    }
  }

  async function retryMissingData() {
    const retrySymbols = missingDataIssues
      .filter((issue) => issue.action !== 'unsupported')
      .map((issue) => issue.symbol)
    if (!retrySymbols.length) return
    setFreeRefreshState('refreshing')
    setFreeRefreshMessage(`Retrying ${retrySymbols.length} missing symbols only...`)
    setSyncProgress(12)
    try {
      const bridgeUrl = requireMarketDataBridge('Missing-data retry')
      const response = await fetch(apiUrl(bridgeUrl, '/api/free-data/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: retrySymbols,
          days,
          includeHoldings: false,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Missing-data retry failed.')
      }
      const refreshedSnapshot = data as Snapshot
      const mergedRefresh = mergeRefreshedSnapshot(refreshedSnapshot, activeSnapshotForAnalysis, { retainMarketData: true })
      const coverage = buildSyncCoverage(mergedRefresh.snapshot)
      setSnapshot(mergedRefresh.snapshot)
      setCacheState(cacheStateFromProvider(mergedRefresh.snapshot.provider))
      setSyncCoverage(coverage)
      setSyncProgress(100)
      setFreeRefreshState('done')
      const followUpMessage = mergedRefresh.snapshot.errors.length
        ? ' Some symbols still need mapping or provider follow-up; check Coverage and Missing Data.'
        : ''
      setFreeRefreshMessage(
        `Retried ${retrySymbols.length} missing symbols. Technical loaded for ${coverage.technicalLoaded.length}; fundamentals loaded for ${coverage.fundamentalsLoaded.length}.${followUpMessage}`,
      )
    } catch (error) {
      setFreeRefreshState('error')
      setSyncProgress(0)
      setFreeRefreshMessage(bridgeFailureMessage(error, 'Missing-data retry failed.'))
    }
  }

  function markSymbolUnsupported(symbol: string) {
    const normalized = symbol.trim().toUpperCase()
    setSyncCoverage((current) =>
      current
        ? {
            fundamentalsLoaded: current.fundamentalsLoaded.filter((candidate) => candidate !== normalized),
            fundamentalsMissing: current.fundamentalsMissing.filter((candidate) => candidate !== normalized),
            technicalLoaded: current.technicalLoaded.filter((candidate) => candidate !== normalized),
            technicalMissing: current.technicalMissing.filter((candidate) => candidate !== normalized),
          }
        : current,
    )
    setMappingState('done')
    setMappingStatus(`${symbol} hidden from the current missing-data list. It can stay in holdings, but it needs a valid NSE/BSE mapping before listed analysis.`)
  }

  async function uploadHoldingsReport(file: File | undefined) {
    if (!file) return
    setUploadState('uploading')
    setUploadMessage(`Uploading ${file.name}...`)
    setFreeRefreshState('refreshing')
    setFreeRefreshMessage(`Uploading ${file.name} and loading portfolio market data...`)
    setSyncProgress(8)
    setSyncCoverage(null)
    try {
      const bridgeUrl = requireMarketDataBridge('Holdings upload')
      const response = await fetch(apiUrl(bridgeUrl, `/api/portfolio/upload?days=${days}`), {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'X-Days': String(days),
          'X-Filename': file.name,
        },
        body: file,
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Holdings upload failed.')
      }
      const refreshedSnapshot = data as Snapshot
      const mergedRefresh = mergeRefreshedSnapshot(refreshedSnapshot, activeSnapshotForAnalysis)
      setSnapshot(mergedRefresh.snapshot)
      setCacheState(cacheStateFromProvider(mergedRefresh.snapshot.provider))
      setSyncCoverage(buildSyncCoverage(mergedRefresh.snapshot))
      setUploadState('done')
      setFreeRefreshState('done')
      setSyncProgress(100)
      const fundamentalsMessage = !hasFundamentalScope(mergedRefresh.snapshot)
        ? 'Company fundamentals are not applicable for index symbols.'
        : mergedRefresh.refreshedCount
          ? `Fundamentals loaded for ${mergedRefresh.refreshedCount} symbols.`
          : mergedRefresh.retainedExisting
            ? `Existing fundamentals for ${mergedRefresh.retainedCount} symbols were kept because the upload refresh returned quotes only.`
            : `No fundamentals returned yet; restart the local data server once and refresh again.`
      const holdingsWithoutBoughtOn = mergedRefresh.snapshot.holdings.filter((holding) => !dateInputValue(holding.bought_on)).length
      const boughtOnMessage = holdingsWithoutBoughtOn
        ? ` Bought-on dates were not found for ${holdingsWithoutBoughtOn} holding${holdingsWithoutBoughtOn === 1 ? '' : 's'}; you will be prompted to add one when reviewing those positions.`
        : ''
      setUploadMessage(
        `Imported ${refreshedSnapshot.upload?.holdings_count ?? mergedRefresh.snapshot.holdings.length} holdings from ${file.name}. ${quotedHoldingsCount(mergedRefresh.snapshot)} holdings have refreshed prices. ${fundamentalsMessage}${boughtOnMessage}`,
      )
      setFreeRefreshMessage(
        `Imported ${refreshedSnapshot.upload?.holdings_count ?? mergedRefresh.snapshot.holdings.length} holdings and loaded ${Object.keys(mergedRefresh.snapshot.quotes).length} priced symbols. ${fundamentalsMessage}`,
      )
    } catch (error) {
      setUploadState('error')
      setFreeRefreshState('error')
      setSyncProgress(0)
      setUploadMessage(bridgeFailureMessage(error, 'Holdings upload failed.'))
      setFreeRefreshMessage(bridgeFailureMessage(error, 'Holdings upload failed.'))
    }
  }

  async function removeUploadedHoldingsFeed() {
    if (!hasUploadedHoldingsFeed) return
    const removedKeys = new Set(activeHoldings.map(holdingKey).filter(Boolean))
    const nextSnapshot: Snapshot = {
      ...activeSnapshotForAnalysis,
      holdings: [],
      upload: undefined,
    }
    setSnapshot(nextSnapshot)
    setSyncCoverage(null)
    setUploadState('idle')
    setHoldingContextMessage('')
    setUploadMessage('Removed the uploaded holdings feed from this browser. You can upload another XLSX now.')
    setForm((current) => {
      const currentKey = `${current.exchange}:${current.ticker.trim().toUpperCase()}`
      if (!removedKeys.has(currentKey)) return current
      return {
        ...current,
        alreadyHold: false,
        boughtOn: '',
        quantity: '',
        averagePrice: '',
      }
    })

    try {
      const bridgeUrl = marketDataBaseUrl()
      if (!bridgeUrl) return
      const response = await fetch(apiUrl(bridgeUrl, '/api/portfolio/clear'), { method: 'POST' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(typeof data.error === 'string' ? data.error : 'Bridge clear failed.')
      }
    } catch (error) {
      setUploadState('error')
      setUploadMessage(
        error instanceof Error
          ? `Removed from this browser, but the data bridge did not clear its saved upload: ${error.message}`
          : 'Removed from this browser, but the data bridge did not clear its saved upload.',
      )
    }
  }

  function analyzeHolding(holding: Holding) {
    const holdingExchange = holding.exchange?.toUpperCase()
    if (holdingExchange !== 'NSE' && holdingExchange !== 'BSE') return
    const exchange = holdingExchange === 'BSE' ? 'BSE' : 'NSE'
    const importedBoughtOn = dateInputValue(holding.bought_on)
    setHoldingContextMessage(
      importedBoughtOn
        ? ''
        : 'Bought on was not found in the uploaded holdings sheet. Add it if you know it, because holding period helps judge thesis patience, tax/exit context, and whether this should be a hold, reduce, exit, or add-more review.',
    )
    setForm((current) => ({
      ...current,
      ticker: holding.tradingsymbol ?? current.ticker,
      exchange,
      alreadyHold: true,
      boughtOn: importedBoughtOn,
      capital: '',
      quantity: String(holding.quantity ?? ''),
      averagePrice: String(holding.average_price ?? ''),
    }))
    setView('verdict')
  }

  function toggleIndicator(indicator: IndicatorKey) {
    setChartIndicators((current) => ({ ...current, [indicator]: !current[indicator] }))
  }

  function updateForecastSetting<K extends keyof ForecastSettings>(key: K, value: ForecastSettings[K]) {
    setForecastSettings((current) => ({ ...current, [key]: value }))
  }

  const activeWorkspaceTab = [...primaryWorkspaceTabs, ...utilityWorkspaceTabs].find((tab) => tab.id === view)
  const activeWorkspaceLabel = activeWorkspaceTab?.label ?? 'Start'

  return (
    <main className="app-shell">
      <header className="topbar app-hero-panel">
        <button
          aria-controls="workspace-drawer"
          aria-expanded={workspaceDrawerOpen}
          aria-label={workspaceDrawerOpen ? 'Close workspace drawer' : 'Open workspace drawer'}
          className={`workspace-drawer-toggle ${workspaceDrawerOpen ? 'open' : ''}`}
          type="button"
          onClick={() => setWorkspaceDrawerOpen((current) => !current)}
        >
          <span />
          <span />
          <span />
        </button>

        <div className="app-title-block">
          <h1>Fund Analyser</h1>
          <span className="active-view-chip" aria-label={`Current tab: ${activeWorkspaceLabel}`}>
            {activeWorkspaceLabel}
          </span>
        </div>

        <nav className="workspace-nav" aria-label="Analysis workspace">
          <div className="active-instrument-strip">
            <div className={`instrument-identity tone-${activePriceTone} ${mobileContextExpanded ? 'expanded' : ''}`}>
              <button
                aria-expanded={mobileContextExpanded}
                className="instrument-mobile-toggle"
                type="button"
                onClick={() => setMobileContextExpanded((current) => !current)}
              >
                <span>{activeTickerDisplay}</span>
                <strong>{formatInr(analysis.ltp)}</strong>
                <small>{activeChangePct === undefined ? 'Change pending' : formatPercent(activeChangePct)}</small>
              </button>
              <div className="instrument-copy">
                <span>Analysing now</span>
                <strong>{activeTickerDisplay}</strong>
                <p>{activeInstrumentName}</p>
                {activeInstrumentSector && <small>{activeInstrumentSector}</small>}
              </div>
              <div className="instrument-ltp-inline">
                <span>LTP</span>
                <strong>{formatInr(analysis.ltp)}</strong>
                <small>{activeChangePct === undefined ? 'Change pending' : formatPercent(activeChangePct)}</small>
              </div>
              <div className="instrument-quick-actions">
                <button
                  type="button"
                  onClick={() => void loadDecisionData()}
                  disabled={freeRefreshState === 'refreshing' || !decisionSymbol}
                >
                  {freeRefreshState === 'refreshing' ? 'Loading...' : 'Analyse'}
                </button>
                {/* Future shortcut: re-enable an Ask Coach action here if a header coaching entry point becomes useful again. */}
              </div>
            </div>
          </div>
        </nav>
      </header>

      <button
        aria-hidden={!workspaceDrawerOpen}
        className={`workspace-drawer-backdrop ${workspaceDrawerOpen ? 'open' : ''}`}
        tabIndex={workspaceDrawerOpen ? 0 : -1}
        type="button"
        onClick={() => setWorkspaceDrawerOpen(false)}
      />

      <aside
        aria-label="Workspace navigation and utilities"
        className={`workspace-drawer ${workspaceDrawerOpen ? 'open' : ''}`}
        id="workspace-drawer"
      >
        <div className="workspace-drawer-head">
          <span>Workspace</span>
          <button type="button" onClick={() => setWorkspaceDrawerOpen(false)}>
            Close
          </button>
        </div>
        <div className="workspace-drawer-section" aria-label="Analysis sections">
          {primaryWorkspaceTabs.map((tab) => (
            <button
              aria-current={view === tab.id ? 'page' : undefined}
              aria-label={`${tab.label}: ${tab.caption}`}
              className={`drawer-nav-item ${view === tab.id ? 'active' : ''}`}
              key={tab.id}
              title={`${tab.label}: ${tab.caption}`}
              type="button"
              onClick={() => {
                setView(tab.id)
                setWorkspaceDrawerOpen(false)
              }}
            >
              <span>
                <strong>{tab.label}</strong>
                <small>{tab.caption}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="workspace-drawer-section utility-drawer-section" aria-label="Reference tools">
          {utilityWorkspaceTabs.map((tab) => (
            <button
              aria-label={tab.id === 'reasoning' ? 'Reasoning: Decision trace' : 'Glossary: Term guide'}
              className={`drawer-nav-item ${view === tab.id ? 'active' : ''}`}
              key={tab.id}
              title={tab.id === 'reasoning' ? 'Reasoning: Decision trace' : 'Glossary: Term guide'}
              type="button"
              onClick={() => {
                setView(tab.id)
                setWorkspaceDrawerOpen(false)
              }}
            >
              <span>
                <strong>{tab.label}</strong>
                <small>{tab.id === 'reasoning' ? 'Decision trace' : 'Term guide'}</small>
              </span>
            </button>
          ))}
          <button
            className="drawer-nav-item"
            type="button"
            aria-pressed={theme === 'dark'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            <span>
              <strong>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</strong>
              <small>Theme</small>
            </span>
          </button>
        </div>
      </aside>

      <div
        aria-live="polite"
        className="sr-only view-announcement"
        ref={viewAnnouncementRef}
        tabIndex={-1}
      >
        {activeWorkspaceLabel} section loaded.
      </div>

      {view === 'setup' ? (
        <>
          <CollapsibleSection
            action={
              <div className="research-brief-actions">
                <button className="secondary-action" type="button" onClick={() => copyCommand('brief', analysisBrief)}>
                  {copied === 'brief' ? 'Copied' : 'Copy brief'}
                </button>
              </div>
            }
            className="parent-section setup-parent"
            defaultOpen
            description="Set the instrument, time horizon, and money context. The rest of the workspace updates from this brief."
            headingClassName="section-heading collapsible-section-heading"
            id="setup-parent-heading"
            staticOpen
            title="Research Brief"
          >
            <section className="input-grid">
            <CollapsibleSection
              className="panel form-panel"
              defaultOpen
              id="required-heading"
              title="Instrument"
            >
              <div className="form-grid setup-primary-grid">
                <label className="field">
                  <FieldLabel help={requiredHelp.ticker}>Ticker</FieldLabel>
                  <input
                    aria-label="Ticker"
                    required
                    value={form.ticker}
                    onChange={(event) => {
                      const ticker = event.target.value.toUpperCase()
                      setForm((current) => ({
                        ...current,
                        ticker,
                        // Seed a practical default so a fresh idea can be sized immediately; user edits still win.
                        capital: ticker.trim() && !current.ticker.trim() && !current.capital.trim() ? '10000' : current.capital,
                      }))
                    }}
                  />
                </label>
                <label className="field">
                  <FieldLabel help={requiredHelp.exchange}>Exchange</FieldLabel>
                  <select aria-label="Exchange" value={form.exchange} onChange={(event) => updateForm('exchange', event.target.value as Exchange)}>
                    <option value="NSE">NSE</option>
                    <option value="BSE">BSE</option>
                  </select>
                </label>
                <label className="field">
                  <FieldLabel help={requiredHelp.horizon}>Horizon</FieldLabel>
                  <select aria-label="Horizon" value={form.horizon} onChange={(event) => updateForm('horizon', event.target.value as Horizon)}>
                    {Object.entries(horizonLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <FieldLabel help={capitalHelpText}>{isHoldingReview ? 'Add-more capital' : 'Capital to deploy'}</FieldLabel>
                  <input aria-label={isHoldingReview ? 'Add-more capital' : 'Capital to deploy'} inputMode="decimal" value={form.capital} onChange={(event) => updateForm('capital', event.target.value)} />
                </label>
                <label className="field">
                  <FieldLabel help={requiredHelp.alreadyHold}>Action</FieldLabel>
                  <select
                    aria-label="Action"
                    value={form.alreadyHold ? 'sell' : 'buy'}
                    onChange={(event) => updateForm('alreadyHold', event.target.value === 'sell')}
                  >
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </label>
              </div>

              {isHoldingReview && (
                <div className="form-grid four holding-details-grid">
                  <label className="field">
                    <FieldLabel help={boughtOnHelpText}>Bought on</FieldLabel>
                    <input type="date" value={form.boughtOn} onChange={(event) => updateForm('boughtOn', event.target.value)} />
                  </label>
                  <label className="field">
                    <FieldLabel help={requiredHelp.quantity}>Quantity</FieldLabel>
                    <input inputMode="decimal" value={form.quantity} onChange={(event) => updateForm('quantity', event.target.value)} />
                  </label>
                  <label className="field">
                    <FieldLabel help={requiredHelp.averagePrice}>Average price</FieldLabel>
                    <input inputMode="decimal" value={form.averagePrice} onChange={(event) => updateForm('averagePrice', event.target.value)} />
                  </label>
                </div>
              )}

              <CollapsibleSection
                className="sub-panel nested-collapse advanced-setup-panel"
                description="Risk, market access, and history-window controls."
                headingClassName="subsection-heading"
                headingLevel={3}
                id="advanced-setup-heading"
                title="Preferences"
              >
              <div className="setup-control-row">
              <div className="segmented-block compact-choice">
                <span className="segmented-label">
                  Risk profile
                  <HelpTip text={requiredHelp.riskProfile} />
                </span>
                <div className="segmented">
                  {(Object.keys(riskProfileLabels) as RiskProfile[]).map((profile) => (
                    <button
                      className={form.riskProfile === profile ? 'active' : ''}
                      key={profile}
                      type="button"
                      onClick={() => updateForm('riskProfile', profile)}
                    >
                      {riskProfileLabels[profile]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="segmented-block compact-choice">
                <span className="segmented-label">
                  Market access
                  <HelpTip text={requiredHelp.marketAccess} />
                </span>
                <div className="segmented">
                  {(Object.keys(tradeAccessLabels) as TradeAccess[]).map((access) => (
                    <button
                      className={form.tradeAccess === access ? 'active' : ''}
                      key={access}
                      type="button"
                      onClick={() => updateForm('tradeAccess', access)}
                    >
                      {tradeAccessLabels[access]}
                    </button>
                  ))}
                </div>
              </div>
              </div>

              <div className="form-grid">
                <label className="field">
                  <FieldLabel help="How many daily candles to request when you click Load & Analyse or Sync Market Data. Longer windows improve long-term trend and support/resistance context, but take longer to refresh.">History window</FieldLabel>
                  <input
                    min="30"
                    max="3000"
                    step="30"
                    type="number"
                    aria-label="History window"
                    value={days}
                    onChange={(event) => setDays(Number(event.target.value))}
                  />
                </label>
              </div>

              {addMoreRiskControlsActive ? (
                <div className="form-grid risk-grid-row">
                  <label className="field risk-slider-field">
                    <span className="range-field-heading">
                      <FieldLabel help={requiredHelp.maxRisk}>{isHoldingReview ? 'Add-more max risk' : 'Max risk'}</FieldLabel>
                      <output>{riskSliderDisplay}</output>
                    </span>
                    <input
                      aria-label={isHoldingReview ? 'Add-more max risk' : 'Max risk'}
                      max={riskSliderMax}
                      min={form.riskMode === 'percent' ? 0.25 : 500}
                      step={riskSliderStep}
                      type="range"
                      value={riskSliderValue}
                      onInput={(event) => updateForm('maxRisk', event.currentTarget.value)}
                      onChange={(event) => updateForm('maxRisk', event.target.value)}
                    />
                    <span className="range-scale">
                      <small>{form.riskMode === 'percent' ? '0.25%' : formatInr(500)}</small>
                      <small>{form.riskMode === 'percent' ? '10%' : formatInr(riskSliderMax)}</small>
                    </span>
                  </label>
                  <label className="field">
                    <FieldLabel help={requiredHelp.riskUnit}>Risk unit</FieldLabel>
                    <select value={form.riskMode} onChange={(event) => updateForm('riskMode', event.target.value as RiskMode)}>
                      <option value="percent">% of capital</option>
                      <option value="amount">Rupee amount</option>
                    </select>
                    {isHoldingReview && <span className="field-note">Percentage mode uses add-more capital, not your existing invested amount.</span>}
                  </label>
                </div>
              ) : (
                <div className="risk-idle-panel">
                  <strong>Add-more sizing is inactive</strong>
                  <p>
                    This is a holding review. Add-more sizing stays off until you enter fresh capital, so the app will focus on exit discipline,
                    position risk, chart strength, and whether the stock deserves more money.
                  </p>
                </div>
              )}
              </CollapsibleSection>
              {freeRefreshMessage && view === 'setup' && (
                <div className={`refresh-message ${freeRefreshState}`}>
                  <p>{freeRefreshMessage}</p>
                </div>
              )}
              {freeRefreshState === 'refreshing' && view === 'setup' && (
                <div className="sync-progress-panel compact-sync-progress" role="status" aria-live="polite">
                  <div className="sync-progress-top">
                    <span>Loading analysis evidence</span>
                    <strong>{syncProgress}%</strong>
                  </div>
                  <div className="sync-progress-track" aria-hidden="true">
                    <span style={{ width: `${syncProgress}%` }} />
                  </div>
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection className="panel evidence-panel" description="Overrides for missing data, stale data, or a specific exit/target plan." eyebrow="Optional" id="optional-heading" title="Guardrails">
              <div className="form-grid three risk-anchor-grid">
                <label className="field">
                  <FieldLabel help={optionalHelp.manualLtp}>Manual LTP</FieldLabel>
                  <input inputMode="decimal" value={form.manualLtp} onChange={(event) => updateForm('manualLtp', event.target.value)} />
                </label>
                <label className="field">
                  <FieldLabel help={optionalHelp.invalidationPrice}>Invalidation price</FieldLabel>
                  <input inputMode="decimal" value={form.invalidationPrice} onChange={(event) => updateForm('invalidationPrice', event.target.value)} />
                </label>
                <label className="field">
                  <FieldLabel help={optionalHelp.targetPrice}>Target price</FieldLabel>
                  <input inputMode="decimal" value={form.targetPrice} onChange={(event) => updateForm('targetPrice', event.target.value)} />
                </label>
              </div>

              <CollapsibleSection className="manual-overrides-panel nested-collapse" headingClassName="subsection-heading" headingLevel={3} id="manual-company-overrides-heading" title="Company overrides">
                <div className="form-grid three">
                  <label className="field">
                    <FieldLabel help={optionalHelp.marketCapCr}>Override market cap, cr</FieldLabel>
                    <input inputMode="decimal" value={form.marketCapCr} onChange={(event) => updateForm('marketCapCr', event.target.value)} />
                  </label>
                  <label className="field">
                    <FieldLabel help={optionalHelp.debtEquity}>Override debt/equity</FieldLabel>
                    <input inputMode="decimal" value={form.debtEquity} onChange={(event) => updateForm('debtEquity', event.target.value)} />
                  </label>
                  <label className="field">
                    <FieldLabel help={optionalHelp.roce}>Override ROCE %</FieldLabel>
                    <input inputMode="decimal" value={form.roce} onChange={(event) => updateForm('roce', event.target.value)} />
                  </label>
                  <label className="field">
                    <FieldLabel help={optionalHelp.pe}>Override P/E</FieldLabel>
                    <input inputMode="decimal" value={form.pe} onChange={(event) => updateForm('pe', event.target.value)} />
                  </label>
                  <label className="field">
                    <FieldLabel help={optionalHelp.profitTrend}>Override profit trend</FieldLabel>
                    <select value={form.profitTrend} onChange={(event) => updateForm('profitTrend', event.target.value as ProfitTrend)}>
                      {Object.entries(profitTrendLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </CollapsibleSection>

              <div className="segmented-label filters-label">
                Personal filters
                <HelpTip text={optionalHelp.constraints} />
              </div>
              <div className="checkbox-grid">
                {constraintLabels.map((constraint) => (
                  <label className="toggle-field" key={constraint.key}>
                    <input
                      checked={form.constraints[constraint.key]}
                      type="checkbox"
                      onChange={(event) => updateConstraint(constraint.key, event.target.checked)}
                    />
                    <span className="toggle-copy">
                      {constraint.label}
                      <HelpTip text={constraint.help} />
                    </span>
                  </label>
                ))}
              </div>

              <label className="field thesis-field">
                <FieldLabel help={optionalHelp.thesis}>Thesis or report notes</FieldLabel>
                <textarea value={form.thesis} onChange={(event) => updateForm('thesis', event.target.value)} />
              </label>
            </CollapsibleSection>
            </section>
          </CollapsibleSection>
        </>
      ) : null}

      {view === 'verdict' ? (
        <>
          <CollapsibleSection
            action={
              <div className={`score-box tone-${toneFromScore(analysis.score)}`} style={percentStyle(analysis.score, '--score')}>
                <strong>{analysis.score}</strong>
                <span>/100</span>
              </div>
            }
            className={`verdict-panel expanded-verdict ${analysis.verdictClass}`}
            defaultOpen
            eyebrow="Verdict"
            headingClassName="verdict-heading"
            id="verdict-heading"
            staticOpen
            title={analysis.verdict}
            titleAddon={<HelpTip text={verdictLogicHelp} />}
          >

            <p className="verdict-summary">
              {isHoldingReview ? (
                <>
                  The app reads this existing position as <strong>{analysis.verdict}</strong> with {analysis.confidenceLabel.toLowerCase()} confidence
                  in the data behind it. It is using {formatInr(analysis.ltp)} as the analysis price, {formatPercent(analysis.positionPnlPct)} position
                  P&L, and {hasPortfolioContext ? `${formatPercent(analysis.portfolioWeight)} portfolio weight` : 'no portfolio weight, since no holdings file is loaded'}.
                </>
              ) : (
                <>
                  This is a fresh buy decision. The app reads it as <strong>{analysis.verdict}</strong> with {analysis.confidenceLabel.toLowerCase()}{' '}
                  data confidence. It is using {formatInr(analysis.ltp)} as the analysis price, {formatInr(capitalNum)} deployable capital, and{' '}
                  {formatInr(analysis.riskCapital)} risk budget.
                </>
              )}
            </p>
            {specialInstrumentWarning ? (
              <p className="verdict-summary verdict-inline-warning">
                <strong>Special instrument check:</strong> {specialInstrumentWarning}
              </p>
            ) : null}
            {boughtOnPrompt ? (
              <div className="verdict-summary verdict-inline-warning prompt-warning">
                <p>
                  <strong>Holding period:</strong> Bought date missing; add for exit context.
                </p>
                <button className="secondary-action" type="button" onClick={() => setView('setup')}>
                  Add date
                </button>
              </div>
            ) : null}

            <div className="metric-grid compact-metrics">
              <div className="metric tone-neutral">
                <span>Ticker</span>
                <strong>{analysis.quoteKey}</strong>
              </div>
              <div className="metric tone-neutral">
                <span>LTP</span>
                <strong>{formatInr(analysis.ltp)}</strong>
              </div>
              {isHoldingReview ? (
                <>
                  <div className="metric tone-neutral">
                    <span>Quantity</span>
                    <strong>{formatNumber(quantityNum)}</strong>
                  </div>
                  <div className={`metric ${pnlTone}`}>
                    <span>P&L</span>
                    <strong className={(analysis.positionPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{formatInr(analysis.positionPnl)}</strong>
                  </div>
                  <div className={`metric ${pnlPercentTone}`}>
                    <span>P&L %</span>
                    <strong className={(analysis.positionPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{formatPercent(analysis.positionPnlPct)}</strong>
                  </div>
                  <div className="metric tone-neutral">
                    <span>Weight</span>
                    <strong>{formatPercent(analysis.portfolioWeight)}</strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="metric tone-neutral">
                    <span>Capital</span>
                    <strong>{formatInr(capitalNum)}</strong>
                  </div>
                  <div className={analysis.suggestedShares ? 'metric tone-positive' : 'metric tone-neutral'}>
                    <span>Quantity plan</span>
                    <strong>{analysis.suggestedQuantityLabel}</strong>
                  </div>
                  <div className={analysis.riskCapital ? 'metric tone-neutral' : 'metric tone-negative'}>
                    <span>Risk budget</span>
                    <strong>{formatInr(analysis.riskCapital)}</strong>
                  </div>
                  <div className={invalidationPriceNum ? 'metric tone-neutral' : 'metric tone-negative'}>
                    <span>
                      Exit line
                      <HelpTip text="The price where the original idea is considered wrong. If the stock falls to or through this level, the plan is to sell rather than hope for a recovery." />
                    </span>
                    <strong>{formatInr(invalidationPriceNum)}</strong>
                  </div>
                  <div className={rewardRisk === undefined ? 'metric tone-neutral' : rewardRisk >= 2 ? 'metric tone-positive' : 'metric tone-negative'}>
                    <span>
                      Reward/risk
                      <HelpTip text="How much upside you're aiming for compared with how much you're risking. 2x means the potential gain is twice the potential loss if the exit line is hit." />
                    </span>
                    <strong>{rewardRisk === undefined ? '-' : `${rewardRisk.toFixed(1)}x`}</strong>
                  </div>
                </>
              )}
              <div className={`metric tone-${confidenceTone}`}>
                <span>
                  Data confidence
                  <HelpTip text="How complete the evidence behind this verdict is — not a prediction of the stock's performance. Low confidence means key data is missing or stale, not that the trade is bad." />
                </span>
                <strong>{analysis.confidenceLabel}</strong>
              </div>
            </div>

            {!isHoldingReview && (
              <div className="fresh-plan-grid">
                <article className="fresh-plan-card tone-positive">
                  <span>Buy Plan</span>
                  <p>{analysis.entryPlan}</p>
                </article>
                <article className="fresh-plan-card tone-negative">
                  <span>Exit Discipline</span>
                  <p>{analysis.exitPlan}</p>
                </article>
              </div>
            )}

            <CollapsibleSection
              className="adaptive-score-panel sub-panel nested-collapse"
              description="A compact read of what can push price higher, what can cap upside, and what needs confirmation before you act."
              headingClassName="subsection-heading"
              headingLevel={3}
              id="adaptive-score-heading"
              title="Price Drivers Behind This Answer"
            >
              <FlashcardDeck
                ariaLabel="Price driver scores"
                cards={analysis.scoreComponents.map((component) => ({
                  id: component.label,
                  content: (
                    <article className={`component-score-card tone-${component.tone}`}>
                      <div>
                        <span>{component.label}</span>
                        <strong className="score-with-help">
                          {component.score}
                          <span className="read-scale">/100</span>
                          <HelpTip text={componentDefinition(component)} />
                        </strong>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill score-fill" style={percentStyle(component.score)} />
                      </div>
                      <p>{componentNarrative(component)}</p>
                    </article>
                  ),
                }))}
              />

              <div className="signal-contribution-panel flat-signal-panel">
                <div className="flat-section-heading">
                  <span className="mini-label">Metric clues</span>
                  <strong>{analysis.adaptiveSignals.length} signals</strong>
                </div>
                <FlashcardDeck
                  ariaLabel="Metric clue signals"
                  cards={adaptiveSignalGroups.flatMap((group) =>
                    group.signals.map((signal) => ({
                      id: `${signal.group}-${signal.label}`,
                      category: group.title,
                      content: (
                        <article className={`adaptive-signal-card tone-${signal.tone}`}>
                          <span>{signal.group}</span>
                          <strong>{signal.label}</strong>
                          <small>{signal.value}</small>
                          <div className="signal-score-line">
                            <span className="score-with-help">
                              <b>{signal.score}</b>
                              <span className="read-scale">/100</span>
                              <HelpTip text={signalDefinition(signal)} />
                            </span>
                          </div>
                          <p>{signalNarrative(signal)}</p>
                        </article>
                      ),
                    })),
                  )}
                />
              </div>
            </CollapsibleSection>

            <div className="guidance-grid">
              <CollapsibleSection
                className="guidance-card do-card nested-collapse"
                defaultOpen
                headingClassName="subsection-heading"
                headingLevel={3}
                id="do-next-heading"
                title={isHoldingReview ? 'Next Actions' : 'Buy, Quantity, and Exit Plan'}
              >
                <ul>
                  {analysis.doItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                  {isHoldingReview && analysis.suggestedShares !== undefined && (
                    <li>
                      Suggested deployment: {formatNumber(analysis.suggestedShares)} shares, about {formatInr(analysis.suggestedDeployment)}.
                    </li>
                  )}
                </ul>
              </CollapsibleSection>
              <CollapsibleSection className="guidance-card dont-card nested-collapse" defaultOpen headingClassName="subsection-heading" headingLevel={3} id="dont-do-heading" title="Avoid These Moves">
                <ul>
                  {analysis.dontItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CollapsibleSection>
              <CollapsibleSection className="guidance-card why-card nested-collapse" defaultOpen headingClassName="subsection-heading" headingLevel={3} id="why-verdict-heading" title="Why This Answer">
                <ul>
                  {analysis.whyItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CollapsibleSection>
            </div>

            <CollapsibleSection
              className="sub-panel nested-collapse"
              description="A compact list of what to do next, what to avoid, and which price/risk checks matter now."
              headingClassName="subsection-heading"
              headingLevel={3}
              id="raw-signals-heading"
              title="Action and Caution Summary"
            >
              <div className="verdict-columns">
                <article className="sub-panel">
                  <h4>{isHoldingReview ? 'Holding action notes' : 'Entry and exit notes'}</h4>
                  <ul>
                    {analysis.actions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
                <article className="sub-panel">
                  <h4>Cautions</h4>
                  <ul>
                    {analysis.cautions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              </div>
            </CollapsibleSection>

            {analysis.missing.length > 0 && (
              <div className="alerts">
                <p>Missing: {analysis.missing.join(', ')}</p>
              </div>
            )}
          </CollapsibleSection>
        </>
      ) : null}

      {view === 'coach' ? (
        <>
          <CollapsibleSection
            action={
              <div className="ai-coach-header-controls">
                <div className="ai-coach-mode-segmented" role="radiogroup" aria-label="AI Coach focus">
                  {([
                    { scope: 'technical' as AiCoachScope, label: 'Chart', help: 'Explain trend, indicators, candles, volatility, liquidity, support/resistance, and what they can mean for the next move.' },
                    { scope: 'fundamental' as AiCoachScope, label: 'Company', help: 'Explain business model, ratios, statements, updates, data gaps, and whether the business can support higher prices.' },
                    { scope: 'verdict' as AiCoachScope, label: 'Verdict', help: 'Explain the final action, what to do next, what not to do, risk plan, and which evidence matters most now.' },
                  ]).map((option) => (
                    <button
                      aria-checked={llmScope === option.scope}
                      className={`ai-coach-mode-pill ${llmScope === option.scope ? 'active' : ''}`}
                      key={option.scope}
                      role="radio"
                      type="button"
                      onClick={() => setLlmScope(option.scope)}
                    >
                      <span>{option.label}</span>
                      <HelpTip text={option.help} />
                    </button>
                  ))}
                </div>
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => void generateAiCoachReview(llmScope)}
                  disabled={llmState === 'refreshing' || !decisionSymbol}
                >
                  {llmState === 'refreshing' ? 'Generating...' : llmResponse?.review ? 'Regenerate Review' : 'Generate AI Review'}
                </button>
              </div>
            }
            className="parent-section ai-coach-section"
            defaultOpen
            description="Choose a coaching focus: price action, business quality, or the final decision."
            eyebrow="AI Coach"
            headingClassName="section-heading collapsible-section-heading"
            id="ai-coach-heading"
            staticOpen
            title={activeAiCoachCopy.title}
          >
            {llmMessage && (
              <div className={`refresh-message ${llmState}`}>
                <p>{llmMessage}</p>
              </div>
            )}

            {llmState === 'refreshing' && (
              <div className="sync-progress-panel ai-progress-panel" role="status" aria-live="polite">
                <div className="sync-progress-top">
                  <span>Generating plain-English review</span>
                  <strong>Working...</strong>
                </div>
                <div className="sync-progress-track" aria-hidden="true">
                  <span />
                </div>
                <p>{activeAiCoachCopy.message}</p>
              </div>
            )}

            {llmResponse?.configured === false && (
              <div className="ai-setup-panel">
                <h3>Configure the AI Coach on your data bridge</h3>
                <p>{llmResponse.message}</p>
                <ol>
                  {(llmResponse.setup ?? []).map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="caption">
                  Keep <code>LLM_API_KEY</code> server-side. Do not put provider secrets in <code>VITE_</code> variables because those are bundled into
                  the public web app.
                </p>
              </div>
            )}

            {llmResponse?.review && (
              <div className="ai-review-grid">
                <article className="ai-review-main">
                  <span>AI Coach review</span>
                  <h3>{llmResponse.review.headline || `${analysis.quoteKey}: ${analysis.verdict}`}</h3>
                  <p>{llmResponse.review.plainEnglishVerdict || `The AI Coach did not return a plain-English ${activeAiCoachCopy.label.toLowerCase()} explanation.`}</p>
                  {llmResponse.review.confidenceNote && <p className="ai-confidence-note">{llmResponse.review.confidenceNote}</p>}
                  {llmResponse.generated_at && <small>Generated {new Date(llmResponse.generated_at).toLocaleString()}</small>}
                </article>
                <AiReviewListCard title="What to do next" tone="positive" items={llmResponse.review.whatToDoNext} emptyLabel="No next steps were returned." />
                <AiReviewListCard title="What not to do" tone="negative" items={llmResponse.review.whatNotToDo} emptyLabel="No avoid-list was returned." />
                <AiReviewListCard title="Key evidence" tone="neutral" items={llmResponse.review.keyEvidence} emptyLabel="No evidence summary was returned." />
                <AiReviewListCard
                  title="Practical price checks"
                  tone="positive"
                  items={llmResponse.review.practicalPrinciples}
                  emptyLabel="No practical price checks were returned."
                />
                <AiReviewListCard title="Risk plan" tone="neutral" items={llmResponse.review.riskPlan} emptyLabel="No risk plan was returned." />
                <AiReviewListCard title="Data gaps" tone="negative" items={llmResponse.review.dataGaps} emptyLabel="No data gaps were returned." />
                <AiReviewListCard
                  title="Questions before action"
                  tone="neutral"
                  items={llmResponse.review.questionsBeforeAction}
                  emptyLabel="No follow-up questions were returned."
                />
              </div>
            )}
          </CollapsibleSection>
        </>
      ) : null}

      {view === 'technicals' ? (
        <>
          <CollapsibleSection
            className="parent-section technical-section"
            description="Price action, indicators, volatility, liquidity, and scenario ranges."
            eyebrow="Technical analysis"
            headingClassName="section-heading collapsible-section-heading"
            id="technical-heading"
            staticOpen
            title="Technical Analysis"
          >
            <div className="visual-grid">
              <article className="visual-card chart-card">
                <div className="visual-card-heading chart-heading">
                  <div>
                    <span className="mini-label">{analysis.quoteKey}</span>
                    <h3>Interactive Candlestick Chart</h3>
                  </div>
                  <strong className={(chartTrendPct ?? 0) >= 0 ? 'positive' : 'negative'}>{formatPercent(chartTrendPct)}</strong>
                </div>

                <div className="chart-toolbar">
                  <div className="chart-toolbar-row">
                    <div className="segmented chart-timeframes" aria-label="Chart timeframe">
                      {(Object.keys(chartTimeframes) as ChartTimeframe[]).map((timeframe) => (
                        <button
                          className={chartTimeframe === timeframe ? 'active' : ''}
                          key={timeframe}
                          type="button"
                          onClick={() => setChartTimeframe(timeframe)}
                        >
                          {chartTimeframes[timeframe].label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="indicator-switches" aria-label="Chart indicators">
                    {allIndicatorKeys.map((indicator) => (
                      <button
                        className={chartIndicators[indicator] ? 'active' : ''}
                        key={indicator}
                        type="button"
                        aria-pressed={chartIndicators[indicator]}
                        onClick={() => toggleIndicator(indicator)}
                      >
                        {indicatorLabels[indicator].label}
                        <HelpTip text={indicatorLabels[indicator].help} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="forecast-controls">
                  <div className="forecast-control-head">
                    <label className="toggle-field">
                      <input
                        checked={forecastSettings.enabled}
                        type="checkbox"
                        onChange={(event) => updateForecastSetting('enabled', event.target.checked)}
                      />
                      <span className="toggle-copy">
                        Scenario Forecast
                        <HelpTip text="Shows bear/base/bull price ranges from adjustable assumptions. This is a scenario tool, not a guaranteed price prediction." />
                      </span>
                    </label>
                    <span className={`forecast-range-pill ${forecastProjection ? 'active' : 'inactive'}`}>
                      {forecastProjection ? forecastProjection.rangeLabel : 'Forecast off'}
                    </span>
                  </div>

                  {forecastSettings.enabled && (
                    <>
                    <div className="forecast-control-grid">
                      <label className="field">
                        <FieldLabel help={forecastHelp.horizon}>Horizon</FieldLabel>
                        <select
                          value={forecastSettings.horizon}
                          onChange={(event) => updateForecastSetting('horizon', event.target.value as ForecastHorizon)}
                        >
                          {(Object.keys(forecastHorizons) as ForecastHorizon[]).map((horizon) => (
                            <option key={horizon} value={horizon}>
                              {forecastHorizons[horizon].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <FieldLabel help={`${forecastHelp.mode} Current selection: ${forecastModeLabels[forecastSettings.mode].help}`}>Forecast type</FieldLabel>
                        <select
                          value={forecastSettings.mode}
                          onChange={(event) => updateForecastSetting('mode', event.target.value as ForecastMode)}
                        >
                          {(Object.keys(forecastModeLabels) as ForecastMode[]).map((mode) => (
                            <option key={mode} value={mode}>
                              {forecastModeLabels[mode].label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <CollapsibleSection
                      className="forecast-assumptions-inputs nested-collapse"
                      description="Sensible defaults are already applied. Adjust these only if you want to override the model's own volatility, growth, or event-risk assumptions."
                      headingClassName="subsection-heading"
                      headingLevel={4}
                      id="forecast-assumption-inputs-heading"
                      title="Advanced forecast assumptions (optional)"
                    >
                      <div className="forecast-control-grid">
                        <label className="field">
                          <FieldLabel help={forecastHelp.volatilityMultiplier}>Volatility multiplier</FieldLabel>
                          <input
                            inputMode="decimal"
                            value={forecastSettings.volatilityMultiplier}
                            onChange={(event) => updateForecastSetting('volatilityMultiplier', event.target.value)}
                          />
                        </label>
                        <label className="field">
                          <FieldLabel help={forecastHelp.trendWeight}>Trend influence %</FieldLabel>
                          <input
                            inputMode="decimal"
                            value={forecastSettings.trendWeight}
                            onChange={(event) => updateForecastSetting('trendWeight', event.target.value)}
                          />
                        </label>
                        <label className="field">
                          <FieldLabel help={forecastHelp.fundamentalGrowth}>Fundamental growth %</FieldLabel>
                          <input
                            inputMode="decimal"
                            placeholder="Auto"
                            value={forecastSettings.fundamentalGrowth}
                            onChange={(event) => updateForecastSetting('fundamentalGrowth', event.target.value)}
                          />
                        </label>
                        <label className="field">
                          <FieldLabel help={forecastHelp.valuationShift}>Valuation rerating %</FieldLabel>
                          <input
                            inputMode="decimal"
                            value={forecastSettings.valuationShift}
                            onChange={(event) => updateForecastSetting('valuationShift', event.target.value)}
                          />
                        </label>
                        <label className="field">
                          <FieldLabel help={forecastHelp.eventRisk}>Event risk</FieldLabel>
                          <select
                            value={forecastSettings.eventRisk}
                            onChange={(event) => updateForecastSetting('eventRisk', event.target.value as EventRisk)}
                          >
                            {(Object.keys(eventRiskLabels) as EventRisk[]).map((risk) => (
                              <option key={risk} value={risk}>
                                {eventRiskLabels[risk]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="custom-return-fields">
                          <label className="field">
                            <FieldLabel help={forecastHelp.customBearAnnualReturn}>Bear annual %</FieldLabel>
                            <input
                              inputMode="decimal"
                              value={forecastSettings.customBearAnnualReturn}
                              onChange={(event) => updateForecastSetting('customBearAnnualReturn', event.target.value)}
                            />
                          </label>
                          <label className="field">
                            <FieldLabel help={forecastHelp.customBaseAnnualReturn}>Base annual %</FieldLabel>
                            <input
                              inputMode="decimal"
                              value={forecastSettings.customBaseAnnualReturn}
                              onChange={(event) => updateForecastSetting('customBaseAnnualReturn', event.target.value)}
                            />
                          </label>
                          <label className="field">
                            <FieldLabel help={forecastHelp.customBullAnnualReturn}>Bull annual %</FieldLabel>
                            <input
                              inputMode="decimal"
                              value={forecastSettings.customBullAnnualReturn}
                              onChange={(event) => updateForecastSetting('customBullAnnualReturn', event.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                    </CollapsibleSection>
                    </>
                  )}
                </div>

                <PriceChart
                  candles={chartWindowCandles}
                  forecast={
                    forecastProjection
                      ? {
                          tradingDays: forecastProjection.tradingDays,
                          horizonLabel: forecastProjection.horizonLabel,
                          cases: forecastProjection.cases.map((forecastCase) => ({ key: forecastCase.key, points: forecastCase.points })),
                        }
                      : undefined
                  }
                  indicators={chartIndicators}
                  patterns={recentPatternSignals.map((signal) => ({
                    date: chartWindowCandles[signal.index]?.date ?? '',
                    bias: signal.bias,
                    name: signal.name,
                  }))}
                  symbol={analysis.quoteKey}
                />

                {forecastProjection && (
                  <div className="forecast-summary-panel">
                    <div className="forecast-summary-heading">
                      <div>
                        <span className="mini-label">{forecastProjection.modeLabel}</span>
                        <h4>{forecastProjection.horizonLabel} Scenario Range</h4>
                      </div>
                      <strong>{forecastProjection.rangeLabel}</strong>
                    </div>
                    <div className="forecast-card-grid">
                      {forecastProjection.cases.map((forecastCase) => (
                        <article className={`forecast-card tone-${forecastCase.tone}`} key={forecastCase.key}>
                          <span>{forecastCase.label}</span>
                          <strong>{formatInr(forecastCase.endPrice)}</strong>
                          <small>
                            {formatPercent(forecastCase.endReturn)} total
                            {forecastProjection.tradingDays >= 126
                              ? ` | ${formatPercent(forecastCase.annualReturn)} annualized`
                              : ` | ${forecastProjection.tradingDays} trading days`}
                          </small>
                          <p>{forecastCase.rationale}</p>
                        </article>
                      ))}
                    </div>
                    <CollapsibleSection
                      className="forecast-assumptions nested-collapse"
                      headingClassName="subsection-heading"
                      headingLevel={4}
                      id="forecast-assumptions-heading"
                      title="Forecast Assumptions and Limits"
                    >
                      <div className="forecast-assumption-grid">
                        {forecastProjection.assumptions.map((assumption) => (
                          <span key={assumption}>{assumption}</span>
                        ))}
                      </div>
                      <p className="caption">
                        This projection estimates a sensible range, not a promised target. It becomes less reliable after fresh results, corporate
                        actions, major news, liquidity shocks, or broad market regime changes. Re-run it after every data refresh.
                      </p>
                      <p className="caption">Confidence: {forecastProjection.confidence}</p>
                    </CollapsibleSection>
                  </div>
                )}

                {chartIndicatorSummaries.length > 0 && (
                  <div className="indicator-summary-grid" aria-label="Selected indicator interpretation">
                    {chartIndicatorSummaries.map((item) => (
                      <article className={`indicator-summary tone-${item.tone}`} key={item.label}>
                        <span className="label-with-help">
                          {item.label}
                          <HelpTip text={indicatorDefinition(item.label)} />
                        </span>
                        <strong>{item.value}</strong>
                        <p>{indicatorNarrative(item)}</p>
                      </article>
                    ))}
                  </div>
                )}

                {/* Always visible: the Patterns chip only controls the on-chart markers,
                    not this reference section. */}
                <CollapsibleSection
                  className="pattern-findings-panel nested-collapse"
                  eyebrow="Pattern findings"
                  headingClassName="subsection-heading"
                  headingLevel={4}
                  id="pattern-findings-heading"
                  titleAddon={<HelpTip text="Candlestick patterns are visual clues, not trade calls. Use them only with trend location, support/resistance, volume, and next-candle confirmation." />}
                  title="Detected Patterns and How to Use Them"
                >
                    {patternFindings.length ? (
                      <FlashcardDeck
                        ariaLabel="Detected candlestick patterns"
                        cards={patternFindings.map((signal) => ({
                          id: `${signal.name}-${signal.index}-finding`,
                          category: signal.bias === 'bullish' ? 'Bullish' : signal.bias === 'bearish' ? 'Bearish' : 'Neutral',
                          content: (
                            <article className={`pattern-finding ${signal.bias}`}>
                              <div className="pattern-finding-top">
                                <span>{signal.kind}</span>
                                <strong>{signal.name}</strong>
                                <small>{signal.date} close {formatInr(signal.price)}</small>
                              </div>
                              <div className="pattern-finding-body">
                                <p>
                                  <b>How to spot:</b> {signal.spot}
                                </p>
                                <p>
                                  <b>How it looks:</b> {signal.looks}
                                </p>
                                <p>
                                  <b>What it means:</b> {signal.explanation}
                                </p>
                                <p>
                                  <b>How to use it:</b> {signal.use}
                                </p>
                                <p>
                                  <b>Be cautious:</b> {signal.caution}
                                </p>
                                <p>
                                  <b>Invalidation:</b> {signal.stopHint}
                                </p>
                              </div>
                            </article>
                          ),
                        }))}
                      />
                    ) : (
                      <p className="pattern-empty">No recent single or multi-candle pattern was detected in this timeframe and zoom window.</p>
                    )}
                </CollapsibleSection>

                <CollapsibleSection
                  className="chart-guide nested-collapse"
                  eyebrow="Help guide"
                  headingClassName="subsection-heading"
                  headingLevel={4}
                  id="chart-guide-heading"
                  title="How to Read This Chart for Non-Intraday Trading"
                >
                  <FlashcardDeck
                    ariaLabel="Chart reading guide"
                    cards={chartGuideSections.map((section) => ({
                      id: section.title,
                      content: (
                        <article className="chart-guide-card">
                          <strong>{section.title}</strong>
                          <dl className="guide-detail-list">
                            <div>
                              <dt>How to spot</dt>
                              <dd>{section.spot}</dd>
                            </div>
                            <div>
                              <dt>How it looks</dt>
                              <dd>{section.looks}</dd>
                            </div>
                            <div>
                              <dt>What it means</dt>
                              <dd>{section.means}</dd>
                            </div>
                            <div>
                              <dt>How to use it</dt>
                              <dd>{section.use}</dd>
                            </div>
                            <div>
                              <dt>Be cautious</dt>
                              <dd>{section.caution}</dd>
                            </div>
                          </dl>
                        </article>
                      ),
                    }))}
                  />
                </CollapsibleSection>
                <p className="caption">
                  Use the timeframe and indicator buttons to judge whether price is building demand or running into supply. This is delayed EOD data, so it supports non-intraday analysis rather than live execution.
                </p>
              </article>

              <CollapsibleSection
                className="sub-panel nested-collapse analysis-subsection"
                description="Position economics, concentration, practical sizing, range location, liquidity, and quality filters."
                headingClassName="subsection-heading"
                headingLevel={3}
                id="technical-risk-heading"
                title="Position, Risk, Range, and Liquidity"
              >
                <FlashcardStack ariaLabel="Position, risk, range, and liquidity cards" className="visual-card-deck">
              <article className={`visual-card price-story tone-${trendTone}`}>
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">{analysis.quoteKey}</span>
                    <h3>Price Trend</h3>
                  </div>
                  <strong className={(recentTrendPct ?? 0) >= 0 ? 'positive' : 'negative'}>{formatPercent(recentTrendPct)}</strong>
                </div>
                <svg className="sparkline" viewBox="0 0 320 120" role="img" aria-label="Recent daily close price trend">
                  {sparkline.line ? (
                    <>
                      <path className="spark-area" d={sparkline.area} />
                      <path className={(sparkline.trend ?? 0) >= 0 ? 'spark-line positive-stroke' : 'spark-line negative-stroke'} d={sparkline.line} />
                    </>
                  ) : (
                    <text x="18" y="62">Refresh EOD data to draw trend</text>
                  )}
                </svg>
                <div className="fact-strip">
                  <span className={analysis.ltp ? 'tone-neutral' : 'tone-negative'}>
                    <b>LTP</b>
                    {formatInr(analysis.ltp)}
                  </span>
                  <span className={activeQuote?.last_trade_time || lastCandle?.date ? 'tone-neutral' : 'tone-negative'}>
                    <b>Date</b>
                    {activeQuote?.last_trade_time || lastCandle?.date || '-'}
                  </span>
                  <span className={`tone-${candleCountTone}`}>
                    <b>Candles</b>
                    {formatNumber(activeCandles.length)}
                  </span>
                </div>
                <p className="caption">
                  {activeTickerDisplay} has a recent trend of {formatPercent(recentTrendPct)} across the visible daily closes. Use this as the market’s current vote: rising trends can support planned entries, while falling trends ask you to wait for a clearer reversal or reduce add-more enthusiasm.
                </p>
              </article>

              <article className={`visual-card ${pnlTone}`}>
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Holding economics</span>
                    <h3>Cost vs Current Value</h3>
                  </div>
                  <strong className={(analysis.positionPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{formatInr(analysis.positionPnl)}</strong>
                </div>
                <div className="bar-stack">
                  <div className="bar-line">
                    <span>Invested</span>
                    <strong>{formatInr(investedValue)}</strong>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill neutral-fill" style={percentStyle(100)} />
                  </div>
                  <div className="bar-line">
                    <span>Current</span>
                    <strong>{formatInr(currentValue)}</strong>
                  </div>
                  <div className="bar-track">
                    <div className={(analysis.positionPnl ?? 0) >= 0 ? 'bar-fill good-fill' : 'bar-fill bad-fill'} style={percentStyle(currentValue && investedValue ? (currentValue / investedValue) * 100 : undefined)} />
                  </div>
                </div>
                <div className="fact-strip">
                  <span className="tone-neutral">
                    <b>Avg</b>
                    {formatInr(avgPriceNum)}
                  </span>
                  <span className={pnlPercentTone}>
                    <b>P&L %</b>
                    {formatPercent(analysis.positionPnlPct)}
                  </span>
                  <span className={breakevenMove === undefined ? 'tone-neutral' : breakevenMove > 50 ? 'tone-negative' : breakevenMove > 20 ? 'tone-neutral' : 'tone-positive'}>
                    <b>Breakeven</b>
                    {breakevenMove === undefined ? '-' : breakevenMove > 0 ? `${formatPlainPercent(breakevenMove)} up` : `${formatPlainPercent(breakevenMove)} cushion`}
                  </span>
                </div>
                <p className="caption">
                  Your current position is {formatPercent(analysis.positionPnlPct)} P&L. If the gap to breakeven is large, do not add only to lower average price; add only if the business, chart, and risk/reward have improved.
                </p>
              </article>

              <article className={`visual-card exposure-card tone-${portfolioWeightTone}`}>
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Portfolio exposure</span>
                    <h3>Concentration</h3>
                  </div>
                  <strong>{hasPortfolioContext ? formatPercent(analysis.portfolioWeight) : 'Not loaded'}</strong>
                </div>
                <div className="donut-wrap">
                  <div className="donut" style={percentStyle(analysis.portfolioWeight, '--weight')}>
                    <span>{hasPortfolioContext ? formatPercent(analysis.portfolioWeight) : '-'}</span>
                  </div>
                  <div>
                    <p>{hasPortfolioContext ? 'One-stock weight in the loaded portfolio.' : 'Upload holdings to calculate one-stock exposure.'}</p>
                    <p className="caption">
                      {hasPortfolioContext
                        ? `${activeTickerDisplay} is ${formatPercent(analysis.portfolioWeight)} of the loaded portfolio. Higher concentration means the app needs stronger proof before suggesting an add; lower concentration gives more room but still needs a risk plan.`
                        : `This manually entered holding can still be analysed, but concentration is unknown until a holdings file is loaded. Do not add more without checking how large this position is versus the full portfolio.`}
                    </p>
                  </div>
                </div>
              </article>

              <article className={`visual-card tone-${riskSetupTone}`}>
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Risk plan</span>
                    <h3>Size and Reward</h3>
                  </div>
                  <strong>{isHoldingReview && !capitalNum ? 'Add-more off' : formatInr(analysis.riskCapital)}</strong>
                </div>
                <div className="risk-grid">
                  <span className={invalidationPriceNum ? 'tone-neutral' : 'tone-negative'}>
                    <b>Invalidation</b>
                    {formatInr(invalidationPriceNum)}
                  </span>
                  <span className={riskPerShare ? 'tone-neutral' : 'tone-negative'}>
                    <b>Risk/share</b>
                    {formatInr(riskPerShare)}
                  </span>
                  <span className={analysis.suggestedShares ? 'tone-positive' : 'tone-negative'}>
                    <b>Suggested shares</b>
                    {isHoldingReview && !capitalNum ? 'Inactive' : formatNumber(analysis.suggestedShares)}
                  </span>
                  <span className={`tone-${riskSetupTone}`}>
                    <b>Reward/risk</b>
                    {rewardRisk === undefined ? '-' : `${rewardRisk.toFixed(1)}x`}
                  </span>
                </div>
                <div className="bar-track score-track">
                  <div className="bar-fill score-fill" style={percentStyle(analysis.score)} />
                </div>
                <p className="caption">
                  {isHoldingReview && !capitalNum
                    ? `No add-more capital is active, so this box is a review tool, not a buy-size calculator. Risk/share is ${riskPerShare ? formatInr(riskPerShare) : 'not valid yet'} and reward/risk is ${rewardRisk === undefined ? 'not available' : `${rewardRisk.toFixed(1)}x`}.`
                    : `The current risk setup ${riskPerShare ? `has ${formatInr(riskPerShare)} risk per share` : 'does not yet have a valid risk/share'}. Use this box to decide quantity before emotion takes over; without invalidation, the app cannot give a clean size.`}
                </p>
              </article>

              <article className={`visual-card range-card tone-${liquidityTone}`}>
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Price location</span>
                    <h3>Range and Liquidity</h3>
                  </div>
                  <strong>{formatNumber(avgVolume20)}</strong>
                </div>
                <div className="range-track" style={percentStyle(priceRangePercent, '--marker')}>
                  <span className="range-marker" />
                </div>
                <div className="range-labels">
                  <span>{formatInr(activeRange.low)}</span>
                  <span>{formatInr(analysis.ltp)}</span>
                  <span>{formatInr(activeRange.high)}</span>
                </div>
                <div className="fact-strip">
                  <span className={prevCandle?.close ?? activeQuote?.ohlc?.close ? 'tone-neutral' : 'tone-negative'}>
                    <b>Prev close</b>
                    {formatInr(prevCandle?.close ?? activeQuote?.ohlc?.close)}
                  </span>
                  <span className={`tone-${liquidityTone}`}>
                    <b>Last vol</b>
                    {formatNumber(activeQuote?.volume ?? lastCandle?.volume)}
                  </span>
                </div>
                <p className="caption">
                  {activeTickerDisplay} is trading around {formatInr(analysis.ltp)} inside the recent range of {formatInr(activeRange.low)} to {formatInr(activeRange.high)}. If volume is thin, keep orders smaller and avoid assuming you can exit instantly.
                </p>
              </article>

              <article className={`visual-card quality-story tone-${qualityChecklistTone}`}>
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Business filters</span>
                    <h3>Quality Checklist</h3>
                  </div>
                  <strong>{qualityChecklistLabel}</strong>
                </div>
                <div className="quality-grid">
                  {qualityFactors.map((factor) => (
                    <div className={`quality-chip ${factor.status.replace(' ', '-')}`} key={factor.label}>
                      <span>{factor.label}</span>
                      <strong>{factor.value}</strong>
                      <small>{factor.caption}</small>
                    </div>
                  ))}
                </div>
                <p className="caption">
                  {activeTickerDisplay} needs business-quality confirmation before adding. Weak market cap, ROCE, debt, valuation, or profit trend should reduce buy/add comfort even when the chart gives a short-term bounce.
                </p>
              </article>
                </FlashcardStack>
              </CollapsibleSection>
            </div>
          </CollapsibleSection>
        </>
      ) : null}

      {view === 'fundamentals' ? (
        <>
          <CollapsibleSection
            className="parent-section fundamental-section"
            description="Business, ratios, filings, and quality checks."
            eyebrow="Fundamental analysis"
            headingClassName="section-heading collapsible-section-heading"
            id="fundamental-heading"
            staticOpen
            title="Company"
          >
            <div className="visual-grid fundamental-grid">
              {!activeFundamentals && (
                <article className="visual-card fundamental-empty-card tone-negative">
                  <div className="visual-card-heading refined-heading">
                    <div>
                      <span className="mini-label">Fundamental data status</span>
                      <h3>No company fundamentals loaded for {analysis.quoteKey}</h3>
                      <p className="heading-subtext">Quotes and candles can refresh even when the running local server has not loaded the Screener-backed company fetcher.</p>
                    </div>
                    <strong>Action needed</strong>
                  </div>
                  <p className="company-summary">
                    Restart the local data server once with <code>{freeServerCommand}</code>, then click Sync Market Data again. If this card still appears, the ticker likely needs the correct Screener/Yahoo/BSE mapping.
                  </p>
                </article>
              )}

              <CollapsibleSection
                className="sub-panel nested-collapse analysis-subsection"
                defaultOpen
                headingClassName="subsection-heading"
                headingLevel={3}
                id="fundamental-company-heading"
                title="Snapshot"
              >
                <div className="visual-grid subsection-card-grid fundamental-subgrid">
              <article className="visual-card company-profile-card">
                <div className="visual-card-heading refined-heading">
                  <div>
                    <span className="mini-label">Company data</span>
                    <h3>{activeFundamentals?.name || analysis.quoteKey}</h3>
                    <p className="heading-subtext">
                      {activeFundamentals?.sector || 'Sync Market Data'} {activeFundamentals?.industry ? `- ${activeFundamentals.industry}` : '- business profile and ratios'}
                    </p>
                  </div>
                  <strong>{activeFundamentals ? 'Loaded' : 'Needed'}</strong>
                </div>
                <p className="company-summary">
                  {activeFundamentals?.business_summary ||
                    'Click Sync Market Data in the Data tab to fetch a best-effort company profile from delayed EOD/company sources. Use it as a starting point, then confirm important facts from exchange filings and annual reports.'}
                </p>
                <div className="company-fact-grid">
                  {companyProfileFacts.map((fact) => (
                    <div className="company-fact" key={fact.label}>
                      <span>{fact.label}</span>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
                <p className="caption">
                  Use this to judge what can realistically move future price: demand for this business, margin resilience in this industry, and whether the current valuation is backed by a durable business model.
                </p>
              </article>

              <article className="visual-card company-ratio-card">
                <div className="visual-card-heading refined-heading">
                  <div>
                    <span className="mini-label">Evidence</span>
                    <h3>Ratios</h3>
                    <p className="heading-subtext">Use synced ratios as a quick read, then confirm important items from filings.</p>
                  </div>
                  <strong>{activeFundamentals ? `${companyRatioFacts.filter((fact) => fact.value !== '-').length}/${companyRatioFacts.length}` : '0'}</strong>
                </div>
                <FlashcardDeck
                  ariaLabel="Company ratio cards"
                  cards={companyRatioGroups.flatMap((group) =>
                    group.facts.map((fact) => ({
                      id: `${group.title}-${fact.label}`,
                      category: group.title,
                      content: (
                        <div className={`company-ratio tone-${fact.tone}`}>
                          <span className="label-with-help">
                            {fact.label}
                            <HelpTip text={fact.helper} />
                          </span>
                          <strong>{fact.value}</strong>
                          <p>{ratioNarrative(fact)}</p>
                        </div>
                      ),
                    })),
                  )}
                />
                <p className="caption">
                  Read ratios in groups. Cheap valuation with weak cash flow can become a trap, while expensive valuation needs growth and margins to keep supporting future price.
                </p>
              </article>

              <article className="visual-card company-updates-card">
                <div className="visual-card-heading refined-heading">
                  <div>
                    <span className="mini-label">Updates</span>
                    <h3>Recent filings</h3>
                    <p className="heading-subtext">What changed, why it matters, and possible price impact.</p>
                  </div>
                  <strong>{companyUpdates.length ? 'Review impact' : 'None found'}</strong>
                </div>
                {companyUpdates.length ? (
                  <FlashcardDeck
                    ariaLabel="Recent company updates"
                    cards={companyUpdates.map((update) => ({
                      id: `${update.title}-${update.date ?? ''}`,
                      category: updateKind(update),
                      content: (
                        <article className={`company-update tone-${update.tone ?? 'neutral'}`}>
                          <div>
                            <span>{updateKind(update)}</span>
                            <strong>{update.title}</strong>
                            {update.date && <small>{update.date}</small>}
                          </div>
                          <p>
                            <strong>Business meaning:</strong> {updateBusinessMeaning(update)}
                          </p>
                          <p>
                            <strong>Price effect:</strong> {updatePriceImpact(update)}
                          </p>
                          {update.url && (
                            <a href={update.url} target="_blank" rel="noreferrer">
                              Open filing
                            </a>
                          )}
                        </article>
                      ),
                    }))}
                  />
                ) : (
                  <p className="company-summary">
                    No meaningful recent company update was found in the fetched feed. Re-sync later and confirm important events from exchange filings before changing size.
                  </p>
                )}
                <p className="caption">Filings can move price before ratios update. Read the filing when it affects earnings, leadership, orders, corporate actions, or risk disclosures.</p>
              </article>
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                className="sub-panel nested-collapse analysis-subsection"
                defaultOpen
                headingClassName="subsection-heading"
                headingLevel={3}
                id="fundamental-quality-heading"
                title="Quality"
              >
                <FlashcardStack ariaLabel="Business quality cards" className="visual-card-deck">
              <article className={`visual-card fundamental-score-card tone-${fundamentalScore >= 70 ? 'positive' : fundamentalScore < 40 ? 'negative' : 'neutral'}`}>
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Company quality</span>
                    <h3>Quality score</h3>
                  </div>
                  <strong>{fundamentalScore}/100</strong>
                </div>
                <div className="fundamental-wheel" style={percentStyle(fundamentalScore, '--weight')}>
                  <span>{fundamentalScore}</span>
                </div>
                <div className="fundamental-bars">
                  {fundamentalPillars.map((pillar) => (
                    <div className={`fundamental-bar tone-${pillar.tone}`} key={pillar.label}>
                      <div>
                        <span>{pillar.label}</span>
                        <strong>{pillar.value}</strong>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill score-fill" style={percentStyle(pillar.score)} />
                      </div>
                      <p>{pillarNarrative(pillar)}</p>
                      <small>{pillar.caption}</small>
                    </div>
                  ))}
                </div>
                <p className="caption">This is a business-quality view, not a valuation target. Missing evidence should reduce buy/add comfort until reports or trusted data fill the gap.</p>
              </article>

              <article className="visual-card fundamental-flow-card">
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Financial statements</span>
                    <h3>Statement flow</h3>
                  </div>
                  <strong>4 steps</strong>
                </div>
                <div className="statement-flow">
                  {fundamentalStatementFlow.map((item) => (
                    <div className={`statement-node tone-${item.tone}`} key={item.label}>
                      <div className="statement-node-heading">
                        <span>{item.label}</span>
                        <strong>{item.title}</strong>
                      </div>
                      <p>{item.text}</p>
                    </div>
                  ))}
                </div>
                <p className="caption">Good fundamentals should show up together in profits, balance-sheet strength, cash generation, and valuation discipline. If one of these breaks, price can lose support quickly.</p>
              </article>

              <article className="visual-card fundamental-checklist-card">
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Due diligence</span>
                    <h3>Checklist</h3>
                  </div>
                  <strong>{fundamentalChecklist.length} checks</strong>
                </div>
                <div className="fundamental-checklist">
                  {fundamentalChecklist.map((item) => (
                    <div className={`tone-${item.tone}`} key={item.title}>
                      <strong>{item.title}</strong>
                      <p>{item.text}</p>
                    </div>
                  ))}
                </div>
                <p className="caption">Before adding capital, fill the biggest evidence gaps from the annual report, quarterly results, exchange filings, and peer comparison.</p>
              </article>
                </FlashcardStack>
              </CollapsibleSection>
            </div>
          </CollapsibleSection>
        </>
      ) : null}

      {view === 'reasoning' ? (
        <>
          <section className="reasoning-grid lower-grid">
            <CollapsibleSection className="panel parent-section reasoning-parent" eyebrow="Reasoning" id="steps-heading" staticOpen title="Decision Path">

              <div className="steps-list detailed-steps">
                {analysis.steps.map((step, index) => (
                  <CollapsibleSection
                    className="reasoning-step nested-collapse"
                    description={step.plainEnglish}
                    headingClassName="subsection-heading"
                    headingLevel={3}
                    id={`reasoning-step-${index}`}
                    key={step.title}
                    title={`${index + 1}. ${step.title.replace(/^\d+\.\s*/, '')}`}
                  >
                    <div className="formula-box">
                      <span>How to read this</span>
                      <p>{step.formula}</p>
                    </div>
                    <p>
                      <strong>Rationale:</strong> {step.rationale}
                    </p>
                    <p className="takeaway">
                      <strong>Takeaway:</strong> {step.takeaway}
                    </p>
                  </CollapsibleSection>
                ))}
                <CollapsibleSection
                  className="reasoning-step nested-collapse trading-reasoning-step"
                  description="These price checks focus on what can actually change the next decision: sector drivers, downside control, clean capital use, and whether this instrument behaves like a normal listed stock."
                  headingClassName="subsection-heading"
                  headingLevel={3}
                  id="reasoning-step-practical-price-checks"
                  title={`${analysis.steps.length + 1}. Practical Price Checks`}
                >
                  <div className="trading-layer-grid">
                    {analysis.tradingLessons.map((lesson) => (
                      <article className={`trading-lesson-card tone-${lesson.tone}`} key={`${lesson.module}-${lesson.title}`}>
                        <div>
                          <span>{tradingLessonLabel(lesson)}</span>
                          <strong>{lesson.title}</strong>
                        </div>
                        <p>{lesson.text}</p>
                        <small>{lesson.action}</small>
                      </article>
                    ))}
                  </div>
                </CollapsibleSection>
              </div>

              <div className="signal-grid">
                <CollapsibleSection className="sub-panel nested-collapse" headingClassName="subsection-heading" headingLevel={3} id="positive-signals-heading" title="Positive Signals">
                  <ul>
                    {analysis.positives.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </CollapsibleSection>
                <CollapsibleSection className="sub-panel nested-collapse" headingClassName="subsection-heading" headingLevel={3} id="data-source-heading" title="Data Freshness">
                  <p>
                    Last refreshed {cacheAge(activeSnapshot.generated_at)} ago for {analysis.quoteKey}. Refresh before acting if the move is time-sensitive.
                  </p>
                </CollapsibleSection>
              </div>
            </CollapsibleSection>
          </section>
        </>
      ) : null}

      {view === 'data' ? (
        <>
          <CollapsibleSection
            className="panel command-panel data-hub-main-panel"
            eyebrow="Portfolio"
            id="portfolio-market-heading"
            staticOpen
            title="Portfolio"
          >
            {freeRefreshState === 'refreshing' && (
              <div className="sync-progress-panel" role="status" aria-live="polite">
                <div className="sync-progress-top">
                  <span>Syncing market data</span>
                  <strong>{syncProgress}%</strong>
                </div>
                <div className="sync-progress-track" aria-hidden="true">
                  <span style={{ width: `${syncProgress}%` }} />
                </div>
                <p>Fetching prices, candles, fundamentals, company updates, and portfolio price matches. Large portfolios can take longer.</p>
              </div>
            )}
            <section className="portfolio-workspace" aria-label="Portfolio import, summary, and market table">
              <div className="section-inline-heading portfolio-table-heading">
                <div>
                  <span className="mini-label">Portfolio</span>
                  <h3>Holdings & Quotes</h3>
                  <p>Your active holdings file, latest prices, and row-level analyse actions.</p>
                </div>
                <div className="holding-feed-actions">
                  <button
                    type="button"
                    aria-label={`${cacheLabel(cacheState)}. Last refreshed ${cacheAge(activeSnapshot.generated_at)} ago. Sync market data.`}
                    onClick={() => void refreshFreeData({ source: 'data' })}
                    disabled={freeRefreshState === 'refreshing'}
                  >
                    {freeRefreshState === 'refreshing' ? 'Sync Market Data: syncing...' : `Sync Market Data: ${cacheAge(activeSnapshot.generated_at)}`}
                  </button>
                  {hasUploadedHoldingsFeed && (
                    <button
                      className="secondary-action danger-action compact-remove-feed"
                      type="button"
                      onClick={() => {
                        void removeUploadedHoldingsFeed()
                      }}
                    >
                      Remove feed
                    </button>
                  )}
                </div>
              </div>
              {freeRefreshMessage && (
                <p className={`portfolio-helper-message ${freeRefreshState}`}>{freeRefreshMessage}</p>
              )}

              {!hasUploadedHoldingsFeed && (
                <div className="upload-grid portfolio-upload-grid">
                  <label className="field holdings-upload-field">
                    Zerodha holdings report
                    <input
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      disabled={uploadState === 'uploading'}
                      key="holdings-ready"
                      type="file"
                      onChange={(event) => {
                        void uploadHoldingsReport(event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                  </label>
                  <div className={`refresh-message ${uploadState}`}>
                    <p>{uploadMessage || 'Choose a Zerodha holdings XLSX export to build a private browser-local portfolio table.'}</p>
                  </div>
                </div>
              )}
              {hasUploadedHoldingsFeed && uploadMessage && uploadState === 'error' && (
                <div className={`refresh-message ${uploadState}`}>
                  <p>{uploadMessage}</p>
                </div>
              )}

              <section className="metric-grid portfolio-inline-metrics" aria-label="Portfolio metrics">
                <div className="metric">
                  <span>Portfolio snapshot</span>
                  <strong>{hasUploadedHoldingsFeed ? `${loadedHoldingsCount} holdings` : 'No holdings loaded'}</strong>
                  {hasUploadedHoldingsFeed && <small className="metric-subtext">{loadedHoldingsFilename || 'Browser-local upload'}</small>}
                </div>
                <div className="metric">
                  <span>Current value</span>
                  <strong>{formatInr(portfolio.value)}</strong>
                </div>
                <div className="metric">
                  <span>P&L</span>
                  <strong className={portfolio.pnl >= 0 ? 'positive' : 'negative'}>{formatInr(portfolio.pnl)}</strong>
                </div>
                <div className="metric">
                  <span>Return</span>
                  <strong className={portfolioReturn >= 0 ? 'positive' : 'negative'}>{formatPercent(portfolioReturn)}</strong>
                </div>
              </section>

              <section className="portfolio-market-grid-section" aria-label="Combined holdings and market data">
                <div className="table-wrap merged-table-wrap" role="region" aria-label="Combined holdings and market data table, scroll for more columns" tabIndex={0}>
                  <table className="portfolio-market-table">
                  <thead>
                    <tr>
                      <th className="sticky-symbol-cell">Holding / Symbol</th>
                      <th><span className="sr-only">Actions</span></th>
                      <th>Qty</th>
                      <th>Avg</th>
                      <th>LTP</th>
                      <th>Prev Close</th>
                      <th>Change</th>
                      <th>Value</th>
                      <th>P&L</th>
                      <th>P&L %</th>
                      <th>Volume</th>
                      <th>Candles</th>
                      <th>Data status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketRows.length === 0 ? (
                      <tr>
                        <td className="empty-table-cell" colSpan={13}>Sync market data or upload holdings to populate this table.</td>
                      </tr>
                    ) : (
                      marketRows.map((row) => {
                        const holding = row.holding
                        const quote = row.quote
                        const invested = holding ? (holding.average_price ?? 0) * (holding.quantity ?? 0) : undefined
                        const pnl = holding?.pnl
                        const pnlPct = invested && pnl !== undefined ? (pnl / invested) * 100 : undefined
                        const ltp = quote?.last_price ?? holding?.last_price
                        const prevClose = quote?.ohlc?.close
                        const rowLabel = holding ? 'Portfolio holding' : 'Market data row'
                        return (
                          <tr key={row.symbol}>
                            <td className="sticky-symbol-cell">
                              <strong>{row.symbol}</strong>
                              <small>{rowLabel}</small>
                            </td>
                            <td className="table-action-cell">
                              <button
                                className="table-button"
                                disabled={!row.canAnalyze}
                                title={row.canAnalyze ? undefined : 'Unlisted holdings need a valid NSE or BSE symbol before analysis.'}
                                type="button"
                                onClick={() => {
                                  if (holding) {
                                    analyzeHolding(holding)
                                    return
                                  }
                                  const [exchangeRaw, tickerRaw = ''] = row.symbol.split(':')
                                  if (exchangeRaw !== 'NSE' && exchangeRaw !== 'BSE') return
                                  setForm((current) => ({
                                    ...current,
                                    alreadyHold: false,
                                    averagePrice: '',
                                    boughtOn: '',
                                    exchange: exchangeRaw,
                                    quantity: '',
                                    ticker: tickerRaw,
                                  }))
                                  setView('verdict')
                                }}
                              >
                                {row.canAnalyze ? 'Analyze' : 'Needs mapping'}
                              </button>
                            </td>
                            <td>{holding ? formatNumber(holding.quantity) : <span className="muted-placeholder">n/a</span>}</td>
                            <td>{holding ? formatInr(holding.average_price) : <span className="muted-placeholder">n/a</span>}</td>
                            <td>{formatInr(ltp)}</td>
                            <td>{formatInr(prevClose)}</td>
                            <td className={row.changePct === undefined ? '' : row.changePct >= 0 ? 'positive' : 'negative'}>{formatPercent(row.changePct)}</td>
                            <td>{holding ? formatInr(holdingValue(holding)) : <span className="muted-placeholder">n/a</span>}</td>
                            <td className={pnl === undefined ? '' : pnl >= 0 ? 'positive' : 'negative'}>{pnl === undefined ? <span className="muted-placeholder">n/a</span> : formatInr(pnl)}</td>
                            <td className={pnlPct === undefined ? '' : pnlPct >= 0 ? 'positive' : 'negative'}>{pnlPct === undefined ? <span className="muted-placeholder">n/a</span> : formatPercent(pnlPct)}</td>
                            <td>{formatNumber(quote?.volume)}</td>
                            <td>{row.candleCount}</td>
                            <td><span className={`data-status-pill ${row.source}`}>{row.status}</span></td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                  </table>
                </div>
                <div className="portfolio-mobile-card-list" aria-label="Mobile holdings and market data cards">
                  {marketRows.length === 0 ? (
                    <p className="empty-table-cell">Sync market data or upload holdings to populate this table.</p>
                  ) : (
                    marketRows.map((row) => {
                      const holding = row.holding
                      const quote = row.quote
                      const invested = holding ? (holding.average_price ?? 0) * (holding.quantity ?? 0) : undefined
                      const pnl = holding?.pnl
                      const pnlPct = invested && pnl !== undefined ? (pnl / invested) * 100 : undefined
                      const ltp = quote?.last_price ?? holding?.last_price
                      const prevClose = quote?.ohlc?.close
                      const rowLabel = holding ? 'Portfolio holding' : 'Market data row'
                      return (
                        <article className="portfolio-mobile-card" key={`mobile-${row.symbol}`}>
                          <div className="portfolio-mobile-card-head">
                            <div>
                              <span>{rowLabel}</span>
                              <strong>{row.symbol}</strong>
                            </div>
                            <div className="portfolio-mobile-price">
                              <strong>{formatInr(ltp)}</strong>
                              <small className={row.changePct === undefined ? '' : row.changePct >= 0 ? 'positive' : 'negative'}>{formatPercent(row.changePct)}</small>
                            </div>
                          </div>
                          <dl className="portfolio-mobile-facts">
                            <div>
                              <dt>Qty</dt>
                              <dd>{holding ? formatNumber(holding.quantity) : <span className="muted-placeholder">n/a</span>}</dd>
                            </div>
                            <div>
                              <dt>Avg</dt>
                              <dd>{holding ? formatInr(holding.average_price) : <span className="muted-placeholder">n/a</span>}</dd>
                            </div>
                            <div>
                              <dt>Prev close</dt>
                              <dd>{formatInr(prevClose)}</dd>
                            </div>
                            <div>
                              <dt>Value</dt>
                              <dd>{holding ? formatInr(holdingValue(holding)) : <span className="muted-placeholder">n/a</span>}</dd>
                            </div>
                            <div>
                              <dt>P&L</dt>
                              <dd className={pnl === undefined ? '' : pnl >= 0 ? 'positive' : 'negative'}>{pnl === undefined ? <span className="muted-placeholder">n/a</span> : formatInr(pnl)}</dd>
                            </div>
                            <div>
                              <dt>P&L %</dt>
                              <dd className={pnlPct === undefined ? '' : pnlPct >= 0 ? 'positive' : 'negative'}>{pnlPct === undefined ? <span className="muted-placeholder">n/a</span> : formatPercent(pnlPct)}</dd>
                            </div>
                            <div>
                              <dt>Volume</dt>
                              <dd>{formatNumber(quote?.volume)}</dd>
                            </div>
                            <div>
                              <dt>Candles</dt>
                              <dd>{row.candleCount}</dd>
                            </div>
                          </dl>
                          <div className="portfolio-mobile-card-actions">
                            <span className={`data-status-pill ${row.source}`}>{row.status}</span>
                            <button
                              className="table-button"
                              disabled={!row.canAnalyze}
                              title={row.canAnalyze ? undefined : 'Unlisted holdings need a valid NSE or BSE symbol before analysis.'}
                              type="button"
                              onClick={() => {
                                if (holding) {
                                  analyzeHolding(holding)
                                  return
                                }
                                const [exchangeRaw, tickerRaw = ''] = row.symbol.split(':')
                                if (exchangeRaw !== 'NSE' && exchangeRaw !== 'BSE') return
                                setForm((current) => ({
                                  ...current,
                                  alreadyHold: false,
                                  averagePrice: '',
                                  boughtOn: '',
                                  exchange: exchangeRaw,
                                  quantity: '',
                                  ticker: tickerRaw,
                                }))
                                setView('verdict')
                              }}
                            >
                              {row.canAnalyze ? 'Analyze' : 'Needs mapping'}
                            </button>
                          </div>
                        </article>
                      )
                    })
                  )}
                </div>
              </section>
            </section>
          </CollapsibleSection>

          <CollapsibleSection className="panel data-cache-panel" eyebrow="Coverage" id="data-cache-heading" title="Missing Data Resolver">
            {syncCoverage && (freeRefreshState === 'done' || uploadState === 'done') ? (
              <>
                <SyncCoveragePanel coverage={syncCoverage} />
                <MissingDataResolverPanel
                  drafts={mappingDrafts}
                  issues={missingDataIssues}
                  mappingState={mappingState}
                  mappingStatus={mappingStatus}
                  retryDisabled={freeRefreshState === 'refreshing'}
                  onDraftChange={updateMappingDraft}
                  onMarkUnsupported={markSymbolUnsupported}
                  onRetryMissing={retryMissingData}
                  onSaveMapping={saveSymbolMapping}
                />
              </>
            ) : (
              <p className="footer-note">Sync or upload holdings to see which symbols still need mapping or provider follow-up.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            action={
              <span className={`status-dot ${freeRefreshState === 'error' ? 'warning' : 'ready'}`}>
                {freeRefreshState === 'refreshing' ? 'Syncing' : freeRefreshState === 'error' ? 'Check server' : 'Ready'}
              </span>
            }
            className="panel support-diagnostics-panel"
            eyebrow="Connection"
            id="connection-diagnostics-heading"
            title="Connection & Diagnostics"
          >
            <div className="connection-diagnostics-grid">
              <section className="diagnostic-card">
                <span className="mini-label">Sharing</span>
                <h3>HTTPS and peer access</h3>
                <p className="footer-note">
                  For a public HTTPS link, deploy the production build in <code>stock-analysis-app/dist</code> to Vercel, Netlify, or Cloudflare Pages.
                  Refresh/upload actions also need a HTTPS data bridge at <code>{marketDataDisplayUrl}</code>.
                </p>
                <div className="command-stack">
                  <div className="command-row">
                    <code>{productionBuildCommand}</code>
                    <button type="button" onClick={() => copyCommand('production-build', productionBuildCommand)}>
                      {copied === 'production-build' ? 'Copied' : 'Copy build'}
                    </button>
                  </div>
                  <div className="command-row">
                    <code>{lanAppCommand}</code>
                    <button type="button" onClick={() => copyCommand('lan-app', lanAppCommand)}>
                      {copied === 'lan-app' ? 'Copied' : 'Copy app LAN'}
                    </button>
                  </div>
                  <div className="command-row">
                    <code>{publicAppCommand}</code>
                    <button type="button" onClick={() => copyCommand('public-preview', publicAppCommand)}>
                      {copied === 'public-preview' ? 'Copied' : 'Copy preview'}
                    </button>
                  </div>
                </div>
                <div className="diagnostic-note-list">
                  <p>
                    If the data bridge is public too, start it with <code> --allow-origin https://your-app-url</code> and set <code>VITE_MARKET_DATA_BASE_URL</code> to that HTTPS bridge URL before building.
                  </p>
                  <p>Uploaded holdings and cached portfolio data are personal financial data. Share sample/watchlist data unless peers should see the portfolio.</p>
                </div>
              </section>

              <section className="diagnostic-card">
                <span className="mini-label">Provider</span>
                <h3>Delayed market data</h3>
                <div className="steps compact-steps">
                  <div>
                    <span className="step-index">1</span>
                    <code>scripts/market_data_server.py</code>
                    <p>Local button bridge on port 8787</p>
                  </div>
                  <div>
                    <span className="step-index">2</span>
                    <code>query1.finance.yahoo.com</code>
                    <p>Delayed end-of-day candles</p>
                  </div>
                  <div>
                    <span className="step-index">3</span>
                    <code>query2.finance.yahoo.com</code>
                    <p>Best-effort company profile and fundamental ratios</p>
                  </div>
                  <div>
                    <span className="step-index">4</span>
                    <code>Browser local storage</code>
                    <p>Private per-browser cache used by verdicts</p>
                  </div>
                </div>
              </section>

              <section className="diagnostic-card footer-panel">
                <span className="mini-label">Data sync</span>
                <h3>Local sync requirements</h3>
                <div className="command-row">
                  <code>{freeServerCommand}</code>
                  <button type="button" onClick={() => copyCommand('footer-server', freeServerCommand)}>
                    {copied === 'footer-server' ? 'Copied' : 'Copy server'}
                  </button>
                </div>
                <div className="command-row">
                  <code>{freeCliCommand}</code>
                  <button type="button" onClick={() => copyCommand('footer-cli', freeCliCommand)}>
                    {copied === 'footer-cli' ? 'Copied' : 'Copy CLI'}
                  </button>
                </div>
                <div className="command-row">
                  <code>Symbol mapping file</code>
                  <button type="button" onClick={() => copyCommand('mapping-file', 'data/reference/free_data_symbols.json')}>
                    {copied === 'mapping-file' ? 'Copied' : 'Copy path'}
                  </button>
                </div>
                <p className="footer-note">
                  If a symbol fails, add or correct its Yahoo mapping in the symbol file. BSE names often need the BSE code, for example 517393.BO.
                </p>
                {(freeRefreshState === 'error' || uploadState === 'error') && activeSnapshotForAnalysis.errors.length > 0 && (
                  <div className="diagnostic-warning-list">
                    <strong>Provider follow-up notes</strong>
                    {activeSnapshotForAnalysis.errors.map((error) => (
                      <p key={error}>{error}</p>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </CollapsibleSection>
        </>
      ) : null}

      {view === 'glossary' ? (
        <section className="parent-section glossary-section">
          <div className="section-heading collapsible-section-heading">
            <span className="mini-label">Reference</span>
            <h2>Glossary</h2>
            <p>Every jargon term used across the app, in plain English, in one place.</p>
          </div>

          <label className="field glossary-search-field">
            <FieldLabel help="Type any part of a term to filter the list below.">Search terms</FieldLabel>
            <input
              placeholder="e.g. reward, ROCE, VWAP"
              type="search"
              value={glossarySearch}
              onChange={(event) => setGlossarySearch(event.target.value)}
            />
          </label>

          {(() => {
            const query = glossarySearch.trim().toLowerCase()
            const filtered = query
              ? glossaryEntries.filter(
                  (entry) => entry.term.toLowerCase().includes(query) || entry.definition.toLowerCase().includes(query),
                )
              : glossaryEntries
            if (filtered.length === 0) {
              return <p className="glossary-empty">No terms match "{glossarySearch}". Try a shorter search.</p>
            }
            const categories = Array.from(new Set(filtered.map((entry) => entry.category)))
            return categories.map((category) => (
              <div className="panel glossary-category" key={category}>
                <h3>{category}</h3>
                <dl className="glossary-list">
                  {filtered
                    .filter((entry) => entry.category === category)
                    .map((entry) => (
                      <div className="glossary-entry" key={entry.term}>
                        <dt>{entry.term}</dt>
                        <dd>{entry.definition}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            ))
          })()}
        </section>
      ) : null}
    </main>
  )
}

export default App

// Named exports below are purely additive (no change to app behavior or the default
// export) and exist so the core scoring logic can be unit-tested in isolation from
// the React component tree. See src/__tests__/buildAnalysis.test.ts.
// eslint-disable-next-line react-refresh/only-export-components
export { buildAnalysis, starterSnapshot, initialForm, formatInr, formatPercent, toneFromScore, defaultRiskPercentForProfile, mergeRefreshedSnapshot }
