import { describe, expect, it } from 'vitest'
import {
  buildAnalysis,
  defaultRiskPercentForProfile,
  formatInr,
  formatPercent,
  initialForm,
  mergeRefreshedSnapshot,
  normaliseBridgeSession,
  starterSnapshot,
  toneFromScore,
  type AnalysisForm,
  type Snapshot,
} from '../App'

describe('normaliseBridgeSession', () => {
  it('converts server epoch seconds to browser epoch milliseconds', () => {
    expect(normaliseBridgeSession('token', 1_783_754_974)).toEqual({
      token: 'token',
      expiresAt: 1_783_754_974_000,
    })
  })

  it('keeps an already-normalised millisecond expiry unchanged', () => {
    expect(normaliseBridgeSession('token', 1_783_754_974_000).expiresAt).toBe(1_783_754_974_000)
  })
})

describe('formatInr', () => {
  it('formats a positive rupee amount with the currency symbol', () => {
    expect(formatInr(1500)).toBe('₹1,500')
  })

  it('returns a dash for undefined values', () => {
    expect(formatInr(undefined)).toBe('-')
  })

  it('shows two decimal places for small values under 100', () => {
    expect(formatInr(45.5)).toBe('₹45.50')
  })
})

describe('formatPercent', () => {
  it('prefixes positive values with a plus sign', () => {
    expect(formatPercent(7.14)).toBe('+7.14%')
  })

  it('does not prefix negative values with an extra sign', () => {
    expect(formatPercent(-3.2)).toBe('-3.20%')
  })

  it('returns a dash for undefined', () => {
    expect(formatPercent(undefined)).toBe('-')
  })
})

describe('toneFromScore', () => {
  it('treats 62 and above as positive', () => {
    expect(toneFromScore(62)).toBe('positive')
    expect(toneFromScore(90)).toBe('positive')
  })

  it('treats 42 and below as negative', () => {
    expect(toneFromScore(42)).toBe('negative')
    expect(toneFromScore(0)).toBe('negative')
  })

  it('treats the middle band as neutral', () => {
    expect(toneFromScore(50)).toBe('neutral')
  })
})

describe('defaultRiskPercentForProfile', () => {
  it('increases with more aggressive risk profiles', () => {
    const conservative = defaultRiskPercentForProfile('conservative')
    const balanced = defaultRiskPercentForProfile('balanced')
    const aggressive = defaultRiskPercentForProfile('aggressive')
    expect(conservative).toBeLessThanOrEqual(balanced)
    expect(balanced).toBeLessThanOrEqual(aggressive)
  })
})

describe('buildAnalysis', () => {
  it('returns Needs Input with no capital deployed for a completely empty form', () => {
    const result = buildAnalysis(initialForm, starterSnapshot, 'sample')
    expect(result.verdict).toBe('Needs Input')
    expect(result.verdictClass).toBe('needs-data')
    expect(result.score).toBe(0)
    expect(result.decisionMode).toBe('fresh-entry')
  })

  it('lists the missing required fields so the UI can explain the gap', () => {
    const result = buildAnalysis(initialForm, starterSnapshot, 'sample')
    expect(result.missing.length).toBeGreaterThan(0)
  })

  it('computes a real quantity plan and risk budget once ticker, capital, and prices are provided', () => {
    const filledForm: AnalysisForm = {
      ...initialForm,
      ticker: 'RELIANCE',
      exchange: 'NSE',
      capital: '100000',
      manualLtp: '1350',
      invalidationPrice: '1250',
      targetPrice: '1600',
    }
    const result = buildAnalysis(filledForm, starterSnapshot, 'sample')

    // With capital, an LTP, and an exit line, the app should move off the
    // zero-score Needs Input baseline and produce a sized quantity plan.
    expect(result.verdict).not.toBe('Needs Input')
    expect(result.riskCapital).toBeGreaterThan(0)
    expect(result.ltp).toBe(1350)
  })

  it('treats the Sell action as a holding-review decision, not a fresh entry', () => {
    const holdingForm: AnalysisForm = {
      ...initialForm,
      ticker: 'INFY',
      exchange: 'NSE',
      // The UI's Sell action maps to the existing internal holding-review flag.
      alreadyHold: true,
      quantity: '50',
      averagePrice: '1400',
      manualLtp: '1500',
    }
    const result = buildAnalysis(holdingForm, starterSnapshot, 'sample')

    expect(result.decisionMode).toBe('holding-review')
    expect(result.positionPnl).toBeGreaterThan(0)
  })

  it('keeps uploaded portfolio holdings when a later sync returns holdings without upload metadata', () => {
    const previousSnapshot: Snapshot = {
      ...starterSnapshot,
      provider: 'free_upload',
      generated_at: '2026-07-10T00:00:00.000Z',
      symbols: [
        {
          exchange: 'NSE',
          input: 'NSE:ABC',
          kite_key: 'NSE:ABC',
          tradingsymbol: 'ABC',
        },
      ],
      quotes: {
        'NSE:ABC': { last_price: 100 },
      },
      candles: {
        'NSE:ABC': [{ date: '2026-07-09', open: 95, high: 101, low: 94, close: 100, volume: 1000 }],
      },
      fundamentals: {},
      holdings: [{ exchange: 'NSE', tradingsymbol: 'ABC', quantity: 10, average_price: 90, last_price: 100, pnl: 100 }],
      upload: {
        filename: 'holdings.xlsx',
        holdings_count: 1,
        symbols: ['NSE:ABC'],
      },
    }
    const refreshedSnapshot: Snapshot = {
      ...starterSnapshot,
      provider: 'free_refresh',
      generated_at: '2026-07-10T01:00:00.000Z',
      symbols: previousSnapshot.symbols,
      quotes: {
        'NSE:ABC': { last_price: 110 },
      },
      candles: {
        'NSE:ABC': [{ date: '2026-07-10', open: 102, high: 112, low: 101, close: 110, volume: 1200 }],
      },
      fundamentals: {},
      holdings: [{ exchange: 'NSE', tradingsymbol: 'ABC', quantity: 10, average_price: 90 }],
    }

    const merged = mergeRefreshedSnapshot(refreshedSnapshot, previousSnapshot).snapshot

    expect(merged.upload).toEqual(previousSnapshot.upload)
    expect(merged.holdings).toHaveLength(1)
    expect(merged.holdings[0].last_price).toBe(110)
    expect(merged.holdings[0].pnl).toBe(200)
  })
})
