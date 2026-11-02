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

test('draw, comment, capture and send a round', async () => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = new URL(worker.url()).host
  bridge = await startBridge(fixtures.url)

  // Redline starts by itself on the preview of `redline wait --url`
  const page = await context.newPage()
  await page.goto(fixtures.url)
  const toolbar = page.locator('redline-overlay .toolbar')
  await expect(toolbar).toBeVisible()

  // a rectangle around the button, then a freehand mark
  const button = (await page.locator('button.cta').first().boundingBox())!
  await page.mouse.move(button.x - 8, button.y - 8)
  await page.mouse.down()
  await page.mouse.move(button.x + button.width + 8, button.y + button.height + 8, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('redline-overlay text', { hasText: '#1' })).toBeVisible()

  await page.keyboard.press('p')
  await page.mouse.move(400, 260)
  await page.mouse.down()
  for (const [x, y] of [
    [440, 240],
    [480, 270],
    [520, 250],
    [560, 280],
  ] as const)
    await page.mouse.move(x, y, { steps: 3 })
  await page.mouse.up()
  await expect(page.locator('redline-overlay text', { hasText: '#2' })).toBeVisible()

  // comments, in the sidebar opened in a tab of its own
  const sidebar = await context.newPage()
  await sidebar.goto(`chrome-extension://${extensionId}/sidepanel.html?url=${encodeURIComponent(fixtures.url)}`)
  const comments = sidebar.locator('.marks textarea')
  await expect(comments).toHaveCount(2)
  await comments.nth(0).fill('Make the button bigger')
  await comments.nth(1).fill('Too much empty space here')
  await sidebar.locator('footer textarea').fill('Round 1, overall')
  await sidebar.locator('footer textarea').blur()

  // capture from the page, which must be the active tab
  await page.bringToFront()
  await page.keyboard.press('c')
  await expect(sidebar.locator('h2', { hasText: 'S1' })).toBeVisible()
  await expect(sidebar.locator('.thumb img')).toBeVisible()

  await sidebar.bringToFront()
  await sidebar.getByRole('button', { name: 'Send to Claude' }).click()
  await expectRound(bridge, expect)
  await expect(sidebar.locator('.note.sent')).toContainText('Round 1 sent')
})
