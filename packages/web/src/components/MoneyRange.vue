<script setup lang="ts">
import { computed } from 'vue'
import { formatDecimal } from '../i18n/format'
import { useLocale } from '../i18n'
import { parseWholeNumber } from '../room/goal'

const props = defineProps<{
  /** Base id of the field; the slider, hint and error ids derive from it. */
  id: string
  label: string
  /** Slider scale. The text may go beyond it (the goal has no upper limit). */
  min: number
  max: number
  step: number
  hint: string
  /** Shown as an alert under the field while set. */
  error: string | null
}>()

/** The one value, as typed; the slider and the text field are two views of it. */
const text = defineModel<string>({ required: true })

const { locale } = useLocale()

const value = computed(() => parseWholeNumber(text.value))
// The thumb clamps to the slider scale; a text outside it (or not a number yet) never moves the value.
const position = computed(() => Math.min(props.max, Math.max(props.min, value.value ?? props.min)))
const valueText = computed(() => `$${formatDecimal(position.value, 0, locale.value)}`)

const hintId = computed(() => `${props.id}-hint`)
const errorId = computed(() => `${props.id}-error`)

function onSlide(event: Event): void {
  text.value = (event.target as HTMLInputElement).value
}
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <input
      class="slider"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="position"
      :aria-label="label"
      :aria-valuetext="valueText"
      :aria-describedby="hintId"
      @input="onSlide"
    />
    <input
      :id="id"
      v-model="text"
      class="input num"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      :aria-invalid="error !== null"
      :aria-describedby="error !== null ? errorId : hintId"
    />
    <p :id="hintId" class="notice">{{ hint }}</p>
    <p v-if="error !== null" :id="errorId" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.slider {
  width: 100%;
  min-height: 24px;
  margin: 0;
  accent-color: var(--gold);
}
</style>
