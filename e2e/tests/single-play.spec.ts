import { expect, test, type Page } from '@playwright/test'
import { createAccount, signIn } from '../fixtures/auth'
import { goalField, startField } from '../fixtures/four-players'

async function openSinglePlay(page: Page): Promise<void> {
  await signIn(page, await createAccount({ prefix: 'solo' }))
  await page.getByRole('link', { name: /^Single play/ }).click()
  await expect(page).toHaveURL(/\/single$/)
  await startField(page).fill('5000')
  await goalField(page).fill('20000')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('heading', { name: 'Recent trades' })).toBeVisible()
}

test.describe('FR-003 FR-004 single play setup', () => {
  async function openSetup(page: Page): Promise<void> {
    await signIn(page, await createAccount({ prefix: 'setup' }))
    await page.getByRole('link', { name: /^Single play/ }).click()
    await expect(page.getByRole('heading', { name: 'New round' })).toBeVisible()
  }

  test('BR-009: a goal not above the start shows a field error and the game does not start', async ({
    page,
  }) => {
    await openSetup(page)
    await goalField(page).fill('10000')
    await page.getByRole('button', { name: 'Start' }).click()
    await expect(page.getByRole('alert')).toContainText('The goal must be a whole number above the starting capital.')
    await expect(page.getByRole('heading', { name: 'New round' })).toBeVisible()
  })

  test('FR-004: a goal above the slider range starts the round and the bar shows equity against it', async ({
    page,
  }) => {
    await openSetup(page)
    await goalField(page).fill('5000000')
    await page.getByRole('button', { name: 'Start' }).click()
    await expect(page.getByRole('heading', { name: 'Recent trades' })).toBeVisible()
    await expect(page.locator('.round-bar')).toContainText('5,000,000')
  })

  test('FR-003: the slider moves the text field, and the arrow keys step it', async ({ page }) => {
    await openSetup(page)
    const slider = page.getByRole('slider', { name: 'Starting capital ($)' })
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await expect(startField(page)).toHaveValue('11000')
  })
})

test.describe('FR-004 single play', () => {
  test('FR-004: B, S and C keys open a long, flip to a short and close', async ({ page }) => {
    await openSinglePlay(page)

    await page.keyboard.press('b')
    await expect(page.getByText(/\+50 @/)).toBeVisible()

    await page.keyboard.press('c')
    await expect(page.getByText('none', { exact: true })).toBeVisible()
    await expect(page.getByText("You haven't closed anything yet.")).toBeHidden()

    await page.keyboard.press('s')
    await expect(page.getByText(/-50 @/)).toBeVisible()
  })

  test('FR-004 UF-002: a margin call offers "Play again", which starts a fresh game', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    await openSinglePlay(page)
    await page
      .getByRole('group', { name: 'Size' })
      .getByRole('button', { name: '250 units' })
      .click()
    await page.getByRole('group', { name: 'Speed' }).getByRole('button', { name: '8×' }).click()

    // A huge long position is wiped out by the first dip of a few hundredths of a percent.
    const marginCall = page.getByRole('alertdialog')
    for (let i = 0; i < 400 && !(await marginCall.isVisible()); i++) {
      await page.keyboard.press('b')
      await page.waitForTimeout(50)
    }
    await expect(marginCall).toBeVisible({ timeout: 90_000 })
    await expect(marginCall.getByRole('heading', { name: 'Margin call' })).toBeVisible()

    await marginCall.getByRole('button', { name: 'Play again' }).click()
    await expect(marginCall).toBeHidden()
    await expect(page.getByText('none', { exact: true })).toBeVisible()
  })
})
