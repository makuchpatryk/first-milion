import { createApp } from 'vue'
import App from './App.vue'
import { ensureNick } from './auth/actions'
import { init, ready } from './auth/session'
import { createAppI18n } from './i18n'
import { readSavedLocale, resolveLocale } from './i18n/locale'
import { createAppRouter } from './router'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'

async function bootstrap(): Promise<void> {
  const locale = resolveLocale(readSavedLocale(), navigator.language)
  document.documentElement.lang = locale

  init(ensureNick)
  // Wait for the first auth event so the first frame is already the right screen (FR-001).
  await ready

  createApp(App).use(createAppI18n(locale)).use(createAppRouter()).mount('#app')
}

void bootstrap()
