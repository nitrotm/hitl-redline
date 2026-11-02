import { type BrowserContext, chromium, expect, test } from '@playwright/test'
import { join } from 'node:path'

import { type Bridge, EXTENSION, expectRound, serveFixtures, startBridge } from './helpers.ts'

// Chrome's build (.output/chrome-mv3) in the dev shell's Chromium ($CHROMIUM_PATH), which still
// loads an unpacked extension.

let context: BrowserContext
let fixtures: Awaited<ReturnType<typeof serveFixtures>>
let bridge: Bridge

test.beforeAll(async () => {
  fixtures = await serveFixtures()
  const path = join(EXTENSION, 'chrome-mv3')
  context = await chromium.launchPersistentContext('', {
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    // Playwright's defaults turn extensions off
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`, '--headless=new'],
  })
})

test.afterAll(async () => {
  await context?.close()
  fixtures?.close()
  bridge?.process.kill()
})

test('screenshot, draw, comment and send a round', async () => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = new URL(worker.url()).host
  bridge = await startBridge(fixtures.url)

  // Redline starts by itself on the preview of `redline wait --url`
  const page = await context.newPage()
  await page.goto(fixtures.url)
  await expect(page.locator('redline-overlay .toolbar')).toBeVisible()
  const button = (await page.locator('button.cta').first().boundingBox())!

  // a screenshot first: the page freezes under it
  await page.keyboard.press('c')
  await expect(page.locator('redline-overlay .frozen')).toBeVisible()

  // a rectangle around the button, commented at once
  await page.mouse.move(button.x - 8, button.y - 8)
  await page.mouse.down()
  await page.mouse.move(button.x + button.width + 8, button.y + button.height + 8, { steps: 5 })
  await page.mouse.up()
  const popover = page.locator('redline-overlay .popover textarea')
  await expect(popover).toBeFocused()
  await page.keyboard.type('Make the button bigger')
  await page.keyboard.press('Enter')
  await expect(popover).toBeHidden()

  // an arrow, from the empty space to the heading
  await page.keyboard.press('3')
  await page.mouse.move(600, 420)
  await page.mouse.down()
  await page.mouse.move(300, 260, { steps: 5 })
  await page.mouse.up()
  await expect(popover).toBeFocused()
  await page.keyboard.type('Too much empty space here')
  await page.keyboard.press('Enter')
  await expect(page.locator('redline-overlay text', { hasText: '#2' })).toBeVisible()

  // the sidebar, opened in a tab of its own, has both, with their comments
  const sidebar = await context.newPage()
  await sidebar.goto(`chrome-extension://${extensionId}/sidepanel.html?url=${encodeURIComponent(fixtures.url)}`)
  const comments = sidebar.locator('.marks textarea')
  await expect(comments).toHaveCount(2)
  await expect(comments.nth(0)).toHaveValue('Make the button bigger')

  // selected in the sidebar, selected on the page
  await sidebar.locator('.marks li').first().click()
  await expect(sidebar.locator('.marks li.selected')).toHaveCount(1)
  await expect(page.locator('redline-overlay g.mark.selected[data-id="1"]')).toHaveCount(1)

  await sidebar.locator('footer textarea').fill('Round 1, overall')
  await sidebar.locator('footer textarea').blur()
  await sidebar.getByRole('button', { name: /^Send to Claude/ }).click()
  await expectRound(bridge, expect)
  await expect(sidebar.locator('.note.sent')).toContainText('Round 1 sent')
})
