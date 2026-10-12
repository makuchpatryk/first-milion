<script setup lang="ts">
import type { LastRound } from '@fm/shared/protocol'
import { useI18n } from 'vue-i18n'
import ModalDialog from './ModalDialog.vue'
import RoundResult from './RoundResult.vue'

defineProps<{
  open: boolean
  result: LastRound
  /** Own nickname, marked in the ranking. */
  me: string
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
</script>

<template>
  <ModalDialog :open="open" :title="t('results.title')" @close="emit('close')">
    <RoundResult :result="result" :me="me" />
    <template #actions>
      <button type="button" class="btn" @click="emit('close')">{{ t('results.back') }}</button>
    </template>
  </ModalDialog>
</template>
