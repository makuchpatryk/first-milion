<script setup lang="ts" generic="T extends string | number">
defineProps<{
  /** Accessible name of the group (e.g. size, speed, language). */
  label: string
  items: readonly T[]
  modelValue: T
  format: (item: T) => string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <div class="chips" role="group" :aria-label="label">
    <button
      v-for="item in items"
      :key="item"
      type="button"
      class="chip"
      :aria-pressed="item === modelValue"
      :disabled="disabled"
      @click="emit('update:modelValue', item)"
    >
      {{ format(item) }}
    </button>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
