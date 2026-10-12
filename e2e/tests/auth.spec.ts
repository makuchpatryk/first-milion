import { expect, test } from '@playwright/test'
import { createAccount, signIn } from '../fixtures/auth'

test.describe('FR-001 login, verification, password rule', () => {
  test('FR-001 AC: a logged-out visitor sees the login form and no game screen', async ({
    page,
  }) => {
    for (const path of ['/', '/rooms', '/single']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login$/)
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
      await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
    }
    await expect(page.getByRole('link', { name: /^Rooms/ })).toHaveCount(0)
  })

  test('FR-001: a verified account logs in, reaches the menu and can log out', async ({ page }) => {
    const account = await createAccount({ prefix: 'auth' })
    await signIn(page, account)
    await expect(page).toHaveURL(/\/menu$/)
    await expect(page.getByText(account.nick, { exact: true }).first()).toBeVisible()

    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })
})
