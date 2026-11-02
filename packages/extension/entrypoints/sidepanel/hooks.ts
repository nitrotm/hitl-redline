import { useEffect, useState } from 'preact/hooks'

import { type Status, isUnder } from '@redline/shared'

import { bridgeStatus } from '@/src/bridge-client.ts'
import { send } from '@/src/messages.ts'
import { getImage } from '@/src/state/images.ts'
import type { Session } from '@/src/state/session.ts'
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

// Whether `redline wait` listens, asked every two seconds; when it does, a submitted round goes at once.
export function useBridge(pending: boolean): Status | undefined {
  const [status, setStatus] = useState<Status>()
  useEffect(() => {
    let stopped = false
    const poll = async () => {
      const next = await bridgeStatus()
      if (stopped) return
      setStatus(next)
      if (next && pending) await send({ type: 'outbox/flush' }).catch(() => undefined)
    }
    void poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [pending])
  return status
}

// the screenshot of a snapshot, as a data URL
export function useImage(sessionId: string, snapshotId: string): string | undefined {
  const [image, setImage] = useState<string>()
  useEffect(() => {
    void getImage(sessionId, snapshotId).then(setImage)
  }, [sessionId, snapshotId])
  return image
}
