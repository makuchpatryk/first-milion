import { DRIFT_RANGE, REGIME_TICKS, VOL_BASE, VOL_MULT, VOL_RANGE } from '../config'
import { MIN_PRICE, START_PRICE } from '../rules'
import { between, randn, type Rng } from '../rng'
import { drawNews, drawNewsGap, type NewsEvent } from './news'

export interface Market {
  readonly price: number
  /** Current regime drift per tick. */
  readonly drift: number
  /** Current regime volatility per tick. */
  readonly vol: number
  /** Ticks until a new regime is drawn. */
  readonly regimeLeft: number
  /** Ticks until the next news draw. */
  readonly newsLeft: number
  /** VOL_SPIKE ticks left. */
  readonly volLeft: number
  /** TREND drift override, replaces the regime drift while active. */
  readonly trend: { readonly left: number; readonly drift: number } | null
  /** FLASH_CRASH recovery still to apply. */
  readonly flash: { readonly left: number; readonly perTick: number } | null
  /** Wall ms of trading halt left; > 0 means orders are rejected (BR-015). */
  readonly haltMsLeft: number
  /** Last news drawn (kept after it happens so the UI can fade it, FR-005); null before the first. */
  readonly news: NewsEvent | null
  /** Ticks since `news`. */
  readonly newsAge: number
  /** Price shown while halted; null otherwise. */
  readonly frozenPrice: number | null
}

function drawRegime(rng: Rng): Pick<Market, 'drift' | 'vol' | 'regimeLeft'> {
  return {
    drift: (rng() - 0.5) * DRIFT_RANGE,
    vol: VOL_BASE + rng() * VOL_RANGE,
    regimeLeft: between(rng, ...REGIME_TICKS),
  }
}

export function createMarket(rng: Rng): Market {
  const newsLeft = drawNewsGap(rng, true)
  return {
    price: START_PRICE,
    ...drawRegime(rng),
    newsLeft,
    volLeft: 0,
    trend: null,
    flash: null,
    haltMsLeft: 0,
    news: null,
    newsAge: 0,
    frozenPrice: null,
  }
}

/** One simulation tick; order mirrors prototype step() L334-346. */
export function stepMarket(m: Market, rng: Rng): Market {
  let next: Market = m

  const regimeLeft = next.regimeLeft - 1
  next = regimeLeft <= 0 ? { ...next, ...drawRegime(rng) } : { ...next, regimeLeft }

  const newsLeft = next.newsLeft - 1
  next = newsLeft <= 0 ? drawNews(rng, next) : { ...next, newsLeft }

  const drift = next.trend ? next.trend.drift : next.drift
  const vol = next.vol * (next.volLeft > 0 ? VOL_MULT : 1)
  let price = Math.max(MIN_PRICE, next.price * Math.exp(drift + vol * randn(rng)))
  if (next.flash) price = Math.max(MIN_PRICE, price + next.flash.perTick)

  return {
    ...next,
    price,
    volLeft: Math.max(0, next.volLeft - 1),
    trend: next.trend && next.trend.left > 1 ? { ...next.trend, left: next.trend.left - 1 } : null,
    flash: next.flash && next.flash.left > 1 ? { ...next.flash, left: next.flash.left - 1 } : null,
    newsAge: next.newsAge + 1,
  }
}

/** Counts the halt down in wall-clock ms, never below 0; clears the frozen price at 0 (BR-015). */
export function tickHalt(m: Market, elapsedMs: number): Market {
  if (m.haltMsLeft <= 0) return m
  const haltMsLeft = Math.max(0, m.haltMsLeft - elapsedMs)
  return haltMsLeft === 0 ? { ...m, haltMsLeft, frozenPrice: null } : { ...m, haltMsLeft }
}

export function isTradingHalted(m: Market): boolean {
  return m.haltMsLeft > 0
}

export function shownPrice(m: Market): number {
  return m.frozenPrice ?? m.price
}
