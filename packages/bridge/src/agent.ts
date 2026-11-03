import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'

// Which agent session a `redline wait` is for, without the agent saying: the key its channel is
// claimed for (src/channels.ts), so that the session keeps its channel from wait to wait. An agent
// runs each command in a shell of its own, perhaps in a sandbox, so the session is the first
// process above that is neither: the agent itself, the same for as long as the session lasts.

export interface Proc {
  pid: number
  ppid: number
  name: string
  // when it started, so that a pid used again later is another key
  start: string
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'mksh', 'tcsh', 'csh', 'nu', 'xonsh', 'elvish', 'pwsh', 'powershell', 'cmd', 'busybox'])
// what runs a command for an agent, or in its sandbox, rather than being it
const WRAPPERS = /^(bwrap|env|timeout|script|nice|nohup|setsid|stdbuf|unbuffer|time|sudo|doas|nix|direnv|.*sandbox.*)$/

export function isPassThrough(name: string): boolean {
  const bare = name.replace(/\.exe$/i, '').replace(/^-/, '')
  return SHELLS.has(bare) || WRAPPERS.test(bare)
}

// A process, from /proc (Linux) or ps (macOS); none elsewhere.
export async function processInfo(pid: number): Promise<Proc | undefined> {
  try {
    if (process.platform === 'linux') return parseProcStat(await readFile(`/proc/${pid}/stat`, 'utf8'))
    if (process.platform === 'darwin') {
      const { stdout } = await promisify(execFile)('ps', ['-o', 'ppid=,lstart=,comm=', '-p', String(pid)])
      return parsePs(pid, stdout)
    }
  } catch {
    // gone, or not ours to read
  }
  return undefined
}

// "pid (comm) state ppid … starttime …": comm may hold spaces and parentheses, up to the last ")"
export function parseProcStat(stat: string): Proc | undefined {
  const open = stat.indexOf('(')
  const close = stat.lastIndexOf(')')
  if (open < 0 || close < open) return undefined
  const fields = stat.slice(close + 2).split(' ')
  const pid = Number(stat.slice(0, open).trim())
  // after the name: state (3), ppid (4) … starttime (22)
  const ppid = Number(fields[1])
  const start = fields[19]
  if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !start) return undefined
  return { pid, ppid, name: stat.slice(open + 1, close), start }
}

// "  1234 Mon Nov  3 12:00:00 2026     /path/to/command"
export function parsePs(pid: number, line: string): Proc | undefined {
  const match = /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+?)\s*$/.exec(line)
  if (!match) return undefined
  return { pid, ppid: Number(match[1]), start: match[2]!.replace(/\s+/g, ' '), name: basename(match[3]!) }
}

// the first process above PID that runs commands for no one else
export async function agentProcess(pid: number = process.ppid, info: (pid: number) => Promise<Proc | undefined> = processInfo): Promise<Proc | undefined> {
  for (let depth = 0; pid > 1 && depth < 32; depth++) {
    const proc = await info(pid)
    if (!proc) return undefined
    if (!isPassThrough(proc.name)) return proc
    pid = proc.ppid
  }
  return undefined
}

// The session's key: REDLINE_SESSION if set, else the agent's process (with the project, for a
// terminal that waits in several), else the project alone.
export async function sessionKey(project: string, env: NodeJS.ProcessEnv = process.env, find: () => Promise<Proc | undefined> = agentProcess): Promise<string> {
  if (env.REDLINE_SESSION) return env.REDLINE_SESSION
  const agent = await find()
  return agent ? `${agent.name}:${agent.pid}:${agent.start}:${project}` : project
}
