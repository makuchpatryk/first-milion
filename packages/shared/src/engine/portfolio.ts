import { SPREAD, START_CASH, type OrderQty } from '../rules'

export interface Portfolio {
  /** Signed net position: > 0 long, < 0 short, 0 flat. */
  readonly units: number
  /** Average entry price, 0 when flat. */
  readonly avg: number
  readonly realized: number
  readonly closedTrades: number
  readonly wins: number
}

export const emptyPortfolio: Portfolio = {
  units: 0,
  avg: 0,
  realized: 0,
  closedTrades: 0,
  wins: 0,
}

export type TradeSide = 'BUY' | 'SELL'

const sideSign = (side: TradeSide): 1 | -1 => (side === 'BUY' ? 1 : -1)

/** Execution price: half the spread against the trader (BR-003). */
export function fillPrice(price: number, side: TradeSide): number {
  return price + (sideSign(side) * SPREAD) / 2
}

/** Books a reduction of `units` at `fill`; shared by netting and close (BR-004). */
function realize(p: Portfolio, units: number, fill: number): Portfolio {
  const pnl = (fill - p.avg) * Math.sign(p.units) * units
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

  if (p.units === 0 || Math.sign(p.units) === sign) {
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
  const fill = price - (Math.sign(p.units) * SPREAD) / 2
  return { ...realize(p, Math.abs(p.units), fill), units: 0, avg: 0 }
}

export function unrealized(p: Portfolio, price: number): number {
  return p.units === 0 ? 0 : (price - p.avg) * p.units
}

export function equity(p: Portfolio, price: number): number {
  return START_CASH + p.realized + unrealized(p, price)
}

export function isBankrupt(p: Portfolio, price: number): boolean {
  return equity(p, price) <= 0
}

/** Bankruptcy and disconnect timeout close at market incl. spread (BR-005, BR-019). */
export function liquidate(p: Portfolio, price: number): Portfolio {
  return closePosition(p, price)
}

/** Total result = equity - starting cash (profit-target metric, BR-009). */
export function totalResult(p: Portfolio, price: number): number {
  return equity(p, price) - START_CASH
}
