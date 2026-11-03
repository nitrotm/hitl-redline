import { type BrowserContext, type Page, chromium, expect, test } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { type Server, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'

import { type Bridge, EXTENSION, chromiumUserData, startBridge } from '../e2e/helpers.ts'

// The README's pictures: one review round on a demo page, in Chrome's build, played as a user
// would. Each step is a frame of the page and the sidebar side by side, with the mouse pointer
// drawn in; the script then plays the agent, who fixes the page and replies. `yarn shots` writes
// docs/images/ (hero.png, reply.png, round/) and the frames that tests/readme/gif.sh makes the GIF of.

const ROOT = join(import.meta.dirname, '../../../..')
const IMAGES = join(ROOT, 'docs/images')
const FRAMES = join(import.meta.dirname, '../../test-results/readme-frames')
const PAGE = { width: 1120, height: 760 }
const SIDEBAR = { width: 400, height: PAGE.height }
const SCALE = 2

type Panel = 'page' | 'sidebar'
interface Frame {
  page: Buffer
  sidebar: Buffer
  pointer: { panel: Panel; x: number; y: number }
  ms: number
}

let context: BrowserContext
let server: Server
let bridge: Bridge | undefined
// the page the demo app serves: the agent changes it
let html = ''

test.beforeAll(async () => {
  html = await readFile(join(import.meta.dirname, 'demo-before.html'), 'utf8')
  server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const path = join(EXTENSION, 'chrome-mv3')
  context = await chromium.launchPersistentContext(await chromiumUserData(), {
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    // a real scale, not Playwright's emulated one, which the extension's capture does not follow
    viewport: null,
    args: [
      `--disable-extensions-except=${path}`,
      `--load-extension=${path}`,
      '--headless=new',
      `--window-size=${PAGE.width},${PAGE.height}`,
      `--force-device-scale-factor=${SCALE}`,
    ],
  })
})

test.afterAll(async () => {
  await context?.close()
  server?.close()
  bridge?.process.kill()
})

test('a review round, for the README', async () => {
  test.setTimeout(120_000)
  const { port } = server.address() as { port: number }
  const url = `http://127.0.0.1:${port}/`
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = new URL(worker.url()).host
  // a project of the demo app's name, its rounds in its `.redline`, as the sidebar shows them
  const app = join(tmpdir(), 'kestrel')
  const project = join(app, '.redline')
  await rm(app, { recursive: true, force: true })
  await mkdir(app)
  bridge = await startBridge(url, ['--dir', project], app)

  const page = await context.newPage()
  await resize(page, PAGE)
  await page.goto(url)
  await expect(page.locator('redline-overlay')).toBeAttached()
  const sidebar = await context.newPage()
  await resize(sidebar, SIDEBAR)
  await sidebar.goto(`chrome-extension://${extensionId}/sidepanel.html?url=${encodeURIComponent(url)}`)
  await expect(sidebar.locator('.status')).toContainText('Claude is listening')
  // Chrome captures the shown tab only
  await page.bringToFront()

  const frames: Frame[] = []
  const pointer: Frame['pointer'] = { panel: 'page', x: 860, y: 640 }
  const frame = async (ms: number) => {
    frames.push({ page: await page.screenshot(), sidebar: await sidebar.screenshot(), pointer: { ...pointer }, ms })
  }
  const move = async (x: number, y: number, steps = 1, shots = 0) => {
    const from = { ...pointer }
    for (let i = 1; i <= steps; i++) {
      pointer.x = from.x + ((x - from.x) * i) / steps
      pointer.y = from.y + ((y - from.y) * i) / steps
      await page.mouse.move(pointer.x, pointer.y)
      if (shots && i % Math.ceil(steps / shots) === 0 && i < steps) await frame(120)
    }
  }
  const popover = page.locator('redline-overlay .popover textarea')
  const comment = async (text: string) => {
    await expect(popover).toBeFocused()
    const words = text.split(' ')
    const half = Math.ceil(words.length / 2)
    await page.keyboard.type(words.slice(0, half).join(' ') + ' ')
    await frame(250)
    await page.keyboard.type(words.slice(half).join(' '))
    await frame(900)
    await page.keyboard.press('Enter')
    await expect(popover).toBeHidden()
  }

  // the live page
  await frame(1600)

  // a screenshot: the page freezes under it
  await page.keyboard.press('Control+s')
  await expect(page.locator('redline-overlay .frozen')).toBeVisible()
  await frame(1000)

  // #1, a rectangle around the trial button
  const button = (await page.locator('.featured button').boundingBox())!
  await page.keyboard.press('2')
  await move(button.x - 12, button.y - 12, 8, 2)
  await page.mouse.down()
  await move(button.x + button.width + 12, button.y + button.height + 12, 10, 3)
  await page.mouse.up()
  await frame(300)
  await comment('Make this the main call to action: filled, full width')

  // #2, an arrow to the price
  const price = (await page.locator('.featured .price').boundingBox())!
  await page.keyboard.press('3')
  // the paragraph is as wide as the card: its text ends at about 90px
  await move(price.x + 230, price.y - 64, 8, 2)
  await page.mouse.down()
  await move(price.x + 104, price.y + price.height / 2 - 2, 8, 3)
  await page.mouse.up()
  await frame(300)
  await comment('Prices should be the biggest thing on the cards')

  // #3, the pen around a typo
  const billing = (await page.locator('.featured .billing').boundingBox())!
  await page.keyboard.press('4')
  const cx = billing.x + 45
  const cy = billing.y + billing.height / 2
  const loop = Array.from({ length: 29 }, (_, i) => {
    const a = -Math.PI / 2 - 0.4 + (i / 28) * (2 * Math.PI + 0.5)
    return [cx + 62 * Math.cos(a), cy + 17 * Math.sin(a)] as const
  })
  await move(loop[0]![0], loop[0]![1], 8, 2)
  await page.mouse.down()
  for (const [i, [x, y]] of loop.entries()) {
    await move(x, y)
    if (i % 7 === 6) await frame(120)
  }
  await page.mouse.up()
  await frame(300)
  await comment('Typo: annually')
  await expect(sidebar.locator('.marks textarea')).toHaveCount(3)

  // the marks, in the sidebar: the README's first picture
  await move(980, 700, 6, 1)
  await frame(2400)
  const hero = frames.length - 1

  // sent from the sidebar
  pointer.panel = 'sidebar'
  const send = sidebar.getByRole('button', { name: /^Send to Claude/ })
  const box = (await send.boundingBox())!
  pointer.x = box.x + box.width / 2
  pointer.y = box.y + box.height / 2
  await frame(900)
  await send.click()
  const { code, stdout } = await bridge.done
  expect(code, stdout).toBe(0)
  await expect(sidebar.locator('.note.sent')).toContainText('Round 1 sent')
  await frame(1400)

  // the round the agent got
  const round = join(project, 'rounds', '001')
  await rm(join(IMAGES, 'round'), { recursive: true, force: true })
  await mkdir(join(IMAGES, 'round'), { recursive: true })
  for (const file of ['feedback.md', 'S1.annotated.png']) await writeFile(join(IMAGES, 'round', file), await readFile(join(round, file)))

  // the agent fixes the page, replies, and has it reloaded
  html = await readFile(join(import.meta.dirname, 'demo-after.html'), 'utf8')
  const { sessionId } = JSON.parse(await readFile(join(round, 'feedback.json'), 'utf8'))
  const replyFile = join(project, 'reply.json')
  await writeFile(
    replyFile,
    JSON.stringify({
      sessionId,
      round: 1,
      summary: 'Three changes, in pricing.css and Pricing.tsx.',
      marks: [
        { id: 1, text: 'Filled with the brand color, full width.' },
        { id: 2, text: 'Prices 17 → 34px, bold; "/ month" stays small.' },
        { id: 3, text: 'Fixed, and the same typo in the FAQ.' },
      ],
      questions: [{ id: 'Q1', text: 'Should the other two buttons be filled too?', mark: 1 }],
    })
  )
  bridge = await startBridge(url, ['--dir', project, '--reply', replyFile, '--reload'], app)
  await expect(sidebar.locator('.reply')).toContainText('Filled with the brand color')
  await expect(page.locator('.price small').first()).toBeVisible()
  await expect(page.locator('redline-overlay .frozen')).toBeHidden()
  pointer.panel = 'page'
  pointer.x = 820
  pointer.y = 700
  await frame(4000)
  const reply = frames.length - 1

  await rm(FRAMES, { recursive: true, force: true })
  await mkdir(FRAMES, { recursive: true })
  const durations: string[] = []
  for (const [i, f] of frames.entries()) {
    const png = PNG.sync.write(stitch(f))
    const name = `${String(i).padStart(3, '0')}.png`
    await writeFile(join(FRAMES, name), png)
    durations.push(`${name} ${f.ms}`)
    if (i === hero) await writeFile(join(IMAGES, 'hero.png'), png)
    if (i === reply) await writeFile(join(IMAGES, 'reply.png'), png)
  }
  await writeFile(join(FRAMES, 'durations.txt'), durations.join('\n') + '\n')
})

// A page's size, at the window's real scale: Playwright's setViewportSize would emulate a scale of 1.
async function resize(page: Page, size: { width: number; height: number }) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 0, mobile: false })
}

// The page and the sidebar side by side, as in one browser window, and the pointer over them.
function stitch(frame: Frame): PNG {
  const page = PNG.sync.read(frame.page)
  const side = PNG.sync.read(frame.sidebar)
  const line = SCALE
  const out = new PNG({ width: line + page.width + line + side.width + line, height: line + page.height + line })
  out.data.fill(0)
  for (let i = 0; i < out.data.length; i += 4) out.data.set([0xcb, 0xd5, 0xe1, 0xff], i)
  PNG.bitblt(page, out, 0, 0, page.width, page.height, line, line)
  PNG.bitblt(side, out, 0, 0, side.width, side.height, line + page.width + line, line)
  const left = frame.pointer.panel === 'page' ? line : line + page.width + line
  drawPointer(out, left + frame.pointer.x * SCALE, line + frame.pointer.y * SCALE)
  return out
}

// The usual arrow, its tip at (x, y): X is its outline, o its fill.
const ARROW = [
  'X',
  'XX',
  'XoX',
  'XooX',
  'XoooX',
  'XooooX',
  'XoooooX',
  'XooooooX',
  'XoooooooX',
  'XooooooooX',
  'XoooooXXXXX',
  'XooXooX',
  'XoX XooX',
  'XX  XooX',
  'X    XooX',
  '     XooX',
  '      XX',
]

function drawPointer(png: PNG, x: number, y: number) {
  for (const [row, cells] of ARROW.entries())
    for (const [col, cell] of [...cells].entries()) {
      if (cell === ' ') continue
      const color = cell === 'X' ? [0x11, 0x11, 0x11, 0xff] : [0xff, 0xff, 0xff, 0xff]
      for (let dy = 0; dy < SCALE; dy++)
        for (let dx = 0; dx < SCALE; dx++) {
          const px = Math.round(x) + col * SCALE + dx
          const py = Math.round(y) + row * SCALE + dy
          if (px < png.width && py < png.height) png.data.set(color, (py * png.width + px) * 4)
        }
    }
}
