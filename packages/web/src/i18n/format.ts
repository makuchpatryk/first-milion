import type { Locale } from './locale'

const INTL_LOCALE: Record<Locale, string> = { pl: 'pl-PL', en: 'en-US' }

const formatters = new Map<string, Intl.NumberFormat>()

/** One `Intl.NumberFormat` per locale and digit count; the chart formats on every tick. */
function formatter(locale: Locale, digits: number): Intl.NumberFormat {
  const key = `${locale}:${digits}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(INTL_LOCALE[locale], {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    formatters.set(key, f)
  }
  return f
}

export function formatDecimal(n: number, digits: number, locale: Locale): string {
  return formatter(locale, digits).format(n)
}

/** Money and prices: 2 decimals, per-locale separators (FR-019). Sign is added by callers. */
export function formatMoney(n: number, locale: Locale): string {
  return formatDecimal(n, 2, locale)
}

/** Signed variant for results: "+1,50" / "-1,50" / "0,00". */
export function formatSigned(n: number, locale: Locale): string {
  const text = formatMoney(n, locale)
  return n > 0 ? `+${text}` : text
}
