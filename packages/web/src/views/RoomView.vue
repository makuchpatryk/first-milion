<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { session } from '../auth/session'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import LobbyPanel from '../components/LobbyPanel.vue'
import ModalDialog from '../components/ModalDialog.vue'
import ResultsDialog from '../components/ResultsDialog.vue'
import RoundPanel from '../components/RoundPanel.vue'
import { useLeaveGuard } from '../composables/use-leave-guard'
import { useRoom } from '../composables/use-room'
import { closeKey, errorKey } from '../room/error-map'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// The router guard has already sent users without a valid nickname away (BR-016).
const roomId = String(route.params.id)
const room = useRoom(roomId, session.user?.nick ?? '')
const { state, status, reconnectLeftS, closeCode } = room

// UF-004 step 3: the result opens when the round ends and closes with "Back to lobby".
const resultOpen = ref(false)
watch(
  () => state.value.lastResult,
  (result) => {
    resultOpen.value = result !== null
  },
)

// A player still in a running round is asked before leaving (menu, settings, back). Observers,
// eliminated players and a closed room (kick, admin close) leave without a question.
const playing = computed(
  () =>
    closeCode.value === null &&
    state.value.view?.status === 'running' &&
    state.value.view.you.role === 'player' &&
    state.value.you?.status !== 'eliminated',
)
const leaveGuard = useLeaveGuard(() => playing.value)

function leave(): void {
  room.leave()
  void router.push('/rooms')
}

// After the grace the server removes a lobby member and an observer, but only turns a round
// player into a watcher (decision 46), so the "could not return" text differs.
const reconnectLostKey = computed(() =>
  state.value.view?.status === 'running' && state.value.view.you.role === 'player'
    ? 'round.reconnectLost'
    : 'lobby.reconnectLost',
)

// A kick, an admin close, a newer tab or a dead session: the socket is gone, so the only way on is out.
// Auth failure (4401) sends the user to the menu, which the guard routes by session status.
function leaveClosed(): void {
  void router.replace(closeCode.value === 4401 ? '/' : '/rooms')
}
</script>

<template>
  <section class="room" aria-labelledby="room-title">
    <!-- While a round runs the name sits in the round panel's footer; the heading stays for screen readers. -->
    <h1 id="room-title" :class="{ 'sr-only': state.view?.status === 'running' }">
      {{ state.view?.name ?? t('rooms.title') }}
    </h1>

    <p v-if="status === 'reconnecting'" class="banner" role="status">
      {{
        reconnectLeftS === 0
          ? t(reconnectLostKey)
          : t('round.reconnecting', { s: reconnectLeftS ?? 0 })
      }}
    </p>
    <p v-else-if="state.view === null && status !== 'closed'" class="notice" role="status">
      {{ t('rooms.connecting') }}
    </p>

    <p v-if="state.error && closeCode === null" class="error" role="alert">
      {{ t(errorKey(state.error)) }}
      <button type="button" class="link" @click="room.clearError">
        {{ t('round.dismissError') }}
      </button>
      <RouterLink v-if="state.view === null" to="/rooms" class="link">
        {{ t('round.backToRooms') }}
      </RouterLink>
    </p>

    <template v-if="state.view">
      <RoundPanel
        v-if="state.view.status === 'running'"
        :view="state.view"
        :state="state"
        :can-trade="room.canTrade.value && !resultOpen"
        @order="room.order"
        @close="room.closePosition"
      />
      <LobbyPanel
        v-else
        :view="state.view"
        :is-admin="state.isAdmin"
        @start="room.start"
        @kick="room.kick"
        @leave="leave"
      />

      <ResultsDialog
        v-if="state.lastResult"
        :open="resultOpen"
        :result="state.lastResult"
        :me="state.view.you.nick"
        @close="resultOpen = false"
      />
    </template>

    <ConfirmDialog
      v-if="leaveGuard.asking.value"
      open
      :title="t('leaveGame.title')"
      :body="t('leaveGame.room')"
      :confirm-label="t('leaveGame.confirm')"
      @confirm="leaveGuard.confirm"
      @cancel="leaveGuard.cancel"
    />

    <ModalDialog :open="closeCode !== null" :title="t('round.closedTitle')" @close="leaveClosed">
      <p class="text">{{ closeCode === null ? '' : t(closeKey(closeCode)) }}</p>
      <template #actions>
        <button type="button" class="btn" @click="leaveClosed">{{ t('round.backToRooms') }}</button>
      </template>
    </ModalDialog>
  </section>
</template>

<style scoped>
.room {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

h1 {
  margin: 0;
  font-size: 1.7rem;
  letter-spacing: -0.03em;
  overflow-wrap: anywhere;
}

.banner {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--gold);
  border-radius: 6px;
  background: var(--surface);
  font-size: 0.88rem;
}

.text {
  margin: 0;
}
</style>
