import { ref, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

/**
 * Asks before the user navigates away while `active()` is true (a game is running): the
 * navigation waits for the answer. `asking` drives a confirm dialog; `confirm` lets the
 * navigation go on, `cancel` keeps the user in the game.
 */
export function useLeaveGuard(active: () => boolean): {
  asking: Ref<boolean>
  confirm: () => void
  cancel: () => void
} {
  const asking = ref(false)
  let answer: ((leave: boolean) => void) | null = null

  onBeforeRouteLeave(() => {
    if (!active()) return true
    asking.value = true
    return new Promise<boolean>((resolve) => {
      // A second click while the dialog is open keeps the first question open.
      answer?.(false)
      answer = resolve
    })
  })

  function settle(leave: boolean): void {
    asking.value = false
    answer?.(leave)
    answer = null
  }

  return { asking, confirm: () => settle(true), cancel: () => settle(false) }
}
