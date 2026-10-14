import { NEWS_FADE_TICKS } from '@fm/shared/config'
import type { NewsEvent } from '@fm/shared/engine/news'
import { formatDecimal } from '../i18n/format'
import type { Locale } from '../i18n/locale'

export type NewsTone = 'up' | 'down' | 'warn' | 'none'

/**
 * Highlight of the news bar (FR-005): green/red by direction, neutral gold for VOL_SPIKE,
 * none once the news is older than `NEWS_FADE_TICKS` (prototype: age <= 90 is hot).
 */
export function newsTone(news: NewsEvent | null, newsAge: number): NewsTone {
  if (news === null || newsAge > NEWS_FADE_TICKS) return 'none'
  switch (news.type) {
    case 'SHOCK':
    case 'TREND':
      return news.dir > 0 ? 'up' : 'down'
    case 'FLASH_CRASH':
      return 'down'
    case 'VOL_SPIKE':
      return 'warn'
  }
}

export interface NewsMessage {
  readonly key: string
  readonly params: Readonly<Record<string, string>>
}

// U+2212: a real minus sign, as in the prototype.
const signed = (dir: 1 | -1, fraction: number, locale: Locale): string =>
  `${dir > 0 ? '+' : '−'}${formatDecimal(fraction * 100, 1, locale)}%`

/** i18n key and parameters for the news bar; the engine sends data, never text (FR-005). */
export function newsMessage(news: NewsEvent | null, locale: Locale): NewsMessage {
  if (news === null) return { key: 'news.none', params: {} }
  switch (news.type) {
    case 'SHOCK':
      return {
        key: `news.shock.${news.dir > 0 ? 'up' : 'down'}.${news.idx}`,
        params: { p: signed(news.dir, news.mag, locale) },
      }
    case 'FLASH_CRASH':
      return { key: 'news.flash', params: { x: signed(-1, news.drop, locale) } }
    case 'VOL_SPIKE':
      return { key: 'news.vol', params: {} }
    case 'TREND':
      return { key: news.dir > 0 ? 'news.trend.up' : 'news.trend.down', params: {} }
  }
}
