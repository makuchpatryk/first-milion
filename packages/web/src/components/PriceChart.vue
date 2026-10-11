<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatMoney } from '../i18n/format'
import type { Locale } from '../i18n/locale'
import { chartGeometry, drawChart, type ChartColors } from './priceChart'

const props = defineProps<{
  prices: readonly number[]
  /** Entry price of the open position, `null` when flat. */
  avg: number | null
  locale: Locale
  entryLabel: string
}>()

const { t } = useI18n()
const canvas = ref<HTMLCanvasElement | null>(null)
let observer: ResizeObserver | null = null

const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function colors(): ChartColors {
  return {
    grid: token('--grid'),
    muted: token('--muted'),
    up: token('--up'),
    gold: token('--gold'),
    onGold: token('--on-gold'),
    font: token('--font-data'),
  }
}

function draw(): void {
  const cv = canvas.value
  const ctx = cv?.getContext('2d')
  if (!cv || !ctx) return

  const dpr = window.devicePixelRatio || 1
  const width = cv.clientWidth
  const height = cv.clientHeight
  if (cv.width !== Math.round(width * dpr)) {
    cv.width = Math.round(width * dpr)
    cv.height = Math.round(height * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  drawChart(ctx, chartGeometry(props.prices, props.avg, width, height), colors(), {
    format: (n) => formatMoney(n, props.locale),
    entry: props.entryLabel,
  })
}

watch(() => [props.prices, props.avg, props.locale, props.entryLabel] as const, draw, {
  flush: 'post',
})

onMounted(() => {
  draw()
  const cv = canvas.value
  if (cv && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(draw)
    observer.observe(cv)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <canvas ref="canvas" class="chart" role="img" :aria-label="t('single.chartLabel')" />
</template>

<style scoped>
.chart {
  display: block;
  width: 100%;
  height: 260px;
}
</style>
