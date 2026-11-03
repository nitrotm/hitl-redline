import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Herdr, a terminal workspace for coding agents, names the agent of each of its panes. A wait run
// in one (HERDR_PANE_ID, which Herdr gives every command of the pane) names its agent after the
// channel, so that the user tells which pane is the agent of which browser window: Firefox shows
// the channel in the window's title too. The name keeps the agent's kind, which a name replaces in
// Herdr: `claude-sleepy-gecko`. A name the user gave stays; one that a channel gave is replaced by
// the channel of the day. Herdr forgets it when the agent exits.

// runs herdr with ARGS, and gives its output; throws if it fails
export type Herdr = (args: string[]) => Promise<string>

const TIMEOUT_MS = 2000

function runHerdr(bin: string): Herdr {
  return async (args) => (await promisify(execFile)(bin, args, { timeout: TIMEOUT_MS })).stdout
}

// what Herdr takes as an agent's name: no colon nor space, hence a hyphen between kind and channel
const HERDR_NAME = /^[a-z][a-z0-9_-]{0,31}$/

// The name of a pane's agent of that KIND (`claude`, `codex`…, as Herdr detects it) for CHANNEL:
// the channel alone if Herdr would not take both.
export function herdrName(channel: string, kind?: string): string {
  const name = `${kind}-${channel}`
  return kind && HERDR_NAME.test(name) ? name : channel
}

// The channel that gave NAME, if a wait gave it to an agent of that KIND: `claude-sleepy-gecko`, or
// `sleepy-gecko` alone (an older wait, or an agent Herdr does not know).
function channelOf(name: string, kind?: string): string {
  return kind && name.startsWith(`${kind}-`) ? name.slice(kind.length + 1) : name
}

// Whether the agent of the wait's pane was named after CHANNEL; IS_CHANNEL tells a channel's name.
// Never throws: without Herdr, or with an older one, the wait goes on as well.
export async function nameHerdrAgent(
  channel: string,
  isChannel: (name: string) => boolean,
  env: NodeJS.ProcessEnv = process.env,
  herdr: Herdr = runHerdr(env.HERDR_BIN_PATH || 'herdr')
): Promise<boolean> {
  const pane = env.HERDR_PANE_ID
  if (!pane) return false
  try {
    // no agent in the pane (a plain shell runs the wait): nothing to name
    const agent = (JSON.parse(await herdr(['agent', 'get', pane])) as { result?: { agent?: { agent?: string; name?: string } } }).result?.agent
    const wanted = herdrName(channel, agent?.agent)
    if (agent?.name === wanted) return true
    if (agent?.name && !isChannel(channelOf(agent.name, agent.agent))) return false
    await herdr(['agent', 'rename', pane, wanted])
    return true
  } catch {
    return false
  }
}
