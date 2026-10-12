import { expect, openFourPlayers, startRound, test, uniqueRoomName } from '../fixtures/four-players'
import { orderRoundTrips, sendOnRoomSocket } from '../fixtures/ws-tap'

// NFR-001: send → confirmation ≤ 300 ms at p95 in a room with 4 players. Measured in the page
// (`performance.now()` around the socket), so the browser and the network are part of the number.
const ORDERS = 50
const P95_LIMIT_MS = 300
/** Under the order rate limit (10 per second, BR-018) with room to spare. */
const PAUSE_MS = 150

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1)
  return sorted[index] ?? Number.NaN
}

test(`NFR-001: ${ORDERS} orders in a 4-player room confirm within ${P95_LIMIT_MS} ms at p95`, async ({
  newSeat,
}, testInfo) => {
  // Speed 1: the first news (and so the first possible halt) is ~16 s away, longer than this run.
  const room = await openFourPlayers(newSeat, {
    name: uniqueRoomName('Latency'),
    durationMin: 3,
    speed: 1,
  })
  await startRound(room.host, ...room.guests)

  const trader = room.host
  for (let i = 0; i < ORDERS; i++) {
    await sendOnRoomSocket(trader.page, [
      { type: 'order', side: i % 2 === 0 ? 'BUY' : 'SELL', qty: 10 },
    ])
    await trader.page.waitForTimeout(PAUSE_MS)
  }
  await expect
    .poll(async () => (await orderRoundTrips(trader.page)).length, { timeout: 5_000 })
    .toBe(ORDERS)

  const trips = await orderRoundTrips(trader.page)
  const confirmed = trips.filter((trip) => trip.reply === 'order.ok').map((trip) => trip.ms)
  const sorted = [...confirmed].sort((a, b) => a - b)
  const stats = {
    orders: ORDERS,
    confirmed: confirmed.length,
    minMs: sorted[0],
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1),
  }

  // The numbers go to the report (Playwright HTML report and the log) for NFR-001 / NFR-002 notes.
  console.log(`NFR-001 latency: ${JSON.stringify(stats)}`)
  testInfo.annotations.push({ type: 'latency', description: JSON.stringify(stats) })
  await testInfo.attach('latency.json', {
    body: JSON.stringify(stats, null, 2),
    contentType: 'application/json',
  })

  // No halt and no rate limit can occur here, so every order must be confirmed.
  expect(confirmed.length).toBe(ORDERS)
  expect(stats.p95Ms).toBeLessThanOrEqual(P95_LIMIT_MS)
})
