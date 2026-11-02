import { isUnder } from '@redline/shared'

import { BridgeError, bridgeStatus, postRound } from '@/src/bridge-client.ts'
import { composite } from '@/src/capture/composite.ts'
import type { CaptureResult, ContentRequest, PreparedCapture, Reply, Request, Responses } from '@/src/messages.ts'
import { deleteImage, deleteSessionImages, getImage, putImage } from '@/src/state/images.ts'
import {
  type Session,
  addAnnotation,
  buildRound,
  closeSnapshot,
  createSession,
  deleteAnnotation,
  deleteSnapshot,
  openSnapshot,
  queueRound,
  roundFailed,
  roundSent,
  selectAnnotation,
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
      (value): Reply<unknown> => ({ ok: true, value }),
      (error: unknown): Reply<unknown> => ({ ok: false, error: error instanceof Error ? error.message : String(error) })
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

  // A reload or a navigation loses the overlay (Claude reloads the page after each round). A page
  // of the preview that `redline wait --url` names starts a session by itself, unless the tab has
  // one already, even stopped; a finished one (Done) does not count.
  browser.tabs.onUpdated.addListener(async (tabId, change, tab) => {
    if (change.status !== 'complete') return
    const session = await getSession(tabId)
    if (session?.active) await inject(tabId).catch(() => undefined)
    else if ((!session || (session.lastSent?.status === 'done' && !session.pending)) && tab.url && /^https?:/.test(tab.url)) {
      const status = await bridgeStatus()
      if (status?.url && isUnder(tab.url, status.url)) await start(tabId).catch(() => undefined)
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
  if (request.type === 'whoami') {
    if (tabId === undefined) throw new Error('whoami: not a tab')
    return tabId
  }
  if (tabId === undefined) throw new Error(`${request.type}: no tab`)

  switch (request.type) {
    case 'ui/set':
      return change(tabId, (s) => ({ ...s, tool: request.tool ?? s.tool, color: request.color ?? s.color }))
    case 'annotation/add':
      return update(tabId, (s) => addAnnotation(required(s), request.annotation))
    case 'annotation/update':
      return change(tabId, (s) => updateAnnotation(s, request.id, request.patch))
    case 'annotation/select':
      // selected, it is to be moved or deleted: the select tool
      return change(tabId, (s) => {
        const next = selectAnnotation(s, request.id)
        return request.id === null ? next : { ...next, tool: 'select' }
      })
    case 'annotation/delete':
      return change(tabId, (s) => deleteAnnotation(s, request.id))
    case 'annotation/undo':
      return change(tabId, undo)
    case 'snapshot/capture':
      if (!(await getSession(tabId))?.active) await start(tabId)
      return capture(tabId)
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

async function start(tabId: number): Promise<Session> {
  const session = await update(tabId, (s) => {
    const next = s && s.lastSent?.status !== 'done' ? { ...s, active: true } : createSession(tabId, crypto.randomUUID())
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

    const [next, snapshot] = takeSnapshot(session, { ...prepared, capturedAt: new Date().toISOString() })
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
// alarm's, or the sidebar's once it sees a bridge listening.
async function flush(): Promise<null> {
  if (flushing) return null
  flushing = true
  try {
    for (const session of Object.values(await getSessions())) {
      if (!session.pending) continue
      try {
        // the marks, drawn on the screenshots as the overlay draws them, with their #id
        const images = new Map<string, { clean: string; annotated: string }>()
        for (const snapshot of session.snapshots) {
          const clean = await getImage(session.id, snapshot.id)
          if (clean) images.set(snapshot.id, { clean, annotated: await composite(clean, snapshot.annotations, snapshot.viewport) })
        }
        const accepted = await postRound(buildRound(session, images))
        await update(session.tabId, (s) => [s && roundSent(s, accepted.directory, new Date().toISOString()), null])
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

function openSidebar(windowId: number) {
  const firefox = (browser as unknown as { sidebarAction?: { open(): Promise<void> } }).sidebarAction
  if (firefox) void firefox.open()
  else void browser.sidePanel?.open({ windowId })
}
