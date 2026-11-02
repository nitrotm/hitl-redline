import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { Builder, By, Key, type WebDriver, until } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'

import { type Bridge, EXTENSION, expectRound, serveFixtures, startBridge } from './helpers.ts'

// Firefox's build (.output/firefox-mv2), installed as a temporary add-on by geckodriver: Playwright's
// Firefox cannot load extensions. Its moz-extension:// UUID is set, to open the sidebar in a tab.

const UUID = '6c1d1f4e-0f3a-4b5e-9d2a-7e8f9a0b1c2d'

let driver: WebDriver
let fixtures: Awaited<ReturnType<typeof serveFixtures>>
let bridge: Bridge

test.beforeAll(async () => {
  fixtures = await serveFixtures()
  const options = new firefox.Options()
    .addArguments('-headless')
    .windowSize({ width: 1280, height: 900 })
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ 'redline@firefox-redline': UUID }))
  if (process.env.FIREFOX_PATH) options.setBinary(process.env.FIREFOX_PATH)
  const geckodriver = execFileSync('which', ['geckodriver'], { encoding: 'utf8' }).trim()
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(new firefox.ServiceBuilder(geckodriver)).build()

  await (driver as firefox.Driver).installAddon(join(EXTENSION, 'firefox-mv2'), true)
})

test.afterAll(async () => {
  await driver?.quit()
  fixtures?.close()
  bridge?.process.kill()
})

test('screenshot, draw, comment and send a round', async () => {
  bridge = await startBridge(fixtures.url)
  await driver.get(fixtures.url)

  // Redline starts by itself on the preview of `redline wait --url`
  const overlay = await driver.wait(until.elementLocated(By.css('redline-overlay')), 10_000)
  const shadow = await overlay.getShadowRoot()
  await driver.wait(async () => (await shadow.findElements(By.css('.toolbar'))).length > 0, 10_000)
  const rect = await driver.executeScript<{ x: number; y: number; width: number; height: number }>(
    'return document.querySelector("button.cta").getBoundingClientRect().toJSON()'
  )

  // a screenshot first: the page freezes under it
  await driver.actions().keyDown(Key.CONTROL).sendKeys('s').keyUp(Key.CONTROL).perform()
  await driver.wait(async () => (await shadow.findElement(By.css('.frozen'))).isDisplayed(), 10_000)

  // a rectangle around the button, commented at once
  const at = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y), origin: 'viewport' as const })
  await driver
    .actions()
    .move(at(rect.x - 8, rect.y - 8))
    .press()
    .move({ ...at(rect.x + rect.width / 2, rect.y + rect.height / 2), duration: 100 })
    .move({ ...at(rect.x + rect.width + 8, rect.y + rect.height + 8), duration: 100 })
    .release()
    .perform()
  const popover = await shadow.findElement(By.css('.popover'))
  await driver.wait(() => popover.isDisplayed(), 5_000)
  await driver.actions().sendKeys('Make the button bigger', Key.ENTER).perform()
  await driver.wait(async () => !(await popover.isDisplayed()), 5_000)

  // an arrow, from the empty space to the heading
  await driver.actions().sendKeys('3').perform()
  await driver
    .actions()
    .move(at(600, 420))
    .press()
    .move({ ...at(450, 340), duration: 100 })
    .move({ ...at(300, 260), duration: 100 })
    .release()
    .perform()
  await driver.wait(() => popover.isDisplayed(), 5_000)
  await driver.actions().sendKeys('Too much empty space here', Key.ENTER).perform()
  await driver.wait(async () => (await shadow.findElements(By.css('[data-id="2"]'))).length > 0, 5_000)

  // the sidebar, opened in a tab of its own, has both, with their comments
  await driver.switchTo().newWindow('tab')
  await driver.get(`moz-extension://${UUID}/sidepanel.html?url=${encodeURIComponent(fixtures.url)}`)
  await driver.wait(async () => (await driver.findElements(By.css('.marks textarea'))).length === 2, 10_000)
  const general = await driver.findElement(By.css('footer textarea'))
  await general.sendKeys('Round 1, overall')
  await driver.findElement(By.css('.status')).click()

  await driver.findElement(By.xpath('//button[starts-with(normalize-space(), "Send to Claude")]')).click()
  await expectRound(bridge, expect)
  await driver.wait(until.elementLocated(By.css('.note.sent')), 5_000)
})
