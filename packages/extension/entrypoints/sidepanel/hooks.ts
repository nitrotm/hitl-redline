import { bridgeStatus } from '@/src/bridge-client.ts'
import { send } from '@/src/messages.ts'
import { type SnapshotImages, getImages } from '@/src/state/images.ts'
import type { Session } from '@/src/state/session.ts'
import { getSession, watchSession } from '@/src/state/store.ts'
import { useEffect, useState } from 'preact/hooks'

import type { Status } from '@redline/shared'

export interface ActiveTab {
  id: number
  title: string
  url: string
}

// The tab the sidebar is for: the active one of its window, as it changes; or, opened in a tab of
// its own (sidepanel.html?tab=ID, for the end-to-end tests and debugging), the one it names.
const pinned = Number(new URLSearchParams(location.search).get('tab')) || undefined

export function useActiveTab(): ActiveTab | undefined {
  const [tab, setTab] = useState<ActiveTab>()
  useEffect(() => {
    let windowId: number | undefined
    const refresh = async () => {
      const [active] =
        pinned !== undefined
          ? [await browser.tabs.get(pinned).catch(() => undefined)]
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

export function useImages(sessionId: string, snapshotId: string): SnapshotImages | undefined {
  const [images, setImages] = useState<SnapshotImages>()
  useEffect(() => {
    void getImages(sessionId, snapshotId).then(setImages)
  }, [sessionId, snapshotId])
  return images
}
