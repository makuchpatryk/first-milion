<script setup lang="ts">
import { NICK_MAX } from '@fm/shared/rules'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'
import { changeNick, deleteAccount, logout, type ActionResult } from '../auth/actions'
import { session } from '../auth/session'
import ChipGroup from '../components/ChipGroup.vue'
import { useLocale } from '../i18n'
import { LOCALES, type Locale } from '../i18n/locale'

const { t } = useI18n()
const { locale, setLocale } = useLocale()
const router = useRouter()

type Panel = 'nick' | 'delete' | null
const panel = ref<Panel>(null)
const newNick = ref('')
const password = ref('')
const errorKey = ref<string | null>(null)
const busy = ref(false)

function open(next: Exclude<Panel, null>): void {
  panel.value = next
  errorKey.value = null
  newNick.value = ''
  password.value = ''
}

function close(): void {
  panel.value = null
  errorKey.value = null
}

async function run(action: () => Promise<ActionResult>): Promise<boolean> {
  busy.value = true
  errorKey.value = null
  const result = await action()
  busy.value = false
  if (!result.ok) errorKey.value = result.errorKey
  return result.ok
}

async function saveNick(): Promise<void> {
  if (await run(() => changeNick(newNick.value))) close()
}

async function removeAccount(): Promise<void> {
  if (await run(() => deleteAccount(password.value))) await router.replace('/login')
}

async function leave(): Promise<void> {
  if (await run(logout)) await router.replace('/login')
}

function chooseLocale(next: Locale): void {
  setLocale(next)
}
</script>

<template>
  <section class="settings" aria-labelledby="settings-title">
    <h1 id="settings-title">{{ t('settings.title') }}</h1>

    <div class="list">
      <div class="row">
        <span>{{ t('account.nick') }}</span>
        <span class="row-end">
          <span class="num muted">{{ session.user?.nick }}</span>
          <button type="button" class="chip" @click="open('nick')">
            {{ t('account.change') }}
          </button>
        </span>
      </div>
      <form v-if="panel === 'nick'" class="panel" novalidate @submit.prevent="saveNick">
        <div class="field">
          <label for="new-nick">{{ t('account.nickLabel') }}</label>
          <input
            id="new-nick"
            v-model="newNick"
            class="input"
            type="text"
            autocomplete="nickname"
            :maxlength="NICK_MAX"
          />
          <p class="notice">{{ t('account.nickHint') }}</p>
        </div>
        <p v-if="errorKey" class="error" role="alert">{{ t(errorKey) }}</p>
        <div class="panel-actions">
          <button type="submit" class="btn" :disabled="busy">{{ t('common.save') }}</button>
          <button type="button" class="link link-muted" @click="close">
            {{ t('common.cancel') }}
          </button>
        </div>
      </form>

      <div class="row">
        <span>{{ t('account.language') }}</span>
        <ChipGroup
          :label="t('account.language')"
          :items="LOCALES"
          :model-value="locale"
          :format="(l: Locale) => l.toUpperCase()"
          @update:model-value="chooseLocale"
        />
      </div>

      <RouterLink to="/privacy" class="row row-link">{{ t('account.privacy') }}</RouterLink>

      <button type="button" class="row row-link" :disabled="busy" @click="leave">
        {{ t('account.logout') }}
      </button>

      <button type="button" class="row row-link row-danger" @click="open('delete')">
        {{ t('account.delete') }}
      </button>
      <form v-if="panel === 'delete'" class="panel" novalidate @submit.prevent="removeAccount">
        <p class="notice">{{ t('account.deleteWarning') }}</p>
        <div class="field">
          <label for="delete-password">{{ t('account.deletePassword') }}</label>
          <input
            id="delete-password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
          />
        </div>
        <p v-if="errorKey" class="error" role="alert">{{ t(errorKey) }}</p>
        <div class="panel-actions">
          <button type="submit" class="btn btn-danger" :disabled="busy">
            {{ t('account.deleteConfirm') }}
          </button>
          <button type="button" class="link link-muted" @click="close">
            {{ t('common.cancel') }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: none;
  padding: 0;
  font: inherit;
  color: var(--text);
  text-decoration: none;
  text-align: left;
  width: 100%;
}

.row-link {
  cursor: pointer;
  justify-content: flex-start;
}

.row-danger {
  color: var(--down);
}

.row-end {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.muted {
  color: var(--muted);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 0 16px;
  border-bottom: 1px solid var(--border);
}

.panel-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
