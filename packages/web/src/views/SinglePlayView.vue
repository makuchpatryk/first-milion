<script setup lang="ts">
import { ORDER_QTYS, SPEEDS, type OrderQty, type Speed } from '@fm/shared/rules'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ChipGroup from '../components/ChipGroup.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import NewsBar from '../components/NewsBar.vue'
import PriceChart from '../components/PriceChart.vue'
import SingleSetup from '../components/SingleSetup.vue'
import { useLeaveGuard } from '../composables/use-leave-guard'
import { formatCountdown, goalProgress } from '../room/countdown'
import { useLocale } from '../i18n'
import { formatDecimal, formatMoney, formatSigned } from '../i18n/format'
import type { SingleEnd } from '../single/loop'
import { useSinglePlay } from '../single/useSinglePlay'
import { isTypingTarget, orderKey } from './keys'

const { t } = useI18n()
const { locale } = useLocale()

const {
  sim,
  started,
  qty,
  speed,
  paused,
  prices,
  price,
  change,
  equity,
  open,
  total,
  winRate,
  buy,
  sell,
  close,
  start,
  restart,
  changeSettings,
  togglePause,
} = useSinglePlay()

// Leaving a running round (menu, settings, back) asks first; the setup screen and an ended round do not.
const leaveGuard = useLeaveGuard(() => started.value && sim.value.end === null)

// The round stands still while the question is open; a pause the player set stays as it was.
let pausedByGuard = false
watch(leaveGuard.asking, (asking) => {
  if (asking && !paused.value) {
    pausedByGuard = true
    togglePause()
  } else if (!asking && pausedByGuard) {
    pausedByGuard = false
    togglePause()
  }
})

const tone = (n: number): string => (n > 0 ? 'up' : n < 0 ? 'down' : '')

// Recent trades: a short list by default, the rest behind "show more" (history is newest first).
const HIST_PREVIEW = 3
const histOpen = ref(false)
const shownTrades = computed(() =>
  histOpen.value ? sim.value.history : sim.value.history.slice(0, HIST_PREVIEW),
)

const formatQty = (n: OrderQty): string => `${n} ${t('single.units')}`
const formatSpeed = (s: Speed): string => `${s}×`

const progress = computed(() =>
  goalProgress(equity.value, sim.value.round.startCash, sim.value.round.goal),
)
// ARIA wants the value inside the range; equity can sit below the start or above the goal.
const progressNow = computed(() => {
  const { startCash, goal } = sim.value.round
  return Math.round(Math.min(goal, Math.max(startCash, equity.value)))
})

const END_TITLE: Record<SingleEnd, string> = {
  MARGIN: 'single.marginCall',
  TARGET: 'single.goalReached',
  TIME: 'single.timeUp',
}
const endTitle = computed(() => (sim.value.end === null ? '' : t(END_TITLE[sim.value.end])))
const endMessage = computed(() => {
  const end = sim.value.end
  if (end === null) return ''
  if (end === 'MARGIN') {
    return t('single.marginCallMsg', {
      n: sim.value.portfolio.closedTrades,
      p: formatMoney(sim.value.peak, locale.value),
    })
  }
  return t('single.resultMsg', {
    r: formatMoney(equity.value, locale.value),
    g: formatDecimal(sim.value.round.goal, 0, locale.value),
  })
})

// Orders by keyboard (FR-004); form fields keep their own keystrokes.
const ACTIONS = { buy, sell, close }
function onKeydown(event: KeyboardEvent): void {
  if (isTypingTarget(event.target)) return
  const action = orderKey(event)
  if (action !== null) ACTIONS[action]()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

// The margin call covers the controls, so keyboard focus moves to "Play again" (UF-002).
const againButton = ref<HTMLButtonElement | null>(null)
watch(
  () => sim.value.end,
  async (end) => {
    if (end === null) return
    await nextTick()
    againButton.value?.focus()
  },
)
</script>

<template>
  <section class="single" :aria-label="t('single.mode')">
    <ConfirmDialog
      v-if="leaveGuard.asking.value"
      open
      :title="t('leaveGame.title')"
      :body="t('leaveGame.single')"
      :confirm-label="t('leaveGame.confirm')"
      @confirm="leaveGuard.confirm"
      @cancel="leaveGuard.cancel"
    />

    <SingleSetup v-if="!started" @start="start" />

    <template v-else>
      <div class="ticker">
        <div class="quote">
          <div class="price num">{{ formatMoney(price, locale) }}</div>
          <div class="chg num" :class="tone(change)">{{ formatSigned(change, locale) }}%</div>
        </div>
        <NewsBar
          class="ticker-news"
          :news="sim.market.news"
          :age="sim.market.newsAge"
          :locale="locale"
        />
      </div>

      <div class="chart-wrap">
        <PriceChart
          :prices="prices"
          :avg="sim.portfolio.units !== 0 ? sim.portfolio.avg : null"
          :locale="locale"
          :entry-label="t('single.entry')"
        />
        <div v-if="sim.end !== null" class="over" role="alertdialog" aria-labelledby="over-title">
          <h2 id="over-title" :class="{ win: sim.end !== 'MARGIN' }">{{ endTitle }}</h2>
          <p class="sub">{{ endMessage }}</p>
          <div class="over-actions">
            <button ref="againButton" type="button" class="chip" @click="restart">
              {{ t('single.again') }}
            </button>
            <button type="button" class="chip" @click="changeSettings">
              {{ t('single.changeSettings') }}
            </button>
          </div>
        </div>
      </div>

      <div class="controls">
        <div class="actions">
          <button type="button" class="big buy" :disabled="sim.end !== null" @click="buy">
            <span>{{ t('single.buy') }}</span>
            <small>{{ t('single.key') }} B</small>
          </button>
          <button type="button" class="big flat" :disabled="sim.end !== null" @click="close">
            <span>{{ t('single.close') }}</span>
            <small>{{ t('single.key') }} C</small>
          </button>
          <button type="button" class="big sell" :disabled="sim.end !== null" @click="sell">
            <span>{{ t('single.sell') }}</span>
            <small>{{ t('single.key') }} S</small>
          </button>
        </div>
        <div class="row">
          <span class="label lbl">{{ t('single.size') }}</span>
          <ChipGroup
            v-model="qty"
            :label="t('single.size')"
            :items="ORDER_QTYS"
            :format="formatQty"
          />
        </div>
      </div>

      <div class="stats">
        <div class="stat">
          <span class="label">{{ t('single.capital') }}</span>
          <div class="num">{{ formatMoney(equity, locale) }}</div>
        </div>
        <div class="stat">
          <span class="label">{{ t('single.open') }}</span>
          <div class="num" :class="tone(open)">{{ formatSigned(open, locale) }}</div>
        </div>
        <div class="stat">
          <span class="label">{{ t('single.pos') }}</span>
          <div class="num">
            <template v-if="sim.portfolio.units !== 0">
              {{ sim.portfolio.units > 0 ? '+' : '' }}{{ sim.portfolio.units }} @
              {{ formatMoney(sim.portfolio.avg, locale) }}
            </template>
            <template v-else>{{ t('single.none') }}</template>
          </div>
        </div>
        <div class="stat">
          <span class="label">{{ t('single.total') }}</span>
          <div class="num" :class="tone(total)">{{ formatSigned(total, locale) }}</div>
        </div>
      </div>

      <div class="foot">
        <span>
          {{ t('single.trades') }}: <b class="num">{{ sim.portfolio.closedTrades }}</b>
        </span>
        <span>
          {{ t('single.win') }}: <b class="num">{{ winRate === null ? '–' : `${winRate}%` }}</b>
        </span>
        <span>
          {{ t('single.peak') }}: <b class="num">{{ formatMoney(sim.peak, locale) }}</b>
        </span>
      </div>

      <div class="round-bar">
        <div class="round-row">
          <span class="label">{{ t('single.timeLeft') }}</span>
          <span class="num clock">{{ formatCountdown(sim.timeLeftMs) }}</span>
          <span class="label">{{ t('single.goal') }}</span>
          <span class="num">
            {{ formatDecimal(equity, 0, locale) }} / {{ formatDecimal(sim.round.goal, 0, locale) }}
          </span>
        </div>
        <div
          class="bar"
          role="progressbar"
          :aria-label="t('single.goalProgress')"
          :aria-valuemin="sim.round.startCash"
          :aria-valuemax="sim.round.goal"
          :aria-valuenow="progressNow"
        >
          <div class="fill" :style="{ width: `${progress * 100}%` }" />
        </div>
      </div>

      <div class="speed">
        <span class="label">{{ t('single.speed') }}</span>
        <ChipGroup
          v-model="speed"
          :label="t('single.speed')"
          :items="SPEEDS"
          :format="formatSpeed"
        />
        <button type="button" class="chip" @click="togglePause">
          {{ paused ? t('single.resume') : t('single.pause') }}
        </button>
      </div>

      <div class="history">
        <h2 class="label hist-title">{{ t('single.hist') }}</h2>
        <p v-if="sim.history.length === 0" class="empty">{{ t('single.histEmpty') }}</p>
        <ul v-else class="hist">
          <li v-for="(trade, i) in shownTrades" :key="i" class="item">
            <span class="side-tag" :class="trade.dir > 0 ? 'up' : 'down'">
              {{ trade.dir > 0 ? t('single.long') : t('single.short') }}
            </span>
            <span class="det num">
              {{ trade.units }} {{ t('single.units') }} {{ formatMoney(trade.entry, locale) }} →
              {{ formatMoney(trade.exit, locale) }}
            </span>
            <span class="num" :class="tone(trade.pnl)">{{ formatSigned(trade.pnl, locale) }}</span>
          </li>
        </ul>
        <button
          v-if="sim.history.length > HIST_PREVIEW"
          type="button"
          class="chip more"
          :aria-expanded="histOpen"
          @click="histOpen = !histOpen"
        >
          {{ histOpen ? t('single.histLess') : t('single.histMore', { n: sim.history.length }) }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.single {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sub {
  color: var(--muted);
  font-size: 0.8rem;
  margin: 4px 0 0;
  max-width: 34ch;
  line-height: 1.4;
}

.ticker {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ticker .ticker-news {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.quote {
  flex: none;
  line-height: 1.1;
}

.price {
  font-size: 1.25rem;
  font-weight: 700;
}

.chg {
  font-size: 0.75rem;
}

.chart-wrap {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.speed {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.speed .label {
  font-size: 0.7rem;
  min-width: 64px;
}

.over {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  padding: 16px;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
}

.over h2 {
  margin: 0;
  font-size: 1.5rem;
  color: var(--down);
}

.over h2.win {
  color: var(--up);
}

.over .sub {
  max-width: 32ch;
  margin: 0;
}

.over-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.round-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.round-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
}

.clock {
  font-size: 1.3rem;
}

.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--border);
  overflow: hidden;
}

.fill {
  height: 100%;
  background: var(--gold);
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

@media (min-width: 560px) {
  .stats {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.stat {
  background: var(--surface);
  padding: 6px 10px;
  min-width: 0;
}

.stat .label {
  display: block;
  font-size: 0.64rem;
  margin-bottom: 2px;
}

.stat .num {
  font-size: 0.95rem;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.lbl {
  font-size: 0.7rem;
  min-width: 64px;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 0.8fr 1fr;
  gap: 8px;
}

.big {
  font: 700 1.05rem var(--font-ui);
  border: 0;
  border-radius: 6px;
  min-height: 44px;
  padding: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.big small {
  font: 400 0.68rem var(--font-data);
  opacity: 0.8;
}

.big:active {
  transform: translateY(1px);
}

.big:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.buy {
  background: var(--up);
  color: var(--on-up);
}

.sell {
  background: var(--down);
  color: var(--on-down);
}

.flat {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
}

.hist-title {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 500;
}

.hist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
}

.item {
  display: grid;
  grid-template-columns: 3.6em 1fr auto;
  gap: 10px;
  align-items: baseline;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.82rem;
}

.side-tag {
  font-weight: 700;
}

.det {
  color: var(--muted);
  min-width: 0;
  overflow-wrap: anywhere;
}

.empty {
  color: var(--muted);
  font-size: 0.85rem;
  padding: 12px 0;
  margin: 0;
}

.foot {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  color: var(--muted);
  font-size: 0.78rem;
}

.foot b {
  color: var(--text);
  font-weight: 500;
}
</style>
