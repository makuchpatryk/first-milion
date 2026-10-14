<script setup lang="ts">
import {
  DEFAULT_GOAL,
  DEFAULT_ROUND_DURATION_MIN,
  DEFAULT_START_CASH,
  ROUND_DURATIONS_MIN,
  START_CASH_MAX,
  START_CASH_MIN,
  START_CASH_STEP,
  type RoundDuration,
} from '@fm/shared/rules'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  bumpGoal,
  GOAL_SLIDER_MAX,
  GOAL_SLIDER_STEP,
  goalSliderMin,
  parseStakes,
  parseWholeNumber,
} from '../room/goal'
import type { SingleRound } from '../single/loop'
import ChipGroup from './ChipGroup.vue'
import MoneyRange from './MoneyRange.vue'

const emit = defineEmits<{ start: [round: SingleRound] }>()

const { t } = useI18n()

const durationMin = ref<RoundDuration>(DEFAULT_ROUND_DURATION_MIN)
const startText = ref(String(DEFAULT_START_CASH))
const goalText = ref(String(DEFAULT_GOAL))

// Raising the start above the goal moves the goal one step above it (FR-004).
watch(startText, (text) => {
  const start = parseWholeNumber(text)
  if (start !== null) goalText.value = bumpGoal(start, goalText.value)
})
const goalMin = computed(() => goalSliderMin(parseWholeNumber(startText.value)))

// An error shows once the user has touched the field or tried to start (as in the room form).
const touched = reactive({ start: false, goal: false })
const submitted = ref(false)
const parsed = computed(() => parseStakes(startText.value, goalText.value))
const startError = computed(() => {
  const { value } = parsed
  return (touched.start || submitted.value) && !value.ok && value.errors.start !== null
    ? t(value.errors.start)
    : null
})
const goalError = computed(() => {
  const { value } = parsed
  return (touched.goal || submitted.value) && !value.ok && value.errors.goal !== null
    ? t(value.errors.goal)
    : null
})

function start(): void {
  submitted.value = true
  if (!parsed.value.ok) return
  const { startCash, goal } = parsed.value.stakes
  emit('start', { durationMs: durationMin.value * 60_000, startCash, goal })
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

    <MoneyRange
      id="single-start"
      v-model="startText"
      :label="t('single.setup.startCash')"
      :min="START_CASH_MIN"
      :max="START_CASH_MAX"
      :step="START_CASH_STEP"
      :hint="t('single.setup.startCashHint')"
      :error="startError"
      @input="touched.start = true"
    />

    <MoneyRange
      id="single-goal"
      v-model="goalText"
      :label="t('single.setup.goal')"
      :min="goalMin"
      :max="GOAL_SLIDER_MAX"
      :step="GOAL_SLIDER_STEP"
      :hint="t('single.setup.goalHint')"
      :error="goalError"
      @input="touched.goal = true"
    />

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
