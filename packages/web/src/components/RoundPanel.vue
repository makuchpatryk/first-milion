<script setup lang="ts">
import { unrealized } from '@fm/shared/engine/portfolio'
import type { RoomView } from '@fm/shared/protocol'
import { ORDER_QTYS, START_PRICE, type OrderQty } from '@fm/shared/rules'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocale } from '../i18n'
import { formatDecimal, formatMoney, formatSigned } from '../i18n/format'
import { formatCountdown, goalProgress } from '../room/countdown'
import type { RoomState } from '../room/room-state'
import { isTypingTarget, orderKey } from '../views/keys'
import ChipGroup from './ChipGroup.vue'
import NewsBar from './NewsBar.vue'
import PriceChart from './PriceChart.vue'

const props = defineProps<{
  view: RoomView
  state: RoomState
  /** Socket ready and an active player (`canTrade`); the server still decides (BR-007). */
  canTrade: boolean
}>()

const emit = defineEmits<{ order: [side: 'BUY' | 'SELL', qty: OrderQty]; close: [] }>()

const { t } = useI18n()
const { locale } = useLocale()

const qty = ref<OrderQty>(50)

const you = computed(() => props.state.you)
// Role from the room view, which arrives before the first tick, so controls do not flicker in.
const isPlayer = computed(() => props.view.you.role === 'player')
const eliminated = computed(() => you.value?.status === 'eliminated')
const price = computed(() => props.state.price)

/** Percent since the starting price, like the single-play header. */
const change = computed(() => (price.value === null ? 0 : (price.value / START_PRICE - 1) * 100))
const open = computed(() =>
  you.value === null || price.value === null ? 0 : unrealized(you.value, price.value),
)
const startCash = computed(() => props.view.startCash)
const goal = computed(() => props.view.goal)
// Before the first tick, and for an observer (who has no equity), the progress rests at the start.
const equity = computed(() =>
  isPlayer.value && you.value !== null ? you.value.equity : startCash.value,
)
// Total result: equity - starting capital (BR-005); the goal itself is an equity (BR-009).
const total = computed(() => equity.value - startCash.value)

const tone = (n: number): string => (n > 0 ? 'up' : n < 0 ? 'down' : '')
const arrow = (n: number): string => (n > 0 ? '▲ ' : n < 0 ? '▼ ' : '')

const progress = computed(() => goalProgress(equity.value, startCash.value, goal.value))
// ARIA wants the value inside the range; equity can sit below the start or above the goal.
const progressNow = computed(() =>
  Math.round(Math.min(goal.value, Math.max(startCash.value, equity.value))),
)

const formatQty = (n: OrderQty): string => `${n} ${t('single.units')}`

// Orders by keyboard, same guard as single play; the server rejects anything it should (FR-012).
const ACTIONS = {
  buy: () => emit('order', 'BUY', qty.value),
  sell: () => emit('order', 'SELL', qty.value),
  close: () => emit('close'),
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.canTrade || isTypingTarget(event.target)) return
  const action = orderKey(event)
  if (action !== null) ACTIONS[action]()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section class="round" aria-labelledby="round-title">
    <h2 id="round-title" class="sr-only">{{ view.name }}</h2>

    <div class="ticker">
      <div class="quote">
        <div class="price num">{{ price === null ? '—' : formatMoney(price, locale) }}</div>
        <div class="chg num" :class="tone(change)">
          {{ arrow(change) }}{{ formatSigned(change, locale) }}%
        </div>
      </div>
      <NewsBar class="ticker-news" :news="state.news" :age="state.newsAgeTicks" :locale="locale" />
    </div>

    <div class="chart-wrap">
      <PriceChart
        :prices="state.history"
        :avg="you !== null && you.units !== 0 ? you.avg : null"
        :locale="locale"
        :entry-label="t('single.entry')"
      />
    </div>

    <p v-if="eliminated" class="banner down-banner" role="status">{{ t('round.eliminated') }}</p>
    <p v-else-if="!isPlayer" class="banner" role="status">
      {{ t('round.observerHint') }}
    </p>

    <div v-if="isPlayer" class="controls">
      <div class="actions">
        <button type="button" class="big buy" :disabled="!canTrade" @click="ACTIONS.buy()">
          <span>{{ t('single.buy') }}</span>
          <small>{{ t('single.key') }} B</small>
        </button>
        <button type="button" class="big flat" :disabled="!canTrade" @click="ACTIONS.close()">
          <span>{{ t('single.close') }}</span>
          <small>{{ t('single.key') }} C</small>
        </button>
        <button type="button" class="big sell" :disabled="!canTrade" @click="ACTIONS.sell()">
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

    <div v-if="isPlayer && you" class="stats">
      <div class="stat">
        <span class="label">{{ t('single.capital') }}</span>
        <div class="num">{{ formatMoney(you.equity, locale) }}</div>
      </div>
      <div class="stat">
        <span class="label">{{ t('single.open') }}</span>
        <div class="num" :class="tone(open)">{{ arrow(open) }}{{ formatSigned(open, locale) }}</div>
      </div>
      <div class="stat">
        <span class="label">{{ t('single.pos') }}</span>
        <div class="num">
          <template v-if="you.units !== 0">
            {{
              t('round.position', {
                units: `${you.units > 0 ? '+' : ''}${you.units}`,
                avg: formatMoney(you.avg, locale),
              })
            }}
          </template>
          <template v-else>{{ t('single.none') }}</template>
        </div>
      </div>
      <div class="stat">
        <span class="label">{{ t('single.total') }}</span>
        <div class="num" :class="tone(total)">
          {{ arrow(total) }}{{ formatSigned(total, locale) }}
        </div>
      </div>
    </div>

    <div class="target">
      <p class="round-name">{{ view.name }}</p>
      <div class="target-row">
        <span class="timer">
          <span class="label">{{ t('round.countdown') }}</span>
          <span class="clock num">
            {{ state.endsInMs === null ? '–:––' : formatCountdown(state.endsInMs) }}
          </span>
        </span>
        <span class="goal">
          <span class="label">{{ t('round.target') }}</span>
          <span class="num">
            {{ formatDecimal(equity, 0, locale) }} / {{ formatDecimal(goal, 0, locale) }}
          </span>
        </span>
      </div>
      <div
        class="bar"
        role="progressbar"
        :aria-label="t('round.targetProgress')"
        :aria-valuemin="startCash"
        :aria-valuemax="goal"
        :aria-valuenow="progressNow"
      >
        <div class="fill" :style="{ width: `${progress * 100}%` }" />
      </div>
    </div>

    <section aria-labelledby="ranking-title" class="ranking">
      <h3 id="ranking-title" class="label">{{ t('round.ranking') }}</h3>
      <ol class="rows">
        <li
          v-for="row in state.ranking"
          :key="row.nick"
          class="rank"
          :class="{ me: row.nick === view.you.nick }"
        >
          <span class="place num">{{ row.place }}.</span>
          <span class="nick">
            {{ row.nick }}
            <span v-if="row.nick === view.you.nick" class="note">({{ t('round.you') }})</span>
            <span v-if="row.status !== 'active'" class="note">
              · {{ t(`lobby.status.${row.status}`) }}
            </span>
          </span>
          <span class="num">{{ formatMoney(row.equity, locale) }}</span>
        </li>
      </ol>
    </section>
  </section>
</template>

<style scoped>
.round {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.clock {
  font-size: 1.2rem;
  font-weight: 700;
  line-height: 1.1;
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

.target {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.target-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 0.85rem;
}

.round-name {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.timer,
.goal {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.bar {
  height: 8px;
  background: var(--border);
  border-radius: 4px;
  overflow: hidden;
}

.fill {
  height: 100%;
  background: var(--gold);
}

@media (prefers-reduced-motion: no-preference) {
  .fill {
    transition: width 0.3s;
  }
}

.chart-wrap {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.banner {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  font-size: 0.85rem;
  color: var(--muted);
}

.down-banner {
  color: var(--down);
  border-color: var(--down);
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
  gap: 10px;
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

.ranking h3 {
  margin: 0 0 6px;
  font-weight: 500;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
}

.rank {
  display: grid;
  grid-template-columns: 2.2em 1fr auto;
  gap: 8px;
  align-items: baseline;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.88rem;
}

.rank.me {
  font-weight: 700;
}

.nick {
  min-width: 0;
  overflow-wrap: anywhere;
}

.note {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 400;
}
</style>
