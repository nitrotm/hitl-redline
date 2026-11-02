#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { PORTS, PORT_ENV, Reply, Status, bridgeUrl } from '@redline/shared'

import { waitForRound } from './server.ts'

const USAGE = `usage: redline <command> [options]

commands:
  wait            wait for one round of feedback from the extension, write it to
                  <dir>/rounds/NNN/ and print the path of its feedback.md
  status          tell whether a \`redline wait\` is listening
  extension-path  print the directory of the Firefox extension, for install_extension

options:
  --port N        the bridge's port (default: ${PORT_ENV}, or the first free one of
                  ${PORTS[0]}-${PORTS.at(-1)}, so that several projects wait at once)
  --dir PATH      wait: where the rounds go (default: ./.redline)
  --timeout S     wait: give up after S seconds, with exit code 2 (default: never)
  --url URL       wait: the preview, where Redline starts by itself once the page loads
  --reply FILE    wait: Claude's reply to the last round, as JSON, shown in the sidebar:
                  { "sessionId", "round", "summary"?, "marks"?: [{ "id", "text" }],
                    "questions"?: [{ "id": "Q1", "text", "mark"? }] }
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
      reply: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const [command] = positionals
  if (values.help || command === undefined) {
    process.stdout.write(USAGE)
    return command === undefined && !values.help ? 1 : 0
  }
  // a port given, or the first free one of the range
  const given = values.port ?? process.env[PORT_ENV]
  const ports = given === undefined ? PORTS : [Number(given)]
  if (ports.some((p) => !Number.isInteger(p) || p < 0 || p > 65535)) throw new Error(`invalid port: ${given}`)

  switch (command) {
    case 'wait':
      return wait(
        ports,
        resolve(values.dir ?? '.redline'),
        values.url,
        values.reply === undefined ? undefined : await readReply(values.reply),
        values.timeout === undefined ? undefined : Number(values.timeout)
      )
    case 'status':
      return status(ports)
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

async function readReply(file: string): Promise<Reply> {
  const parsed = Reply.safeParse(JSON.parse(await readFile(file, 'utf8')))
  if (!parsed.success) throw new Error(`${file} is not a reply: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return parsed.data
}

async function wait(ports: number[], root: string, url: string | undefined, reply: Reply | undefined, timeout: number | undefined): Promise<number> {
  const signal = timeout === undefined ? undefined : AbortSignal.timeout(timeout * 1000)
  try {
    const { round, written } = await waitForRound({
      ports,
      root,
      project: process.cwd(),
      url,
      reply,
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

// every `redline wait` listening, of whichever project
async function status(ports: number[]): Promise<number> {
  const found = await Promise.all(
    ports.map(async (port) => {
      try {
        const response = await fetch(bridgeUrl(port, 'status'), { signal: AbortSignal.timeout(1500) })
        return { port, status: Status.parse(await response.json()) }
      } catch {
        return undefined
      }
    })
  )
  const listening = found.filter((b) => b !== undefined)
  if (!listening.length) {
    process.stdout.write(`redline: nothing listening on port${ports.length > 1 ? `s ${ports[0]}-${ports.at(-1)}` : ` ${ports[0]}`}\n`)
    return 1
  }
  for (const { port, status } of listening) {
    process.stdout.write(`redline: listening on port ${port}, for ${status.project} (pid ${status.pid})\n`)
    if (status.url) process.stdout.write(`  preview: ${status.url}\n`)
    // the extension that last asked: its sidebar, to open in a tab of its own
    if (status.extension) process.stdout.write(`  sidebar: ${new URL('sidepanel.html', status.extension).href}\n`)
  }
  return 0
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`redline: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
)
