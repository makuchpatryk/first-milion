<script setup lang="ts">
import {
  DEFAULT_ROUND_DURATION_MIN,
  DEFAULT_SPEED,
  ROOM_NAME_MAX,
  ROUND_DURATIONS_MIN,
  SPEEDS,
} from '@fm/shared/rules'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import ChipGroup from '../components/ChipGroup.vue'
import { useLobby } from '../composables/use-lobby'
import { parseCreateForm } from '../room/create-form'
import { closeKey, errorKey } from '../room/error-map'

const { t } = useI18n()
const router = useRouter()

const lobby = useLobby()
const { state, status, closeCode } = lobby

const fields = reactive({
  name: '',
  durationMin: DEFAULT_ROUND_DURATION_MIN,
  speed: DEFAULT_SPEED,
  targetText: '',
})

// Errors show once the user has touched a field or tried to submit, not on an empty first view.
const touched = reactive({ name: false, target: false })
const parsed = computed(() => parseCreateForm(fields))
const errors = computed(() =>
  parsed.value.ok ? { name: null, target: null } : parsed.value.errors,
)
const submitted = ref(false)
// One `room.create` per attempt: a second click waits for the server's answer (room.created or an error).
const pending = ref(false)

const showName = computed(() => (touched.name || submitted.value) && errors.value.name !== null)
const showTarget = computed(
  () => (touched.target || submitted.value) && errors.value.target !== null,
)

function submit(): void {
  if (pending.value) return
  submitted.value = true
  lobby.clearError()
  if (!parsed.value.ok) return
  pending.value = true
  lobby.createRoom(parsed.value.form)
}

// The attempt is over on a server error, or when the socket stops being ready (the send was lost).
watch(
  () => [state.value.error, status.value] as const,
  ([error, socketStatus]) => {
    if (error !== null || socketStatus !== 'ready') pending.value = false
  },
)

// UF-003 step 3: the creator enters the lobby as host.
watch(
  () => state.value.createdRoomId,
  (id) => {
    if (id !== null) void router.push(`/rooms/${encodeURIComponent(id)}`)
  },
)
</script>

<template>
  <section class="create" aria-labelledby="create-title">
    <h1 id="create-title">{{ t('create.title') }}</h1>

    <form novalidate @submit.prevent="submit">
      <div class="field">
        <label for="room-name">{{ t('create.name') }}</label>
        <input
          id="room-name"
          v-model="fields.name"
          class="input"
          type="text"
          autocomplete="off"
          :maxlength="ROOM_NAME_MAX"
          :aria-invalid="showName"
          :aria-describedby="showName ? 'room-name-error' : 'room-name-hint'"
          @input="touched.name = true"
        />
        <p id="room-name-hint" class="notice">{{ t('create.nameHint') }}</p>
        <p v-if="showName && errors.name" id="room-name-error" class="error" role="alert">
          {{ t(errors.name) }}
        </p>
      </div>

      <div class="field">
        <span class="label">{{ t('create.duration') }}</span>
        <ChipGroup
          v-model="fields.durationMin"
          :label="t('create.duration')"
          :items="ROUND_DURATIONS_MIN"
          :format="(n: number) => t('create.durationValue', { n })"
        />
      </div>

      <div class="field">
        <span class="label">{{ t('create.speed') }}</span>
        <ChipGroup
          v-model="fields.speed"
          :label="t('create.speed')"
          :items="SPEEDS"
          :format="(n: number) => t('create.speedValue', { n })"
        />
      </div>

      <div class="field">
        <label for="room-target">{{ t('create.target') }}</label>
        <input
          id="room-target"
          v-model="fields.targetText"
          class="input num"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          :aria-invalid="showTarget"
          :aria-describedby="showTarget ? 'room-target-error' : 'room-target-hint'"
          @input="touched.target = true"
        />
        <p id="room-target-hint" class="notice">{{ t('create.targetHint') }}</p>
        <p v-if="showTarget && errors.target" id="room-target-error" class="error" role="alert">
          {{ t(errors.target) }}
        </p>
      </div>

      <p v-if="status === 'closed' && closeCode !== null" class="error" role="alert">
        {{ t(closeKey(closeCode)) }}
      </p>
      <p v-if="state.error" class="error" role="alert">{{ t(errorKey(state.error)) }}</p>

      <button type="submit" class="btn" :disabled="status !== 'ready' || pending">
        {{ t('create.submit') }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.create {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

h1 {
  margin: 0;
  font-size: 1.7rem;
  letter-spacing: -0.03em;
}

form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
</style>
