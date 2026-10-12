import { expect, openLobby, startRound, test, uniqueRoomName } from '../fixtures/four-players'
import { roomSocketCount, sendOnRoomSocket, serverFrames } from '../fixtures/ws-tap'

test('FR-012 AC: the 11th order within 1 s is RATE_LIMITED and the socket stays open', async ({
  newSeat,
}) => {
  // Speed 1: no news, so no halt, in the first 16 s; the first ten orders are all accepted.
  const room = await openLobby(
    newSeat,
    { name: uniqueRoomName('RateLimit'), durationMin: 3, speed: 1 },
    0,
  )
  await startRound(room.host)
  const { page } = room.host

  // One task, so all eleven frames leave inside the 1 s window (BR-018).
  const burst = Array.from({ length: 11 }, (_, i) => ({
    type: 'order' as const,
    side: i % 2 === 0 ? ('BUY' as const) : ('SELL' as const),
    qty: 10 as const,
  }))
  await sendOnRoomSocket(page, burst)

  const replies = async () =>
    (await serverFrames(page)).flatMap(({ msg }) =>
      msg.type === 'order.ok' ? ['ok'] : msg.type === 'error' ? [msg.code] : [],
    )
  await expect.poll(async () => (await replies()).length).toBe(11)
  expect(await replies()).toEqual([...Array<string>(10).fill('ok'), 'RATE_LIMITED'])

  // The socket was not closed: it is still the only one, and after the window it trades again.
  expect(await roomSocketCount(page)).toBe(1)
  await page.waitForTimeout(1_200)
  await sendOnRoomSocket(page, [{ type: 'order', side: 'BUY', qty: 10 }])
  await expect.poll(async () => (await replies()).at(-1)).toBe('ok')
})
