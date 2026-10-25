<script setup lang="ts">
import type { RoomView } from '@fm/shared/protocol'
import { MAX_OBSERVERS, MAX_PLAYERS } from '@fm/shared/rules'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocale } from '../i18n'
import { formatDecimal } from '../i18n/format'
import ConfirmDialog from './ConfirmDialog.vue'
import RoundResult from './RoundResult.vue'

const props = defineProps<{
  view: RoomView
  /** From the server's `auth.ok`; kick is shown only to admins (FR-017). */
  isAdmin: boolean
}>()

const emit = defineEmits<{ start: []; leave: []; kick: [nick: string] }>()

const { t } = useI18n()
const { locale } = useLocale()

const kicking = ref<string | null>(null)

const money = (key: 'rooms.startCash' | 'rooms.goal', amount: number): string =>
  t(key, { n: formatDecimal(amount, 0, locale.value) })

const isMe = (nick: string): boolean => nick === props.view.you.nick

function confirmKick(): void {
  if (kicking.value !== null) emit('kick', kicking.value)
  kicking.value = null
}
</script>

<template>
  <div class="lobby">
    <section aria-labelledby="params-title" class="block">
      <h2 id="params-title" class="label">{{ t('lobby.params') }}</h2>
      <dl class="params">
        <div>
          <dt>{{ t('lobby.duration') }}</dt>
          <dd class="num">{{ t('rooms.duration', { n: view.durationMin }) }}</dd>
        </div>
        <div>
          <dt>{{ t('lobby.speed') }}</dt>
          <dd class="num">{{ t('rooms.speed', { n: view.speed }) }}</dd>
        </div>
        <div>
          <dt>{{ t('lobby.startCash') }}</dt>
          <dd class="num">{{ money('rooms.startCash', view.startCash) }}</dd>
        </div>
        <div>
          <dt>{{ t('lobby.goal') }}</dt>
          <dd class="num">{{ money('rooms.goal', view.goal) }}</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="players-title" class="block">
      <h2 id="players-title" class="label">
        {{ t('lobby.players', { n: view.players.length, max: MAX_PLAYERS }) }}
      </h2>
      <ul class="members" role="list">
        <li v-for="player in view.players" :key="player.nick" class="member">
          <span class="who">
            <b>{{ player.nick }}</b>
            <span v-if="player.nick === view.hostNick" class="note">{{ t('lobby.host') }}</span>
            <span v-if="isMe(player.nick)" class="note">({{ t('lobby.you') }})</span>
            <span class="note">· {{ t(`lobby.status.${player.status}`) }}</span>
          </span>
          <button
            v-if="isAdmin && !isMe(player.nick)"
            type="button"
            class="chip"
            :aria-label="t('admin.kickNamed', { nick: player.nick })"
            @click="kicking = player.nick"
          >
            {{ t('admin.kick') }}
          </button>
        </li>
      </ul>
    </section>

    <section aria-labelledby="observers-title" class="block">
      <h2 id="observers-title" class="label">
        {{ t('lobby.observers', { n: view.observers.length, max: MAX_OBSERVERS }) }}
      </h2>
      <p v-if="view.observers.length === 0" class="notice">{{ t('lobby.noObservers') }}</p>
      <ul v-else class="members" role="list">
        <li v-for="observer in view.observers" :key="observer.nick" class="member">
          <span class="who">
            <b>{{ observer.nick }}</b>
            <span v-if="observer.nick === view.hostNick" class="note">{{ t('lobby.host') }}</span>
            <span v-if="isMe(observer.nick)" class="note">({{ t('lobby.you') }})</span>
            <span class="note">· {{ t(`lobby.status.${observer.status}`) }}</span>
          </span>
          <button
            v-if="isAdmin && !isMe(observer.nick)"
            type="button"
            class="chip"
            :aria-label="t('admin.kickNamed', { nick: observer.nick })"
            @click="kicking = observer.nick"
          >
            {{ t('admin.kick') }}
          </button>
        </li>
      </ul>
    </section>

    <section v-if="view.lastRound" aria-labelledby="last-title" class="block card">
      <h2 id="last-title" class="label">{{ t('lobby.lastRound') }}</h2>
      <RoundResult :result="view.lastRound" :me="view.you.nick" />
    </section>

    <div class="controls">
      <template v-if="view.you.isHost">
        <button
          type="button"
          class="btn"
          :disabled="view.players.length === 0"
          :aria-describedby="view.players.length === 0 ? 'need-player' : undefined"
          @click="emit('start')"
        >
          {{ t('lobby.start') }}
        </button>
        <p v-if="view.players.length === 0" id="need-player" class="notice">
          {{ t('lobby.needPlayer') }}
        </p>
      </template>
      <p v-else class="notice">{{ t('lobby.waitHost') }}</p>
      <button type="button" class="btn btn-quiet" @click="emit('leave')">
        {{ t('lobby.leave') }}
      </button>
    </div>

    <ConfirmDialog
      v-if="isAdmin"
      :open="kicking !== null"
      :title="t('admin.kickTitle')"
      :body="t('admin.kickBody', { nick: kicking ?? '' })"
      :confirm-label="t('admin.kick')"
      @confirm="confirmKick"
      @cancel="kicking = null"
    />
  </div>
</template>

<style scoped>
.lobby {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block h2 {
  margin: 0;
  font-weight: 500;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px;
}

.params {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.params div {
  background: var(--surface);
  padding: 10px 12px;
  min-width: 0;
}

dt {
  font-size: 0.68rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.members {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
}

.member {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  border-bottom: 1px solid var(--border);
}

.who {
  min-width: 0;
  overflow-wrap: anywhere;
}

.note {
  color: var(--muted);
  font-size: 0.78rem;
  margin-left: 4px;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
