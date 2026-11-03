#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { type Key, PORTS, PORT_ENV, Reply, askBridge, askBridges, importToken } from '@redline/shared'

import { sessionKey } from './agent.ts'
import { type Channel, claimChannel, clearWait, isAlive, recordWait } from './channels.ts'
import { readOrCreateToken, tokenPath } from './home.ts'
import { install, runNativeHost } from './native.ts'
import { waitForRound } from './server.ts'

const USAGE = `usage: redline <command> [options]

commands:
  wait            wait for one round of feedback from the extension, write it to
                  <dir>/rounds/NNN/ and print the path of its feedback.md
  status          tell which \`redline wait\`s are listening, and for which channel
  open URL        open a page in the default browser, for an agent without a browser of its own
  reply-path      print where the reply to this session's rounds goes, which the next
                  wait shows in the sidebar
  install         pair the browsers with you: the token, and the native messaging host
                  that hands it to the extension (Firefox, Chrome, Chromium); run it once
                  --skills: also link the redline skill into ~/.agents/skills (Codex, pi)
                  --chrome-profile DIR: also the Chrome of that profile (the Chrome DevTools
                  MCP's, if not its default, which is found by itself)
  token           print your token, to paste in the sidebar where the native host cannot run
  extension-path [firefox|chrome]
                  print the directory of the extension, for a browser MCP's install_extension

Any coding agent drives these the same way: docs/agents.md.

options:
  --port N        the bridge's port (default: ${PORT_ENV}, or the first free one of
                  ${PORTS[0]}-${PORTS.at(-1)}, which the extension asks, so that several
                  agent sessions wait at once)
  --dir PATH      wait: where the rounds go (default: ./.redline)
  --timeout S     wait: give up after S seconds, with exit code 2 (default: never)
  --url URL       wait: the app's preview, where Redline starts by itself once a page of
                  it loads (its origin, and the deepest path first among several waits)
  --session KEY   wait, reply-path: what the channel is for, which keeps its name from wait
                  to wait (default: REDLINE_SESSION, or the agent's process found above
                  this one, or the project); a new wait of a channel stops its last one,
                  which exits with code 3
  --channel NAME  wait: the channel's name, adjective-pet (default: the one KEY has, or a
                  new one)
  --agent NAME    wait: the agent, as the sidebar names it: Claude, Codex, pi…
                  (default: REDLINE_AGENT, or "your agent")
  --reload        wait: the agent changed the page: the browser reloads the channel's tabs
                  (for an agent that cannot; a dev server that hot-reloads needs none)
  --reply FILE    wait: the agent's reply to the last round, as JSON, shown in the sidebar
                  (default: <dir>/replies/<channel>.json, if there):
                  { "sessionId", "round", "summary"?, "marks"?: [{ "id", "text" }],
                    "questions"?: [{ "id": "Q1", "text", "mark"? }] }

exit codes (wait): 0 a round, written; 1 an error; 2 the timeout; 3 replaced by a newer wait
of the channel; 130 interrupted
`

// a wait stopped by a newer one of its channel: nothing for the agent to do
const REPLACED = 3

async function main(argv: string[]): Promise<number> {
  // the browser starts the native host with arguments of its own: the manifest, the extension
  if (argv[0] === 'native-host') {
    await runNativeHost(process.stdin, process.stdout)
    return 0
  }
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      dir: { type: 'string' },
      timeout: { type: 'string' },
      url: { type: 'string' },
      session: { type: 'string' },
      channel: { type: 'string' },
      agent: { type: 'string' },
      reload: { type: 'boolean' },
      skills: { type: 'boolean' },
      'chrome-profile': { type: 'string', multiple: true },
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
  if (given !== undefined && ports[0] !== 0 && !PORTS.includes(ports[0]!))
    process.stderr.write(`redline: warning: the extension asks ports ${PORTS[0]}-${PORTS.at(-1)} only, not ${ports[0]}\n`)

  const root = resolve(values.dir ?? '.redline')
  switch (command) {
    case 'wait': {
      if (values.url !== undefined && !isPage(values.url)) throw new Error(`--url: not an http(s) URL: ${values.url}`)
      const agent = values.agent ?? process.env.REDLINE_AGENT
      if (agent !== undefined && !/^[\p{L}\p{N} ._-]{1,40}$/u.test(agent)) throw new Error(`--agent: a short name, as the sidebar shows it: ${agent}`)
      return wait({
        ports,
        root,
        url: values.url,
        session: values.session,
        channel: values.channel,
        agent,
        reload: values.reload ?? false,
        reply: values.reply === undefined ? undefined : await readReply(values.reply),
        timeout: values.timeout === undefined ? undefined : Number(values.timeout),
        portGiven: given !== undefined,
      })
    }
    case 'status':
      return status(ports)
    case 'open': {
      const url = positionals[1]
      if (url === undefined || !isPage(url)) throw new Error(`open: not an http(s) URL: ${url ?? '(none)'}`)
      await openInBrowser(url)
      process.stdout.write(`redline: opened ${url}\n`)
      return 0
    }
    case 'reply-path': {
      const project = process.cwd()
      const channel = await claimChannel({ session: values.session ?? (await sessionKey(project)), project, name: values.channel })
      process.stdout.write(`${replyPath(root, channel.name)}\n`)
      return 0
    }
    case 'install': {
      for (const line of await install(
        resolve(process.argv[1]!),
        (values['chrome-profile'] ?? []).map((dir) => resolve(dir))
      ))
        process.stdout.write(`redline: ${line}\n`)
      if (values.skills) process.stdout.write(`redline: ${await linkSkill()}\n`)
      process.stdout.write('redline: installed; reinstall the extension, or restart the browser, for it to find the host\n')
      return 0
    }
    case 'token':
      process.stdout.write(`${await readOrCreateToken()}\n`)
      return 0
    case 'extension-path': {
      const browser = positionals[1] ?? 'firefox'
      if (browser !== 'firefox' && browser !== 'chrome') throw new Error(`extension-path: firefox or chrome, not ${browser}`)
      const variable = browser === 'firefox' ? 'REDLINE_EXTENSION' : 'REDLINE_EXTENSION_CHROME'
      const path = process.env[variable] || builtExtension(browser)
      if (!path) throw new Error(`${variable} is not set: run the redline of the flake, or build the extension (yarn build)`)
      process.stdout.write(`${path}\n`)
      return 0
    }
    default:
      process.stderr.write(`redline: unknown command: ${command}\n\n${USAGE}`)
      return 1
  }
}

// the extension's build, next to these sources (src/ or dist/), in a checkout of the repository
function builtExtension(browser: 'firefox' | 'chrome'): string | undefined {
  const path = join(import.meta.dirname, '..', '..', 'extension', '.output', browser === 'firefox' ? 'firefox-mv2' : 'chrome-mv3')
  return existsSync(join(path, 'manifest.json')) ? path : undefined
}

function isPage(url: string): boolean {
  return /^https?:\/\//.test(url) && URL.canParse(url)
}

// The default browser, whichever it is: for an agent with no browser of its own, the user's, with
// the extension they installed. Detached: the browser outlives this command.
function openInBrowser(url: string): Promise<void> {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]]
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', (error) => reject(new Error(`cannot open the browser (${command}): ${error.message}`)))
    child.on('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

// where the agent writes its reply to the channel's rounds, which its next wait serves
function replyPath(root: string, channel: string): string {
  return join(root, 'replies', `${channel}.json`)
}

// The skill, for the agents that read ~/.agents/skills (Codex, pi): a link to this build's, so that
// it follows the updates. A directory of the user's own there is left be.
async function linkSkill(): Promise<string> {
  const skill = process.env.REDLINE_SKILL || join(import.meta.dirname, '..', '..', '..', 'claude', 'skills', 'redline')
  if (!existsSync(join(skill, 'SKILL.md'))) throw new Error(`no skill at ${skill}: set REDLINE_SKILL`)
  const link = join(homedir(), '.agents', 'skills', 'redline')
  const there = await lstat(link).catch(() => undefined)
  if (there && !there.isSymbolicLink()) throw new Error(`${link} is a directory of your own: remove it, or keep it`)
  if (there) await rm(link)
  await mkdir(dirname(link), { recursive: true })
  await symlink(skill, link, process.platform === 'win32' ? 'junction' : 'dir')
  return `skill: ${link} → ${skill}`
}

async function readReply(file: string): Promise<Reply> {
  const parsed = Reply.safeParse(JSON.parse(await readFile(file, 'utf8')))
  if (!parsed.success) throw new Error(`${file} is not a reply: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return parsed.data
}

interface Wait {
  ports: number[]
  root: string
  url?: string
  session?: string
  channel?: string
  agent?: string
  reload: boolean
  reply?: Reply
  timeout?: number
  portGiven: boolean
}

async function wait(options: Wait): Promise<number> {
  const project = process.cwd()
  const key = await importToken(await readOrCreateToken())
  let channel = await claimChannel({ session: options.session ?? (await sessionKey(project)), project, name: options.channel })
  await stopLastWait(channel, key)
  // the reply the agent wrote for its channel, unless it named one
  const reply = options.reply ?? (existsSync(replyPath(options.root, channel.name)) ? await readReply(replyPath(options.root, channel.name)) : undefined)
  // the channel's port, if free: the sidebar finds it where it was
  const ports = !options.portGiven && channel.port && PORTS.includes(channel.port) ? [channel.port, ...PORTS.filter((p) => p !== channel.port)] : options.ports

  const stop = new AbortController()
  const replaced = () => stop.abort(new Error('replaced'))
  const interrupted = () => stop.abort(new Error('interrupted'))
  process.once('SIGTERM', replaced)
  process.once('SIGINT', interrupted)
  const signal = options.timeout === undefined ? stop.signal : AbortSignal.any([stop.signal, AbortSignal.timeout(options.timeout * 1000)])
  try {
    const { round, written } = await waitForRound({
      ports,
      root: options.root,
      project,
      channel: channel.name,
      key,
      url: options.url,
      agent: options.agent,
      reload: options.reload,
      reply,
      signal,
      onListening: (port) => {
        void recordWait(channel, process.pid, port).then((c) => (channel = c))
        process.stdout.write(`redline: ${channel.name} waiting for feedback on http://127.0.0.1:${port} (project ${project})\n`)
        process.stdout.write(`redline: the reply to its rounds goes to ${replyPath(options.root, channel.name)}\n`)
      },
    })
    const snapshots = round.snapshots.length
    process.stdout.write(
      `redline: round ${round.round} of session ${round.sessionId}: ${round.status}, ` +
        `${snapshots} snapshot${snapshots === 1 ? '' : 's'}, ${written.annotations} annotation${written.annotations === 1 ? '' : 's'}\n` +
        `${written.feedback}\n`
    )
    return 0
  } catch (error) {
    if (stop.signal.aborted) {
      const replacedBy = (stop.signal.reason as Error).message === 'replaced'
      process.stdout.write(replacedBy ? `redline: ${channel.name}: replaced by a newer wait of the channel\n` : 'redline: interrupted\n')
      return replacedBy ? REPLACED : 130
    }
    if (signal.aborted) {
      process.stdout.write(`redline: no feedback after ${options.timeout} seconds\n`)
      return 2
    }
    throw error
  } finally {
    await clearWait(channel.name, process.pid).catch(() => undefined)
  }
}

// The channel's last wait, if it still listens: it is stopped, so that the extension finds this
// one alone for the channel. It is checked first to be what the registry says, a redline of that
// channel with that pid that knows the token, and not a process that took its pid since.
async function stopLastWait(channel: Channel, key: Key) {
  const { pid, port } = channel
  if (!pid || !port || pid === process.pid || !isAlive(pid)) return
  const asked = await askBridge(port, key)
  if (asked?.kind !== 'bridge' || asked.bridge.status.pid !== pid || asked.bridge.status.channel !== channel.name) return
  process.kill(pid, 'SIGTERM')
  for (let i = 0; i < 100 && isAlive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 50))
}

// every `redline wait` listening, of whichever project
async function status(ports: number[]): Promise<number> {
  const key = await importToken(await readOrCreateToken())
  const { bridges, unpaired } = await askBridges(key, undefined, ports)
  for (const port of unpaired)
    process.stdout.write(`redline: port ${port}: a redline that does not know your token (${tokenPath()}): another user's, or one older than the token\n`)
  if (!bridges.length) {
    process.stdout.write(`redline: nothing of yours listening on port${ports.length > 1 ? `s ${ports[0]}-${ports.at(-1)}` : ` ${ports[0]}`}\n`)
    return 1
  }
  for (const { port, status } of bridges) {
    process.stdout.write(`redline: ${status.channel} listening on port ${port}, for ${status.agent ?? 'an agent'} in ${status.project} (pid ${status.pid})\n`)
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
