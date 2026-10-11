import { computed, type ComputedRef } from 'vue'
import { createI18n, useI18n } from 'vue-i18n'
import en from './en.json'
import { saveLocale, type Locale } from './locale'
import pl from './pl.json'

export function createAppI18n(locale: Locale) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { pl, en },
  })
}

/** Current language and its switch: persists the choice and keeps `<html lang>` true (FR-019). */
export function useLocale(): { locale: ComputedRef<Locale>; setLocale: (l: Locale) => void } {
  const i18n = useI18n()
  const locale = computed<Locale>(() => (i18n.locale.value === 'pl' ? 'pl' : 'en'))

  function setLocale(l: Locale): void {
    i18n.locale.value = l
    document.documentElement.lang = l
    saveLocale(l)
  }

  return { locale, setLocale }
}
