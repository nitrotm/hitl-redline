import { z } from 'zod'

// How the extension talks to `redline wait`: HTTP on the loopback, one round per run.

export const DEFAULT_PORT = 47390
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
})
export type Status = z.infer<typeof Status>

export const RoundAccepted = z.object({
  directory: z.string(),
})
export type RoundAccepted = z.infer<typeof RoundAccepted>

export function bridgeUrl(port: number, endpoint: keyof typeof ENDPOINTS): string {
  return `http://127.0.0.1:${port}${ENDPOINTS[endpoint]}`
}

// The origins of extension pages. A web page's request carries its own origin, which it cannot
// change, so a page the browser shows cannot post a round.
export function isExtensionOrigin(origin: string): boolean {
  return /^(moz-extension|chrome-extension):\/\/[0-9a-z-]+$/.test(origin)
}
