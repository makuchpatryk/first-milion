<script setup lang="ts">
import type { NewsEvent } from '@fm/shared/engine/news'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Locale } from '../i18n/locale'
import { newsMessage, newsTone } from './newsTone'

const props = defineProps<{
  news: NewsEvent | null
  /** Ticks since `news` was drawn. */
  age: number
  locale: Locale
}>()

const { t } = useI18n()

const tone = computed(() => newsTone(props.news, props.age))
const text = computed(() => {
  const { key, params } = newsMessage(props.news, props.locale)
  return t(key, params)
})
</script>

<template>
  <div class="news" :class="tone" aria-live="polite">{{ text }}</div>
</template>

<style scoped>
.news {
  min-height: 2.6em;
  font-size: 0.85rem;
  color: var(--muted);
  border-left: 3px solid var(--border);
  padding-left: 10px;
  display: flex;
  align-items: center;
  line-height: 1.35;
}

.news.up,
.news.down,
.news.warn {
  color: var(--text);
}

.news.up {
  border-color: var(--up);
}

.news.down {
  border-color: var(--down);
}

.news.warn {
  border-color: var(--gold);
}
</style>
