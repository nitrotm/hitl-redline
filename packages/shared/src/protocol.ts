import { z } from 'zod'

import { Reply } from './schema.ts'

// How the extension talks to `redline wait`: HTTP on the loopback, one round per run. Each run
// takes the first free port of PORTS, so that the loops of several projects run at once; the
// extension asks them all, and sends a tab's round to the one of its preview (pickBridge).

export const PORTS = Array.from({ length: 10 }, (_, i) => 47390 + i)
export const PORT_ENV = 'REDLINE_PORT'

export const ENDPOINTS = {
  // GET: is a bridge listening, and for which project
  status: '/status',
  // POST: a FeedbackRound, as JSON
  rounds: '/rounds',
} as const

// the largest round the bridge reads: two PNGs per snapshot, base64
export const MAX_ROUND_BYTES = 64 * 1024 * 1024

export const Status = z.object({
  app: z.literal('redline'),
  // the directory of the project that waits: the round lands in its .redline/
  project: z.string(),
  pid: z.number().int(),
  // the preview Claude opened (`redline wait --url`): Redline starts by itself on a tab there
  url: z.string().optional(),
  // the base URL of the extension that last asked (EXTENSION_HEADER), for `redline status`
  extension: z.string().optional(),
  // Claude's reply to the last round (`redline wait --reply`), for the sidebar
  reply: Reply.optional(),
})
export type Status = z.infer<typeof Status>

// sent by the extension with its status requests: its base URL (moz-extension://<uuid>/)
export const EXTENSION_HEADER = 'x-redline-extension'

// whether a tab's URL is the preview's, or under it
export function isUnder(url: string, preview: string): boolean {
  try {
    const a = new URL(url)
    const b = new URL(preview)
    return a.origin === b.origin && a.pathname.startsWith(b.pathname.replace(/[^/]*$/, ''))
  } catch {
    return false
  }
}

export const RoundAccepted = z.object({
  directory: z.string(),
})
export type RoundAccepted = z.infer<typeof RoundAccepted>

// a bridge that answered, on its port
export interface Bridge {
  port: number
  status: Status
}

// The bridge for a tab: one whose preview the tab shows (`redline wait --url`), the one that
// replies to the tab's session first; or else one waiting for any page (no --url).
export function pickBridge(bridges: Bridge[], tabUrl: string | undefined, sessionId?: string): Bridge | undefined {
  const forPage = bridges.filter((b) => b.status.url && tabUrl && isUnder(tabUrl, b.status.url))
  const candidates = forPage.length ? forPage : bridges.filter((b) => !b.status.url)
  return candidates.find((b) => sessionId && b.status.reply?.sessionId === sessionId) ?? candidates[0]
}

export function bridgeUrl(port: number, endpoint: keyof typeof ENDPOINTS): string {
  return `http://127.0.0.1:${port}${ENDPOINTS[endpoint]}`
}

// The origins of extension pages. A web page's request carries its own origin, which it cannot
// change, so a page the browser shows cannot post a round.
export function isExtensionOrigin(origin: string): boolean {
  return /^(moz-extension|chrome-extension):\/\/[0-9a-z-]+$/.test(origin)
}
