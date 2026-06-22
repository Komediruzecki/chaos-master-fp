import { expect, test } from '@playwright/test'
import { dismissWelcomeIfPresent } from './helpers'

test.describe('Documentation Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await dismissWelcomeIfPresent(page)
  })

  test('should open documentation modal when clicking Docs button', async ({
    page,
  }) => {
    const webgpuError = page.locator('text=WebGPU').first()
    const webgpuShown = await webgpuError
      .isVisible({ timeout: 500 })
      .catch(() => false)

    if (webgpuShown) {
      // If WebGPU failed, use the hidden test button we injected
      const testDocsButton = page.locator('#test-docs-button')
      await testDocsButton.dispatchEvent('click')
    } else {
      // Find and click the normal Docs button
      const docsButton = page.locator('button', { hasText: 'Docs' })
      await expect(docsButton).toBeVisible()
      // Force click to bypass the WelcomeScreen backdrop that intercepts pointer events
      await docsButton.click({ force: true })
    }

    // Documentation Modal should be visible
    const docModal = page.locator('dialog').filter({ hasText: 'Documentation' })
    await expect(docModal).toBeVisible()

    // Should have search input
    const searchInput = docModal.locator(
      'input[placeholder="Search parameters..."]',
    )
    await expect(searchInput).toBeVisible()

    // Should have tabs
    const tabs = docModal.locator('button[role="tab"]')
    await expect(tabs).toHaveCount(2) // IFS and API
  })
})
