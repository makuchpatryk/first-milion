import { expect, test, type Page } from '@playwright/test'
import { createAccount, signIn } from '../fixtures/auth'

async function openSinglePlay(page: Page): Promise<void> {
  await signIn(page, await createAccount({ prefix: 'solo' }))
  await page.getByRole('link', { name: /^Single play/ }).click()
  await expect(page).toHaveURL(/\/single$/)
  await expect(page.getByRole('heading', { name: 'Recent trades' })).toBeVisible()
}

test.describe('FR-004 single play', () => {
  test('FR-020: the game screen has no horizontal scroll at the project viewport', async ({
    page,
  }) => {
    await openSinglePlay(page)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

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

  test('FR-004: the on-screen Buy button trades like the key', async ({ page }) => {
    await openSinglePlay(page)
    await page.getByRole('button', { name: /^Buy/ }).click()
    await expect(page.getByText(/\+50 @/)).toBeVisible()
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
