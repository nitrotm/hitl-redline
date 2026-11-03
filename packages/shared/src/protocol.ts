import { z } from 'zod'

import { Reply } from './schema.ts'

// How the extension talks to `redline wait`: HTTP on the loopback, one round per run. Each run
// takes the first free port of PORTS, so that several agent sessions wait at once; the extension
// asks them all, and sends a tab's round to the channel the tab is bound to (bridgeForSession).
// Any coding agent drives it the same way (docs/agents.md).
//
// The loopback is every local user's and every local process's: both sides prove they know the
// user's token (`redline token`, a file only the user reads) with an HMAC of each message, bound
// to the bridge's port, and the token itself never goes over the wire.

export const PORTS = Array.from({ length: 10 }, (_, i) => 47390 + i)
export const PORT_ENV = 'REDLINE_PORT'

export const ENDPOINTS = {
  // GET: is a bridge listening, for which channel and project
  status: '/status',
  // POST: a FeedbackRound, as JSON
  rounds: '/rounds',
} as const

// the largest round the bridge reads: two PNGs per snapshot, base64
export const MAX_ROUND_BYTES = 64 * 1024 * 1024

export const HEADERS = {
  // sent by the extension with its status requests: its base URL (moz-extension://<uuid>/)
  extension: 'x-redline-extension',
  // the extension's random challenge, with each status request
  nonce: 'x-redline-nonce',
  // the extension's MAC of a request: mac('status', port, nonce) or mac('round', port, status.nonce, sha256(body))
  auth: 'x-redline-auth',
  // the bridge's MAC of its status: mac('bridge', port, nonce, body)
  proof: 'x-redline-proof',
} as const

// the native messaging host that hands the token to the extension (`redline install`)
export const NATIVE_HOST = 'redline_bridge'
export const FIREFOX_EXTENSION_ID = 'redline@tmsrv.org'
// fixed by the key in the Chrome build's manifest (packages/extension/wxt.config.ts)
export const CHROME_EXTENSION_ID = 'kngalkfifnhfhghgmflbinkmjnbjejom'

// The origins of extension pages. A web page's request carries its own origin, which it cannot
// change, so a page the browser shows cannot post a round.
export function isExtensionOrigin(origin: string): boolean {
  return /^(moz-extension|chrome-extension):\/\/[0-9a-z-]+$/.test(origin)
}

const httpUrl = z.string().refine((url) => /^https?:\/\//.test(url) && URL.canParse(url), 'an http(s) URL')

export const Status = z.object({
  app: z.literal('redline'),
  // the agent session's channel, adjective-pet: the tabs bound to it send their rounds to it alone
  channel: z.string().regex(/^[a-z]+-[a-z]+$/),
  // the coding agent that waits (`redline wait --agent`: Claude, Codex, pi…), as the sidebar names it
  agent: z.string().min(1).max(40).optional(),
  // the agent changed the page: the tabs bound to the channel reload once for this run (`--reload`)
  reload: z.boolean().optional(),
  // the directory of the project that waits: the round lands in its .redline/
  project: z.string(),
  pid: z.number().int(),
  startedAt: z.iso.datetime(),
  // this run's random value, which the MAC of a round binds: a round for an earlier run is refused
  nonce: z.string().min(16),
  // the preview the agent opened (`redline wait --url`): Redline starts by itself on a tab of its app
  url: httpUrl.optional(),
  // the base URL of the extension that last asked (HEADERS.extension), for `redline status`
  extension: z
    .string()
    .refine((url) => isExtensionOrigin(url.replace(/\/$/, '')), 'an extension base URL')
    .optional(),
  // the agent's reply to the last round (`redline wait --reply`), for the sidebar
  reply: Reply.optional(),
})
export type Status = z.infer<typeof Status>

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

export function isSameOrigin(url: string, preview: string): boolean {
  try {
    return new URL(url).origin === new URL(preview).origin
  } catch {
    return false
  }
}

export const RoundAccepted = z.object({
  directory: z.string(),
})
export type RoundAccepted = z.infer<typeof RoundAccepted>

// a bridge that answered, on its port, and proved it knows the token
export interface Bridge {
  port: number
  status: Status
}

// The bridges a tab's page may go to, the likeliest first: those of its app (the origin of their
// --url), the one whose preview the page is under the deepest first; else those waiting for any
// page (no --url). The newest first among equals.
export function candidates(bridges: Bridge[], tabUrl: string | undefined): Bridge[] {
  const newest = (a: Bridge, b: Bridge) => b.status.startedAt.localeCompare(a.status.startedAt)
  if (!tabUrl) return []
  const depth = (b: Bridge) => (isUnder(tabUrl, b.status.url!) ? new URL(b.status.url!).pathname.replace(/[^/]*$/, '').length : 0)
  const forApp = bridges.filter((b) => b.status.url && isSameOrigin(tabUrl, b.status.url))
  if (forApp.length) return forApp.sort((a, b) => depth(b) - depth(a) || newest(a, b))
  return bridges.filter((b) => !b.status.url).sort(newest)
}

// The bridge for a tab's session. A tab bound to a channel goes to it alone: none while it does not
// listen (its agent is at work), never another agent's. An unbound one takes the likeliest of its
// candidates whose channel no other tab holds, else the likeliest.
export function bridgeForSession(bridges: Bridge[], tabUrl: string | undefined, channel: string | undefined, held: Set<string>): Bridge | undefined {
  if (channel) return bridges.find((b) => b.status.channel === channel)
  const found = candidates(bridges, tabUrl)
  return found.find((b) => !held.has(b.status.channel)) ?? found[0]
}

export function bridgeUrl(port: number, endpoint: keyof typeof ENDPOINTS): string {
  return `http://127.0.0.1:${port}${ENDPOINTS[endpoint]}`
}

// the token as a key for the MACs; the type of node and of the browser alike
export type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>

// The MACs: HMAC-SHA256 with the token, of the parts joined by newlines, in hex. WebCrypto, in
// node as in the extension.
export function importToken(token: string): Promise<Key> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(token.trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

export async function mac(key: Key, ...parts: (string | number)[]): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(parts.join('\n'))))
}

export async function sha256(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data))
}

// in a time that does not tell where they differ
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function randomNonce(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)).buffer)
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

// What a port answers: a bridge that proved the token, one that did not (another user's, or a
// token that changed), or nothing that speaks redline.
export type Asked = { kind: 'bridge'; bridge: Bridge } | { kind: 'unpaired'; port: number } | undefined

// Asks a port's status, signed, and checks the bridge's proof before reading what it says.
export async function askBridge(port: number, key: Key | undefined, extension?: string): Promise<Asked> {
  try {
    const nonce = randomNonce()
    const headers: Record<string, string> = { [HEADERS.nonce]: nonce, ...(extension && { [HEADERS.extension]: extension }) }
    if (key) headers[HEADERS.auth] = await mac(key, 'status', port, nonce)
    const response = await fetch(bridgeUrl(port, 'status'), { headers, signal: AbortSignal.timeout(1500) })
    const body = await response.text()
    const app = (JSON.parse(body) as { app?: unknown }).app
    if (app !== 'redline') return undefined
    const proof = response.headers.get(HEADERS.proof)
    if (!key || !response.ok || !proof || !safeEqual(proof, await mac(key, 'bridge', port, nonce, body))) return { kind: 'unpaired', port }
    const status = Status.safeParse(JSON.parse(body))
    return status.success ? { kind: 'bridge', bridge: { port, status: status.data } } : { kind: 'unpaired', port }
  } catch {
    return undefined
  }
}

// every port of PORTS (or those given)
export async function askBridges(key: Key | undefined, extension?: string, ports: number[] = PORTS): Promise<{ bridges: Bridge[]; unpaired: number[] }> {
  const asked = await Promise.all(ports.map((port) => askBridge(port, key, extension)))
  return {
    bridges: asked.flatMap((a) => (a?.kind === 'bridge' ? [a.bridge] : [])),
    unpaired: asked.flatMap((a) => (a?.kind === 'unpaired' ? [a.port] : [])),
  }
}

// The round's body, as sent, and the MAC that goes with it to the bridge that proved itself.
export async function roundAuth(key: Key, bridge: Bridge, body: string): Promise<string> {
  return mac(key, 'round', bridge.port, bridge.status.nonce, await sha256(body))
}
