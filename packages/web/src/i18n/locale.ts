export const LOCALES = ['pl', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_STORAGE_KEY = 'fm-lang'

const isLocale = (value: unknown): value is Locale => LOCALES.some((l) => l === value)

/**
 * Saved choice wins (allowlist, because it comes from `localStorage`); otherwise `pl*` browsers
 * get PL and everyone else EN (FR-019).
 */
export function resolveLocale(saved: unknown, navigatorLanguage: string): Locale {
  if (isLocale(saved)) return saved
  return navigatorLanguage.toLowerCase().startsWith('pl') ? 'pl' : 'en'
}

/** Reads the saved language; storage can be blocked or throw (private mode), then there is none. */
export function readSavedLocale(): unknown {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {
    return null
  }
}

/** The language choice is the only thing the app persists (BR-020, FR-019). */
export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Storage unavailable: the choice just lasts for this visit.
  }
}
