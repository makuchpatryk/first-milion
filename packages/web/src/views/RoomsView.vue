<script setup lang="ts">
import { MAX_OBSERVERS, MAX_PLAYERS } from '@fm/shared/rules'
import type { RoomSummary } from '@fm/shared/protocol'
import { isValidNick } from '@fm/shared/validation'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'
import { session } from '../auth/session'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { useLobby } from '../composables/use-lobby'
import { useLocale } from '../i18n'
import { formatDecimal } from '../i18n/format'
import { closeKey, errorKey } from '../room/error-map'
import { joinPolicy } from '../room/lobby-state'

const { t } = useI18n()
const { locale } = useLocale()
const router = useRouter()

const lobby = useLobby()
const { state, status, closeCode } = lobby

// BR-016: the nickname must be valid before entering a room.
const nickOk = computed(() => isValidNick(session.user?.nick ?? ''))

const closing = ref<RoomSummary | null>(null)

const targetText = (room: RoomSummary): string =>
  room.profitTarget === null
    ? t('rooms.noTarget')
    : t('rooms.target', { n: formatDecimal(room.profitTarget, 0, locale.value) })

function join(room: RoomSummary): void {
  void router.push(`/rooms/${encodeURIComponent(room.id)}`)
}

function confirmClose(): void {
  if (closing.value !== null) lobby.closeRoom(closing.value.id)
  closing.value = null
}
</script>

<template>
  <section class="rooms" aria-labelledby="rooms-title">
    <div class="top">
      <RouterLink to="/menu" class="link link-muted">{{ t('rooms.menu') }}</RouterLink>
    </div>

    <header>
      <h1 id="rooms-title">{{ t('rooms.title') }}</h1>
      <RouterLink to="/rooms/new" class="btn create">{{ t('rooms.create') }}</RouterLink>
    </header>

    <p v-if="!nickOk" class="error" role="alert">
      {{ t('rooms.nickInvalid') }}
      <RouterLink to="/menu" class="link">{{ t('rooms.toMenu') }}</RouterLink>
    </p>
    <p v-if="status === 'closed' && closeCode !== null" class="error" role="alert">
      {{ t(closeKey(closeCode)) }}
    </p>
    <p v-else-if="status !== 'ready'" class="notice" role="status">
      {{ t(status === 'reconnecting' ? 'rooms.reconnecting' : 'rooms.connecting') }}
    </p>
    <p v-if="state.error" class="error" role="alert">
      {{ t(errorKey(state.error)) }}
      <button type="button" class="link" @click="lobby.clearError">
        {{ t('round.dismissError') }}
      </button>
    </p>

    <p v-if="status === 'ready' && state.rooms.length === 0" class="empty">
      {{ t('rooms.empty') }}
    </p>

    <ul
      v-else-if="state.rooms.length > 0"
      class="list"
      role="list"
      :aria-label="t('rooms.listLabel')"
    >
      <li v-for="room in state.rooms" :key="room.id" class="room">
        <div class="room-head">
          <h2 class="room-name">{{ room.name }}</h2>
          <span class="tag num">{{
            t(room.status === 'lobby' ? 'rooms.lobby' : 'rooms.running')
          }}</span>
        </div>

        <p class="meta">
          <span>{{ t('rooms.host') }}: {{ room.hostNick ?? t('rooms.noHost') }}</span>
          <span class="num">{{ t('rooms.players', { n: room.players, max: MAX_PLAYERS }) }}</span>
          <span class="num">{{ t('rooms.duration', { n: room.durationMin }) }}</span>
          <span class="num">{{ targetText(room) }}</span>
          <span class="num">{{ t('rooms.speed', { n: room.speed }) }}</span>
          <span v-if="room.observers > 0" class="num">
            {{ t('rooms.observers', { n: room.observers, max: MAX_OBSERVERS }) }}
          </span>
        </p>

        <div class="room-actions">
          <button
            type="button"
            class="btn"
            :disabled="!nickOk || joinPolicy(room) === 'closed'"
            @click="join(room)"
          >
            {{
              joinPolicy(room) === 'player'
                ? t('rooms.joinPlayer')
                : joinPolicy(room) === 'observer'
                  ? t('rooms.watch')
                  : t('rooms.full')
            }}
          </button>
          <button v-if="state.isAdmin" type="button" class="btn btn-quiet" @click="closing = room">
            {{ t('admin.closeRoom') }}
          </button>
        </div>
      </li>
    </ul>

    <ConfirmDialog
      v-if="state.isAdmin"
      :open="closing !== null"
      :title="t('admin.closeTitle')"
      :body="t('admin.closeBody', { name: closing?.name ?? '' })"
      :confirm-label="t('admin.closeRoom')"
      @confirm="confirmClose"
      @cancel="closing = null"
    />
  </section>
</template>

<style scoped>
.rooms {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

h1 {
  margin: 0;
  font-size: 1.7rem;
  letter-spacing: -0.03em;
}

.create {
  width: auto;
  text-decoration: none;
}

.empty {
  color: var(--muted);
  margin: 0;
  padding: 16px 0;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.room {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.room-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}

.room-name {
  margin: 0;
  font-size: 1.05rem;
  overflow-wrap: anywhere;
}

.tag {
  font-size: 0.72rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  color: var(--muted);
  font-size: 0.82rem;
}

.room-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.room-actions .btn {
  flex: 1 1 140px;
}
</style>
