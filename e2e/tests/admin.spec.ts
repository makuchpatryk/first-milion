import { createAdminAccount } from '../fixtures/auth'
import {
  createRoom,
  expect,
  joinRoom,
  openRoomList,
  roomRow,
  test,
  uniqueRoomName,
} from '../fixtures/four-players'

// FR-017 / BR-017: the Worker treats the UID in `ADMIN_UIDS` (set by the e2e config) as admin.

test.describe('FR-017 admin controls', () => {
  test('FR-017 AC: only the admin sees "Close room"; closing sends everyone out and drops the room', async ({
    newSeat,
  }) => {
    const name = uniqueRoomName('AdminClose')
    const owner = await newSeat({ prefix: 'owner' })
    await createRoom(owner, { name, durationMin: 3, speed: 1 })
    const member = await newSeat({ prefix: 'member' })
    await joinRoom(member, name, 'player')

    // A non-admin on the list has no moderation button.
    const viewer = await newSeat({ prefix: 'viewer' })
    await openRoomList(viewer)
    await expect(roomRow(viewer.page, name)).toBeVisible()
    await expect(viewer.page.getByRole('button', { name: 'Close room' })).toHaveCount(0)

    const admin = await newSeat(await createAdminAccount())
    await openRoomList(admin)
    await roomRow(admin.page, name).getByRole('button', { name: 'Close room' }).click()
    await admin.page
      .getByRole('dialog', { name: 'Close the room?' })
      .getByRole('button', { name: 'Close room' })
      .click()

    // Everyone in the room is told (ROOM_CLOSED), and the room leaves every list.
    for (const seat of [owner, member]) {
      const notice = seat.page.getByRole('dialog', { name: 'Disconnected' })
      await expect(notice.getByText('An administrator closed the room.')).toBeVisible()
    }
    await expect(roomRow(viewer.page, name)).toHaveCount(0)
    await expect(roomRow(admin.page, name)).toHaveCount(0)
  })
})
