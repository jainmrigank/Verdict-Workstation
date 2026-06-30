import { type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import './App.css'

type Exchange = 'NSE' | 'BSE'
type RiskMode = 'percent' | 'amount'
type RiskProfile = 'conservative' | 'balanced' | 'balanced_aggressive' | 'aggressive'
type Horizon = '3-6m' | '6-12m' | '1-3y' | '3y+'
type TradeAccess = 'delivery' | 'fo_context' | 'hedging'
type ProfitTrend = 'unknown' | 'growing' | 'stable' | 'declining' | 'loss_making'
type View = 'verdict' | 'data'
type CacheState = 'loading' | 'live' | 'free' | 'sample'
type RefreshState = 'idle' | 'refreshing' | 'done' | 'error'
type UploadState = 'idle' | 'uploading' | 'done' | 'error'
type ServerRestartState = 'idle' | 'restarting' | 'done' | 'error'
type ThemeMode = 'dark' | 'light'
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

type SignalGroup = 'Technical' | 'Fundamental' | 'Statements' | 'News' | 'Risk'

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

type SyncCoverage = {
  technicalLoaded: string[]
  technicalMissing: string[]
  fundamentalsLoaded: string[]
  fundamentalsMissing: string[]
}

type BrowserWorkspace = {
  version: 1
  snapshot: Snapshot
  form: AnalysisForm
  symbols: string
  days: number
  includeHoldings: boolean
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
  last_price?: number
  pnl?: number
  product?: string
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
    kite_key: string
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
  score: number
  confidence: number
  confidenceLabel: string
  quoteKey: string
  ltp?: number
  positionPnl?: number
  positionPnlPct?: number
  portfolioWeight?: number
  riskCapital?: number
  suggestedShares?: number
  suggestedDeployment?: number
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
    return {
      version: 1,
      snapshot: {
        ...starterSnapshot,
        ...parsed.snapshot,
        holdings: parsed.snapshot.holdings ?? [],
        quotes: parsed.snapshot.quotes ?? {},
        candles: parsed.snapshot.candles ?? {},
        fundamentals: parsed.snapshot.fundamentals ?? {},
        errors: parsed.snapshot.errors ?? [],
      },
      form: { ...initialForm, ...(parsed.form ?? {}) },
      symbols: typeof parsed.symbols === 'string' ? parsed.symbols : '',
      days: typeof parsed.days === 'number' && Number.isFinite(parsed.days) ? parsed.days : 730,
      includeHoldings: typeof parsed.includeHoldings === 'boolean' ? parsed.includeHoldings : false,
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
    help: 'Blends technical trend/volatility, fundamental quality, valuation, event risk, and the verdict score. Best default for sensible ranges.',
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

const requiredHelp = {
  ticker: 'Company symbol to analyse. It controls which quote, candles, and holding row the app matches.',
  exchange: 'NSE or BSE route for the ticker. The wrong exchange can fetch the wrong security or no data.',
  capital:
    'For a new position, this is the cash you are willing to deploy and is required for sizing. For an existing holding, it is optional fresh/additional capital only if you are considering adding more.',
  horizon: 'Your intended holding period. Longer horizons give more weight to fundamentals and less to short-term noise.',
  alreadyHold: 'Turn this on when the stock is already in your portfolio. It makes average price, drawdown, and portfolio weight affect the verdict.',
  boughtOn: 'Reference date for your original entry. It is useful context for reviewing whether the thesis has had enough time to work.',
  quantity: 'Current number of shares. It drives current value, P&L, portfolio concentration, and exposure risk.',
  averagePrice: 'Your average buy price. It is used to calculate unrealized gain/loss and breakeven recovery needed.',
  riskProfile: 'Adjusts score tolerance. Conservative penalises risk more; aggressive allows more risk but still requires evidence.',
  marketAccess: 'Tells the app whether to stay delivery-only or mention F&O only as context/hedging.',
  maxRisk:
    'Maximum fresh loss you are willing to take on this idea. It is needed for new entry sizing or add-more sizing, but not required just to review an existing holding.',
  riskUnit: 'Choose whether max risk is a percentage of deployable capital or a fixed rupee amount.',
}

const optionalHelp = {
  manualLtp: 'Overrides cached price when you want to analyse from a specific current or planned entry price.',
  invalidationPrice: 'The price where the thesis is considered wrong. Required for proper risk-based sizing.',
  targetPrice: 'Expected upside price. Used with invalidation to calculate reward/risk.',
  marketCapCr: 'Company size in crore. Very small companies are penalised when small-cap avoidance is enabled.',
  debtEquity: 'Debt compared with equity. Higher debt reduces score when you prefer cleaner balance sheets.',
  roce: 'Return on capital employed. Higher ROCE usually means the business uses capital more efficiently.',
  pe: 'Price-to-earnings ratio. Very high P/E can mean expensive; very low P/E can mean cyclicality or hidden risk.',
  profitTrend: 'Direction of recent profits. Growing/stable profits improve confidence; declining/loss-making hurts it.',
  constraints: 'Personal rules. Enabled filters penalise companies or setups that violate your preferences.',
  thesis: 'Your notes do not auto-score yet, but they keep the decision checklist anchored to your actual investment reason.',
  holdingsRefresh:
    'When checked, sync adds every ticker from the uploaded holdings file to the price request, not only the symbols typed above. Your imported portfolio table stays loaded either way.',
  serverRestart: 'Restarts the local Python data bridge on port 8787. If an older bridge is already running, manually restart it once; after that this button can restart it from the app.',
}

const forecastHelp = {
  horizon: 'How far into the future the scenario range should extend. Short horizons rely more on volatility and technicals; long horizons rely more on fundamentals and valuation assumptions.',
  mode: 'Adaptive blends technicals and fundamentals. Technical focuses on chart and volatility. Fundamental focuses on business growth and valuation. Custom uses your own bear/base/bull return assumptions.',
  volatilityMultiplier: 'Controls the width of the bear-to-bull range. Raise it for uncertain or news-sensitive stocks; lower it for stable, liquid stocks.',
  trendWeight: 'How much recent price trend should influence the central path. Higher values make the forecast follow recent momentum more strongly.',
  fundamentalGrowth: 'Expected annual business growth. Leave blank to use fetched revenue/earnings growth when available, with a conservative fallback.',
  valuationShift: 'Expected valuation re-rating over the full selected horizon. Positive means market pays a higher multiple; negative means multiple compression.',
  eventRisk: 'Adjusts range width and central score for pending results, leadership changes, orders, regulation, litigation, or other company events.',
  customBearAnnualReturn: 'Your annualized downside assumption for custom mode. Use this to model a specific bear thesis.',
  customBaseAnnualReturn: 'Your annualized central return assumption for custom mode. This becomes the custom base case.',
  customBullAnnualReturn: 'Your annualized upside assumption for custom mode. Use this to model a strong execution or re-rating case.',
}

function HelpTip({ text }: { text: string }) {
  function positionTooltip(event: MouseEvent<HTMLSpanElement> | FocusEvent<HTMLSpanElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const halfTooltip = Math.min(160, Math.max(120, (window.innerWidth - 32) / 2))
    const minX = halfTooltip + 16
    const maxX = Math.max(minX, window.innerWidth - halfTooltip - 16)
    const x = Math.min(Math.max(rect.left + rect.width / 2, minX), maxX)
    event.currentTarget.style.setProperty('--tip-x', `${x}px`)
    event.currentTarget.style.setProperty('--tip-y', `${rect.top}px`)
  }

  return (
    <span
      className="help-tip"
      data-tip={text}
      tabIndex={0}
      aria-label={text}
      onMouseEnter={positionTooltip}
      onFocus={positionTooltip}
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
  title,
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
  title: string
}) {
  const [openState, setOpenState] = useState({ id, isOpen: defaultOpen })
  const isOpen = openState.id === id ? openState.isOpen : defaultOpen
  const HeadingTag = headingLevel === 3 ? 'h3' : headingLevel === 4 ? 'h4' : 'h2'
  const bodyId = `${id}-body`

  return (
    <section className={`${className} collapsible-section ${isOpen ? 'is-open' : 'is-collapsed'}`} aria-labelledby={id}>
      <div className={`${headingClassName} collapsible-heading`}>
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <HeadingTag id={id}>
            <button className="collapse-title-button" type="button" aria-controls={bodyId} aria-expanded={isOpen} onClick={() => setOpenState({ id, isOpen: !isOpen })}>
              <span className="collapse-icon" aria-hidden="true">
                {isOpen ? '-' : '+'}
              </span>
              <span>{title}</span>
            </button>
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
  return (
    <div className="sync-coverage-panel">
      <div className="sync-coverage-heading">
        <span>Sync coverage</span>
        <small>Technical means quote plus candle history. Fundamentals means company profile/ratios/statements data was loaded.</small>
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
            <strong>{coverage.technicalMissing.length}</strong>
          </div>
          <SymbolCoverageList emptyLabel="None missing." items={coverage.technicalMissing} tone="negative" />
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
            <strong>{coverage.fundamentalsMissing.length}</strong>
          </div>
          <SymbolCoverageList emptyLabel="None missing." items={coverage.fundamentalsMissing} tone="neutral" />
        </article>
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
  if (cacheState === 'free') return 'Market Data Sync'
  if (cacheState === 'live') return 'API cache'
  if (cacheState === 'loading') return 'Loading'
  return 'Starter workspace'
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

function providerLabel(provider: string) {
  if (provider.startsWith('free_')) return 'Market Data Sync'
  if (provider.includes('starter')) return 'Starter Workspace'
  if (provider.includes('sample')) return 'Sample Workspace'
  return provider.replaceAll('_', ' ')
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

function orderedSnapshotSymbols(snapshot: Snapshot) {
  const seen = new Set<string>()
  const symbols: string[] = []
  const add = (symbol?: string) => {
    if (!symbol || seen.has(symbol)) return
    seen.add(symbol)
    symbols.push(symbol)
  }
  snapshot.symbols.forEach((symbol) => add(symbol.kite_key || symbol.input))
  Object.keys(snapshot.quotes).forEach(add)
  Object.keys(snapshot.candles).forEach(add)
  Object.keys(snapshot.fundamentals ?? {}).forEach(add)
  return symbols
}

function buildSyncCoverage(snapshot: Snapshot): SyncCoverage {
  const symbols = orderedSnapshotSymbols(snapshot)
  const hasTechnical = (symbol: string) => Boolean(snapshot.quotes[symbol]) && (snapshot.candles[symbol]?.length ?? 0) > 0
  const hasFundamentals = (symbol: string) => Object.keys(snapshot.fundamentals?.[symbol] ?? {}).length > 0
  return {
    technicalLoaded: symbols.filter(hasTechnical),
    technicalMissing: symbols.filter((symbol) => !hasTechnical(symbol)),
    fundamentalsLoaded: symbols.filter(hasFundamentals),
    fundamentalsMissing: symbols.filter((symbol) => !hasFundamentals(symbol)),
  }
}

function mergeFundamentals(refreshedSnapshot: Snapshot, previousSnapshot: Snapshot) {
  const merged: Record<string, CompanyFundamentals> = { ...(previousSnapshot.fundamentals ?? {}) }
  for (const [key, fundamentals] of Object.entries(refreshedSnapshot.fundamentals ?? {})) {
    if (Object.keys(fundamentals ?? {}).length > 0 || !merged[key]) {
      merged[key] = fundamentals
    }
  }
  return merged
}

function mergeRefreshedSnapshot(refreshedSnapshot: Snapshot, previousSnapshot: Snapshot) {
  const refreshedCount = filledFundamentalsCount(refreshedSnapshot)
  const previousCount = filledFundamentalsCount(previousSnapshot)
  const fundamentals = mergeFundamentals(refreshedSnapshot, previousSnapshot)
  const retainedCount = filledFundamentalsRecordCount(fundamentals)
  const previousHoldings = previousSnapshot.holdings ?? []
  const refreshedHoldings = refreshedSnapshot.holdings ?? []
  const retainedHoldings =
    !refreshedSnapshot.upload &&
    refreshedHoldings.length === 0 &&
    previousHoldings.length > 0 &&
    !previousSnapshot.provider.includes('sample')
  const holdings = retainedHoldings ? mergeHoldingsPrices(previousHoldings, refreshedSnapshot.quotes ?? {}) : refreshedHoldings

  return {
    refreshedCount,
    retainedCount,
    retainedExisting: previousCount > 0 && retainedCount > refreshedCount,
    retainedHoldings,
    snapshot: {
      ...refreshedSnapshot,
      fundamentals,
      holdings,
      upload: refreshedSnapshot.upload ?? (retainedHoldings ? previousSnapshot.upload : undefined),
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

function updateToneScore(updates: CompanyFundamentals['company_updates'] | undefined) {
  if (!updates?.length) return 50
  const toneScore = updates.slice(0, 3).reduce((sum, update) => {
    if (update.tone === 'positive') return sum + 68
    if (update.tone === 'negative') return sum + 32
    return sum + 52
  }, 0)
  return toneScore / Math.min(updates.length, 3)
}

function compactSignalText(text: string | undefined, limit = 130) {
  if (!text) return ''
  const compacted = text.replace(/\s+/g, ' ').trim()
  return compacted.length > limit ? `${compacted.slice(0, limit - 1)}...` : compacted
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
  const marketCapCr = parseNumber(form.marketCapCr) ?? (companyMarketCap === undefined ? undefined : companyMarketCap / 10000000)
  const debtEquity = parseNumber(form.debtEquity) ?? companyDebtEquity
  const roce = parseNumber(form.roce) ?? companyRoce
  const pe = parseNumber(form.pe) ?? companyTrailingPe
  const maxRisk = parseNumber(form.maxRisk)
  const invalidationPrice = parseNumber(form.invalidationPrice)
  const targetPrice = parseNumber(form.targetPrice)
  const riskCapital = capital && maxRisk ? (form.riskMode === 'percent' ? capital * (maxRisk / 100) : maxRisk) : undefined
  const needsFreshCapital = !form.alreadyHold
  const riskPlanDefined = Boolean(invalidationPrice && (form.alreadyHold || riskCapital))

  const missing: string[] = []
  if (!ticker) missing.push('Ticker')
  if (needsFreshCapital && !capital) missing.push('Capital for new position')
  if (!ltp) missing.push('LTP from live cache or manual input')
  if (form.alreadyHold && !quantity) missing.push('Holding quantity')
  if (form.alreadyHold && !avgPrice) missing.push('Average buy price')

  let score = 50
  const positives: string[] = []
  const cautions: string[] = []
  const actions: string[] = []

  if (cacheState === 'sample') cautions.push('No personal market cache is loaded yet. Upload holdings or sync delayed market data before taking action.')
  if (cacheState === 'free') positives.push('Delayed end-of-day price data is cached for non-intraday analysis.')
  if (!quote) cautions.push('No quote was found in the current cache for this symbol.')
  if (candleCount >= 180) positives.push('Daily candles are available for trend and support/resistance checks.')
  if (candleCount === 0) cautions.push('No historical candles are cached yet, so the technical view is incomplete.')

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

  if (form.profitTrend === 'growing') {
    score += 8
    positives.push('Profit trend is marked as growing.')
  }
  if (form.profitTrend === 'declining') {
    score -= 8
    cautions.push('Profit trend is declining.')
  }
  if (form.profitTrend === 'loss_making') {
    score -= 15
    cautions.push('Loss-making status is a major quality red flag.')
  }
  if (form.profitTrend === 'stable') {
    score += 2
    positives.push('Profit trend is stable.')
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
    'Varsity technical analysis starts with trend context: price strength is more useful when it agrees with the intended direction.',
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
    'RSI is treated as momentum context, not a standalone buy/sell rule. Extremely stretched or very weak readings reduce score.',
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
  addSignal(fundamentalSignals, 'Fundamental', 'Market cap', marketCapCr === undefined ? '-' : `${formatNumber(marketCapCr)} cr`, scoreMetric(marketCapCr, (value) => (value >= 10000 ? 74 : value >= 1000 ? 56 : value >= 500 ? 42 : 30)), 0.8, 'Company size influences disclosure depth, liquidity, and fragility.')
  addSignal(fundamentalSignals, 'Fundamental', 'Trailing P/E', formatNumber(companyTrailingPe), scoreMetric(companyTrailingPe, (value) => (value > 8 && value < 30 ? 66 : value >= 30 && value <= 55 ? 50 : value > 55 ? 34 : value > 0 ? 42 : 35)), 0.75, 'P/E is valuation context and must be read with growth and earnings quality.')
  addSignal(fundamentalSignals, 'Fundamental', 'Forward P/E', formatNumber(companyForwardPe), scoreMetric(companyForwardPe, (value) => (value > 8 && value < 28 ? 66 : value >= 28 && value <= 50 ? 50 : value > 50 ? 34 : value > 0 ? 42 : 35)), 0.55, 'Forward P/E is useful when estimates are credible, but optimism deserves caution.')
  addSignal(fundamentalSignals, 'Fundamental', 'Price/book', formatNumber(companyPriceToBook), scoreMetric(companyPriceToBook, (value) => (value > 0 && value <= 4 ? 64 : value <= 10 ? 50 : 35)), 0.45, 'P/B helps more in asset-heavy businesses, but very high P/B raises expectation risk.')
  addSignal(fundamentalSignals, 'Fundamental', 'ROE', formatDecimalPercent(companyRoe), scoreMetric(companyRoe, (value) => (value >= 0.15 ? 72 : value >= 0.08 ? 58 : value >= 0 ? 42 : 28)), 0.8, 'ROE shows return on shareholder capital, but high debt can inflate it.')
  addSignal(fundamentalSignals, 'Fundamental', 'ROCE', formatPercent(roce), scoreMetric(roce, (value) => (value >= 18 ? 78 : value >= 10 ? 60 : value >= 6 ? 42 : 30)), 1.05, 'ROCE is a core Varsity quality filter because it checks return on total capital employed.')
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
  addSignal(fundamentalSignals, 'Fundamental', 'Earnings growth', formatDecimalPercent(companyEarningsGrowth), scoreMetric(companyEarningsGrowth, (value) => (value > 0.08 ? 72 : value >= 0 ? 55 : 30)), 0.85, 'Earnings growth improves the score only when it is not contradicted by weak cash flow.')

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
  addSignal(statementSignals, 'Statements', 'CFO vs PAT', latestCfo === undefined || latestPat === undefined ? '-' : `${formatNumber(latestCfo)} cr vs ${formatNumber(latestPat)} cr`, latestCfo === undefined || latestPat === undefined ? 48 : latestCfo > 0 && latestCfo >= latestPat * 0.65 ? 72 : latestCfo > 0 ? 54 : 28, 1.1, 'Varsity fundamental analysis stresses cash conversion: PAT is stronger when CFO broadly supports it.')
  addSignal(statementSignals, 'Statements', 'Reserves vs borrowings', latestReserves === undefined || latestBorrowings === undefined ? '-' : `${formatNumber(latestReserves)} cr / ${formatNumber(latestBorrowings)} cr`, latestReserves === undefined || latestBorrowings === undefined ? 48 : latestBorrowings <= latestReserves * 0.5 ? 72 : latestBorrowings <= latestReserves ? 56 : 34, 0.85, 'Balance-sheet strength improves when reserves comfortably exceed borrowings.')
  addSignal(statementSignals, 'Statements', 'EPS', formatNumber(latestEps), scoreMetric(latestEps, (value) => (value > 0 ? 64 : 28)), 0.55, 'EPS is a compact profitability clue, but it still needs valuation and cash-flow context.')
  addSignal(statementSignals, 'Statements', 'Net cash flow', latestNetCashFlow === undefined ? '-' : `${formatNumber(latestNetCashFlow)} cr`, scoreMetric(latestNetCashFlow, (value) => (value > 0 ? 62 : value > -100 ? 48 : 36)), 0.4, 'Net cash flow is noisy, but a very weak value asks for cash-flow review.')

  const newsSignals: AdaptiveSignal[] = []
  const updates = companyFundamentals?.company_updates ?? []
  addSignal(
    newsSignals,
    'News',
    'Top 3 updates',
    updates.length ? `${updates.length} loaded` : 'None loaded',
    updateToneScore(updates),
    1,
    'Recent exchange/company updates can temporarily dominate both chart and fundamental readings, so they affect the event-risk component.',
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
      compactSignalText(update.summary || update.title || 'Review this update against price action and the latest results because events can change the risk/reward quickly.'),
    )
  })

  const riskSignals: AdaptiveSignal[] = []
  addSignal(riskSignals, 'Risk', 'Position drawdown', formatPercent(positionPnlPct), scoreMetric(positionPnlPct, (value) => (value > 12 ? 70 : value > -8 ? 56 : value > -20 ? 42 : value > -50 ? 28 : 18)), 1, 'Deep drawdowns reduce the score because breakeven needs a large recovery and averaging down becomes dangerous.')
  addSignal(riskSignals, 'Risk', 'Portfolio weight', formatPercent(portfolioWeight), scoreMetric(portfolioWeight, (value) => (value <= 8 ? 70 : value <= 12 ? 58 : value <= 20 ? 42 : 28)), 0.9, 'Concentration controls how much one company-specific error can hurt the full portfolio.')
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
  addSignal(riskSignals, 'Risk', 'Legacy checklist', `${Math.round(clamp(score))}/100`, clamp(score), 1, 'This preserves the earlier checklist logic for constraints, holding state, liquidity, and supplied evidence.')

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
    { label: 'Risk and portfolio', score: Math.round(riskScore), weight: normalisedWeights.risk, tone: toneFromScore(riskScore), rationale: 'Drawdown, concentration, reward/risk, invalidation, risk budget, and the legacy checklist.' },
    { label: 'Updates and events', score: Math.round(newsScore), weight: normalisedWeights.news, tone: toneFromScore(newsScore), rationale: 'Top company/exchange updates and event tone.' },
  ]
  const adaptiveSignals = [...technicalSignals, ...fundamentalSignals, ...statementSignals, ...riskSignals, ...newsSignals]
  const adaptiveScore =
    technicalScore * normalisedWeights.technical +
    fundamentalScore * normalisedWeights.fundamental +
    statementScore * normalisedWeights.statements +
    riskScore * normalisedWeights.risk +
    newsScore * normalisedWeights.news

  if (technicalScore >= 62) positives.push('Technical structure is supportive after weighing trend, momentum, volatility, VWAP, patterns, and liquidity.')
  if (technicalScore <= 42) cautions.push('Technical structure is weak after weighing trend, momentum, volatility, VWAP, patterns, and liquidity.')
  if (fundamentalScore >= 62) positives.push('Fundamental quality is supportive after scoring the full ratio card set.')
  if (fundamentalScore <= 42) cautions.push('Fundamental quality is weak after scoring the full ratio card set.')
  if (statementScore <= 42) cautions.push('Statement-flow evidence is weak or incomplete, especially around cash conversion, borrowings, reserves, sales, or EPS.')
  if (newsScore <= 42) cautions.push('Recent company updates carry negative or unresolved event risk.')

  if (positives.length === 0) positives.push('No strong positive filter has been supplied yet.')
  if (cautions.length === 0) cautions.push('No major caution was triggered by the current inputs.')

  const finalScore = missing.length > 0 ? 0 : Math.round(clamp(adaptiveScore))
  let verdict: AnalysisResult['verdict'] = 'Needs Input'
  let verdictClass: AnalysisResult['verdictClass'] = 'needs-data'

  if (missing.length === 0) {
    if (finalScore >= 75) {
      verdict = 'Buy/Add Candidate'
      verdictClass = 'buy'
    } else if (finalScore >= 62) {
      verdict = 'Hold or Add on Dips'
      verdictClass = 'hold'
    } else if (finalScore >= 48) {
      verdict = 'Hold and Watch'
      verdictClass = 'watch'
    } else if (finalScore >= 32) {
      verdict = 'Reduce Risk'
      verdictClass = 'reduce'
    } else {
      verdict = 'Avoid or Exit Review'
      verdictClass = 'avoid'
    }
  }

  const evidenceSignals = adaptiveSignals.filter((signal) => signal.value !== '-' && signal.value !== 'None loaded').length
  let confidence = cacheState === 'live' || cacheState === 'free' ? 50 : 30
  if (quote) confidence += 12
  if (holding) confidence += 8
  if (candleCount >= 180) confidence += 14
  else if (candleCount > 0) confidence += 7
  confidence += Math.min(evidenceSignals * 1.25, 30)
  if (form.profitTrend !== 'unknown') confidence += 6
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

  const doItems = [
    missing.length > 0
      ? `Complete the missing inputs first: ${missing.join(', ')}. The score stays at zero until the app has enough data for a fair read.`
      : `Treat this as a ${verdict.toLowerCase()} setup, not a blind order. Confirm price, corporate announcements, and the latest results before acting.`,
    invalidationPrice && ltp && invalidationPrice < ltp
      ? `Use ${formatInr(invalidationPrice)} as the current invalidation reference. If price breaks it, the thesis needs a fresh review instead of emotional averaging.`
      : form.alreadyHold
        ? 'Set an invalidation level for the existing holding. It gives you a clear review point even if you are not adding fresh capital.'
        : 'Set an invalidation price before adding capital. Without it, the app cannot tell how much money is actually at risk.',
    suggestedShares !== undefined && suggestedShares > 0
      ? `Cap any fresh risk-sized deployment near ${formatNumber(suggestedShares)} shares, about ${formatInr(suggestedDeployment)}, unless you deliberately change the risk budget.`
      : form.alreadyHold && !capital
        ? 'Because this is a holding review with no fresh capital entered, focus on hold/reduce/exit discipline rather than add-more sizing.'
        : 'Keep sizing conservative until target, invalidation, and capital risk are fully defined.',
    marketCapCr === undefined || debtEquity === undefined || roce === undefined || pe === undefined || form.profitTrend === 'unknown'
      ? 'Add the missing fundamentals from annual reports or a trusted screener: market cap, debt/equity, ROCE, P/E, and profit trend.'
      : 'Cross-check the supplied fundamentals against the latest annual report, quarterly results, and exchange filings.',
  ]

  if (positionPnlPct !== undefined && positionPnlPct < -15) {
    doItems.push('Re-underwrite the position from zero: ask whether you would buy it today at the current price if you did not already own it.')
  }
  if (rewardRisk !== undefined && rewardRisk < 1.5) {
    doItems.push('Wait for a better entry or a clearer upside trigger because the current reward/risk is not attractive enough.')
  }
  if (portfolioWeight !== undefined && portfolioWeight > 12) {
    doItems.push('Check concentration before adding. A single stock already has meaningful influence on the whole portfolio.')
  }

  const dontItems = [
    'Do not average down only because your buy price is higher. Averaging is justified only when fundamentals, price structure, and risk/reward all improve.',
    'Do not use F&O to recover losses from a weak cash position. Use derivatives only when the purpose is explicitly hedging or risk reduction.',
    'Do not ignore liquidity. A stock can look cheap on paper but still be hard to exit if traded volume is thin.',
    'Do not treat the score as a prediction. It is a checklist output that helps control process risk, not a guarantee of future price movement.',
  ]

  if (form.constraints.avoidHighDebt) {
    dontItems.push('Do not relax the high-debt rule without a strong reason, because leverage can turn a temporary business slowdown into permanent capital damage.')
  }
  if (form.constraints.avoidSmallCaps) {
    dontItems.push('Do not force a small-cap exception unless you are comfortable with lower liquidity, higher volatility, and weaker disclosure depth.')
  }

  const whyItems = [
    `Adaptive hybrid score is ${finalScore}/100 after weighing ${scoreComponents.map((component) => `${component.label} ${Math.round(component.weight * 100)}%`).join(', ')}.`,
    confidence >= 75
      ? 'Confidence is high because the app has enough price, holding, candle, and/or fundamental evidence.'
      : confidence >= 50
        ? 'Confidence is medium because the app has workable market data but still benefits from more company-level evidence.'
        : 'Confidence is low because important quote, candle, holding, or fundamental evidence is missing.',
    positionPnlPct !== undefined && positionPnlPct < -20
      ? 'The position drawdown is a major drag because deep losses need very large percentage gains to recover.'
      : 'The position drawdown is not the dominant negative input from the current data.',
    recentTrendPct !== undefined
      ? `The recent price trend is ${formatPercent(recentTrendPct)}, so technical evidence is ${recentTrendPct >= 0 ? 'supportive' : 'not yet supportive'}.`
      : 'Trend evidence is incomplete because there are not enough cached candles.',
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
      title: '2. Position math',
      plainEnglish: form.alreadyHold
        ? `Quantity ${formatNumber(quantity)}, average ${formatInr(avgPrice)}, unrealized P&L ${formatInr(positionPnl)} (${formatPercent(positionPnlPct)}).`
        : 'No current holding was marked, so the verdict treats this as a fresh entry decision.',
      formula: form.alreadyHold
        ? `Cost = quantity x average price = ${positionCostText}. Value = quantity x LTP = ${positionValueText}. P&L = value - cost.`
        : 'Fresh-entry mode ignores old average price and focuses on whether the current price is attractive for a new position.',
      rationale:
        'A loss is not automatically a reason to sell, and a profit is not automatically a reason to hold. The important question is whether the business and price still justify fresh capital today.',
      takeaway:
        breakevenMove !== undefined && breakevenMove > 0
          ? `The stock needs roughly ${formatPlainPercent(breakevenMove)} upside from the current price just to reach your average price.`
          : 'The position is not below breakeven based on the current inputs.',
    },
    {
      title: '3. Portfolio risk',
      plainEnglish: form.alreadyHold
        ? `This stock is currently about ${formatPercent(portfolioWeight)} of the portfolio value shown in the app. ${capital ? `Fresh add-more risk budget is ${formatInr(riskCapital)}.` : 'No fresh capital was entered, so this is treated as a holding review.'}`
        : `This is being treated as a new position. Your risk budget is ${formatInr(riskCapital)}.`,
      formula: form.alreadyHold
        ? 'Portfolio weight = position value / total portfolio value. Fresh risk budget is calculated only if additional capital is supplied.'
        : 'Risk budget = capital x max-risk % or fixed rupee risk.',
      rationale:
        'Concentration matters because one company-specific problem can damage the whole portfolio. A high weight deserves stricter evidence before adding more.',
      takeaway:
        portfolioWeight !== undefined && portfolioWeight > 20
          ? 'This is a high-concentration position, so the app penalises aggressive adding.'
          : 'The current concentration is not extreme based on the loaded portfolio.',
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
      plainEnglish: `The optional quality inputs are market cap ${formatNumber(marketCapCr)} cr, debt/equity ${formatNumber(debtEquity)}, ROCE ${formatPercent(roce)}, P/E ${formatNumber(pe)}, and profit trend ${profitTrendLabels[form.profitTrend]}.`,
      formula: 'Quality score adjusts upward for stronger ROCE, manageable debt, sufficient market cap, sensible valuation, and improving/stable profit trend.',
      rationale:
        'Price can move for many reasons, but over a non-intraday horizon the business matters. A weak balance sheet, poor capital efficiency, or falling profits reduces the margin of safety.',
      takeaway:
        marketCapCr === undefined && debtEquity === undefined && roce === undefined && pe === undefined && form.profitTrend === 'unknown'
          ? 'Add fundamentals to make the verdict much stronger.'
          : 'The supplied fundamentals are included in the score, but filings should still be checked before committing more capital.',
    },
    {
      title: '6. Risk plan',
      plainEnglish:
        riskPerShare !== undefined
          ? riskCapital
            ? `If invalidation is ${formatInr(invalidationPrice)}, the risk per share is ${formatInr(riskPerShare)} and the suggested risk-sized quantity is ${formatNumber(suggestedShares)} shares.`
            : `If invalidation is ${formatInr(invalidationPrice)}, the existing holding has a clear review level. Add fresh capital only if you want risk-sized add-more quantity.`
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
      title: '7. Verdict synthesis',
      plainEnglish: `The final verdict is ${verdict} with a score of ${finalScore}/100 and ${confidenceLabel.toLowerCase()} confidence.`,
      formula: `Adaptive score = technical ${Math.round(normalisedWeights.technical * 100)}% + ratios ${Math.round(normalisedWeights.fundamental * 100)}% + statements ${Math.round(normalisedWeights.statements * 100)}% + risk ${Math.round(normalisedWeights.risk * 100)}% + updates ${Math.round(normalisedWeights.news * 100)}%.`,
      rationale:
        'The verdict is not a prediction. It is an adaptive checklist output: technicals matter more for shorter horizons, fundamentals and statements matter more for longer horizons, and risk weight rises when drawdown or concentration is high.',
      takeaway: `Treat the result as a decision aid. Final action should still confirm recent filings, corporate announcements, and your personal risk tolerance.`,
    },
  ]

  return {
    verdict,
    verdictClass,
    score: finalScore,
    confidence,
    confidenceLabel,
    quoteKey,
    ltp,
    positionPnl,
    positionPnlPct,
    portfolioWeight,
    riskCapital,
    suggestedShares,
    suggestedDeployment,
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
  }
}

function App() {
  const [storedWorkspace] = useState<BrowserWorkspace | null>(() => readBrowserWorkspace())
  const [snapshot, setSnapshot] = useState<Snapshot>(() => storedWorkspace?.snapshot ?? starterSnapshot)
  const [cacheState, setCacheState] = useState<CacheState>(() => cacheStateFromProvider((storedWorkspace?.snapshot ?? starterSnapshot).provider))
  const [view, setView] = useState<View>('verdict')
  const [form, setForm] = useState<AnalysisForm>(() => storedWorkspace?.form ?? initialForm)
  const [symbols, setSymbols] = useState(() => storedWorkspace?.symbols ?? '')
  const [days, setDays] = useState(() => storedWorkspace?.days ?? 730)
  const [includeHoldings, setIncludeHoldings] = useState(() => storedWorkspace?.includeHoldings ?? false)
  const [copied, setCopied] = useState<string | null>(null)
  const [freeRefreshState, setFreeRefreshState] = useState<RefreshState>('idle')
  const [freeRefreshMessage, setFreeRefreshMessage] = useState('')
  const [syncProgress, setSyncProgress] = useState(0)
  const [syncCoverage, setSyncCoverage] = useState<SyncCoverage | null>(null)
  const [serverRestartState, setServerRestartState] = useState<ServerRestartState>('idle')
  const [serverRestartMessage, setServerRestartMessage] = useState('')
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [uploadMessage, setUploadMessage] = useState('')
  const [theme, setTheme] = useState<ThemeMode>('dark')
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>('6M')
  const [chartZoomLevel, setChartZoomLevel] = useState(1)
  const [chartWindowEnd, setChartWindowEnd] = useState<number | null>(null)
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
  const [hoveredCandleIndex, setHoveredCandleIndex] = useState<number | null>(null)
  const [chartShellElement, setChartShellElement] = useState<HTMLDivElement | null>(null)

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
      symbols,
      days,
      includeHoldings,
    })
  }, [days, form, includeHoldings, snapshot, symbols])

  const activeSnapshot = snapshot
  const hasUploadedHoldingsFeed = activeSnapshot.holdings.length > 0
  const loadedHoldingsFilename = activeSnapshot.upload?.filename ?? (hasUploadedHoldingsFeed ? 'Browser cached holdings' : '')
  const loadedHoldingsCount = activeSnapshot.upload?.holdings_count ?? activeSnapshot.holdings.length
  const includeHoldingsInSync = includeHoldings && hasUploadedHoldingsFeed
  const isHoldingReview = form.alreadyHold
  const analysis = useMemo(() => buildAnalysis(form, activeSnapshot, cacheState), [activeSnapshot, cacheState, form])
  const portfolio = useMemo(() => portfolioSummary(activeSnapshot), [activeSnapshot])
  const portfolioReturn = portfolio.cost ? (portfolio.pnl / portfolio.cost) * 100 : 0

  const marketDataUrl = useMemo(() => marketDataBaseUrl(), [])
  const marketDataDisplayUrl = marketDataUrl || 'Set VITE_MARKET_DATA_BASE_URL to your HTTPS data bridge'
  const freeServerCommand = 'python3 scripts/market_data_server.py'
  const lanServerCommand = 'python3 scripts/market_data_server.py --host 0.0.0.0'
  const lanAppCommand = 'cd react-day1 && npm run dev:lan'
  const productionBuildCommand = 'cd react-day1 && npm run build'
  const publicAppCommand = 'cd react-day1 && npm run preview:lan'
  const freeCliCommand = useMemo(() => {
    const holdingsFlag = includeHoldingsInSync ? '' : ' --no-holdings'
    return `python3 scripts/market_data_refresh.py --symbols ${symbols.trim()} --days ${days}${holdingsFlag}`
  }, [days, includeHoldingsInSync, symbols])

  const quoteRows = Object.entries(activeSnapshot.quotes).map(([symbol, quote]) => {
    const close = quote.ohlc?.close
    const changePct = close && quote.last_price ? ((quote.last_price - close) / close) * 100 : undefined
    return {
      symbol,
      ...quote,
      changePct,
      candleCount: activeSnapshot.candles[symbol]?.length ?? 0,
    }
  })

  const activeQuote = activeSnapshot.quotes[analysis.quoteKey]
  const activeFundamentals = activeSnapshot.fundamentals?.[analysis.quoteKey]
  const activeCandles = activeSnapshot.candles[analysis.quoteKey] ?? emptyCandles
  const sparkline = useMemo(() => buildSparkline(activeCandles), [activeCandles])
  const forecastProjection = useMemo(
    () => buildScenarioForecast(activeCandles, analysis, activeFundamentals, forecastSettings),
    [activeCandles, activeFundamentals, analysis, forecastSettings],
  )
  const chartModel = useMemo(
    () => buildCandleChart(activeCandles, chartTimeframe, chartZoomLevel, chartWindowEnd, forecastProjection),
    [activeCandles, chartTimeframe, chartWindowEnd, chartZoomLevel, forecastProjection],
  )
  const activeRange = useMemo(() => candleRange(activeCandles, 252), [activeCandles])

  useEffect(() => {
    setHoveredCandleIndex(null)
  }, [analysis.quoteKey, chartTimeframe, chartWindowEnd, chartZoomLevel])

  useEffect(() => {
    setChartZoomLevel(1)
    setChartWindowEnd(null)
  }, [analysis.quoteKey])

  useEffect(() => {
    if (!chartShellElement) return undefined
    const shellElement = chartShellElement

    function handleNativeChartWheel(event: WheelEvent) {
      const isPinchZoom = event.ctrlKey || event.metaKey
      if (!isPinchZoom || !chartModel.candles.length || !chartModel.baseLength) return
      event.preventDefault()
      event.stopPropagation()

      const rect = shellElement.getBoundingClientRect()
      const plotLeftPx = (chartModel.plotLeft / chartModel.width) * rect.width
      const plotWidthPx = (chartModel.plotWidth / chartModel.width) * rect.width
      const pointerRatio = clamp((event.clientX - rect.left - plotLeftPx) / plotWidthPx, 0, 1)
      const pointerIndex = clamp(pointerRatio * chartModel.candles.length - 0.5, 0, chartModel.candles.length - 1)
      const anchoredIndex = chartModel.windowStart + pointerIndex
      const deltaScale = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? rect.height : 1
      const cappedDelta = clamp(event.deltaY * deltaScale, -70, 70)
      const factor = Math.exp(-cappedDelta * 0.002)
      const nextZoom = clamp(chartZoomLevel * factor, 1, 8)
      const nextLength = Math.max(1, Math.ceil(chartModel.baseLength / nextZoom))
      const nextStart = clamp(Math.round(anchoredIndex - (pointerRatio * nextLength - 0.5)), 0, Math.max(0, chartModel.baseLength - nextLength))

      setChartZoomLevel(nextZoom)
      setChartWindowEnd(nextZoom <= 1 ? null : nextStart + nextLength)
    }

    shellElement.addEventListener('wheel', handleNativeChartWheel, { passive: false })
    return () => shellElement.removeEventListener('wheel', handleNativeChartWheel)
  }, [chartModel, chartShellElement, chartZoomLevel])

  const priceRangePercent = rangePosition(analysis.ltp, activeRange.low, activeRange.high)
  const recentTrendPct = candleTrendPct(activeCandles, 30)
  const avgVolume20 = averageVolume(activeCandles, 20)
  const lastCandle = latestCandle(activeCandles)
  const prevCandle = previousCandle(activeCandles)
  const hoveredChartPoint = hoveredCandleIndex === null ? undefined : chartModel.candles[hoveredCandleIndex]
  const hoveredCandle = hoveredChartPoint?.candle
  const hoverTooltipX = hoveredChartPoint ? (hoveredChartPoint.x > chartModel.width - 236 ? hoveredChartPoint.x - 230 : hoveredChartPoint.x + 12) : 0
  const hoverTooltipY = hoveredChartPoint ? clamp(hoveredChartPoint.closeY - 72, 12, chartModel.priceHeight - 148) : 0
  const chartWindowCandles = useMemo(() => chartModel.candles.map((point) => point.candle), [chartModel])
  const patternSignals = useMemo(() => detectCandlestickPatterns(chartWindowCandles), [chartWindowCandles])
  const recentPatternSignals = patternSignals.slice(-8).reverse()
  const chartTrendPct = candleTrendPct(chartWindowCandles, chartWindowCandles.length)
  const chartZoomLabel = chartZoomLevel === 1 ? 'Full window' : `${chartZoomLevel.toFixed(1).replace(/\.0$/, '')}x zoom`
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
  const marketCapCr = parseNumber(form.marketCapCr) ?? (companyMarketCap === undefined ? undefined : companyMarketCap / 10000000)
  const debtEquity = parseNumber(form.debtEquity) ?? companyDebtEquity
  const roce = parseNumber(form.roce) ?? companyRoce
  const pe = parseNumber(form.pe) ?? companyTrailingPe
  const profitStatus =
    form.profitTrend === 'growing' || form.profitTrend === 'stable'
      ? 'strong'
      : form.profitTrend === 'declining'
        ? 'watch'
        : form.profitTrend === 'loss_making'
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
      value: profitTrendLabels[form.profitTrend],
      status: profitStatus,
      caption: 'Improving or stable profit trend reduces the chance of a value trap.',
    },
  ]

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
      caption: activeFundamentals?.key_points || 'Varsity starts FA by understanding what the company does, demand drivers, costs, and industry position.',
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
      caption: 'Module 3 stresses operating cash flow and FCF because profits without cash can be fragile.',
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
  const companyUpdates = activeFundamentals?.company_updates ?? []
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
        ? `Market-data source loaded from ${activeFundamentals.source_url}. Still check promoter holding, pledge, remuneration, capital allocation, dilution, and auditor notes from exchange filings.`
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
    { label: 'Source', value: activeFundamentals?.source ? providerLabel(activeFundamentals.source) : 'Sync Market Data' },
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
      helper: 'Price paid for each rupee of recent earnings. Compare with peers and growth, not as a standalone buy/sell trigger.',
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

  const analysisBrief = useMemo(() => {
    return [
      `Ticker: ${form.exchange}:${form.ticker.toUpperCase()}`,
      `Verdict: ${analysis.verdict} (${analysis.score}/100, ${analysis.confidenceLabel} confidence)`,
      `${form.alreadyHold ? 'Fresh capital' : 'Capital to deploy'}: ${formatInr(parseNumber(form.capital))}`,
      `Horizon: ${horizonLabels[form.horizon]}`,
      `Risk profile: ${riskProfileLabels[form.riskProfile]}`,
      `Already hold: ${form.alreadyHold ? 'Yes' : 'No'}`,
      `Quantity: ${form.quantity || '-'}`,
      `Average price: ${form.averagePrice || '-'}`,
      `LTP used: ${formatInr(analysis.ltp)}`,
      `Position P&L: ${formatInr(analysis.positionPnl)} (${formatPercent(analysis.positionPnlPct)})`,
      `Actions: ${analysis.actions.join(' ')}`,
      `Cautions: ${analysis.cautions.join(' ')}`,
    ].join('\n')
  }, [analysis, form])

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

  async function waitForFreeDataServer(previousStartedAt?: string) {
    const bridgeUrl = requireMarketDataBridge('Server restart')
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 650))
      try {
        const response = await fetch(apiUrl(bridgeUrl, '/health'), { cache: 'no-store' })
        const data = await readResponseJson(response)
        const startedAt = typeof data.started_at === 'string' ? data.started_at : undefined
        if (response.ok && data.ok === true && (!previousStartedAt || (startedAt && startedAt !== previousStartedAt))) {
          return true
        }
      } catch {
        // The old process may be down while the replacement is starting.
      }
    }
    return false
  }

  async function restartFreeDataServer() {
    setServerRestartState('restarting')
    setServerRestartMessage('Restarting the local data server...')
    try {
      const bridgeUrl = requireMarketDataBridge('Server restart')
      const response = await fetch(apiUrl(bridgeUrl, '/api/server/restart'), { method: 'POST' })
      const data = await readResponseJson(response)
      if (response.status === 404) {
        throw new Error(
          `The running data server is too old for one-click restart. Stop it once with Ctrl+C, start ${freeServerCommand}, then this button will work going forward.`,
        )
      }
      if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Server restart failed.')
      }
      const previousStartedAt = typeof data.started_at === 'string' ? data.started_at : undefined
      setServerRestartMessage('Restart request accepted. Waiting for the local data server to come back...')
      const restarted = await waitForFreeDataServer(previousStartedAt)
      if (!restarted) {
        throw new Error(`Restart request was accepted, but the server did not come back yet. Start it with: ${freeServerCommand}`)
      }
      setServerRestartState('done')
      setServerRestartMessage('Local data server restarted. Click Sync Market Data to fetch quotes, candles, fundamentals, and company updates.')
    } catch (error) {
      setServerRestartState('error')
      setServerRestartMessage(
        error instanceof Error
          ? error.message
          : `Could not restart the local data server. Start it manually with: ${freeServerCommand}`,
      )
    }
  }

  async function refreshFreeData() {
    setFreeRefreshState('refreshing')
    setFreeRefreshMessage('Syncing EOD prices, candles, fundamentals, and company updates...')
    setSyncProgress(8)
    setSyncCoverage(null)
    try {
      const bridgeUrl = requireMarketDataBridge('Market-data sync')
      const response = await fetch(apiUrl(bridgeUrl, '/api/free-data/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: symbols.trim().split(/\s+/).filter(Boolean),
          days,
          includeHoldings: includeHoldingsInSync,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Market-data sync failed.')
      }
      const refreshedSnapshot = data as Snapshot
      const mergedRefresh = mergeRefreshedSnapshot(refreshedSnapshot, activeSnapshot)
      setSnapshot(mergedRefresh.snapshot)
      setCacheState(cacheStateFromProvider(mergedRefresh.snapshot.provider))
      setSyncCoverage(buildSyncCoverage(mergedRefresh.snapshot))
      setSyncProgress(100)
      setFreeRefreshState('done')
      const fundamentalsMessage = mergedRefresh.refreshedCount
        ? `Fundamentals loaded for ${mergedRefresh.refreshedCount} symbols.`
        : mergedRefresh.retainedExisting
          ? `Refresh returned no fundamentals, so existing fundamentals for ${mergedRefresh.retainedCount} symbols were kept. Restart the local data server once to activate the Screener-backed fundamentals fetcher.`
          : `No fundamentals returned yet. Restart the local data server once, then refresh again to activate the Screener-backed fundamentals fetcher.`
      const holdingsMessage = mergedRefresh.snapshot.holdings.length
        ? mergedRefresh.retainedHoldings
          ? `Imported portfolio kept with ${mergedRefresh.snapshot.holdings.length} holdings; ${quotedHoldingsCount(mergedRefresh.snapshot)} have refreshed prices.`
          : `Portfolio shows ${mergedRefresh.snapshot.holdings.length} holdings; ${quotedHoldingsCount(mergedRefresh.snapshot)} have refreshed prices.`
        : 'No uploaded holdings are loaded.'
      setFreeRefreshMessage(
        `Updated ${Object.keys(mergedRefresh.snapshot.quotes).length} priced symbols. ${holdingsMessage} ${fundamentalsMessage} ${mergedRefresh.snapshot.errors.length} warnings.`,
      )
    } catch (error) {
      setFreeRefreshState('error')
      setSyncProgress(0)
      setSyncCoverage(null)
      setFreeRefreshMessage(bridgeFailureMessage(error, 'Market-data sync failed.'))
    }
  }

  async function uploadHoldingsReport(file: File | undefined) {
    if (!file) return
    setUploadState('uploading')
    setUploadMessage(`Uploading ${file.name}...`)
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
      const mergedRefresh = mergeRefreshedSnapshot(refreshedSnapshot, activeSnapshot)
      setSnapshot(mergedRefresh.snapshot)
      setCacheState(cacheStateFromProvider(mergedRefresh.snapshot.provider))
      setSyncCoverage(buildSyncCoverage(mergedRefresh.snapshot))
      if (refreshedSnapshot.upload?.symbols.length) {
        setSymbols(refreshedSnapshot.upload.symbols.join(' '))
      }
      setIncludeHoldings(true)
      setUploadState('done')
      const fundamentalsMessage = mergedRefresh.refreshedCount
        ? `Fundamentals loaded for ${mergedRefresh.refreshedCount} symbols.`
        : mergedRefresh.retainedExisting
          ? `Existing fundamentals for ${mergedRefresh.retainedCount} symbols were kept because the upload refresh returned quotes only.`
          : `No fundamentals returned yet; restart the local data server once and refresh again.`
      setUploadMessage(
        `Imported ${refreshedSnapshot.upload?.holdings_count ?? mergedRefresh.snapshot.holdings.length} holdings from ${file.name}. ${quotedHoldingsCount(mergedRefresh.snapshot)} holdings have refreshed prices. ${fundamentalsMessage}`,
      )
    } catch (error) {
      setUploadState('error')
      setUploadMessage(bridgeFailureMessage(error, 'Holdings upload failed.'))
    }
  }

  async function removeUploadedHoldingsFeed() {
    if (!hasUploadedHoldingsFeed) return
    const removedKeys = new Set(activeSnapshot.holdings.map(holdingKey).filter(Boolean))
    const symbolsToRemove = new Set(
      [
        ...(activeSnapshot.upload?.symbols ?? []),
        ...activeSnapshot.holdings.map(holdingKey).filter((key) => key && !key.startsWith('UNLISTED:')),
      ].map((symbol) => symbol.trim().toUpperCase()),
    )
    const nextSnapshot: Snapshot = {
      ...activeSnapshot,
      holdings: [],
      upload: undefined,
    }
    setSnapshot(nextSnapshot)
    setSyncCoverage(null)
    setIncludeHoldings(false)
    setUploadState('idle')
    setUploadMessage('Removed the uploaded holdings feed from this browser. You can upload another XLSX now.')
    setSymbols((current) =>
      current
        .trim()
        .split(/\s+/)
        .filter((symbol) => symbol && !symbolsToRemove.has(symbol.toUpperCase()))
        .join(' '),
    )
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
    setForm((current) => ({
      ...current,
      ticker: holding.tradingsymbol ?? current.ticker,
      exchange,
      alreadyHold: true,
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

  function handleChartPointerMove(event: MouseEvent<SVGSVGElement>) {
    if (!chartModel.candles.length || !chartModel.step) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * chartModel.width
    const index = Math.round((x - chartModel.plotLeft) / chartModel.step - 0.5)
    setHoveredCandleIndex(clamp(index, 0, chartModel.candles.length - 1))
  }

  function handleChartMouseOut(event: MouseEvent<SVGSVGElement>) {
    const relatedTarget = event.relatedTarget
    if (!relatedTarget || !event.currentTarget.contains(relatedTarget as Node)) {
      setHoveredCandleIndex(null)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">NSE/BSE analysis agent</p>
          <h1>Verdict Workstation</h1>
        </div>
        <div className="topbar-actions">
          <button
            className="theme-toggle"
            type="button"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? 'Dark mode' : 'Light mode'}
          </button>
          <div className={`cache-pill ${cacheState}`}>
            <span>{cacheLabel(cacheState)}</span>
            <strong>{cacheAge(activeSnapshot.generated_at)}</strong>
          </div>
          <div className="tabs" role="tablist" aria-label="Workspace view">
            <button className={view === 'verdict' ? 'active' : ''} type="button" onClick={() => setView('verdict')}>
              Verdict
            </button>
            <button className={view === 'data' ? 'active' : ''} type="button" onClick={() => setView('data')}>
              Data
            </button>
          </div>
        </div>
      </header>

      {view === 'verdict' ? (
        <>
          <CollapsibleSection
            className="parent-section setup-parent"
            description="Required inputs, optional evidence, and personal filters that shape the verdict."
            eyebrow="Inputs"
            headingClassName="section-heading collapsible-section-heading"
            id="setup-parent-heading"
            title="Decision Setup"
          >
            <section className="input-grid">
            <CollapsibleSection
              action={
                <button type="button" onClick={() => copyCommand('brief', analysisBrief)}>
                  {copied === 'brief' ? 'Copied' : 'Copy brief'}
                </button>
              }
              className="panel form-panel"
              eyebrow="Required"
              id="required-heading"
              title="Analysis Inputs"
            >
              <div className={`position-mode-card ${isHoldingReview ? 'holding-mode' : 'new-mode'}`}>
                <div>
                  <span>{isHoldingReview ? 'Existing holding review' : 'New position analysis'}</span>
                  <strong>{isHoldingReview ? 'Capital is optional unless you plan to add more.' : 'Capital is required for a fresh entry.'}</strong>
                  <p>
                    {isHoldingReview
                      ? 'The verdict prioritises quantity, average price, current P&L, concentration, invalidation, and whether the thesis still deserves fresh capital.'
                      : 'The verdict prioritises deployable capital, risk budget, invalidation, reward/risk, and whether the current price is worth a new allocation.'}
                  </p>
                </div>
                <ul>
                  {(isHoldingReview
                    ? ['Required: ticker, exchange, horizon, quantity, average price', 'Optional: bought date, fresh/additional capital, max risk for add-more sizing']
                    : ['Required: ticker, exchange, horizon, capital to deploy', 'Optional but useful: max risk, invalidation, target, manual LTP']
                  ).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="form-grid two">
                <label className="field">
                  <FieldLabel help={requiredHelp.ticker}>Ticker</FieldLabel>
                  <input required value={form.ticker} onChange={(event) => updateForm('ticker', event.target.value.toUpperCase())} />
                </label>
                <label className="field">
                  <FieldLabel help={requiredHelp.exchange}>Exchange</FieldLabel>
                  <select value={form.exchange} onChange={(event) => updateForm('exchange', event.target.value as Exchange)}>
                    <option value="NSE">NSE</option>
                    <option value="BSE">BSE</option>
                  </select>
                </label>
                {!isHoldingReview && (
                  <label className="field">
                    <FieldLabel help={requiredHelp.capital}>Capital to deploy</FieldLabel>
                    <input inputMode="decimal" value={form.capital} onChange={(event) => updateForm('capital', event.target.value)} />
                    <span className="field-note">Required for a new position because sizing and risk budget need a capital base.</span>
                  </label>
                )}
                <label className="field">
                  <FieldLabel help={requiredHelp.horizon}>Horizon</FieldLabel>
                  <select value={form.horizon} onChange={(event) => updateForm('horizon', event.target.value as Horizon)}>
                    {Object.entries(horizonLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="toggle-row">
                <label className="toggle-field">
                  <input checked={form.alreadyHold} type="checkbox" onChange={(event) => updateForm('alreadyHold', event.target.checked)} />
                  <span className="toggle-copy">
                    Already holding
                    <HelpTip text={requiredHelp.alreadyHold} />
                  </span>
                </label>
              </div>

              {isHoldingReview && (
                <div className="form-grid two">
                  <label className="field">
                    <FieldLabel help={requiredHelp.boughtOn}>Bought on</FieldLabel>
                    <input type="date" value={form.boughtOn} onChange={(event) => updateForm('boughtOn', event.target.value)} />
                    <span className="field-note">Optional context for reviewing how long the thesis has had to work.</span>
                  </label>
                  <label className="field">
                    <FieldLabel help={requiredHelp.quantity}>Quantity</FieldLabel>
                    <input inputMode="decimal" value={form.quantity} onChange={(event) => updateForm('quantity', event.target.value)} />
                  </label>
                  <label className="field">
                    <FieldLabel help={requiredHelp.averagePrice}>Average price</FieldLabel>
                    <input inputMode="decimal" value={form.averagePrice} onChange={(event) => updateForm('averagePrice', event.target.value)} />
                  </label>
                  <label className="field">
                    <FieldLabel help={requiredHelp.capital}>Fresh capital</FieldLabel>
                    <input inputMode="decimal" value={form.capital} onChange={(event) => updateForm('capital', event.target.value)} />
                    <span className="field-note">Optional. Fill only if you are considering adding more to this holding.</span>
                  </label>
                </div>
              )}

              <div className="segmented-block">
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

              <div className="segmented-block">
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

              <div className="form-grid two">
                <label className="field">
                  <FieldLabel help={requiredHelp.maxRisk}>{isHoldingReview ? 'Fresh max risk' : 'Max risk'}</FieldLabel>
                  <input inputMode="decimal" value={form.maxRisk} onChange={(event) => updateForm('maxRisk', event.target.value)} />
                  <span className="field-note">
                    {isHoldingReview ? 'Optional unless you are planning an add-more trade.' : 'Used with capital and invalidation to estimate risk-sized quantity.'}
                  </span>
                </label>
                <label className="field">
                  <FieldLabel help={requiredHelp.riskUnit}>Risk unit</FieldLabel>
                  <select value={form.riskMode} onChange={(event) => updateForm('riskMode', event.target.value as RiskMode)}>
                    <option value="percent">% of capital</option>
                    <option value="amount">Rupee amount</option>
                  </select>
                  {isHoldingReview && <span className="field-note">Percentage mode uses the fresh capital field, not your existing invested amount.</span>}
                </label>
              </div>
            </CollapsibleSection>

            <CollapsibleSection className="panel evidence-panel" eyebrow="Optional" id="optional-heading" title="Evidence and Filters">

              <div className="form-grid three">
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
                <label className="field">
                  <FieldLabel help={optionalHelp.marketCapCr}>Market cap, cr</FieldLabel>
                  <input inputMode="decimal" value={form.marketCapCr} onChange={(event) => updateForm('marketCapCr', event.target.value)} />
                </label>
                <label className="field">
                  <FieldLabel help={optionalHelp.debtEquity}>Debt/equity</FieldLabel>
                  <input inputMode="decimal" value={form.debtEquity} onChange={(event) => updateForm('debtEquity', event.target.value)} />
                </label>
                <label className="field">
                  <FieldLabel help={optionalHelp.roce}>ROCE %</FieldLabel>
                  <input inputMode="decimal" value={form.roce} onChange={(event) => updateForm('roce', event.target.value)} />
                </label>
                <label className="field">
                  <FieldLabel help={optionalHelp.pe}>P/E</FieldLabel>
                  <input inputMode="decimal" value={form.pe} onChange={(event) => updateForm('pe', event.target.value)} />
                </label>
                <label className="field">
                  <FieldLabel help={optionalHelp.profitTrend}>Profit trend</FieldLabel>
                  <select value={form.profitTrend} onChange={(event) => updateForm('profitTrend', event.target.value as ProfitTrend)}>
                    {Object.entries(profitTrendLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

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

          <CollapsibleSection
            action={
              <div className="score-box">
                <strong>{analysis.score}</strong>
                <span>/100</span>
              </div>
            }
            className={`verdict-panel expanded-verdict ${analysis.verdictClass}`}
            defaultOpen
            eyebrow="Verdict"
            headingClassName="verdict-heading"
            id="verdict-heading"
            title={analysis.verdict}
          >

            <p className="verdict-summary">
              The app reads this as <strong>{analysis.verdict}</strong> with {analysis.confidenceLabel.toLowerCase()} confidence. It is using{' '}
              {formatInr(analysis.ltp)} as the analysis price, {formatPercent(analysis.positionPnlPct)} position P&L, and{' '}
              {formatPercent(analysis.portfolioWeight)} portfolio weight.
            </p>

            <div className="metric-grid compact-metrics">
              <div className="metric tone-neutral">
                <span>Ticker</span>
                <strong>{analysis.quoteKey}</strong>
              </div>
              <div className="metric tone-neutral">
                <span>Quantity</span>
                <strong>{formatNumber(quantityNum)}</strong>
              </div>
              <div className="metric tone-neutral">
                <span>LTP</span>
                <strong>{formatInr(analysis.ltp)}</strong>
              </div>
              <div className={`metric ${pnlTone}`}>
                <span>P&L</span>
                <strong className={(analysis.positionPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{formatInr(analysis.positionPnl)}</strong>
              </div>
              <div className={`metric ${pnlPercentTone}`}>
                <span>P&L %</span>
                <strong className={(analysis.positionPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{formatPercent(analysis.positionPnlPct)}</strong>
              </div>
              <div className={`metric tone-${portfolioWeightTone}`}>
                <span>Weight</span>
                <strong>{formatPercent(analysis.portfolioWeight)}</strong>
              </div>
              <div className={`metric tone-${confidenceTone}`}>
                <span>Confidence</span>
                <strong>{analysis.confidenceLabel}</strong>
              </div>
            </div>

            <section className="verdict-evidence-box" aria-label="Verdict evidence and missing metrics">
              <div className="verdict-evidence-heading">
                <span className="mini-label">Verdict logic</span>
                <h3>How the agent weighs evidence</h3>
              </div>
              <div className="verdict-evidence-grid">
                <article className="tone-neutral">
                  <strong>Does it weigh unavailable metrics?</strong>
                  <p>
                    It does not invent missing numbers. Required gaps keep the verdict at <b>Needs Input</b>. Optional missing metrics stay as
                    unknown evidence with neutral or slightly cautious scores, and they reduce confidence so a verdict is not overpowered by only
                    the data that happened to load. Missing risk-plan inputs such as invalidation, target, or risk budget are penalized more because
                    they directly affect downside control.
                  </p>
                </article>
                <article className="tone-positive">
                  <strong>What is being used in the verdict?</strong>
                  <p>
                    The score blends price/OHLCV, RSI, MACD, ATR, VWAP, Bollinger Bands, moving averages, trend, liquidity, candlestick patterns,
                    all 19 ratio cards, sales, EPS, CFO vs PAT, reserves, borrowings, cash flow, top company updates, portfolio weight, drawdown,
                    reward/risk, personal constraints, risk profile, and horizon-specific weights.
                  </p>
                </article>
              </div>
            </section>

            <CollapsibleSection
              className="adaptive-score-panel sub-panel nested-collapse"
              defaultOpen
              headingClassName="subsection-heading"
              headingLevel={3}
              id="adaptive-score-heading"
              title="Adaptive Hybrid Score"
            >
              <div className="component-score-grid">
                {analysis.scoreComponents.map((component) => (
                  <article className={`component-score-card tone-${component.tone}`} key={component.label}>
                    <div>
                      <span>{component.label}</span>
                      <strong>{component.score}/100</strong>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill score-fill" style={percentStyle(component.score)} />
                    </div>
                    <p>
                      Weight {Math.round(component.weight * 100)}%. {component.rationale}
                    </p>
                  </article>
                ))}
              </div>

              <CollapsibleSection
                className="signal-contribution-panel nested-collapse"
                headingClassName="subsection-heading"
                headingLevel={4}
                id="all-signal-contributions-heading"
                title="All Signal Contributions"
              >
                <div className="adaptive-signal-grid">
                  {analysis.adaptiveSignals.map((signal) => (
                    <article className={`adaptive-signal-card tone-${signal.tone}`} key={`${signal.group}-${signal.label}`}>
                      <span>{signal.group}</span>
                      <strong>{signal.label}</strong>
                      <small>{signal.value}</small>
                      <div className="signal-score-line">
                        <b>{signal.score}/100</b>
                        <em>Weight {signal.weight.toFixed(2)}</em>
                      </div>
                      <p>{signal.rationale}</p>
                    </article>
                  ))}
                </div>
              </CollapsibleSection>
            </CollapsibleSection>

            <div className="guidance-grid">
              <CollapsibleSection className="guidance-card do-card nested-collapse" headingClassName="subsection-heading" headingLevel={3} id="do-next-heading" title="Steps to Do Next">
                <ul>
                  {analysis.doItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                  {analysis.suggestedShares !== undefined && (
                    <li>
                      Suggested deployment: {formatNumber(analysis.suggestedShares)} shares, about {formatInr(analysis.suggestedDeployment)}.
                    </li>
                  )}
                </ul>
              </CollapsibleSection>
              <CollapsibleSection className="guidance-card dont-card nested-collapse" headingClassName="subsection-heading" headingLevel={3} id="dont-do-heading" title="What Not to Do">
                <ul>
                  {analysis.dontItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CollapsibleSection>
              <CollapsibleSection className="guidance-card why-card nested-collapse" headingClassName="subsection-heading" headingLevel={3} id="why-verdict-heading" title="Why This Verdict">
                <ul>
                  {analysis.whyItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CollapsibleSection>
            </div>

            <div className="verdict-columns">
              <CollapsibleSection className="sub-panel nested-collapse" headingClassName="subsection-heading" headingLevel={3} id="raw-action-heading" title="Raw Action Signals">
                <ul>
                  {analysis.actions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CollapsibleSection>
              <CollapsibleSection className="sub-panel nested-collapse" headingClassName="subsection-heading" headingLevel={3} id="cautions-heading" title="Cautions">
                <ul>
                  {analysis.cautions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CollapsibleSection>
            </div>

            {analysis.missing.length > 0 && (
              <div className="alerts">
                <p>Missing: {analysis.missing.join(', ')}</p>
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            className="parent-section technical-section"
            description="Price action, chart indicators, position economics, portfolio exposure, risk, liquidity, and setup quality."
            eyebrow="Technical analysis"
            headingClassName="section-heading collapsible-section-heading"
            id="technical-heading"
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
                  <div className="segmented chart-timeframes" aria-label="Chart timeframe">
                    {(Object.keys(chartTimeframes) as ChartTimeframe[]).map((timeframe) => (
                      <button
                        className={chartTimeframe === timeframe ? 'active' : ''}
                        key={timeframe}
                        type="button"
                        onClick={() => {
                          setChartTimeframe(timeframe)
                          setChartZoomLevel(1)
                          setChartWindowEnd(null)
                        }}
                      >
                        {chartTimeframes[timeframe].label}
                      </button>
                    ))}
                  </div>
                  <span className="chart-zoom-pill">{chartZoomLabel}</span>
                  <div className="indicator-switches" aria-label="Chart indicators">
                    {(Object.keys(indicatorLabels) as IndicatorKey[]).map((indicator) => (
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
                        <FieldLabel help={forecastHelp.mode}>Forecast type</FieldLabel>
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
                        <small>{forecastModeLabels[forecastSettings.mode].help}</small>
                      </label>
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
                  )}
                </div>

                <div className="chart-legend" aria-label="Chart legend">
                  <span>
                    <i className="legend-swatch up-swatch" />
                    Bullish candle
                  </span>
                  <span>
                    <i className="legend-swatch down-swatch" />
                    Bearish candle
                  </span>
                  {chartIndicators.sma20 && (
                    <span>
                      <i className="legend-line sma20-swatch" />
                      SMA 20
                    </span>
                  )}
                  {chartIndicators.sma50 && (
                    <span>
                      <i className="legend-line sma50-swatch" />
                      SMA 50
                    </span>
                  )}
                  {chartIndicators.sma100 && (
                    <span>
                      <i className="legend-line sma100-swatch" />
                      SMA 100
                    </span>
                  )}
                  {chartIndicators.sma200 && (
                    <span>
                      <i className="legend-line sma200-swatch" />
                      SMA 200
                    </span>
                  )}
                  {chartIndicators.ema20 && (
                    <span>
                      <i className="legend-line ema20-swatch" />
                      EMA 20
                    </span>
                  )}
                  {chartIndicators.ema50 && (
                    <span>
                      <i className="legend-line ema50-swatch" />
                      EMA 50
                    </span>
                  )}
                  {chartIndicators.vwap && (
                    <span>
                      <i className="legend-line vwap-swatch" />
                      VWAP
                    </span>
                  )}
                  {chartIndicators.bbands && (
                    <span>
                      <i className="legend-line bollinger-swatch" />
                      Bollinger
                    </span>
                  )}
                  {chartIndicators.volume && (
                    <span>
                      <i className="legend-swatch volume-swatch" />
                      Volume
                    </span>
                  )}
                  {chartIndicators.range && (
                    <span>
                      <i className="legend-line range-swatch" />
                      High/low range
                    </span>
                  )}
                  {forecastProjection && (
                    <span>
                      <i className="legend-line forecast-base-swatch" />
                      Base forecast
                    </span>
                  )}
                  {forecastProjection && (
                    <span>
                      <i className="legend-swatch forecast-band-swatch" />
                      Bear/bull range
                    </span>
                  )}
                  {chartIndicators.patterns && (
                    <span>
                      <i className="legend-swatch pattern-swatch bullish" />
                      Bullish pattern
                    </span>
                  )}
                  {chartIndicators.patterns && (
                    <span>
                      <i className="legend-swatch pattern-swatch bearish" />
                      Bearish pattern
                    </span>
                  )}
                  {chartIndicators.patterns && (
                    <span>
                      <i className="legend-swatch pattern-swatch neutral" />
                      Neutral pattern
                    </span>
                  )}
                </div>

                <div className="chart-shell" ref={setChartShellElement}>
                  <svg
                    className="candle-chart"
                    viewBox={`0 0 ${chartModel.width} ${chartModel.totalHeight}`}
                    role="img"
                    aria-label="Interactive daily candlestick chart"
                    onMouseMove={handleChartPointerMove}
                    onMouseOut={handleChartMouseOut}
                    onMouseLeave={() => setHoveredCandleIndex(null)}
                    onPointerLeave={() => setHoveredCandleIndex(null)}
                  >
                    {chartModel.candles.length ? (
                      <>
                        <text className="axis-title y-axis-title" transform={`translate(18 ${chartModel.priceHeight / 2}) rotate(-90)`}>
                          Price (INR)
                        </text>
                        <text className="axis-title volume-axis-title" x="16" y={chartModel.volumeBase - chartModel.volumeHeight - 5}>
                          Volume
                        </text>
                        <text className="axis-title x-axis-title" x={chartModel.plotLeft + chartModel.plotWidth / 2} y={chartModel.totalHeight - 7}>
                          Date
                        </text>
                        {chartModel.grid.map((line) => (
                          <g key={line.value}>
                            <line className="chart-grid-line" x1={chartModel.plotLeft} x2={chartModel.width - chartModel.plotRight} y1={line.y} y2={line.y} />
                            <text className="chart-axis-label price-axis-label" x={chartModel.width - 12} y={line.y - 4} textAnchor="end">
                              {formatNumber(line.value)}
                            </text>
                          </g>
                        ))}
                        {chartModel.xTicks.map((tick) => (
                          <g key={tick.date}>
                            <line className="chart-tick-line" x1={tick.x} x2={tick.x} y1={chartModel.volumeBase + 2} y2={chartModel.volumeBase + 10} />
                            <text className="chart-axis-label x-tick-label" x={tick.x} y={chartModel.volumeBase + 24}>
                              {tick.date.slice(5)}
                            </text>
                          </g>
                        ))}
                        {chartModel.forecast && (
                          <g className="forecast-layer">
                            <line className="forecast-separator" x1={chartModel.forecast.separatorX} x2={chartModel.forecast.separatorX} y1="0" y2={chartModel.volumeBase} />
                            {chartModel.forecast.bandPath && <path className="forecast-band" d={chartModel.forecast.bandPath} />}
                            {chartModel.forecast.lines.map((line) => {
                              const endPoint = line.points[line.points.length - 1]
                              return (
                                <g className={`forecast-case ${line.key}`} key={line.key}>
                                  <path d={line.path} />
                                  {line.points.slice(1).map((point) => (
                                    <circle key={`${line.key}-${point.label}`} cx={point.x} cy={point.y} r={line.key === 'base' ? 3.5 : 2.8} />
                                  ))}
                                  <text x={chartModel.width - 12} y={clamp(endPoint.y, 15, chartModel.priceHeight - 6)} textAnchor="end">
                                    {line.key === 'base' ? 'Base' : line.key === 'bull' ? 'Bull' : 'Bear'} {formatInr(endPoint.price)}
                                  </text>
                                </g>
                              )
                            })}
                            <text className="forecast-end-label" x={chartModel.width - 12} y={chartModel.volumeBase + 24} textAnchor="end">
                              {chartModel.forecast.endLabel}
                            </text>
                          </g>
                        )}
                        {chartIndicators.range && chartModel.highLine && (
                          <g>
                            <line className="range-guide high-guide" x1={chartModel.plotLeft} x2={chartModel.width - chartModel.plotRight} y1={chartModel.highLine.y} y2={chartModel.highLine.y} />
                            <text className="range-guide-label" x={chartModel.plotLeft + 6} y={chartModel.highLine.y - 5}>
                              High {formatInr(chartModel.highLine.value)}
                            </text>
                          </g>
                        )}
                        {chartIndicators.range && chartModel.lowLine && (
                          <g>
                            <line className="range-guide low-guide" x1={chartModel.plotLeft} x2={chartModel.width - chartModel.plotRight} y1={chartModel.lowLine.y} y2={chartModel.lowLine.y} />
                            <text className="range-guide-label" x={chartModel.plotLeft + 6} y={chartModel.lowLine.y + 14}>
                              Low {formatInr(chartModel.lowLine.value)}
                            </text>
                          </g>
                        )}
                        {chartIndicators.sma20 && chartModel.sma20Path && <path className="ma-line ma20" d={chartModel.sma20Path} />}
                        {chartIndicators.sma50 && chartModel.sma50Path && <path className="ma-line ma50" d={chartModel.sma50Path} />}
                        {chartIndicators.sma100 && chartModel.sma100Path && <path className="ma-line ma100" d={chartModel.sma100Path} />}
                        {chartIndicators.sma200 && chartModel.sma200Path && <path className="ma-line ma200" d={chartModel.sma200Path} />}
                        {chartIndicators.ema20 && chartModel.ema20Path && <path className="ma-line ema20" d={chartModel.ema20Path} />}
                        {chartIndicators.ema50 && chartModel.ema50Path && <path className="ma-line ema50" d={chartModel.ema50Path} />}
                        {chartIndicators.vwap && chartModel.vwapPath && <path className="ma-line vwap-line" d={chartModel.vwapPath} />}
                        {chartIndicators.bbands && chartModel.bbUpperPath && <path className="ma-line bollinger-line upper" d={chartModel.bbUpperPath} />}
                        {chartIndicators.bbands && chartModel.bbMiddlePath && <path className="ma-line bollinger-line middle" d={chartModel.bbMiddlePath} />}
                        {chartIndicators.bbands && chartModel.bbLowerPath && <path className="ma-line bollinger-line lower" d={chartModel.bbLowerPath} />}
                        {chartModel.candles.map((point, index) => (
                          <g className={point.up ? 'candle up-candle' : 'candle down-candle'} key={`${point.candle.date}-${index}`}>
                            <line x1={point.x} x2={point.x} y1={point.highY} y2={point.lowY} />
                            <rect
                              x={point.x - chartModel.candleWidth / 2}
                              y={point.bodyY}
                              width={chartModel.candleWidth}
                              height={point.bodyHeight}
                              rx="1.4"
                            />
                          </g>
                        ))}
                        {chartIndicators.patterns &&
                          recentPatternSignals.map((signal) => {
                            const point = chartModel.candles[signal.index]
                            if (!point) return null
                            const markerY =
                              signal.bias === 'bearish'
                                ? Math.max(point.highY - 13, 10)
                                : signal.bias === 'bullish'
                                  ? Math.min(point.lowY + 15, chartModel.priceHeight - 8)
                                  : clamp(point.closeY - 12, 10, chartModel.priceHeight - 8)
                            const markerText = signal.bias === 'bullish' ? 'B' : signal.bias === 'bearish' ? 'S' : 'N'
                            return (
                              <g className={`pattern-marker ${signal.bias}`} key={`${signal.name}-${signal.index}`}>
                                <title>{`${signal.name}: ${signal.action}`}</title>
                                <circle cx={point.x} cy={markerY} r="6" />
                                <text x={point.x} y={markerY + 3}>
                                  {markerText}
                                </text>
                              </g>
                            )
                          })}
                        {chartIndicators.volume &&
                          chartModel.candles.map((point, index) => (
                            <rect
                              className={point.up ? 'volume-bar up-volume' : 'volume-bar down-volume'}
                              key={`${point.candle.date}-volume-${index}`}
                              x={point.x - chartModel.candleWidth / 2}
                              y={point.volumeY}
                              width={chartModel.candleWidth}
                              height={point.volumeBarHeight}
                            />
                          ))}
                        <line className="volume-base" x1={chartModel.plotLeft} x2={chartModel.width - chartModel.plotRight} y1={chartModel.volumeBase} y2={chartModel.volumeBase} />
                        {hoveredChartPoint && (
                          <g>
                            <line className="crosshair" x1={hoveredChartPoint.x} x2={hoveredChartPoint.x} y1="0" y2={chartModel.volumeBase} />
                            <line className="crosshair horizontal" x1={chartModel.plotLeft} x2={chartModel.width - chartModel.plotRight} y1={hoveredChartPoint.closeY} y2={hoveredChartPoint.closeY} />
                            <circle className="crosshair-dot" cx={hoveredChartPoint.x} cy={hoveredChartPoint.closeY} r="4" />
                            <g className="chart-hover-card" transform={`translate(${hoverTooltipX} ${hoverTooltipY})`}>
                              <rect width="220" height="136" rx="7" />
                              <text x="10" y="18">
                                {hoveredCandle?.date}
                              </text>
                              <text x="10" y="36">
                                O {formatInr(hoveredCandle?.open)}  H {formatInr(hoveredCandle?.high)}
                              </text>
                              <text x="10" y="54">
                                L {formatInr(hoveredCandle?.low)}  C {formatInr(hoveredCandle?.close)}
                              </text>
                              <text x="10" y="72">
                                Vol {formatNumber(hoveredCandle?.volume)}
                              </text>
                              <text x="10" y="90">
                                SMA20 {formatInr(hoveredChartPoint.sma20)}  EMA20 {formatInr(hoveredChartPoint.ema20)}
                              </text>
                              <text x="10" y="108">
                                SMA50 {formatInr(hoveredChartPoint.sma50)}  VWAP {formatInr(hoveredChartPoint.vwap)}
                              </text>
                              <text x="10" y="126">
                                RSI {formatNumber(hoveredChartPoint.rsi)}  MACD {formatNumber(hoveredChartPoint.macd)}
                              </text>
                            </g>
                          </g>
                        )}
                      </>
                    ) : (
                      <text className="chart-empty" x="24" y="155">
                        Refresh EOD data to draw candles
                      </text>
                    )}
                  </svg>
                </div>

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
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                        <p>{item.text}</p>
                      </article>
                    ))}
                  </div>
                )}

                {chartIndicators.patterns && (
                  <CollapsibleSection
                    className="pattern-findings-panel nested-collapse"
                    eyebrow="Pattern findings"
                    headingClassName="subsection-heading"
                    headingLevel={4}
                    id="pattern-findings-heading"
                    title="Detected Patterns and How to Use Them"
                  >
                    {patternFindings.length ? (
                      <div className="pattern-findings-list">
                        {patternFindings.map((signal) => (
                          <article className={`pattern-finding ${signal.bias}`} key={`${signal.name}-${signal.index}-finding`}>
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
                        ))}
                      </div>
                    ) : (
                      <p className="pattern-empty">No recent single or multi-candle pattern was detected in this timeframe and zoom window.</p>
                    )}
                  </CollapsibleSection>
                )}

                <CollapsibleSection
                  className="chart-guide nested-collapse"
                  eyebrow="Help guide"
                  headingClassName="subsection-heading"
                  headingLevel={4}
                  id="chart-guide-heading"
                  title="How to Read This Chart for Non-Intraday Trading"
                >
                  <div className="chart-guide-grid">
                    {chartGuideSections.map((section) => (
                      <article key={section.title}>
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
                    ))}
                  </div>
                </CollapsibleSection>
                <p className="caption">
                  Caption: use the timeframe and indicator buttons like a lightweight Kite chart. Hover over candles to inspect OHLC and volume; this is delayed EOD data, so it supports non-intraday analysis rather than live execution.
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
                <div className="visual-grid subsection-card-grid">
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
                <p className="caption">Caption: the line shows recent daily closes. A rising line supports momentum; a falling line warns that the market is still marking the stock down.</p>
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
                <p className="caption">Caption: if the current bar is much shorter than invested capital, recovering to your average price requires a large move, so averaging down becomes riskier.</p>
              </article>

              <article className={`visual-card exposure-card tone-${portfolioWeightTone}`}>
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Portfolio exposure</span>
                    <h3>Concentration</h3>
                  </div>
                  <strong>{formatPercent(analysis.portfolioWeight)}</strong>
                </div>
                <div className="donut-wrap">
                  <div className="donut" style={percentStyle(analysis.portfolioWeight, '--weight')}>
                    <span>{formatPercent(analysis.portfolioWeight)}</span>
                  </div>
                  <div>
                    <p>One-stock weight in the loaded portfolio.</p>
                    <p className="caption">Caption: higher concentration means one company-specific mistake can hurt the full portfolio, even if the broad market is fine.</p>
                  </div>
                </div>
              </article>

              <article className={`visual-card tone-${riskSetupTone}`}>
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Risk plan</span>
                    <h3>Size and Reward</h3>
                  </div>
                  <strong>{formatInr(analysis.riskCapital)}</strong>
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
                    {formatNumber(analysis.suggestedShares)}
                  </span>
                  <span className={`tone-${riskSetupTone}`}>
                    <b>Reward/risk</b>
                    {rewardRisk === undefined ? '-' : `${rewardRisk.toFixed(1)}x`}
                  </span>
                </div>
                <div className="bar-track score-track">
                  <div className="bar-fill score-fill" style={percentStyle(analysis.score)} />
                </div>
                <p className="caption">Caption: risk sizing uses the maximum rupee loss you allow. Without an invalidation price, the app cannot calculate a clean position size.</p>
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
                <p className="caption">Caption: the marker shows where the current price sits inside the recent range. Thin volume makes exits harder and increases slippage risk.</p>
              </article>

              <article className={`visual-card quality-story tone-${confidenceTone}`}>
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Business filters</span>
                    <h3>Quality Checklist</h3>
                  </div>
                  <strong>{analysis.confidenceLabel}</strong>
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
                <p className="caption">Caption: these filters explain the business side of the score. Missing fundamentals lower confidence because price alone cannot prove quality.</p>
              </article>
                </div>
              </CollapsibleSection>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            className="parent-section fundamental-section"
            description="Company profile, ratios, statement summaries, important updates, business quality, and due-diligence checks."
            eyebrow="Fundamental analysis"
            headingClassName="section-heading collapsible-section-heading"
            id="fundamental-heading"
            title="Fundamental Analysis"
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
                description="Business profile, valuation ratios, balance-sheet clues, cash-flow clues, and recent exchange/company updates."
                headingClassName="subsection-heading"
                headingLevel={3}
                id="fundamental-company-heading"
                title="Company Snapshot, Evidence, and Updates"
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
                  Caption: this explains what business the ticker represents. A verdict is weaker when the business model, industry, and source data are missing or unclear.
                </p>
              </article>

              <article className="visual-card company-ratio-card">
                <div className="visual-card-heading refined-heading">
                  <div>
                    <span className="mini-label">Fundamental evidence</span>
                    <h3>Valuation, Profitability, Debt, Cash</h3>
                    <p className="heading-subtext">Synced ratios are quick evidence; final decisions still need filings, peers, and history.</p>
                  </div>
                  <strong>{activeFundamentals ? `${companyRatioFacts.filter((fact) => fact.value !== '-').length}/${companyRatioFacts.length}` : '0'}</strong>
                </div>
                <div className="company-ratio-grid">
                  {companyRatioFacts.map((fact) => (
                    <div className={`company-ratio tone-${fact.tone}`} key={fact.label}>
                      <span>{fact.label}</span>
                      <strong>{fact.value}</strong>
                      <small>{fact.helper}</small>
                    </div>
                  ))}
                </div>
                <p className="caption">
                  Caption: read ratios in groups. Cheap valuation with weak cash flow can be a trap; high valuation with strong growth can still be risky if expectations are already priced in.
                </p>
              </article>

              <article className="visual-card company-updates-card">
                <div className="visual-card-heading refined-heading">
                  <div>
                    <span className="mini-label">Company updates</span>
                    <h3>Top 3 Important Updates</h3>
                    <p className="heading-subtext">Fetched from recent exchange announcements through Screener. Treat as a triage feed, then read the filing.</p>
                  </div>
                  <strong>{companyUpdates.length ? `${companyUpdates.length}/3` : 'Needed'}</strong>
                </div>
                {companyUpdates.length ? (
                  <div className="company-updates-list">
                    {companyUpdates.map((update) => (
                      <article className={`company-update tone-${update.tone ?? 'neutral'}`} key={`${update.title}-${update.date ?? ''}`}>
                        <div>
                          <span>{update.category ?? 'Exchange filing'}</span>
                          <strong>{update.title}</strong>
                          {update.date && <small>{update.date}</small>}
                        </div>
                        <p>{update.summary || 'Open the filing and verify the details before changing position size.'}</p>
                        {update.url && (
                          <a href={update.url} target="_blank" rel="noreferrer">
                            Open filing
                          </a>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="company-summary">
                    No recent update feed is loaded yet. Click Sync Market Data after restarting the local data server so the app can fetch recent exchange announcements.
                  </p>
                )}
                <p className="caption">Caption: this is not a news recommendation engine. It surfaces filings likely to matter: earnings, leadership, orders, corporate actions, and risk disclosures.</p>
              </article>
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                className="sub-panel nested-collapse analysis-subsection"
                description="Business-quality score, statement flow, and due-diligence checks adapted from the Varsity fundamental-analysis process."
                headingClassName="subsection-heading"
                headingLevel={3}
                id="fundamental-quality-heading"
                title="Financial Quality and Due Diligence"
              >
                <div className="visual-grid subsection-card-grid fundamental-subgrid fundamental-quality-grid">
              <article className={`visual-card fundamental-score-card tone-${fundamentalScore >= 70 ? 'positive' : fundamentalScore < 40 ? 'negative' : 'neutral'}`}>
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Fundamental analysis</span>
                    <h3>Business Quality Wheel</h3>
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
                      <p>{pillar.caption}</p>
                    </div>
                  ))}
                </div>
                <p className="caption">Caption: this is a process-quality view, not a valuation target. Missing evidence is deliberately scored low until reports or trusted data are added.</p>
              </article>

              <article className="visual-card fundamental-flow-card">
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Financial statements</span>
                    <h3>P&L to Intrinsic Value Flow</h3>
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
                <p className="caption">Caption: Module 3 links all three statements. Good fundamentals should show up in profits, balance-sheet strength, cash generation, and valuation discipline.</p>
              </article>

              <article className="visual-card fundamental-checklist-card">
                <div className="visual-card-heading">
                  <div>
                    <span className="mini-label">Due diligence</span>
                    <h3>Annual Report Checklist</h3>
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
                <p className="caption">Caption: before adding capital, fill these evidence gaps from the annual report, quarterly results, exchange filings, and a peer comparison.</p>
              </article>
                </div>
              </CollapsibleSection>
            </div>
          </CollapsibleSection>

          <section className="reasoning-grid lower-grid">
            <CollapsibleSection className="panel parent-section reasoning-parent" eyebrow="Reasoning trace" id="steps-heading" title="Agent Reasoning">

              <div className="steps-list detailed-steps">
                {analysis.steps.map((step, index) => (
                  <article className="reasoning-step" key={step.title}>
                    <div className="reasoning-step-header">
                      <span className="reasoning-index">{index + 1}</span>
                      <h3>{step.title.replace(/^\d+\.\s*/, '')}</h3>
                    </div>
                    <p className="plain-english">{step.plainEnglish}</p>
                    <div className="formula-box">
                      <span>Formula or rule used</span>
                      <p>{step.formula}</p>
                    </div>
                    <p>
                      <strong>Rationale:</strong> {step.rationale}
                    </p>
                    <p className="takeaway">
                      <strong>Takeaway:</strong> {step.takeaway}
                    </p>
                  </article>
                ))}
              </div>

              <div className="signal-grid">
                <CollapsibleSection className="sub-panel nested-collapse" headingClassName="subsection-heading" headingLevel={3} id="positive-signals-heading" title="Positive Signals">
                  <ul>
                    {analysis.positives.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </CollapsibleSection>
                <CollapsibleSection className="sub-panel nested-collapse" headingClassName="subsection-heading" headingLevel={3} id="data-source-heading" title="Data Source">
                  <p>
                    {providerLabel(activeSnapshot.provider)} at {cacheAge(activeSnapshot.generated_at)} old. Matched key: {analysis.quoteKey}.
                  </p>
                </CollapsibleSection>
              </div>
            </CollapsibleSection>
          </section>
        </>
      ) : (
        <>
          <CollapsibleSection
            action={
              <div className="data-action-row">
                <button type="button" onClick={refreshFreeData} disabled={freeRefreshState === 'refreshing' || serverRestartState === 'restarting'}>
                  {freeRefreshState === 'refreshing' ? 'Syncing...' : 'Sync Market Data'}
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={restartFreeDataServer}
                  disabled={freeRefreshState === 'refreshing' || serverRestartState === 'restarting'}
                >
                  {serverRestartState === 'restarting' ? 'Restarting...' : 'Restart Server'}
                  <HelpTip text={optionalHelp.serverRestart} />
                </button>
              </div>
            }
            className="panel command-panel data-first-panel"
            eyebrow="One button"
            id="command-heading"
            title="Market Data Sync"
          >

            <label className="field">
              Symbols
              <textarea value={symbols} onChange={(event) => setSymbols(event.target.value)} />
            </label>
            <div className="inline-fields">
              <label className="field">
                Candle days
                <input
                  min="30"
                  max="3000"
                  step="30"
                  type="number"
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value))}
                />
              </label>
              <label className="toggle-field">
                <input
                  checked={includeHoldingsInSync}
                  disabled={!hasUploadedHoldingsFeed}
                  type="checkbox"
                  onChange={(event) => setIncludeHoldings(event.target.checked)}
                />
                <span className="toggle-copy">
                  Holdings
                  <HelpTip text={optionalHelp.holdingsRefresh} />
                </span>
              </label>
            </div>
            {freeRefreshMessage && (
              <div className={`refresh-message ${freeRefreshState}`}>
                <p>{freeRefreshMessage}</p>
              </div>
            )}
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
            {syncCoverage && (freeRefreshState === 'done' || uploadState === 'done') && <SyncCoveragePanel coverage={syncCoverage} />}
            {serverRestartMessage && (
              <div className={`refresh-message ${serverRestartState === 'restarting' ? 'uploading' : serverRestartState}`}>
                <p>{serverRestartMessage}</p>
              </div>
            )}
            <div className="command-stack">
              <div className="command-row">
                <code>{freeServerCommand}</code>
                <button type="button" onClick={() => copyCommand('free-server', freeServerCommand)}>
                  {copied === 'free-server' ? 'Copied' : 'Copy server'}
                </button>
              </div>
              <div className="command-row">
                <code>{freeCliCommand}</code>
                <button type="button" onClick={() => copyCommand('free-cli', freeCliCommand)}>
                  {copied === 'free-cli' ? 'Copied' : 'Copy CLI'}
                </button>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            action={
              <span className={`status-dot ${uploadState === 'error' ? 'warning' : 'ready'}`}>
                {uploadState === 'uploading' ? 'Uploading' : hasUploadedHoldingsFeed ? 'Loaded' : uploadState === 'error' ? 'Check' : 'Local only'}
              </span>
            }
            className="panel upload-panel"
            eyebrow="Portfolio import"
            id="upload-heading"
            title="Upload Holdings XLSX"
          >
            <div className="upload-grid">
              {hasUploadedHoldingsFeed && (
                <div className="loaded-upload-card">
                  <div>
                    <span>Loaded holdings feed</span>
                    <strong>{loadedHoldingsFilename}</strong>
                    <p>
                      {loadedHoldingsCount} holdings are active in this browser. Remove this feed before uploading another XLSX.
                    </p>
                  </div>
                  <button
                    className="secondary-action danger-action"
                    type="button"
                    onClick={() => {
                      void removeUploadedHoldingsFeed()
                    }}
                  >
                    Remove feed
                  </button>
                </div>
              )}
              <label className="field">
                Zerodha holdings report
                <input
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={hasUploadedHoldingsFeed || uploadState === 'uploading'}
                  key={hasUploadedHoldingsFeed ? 'holdings-loaded' : 'holdings-ready'}
                  type="file"
                  onChange={(event) => {
                    void uploadHoldingsReport(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
                {hasUploadedHoldingsFeed && <span className="field-note">Remove the loaded feed to choose a replacement file.</span>}
              </label>
              <div className={`refresh-message ${uploadState}`}>
                <p>
                  {uploadMessage ||
                    'Choose the holdings XLSX export. The app parses it locally, updates the portfolio table, and refreshes delayed EOD prices.'}
                </p>
              </div>
            </div>
          </CollapsibleSection>

          <section className="data-grid">
            <CollapsibleSection className="panel table-panel" defaultOpen eyebrow="Portfolio" id="holdings-heading" title="Holdings Feed">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Holding</th>
                      <th>Qty</th>
                      <th>Avg</th>
                      <th>LTP</th>
                      <th>Value</th>
                      <th>P&L</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSnapshot.holdings.map((holding) => {
                      const canAnalyze = ['NSE', 'BSE'].includes(String(holding.exchange ?? '').toUpperCase())
                      return (
                        <tr key={`${holding.exchange}:${holding.tradingsymbol}`}>
                          <td>
                            {holding.exchange}:{holding.tradingsymbol}
                          </td>
                          <td>{formatNumber(holding.quantity)}</td>
                          <td>{formatInr(holding.average_price)}</td>
                          <td>{formatInr(holding.last_price)}</td>
                          <td>{formatInr(holdingValue(holding))}</td>
                          <td className={(holding.pnl ?? 0) >= 0 ? 'positive' : 'negative'}>{formatInr(holding.pnl)}</td>
                          <td>
                            <button
                              className="table-button"
                              disabled={!canAnalyze}
                              title={canAnalyze ? undefined : 'Unlisted holdings need a valid NSE or BSE symbol before analysis.'}
                              type="button"
                              onClick={() => analyzeHolding(holding)}
                            >
                              Analyze
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>

            <CollapsibleSection className="panel table-panel" defaultOpen eyebrow="Quotes" id="quotes-heading" title="Latest Market Data">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>LTP</th>
                      <th>Prev Close</th>
                      <th>Change</th>
                      <th>Volume</th>
                      <th>Candles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quoteRows.map((quote) => (
                      <tr key={quote.symbol}>
                        <td>{quote.symbol}</td>
                        <td>{formatInr(quote.last_price)}</td>
                        <td>{formatInr(quote.ohlc?.close)}</td>
                        <td className={(quote.changePct ?? 0) >= 0 ? 'positive' : 'negative'}>{formatPercent(quote.changePct)}</td>
                        <td>{formatNumber(quote.volume)}</td>
                        <td>{quote.candleCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          </section>

          <CollapsibleSection className="panel portfolio-metrics-panel" eyebrow="Portfolio metrics" id="portfolio-metrics-heading" title="Snapshot Summary">
            <section className="metric-grid" aria-label="Portfolio metrics">
              <div className="metric">
                <span>Snapshot</span>
                <strong>{providerLabel(activeSnapshot.provider)}</strong>
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
          </CollapsibleSection>

          <section className="data-grid support-grid">
            <CollapsibleSection className="panel sharing-panel" eyebrow="Sharing" id="sharing-heading" title="HTTPS and Peer Access">
              <p className="footer-note">
                For a public HTTPS link, deploy the production build in <code>react-day1/dist</code> to Vercel, Netlify, or Cloudflare Pages.
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
                  <code>{lanServerCommand}</code>
                  <button type="button" onClick={() => copyCommand('lan-server', lanServerCommand)}>
                    {copied === 'lan-server' ? 'Copied' : 'Copy data LAN'}
                  </button>
                </div>
                <div className="command-row">
                  <code>{publicAppCommand}</code>
                  <button type="button" onClick={() => copyCommand('public-preview', publicAppCommand)}>
                    {copied === 'public-preview' ? 'Copied' : 'Copy preview'}
                  </button>
                </div>
              </div>
              <div className="alerts">
                <p>
                  Public sharing should use a hosted HTTPS build. If the data bridge is public too, start it with
                  <code> --allow-origin https://your-app-url</code> and set <code>VITE_MARKET_DATA_BASE_URL</code> to that HTTPS bridge URL before building.
                </p>
                <p>
                  Be careful: uploaded holdings and cached portfolio data are personal financial data. For peers, prefer a read-only hosted build
                  with sample/watchlist data unless you explicitly want them to see your portfolio.
                </p>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              action={
                <span className={`status-dot ${freeRefreshState === 'error' ? 'warning' : 'ready'}`}>
                  {freeRefreshState === 'refreshing' ? 'Syncing' : freeRefreshState === 'error' ? 'Check server' : 'No API key'}
                </span>
              }
              className="panel setup-panel"
              eyebrow="Provider"
              id="setup-heading"
              title="Delayed Market Data"
            >

              <div className="steps">
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
            </CollapsibleSection>

            <CollapsibleSection className="panel footer-panel" eyebrow="Data sync" headingClassName="panel-heading compact-heading" id="connection-checklist-heading" title="Local Sync Requirements">
              <div className="command-row">
                <code>{freeServerCommand}</code>
                <button type="button" onClick={() => copyCommand('footer-server', freeServerCommand)}>
                  {copied === 'footer-server' ? 'Copied' : 'Copy server'}
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
              {activeSnapshot.errors.length > 0 && (
                <div className="alerts">
                  {activeSnapshot.errors.map((error) => (
                    <p key={error}>{error}</p>
                  ))}
                </div>
              )}
            </CollapsibleSection>
          </section>
        </>
      )}
    </main>
  )
}

export default App
