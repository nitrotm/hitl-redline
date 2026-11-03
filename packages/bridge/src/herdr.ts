import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Herdr, a terminal workspace for coding agents, names the agent of each of its panes. A wait run
// in one (HERDR_PANE_ID, which Herdr gives every command of the pane) names its agent after the
// channel, so that the user tells which pane is the agent of which browser window: Firefox shows
// the channel in the window's title too. A name the user gave stays; one that a channel gave is
// replaced by the channel of the day. Herdr forgets it when the agent exits.

// runs herdr with ARGS, and gives its output; throws if it fails
export type Herdr = (args: string[]) => Promise<string>

const TIMEOUT_MS = 2000

function runHerdr(bin: string): Herdr {
  return async (args) => (await promisify(execFile)(bin, args, { timeout: TIMEOUT_MS })).stdout
}

// Whether the agent of the wait's pane was named CHANNEL; IS_CHANNEL tells a name a channel gave.
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
    const name = (JSON.parse(await herdr(['agent', 'get', pane])) as { result?: { agent?: { name?: string } } }).result?.agent?.name
    if (name === channel) return true
    if (name && !isChannel(name)) return false
    await herdr(['agent', 'rename', pane, channel])
    return true
  } catch {
    return false
  }
}
