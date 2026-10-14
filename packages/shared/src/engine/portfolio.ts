import { SPREAD, type OrderQty } from '../rules'

export interface Portfolio {
  /** Capital the round started with (BR-003); equity and total result are measured from it. */
  readonly startCash: number
  /** Signed net position: > 0 long, < 0 short, 0 flat. */
  readonly units: number
  /** Average entry price, 0 when flat. */
  readonly avg: number
  readonly realized: number
  readonly closedTrades: number
  readonly wins: number
}

export const newPortfolio = (startCash: number): Portfolio => ({
  startCash,
  units: 0,
  avg: 0,
  realized: 0,
  closedTrades: 0,
  wins: 0,
})

export type TradeSide = 'BUY' | 'SELL'

const sideSign = (side: TradeSide): 1 | -1 => (side === 'BUY' ? 1 : -1)

/** Execution price: half the spread against the trader (BR-003). */
export function fillPrice(price: number, side: TradeSide): number {
  return price + (sideSign(side) * SPREAD) / 2
}

/** One reduced or closed part of a position, as shown in trade history (BR-004, UF-002). */
export interface BookedTrade {
  /** Direction of the position that was reduced: 1 long, -1 short. */
  readonly dir: 1 | -1
  readonly units: number
  readonly entry: number
  readonly exit: number
  readonly pnl: number
}

/** The only place a trade's P&L is computed; netting, close and history all go through it. */
function reduction(p: Portfolio, units: number, fill: number): BookedTrade {
  const dir = p.units > 0 ? 1 : -1
  return { dir, units, entry: p.avg, exit: fill, pnl: (fill - p.avg) * dir * units }
}

/** Does an order of sign `sign` reduce the current position (BR-004)? */
const opposes = (p: Portfolio, sign: 1 | -1): boolean =>
  p.units !== 0 && Math.sign(p.units) !== sign

/** Close fill: half the spread against the trader (prototype L383-389). */
const closeFill = (p: Portfolio, price: number): number => price - (Math.sign(p.units) * SPREAD) / 2

/** Books a reduction of `units` at `fill`; shared by netting and close (BR-004). */
function realize(p: Portfolio, units: number, fill: number): Portfolio {
  const { pnl } = reduction(p, units, fill)
  return {
    ...p,
    realized: p.realized + pnl,
    closedTrades: p.closedTrades + 1,
    wins: p.wins + (pnl > 0 ? 1 : 0),
  }
}

/** Net position update, same arithmetic as prototype trade() (L354-368). */
export function executeOrder(
  p: Portfolio,
  side: TradeSide,
  qty: OrderQty,
  price: number,
): Portfolio {
  const sign = sideSign(side)
  const fill = fillPrice(price, side)

  if (!opposes(p, sign)) {
    const held = Math.abs(p.units)
    return {
      ...p,
      units: p.units + sign * qty,
      avg: (p.avg * held + fill * qty) / (held + qty),
    }
  }

  const closing = Math.min(Math.abs(p.units), qty)
  const rest = qty - closing
  const booked = realize(p, closing, fill)
  const units = p.units + sign * qty
  // A reversal opens the remainder at the execution price (BR-004).
  const avg = units === 0 ? 0 : rest > 0 ? fill : p.avg
  return { ...booked, units, avg }
}

/** Closes the whole position incl. spread (prototype L383-389). No-op when flat. */
export function closePosition(p: Portfolio, price: number): Portfolio {
  if (p.units === 0) return p
  return { ...realize(p, Math.abs(p.units), closeFill(p, price)), units: 0, avg: 0 }
}

/**
 * The part of the position that `executeOrder(p, side, qty, price)` would book, or `null` when
 * the order only opens or adds (nothing is realized). Call it with the portfolio *before* the order.
 */
export function bookedTrade(
  p: Portfolio,
  side: TradeSide,
  qty: OrderQty,
  price: number,
): BookedTrade | null {
  if (!opposes(p, sideSign(side))) return null
  return reduction(p, Math.min(Math.abs(p.units), qty), fillPrice(price, side))
}

/** The trade that `closePosition(p, price)` would book, or `null` when flat. */
export function closedTradeOf(p: Portfolio, price: number): BookedTrade | null {
  if (p.units === 0) return null
  return reduction(p, Math.abs(p.units), closeFill(p, price))
}

/** Open P&L; reads only the position, so a wire `MeRound` fits too. */
export function unrealized(p: Pick<Portfolio, 'units' | 'avg'>, price: number): number {
  return p.units === 0 ? 0 : (price - p.avg) * p.units
}

export function equity(p: Portfolio, price: number): number {
  return p.startCash + p.realized + unrealized(p, price)
}

export function isBankrupt(p: Portfolio, price: number): boolean {
  return equity(p, price) <= 0
}

/** Bankruptcy and disconnect timeout close at market incl. spread (BR-005, BR-019). */
export function liquidate(p: Portfolio, price: number): Portfolio {
  return closePosition(p, price)
}

/** Total result = equity - starting cash (ranking metric, BR-005, BR-006). */
export function totalResult(p: Portfolio, price: number): number {
  return equity(p, price) - p.startCash
}
