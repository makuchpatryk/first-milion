import {
  createRoom,
  expect,
  joinRoom,
  startRound,
  test,
  uniqueRoomName,
} from '../fixtures/four-players'
import { clientFrames } from '../fixtures/ws-tap'

test('UF-005: an observer of a running round sees the ranking but no trade buttons', async ({
  newSeat,
}) => {
  const name = uniqueRoomName('Observer')
  const host = await newSeat({ prefix: 'host' })
  await createRoom(host, { name, durationMin: 3, speed: 1 })
  const player = await newSeat({ prefix: 'player' })
  await joinRoom(player, name, 'player')
  await startRound(host, player)

  // BR-012: a room that is running offers "Watch", not a player seat.
  const observer = await newSeat({ prefix: 'watcher' })
  await joinRoom(observer, name, 'observer')
  const { page } = observer

  await expect(page.getByRole('heading', { name: 'Live ranking' })).toBeVisible()
  await expect(
    page.getByText('You are watching the round. Trade buttons are hidden.'),
  ).toBeVisible()
  for (const label of [/^Buy/, /^Sell/, /^Close/]) {
    await expect(page.getByRole('button', { name: label })).toHaveCount(0)
  }

  // The shortcut keys do nothing for an observer: no order leaves the page (BR-007).
  for (const key of ['b', 's', 'c']) await page.keyboard.press(key)
  await page.waitForTimeout(500)
  const sent = (await clientFrames(page)).map((frame) => frame.msg.type)
  expect(sent.filter((type) => type === 'order' || type === 'close')).toEqual([])
})
