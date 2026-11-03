import { type Bridge, type Rendered, bridgeForSession } from '@redline/shared'

import { BridgeError, bridgeForTab, findBridges, heldChannels, postRound } from '@/src/bridge-client.ts'
import { composite, crop } from '@/src/capture/composite.ts'
import { inspectPage } from '@/src/frameworks.ts'
import type { CaptureResult, ContentRequest, PreparedCapture, Request, Responses, Result } from '@/src/messages.ts'
import { setToken } from '@/src/pairing.ts'
import { deleteImage, deleteSessionImages, getImage, putImage } from '@/src/state/images.ts'
import {
  type Session,
  addAnnotation,
  bindChannel,
  buildRound,
  closeSnapshot,
  createSession,
  deleteAnnotation,
  deleteSnapshot,
  markReloaded,
  needsReload,
  openSnapshot,
  queueRound,
  roundFailed,
  roundSent,
  selectAnnotation,
  setAnswer,
  setTool,
  storeReply,
  takeSnapshot,
  undo,
  updateAnnotation,
} from '@/src/state/session.ts'
import { getSession, getSessions, update } from '@/src/state/store.ts'

// The background owns the sessions: the overlay and the sidebar ask it for every change
// (src/messages.ts), and watch storage for the result. It captures the screenshots, draws the
// marks on them, and sends the rounds to `redline wait`, again until one listens.

const OVERLAY_SCRIPT = '/content-scripts/overlay.js'
const OUTBOX_ALARM = 'redline-outbox'

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((request: Request, sender) => {
    const tabId = 'tabId' in request && request.tabId !== undefined ? request.tabId : sender.tab?.id
    return handle(request, tabId).then(
      (value): Result<unknown> => ({ ok: true, value }),
      (error: unknown): Result<unknown> => ({ ok: false, error: error instanceof Error ? error.message : String(error) })
    )
  })

  // the toolbar button opens the sidebar, and starts annotating the tab; the sidebar must open
  // first, while the click still counts as the user's
  ;(browser.action ?? browser.browserAction).onClicked.addListener((tab) => {
    openSidebar(tab.windowId)
    if (tab.id !== undefined) void start(tab.id)
  })

  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'toggle-redline') return
    const tabId = tab?.id ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id
    if (tabId === undefined) return
    if ((await getSession(tabId))?.active) await stop(tabId)
    else await start(tabId)
  })

  // A reload or a navigation loses the overlay (the agent reloads the page after each round). A page
  // of the app whose preview `redline wait --url` names starts a session by itself, bound to that
  // the agent, unless the tab has one already, even stopped; a finished one (Done) does not count.
  browser.tabs.onUpdated.addListener(async (tabId, change, tab) => {
    if (change.status !== 'complete') return
    const session = await getSession(tabId)
    if (session?.active) await inject(tabId).catch(() => undefined)
    else if ((!session || (session.lastSent?.status === 'done' && !session.pending)) && tab.url && /^https?:/.test(tab.url)) {
      // a bridge for that app: not one waiting for any page
      const { bridges } = await findBridges()
      const bridge = bridgeForSession(
        bridges.filter((b) => b.status.url),
        tab.url,
        undefined,
        await heldChannels(tabId)
      )
      if (bridge) await start(tabId, bridge).catch(() => undefined)
    }
  })
  browser.tabs.onRemoved.addListener((tabId) => void discard(tabId))

  void browser.alarms.create(OUTBOX_ALARM, { periodInMinutes: 0.5 })
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === OUTBOX_ALARM) void flush()
  })
})

async function handle(request: Request, tabId: number | undefined): Promise<Responses[Request['type']]> {
  if (request.type === 'outbox/flush') return flush()
  if (request.type === 'pair/set') {
    await setToken(request.token)
    return flush()
  }
  if (request.type === 'whoami') {
    if (tabId === undefined) throw new Error('whoami: not a tab')
    return tabId
  }
  if (tabId === undefined) throw new Error(`${request.type}: no tab`)

  switch (request.type) {
    case 'session/discard':
      return discard(tabId)
    case 'session/bind':
      return change(tabId, (s) => bindChannel(s, request.channel, request.agent))
    case 'page/inspect':
      return inspect(tabId, request.nonce)
    case 'ui/set':
      if (!(await getSession(tabId))?.active) await start(tabId)
      return change(tabId, (s) => ({ ...(request.tool ? setTool(s, request.tool) : s), color: request.color ?? s.color, device: request.device ?? s.device }))
    case 'annotation/add':
      return update(tabId, (s) => addAnnotation(required(s), request.annotation))
    case 'annotation/update':
      return change(tabId, (s) => updateAnnotation(s, request.id, request.patch))
    case 'annotation/select':
      // the tool stays: any of them moves a mark
      return change(tabId, (s) => selectAnnotation(s, request.id))
    case 'annotation/delete':
      return change(tabId, (s) => deleteAnnotation(s, request.id))
    case 'annotation/undo':
      return change(tabId, undo)
    case 'snapshot/capture': {
      // a screenshot is for the agent: none while it does not listen for the page
      const tab = await browser.tabs.get(tabId)
      const session = await getSession(tabId)
      const live = session && session.lastSent?.status !== 'done' ? session : undefined
      const bridge = await bridgeForTab(tab.url, live ?? { tabId })
      if (!bridge)
        throw new Error(
          live?.channel
            ? `${capitalized(live.agent ?? 'your agent')} (${live.channel}) is not listening: it is at work on the last round, or its review ended`
            : 'No agent is listening for this page: ask yours to review it (/redline)'
        )
      if (!session?.active) await start(tabId, bridge)
      else if (!session.channel) await change(tabId, (s) => bindChannel(s, bridge.status.channel, bridge.status.agent))
      return capture(tabId)
    }
    case 'snapshot/open':
      return change(tabId, (s) => openSnapshot(s, request.snapshotId))
    case 'snapshot/close':
      return change(tabId, closeSnapshot)
    case 'snapshot/delete': {
      const session = required(await getSession(tabId))
      await change(tabId, (s) => deleteSnapshot(s, request.snapshotId))
      await deleteImage(session.id, request.snapshotId)
      return null
    }
    case 'snapshot/image': {
      const image = await getImage(required(await getSession(tabId)).id, request.snapshotId)
      if (!image) throw new Error(`the screenshot of ${request.snapshotId} is missing`)
      return image
    }
    case 'comment/set':
      return change(tabId, (s) => ({ ...s, comment: request.comment }))
    case 'reply/store':
      return change(tabId, (s) => storeReply(s, request.reply))
    case 'answer/set':
      return change(tabId, (s) => setAnswer(s, request.question, request.answer))
    case 'round/submit':
      await change(tabId, (s) => queueRound(s, request.status, new Date().toISOString()))
      await flush()
      return null
  }
}

function required(session: Session | undefined): Session {
  if (!session) throw new Error('Redline is not started on this tab')
  return session
}

async function change(tabId: number, next: (session: Session) => Session): Promise<null> {
  return update(tabId, (s) => [next(required(s)), null])
}

// CHANNEL: the agent that listens for the page, which the session is bound to if it is not yet
async function start(tabId: number, bridge?: Bridge): Promise<Session> {
  const channel = bridge?.status.channel
  const agent = bridge?.status.agent
  const session = await update(tabId, (s) => {
    const kept = s && s.lastSent?.status !== 'done' ? { ...s, active: true } : undefined
    const next = kept ? (channel && !kept.channel ? bindChannel(kept, channel, agent) : kept) : createSession(tabId, crypto.randomUUID(), channel, agent)
    return [next, next]
  })
  await inject(tabId)
  return session
}

// the overlay leaves the page; the session stays, to start again where it was
async function stop(tabId: number): Promise<null> {
  return update(tabId, (s) => [s && { ...s, active: false }, null])
}

async function discard(tabId: number): Promise<null> {
  const session = await getSession(tabId)
  await update(tabId, () => [undefined, null])
  if (session) await deleteSessionImages(session.id)
  return null
}

// The overlay, once per page: it starts only if not already there (entrypoints/overlay.content.ts).
async function inject(tabId: number) {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [OVERLAY_SCRIPT] })
  } catch (error) {
    await update(tabId, (s) => [s && { ...s, active: false }, null])
    throw new Error(`Redline cannot draw on this page: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// In the page itself, where its framework's properties are (src/frameworks.ts); nothing if it
// cannot be run there.
async function inspect(tabId: number, nonce: string): Promise<Rendered | null> {
  try {
    const [result] = await browser.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: inspectPage, args: [nonce] })
    return (result?.result as Rendered | null | undefined) ?? null
  } catch {
    return null
  }
}

function tell<T>(tabId: number, request: ContentRequest): Promise<T> {
  return browser.tabs.sendMessage(tabId, request) as Promise<T>
}

// The overlay hides while the tab is captured, a screenshot it may be showing too: the live page
// is what is captured. The new snapshot is the one to annotate.
async function capture(tabId: number): Promise<CaptureResult> {
  const tab = await browser.tabs.get(tabId)
  const captureTab = firefoxCaptureTab()
  if (!captureTab && !tab.active) throw new Error('the tab must be the active one of its window to be captured')

  return update(tabId, async (s) => {
    const session = required(s)
    const prepared = await tell<PreparedCapture>(tabId, { type: 'capture/prepare' })
    let clean: string
    try {
      clean = captureTab ? await captureTab(tabId, { format: 'png' }) : await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    } finally {
      await tell(tabId, { type: 'capture/restore' })
    }

    // shown as a device: its frame, out of the window's screenshot
    const { device, ...capture } = prepared
    if (device) clean = await crop(clean, device.crop, device.windowWidth)
    const [next, snapshot] = takeSnapshot(session, { ...capture, device: device?.label, capturedAt: new Date().toISOString() })
    await putImage(session.id, snapshot.id, clean)
    return [next, { snapshotId: snapshot.id }]
  })
}

// Firefox's: the tab itself, shown or not (Chrome has only the shown tab of a window)
function firefoxCaptureTab() {
  return (browser.tabs as unknown as { captureTab?: (tabId: number, options: { format: 'png' }) => Promise<string> }).captureTab
}

let flushing = false

// Sends every submitted round to the bridge; a round no one took waits for the next try: the
// alarm's, or the sidebar's once it sees a bridge listening. Reloads the tabs whose agent changed
// their page and cannot reload it itself (`redline wait --reload`).
async function flush(): Promise<null> {
  if (flushing) return null
  flushing = true
  try {
    const sessions = Object.values(await getSessions())
    if (!sessions.some((s) => s.pending || s.channel)) return null
    const found = await findBridges()
    await reloadBound(sessions, found.bridges)
    for (const session of sessions) {
      if (!session.pending) continue
      try {
        // the marks, drawn on the screenshots as the overlay draws them, with their #id
        const images = new Map<string, { clean: string; annotated: string }>()
        for (const snapshot of session.snapshots) {
          const clean = await getImage(session.id, snapshot.id)
          if (clean) images.set(snapshot.id, { clean, annotated: await composite(clean, snapshot.annotations, snapshot.viewport) })
        }
        // the bridge of the session's channel, if it listens; for one not bound yet, that of the
        // page its screenshots are of, not where the tab went since
        const tab = await browser.tabs.get(session.tabId).catch(() => undefined)
        const bridge = await bridgeForTab(session.snapshots[0]?.url ?? tab?.url, session, found)
        if (!bridge) throw new BridgeError('the agent is not listening', true)
        const accepted = await postRound(buildRound(session, images), bridge)
        const { channel, agent } = bridge.status
        await update(session.tabId, (s) => [s && roundSent(bindChannel(s, channel, agent), accepted.directory, new Date().toISOString()), null])
        for (const snapshot of session.snapshots) await deleteImage(session.id, snapshot.id)
        if (session.pending.status === 'done') await deleteSessionImages(session.id)
      } catch (error) {
        const message = error instanceof BridgeError && error.offline ? undefined : error instanceof Error ? error.message : String(error)
        await update(session.tabId, (s) => [s && (message ? roundFailed(s, message) : s), null])
      }
    }
  } finally {
    flushing = false
  }
  return null
}

// once per run of the channel's wait, each tab bound to it that the wait asks to reload
async function reloadBound(sessions: Session[], bridges: Bridge[]) {
  for (const session of sessions) {
    const bridge = session.channel ? bridges.find((b) => b.status.channel === session.channel) : undefined
    if (!bridge || !needsReload(session, bridge.status.nonce, bridge.status.reload)) continue
    const { nonce } = bridge.status
    await update(session.tabId, (s) => [s && markReloaded(s, nonce), null])
    await browser.tabs.reload(session.tabId).catch(() => undefined)
  }
}

function openSidebar(windowId: number) {
  const firefox = (browser as unknown as { sidebarAction?: { open(): Promise<void> } }).sidebarAction
  if (firefox) void firefox.open()
  else void browser.sidePanel?.open({ windowId })
}

function capitalized(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}
