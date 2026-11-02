import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'

import { ENDPOINTS, EXTENSION_HEADER, FeedbackRound, MAX_ROUND_BYTES, type RoundAccepted, type Status, isExtensionOrigin } from '@redline/shared'

import { type WrittenRound, writeRound } from './writer.ts'

export interface WaitOptions {
  port: number
  // where the rounds go: <root>/rounds/NNN
  root: string
  // the project the round is for, shown in the sidebar
  project: string
  // the preview's URL: the extension starts by itself on a tab there
  url?: string
  signal?: AbortSignal
  onListening?: (port: number) => void
}

export interface ReceivedRound {
  round: FeedbackRound
  written: WrittenRound
}

// Listens on the loopback until the extension posts one round, writes it, and stops.
export function waitForRound(options: WaitOptions): Promise<ReceivedRound> {
  return new Promise((resolve, reject) => {
    let received = false
    let extension: string | undefined

    const server = createServer((req, res) => {
      handle(req, res).catch((error: unknown) => {
        if (!res.headersSent) send(res, 500, { error: String(error) })
      })
    })

    async function handle(req: IncomingMessage, res: ServerResponse) {
      // a page of another site that resolves its name to the loopback (DNS rebinding) sends its own Host
      const port = (server.address() as { port: number }).port
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return send(res, 403, { error: 'unexpected host' })
      // a web page's request carries its origin; the extension's has its own, or none
      const origin = req.headers.origin
      if (origin !== undefined && !isExtensionOrigin(origin)) return send(res, 403, { error: 'not an extension origin' })

      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === ENDPOINTS.status && req.method === 'GET') {
        const hello = req.headers[EXTENSION_HEADER]
        if (typeof hello === 'string' && isExtensionOrigin(hello.replace(/\/$/, ''))) extension = hello
        const status: Status = { app: 'redline', project: options.project, pid: process.pid, url: options.url, extension }
        return send(res, 200, status)
      }
      if (url.pathname !== ENDPOINTS.rounds) return send(res, 404, { error: 'not found' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
      if (received) return send(res, 409, { error: 'this bridge already received its round' })
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'expected application/json' })

      const body = await readBody(req)
      if (body === undefined) return send(res, 413, { error: 'round too large' })
      let json: unknown
      try {
        json = JSON.parse(body)
      } catch {
        return send(res, 400, { error: 'invalid JSON' })
      }
      const parsed = FeedbackRound.safeParse(json)
      if (!parsed.success) return send(res, 400, { error: 'invalid round', issues: parsed.error.issues })
      if (received) return send(res, 409, { error: 'this bridge already received its round' })
      received = true

      const written = await writeRound(options.root, parsed.data, options.project)
      const accepted: RoundAccepted = { directory: written.directory }
      send(res, 200, accepted, () => {
        server.close()
        resolve({ round: parsed.data, written })
      })
    }

    server.on('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? new Error(`port ${options.port} is in use: is another \`redline wait\` running?`) : error)
    })
    options.signal?.addEventListener('abort', () => {
      server.close()
      reject(options.signal?.reason)
    })
    server.listen(options.port, '127.0.0.1', () => {
      options.onListening?.((server.address() as { port: number }).port)
    })
  })
}

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_ROUND_BYTES) {
        resolve(undefined)
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown, done?: () => void) {
  res.writeHead(status, { 'content-type': 'application/json', connection: 'close' })
  res.end(JSON.stringify(body), done)
}
