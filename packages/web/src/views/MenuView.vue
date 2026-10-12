<script setup lang="ts">
import { SPEEDS } from '@fm/shared/rules'
import { I18nT, useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { session } from '../auth/session'

const { t } = useI18n()

const speeds = SPEEDS.map((s) => `${s}×`).join('  ')
</script>

<template>
  <section class="menu" aria-labelledby="menu-title">
    <header>
      <h1 id="menu-title">{{ t('menu.title') }}</h1>
      <I18nT keypath="menu.loggedInAs" tag="p" class="notice" scope="global">
        <template #nick>
          <span class="num nick">{{ session.user?.nick }}</span>
        </template>
      </I18nT>
    </header>

    <div class="modes">
      <RouterLink to="/single" class="card">
        <span class="card-head">
          <span class="card-title">{{ t('menu.singleTitle') }}</span>
          <span class="num card-tag">{{ speeds }}</span>
        </span>
        <span class="card-desc">{{ t('menu.singleDesc') }}</span>
      </RouterLink>

      <RouterLink to="/rooms" class="card">
        <span class="card-head">
          <span class="card-title">{{ t('menu.roomsTitle') }}</span>
        </span>
        <span class="card-desc">{{ t('menu.roomsDesc') }}</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.menu {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: -0.02em;
  font-weight: 700;
}

header p {
  margin: 4px 0 0;
  font-size: 13px;
}

.nick {
  color: var(--text);
}

.modes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 18px;
  color: var(--text);
  text-decoration: none;
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 20px;
  font-weight: 700;
}

.card-tag {
  font-size: 12px;
  color: var(--muted);
}

.card-desc {
  color: var(--muted);
  font-size: 14px;
  line-height: 1.4;
}
</style>
