<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ModalDialog from './ModalDialog.vue'

defineProps<{
  open: boolean
  title: string
  body: string
  confirmLabel: string
}>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()
</script>

<template>
  <ModalDialog :open="open" :title="title" @close="emit('cancel')">
    <p class="text">{{ body }}</p>
    <template #actions>
      <button type="button" class="btn btn-danger" @click="emit('confirm')">
        {{ confirmLabel }}
      </button>
      <button type="button" class="btn btn-quiet" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.text {
  margin: 0;
}
</style>
