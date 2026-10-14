import {
  FLASH_DROP,
  FLASH_RECOVER,
  FLASH_TICKS,
  NEWS_FIRST_TICKS,
  NEWS_GAP_TICKS,
  SHOCK_MAG,
  SHOCK_TEXT_COUNT,
  TREND_DRIFT,
  TREND_TICKS,
  VOL_TICKS,
} from '../config'
import { MIN_PRICE } from '../rules'
import { between, pick, type Rng } from '../rng'
import type { Market } from './market'

export type NewsEvent =
  | { type: 'SHOCK'; dir: 1 | -1; mag: number; idx: number }
  | { type: 'FLASH_CRASH'; drop: number }
  | { type: 'VOL_SPIKE' }
  | { type: 'TREND'; dir: 1 | -1 }

const NEWS_TYPES = ['SHOCK', 'FLASH_CRASH', 'VOL_SPIKE', 'TREND'] as const

/** Ticks until the next draw: 200-400 for the first, 250-650 after (BR-015). */
export function drawNewsGap(rng: Rng, first: boolean): number {
  const [lo, hi] = first ? NEWS_FIRST_TICKS : NEWS_GAP_TICKS
  return between(rng, lo, hi)
}

/**
 * Draws one event (25% per type) and applies its effect; mirrors prototype news() L285-313.
 * Effects of the same kind restart; the tick-based effects are shorter than the minimum gap, so
 * they never overlap.
 */
export function drawNews(rng: Rng, m: Market): Market {
  const type = pick(rng, NEWS_TYPES)
  const dir = rng() < 0.5 ? 1 : -1
  const base: Market = { ...m, newsLeft: drawNewsGap(rng, false), newsAge: 0 }

  switch (type) {
    case 'SHOCK': {
      const mag = between(rng, ...SHOCK_MAG)
      const idx = Math.floor(rng() * SHOCK_TEXT_COUNT)
      const price = Math.max(MIN_PRICE, m.price * Math.exp(dir * mag))
      return { ...base, price, news: { type: 'SHOCK', dir, mag, idx } }
    }
    case 'FLASH_CRASH': {
      const drop = between(rng, ...FLASH_DROP)
      const price = Math.max(MIN_PRICE, m.price * (1 - drop))
      const perTick = (FLASH_RECOVER * (m.price - price)) / FLASH_TICKS
      return {
        ...base,
        price,
        flash: { left: FLASH_TICKS, perTick },
        news: { type: 'FLASH_CRASH', drop },
      }
    }
    case 'VOL_SPIKE':
      return { ...base, volLeft: VOL_TICKS, news: { type: 'VOL_SPIKE' } }
    case 'TREND':
      return {
        ...base,
        trend: { left: TREND_TICKS, drift: dir * TREND_DRIFT },
        news: { type: 'TREND', dir },
      }
  }
}
