/** Points shown on the chart (prototype VIEW). */
export const VIEW = 220

/** Plot margins; the right one holds the price axis labels. */
const LEFT = 8
const RIGHT = 62
const TOP = 10
const BOTTOM = 12

const PAD_FRACTION = 0.12
/** Used when the visible range is flat (all prices equal), so the line is not glued to an edge. */
const FLAT_PAD = 0.5
const GRID_LINES = 5

export interface Point {
  readonly x: number
  readonly y: number
}

export interface ChartGeometry {
  readonly width: number
  readonly height: number
  readonly left: number
  /** Right edge of the plot; the axis labels start right of it. */
  readonly right: number
  readonly bottom: number
  readonly points: readonly Point[]
  readonly grid: readonly { readonly value: number; readonly y: number }[]
  /** Dashed entry line of the open position, `null` when flat. */
  readonly entry: { readonly value: number; readonly y: number } | null
  readonly last: { readonly price: number; readonly x: number; readonly y: number }
}

/**
 * Pure layout of the last `VIEW` prices into canvas coordinates (prototype draw()). The range gets
 * 12% padding and always includes the entry price of an open position. Returns `null` for no data.
 */
export function chartGeometry(
  prices: readonly number[],
  avg: number | null,
  width: number,
  height: number,
): ChartGeometry | null {
  const data = prices.slice(-VIEW)
  const lastPrice = data.at(-1)
  if (lastPrice === undefined) return null

  let lo = Math.min(...data)
  let hi = Math.max(...data)
  if (avg !== null) {
    lo = Math.min(lo, avg)
    hi = Math.max(hi, avg)
  }
  const pad = (hi - lo) * PAD_FRACTION || FLAT_PAD
  lo -= pad
  hi += pad

  const plotWidth = width - LEFT - RIGHT
  const plotHeight = height - TOP - BOTTOM
  const offset = VIEW - data.length
  const x = (i: number): number => LEFT + ((i + offset) / (VIEW - 1)) * plotWidth
  const y = (v: number): number => TOP + (1 - (v - lo) / (hi - lo)) * plotHeight

  const points = data.map((v, i) => ({ x: x(i), y: y(v) }))
  const grid = Array.from({ length: GRID_LINES }, (_, g) => {
    const value = lo + ((hi - lo) * g) / (GRID_LINES - 1)
    // Half a pixel keeps 1 px lines crisp.
    return { value, y: Math.round(y(value)) + 0.5 }
  })

  return {
    width,
    height,
    left: LEFT,
    right: LEFT + plotWidth,
    bottom: TOP + plotHeight,
    points,
    grid,
    entry: avg === null ? null : { value: avg, y: y(avg) },
    last: { price: lastPrice, x: x(data.length - 1), y: y(lastPrice) },
  }
}

export interface ChartColors {
  readonly grid: string
  readonly muted: string
  readonly up: string
  readonly gold: string
  readonly onGold: string
  readonly font: string
}

export interface ChartText {
  /** Locale-aware number format for axis, entry and last-price labels (FR-019). */
  readonly format: (n: number) => string
  /** Prefix of the entry label, e.g. "entry" (an i18n string). */
  readonly entry: string
}

const AREA_FILL = 'rgba(46, 229, 157, 0.12)'
const LABEL_BOX_HEIGHT = 18

function tracePath(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
}

/** Draws into a context already scaled to CSS pixels and cleared by the caller. */
export function drawChart(
  ctx: CanvasRenderingContext2D,
  geometry: ChartGeometry | null,
  colors: ChartColors,
  text: ChartText,
): void {
  if (geometry === null) return

  const { left, right, bottom, points, grid, entry, last } = geometry
  const first = points[0]
  const end = points.at(-1)
  if (first === undefined || end === undefined) return

  ctx.font = `11px ${colors.font}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineWidth = 1

  for (const line of grid) {
    ctx.strokeStyle = colors.grid
    ctx.beginPath()
    ctx.moveTo(left, line.y)
    ctx.lineTo(right, line.y)
    ctx.stroke()
    ctx.fillStyle = colors.muted
    ctx.fillText(text.format(line.value), right + 6, line.y)
  }

  ctx.beginPath()
  tracePath(ctx, points)
  ctx.lineTo(end.x, bottom)
  ctx.lineTo(first.x, bottom)
  ctx.closePath()
  ctx.fillStyle = AREA_FILL
  ctx.fill()

  ctx.beginPath()
  tracePath(ctx, points)
  ctx.strokeStyle = colors.up
  ctx.lineWidth = 1.7
  ctx.lineJoin = 'round'
  ctx.stroke()

  if (entry !== null) {
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = colors.gold
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(left, entry.y)
    ctx.lineTo(right, entry.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = colors.gold
    ctx.fillText(`${text.entry} ${text.format(entry.value)}`, left + 4, entry.y - 8)
  }

  ctx.fillStyle = colors.gold
  ctx.beginPath()
  ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillRect(
    right + 2,
    last.y - LABEL_BOX_HEIGHT / 2,
    geometry.width - right - 4,
    LABEL_BOX_HEIGHT,
  )
  ctx.fillStyle = colors.onGold
  ctx.fillText(text.format(last.price), right + 6, last.y)
}
