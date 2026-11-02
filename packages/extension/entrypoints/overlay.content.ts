import { type ContentRequest, send } from '@/src/messages.ts'
import { type Overlay, mountOverlay, viewportOf } from '@/src/overlay/overlay.ts'
import type { Session } from '@/src/state/session.ts'
import { getSession, watchSession } from '@/src/state/store.ts'

// Injected by the background (registration: runtime) when a session starts on the tab, and again
// after each load of the page. It shows the session while the session is active.

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

    let overlay: Overlay | undefined

    // at once: the first screenshot of a session is asked for as soon as the script is there,
    // before the overlay shows
    browser.runtime.onMessage.addListener((request: ContentRequest) => {
      if (overlay) return overlay.handle(request)
      if (request.type === 'capture/prepare') return Promise.resolve(viewportOf(window))
      if (request.type === 'capture/restore' || request.type === 'ping') return Promise.resolve(null)
      return undefined
    })

    function show(session: Session | undefined) {
      if (session?.active) {
        if (overlay) overlay.render(session)
        else overlay = mountOverlay(document, session)
      } else {
        overlay?.destroy()
        overlay = undefined
      }
    }

    const tabId = await send({ type: 'whoami' })
    watchSession(() => tabId, show)
    show(await getSession(tabId))
  },
})
