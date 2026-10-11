<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { session } from '../auth/session'
import { routeFor } from '../router/guards'

const { t } = useI18n()

// FR-018 scope: account data, infrastructure, game results, browser storage, deletion.
const SECTIONS = ['data', 'infra', 'game', 'browser', 'delete'] as const

// Public page: the way back is the visitor's home screen for their status (/login, /verify or /menu).
const home = computed(() => routeFor(session.status, '/menu') ?? '/menu')
</script>

<template>
  <article class="privacy" aria-labelledby="privacy-title">
    <RouterLink :to="home" class="link link-muted">{{ t('privacy.back') }}</RouterLink>
    <h1 id="privacy-title">{{ t('privacy.title') }}</h1>

    <section v-for="section in SECTIONS" :key="section">
      <h2>{{ t(`privacy.${section}Title`) }}</h2>
      <p>{{ t(`privacy.${section}Body`) }}</p>
    </section>
  </article>
</template>

<style scoped>
.privacy {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: -0.02em;
}

h2 {
  margin: 0 0 6px;
  font-size: 15px;
}

p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
}
</style>
