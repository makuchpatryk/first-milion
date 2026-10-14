<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { session } from './auth/session'
import ChipGroup from './components/ChipGroup.vue'
import { useLocale } from './i18n'
import { LOCALES } from './i18n/locale'
import { backFor } from './router/back'

const { t } = useI18n()
const { locale, setLocale } = useLocale()
const route = useRoute()

const back = computed(() => backFor(route.path, session.status))
// Settings (which hold the language) exist only for a verified user; everyone else switches the
// language in the bar.
const verified = computed(() => session.status === 'verified')
</script>

<template>
  <div class="shell">
    <a href="#main" class="skip">{{ t('app.skipToContent') }}</a>
    <header class="bar">
      <RouterLink to="/menu" class="logo">
        <svg class="logo-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <rect class="logo-bg" width="32" height="32" rx="8" />
          <path class="logo-line" d="M6 23l7-7 5 4 8-10" />
          <path class="logo-line" d="M20 10h6v6" />
        </svg>
        <span class="logo-text">
          {{ t('app.brandFirst') }} <span>{{ t('app.brandSecond') }}</span>
        </span>
      </RouterLink>
      <RouterLink
        v-if="verified"
        to="/settings"
        class="settings-link"
        :aria-label="t('nav.settings')"
        :title="t('nav.settings')"
      >
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
        </svg>
      </RouterLink>
      <ChipGroup
        v-else
        :label="t('common.language')"
        :items="LOCALES"
        :model-value="locale"
        :format="(l) => String(l).toUpperCase()"
        @update:model-value="setLocale"
      />
    </header>
    <nav v-if="back" class="crumbs" :aria-label="t('nav.label')">
      <RouterLink :to="back.to" class="back">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span>{{ t(back.labelKey) }}</span>
      </RouterLink>
    </nav>
    <main id="main" tabindex="-1">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.shell {
  max-width: 720px;
  margin-inline: auto;
  padding: 8px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.logo {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  color: var(--text);
  text-decoration: none;
}

.logo-icon {
  width: 26px;
  height: 26px;
  flex: none;
}

.logo-bg {
  fill: var(--gold);
}

.logo-line {
  fill: none;
  stroke: var(--on-gold);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.logo-text {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.logo-text span {
  color: var(--gold);
}

.icon {
  width: 18px;
  height: 18px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Not `.settings`: a parent's scoped style also reaches the root of the routed view, and the
   settings page's root section has that class. */
.settings-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}

.settings-link .icon {
  width: 16px;
  height: 16px;
}

.settings-link[aria-current='page'] {
  border-color: var(--gold);
  color: var(--gold);
}

.crumbs {
  margin-top: -4px;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  padding: 0 14px 0 8px;
  border-radius: 6px;
  color: var(--muted);
  font: 500 14px var(--font-ui);
  text-decoration: none;
}

.back:hover {
  background: var(--surface);
  color: var(--text);
}

main:focus {
  outline: none;
}

/* Visible only when focused by keyboard, then jumps past the header controls (WCAG 2.4.1). */
.skip {
  position: absolute;
  left: 8px;
  top: -48px;
  background: var(--gold);
  color: var(--on-gold);
  padding: 10px 14px;
  border-radius: 6px;
  font-weight: 700;
  text-decoration: none;
}

.skip:focus {
  top: 8px;
  z-index: 10;
}
</style>
