<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'
import { login, register, sendReset, type ActionResult } from '../auth/actions'

type Mode = 'login' | 'register'

const { t } = useI18n()
const router = useRouter()

const mode = ref<Mode>('login')
const email = ref('')
const password = ref('')
const errorKey = ref<string | null>(null)
const busy = ref(false)
const resetting = ref(false)
const resetSent = ref(false)

function setMode(next: Mode): void {
  mode.value = next
  errorKey.value = null
}

function startReset(): void {
  resetting.value = true
  resetSent.value = false
  errorKey.value = null
}

function backToLogin(): void {
  resetting.value = false
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

async function submit(): Promise<void> {
  const ok = await run(() =>
    mode.value === 'register'
      ? register(email.value, password.value)
      : login(email.value, password.value),
  )
  // The router guard sends an unverified account on to /verify (FR-001).
  if (ok) await router.replace('/')
}

async function submitReset(): Promise<void> {
  resetSent.value = await run(() => sendReset(email.value))
}
</script>

<template>
  <section class="login" aria-labelledby="login-title">
    <div class="hero">
      <p class="goal num">{{ t('app.goal') }}</p>
      <h1 id="login-title">
        {{ t('app.brandFirst') }}<br /><span>{{ t('app.brandSecond') }}</span>
      </h1>
      <p class="notice tagline">{{ t('app.tagline') }}</p>
    </div>

    <svg class="spark" viewBox="0 0 340 96" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points="0,70 20,64 40,68 60,58 80,60 100,50 120,56 140,44 160,48 180,36 200,42 220,30 240,38 260,24 280,28 300,16 320,22 340,10"
      />
    </svg>

    <form v-if="!resetting" class="form" novalidate @submit.prevent="submit">
      <div class="modes" role="group" :aria-label="t('auth.modeLabel')">
        <button
          type="button"
          class="chip"
          :aria-pressed="mode === 'login'"
          @click="setMode('login')"
        >
          {{ t('auth.login') }}
        </button>
        <button
          type="button"
          class="chip"
          :aria-pressed="mode === 'register'"
          @click="setMode('register')"
        >
          {{ t('auth.register') }}
        </button>
      </div>

      <div class="field">
        <label for="email">{{ t('auth.email') }}</label>
        <input
          id="email"
          v-model="email"
          class="input"
          type="email"
          autocomplete="email"
          :placeholder="t('auth.emailPlaceholder')"
        />
      </div>
      <div class="field">
        <label for="password">{{ t('auth.password') }}</label>
        <input
          id="password"
          v-model="password"
          class="input"
          type="password"
          :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
          :placeholder="t('auth.passwordPlaceholder')"
        />
      </div>

      <p v-if="errorKey" class="error" role="alert">{{ t(errorKey) }}</p>

      <button type="submit" class="btn" data-testid="auth-submit" :disabled="busy">
        {{ mode === 'register' ? t('auth.submitRegister') : t('auth.submitLogin') }}
      </button>
      <button type="button" class="link link-muted" @click="startReset">
        {{ t('auth.forgot') }}
      </button>
    </form>

    <form v-else class="form" novalidate @submit.prevent="submitReset">
      <h2 class="reset-title">{{ t('auth.resetTitle') }}</h2>
      <div class="field">
        <label for="reset-email">{{ t('auth.email') }}</label>
        <input
          id="reset-email"
          v-model="email"
          class="input"
          type="email"
          autocomplete="email"
          :placeholder="t('auth.emailPlaceholder')"
        />
      </div>

      <p v-if="errorKey" class="error" role="alert">{{ t(errorKey) }}</p>
      <p v-if="resetSent" class="notice" role="status">{{ t('auth.resetSent') }}</p>

      <button type="submit" class="btn" :disabled="busy">{{ t('auth.resetSubmit') }}</button>
      <button type="button" class="link link-muted" @click="backToLogin">
        {{ t('auth.resetBack') }}
      </button>
    </form>

    <footer class="foot notice">
      {{ t('auth.note') }}
      <RouterLink to="/privacy">{{ t('auth.privacy') }}</RouterLink>
    </footer>
  </section>
</template>

<style scoped>
.login {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.goal {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: 52px;
  line-height: 0.95;
  letter-spacing: -0.03em;
  font-weight: 700;
}

h1 span {
  color: var(--gold);
}

.tagline {
  font-size: 15px;
  line-height: 1.45;
}

.spark {
  width: 100%;
  height: 96px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.spark polyline {
  fill: none;
  stroke: var(--up);
  stroke-width: 1.8;
  stroke-linejoin: round;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modes {
  display: flex;
  gap: 6px;
}

.reset-title {
  margin: 0;
  font-size: 20px;
}

.foot {
  border-top: 1px solid var(--border);
  padding-top: 14px;
  font-size: 12px;
  line-height: 1.5;
}
</style>
