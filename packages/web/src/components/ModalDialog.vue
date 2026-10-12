<script setup lang="ts">
import { nextTick, onMounted, ref, useId, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
}>()

/** Esc closed it: the parent sets `open` to false. */
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const heading = ref<HTMLElement | null>(null)
const titleId = useId()
const bodyId = useId()
let opener: Element | null = null

// Native `<dialog>`: focus trap, Esc and inert background come from `showModal()`.
async function show(): Promise<void> {
  const el = dialog.value
  if (el === null || el.open) return
  opener = document.activeElement
  el.showModal()
  await nextTick()
  // Focus lands on the title so a screen reader announces what the dialog is (WCAG 2.4.3).
  heading.value?.focus()
}

function hide(): void {
  if (dialog.value?.open === true) dialog.value.close()
}

function onClosed(): void {
  if (opener instanceof HTMLElement) opener.focus()
  opener = null
  if (props.open) emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) void show()
    else hide()
  },
  { flush: 'post' },
)

onMounted(() => {
  if (props.open) void show()
})
</script>

<template>
  <!-- The body is the description, so a screen reader reads the content (e.g. the result) on open. -->
  <dialog
    ref="dialog"
    class="modal"
    :aria-labelledby="titleId"
    :aria-describedby="bodyId"
    @close="onClosed"
  >
    <h2 :id="titleId" ref="heading" tabindex="-1">{{ title }}</h2>
    <div :id="bodyId" class="body">
      <slot />
    </div>
    <div class="actions">
      <slot name="actions" />
    </div>
  </dialog>
</template>

<style scoped>
.modal {
  width: min(92vw, 440px);
  max-height: 90vh;
  overflow-y: auto;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 20px;
}

.modal::backdrop {
  background: color-mix(in srgb, var(--bg) 80%, transparent);
}

h2 {
  margin: 0 0 12px;
  font-size: 1.2rem;
}

h2:focus {
  outline: none;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 0.9rem;
  line-height: 1.45;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}
</style>
