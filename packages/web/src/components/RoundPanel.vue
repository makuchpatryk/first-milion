<script setup lang="ts">
import { unrealized } from '@fm/shared/engine/portfolio'
import type { RoomView } from '@fm/shared/protocol'
import { ORDER_QTYS, START_CASH, START_PRICE, type OrderQty } from '@fm/shared/rules'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocale } from '../i18n'
import { formatDecimal, formatMoney, formatSigned } from '../i18n/format'
import { formatCountdown, targetProgress } from '../room/countdown'
import { shownHistory, type RoomState } from '../room/room-state'
import { isTypingTarget, orderKey } from '../views/keys'
import ChipGroup from './ChipGroup.vue'
import NewsBar from './NewsBar.vue'
import PriceChart from './PriceChart.vue'

const props = defineProps<{
  view: RoomView
  state: RoomState
  /** Socket ready, active player, no halt (`canTrade`); the server still decides (BR-007). */
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
const halted = computed(() => props.state.halt !== null)
const price = computed(() => props.state.price)

/** Percent since the starting price, like the single-play header. */
const change = computed(() => (price.value === null ? 0 : (price.value / START_PRICE - 1) * 100))
const open = computed(() =>
  you.value === null || price.value === null ? 0 : unrealized(you.value, price.value),
)
// Target and ranking count the total result: equity - start cash (decision 30).
const total = computed(() => (you.value === null ? 0 : you.value.equity - START_CASH))

const tone = (n: number): string => (n > 0 ? 'up' : n < 0 ? 'down' : '')
const arrow = (n: number): string => (n > 0 ? '▲ ' : n < 0 ? '▼ ' : '')

const target = computed(() => props.view.profitTarget)
const progress = computed(() => targetProgress(total.value, target.value))

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

    <header>
      <div class="timer">
        <span class="label">{{ t('round.countdown') }}</span>
        <div class="clock num">
          {{ state.endsInMs === null ? '–:––' : formatCountdown(state.endsInMs) }}
        </div>
      </div>
      <div class="quote">
        <div class="price num">{{ price === null ? '—' : formatMoney(price, locale) }}</div>
        <div class="chg num" :class="tone(change)">
          {{ arrow(change) }}{{ formatSigned(change, locale) }}%
        </div>
      </div>
    </header>

    <div class="target">
      <div class="target-row">
        <span class="label">{{ t('round.target') }}</span>
        <span class="num">
          {{ formatSigned(total, locale) }} / {{ formatDecimal(target, 0, locale) }}
        </span>
      </div>
      <div
        class="bar"
        role="progressbar"
        :aria-label="t('round.targetProgress')"
        aria-valuemin="0"
        :aria-valuemax="target"
        :aria-valuenow="Math.round(progress * target)"
      >
        <div class="fill" :style="{ width: `${progress * 100}%` }" />
      </div>
    </div>

    <NewsBar :news="state.news" :age="state.newsAgeTicks" :locale="locale" />

    <div class="chart-wrap">
      <PriceChart
        :prices="shownHistory(state)"
        :avg="you !== null && you.units !== 0 ? you.avg : null"
        :locale="locale"
        :entry-label="t('single.entry')"
      />
      <div v-if="halted" class="halt" role="alert" aria-live="assertive">
        <span>{{ t('single.haltBar') }}</span>
        <span class="num" aria-hidden="true">
          {{
            t('round.haltSeconds', {
              s: formatDecimal((state.halt?.msLeft ?? 0) / 1000, 1, locale),
            })
          }}
        </span>
      </div>
    </div>

    <p v-if="eliminated" class="banner down-banner" role="status">{{ t('round.eliminated') }}</p>
    <p v-else-if="!isPlayer" class="banner" role="status">
      {{ t('round.observerHint') }}
    </p>

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

    <div v-if="isPlayer" class="controls">
      <div class="row">
        <span class="label lbl">{{ t('single.size') }}</span>
        <ChipGroup
          v-model="qty"
          :label="t('single.size')"
          :items="ORDER_QTYS"
          :format="formatQty"
        />
      </div>
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
  gap: 14px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
}

.clock {
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.1;
}

.quote {
  text-align: right;
}

.price {
  font-size: 2.1rem;
  font-weight: 700;
  line-height: 1;
}

.chg {
  font-size: 0.85rem;
  margin-top: 4px;
}

.target {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.target-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.85rem;
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

.halt {
  position: absolute;
  inset-inline: 0;
  top: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  background: var(--gold);
  color: var(--on-gold);
  padding: 8px 12px;
  font: 700 0.75rem var(--font-data);
  letter-spacing: 0.06em;
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
  padding: 10px 12px;
  min-width: 0;
}

.stat .label {
  display: block;
  font-size: 0.68rem;
  margin-bottom: 4px;
}

.stat .num {
  font-size: 1.05rem;
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
  min-height: 52px;
  padding: 18px 8px;
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
