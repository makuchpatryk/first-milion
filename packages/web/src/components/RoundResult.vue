<script setup lang="ts">
import type { LastRound } from '@fm/shared/protocol'
import { useI18n } from 'vue-i18n'
import { useLocale } from '../i18n'
import { formatMoney } from '../i18n/format'

defineProps<{
  result: LastRound
  /** Own nickname, marked in the ranking. */
  me: string
}>()

const { t } = useI18n()
const { locale } = useLocale()
</script>

<template>
  <div class="result">
    <p class="reason">{{ t(`results.reason.${result.reason}`) }}</p>
    <!-- Plural form picks none / one winner / shared first place (BR-010). -->
    <p class="winners">
      {{ t('results.winners', { names: result.winners.join(', ') }, result.winners.length) }}
    </p>

    <table class="table">
      <thead>
        <tr>
          <th scope="col">{{ t('results.place') }}</th>
          <th scope="col">{{ t('results.player') }}</th>
          <th scope="col" class="end">{{ t('results.equity') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in result.ranking" :key="row.nick">
          <td class="num">{{ row.place }}</td>
          <td>
            {{ row.nick }}
            <span v-if="row.nick === me" class="note">({{ t('round.you') }})</span>
            <span v-if="row.status === 'eliminated'" class="note">
              — {{ t('lobby.status.eliminated') }}
            </span>
          </td>
          <td class="num end">{{ formatMoney(row.equity, locale) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.result {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.reason,
.winners {
  margin: 0;
}

.winners {
  font-weight: 700;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

th {
  text-align: left;
  font: 500 0.7rem var(--font-data);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 6px 4px;
  border-bottom: 1px solid var(--border);
}

td {
  padding: 8px 4px;
  border-bottom: 1px solid var(--border);
  overflow-wrap: anywhere;
}

.end {
  text-align: right;
}

.note {
  color: var(--muted);
  font-size: 0.78rem;
}
</style>
