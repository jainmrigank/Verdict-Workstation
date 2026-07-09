import { useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  type IChartApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type WhitespaceData,
} from 'lightweight-charts'

export type ChartCandle = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type ChartIndicatorToggles = {
  volume: boolean
  range: boolean
  patterns: boolean
  sma20: boolean
  sma50: boolean
  sma100: boolean
  sma200: boolean
  ema20: boolean
  ema50: boolean
  vwap: boolean
  bbands: boolean
  rsi: boolean
  macd: boolean
  atr: boolean
}

export type ChartPatternMarker = {
  date: string
  bias: 'bullish' | 'bearish' | 'neutral'
  name: string
}

export type ChartForecast = {
  tradingDays: number
  horizonLabel: string
  cases: {
    key: string
    points: { progress: number; price: number; label: string }[]
  }[]
}

/* ---- indicator math (pure, chart-local) ---------------------------------- */

function sma(values: number[], period: number) {
  const out: (number | undefined)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    out.push(i >= period - 1 ? sum / period : undefined)
  }
  return out
}

function ema(values: number[], period: number) {
  const out: (number | undefined)[] = []
  const k = 2 / (period + 1)
  let prev: number | undefined
  for (let i = 0; i < values.length; i += 1) {
    prev = prev === undefined ? values[i] : values[i] * k + prev * (1 - k)
    out.push(i >= period - 1 ? prev : undefined)
  }
  return out
}

function vwapSeries(candles: ChartCandle[]) {
  let cumulativePV = 0
  let cumulativeVolume = 0
  return candles.map((candle) => {
    const typical = (candle.high + candle.low + candle.close) / 3
    cumulativePV += typical * candle.volume
    cumulativeVolume += candle.volume
    return cumulativeVolume ? cumulativePV / cumulativeVolume : undefined
  })
}

function bollinger(candles: ChartCandle[], period = 20, mult = 2) {
  const closes = candles.map((candle) => candle.close)
  const middle = sma(closes, period)
  const upper: (number | undefined)[] = []
  const lower: (number | undefined)[] = []
  for (let i = 0; i < closes.length; i += 1) {
    const mid = middle[i]
    if (mid === undefined) {
      upper.push(undefined)
      lower.push(undefined)
      continue
    }
    const window = closes.slice(i - period + 1, i + 1)
    const variance = window.reduce((acc, value) => acc + (value - mid) ** 2, 0) / period
    const sd = Math.sqrt(variance)
    upper.push(mid + mult * sd)
    lower.push(mid - mult * sd)
  }
  return { upper, middle, lower }
}

function rsiSeries(candles: ChartCandle[], period = 14) {
  const out: (number | undefined)[] = []
  let avgGain = 0
  let avgLoss = 0
  for (let i = 0; i < candles.length; i += 1) {
    if (i === 0) {
      out.push(undefined)
      continue
    }
    const change = candles[i].close - candles[i - 1].close
    const gain = Math.max(change, 0)
    const loss = Math.max(-change, 0)
    if (i <= period) {
      avgGain += gain / period
      avgLoss += loss / period
      out.push(i === period ? 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss)) : undefined)
      continue
    }
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out.push(100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss)))
  }
  return out
}

function macdSeries(candles: ChartCandle[]) {
  const closes = candles.map((candle) => candle.close)
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const macd = closes.map((_, i) => (ema12[i] !== undefined && ema26[i] !== undefined ? (ema12[i] as number) - (ema26[i] as number) : undefined))
  const definedMacd = macd.map((value) => value ?? 0)
  const signalRaw = ema(definedMacd, 9)
  const signal = macd.map((value, i) => (value === undefined ? undefined : signalRaw[i]))
  const histogram = macd.map((value, i) => (value !== undefined && signal[i] !== undefined ? value - (signal[i] as number) : undefined))
  return { macd, signal, histogram }
}

function atrSeries(candles: ChartCandle[], period = 14) {
  const out: (number | undefined)[] = []
  let prevAtr: number | undefined
  for (let i = 0; i < candles.length; i += 1) {
    if (i === 0) {
      out.push(undefined)
      continue
    }
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    )
    prevAtr = prevAtr === undefined ? tr : (prevAtr * (period - 1) + tr) / period
    out.push(i >= period ? prevAtr : undefined)
  }
  return out
}

function toLineData(candles: ChartCandle[], values: (number | undefined)[]): LineData<Time>[] {
  const out: LineData<Time>[] = []
  values.forEach((value, index) => {
    if (value !== undefined && Number.isFinite(value)) out.push({ time: candles[index].date as Time, value })
  })
  return out
}

function futureDate(lastDate: string, tradingDaysAhead: number) {
  const date = new Date(`${lastDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + Math.max(1, Math.round(tradingDaysAhead * 1.45)))
  return date.toISOString().slice(0, 10)
}

function cssVar(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/* ---- component ------------------------------------------------------------ */

export function PriceChart({
  candles,
  forecast,
  indicators,
  patterns,
  symbol,
}: {
  candles: ChartCandle[]
  forecast?: ChartForecast
  indicators: ChartIndicatorToggles
  patterns: ChartPatternMarker[]
  symbol: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const [legend, setLegend] = useState<{
    date: string
    open: number
    high: number
    low: number
    close: number
    changePct: number
    volume?: number
  } | null>(null)
  const [themeVersion, setThemeVersion] = useState(0)

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((current) => current + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const subPanes = (indicators.rsi ? 1 : 0) + (indicators.macd ? 1 : 0) + (indicators.atr ? 1 : 0)
  const chartHeight = 360 + subPanes * 96

  useEffect(() => {
    const container = containerRef.current
    if (!container || !candles.length) return undefined

    const positive = cssVar('--positive', '#43b581')
    const negative = cssVar('--negative', '#ef6e63')
    const accent = cssVar('--accent', '#e78d5f')
    const warning = cssVar('--warning', '#d9a545')
    const textSecondary = cssVar('--text-secondary', '#9aa3ae')
    const textMuted = cssVar('--text-muted', '#6a7482')
    const border = cssVar('--border-strong', 'rgba(233, 239, 246, 0.14)')

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: textSecondary,
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: border, separatorHoverColor: accent, enableResize: true },
      },
      grid: {
        vertLines: { color: 'transparent' },
        horzLines: { color: cssVar('--border', 'rgba(233, 239, 246, 0.07)') },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: textMuted, labelBackgroundColor: accent },
        horzLine: { color: textMuted, labelBackgroundColor: accent },
      },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, rightOffset: 4, minBarSpacing: 2 },
      handleScroll: true,
      handleScale: true,
    })
    chartRef.current = chart

    try {
      createTextWatermark(chart.panes()[0], {
        horzAlign: 'left',
        vertAlign: 'top',
        lines: [{ text: symbol, color: cssVar('--border', 'rgba(233,239,246,0.07)'), fontSize: 22, fontStyle: 'bold' }],
      })
    } catch {
      // Watermark is decorative; ignore if the plugin API changes.
    }

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: positive,
      downColor: negative,
      borderUpColor: positive,
      borderDownColor: negative,
      wickUpColor: positive,
      wickDownColor: negative,
      priceLineVisible: true,
      priceLineColor: accent,
    })
    candleSeries.setData(candles.map((candle) => ({ time: candle.date as Time, open: candle.open, high: candle.high, low: candle.low, close: candle.close })))

    if (indicators.volume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false,
      })
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      volumeSeries.setData(
        candles.map((candle) => ({
          time: candle.date as Time,
          value: candle.volume,
          color: candle.close >= candle.open ? `${positive}55` : `${negative}55`,
        })),
      )
    }

    const closes = candles.map((candle) => candle.close)
    const overlays: { key: keyof ChartIndicatorToggles; values: (number | undefined)[]; color: string; title: string; style?: LineStyle }[] = [
      { key: 'sma20', values: sma(closes, 20), color: '#fbbf24', title: 'SMA 20' },
      { key: 'sma50', values: sma(closes, 50), color: '#a78bfa', title: 'SMA 50' },
      { key: 'sma100', values: sma(closes, 100), color: '#38bdf8', title: 'SMA 100' },
      { key: 'sma200', values: sma(closes, 200), color: '#f97316', title: 'SMA 200' },
      { key: 'ema20', values: ema(closes, 20), color: '#22c55e', title: 'EMA 20' },
      { key: 'ema50', values: ema(closes, 50), color: '#ec4899', title: 'EMA 50' },
      { key: 'vwap', values: vwapSeries(candles), color: '#14b8a6', title: 'VWAP' },
    ]
    overlays.forEach((overlay) => {
      if (!indicators[overlay.key]) return
      const series = chart.addSeries(LineSeries, {
        color: overlay.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        title: overlay.title,
        lineStyle: overlay.style ?? LineStyle.Solid,
        crosshairMarkerVisible: false,
      })
      series.setData(toLineData(candles, overlay.values))
    })

    if (indicators.bbands) {
      const bands = bollinger(candles)
      const bandColor = '#60a5fa'
      ;[bands.upper, bands.middle, bands.lower].forEach((values, index) => {
        const series = chart.addSeries(LineSeries, {
          color: index === 1 ? `${bandColor}88` : bandColor,
          lineWidth: 1,
          lineStyle: index === 1 ? LineStyle.Dotted : LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          title: index === 0 ? 'BB upper' : index === 1 ? 'BB mid' : 'BB lower',
          crosshairMarkerVisible: false,
        })
        series.setData(toLineData(candles, values))
      })
    }

    if (indicators.range) {
      const high = Math.max(...candles.map((candle) => candle.high))
      const low = Math.min(...candles.map((candle) => candle.low))
      candleSeries.createPriceLine({ price: high, color: positive, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'High' })
      candleSeries.createPriceLine({ price: low, color: negative, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Low' })
    }

    if (indicators.patterns && patterns.length) {
      const dated = patterns.filter((pattern) => pattern.date)
      const labelledDates = new Set(
        dated
          .map((pattern) => pattern.date)
          .sort()
          .slice(-3),
      )
      const markers: SeriesMarker<Time>[] = dated.map((pattern) => ({
        time: pattern.date as Time,
        position: pattern.bias === 'bearish' ? 'aboveBar' : pattern.bias === 'bullish' ? 'belowBar' : 'inBar',
        color: pattern.bias === 'bearish' ? negative : pattern.bias === 'bullish' ? positive : warning,
        shape: pattern.bias === 'bearish' ? 'arrowDown' : pattern.bias === 'bullish' ? 'arrowUp' : 'circle',
        // Label only the freshest few alerts; older ones keep just the arrow to avoid text pile-ups.
        text: labelledDates.has(pattern.date) ? pattern.name : undefined,
        size: 1,
      }))
      markers.sort((a, b) => String(a.time).localeCompare(String(b.time)))
      try {
        createSeriesMarkers(candleSeries, markers)
      } catch {
        // Markers are an enhancement; the candles stay useful without them.
      }
    }

    if (forecast && candles.length) {
      const lastDate = candles[candles.length - 1].date
      const lastClose = candles[candles.length - 1].close
      const caseStyle: Record<string, { color: string; title: string }> = {
        bull: { color: positive, title: 'Bull' },
        base: { color: accent, title: 'Base' },
        bear: { color: negative, title: 'Bear' },
      }
      forecast.cases.forEach((forecastCase) => {
        const style = caseStyle[forecastCase.key] ?? { color: textMuted, title: forecastCase.key }
        const series = chart.addSeries(LineSeries, {
          color: style.color,
          lineWidth: 2,
          lineStyle: LineStyle.LargeDashed,
          priceLineVisible: false,
          lastValueVisible: true,
          title: style.title,
          crosshairMarkerVisible: false,
        })
        const data: (LineData<Time> | WhitespaceData<Time>)[] = [{ time: lastDate as Time, value: lastClose }]
        forecastCase.points
          .filter((point) => point.progress > 0)
          .forEach((point) => {
            data.push({ time: futureDate(lastDate, forecast.tradingDays * point.progress) as Time, value: point.price })
          })
        series.setData(data)
      })
    }

    let rsiPane = 0
    if (indicators.rsi) {
      rsiPane = chart.panes().length
      const series = chart.addSeries(LineSeries, { color: accent, lineWidth: 2, title: 'RSI 14', priceLineVisible: false }, rsiPane)
      series.setData(toLineData(candles, rsiSeries(candles)))
      series.createPriceLine({ price: 70, color: `${negative}88`, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '70' })
      series.createPriceLine({ price: 30, color: `${positive}88`, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '30' })
    }

    if (indicators.macd) {
      const paneIndex = chart.panes().length
      const macd = macdSeries(candles)
      const histogramSeries = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false, title: 'MACD hist' },
        paneIndex,
      )
      histogramSeries.setData(
        candles
          .map((candle, index) => ({ time: candle.date as Time, value: macd.histogram[index], up: (macd.histogram[index] ?? 0) >= 0 }))
          .filter((point) => point.value !== undefined)
          .map((point) => ({ time: point.time, value: point.value as number, color: point.up ? `${positive}77` : `${negative}77` })),
      )
      const macdLine = chart.addSeries(LineSeries, { color: accent, lineWidth: 2, title: 'MACD', priceLineVisible: false }, paneIndex)
      macdLine.setData(toLineData(candles, macd.macd))
      const signalLine = chart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1, title: 'Signal', priceLineVisible: false }, paneIndex)
      signalLine.setData(toLineData(candles, macd.signal))
    }

    if (indicators.atr) {
      const paneIndex = chart.panes().length
      const series = chart.addSeries(LineSeries, { color: warning, lineWidth: 2, title: 'ATR 14', priceLineVisible: false }, paneIndex)
      series.setData(toLineData(candles, atrSeries(candles)))
    }

    try {
      const panes = chart.panes()
      panes.forEach((pane, index) => {
        if (index > 0) pane.setHeight(90)
      })
      if (indicators.rsi && panes[rsiPane]) panes[rsiPane].setHeight(90)
    } catch {
      // Pane sizing is cosmetic; default proportions still render.
    }

    chart.subscribeCrosshairMove((param) => {
      const data = param.seriesData.get(candleSeries) as { open?: number; high?: number; low?: number; close?: number } | undefined
      if (!param.time || !data || data.open === undefined) {
        setLegend(null)
        return
      }
      const matching = candles.find((candle) => candle.date === String(param.time))
      const open = data.open
      const close = data.close ?? open
      setLegend({
        date: String(param.time),
        open,
        high: data.high ?? open,
        low: data.low ?? open,
        close,
        changePct: open ? ((close - open) / open) * 100 : 0,
        volume: matching?.volume,
      })
    })

    chart.timeScale().fitContent()

    return () => {
      chartRef.current = null
      chart.remove()
    }
  }, [candles, indicators, patterns, forecast, symbol, themeVersion])

  if (!candles.length) {
    return (
      <div className="price-chart-empty">
        <p>Refresh EOD data to draw candles.</p>
      </div>
    )
  }

  const formatPrice = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

  return (
    <div className="price-chart-frame">
      <div className="price-chart-legend" aria-live="polite">
        {legend ? (
          <span className="price-chart-legend-values">
            <small>{legend.date}</small>
            <b>O</b>
            <em className="lgd-neutral">{formatPrice(legend.open)}</em>
            <b>H</b>
            <em className="lgd-high">{formatPrice(legend.high)}</em>
            <b>L</b>
            <em className="lgd-low">{formatPrice(legend.low)}</em>
            <b>C</b>
            <em className={legend.close >= legend.open ? 'lgd-up' : 'lgd-down'}>{formatPrice(legend.close)}</em>
            <em className={legend.changePct >= 0 ? 'lgd-up' : 'lgd-down'}>
              ({legend.changePct >= 0 ? '+' : ''}
              {legend.changePct.toFixed(2)}%)
            </em>
            {legend.volume !== undefined && (
              <>
                <b>Vol</b>
                <em className="lgd-volume">{legend.volume.toLocaleString('en-IN')}</em>
              </>
            )}
          </span>
        ) : (
          <span>Hover or drag on the chart — scroll or pinch to zoom, tap Fit to reset.</span>
        )}
        <button type="button" onClick={() => chartRef.current?.timeScale().fitContent()}>
          Fit
        </button>
      </div>
      <div className="price-chart-container" ref={containerRef} style={{ height: chartHeight }} />
    </div>
  )
}
