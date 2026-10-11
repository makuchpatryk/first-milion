import { NEWS_FADE_TICKS, SHOCK_TEXT_COUNT } from '@fm/shared/config'
import type { NewsEvent } from '@fm/shared/engine/news'
import { describe, expect, it } from 'vitest'
import en from '../i18n/en.json'
import pl from '../i18n/pl.json'
import { newsMessage, newsTone } from './newsTone'

function lookup(messages: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return typeof node === 'object' && node !== null && part in node
      ? (node as Record<string, unknown>)[part]
      : undefined
  }, messages)
}

describe('newsTone', () => {
  it('FR-005: VOL_SPIKE and TRADING_HALT are neutral (warn)', () => {
    expect(newsTone({ type: 'VOL_SPIKE' }, 0)).toBe('warn')
    expect(newsTone({ type: 'TRADING_HALT' }, 0)).toBe('warn')
  })

  it('FR-005: SHOCK and TREND are green/red by direction', () => {
    expect(newsTone({ type: 'SHOCK', dir: 1, mag: 0.02, idx: 0 }, 0)).toBe('up')
    expect(newsTone({ type: 'SHOCK', dir: -1, mag: 0.02, idx: 0 }, 0)).toBe('down')
    expect(newsTone({ type: 'TREND', dir: 1 }, 0)).toBe('up')
    expect(newsTone({ type: 'TREND', dir: -1 }, 0)).toBe('down')
  })

  it('FR-005: FLASH_CRASH is red', () => {
    expect(newsTone({ type: 'FLASH_CRASH', drop: 0.05 }, 0)).toBe('down')
  })

  it('FR-005: no news has no highlight', () => {
    expect(newsTone(null, 0)).toBe('none')
  })

  it('FR-005: the highlight fades after 90 ticks (still lit at 90, gone at 91)', () => {
    const news: NewsEvent = { type: 'TREND', dir: 1 }
    expect(newsTone(news, NEWS_FADE_TICKS)).toBe('up')
    expect(newsTone(news, NEWS_FADE_TICKS + 1)).toBe('none')
  })
})

describe('newsMessage', () => {
  it('FR-005: shock headlines are picked by direction and index, with a signed percent', () => {
    const up = newsMessage({ type: 'SHOCK', dir: 1, mag: 0.0153, idx: 2 }, 'pl')
    expect(up).toEqual({ key: 'news.shock.up.2', params: { p: '+1,5%' } })

    const down = newsMessage({ type: 'SHOCK', dir: -1, mag: 0.0153, idx: 3 }, 'en')
    expect(down).toEqual({ key: 'news.shock.down.3', params: { p: '−1.5%' } })
  })

  it('FR-005: flash crash carries the drop as a negative percent', () => {
    expect(newsMessage({ type: 'FLASH_CRASH', drop: 0.052 }, 'pl').params).toEqual({
      x: '−5,2%',
    })
  })

  it('FR-005: no news shows the opening message', () => {
    expect(newsMessage(null, 'pl').key).toBe('news.none')
  })

  it('FR-005 / FR-019: every message key exists in PL and EN', () => {
    const events: NewsEvent[] = [
      { type: 'FLASH_CRASH', drop: 0.04 },
      { type: 'VOL_SPIKE' },
      { type: 'TRADING_HALT' },
      { type: 'TREND', dir: 1 },
      { type: 'TREND', dir: -1 },
    ]
    for (let idx = 0; idx < SHOCK_TEXT_COUNT; idx++) {
      events.push(
        { type: 'SHOCK', dir: 1, mag: 0.02, idx },
        { type: 'SHOCK', dir: -1, mag: 0.02, idx },
      )
    }
    for (const event of [null, ...events]) {
      const { key } = newsMessage(event, 'pl')
      expect(typeof lookup(pl, key), key).toBe('string')
      expect(typeof lookup(en, key), key).toBe('string')
    }
  })
})
