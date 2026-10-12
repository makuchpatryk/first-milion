import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { WEB_URL } from '../env'
import { createAccount, signIn, type Account, type AccountOptions } from './auth'
import { installTap } from './ws-tap'

/** One signed-in browser: its own context, page and emulator account (a "player" of NFR-006). */
export interface Seat {
  readonly context: BrowserContext
  readonly page: Page
  readonly account: Account
  readonly nick: string
}

export interface RoomForm {
  readonly name: string
  readonly durationMin?: 3 | 5 | 10
  readonly speed?: 1 | 3 | 8
  /** Whole dollars; left out means no profit target. */
  readonly target?: number
}

export interface OpenRoom {
  readonly id: string
  readonly name: string
  readonly host: Seat
  /** The other seats, in join order. */
  readonly guests: readonly Seat[]
}

/** Opens a signed-in seat on `/menu`; every context is closed after the test. */
export type NewSeat = (account?: Account | AccountOptions) => Promise<Seat>

interface Fixtures {
  newSeat: NewSeat
}

const isAccount = (value: Account | AccountOptions): value is Account => 'uid' in value

export const test = base.extend<Fixtures>({
  newSeat: async ({ browser }, use, testInfo) => {
    const contexts: BrowserContext[] = []
    // Seats follow the project's viewport (desktop, or 360 px for the axe audit).
    const viewport = testInfo.project.use.viewport ?? { width: 1280, height: 800 }
    await use(async (input = {}) => {
      const account = isAccount(input) ? input : await createAccount(input)
      const context = await browser.newContext({ baseURL: WEB_URL, locale: 'en-US', viewport })
      contexts.push(context)
      await installTap(context)
      const page = await context.newPage()
      await signIn(page, account)
      await expect(page).toHaveURL(/\/menu$/)
      return { context, page, account, nick: account.nick }
    })
    await Promise.all(contexts.map((context) => context.close()))
  },
})

export { expect }

/** Menu → room list, by clicking like a user (no reload, so the session and sockets stay). */
export async function openRoomList(seat: Seat): Promise<void> {
  const { page } = seat
  if (new URL(page.url()).pathname === '/menu') {
    await page.getByRole('link', { name: /^Rooms/ }).click()
  }
  await expect(page).toHaveURL(/\/rooms$/)
}

const ROOM_URL = /\/rooms\/([0-9a-f]{64})$/

function roomIdOf(page: Page): string {
  const id = ROOM_URL.exec(new URL(page.url()).pathname)?.[1]
  if (id === undefined) throw new Error(`not in a room: ${page.url()}`)
  return id
}

/** UF-003: list → "Create room" → form → lobby as host. Returns the room id. */
export async function createRoom(host: Seat, form: RoomForm): Promise<string> {
  const { page } = host
  await openRoomList(host)
  await page.getByRole('link', { name: 'Create room' }).click()
  await page.getByLabel('Room name', { exact: true }).fill(form.name)
  if (form.durationMin !== undefined) {
    await page
      .getByRole('group', { name: 'Round length' })
      .getByRole('button', { name: `${form.durationMin} min` })
      .click()
  }
  if (form.speed !== undefined) {
    await page
      .getByRole('group', { name: 'Speed' })
      .getByRole('button', { name: `${form.speed}×` })
      .click()
  }
  if (form.target !== undefined) {
    await page.getByLabel('Profit target ($)', { exact: true }).fill(String(form.target))
  }
  await page.getByRole('button', { name: 'Create room' }).click()
  await expect(page).toHaveURL(ROOM_URL)
  return roomIdOf(page)
}

/** The row of a room in the live list, found by its (unique) name. */
export function roomRow(page: Page, roomName: string) {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: roomName, exact: true }) })
}

/** UF-003 step 4: joins from the list. "Join as player" in a lobby, "Watch" in a running round. */
export async function joinRoom(
  seat: Seat,
  roomName: string,
  as: 'player' | 'observer',
): Promise<void> {
  await openRoomList(seat)
  const label = as === 'player' ? 'Join as player' : 'Watch'
  await roomRow(seat.page, roomName).getByRole('button', { name: label }).click()
  await expect(seat.page).toHaveURL(ROOM_URL)
}

/** A host and `guests` players in one lobby (NFR-006: the four contexts of the round). */
export async function openLobby(
  newSeat: NewSeat,
  form: RoomForm,
  guestCount: number,
): Promise<OpenRoom> {
  const host = await newSeat({ prefix: 'host' })
  const id = await createRoom(host, form)
  const guests: Seat[] = []
  for (let i = 0; i < guestCount; i++) {
    const guest = await newSeat({ prefix: `guest${i + 1}` })
    await joinRoom(guest, form.name, 'player')
    guests.push(guest)
  }
  const seated = guestCount + 1
  await expect(host.page.getByRole('heading', { name: `Players (${seated}/4)` })).toBeVisible()
  return { id, name: form.name, host, guests }
}

/** Host + 3 players, all seated in the lobby. */
export function openFourPlayers(newSeat: NewSeat, form: RoomForm): Promise<OpenRoom> {
  return openLobby(newSeat, form, 3)
}

/** UF-004: the host starts; waits until a seat shows the running round (its live ranking). */
export async function startRound(host: Seat, ...others: readonly Seat[]): Promise<void> {
  await host.page.getByRole('button', { name: 'Start round' }).click()
  for (const seat of [host, ...others]) {
    await expect(seat.page.getByRole('heading', { name: 'Live ranking' })).toBeVisible()
  }
}

/** Orders by key, like a player (FR-004): the shortcut only fires outside form fields. */
export async function pressTradeKey(seat: Seat, key: 'b' | 's' | 'c'): Promise<void> {
  await seat.page.keyboard.press(key)
}

let roomCounter = 0

/** A room name that is unique within the run: lists keep rooms of earlier specs for 5 minutes. */
export function uniqueRoomName(prefix: string): string {
  roomCounter += 1
  return `${prefix} ${Date.now().toString(36)}${roomCounter}`.slice(0, 30)
}
