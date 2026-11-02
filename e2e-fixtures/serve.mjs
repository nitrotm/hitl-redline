// Serves e2e-fixtures/ on http://127.0.0.1:PORT (default 47391), for the end-to-end tests and a try by hand.
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = import.meta.dirname
const port = Number(process.argv[2] ?? 47391)
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' }

createServer(async (req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'test-page.html'
  try {
    const body = await readFile(join(root, path))
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`))
