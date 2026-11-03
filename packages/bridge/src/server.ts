import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'

import {
  ENDPOINTS,
  FeedbackRound,
  HEADERS,
  type Key,
  MAX_ROUND_BYTES,
  type Reply,
  type RoundAccepted,
  type Status,
  isExtensionOrigin,
  mac,
  randomNonce,
  safeEqual,
  sha256,
} from '@redline/shared'

import { type WrittenRound, writeRound } from './writer.ts'

export interface WaitOptions {
  // the first of them that is free (0: any)
  ports: number[]
  // where the rounds go: <root>/<channel>/NNN
  root: string
  // the project the round is for, shown in the sidebar
  project: string
  // the agent session's channel (src/channels.ts)
  channel: string
  // the user's token (src/home.ts), as a key: every request proves it knows it, and so does this
  key: Key
  // the preview's URL: the extension starts by itself on a tab of its app
  url?: string
  // the agent, as the sidebar names it
  agent?: string
  // the agent changed the page: the browser reloads the channel's tabs
  reload?: boolean
  // the agent's reply to the last round, shown in the sidebar
  reply?: Reply
  signal?: AbortSignal
  onListening?: (port: number) => void
}

export interface ReceivedRound {
  round: FeedbackRound
  written: WrittenRound
}

// The hosts a request may name: the loopback's. A page of another site that resolves its name to
// the loopback (DNS rebinding) sends its own; the port is any, for a forwarded one (ssh -L).
const HOSTNAMES = new Set(['127.0.0.1', 'localhost'])

// Listens on the loopback until the extension posts one round, writes it, and stops.
export function waitForRound(options: WaitOptions): Promise<ReceivedRound> {
  return new Promise((resolve, reject) => {
    let received = false
    let extension: string | undefined
    const startedAt = new Date().toISOString()
    // this run's: a round signed for another run, replayed, is refused
    const nonce = randomNonce()

    const server = createServer((req, res) => {
      handle(req, res).catch((error: unknown) => {
        if (!res.headersSent) send(res, 500, { error: String(error) })
      })
    })

    async function handle(req: IncomingMessage, res: ServerResponse) {
      if (!HOSTNAMES.has(hostname(req.headers.host))) return send(res, 403, { error: 'unexpected host' })
      // a web page's request carries its origin; the extension's has its own, or none
      const origin = req.headers.origin
      if (origin !== undefined && !isExtensionOrigin(origin)) return send(res, 403, { error: 'not an extension origin' })
      const port = (server.address() as { port: number }).port
      const auth = header(req, HEADERS.auth)

      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === ENDPOINTS.status && req.method === 'GET') {
        // who does not know the token learns only that a redline listens
        const challenge = header(req, HEADERS.nonce)
        if (!challenge || !auth || !safeEqual(auth, await mac(options.key, 'status', port, challenge)))
          return send(res, 401, { app: 'redline', error: 'not paired' })
        const hello = header(req, HEADERS.extension)
        if (hello && isExtensionOrigin(hello.replace(/\/$/, ''))) extension = hello
        const status: Status = {
          app: 'redline',
          channel: options.channel,
          ...(options.agent && { agent: options.agent }),
          ...(options.reload && { reload: true }),
          project: options.project,
          pid: process.pid,
          startedAt,
          nonce,
          url: options.url,
          extension,
          reply: options.reply,
        }
        const body = JSON.stringify(status)
        return send(res, 200, body, { [HEADERS.proof]: await mac(options.key, 'bridge', port, challenge, body) })
      }
      if (url.pathname !== ENDPOINTS.rounds) return send(res, 404, { error: 'not found' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
      if (!auth) return send(res, 401, { error: 'not paired' })
      if (received) return send(res, 409, { error: 'this bridge already received its round' })
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'expected application/json' })

      const body = await readBody(req)
      if (body === undefined) return send(res, 413, { error: 'round too large: send fewer screenshots in it' })
      if (!safeEqual(auth, await mac(options.key, 'round', port, nonce, await sha256(new Uint8Array(body))))) return send(res, 401, { error: 'not paired' })
      let json: unknown
      try {
        json = JSON.parse(body.toString('utf8'))
      } catch {
        return send(res, 400, { error: 'invalid JSON' })
      }
      const parsed = FeedbackRound.safeParse(json)
      if (!parsed.success) return send(res, 400, { error: 'invalid round', issues: parsed.error.issues })
      if (received) return send(res, 409, { error: 'this bridge already received its round' })
      received = true

      let written: WrittenRound
      try {
        written = await writeRound(options.root, options.channel, parsed.data, options.project)
      } catch (error) {
        // the round stays in the browser; this wait ends, with the reason
        send(res, 500, { error: `the round could not be written: ${String(error)}` }, {}, () => {
          server.close()
          reject(error)
        })
        return
      }
      const accepted: RoundAccepted = { directory: written.directory }
      send(res, 200, accepted, {}, () => {
        server.close()
        resolve({ round: parsed.data, written })
      })
    }

    // the next port while one is in use: another `redline wait`, of another agent session
    let next = 0
    const listen = () => server.listen(options.ports[next], '127.0.0.1')
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && ++next < options.ports.length) return listen()
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`port${options.ports.length > 1 ? 's' : ''} ${options.ports.join(', ')} in use: other \`redline wait\`s are running`)
          : error
      )
    })
    server.on('listening', () => options.onListening?.((server.address() as { port: number }).port))
    options.signal?.addEventListener('abort', () => {
      server.close()
      reject(options.signal?.reason)
    })
    listen()
  })
}

function hostname(host: string | undefined): string {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return ''
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return typeof value === 'string' ? value : undefined
}

// The body, or undefined if larger than a round may be: read to its end all the same, so that the
// extension gets the 413 rather than a broken connection, which it would take for no bridge.
function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_ROUND_BYTES) chunks.push(chunk)
      else chunks.length = 0
    })
    req.on('end', () => resolve(size > MAX_ROUND_BYTES ? undefined : Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}, done?: () => void) {
  res.writeHead(status, { 'content-type': 'application/json', connection: 'close', ...headers })
  res.end(typeof body === 'string' ? body : JSON.stringify(body), done)
}
