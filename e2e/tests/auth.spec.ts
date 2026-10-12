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

  test('FR-001 AC: an unverified account gets the verification screen, not the game', async ({
    page,
  }) => {
    const account = await createAccount({ prefix: 'unver', verified: false })
    await signIn(page, account)
    await expect(page).toHaveURL(/\/verify$/)
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible()

    // BR-002: the game stays locked on a direct visit, too.
    await page.goto('/rooms')
    await expect(page).toHaveURL(/\/verify$/)
  })

  test('FR-001 AC: a 7-character password shows a validation error on sign-up', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByLabel('Email', { exact: true }).fill('short-password@example.test')
    await page.getByLabel('Password', { exact: true }).fill('abcdefg')
    await page.getByTestId('auth-submit').click()
    await expect(page.getByText('The password must have at least 8 characters.')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('FR-001: a verified account logs in, reaches the menu and can log out', async ({ page }) => {
    const account = await createAccount({ prefix: 'auth' })
    await signIn(page, account)
    await expect(page).toHaveURL(/\/menu$/)
    await expect(page.getByText(account.nick, { exact: true }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })
})
