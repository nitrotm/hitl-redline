import { useEffect, useState } from 'preact/hooks'

import { type Bridge, bridgeForSession, candidates, isUnder } from '@redline/shared'

import { findBridges, heldChannels } from '@/src/bridge-client.ts'
import { send } from '@/src/messages.ts'
import { getImage } from '@/src/state/images.ts'
import { type Session, needsReload } from '@/src/state/session.ts'
import { getSession, watchSession } from '@/src/state/store.ts'

export interface ActiveTab {
  id: number
  title: string
  url: string
}

// The tab the sidebar is for: the active one of its window, as it changes; or, opened in a tab of
// its own (for the end-to-end tests and debugging), the one it names: sidepanel.html?tab=ID, or
// ?url=PREVIEW for the first tab there.
const params = new URLSearchParams(location.search)
const pinnedId = Number(params.get('tab')) || undefined
const pinnedUrl = params.get('url') ?? undefined

async function pinnedTab() {
  if (pinnedId !== undefined) return browser.tabs.get(pinnedId).catch(() => undefined)
  // the tab of that very page, or else the first one under it
  const tabs = await browser.tabs.query({})
  return tabs.find((t) => t.url === pinnedUrl) ?? tabs.find((t) => t.url && isUnder(t.url, pinnedUrl!))
}

export function useActiveTab(): ActiveTab | undefined {
  const [tab, setTab] = useState<ActiveTab>()
  useEffect(() => {
    let windowId: number | undefined
    const refresh = async () => {
      const [active] =
        pinnedId !== undefined || pinnedUrl !== undefined
          ? [await pinnedTab()]
          : await browser.tabs.query({ active: true, ...(windowId === undefined ? { currentWindow: true } : { windowId }) })
      windowId = active?.windowId
      setTab(active?.id === undefined ? undefined : { id: active.id, title: active.title ?? '', url: active.url ?? '' })
    }
    const onUpdated = (_: number, change: { title?: string; url?: string; status?: string }) => {
      if (change.title || change.url || change.status) void refresh()
    }
    void refresh()
    browser.tabs.onActivated.addListener(refresh)
    browser.tabs.onUpdated.addListener(onUpdated)
    return () => {
      browser.tabs.onActivated.removeListener(refresh)
      browser.tabs.onUpdated.removeListener(onUpdated)
    }
  }, [])
  return tab
}

export function useSession(tabId: number | undefined): Session | undefined {
  const [session, setSession] = useState<Session>()
  useEffect(() => {
    setSession(undefined)
    if (tabId === undefined) return
    void getSession(tabId).then(setSession)
    return watchSession(() => tabId, setSession)
  }, [tabId])
  return session
}

const POLL_MS = 2000

export interface Listening {
  // the bridge of the tab's session: its channel's, or the likeliest for an unbound one
  bridge?: Bridge
  // those of the page's app, to bind the tab to another
  candidates: Bridge[]
  // every bridge of the user's, whatever page it is for
  all: Bridge[]
  // a redline listens that does not know the token: the extension is not paired, or another user's
  unpaired: boolean
  paired: boolean
}

const NOTHING: Listening = { candidates: [], all: [], unpaired: false, paired: true }

// The `redline wait`s, asked every two seconds; when the session's listens, a submitted round goes
// at once.
export function useListening(tab: ActiveTab | undefined, session: Session | undefined): Listening {
  const [listening, setListening] = useState<Listening>(NOTHING)
  const pending = Boolean(session?.pending)
  useEffect(() => {
    let stopped = false
    const poll = async () => {
      const found = await findBridges()
      const unbound = !session || session.lastSent?.status === 'done'
      const bridge = bridgeForSession(found.bridges, tab?.url, unbound ? undefined : session.channel, await heldChannels(tab?.id))
      if (stopped) return
      setListening({ bridge, candidates: candidates(found.bridges, tab?.url), all: found.bridges, unpaired: found.unpaired.length > 0, paired: found.paired })
      // a round to send, or a page its agent changed, to reload
      const reload = bridge && session && session.channel === bridge.status.channel && needsReload(session, bridge.status.nonce, bridge.status.reload)
      if (bridge && (pending || reload)) await send({ type: 'outbox/flush' }).catch(() => undefined)
    }
    void poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [tab?.id, tab?.url, session?.channel, session?.lastSent?.status, session?.reloadedFor, pending])
  return listening
}

// the screenshot of a snapshot, as a data URL
export function useImage(sessionId: string, snapshotId: string): string | undefined {
  const [image, setImage] = useState<string>()
  useEffect(() => {
    void getImage(sessionId, snapshotId).then(setImage)
  }, [sessionId, snapshotId])
  return image
}
