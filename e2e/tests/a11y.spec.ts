import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import {
  createRoom,
  expect,
  goalField,
  joinRoom,
  openRoomList,
  startField,
  startRound,
  test,
  uniqueRoomName,
  type Seat,
} from '../fixtures/four-players'
import { sendOnRoomSocket } from '../fixtures/ws-tap'

// NFR-003: axe on every screen at 360 px (the `mobile` project), WCAG 2.1 AA rules. Serious and
// critical findings fail the test; the screen's name is in the failure message. The keyboard
// pass is manual (e2e/README.md).
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function audit(page: Page, screen: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  const blocking = violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
    )
  expect(blocking, `axe violations on ${screen}`).toEqual([])
}

/**
 * The round ends at once when every player is bankrupt (BR-009): each seat buys until its equity
 * is gone. Ten orders per second is the rate limit (BR-018).
 */
async function endRoundByBankruptcy(seats: readonly Seat[]): Promise<void> {
  const [first] = seats
  if (first === undefined) return
  const dialog = first.page.getByRole('dialog', { name: 'Round over' })
  const buys = Array.from({ length: 10 }, () => ({
    type: 'order' as const,
    side: 'BUY' as const,
    qty: 250 as const,
  }))
  for (let i = 0; i < 90 && !(await dialog.isVisible()); i++) {
    await Promise.all(seats.map((seat) => sendOnRoomSocket(seat.page, buys)))
    await first.page.waitForTimeout(1_100)
  }
  await expect(dialog).toBeVisible({ timeout: 30_000 })
}

test.describe('NFR-003 signed-in screens', () => {
  test('menu, settings panels and single play have no serious violations', async ({ newSeat }) => {
    const { page } = await newSeat({ prefix: 'a11y' })
    await expect(page.getByRole('heading', { name: 'Menu' })).toBeVisible()
    await audit(page, 'menu')

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await audit(page, 'settings')

    await page.getByRole('button', { name: 'Change' }).click()
    await expect(page.getByLabel('New nickname')).toBeVisible()
    await audit(page, 'settings: change nickname')

    await page.getByRole('button', { name: 'Delete account' }).click()
    await expect(page.getByLabel('Password to confirm')).toBeVisible()
    await audit(page, 'settings: delete account')

    // Settings has no back link; the logo leads to the menu.
    await page.getByRole('link', { name: /First\s*Million/ }).click()
    await page.getByRole('link', { name: /^Single play/ }).click()
    await expect(page.getByRole('heading', { name: 'New round' })).toBeVisible()
    await audit(page, 'single play setup')

    // The goal field with its error showing (a goal not above the start).
    await goalField(page).fill('10000')
    await page.getByRole('button', { name: 'Start' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await audit(page, 'single play setup with an error')

    await startField(page).fill('5000')
    await goalField(page).fill('20000')
    await page.getByRole('button', { name: 'Start' }).click()
    await expect(page.getByRole('heading', { name: 'Recent trades' })).toBeVisible()
    await audit(page, 'single play')
  })

  test('room list, create room, lobby, round and results have no serious violations', async ({
    newSeat,
  }) => {
    test.setTimeout(240_000)
    const name = uniqueRoomName('A11y')
    const host = await newSeat({ prefix: 'host' })
    const { page } = host

    await openRoomList(host)
    await expect(page.getByRole('heading', { name: 'Rooms' })).toBeVisible()
    await audit(page, 'room list (maybe empty)')

    // Create form with its validation errors showing.
    await page.getByRole('link', { name: 'Create room' }).click()
    await expect(page.getByRole('heading', { name: 'New room' })).toBeVisible()
    await goalField(page).fill('10000')
    await page.getByRole('button', { name: 'Create room' }).click()
    await expect(page.getByText('The name must be 3 to 30 characters.')).toBeVisible()
    await expect(page.getByText('The goal must be a whole number above the starting capital.')).toBeVisible()
    await audit(page, 'create room')
    await page.getByRole('link', { name: /Rooms$/ }).click()

    await createRoom(host, { name, durationMin: 3, speed: 8 })
    await expect(page.getByRole('heading', { name: 'Players (1/4)' })).toBeVisible()
    await audit(page, 'lobby')

    const guest = await newSeat({ prefix: 'guest' })
    await openRoomList(guest)
    await expect(guest.page.getByRole('heading', { name, exact: true })).toBeVisible()
    await audit(guest.page, 'room list with a room')
    await joinRoom(guest, name, 'player')

    await startRound(host, guest)
    await audit(page, 'round')

    await endRoundByBankruptcy([host, guest])
    await audit(page, 'results dialog')

    await page.getByRole('button', { name: 'Back to lobby' }).click()
    await expect(page.getByRole('heading', { name: 'Last round' })).toBeVisible()
    await audit(page, 'lobby with the last round')
  })
})
