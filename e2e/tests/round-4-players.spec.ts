import { FULL_ROUND } from '../env'
import {
  expect,
  openFourPlayers,
  pressTradeKey,
  startRound,
  test,
  uniqueRoomName,
  type Seat,
} from '../fixtures/four-players'
import { roomSocketCount, serverFrames, type ServerFrame } from '../fixtures/ws-tap'

// NFR-006 / PRD §8: a 4-player round at speed 8× runs to the end with no errors and no loss of
// synchronisation. Real time: 3 minutes by default, 10 minutes with `E2E_FULL_ROUND=1`.
const DURATION_MIN = FULL_ROUND ? 10 : 3
const SPEED = 8
const TICK_MS = 80

const priceStream = (frames: readonly ServerFrame[]): number[] =>
  frames.flatMap(({ msg }) => (msg.type === 'room.tick' ? msg.prices : []))

/** Index of the first difference between two streams, or -1 when they are identical. */
function firstMismatch(a: readonly number[], b: readonly number[]): number {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return i
  return -1
}

test(`NFR-006: four players play a ${DURATION_MIN}-minute round at ${SPEED}× to the end`, async ({
  newSeat,
}) => {
  test.setTimeout((DURATION_MIN + 3) * 60_000)

  const room = await openFourPlayers(newSeat, {
    name: uniqueRoomName('Stability'),
    durationMin: DURATION_MIN,
    speed: SPEED,
  })
  const seats: readonly Seat[] = [room.host, ...room.guests]
  await startRound(room.host, ...room.guests)

  // Everyone trades now and then, so orders and ticks interleave like in a real game.
  const keys = ['b', 's', 'c'] as const
  const results = seats.map((seat) => seat.page.getByRole('dialog', { name: 'Round over' }))
  const deadline = Date.now() + (DURATION_MIN + 2) * 60_000
  for (let round = 0; Date.now() < deadline; round++) {
    const done = await Promise.all(results.map((dialog) => dialog.isVisible()))
    if (done.every(Boolean)) break
    for (const [index, seat] of seats.entries()) {
      await pressTradeKey(seat, keys[(round + index) % keys.length] ?? 'c')
    }
    await room.host.page.waitForTimeout(4_000)
  }

  for (const dialog of results) {
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Winner/)).toBeVisible()
  }

  const received = await Promise.all(seats.map((seat) => serverFrames(seat.page)))

  // No error on any of the four sockets.
  for (const frames of received) {
    const errors = frames.flatMap(({ msg }) => (msg.type === 'error' ? [msg.code] : []))
    expect(errors).toEqual([])
  }

  // One shared price per room (BR-007): all four saw the same prices, in the same order.
  const streams = received.map(priceStream)
  const expectedTicks = (DURATION_MIN * 60_000) / TICK_MS
  expect(streams[0]?.length ?? 0).toBeGreaterThan(expectedTicks * SPEED * 0.5)
  for (const stream of streams.slice(1)) {
    expect(firstMismatch(streams[0] ?? [], stream)).toBe(-1)
  }

  // Every socket got `round.end` with a reason, and the same result (the goal is not reached → time).
  const ends = received.map((frames) =>
    frames.flatMap(({ msg }) => (msg.type === 'round.end' ? [msg] : [])),
  )
  for (const list of ends) expect(list).toHaveLength(1)
  const [first, ...rest] = ends.map((list) => list[0])
  expect(first?.reason).toBe('TIME')
  for (const end of rest) expect(end).toEqual(first)

  // No reconnect happened: each page opened exactly one room socket (FR-015).
  for (const seat of seats) expect(await roomSocketCount(seat.page)).toBe(1)

  // UF-004: everyone goes back to the lobby, which shows the last round.
  for (const seat of seats) {
    await seat.page.getByRole('button', { name: 'Back to lobby' }).click()
    await expect(seat.page.getByRole('heading', { name: 'Last round' })).toBeVisible()
  }
  await expect(room.host.page.getByRole('button', { name: 'Start round' })).toBeEnabled()
})
