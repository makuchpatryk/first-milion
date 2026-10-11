import { describe, expect, it } from 'vitest'
import { formatMoney } from '../i18n/format'
import { chartGeometry, drawChart, VIEW, type ChartColors } from './priceChart'

const W = 360
const H = 260

const ramp = (n: number, from = 100) => Array.from({ length: n }, (_, i) => from + i * 0.1)

describe('chartGeometry', () => {
  it('FR-004: shows only the last 220 points of the displayed slice', () => {
    const geometry = chartGeometry(ramp(300), null, W, H)
    expect(geometry?.points).toHaveLength(VIEW)
    // The last point is the 300th price, the first is the 81st.
    expect(geometry?.last.price).toBeCloseTo(100 + 299 * 0.1, 9)
  })

  it('FR-004: a short history is right-aligned so the last point sits on the right edge', () => {
    const geometry = chartGeometry(ramp(10), null, W, H)
    expect(geometry?.last.x).toBeCloseTo(geometry?.right ?? NaN, 9)
    expect(geometry?.points[0]?.x).toBeGreaterThan(geometry?.left ?? Infinity)
  })

  it('FR-004: the range is padded by 12% of the high-low span on both sides', () => {
    const geometry = chartGeometry([100, 110], null, W, H)
    expect(geometry?.grid[0]?.value).toBeCloseTo(100 - 1.2, 9)
    expect(geometry?.grid[4]?.value).toBeCloseTo(110 + 1.2, 9)
  })

  it('FR-004: a flat history gets a 0.5 pad instead of a zero-height range', () => {
    const geometry = chartGeometry([100, 100, 100], null, W, H)
    expect(geometry?.grid[0]?.value).toBeCloseTo(99.5, 9)
    expect(geometry?.grid[4]?.value).toBeCloseTo(100.5, 9)
  })

  it('FR-004: an open position pulls its entry price into the range and gets a line', () => {
    const prices = ramp(20)
    const flat = chartGeometry(prices, null, W, H)
    const long = chartGeometry(prices, 120, W, H)

    expect(flat?.entry).toBeNull()
    expect(long?.entry?.value).toBe(120)
    expect(long?.grid[4]?.value).toBeGreaterThan(120)
    expect(long?.entry?.y).toBeGreaterThanOrEqual(0)
    expect(long?.entry?.y).toBeLessThanOrEqual(long?.bottom ?? 0)
  })

  it('FR-004: higher prices are drawn higher (smaller y)', () => {
    const geometry = chartGeometry([100, 105, 110], null, W, H)
    const [a, b, c] = geometry?.points ?? []
    expect(a?.y).toBeGreaterThan(b?.y ?? Infinity)
    expect(b?.y).toBeGreaterThan(c?.y ?? Infinity)
  })

  it('FR-004: no prices yields no geometry and does not throw', () => {
    expect(chartGeometry([], null, W, H)).toBeNull()
  })
})

/** A context that records calls and ignores property writes. */
function recordingContext() {
  const calls: { method: string; args: unknown[] }[] = []
  const ctx = new Proxy(
    {},
    {
      get:
        (_target, method) =>
        (...args: unknown[]) => {
          calls.push({ method: String(method), args })
        },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

const COLORS: ChartColors = {
  grid: '#18212b',
  muted: '#7d8a99',
  up: '#2ee59d',
  gold: '#f5c451',
  onGold: '#1a1405',
  font: 'monospace',
}

function labels(locale: 'pl' | 'en'): string[] {
  const { ctx, calls } = recordingContext()
  drawChart(ctx, chartGeometry([100, 101, 102], 101, W, H), COLORS, {
    format: (n) => formatMoney(n, locale),
    entry: 'entry',
  })
  return calls.filter((c) => c.method === 'fillText').map((c) => String(c.args[0]))
}

describe('drawChart', () => {
  it('FR-019: axis, entry and last-price labels use a decimal comma in PL', () => {
    const texts = labels('pl')
    expect(texts).toContain('102,00')
    expect(texts).toContain('entry 101,00')
    expect(texts.every((t) => !t.includes('.'))).toBe(true)
  })

  it('FR-019: the same labels use a decimal point in EN', () => {
    const texts = labels('en')
    expect(texts).toContain('102.00')
    expect(texts).toContain('entry 101.00')
  })

  it('FR-004: draws 5 grid labels plus the last-price label, and the entry label only when open', () => {
    expect(labels('pl')).toHaveLength(5 + 1 + 1)

    const { ctx, calls } = recordingContext()
    drawChart(ctx, chartGeometry([100, 101], null, W, H), COLORS, {
      format: (n) => formatMoney(n, 'pl'),
      entry: 'entry',
    })
    expect(calls.filter((c) => c.method === 'fillText')).toHaveLength(5 + 1)
  })

  it('FR-004: null geometry draws nothing and does not throw', () => {
    const { ctx, calls } = recordingContext()
    expect(() =>
      drawChart(ctx, null, COLORS, { format: (n) => String(n), entry: 'entry' }),
    ).not.toThrow()
    expect(calls).toHaveLength(0)
  })
})
