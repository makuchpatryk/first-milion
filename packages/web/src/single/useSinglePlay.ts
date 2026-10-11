import { TICK_MS } from '@fm/shared/config'
import { isTradingHalted, shownPrice } from '@fm/shared/engine/market'
import { totalResult, unrealized } from '@fm/shared/engine/portfolio'
import type { Rng } from '@fm/shared/rng'
import { START_PRICE, type OrderQty, type Speed } from '@fm/shared/rules'
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import {
  advanceSingle,
  closeOrder,
  createSingle,
  placeOrder,
  shownEquity,
  shownPrices,
} from './loop'

/** A background tab throttles timers; one interval never advances the halt by more than this. */
const MAX_ELAPSED_MS = 250

const DEFAULT_QTY: OrderQty = 50
const DEFAULT_SPEED: Speed = 3

interface Options {
  /** Wall clock in ms (injected so tests need no real time). */
  now?: () => number
  /** `Math.random` satisfies `Rng`; the determinism rule applies to `shared`, not to `web`. */
  rng?: Rng
}

/**
 * Single play (FR-004, BR-006): the 80 ms timer shell around the pure engine in `loop.ts`.
 * Each visit starts a fresh game; nothing is stored anywhere.
 */
export function useSinglePlay(options: Options = {}) {
  const now = options.now ?? (() => performance.now())
  const rng = options.rng ?? Math.random

  const sim = shallowRef(createSingle(rng))
  const qty = ref<OrderQty>(DEFAULT_QTY)
  const speed = ref<Speed>(DEFAULT_SPEED)
  const paused = ref(false)

  let last = now()

  function tick(): void {
    const t = now()
    const elapsed = Math.min(t - last, MAX_ELAPSED_MS)
    last = t
    // `last` still advances while paused, so resuming does not count the pause as halt time.
    if (paused.value || sim.value.over) return
    sim.value = advanceSingle(sim.value, elapsed, speed.value, rng)
  }

  const timer = setInterval(tick, TICK_MS)

  function dispose(): void {
    clearInterval(timer)
  }
  if (getCurrentScope()) onScopeDispose(dispose)

  function buy(): void {
    sim.value = placeOrder(sim.value, 'BUY', qty.value)
  }

  function sell(): void {
    sim.value = placeOrder(sim.value, 'SELL', qty.value)
  }

  function close(): void {
    sim.value = closeOrder(sim.value)
  }

  function restart(): void {
    sim.value = createSingle(rng)
    last = now()
  }

  function togglePause(): void {
    paused.value = !paused.value
  }

  const price = computed(() => shownPrice(sim.value.market))
  const equity = computed(() => shownEquity(sim.value))
  const winRate = computed(() => {
    const { closedTrades, wins } = sim.value.portfolio
    return closedTrades === 0 ? null : Math.round((wins / closedTrades) * 100)
  })

  return {
    sim,
    qty,
    speed,
    paused,
    prices: computed(() => shownPrices(sim.value)),
    price,
    /** Change since the starting price, in percent. */
    change: computed(() => (price.value / START_PRICE - 1) * 100),
    equity,
    open: computed(() => unrealized(sim.value.portfolio, price.value)),
    total: computed(() => totalResult(sim.value.portfolio, price.value)),
    winRate,
    halted: computed(() => isTradingHalted(sim.value.market)),
    buy,
    sell,
    close,
    restart,
    togglePause,
    dispose,
  }
}
