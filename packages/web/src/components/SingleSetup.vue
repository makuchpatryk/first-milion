<script setup lang="ts">
import { DEFAULT_ROUND_DURATION_MIN, ROUND_DURATIONS_MIN, type RoundDuration } from '@fm/shared/rules'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseGoal } from '../room/goal'
import type { SingleRound } from '../single/loop'
import ChipGroup from './ChipGroup.vue'

const emit = defineEmits<{ start: [round: SingleRound] }>()

const { t } = useI18n()

const durationMin = ref<RoundDuration>(DEFAULT_ROUND_DURATION_MIN)
const goalText = ref('')
// The error shows once the user has touched the goal or tried to start (as in the room form).
const touched = ref(false)
const goal = computed(() => parseGoal(goalText.value))
const showError = computed(() => touched.value && goal.value === null)

function start(): void {
  touched.value = true
  if (goal.value === null) return
  emit('start', { durationMs: durationMin.value * 60_000, goal: goal.value })
}
</script>

<template>
  <form class="setup" novalidate aria-labelledby="setup-title" @submit.prevent="start">
    <h2 id="setup-title">{{ t('single.setup.title') }}</h2>
    <p class="notice">{{ t('single.setup.intro') }}</p>

    <div class="field">
      <span class="label">{{ t('single.setup.time') }}</span>
      <ChipGroup
        :label="t('single.setup.time')"
        :items="ROUND_DURATIONS_MIN"
        :model-value="durationMin"
        :format="(n: number) => t('create.durationValue', { n })"
        @update:model-value="durationMin = $event"
      />
    </div>

    <div class="field">
      <label for="single-goal">{{ t('single.setup.goal') }}</label>
      <input
        id="single-goal"
        v-model="goalText"
        class="input num"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        :aria-invalid="showError"
        :aria-describedby="showError ? 'single-goal-error' : 'single-goal-hint'"
        @input="touched = true"
      />
      <p id="single-goal-hint" class="notice">{{ t('single.setup.goalHint') }}</p>
      <p v-if="showError" id="single-goal-error" class="error" role="alert">
        {{ t('single.setup.goalError') }}
      </p>
    </div>

    <button type="submit" class="btn">{{ t('single.setup.start') }}</button>
  </form>
</template>

<style scoped>
.setup {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

h2 {
  margin: 0;
  font-size: 1.4rem;
  letter-spacing: -0.02em;
}
</style>
