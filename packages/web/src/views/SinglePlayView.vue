<script setup lang="ts">
import { ORDER_QTYS, SPEEDS, type OrderQty, type Speed } from '@fm/shared/rules'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import ChipGroup from '../components/ChipGroup.vue'
import NewsBar from '../components/NewsBar.vue'
import PriceChart from '../components/PriceChart.vue'
import { useLocale } from '../i18n'
import { formatDecimal, formatMoney, formatSigned } from '../i18n/format'
import { useSinglePlay } from '../single/useSinglePlay'
import { isTypingTarget, orderKey } from './keys'

const { t } = useI18n()
const { locale } = useLocale()

const {
  sim,
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
  halted,
  buy,
  sell,
  close,
  restart,
  togglePause,
} = useSinglePlay()

const tone = (n: number): string => (n > 0 ? 'up' : n < 0 ? 'down' : '')

const formatQty = (n: OrderQty): string => `${n} ${t('single.units')}`
const formatSpeed = (s: Speed): string => `${s}×`

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
  () => sim.value.over,
  async (over) => {
    if (!over) return
    await nextTick()
    againButton.value?.focus()
  },
)
</script>

<template>
  <section class="single" aria-labelledby="single-title">
    <div class="top">
      <span class="mode"><b>●</b> {{ t('single.mode') }}</span>
      <RouterLink to="/menu" class="link link-muted">{{ t('single.menu') }}</RouterLink>
    </div>

    <header>
      <div>
        <h1 id="single-title">
          {{ t('app.brandFirst') }} <span>{{ t('app.brandSecond') }}</span>
        </h1>
        <p class="sub">{{ t('single.sub') }}</p>
      </div>
      <div class="quote">
        <div class="price num">{{ formatMoney(price, locale) }}</div>
        <div class="chg num" :class="tone(change)">{{ formatSigned(change, locale) }}%</div>
      </div>
    </header>

    <NewsBar :news="sim.market.news" :age="sim.market.newsAge" :locale="locale" />

    <div class="chart-wrap">
      <PriceChart
        :prices="prices"
        :avg="sim.portfolio.units !== 0 ? sim.portfolio.avg : null"
        :locale="locale"
        :entry-label="t('single.entry')"
      />
      <div v-if="halted" class="halt" role="status">
        <span>{{ t('single.haltBar') }}</span>
        <span class="num" aria-hidden="true">
          {{ formatDecimal(sim.market.haltMsLeft / 1000, 1, locale) }} s
        </span>
      </div>
      <div v-if="sim.over" class="over" role="alertdialog" aria-labelledby="over-title">
        <h2 id="over-title">{{ t('single.marginCall') }}</h2>
        <p class="sub">
          {{
            t('single.marginCallMsg', {
              n: sim.portfolio.closedTrades,
              p: formatMoney(sim.peak, locale),
            })
          }}
        </p>
        <button ref="againButton" type="button" class="chip" @click="restart">
          {{ t('single.again') }}
        </button>
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

    <div class="controls">
      <div class="row">
        <span class="label lbl">{{ t('single.size') }}</span>
        <ChipGroup
          v-model="qty"
          :label="t('single.size')"
          :items="ORDER_QTYS"
          :format="formatQty"
        />
      </div>
      <div class="row">
        <span class="label lbl">{{ t('single.speed') }}</span>
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

      <div class="actions">
        <button type="button" class="big buy" :disabled="halted || sim.over" @click="buy">
          <span>{{ t('single.buy') }}</span>
          <small>{{ t('single.key') }} B</small>
        </button>
        <button type="button" class="big flat" :disabled="halted || sim.over" @click="close">
          <span>{{ t('single.close') }}</span>
          <small>{{ t('single.key') }} C</small>
        </button>
        <button type="button" class="big sell" :disabled="halted || sim.over" @click="sell">
          <span>{{ t('single.sell') }}</span>
          <small>{{ t('single.key') }} S</small>
        </button>
      </div>
      <p class="hint">{{ t('single.hint') }}</p>
    </div>

    <div>
      <h2 class="label hist-title">{{ t('single.hist') }}</h2>
      <p v-if="sim.history.length === 0" class="empty">{{ t('single.histEmpty') }}</p>
      <ul v-else class="hist">
        <li v-for="(trade, i) in sim.history" :key="i" class="item">
          <span class="side" :class="trade.dir > 0 ? 'up' : 'down'">
            {{ trade.dir > 0 ? t('single.long') : t('single.short') }}
          </span>
          <span class="det num">
            {{ trade.units }} {{ t('single.units') }} {{ formatMoney(trade.entry, locale) }} →
            {{ formatMoney(trade.exit, locale) }}
          </span>
          <span class="num" :class="tone(trade.pnl)">{{ formatSigned(trade.pnl, locale) }}</span>
        </li>
      </ul>
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
  </section>
</template>

<style scoped>
.single {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.mode {
  font: 500 0.72rem var(--font-data);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.mode b {
  color: var(--gold);
  font-weight: 500;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

h1 {
  font-size: 1.7rem;
  margin: 0;
  letter-spacing: -0.03em;
  font-weight: 700;
}

h1 span {
  color: var(--gold);
}

.sub {
  color: var(--muted);
  font-size: 0.8rem;
  margin: 4px 0 0;
  max-width: 34ch;
  line-height: 1.4;
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

.over .sub {
  max-width: 32ch;
  margin: 0;
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

.hint {
  font-size: 0.72rem;
  color: var(--muted);
  margin: 0;
  line-height: 1.45;
}

.hist-title {
  margin: 8px 0 6px;
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

.side {
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
