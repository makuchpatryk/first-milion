import {
  createRoom,
  expect,
  joinRoom,
  pressTradeKey,
  startRound,
  test,
  uniqueRoomName,
  type NewSeat,
} from '../fixtures/four-players'
import { gateRoomSocket, type RoomSocketGate } from '../fixtures/ws-tap'

// FR-015 / BR-019: the server keeps a dropped player's seat for 30 s. The outage is a real
// closed connection (the gate), not a UI trick, since the grace only starts on the server's close.

/** The player's own numbers from the newest tick that came through the gate. */
function lastYou(gate: RoomSocketGate) {
  for (const msg of gate.serverMessages().reverse()) if (msg.type === 'room.tick') return msg.you
  return null
}

test.describe('FR-015 disconnection and return', () => {
  /** A running round with a host and one guest whose room socket sits behind a gate. */
  async function setup(newSeat: NewSeat) {
    const host = await newSeat({ prefix: 'host' })
    const guest = await newSeat({ prefix: 'guest' })
    const gate: RoomSocketGate = await gateRoomSocket(guest.page)
    const name = uniqueRoomName('Reconnect')
    // Speed 1: no halt in the first 16 s, and the round (3 min) outlasts both outages.
    await createRoom(host, { name, durationMin: 3, speed: 1 })
    await joinRoom(guest, name, 'player')
    await startRound(host, guest)
    return { host, guest, gate }
  }

  test('FR-015 AC: a 10 s outage shows the banner and the seat and position come back', async ({
    newSeat,
  }) => {
    test.setTimeout(120_000)
    const { guest, gate } = await setup(newSeat)

    // The client only trades after its first tick; an earlier key press is dropped silently.
    await expect(guest.page.getByRole('button', { name: /^Buy/ })).toBeEnabled()
    await pressTradeKey(guest, 'b')
    await expect.poll(() => lastYou(gate)?.units).toBe(50)

    gate.cut()
    await expect(guest.page.getByText(/Reconnecting… \d+ s left/)).toBeVisible()
    await guest.page.waitForTimeout(10_000)
    gate.restore()

    // The client's own backoff (500 ms doubling to 8 s) connects again, well inside 30 s.
    await expect(guest.page.getByText(/Reconnecting…/)).toBeHidden({ timeout: 20_000 })
    await expect
      .poll(() => lastYou(gate), { timeout: 10_000 })
      .toMatchObject({ role: 'player', status: 'active', units: 50 })
    await expect(guest.page.getByRole('button', { name: /^Buy/ })).toBeEnabled()
  })
})
