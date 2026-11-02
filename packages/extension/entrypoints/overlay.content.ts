import { type ContentRequest, send } from '@/src/messages.ts'
import { type Overlay, mountOverlay } from '@/src/overlay/overlay.ts'
import { getSession, watchSession } from '@/src/state/store.ts'

// Injected by the background (registration: runtime) when a session starts on the tab, and again
// after each load of the page. It shows the session's drafts while the session is active.

declare global {
  interface Window {
    __redline?: true
  }
}

export default defineContentScript({
  registration: 'runtime',
  async main() {
    // once per page, however many times the background injects it
    if (window.__redline) return
    window.__redline = true

    const tabId = await send({ type: 'whoami' })
    let overlay: Overlay | undefined

    function show(session: Awaited<ReturnType<typeof getSession>>) {
      if (session?.active) {
        if (overlay) overlay.render(session)
        else overlay = mountOverlay(document, session)
      } else {
        overlay?.destroy()
        overlay = undefined
      }
    }

    browser.runtime.onMessage.addListener((request: ContentRequest) => overlay?.handle(request))
    watchSession(() => tabId, show)
    if (tabId !== undefined) show(await getSession(tabId))
  },
})
