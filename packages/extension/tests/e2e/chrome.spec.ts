import { type BrowserContext, chromium, expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type Bridge, EXTENSION, expectRound, readPng, serveFixtures, startBridge } from './helpers.ts'

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
  await page.keyboard.press('Control+s')
  await expect(page.locator('redline-overlay .frozen')).toBeVisible()

  // a rectangle around the button, commented at once (the first screenshot starts with the pen)
  await page.keyboard.press('2')
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

  // a double click on #1, the arrow still the tool: its comment, all of it selected
  await page.mouse.dblclick(button.x + button.width / 2, button.y + button.height / 2)
  await expect(popover).toBeFocused()
  await expect(popover).toHaveValue('Make the button bigger')
  expect(await popover.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 'Make the button bigger'.length])
  await page.keyboard.press('Escape')

  // a double click on #2's badge does the same, the pen now the tool
  await page.keyboard.press('4')
  const badge = (await page.locator('redline-overlay text', { hasText: '#2' }).boundingBox())!
  await page.mouse.dblclick(badge.x + badge.width / 2, badge.y + badge.height / 2)
  await expect(popover).toBeFocused()
  await expect(popover).toHaveValue('Too much empty space here')
  await page.keyboard.press('Escape')

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
  await sidebar.close()
  await page.close()
})

test('show the page as a phone, and capture it so', async () => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = new URL(worker.url()).host
  bridge = await startBridge(fixtures.url)
  const page = await context.newPage()
  await page.goto(fixtures.url)
  await expect(page.locator('redline-overlay .toolbar')).toBeVisible()

  // the page, in a frame of the phone's size: its media queries are the phone's
  await page.locator('redline-overlay .device-select').selectOption('phone')
  const frame = page.frameLocator('redline-overlay iframe')
  await expect(frame.locator('button.cta').first()).toBeVisible()
  expect(await frame.locator('body').evaluate(() => window.innerWidth)).toBe(393)

  await page.locator('redline-overlay button[data-action="capture"]').click()
  const canvas = page.locator('redline-overlay .frozen svg')
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  await page.keyboard.press('2')
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + 120)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 180, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.type('Too wide on a phone')
  await page.keyboard.press('Enter')

  const sidebar = await context.newPage()
  await sidebar.goto(`chrome-extension://${extensionId}/sidepanel.html?url=${encodeURIComponent(fixtures.url)}`)
  await expect(sidebar.locator('h2', { hasText: 'Phone (iPhone 15)' })).toBeVisible()
  await sidebar.getByRole('button', { name: /^Send to Claude/ }).click()

  const { code, stdout } = await bridge.done
  expect(code, stdout).toBe(0)
  const round = join(bridge.dir, 'rounds', '001')
  const md = await readFile(join(round, 'feedback.md'), 'utf8')
  expect(md).toContain('- Viewport: 393×852 CSS px, as a Phone (iPhone 15)')
  expect(md).toContain('> Too wide on a phone')
  // the screenshot is the frame's: the phone's proportions
  const clean = await readPng(join(round, 'S1.clean.png'))
  expect(clean.width / clean.height).toBeCloseTo(393 / 852, 1)
})
