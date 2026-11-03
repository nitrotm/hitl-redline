import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Builder, By, Key, type WebDriver, until } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'

import { type Bridge, EXTENSION, expectRound, serveFixtures, startBridge, token } from './helpers.ts'

// Firefox's build (.output/firefox-mv2), installed as a temporary add-on by geckodriver: Playwright's
// Firefox cannot load extensions. Its moz-extension:// UUID is set, to open the sidebar in a tab.
// No native host here: it pairs by the token pasted in the sidebar. Firefox gets a HOME of its own,
// where the user's (`redline install`, ~/.mozilla/native-messaging-hosts) is not.

const UUID = '6c1d1f4e-0f3a-4b5e-9d2a-7e8f9a0b1c2d'

let driver: WebDriver
let fixtures: Awaited<ReturnType<typeof serveFixtures>>
let bridge: Bridge

test.beforeAll(async () => {
  fixtures = await serveFixtures()
  const options = new firefox.Options()
    .addArguments('-headless')
    .windowSize({ width: 1280, height: 900 })
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ 'redline@tmsrv.org': UUID }))
  if (process.env.FIREFOX_PATH) options.setBinary(process.env.FIREFOX_PATH)
  const geckodriver = execFileSync('which', ['geckodriver'], { encoding: 'utf8' }).trim()
  const home = await mkdtemp(join(tmpdir(), 'redline-e2e-firefox-home-'))
  const service = new firefox.ServiceBuilder(geckodriver).setEnvironment({ ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') })
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build()

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

  // not paired: Redline does not start, and the sidebar asks for the token
  const page = await driver.getWindowHandle()
  await driver.switchTo().newWindow('tab')
  await driver.get(`moz-extension://${UUID}/sidepanel.html?url=${encodeURIComponent(fixtures.url)}`)
  const pasted = await driver.wait(until.elementLocated(By.css('.pair input')), 10_000)
  expect(await driver.findElements(By.xpath('//button[normalize-space()="Take a screenshot"]'))).toHaveLength(0)
  await pasted.sendKeys(await token())
  await driver.findElement(By.css('.pair button')).click()
  await driver.wait(until.elementLocated(By.xpath('//button[normalize-space()="Take a screenshot"]')), 10_000)
  expect(await driver.findElement(By.css('.status')).getText()).toContain(bridge.channel)
  await driver.close()
  await driver.switchTo().window(page)
  await driver.navigate().refresh()

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

  // a rectangle around the button, commented at once (the first screenshot starts with the pen)
  await driver.actions().sendKeys('2').perform()
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

test('read a session that an earlier version stored', async () => {
  await driver.switchTo().newWindow('tab')
  await driver.get(fixtures.url)
  await driver.switchTo().newWindow('tab')
  await driver.get(`moz-extension://${UUID}/sidepanel.html?url=${encodeURIComponent(fixtures.url)}`)

  // the session of the page's tab, as the version before the round's format 2 stored it: a pen mark of points
  await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1]
    const url = ${JSON.stringify(fixtures.url)}
    browser.tabs.query({}).then(async (tabs) => {
      const tab = tabs.find((t) => t.url === url)
      const snapshot = {
        id: 'S1', url, title: 'Old', capturedAt: '2026-11-02T10:00:00.000Z',
        viewport: { width: 1000, height: 800, dpr: 1, scrollX: 0, scrollY: 0 },
        annotations: [{ id: 1, kind: 'freehand', color: '#e11d48', comment: 'Old pen mark', points: [{ x: 10, y: 10 }, { x: 60, y: 40 }] }],
      }
      const session = {
        id: 'old', tabId: tab.id, active: true, round: 1, nextAnnotationId: 2, nextSnapshotNumber: 2,
        draft: [], snapshots: [snapshot], current: 'S1', comment: '', tool: 'freehand', color: '#e11d48',
      }
      await browser.storage.local.set({ 'redline:sessions': { [tab.id]: session } })
      done()
    })
  `)
  await driver.navigate().refresh()
  await driver.wait(async () => (await driver.findElements(By.css('.marks textarea'))).length === 1, 10_000)
  expect(await driver.findElement(By.css('.marks textarea')).getAttribute('value')).toBe('Old pen mark')
  expect(await driver.findElement(By.css('.marks .kind')).getText()).toContain('Freehand')
})

test('name the Preact components of a mark, and where its JSX is', async () => {
  const url = `${fixtures.url}preact-page.html`
  bridge = await startBridge(url)
  await driver.switchTo().newWindow('tab')
  await driver.get(url)
  const overlay = await driver.wait(until.elementLocated(By.css('redline-overlay')), 10_000)
  const shadow = await overlay.getShadowRoot()
  await driver.wait(until.elementLocated(By.css('button.cta')), 10_000)
  const rect = await driver.executeScript<{ x: number; y: number; width: number; height: number }>(
    'return document.querySelector("button.cta").getBoundingClientRect().toJSON()'
  )

  await driver.actions().keyDown(Key.CONTROL).sendKeys('s').keyUp(Key.CONTROL).perform()
  await driver.wait(async () => (await shadow.findElement(By.css('.frozen'))).isDisplayed(), 10_000)
  await driver.actions().sendKeys('2').perform()
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
  await driver.actions().sendKeys('Bigger', Key.ENTER).perform()

  // the sidebar names the components, once the page has told them
  await driver.switchTo().newWindow('tab')
  await driver.get(`moz-extension://${UUID}/sidepanel.html?url=${encodeURIComponent(url)}`)
  await driver.wait(async () => {
    const kinds = await driver.findElements(By.css('.marks .kind'))
    return kinds.length === 1 && (await kinds[0]!.getText()).includes('Hero › Button')
  }, 10_000)
  await driver.findElement(By.xpath('//button[starts-with(normalize-space(), "Send to Claude")]')).click()

  const { code, stdout } = await bridge.done
  expect(code, stdout).toBe(0)
  const md = await readFile(join(bridge.dir, bridge.channel, '001', 'feedback.md'), 'utf8')
  expect(md).toContain('  - Preact: `App › Hero › Button`, its JSX at `/project/src/App.tsx:3:5`')
})
