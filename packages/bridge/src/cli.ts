#!/usr/bin/env node
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { DEFAULT_PORT, PORT_ENV, Status, bridgeUrl } from '@redline/shared'

import { waitForRound } from './server.ts'

const USAGE = `usage: redline <command> [options]

commands:
  wait            wait for one round of feedback from the extension, write it to
                  <dir>/rounds/NNN/ and print the path of its feedback.md
  status          tell whether a \`redline wait\` is listening
  extension-path  print the directory of the Firefox extension, for install_extension

options:
  --port N        the bridge's port (default: $${PORT_ENV} or ${DEFAULT_PORT})
  --dir PATH      wait: where the rounds go (default: ./.redline)
  --timeout S     wait: give up after S seconds, with exit code 2 (default: never)
  --url URL       wait: the preview, where Redline starts by itself once the page loads
`

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      dir: { type: 'string' },
      timeout: { type: 'string' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const [command] = positionals
  if (values.help || command === undefined) {
    process.stdout.write(USAGE)
    return command === undefined && !values.help ? 1 : 0
  }
  const port = Number(values.port ?? process.env[PORT_ENV] ?? DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid port: ${values.port}`)

  switch (command) {
    case 'wait':
      return wait(port, resolve(values.dir ?? '.redline'), values.url, values.timeout === undefined ? undefined : Number(values.timeout))
    case 'status':
      return status(port)
    case 'extension-path': {
      const path = process.env.REDLINE_EXTENSION
      if (!path) throw new Error('REDLINE_EXTENSION is not set: run the redline of the flake, or build the extension (yarn build)')
      process.stdout.write(`${path}\n`)
      return 0
    }
    default:
      process.stderr.write(`redline: unknown command: ${command}\n\n${USAGE}`)
      return 1
  }
}

async function wait(port: number, root: string, url: string | undefined, timeout: number | undefined): Promise<number> {
  const signal = timeout === undefined ? undefined : AbortSignal.timeout(timeout * 1000)
  try {
    const { round, written } = await waitForRound({
      port,
      root,
      project: process.cwd(),
      url,
      signal,
      onListening: (port) => process.stdout.write(`redline: waiting for feedback on http://127.0.0.1:${port} (project ${process.cwd()})\n`),
    })
    const snapshots = round.snapshots.length
    process.stdout.write(
      `redline: round ${round.round} of session ${round.sessionId}: ${round.status}, ` +
        `${snapshots} snapshot${snapshots === 1 ? '' : 's'}, ${written.annotations} annotation${written.annotations === 1 ? '' : 's'}\n` +
        `${written.feedback}\n`
    )
    return 0
  } catch (error) {
    if (signal?.aborted) {
      process.stdout.write(`redline: no feedback after ${timeout} seconds\n`)
      return 2
    }
    throw error
  }
}

async function status(port: number): Promise<number> {
  try {
    const response = await fetch(bridgeUrl(port, 'status'))
    const status = Status.parse(await response.json())
    process.stdout.write(`redline: listening on port ${port}, for ${status.project} (pid ${status.pid})\n`)
    if (status.url) process.stdout.write(`preview: ${status.url}\n`)
    // the extension that last asked: its sidebar, to open in a tab of its own
    if (status.extension) process.stdout.write(`sidebar: ${new URL('sidepanel.html', status.extension).href}\n`)
    return 0
  } catch {
    process.stdout.write(`redline: nothing listening on port ${port}\n`)
    return 1
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`redline: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
)
