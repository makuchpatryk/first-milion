export type OrderKey = 'buy' | 'sell' | 'close'

const TYPING_TAGS: readonly string[] = ['INPUT', 'TEXTAREA', 'SELECT']

/** Keystrokes aimed at a form field are text, not trading shortcuts (UF-002). */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && TYPING_TAGS.includes(target.tagName)
}

/**
 * B / S / C map to buy / sell / close (FR-004). Browser shortcuts such as Ctrl+S are left alone,
 * so a modified key never trades.
 */
export function orderKey(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): OrderKey | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  switch (event.key.toLowerCase()) {
    case 'b':
      return 'buy'
    case 's':
      return 'sell'
    case 'c':
      return 'close'
    default:
      return null
  }
}
