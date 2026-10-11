<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterView } from 'vue-router'
import ChipGroup from './components/ChipGroup.vue'
import { useLocale } from './i18n'
import { LOCALES } from './i18n/locale'

const { t } = useI18n()
const { locale, setLocale } = useLocale()
</script>

<template>
  <div class="shell">
    <a href="#main" class="skip">{{ t('app.skipToContent') }}</a>
    <header class="bar">
      <ChipGroup
        :label="t('common.language')"
        :items="LOCALES"
        :model-value="locale"
        :format="(l) => String(l).toUpperCase()"
        @update:model-value="setLocale"
      />
    </header>
    <main id="main" tabindex="-1">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.shell {
  max-width: 720px;
  margin-inline: auto;
  padding: 16px 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bar {
  display: flex;
  justify-content: flex-end;
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
