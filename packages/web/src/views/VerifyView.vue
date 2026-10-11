<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { checkVerified, logout, resendVerification, type ActionResult } from '../auth/actions'
import { session } from '../auth/session'

const { t } = useI18n()
const router = useRouter()

const errorKey = ref<string | null>(null)
const noticeKey = ref<string | null>(null)
const busy = ref(false)

async function run(action: () => Promise<ActionResult>): Promise<boolean> {
  busy.value = true
  errorKey.value = null
  noticeKey.value = null
  const result = await action()
  busy.value = false
  if (!result.ok) errorKey.value = result.errorKey
  return result.ok
}

async function resend(): Promise<void> {
  if (await run(resendVerification)) noticeKey.value = 'auth.resent'
}

async function confirm(): Promise<void> {
  if (!(await run(checkVerified))) return
  if (session.status === 'verified') await router.replace('/menu')
  else noticeKey.value = 'auth.verifyPending'
}

async function leave(): Promise<void> {
  if (await run(logout)) await router.replace('/login')
}
</script>

<template>
  <section class="verify" aria-labelledby="verify-title">
    <h1 id="verify-title">{{ t('auth.verifyTitle') }}</h1>
    <p class="notice">{{ t('auth.verifyBody', { email: session.user?.email ?? '' }) }}</p>

    <p v-if="errorKey" class="error" role="alert">{{ t(errorKey) }}</p>
    <p v-if="noticeKey" class="notice" role="status">{{ t(noticeKey) }}</p>

    <button type="button" class="btn" :disabled="busy" @click="confirm">
      {{ t('auth.verified') }}
    </button>
    <button type="button" class="chip" :disabled="busy" @click="resend">
      {{ t('auth.resend') }}
    </button>
    <button type="button" class="link link-muted" :disabled="busy" @click="leave">
      {{ t('auth.logout') }}
    </button>
  </section>
</template>

<style scoped>
.verify {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 16px;
}

h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: -0.02em;
}
</style>
