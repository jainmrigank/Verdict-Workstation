export type LlmTone = 'positive' | 'negative' | 'neutral'

export type LlmNarrativeItem = {
  title?: string
  text: string
  tone: LlmTone
  factRefs: string[]
  ruleRefs: string[]
}

export type LlmReasoningStep = LlmNarrativeItem & {
  evidence: string
  implication: string
  action: string
}

export type LlmSource = {
  id: string
  module: string
  chapter?: string
  pages?: string
  sourceUrl?: string
}

export type LlmAnalysis = {
  schemaVersion: 'llm-analysis.v1'
  contextFingerprint: string
  decision: {
    summary: string
    nextActions: LlmNarrativeItem[]
    avoid: LlmNarrativeItem[]
    priceDrivers: LlmNarrativeItem[]
    risks: LlmNarrativeItem[]
    dataGaps: LlmNarrativeItem[]
  }
  chart: {
    summary: string
    trend: LlmNarrativeItem[]
    momentum: LlmNarrativeItem[]
    volume: LlmNarrativeItem[]
    volatility: LlmNarrativeItem[]
    levels: LlmNarrativeItem[]
    patterns: LlmNarrativeItem[]
  }
  company: {
    summary: string
    businessModel: LlmNarrativeItem[]
    quality: LlmNarrativeItem[]
    profitability: LlmNarrativeItem[]
    balanceSheet: LlmNarrativeItem[]
    cashFlow: LlmNarrativeItem[]
    valuation: LlmNarrativeItem[]
    sectorDrivers: LlmNarrativeItem[]
    catalysts: LlmNarrativeItem[]
    risks: LlmNarrativeItem[]
    dataGaps: LlmNarrativeItem[]
  }
  portfolio: {
    summary: string
    positionFit: LlmNarrativeItem[]
    concentration: LlmNarrativeItem[]
    sizing: LlmNarrativeItem[]
    holdingActions: LlmNarrativeItem[]
    risks: LlmNarrativeItem[]
  }
  reasoning: {
    steps: LlmReasoningStep[]
  }
  coach: {
    verdictSummary: string
    chartSummary: string
    companySummary: string
    questionsBeforeAction: LlmNarrativeItem[]
  }
  sources: LlmSource[]
  warnings: string[]
}

export type LlmAnalysisResponse = {
  ok?: boolean
  configured?: boolean
  cached?: boolean
  model?: string
  generated_at?: string
  message?: string
  setup?: string[]
  analysis?: LlmAnalysis
  error?: string
}

export function narrativeTexts(items?: LlmNarrativeItem[]) {
  return (items ?? []).map((item) => item.text.trim()).filter(Boolean)
}
