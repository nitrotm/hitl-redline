import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Type } from 'typebox'

// hitl-redline for pi: the tool `redline_wait` runs `redline wait` in the background, and when
// the user sends a round, a message starts the agent's next turn with it. pi has no background
// commands that wake the agent; an extension can (docs/agents.md). The rest of the loop is the
// skill's, which the package gives pi too.
//
// Only what pi provides an extension at run time is imported (typebox, node's own); the part of
// pi's API used is typed here.

export interface Pi {
  registerTool(tool: {
    name: string
    label: string
    description: string
    parameters: unknown
    execute(toolCallId: string, params: WaitParams, signal: AbortSignal | undefined, onUpdate: unknown, ctx: Context): Promise<ToolResult>
  }): void
  on(event: 'session_shutdown', handler: () => void | Promise<void>): void
  sendUserMessage(content: string, options?: { deliverAs?: 'steer' | 'followUp' }): void | Promise<void>
}

export interface Context {
  cwd: string
  sessionManager?: { getSessionId?(): string | undefined; getSessionFile?(): string | undefined }
}

interface ToolResult {
  content: { type: 'text'; text: string }[]
  details: Record<string, unknown>
}

interface WaitParams {
  url: string
  reload?: boolean
}

// a wait replaced by a newer one of its channel, or stopped here
const REPLACED = 3

// `redline`, on the PATH or named by REDLINE_BIN; in a checkout of the repository, its sources
export function redlineCommand(): string[] {
  if (process.env.REDLINE_BIN) return [process.env.REDLINE_BIN]
  // import.meta.url, rather than dirname: what jiti, which pi loads extensions with, surely gives
  const sources = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bridge', 'src', 'cli.ts')
  return existsSync(sources) ? ['node', sources] : ['redline']
}

export function createExtension(command: string[] = redlineCommand()) {
  return function redline(pi: Pi) {
    let waiting: ChildProcess | undefined

    pi.registerTool({
      name: 'redline_wait',
      label: 'Redline: wait for a round',
      description:
        "Wait for the user's next round of feedback from the Redline extension, in the background: it returns at once with the channel's name, " +
        'and a message starts your next turn when the round comes. Use it where the redline skill says to run `redline wait`. ' +
        "url: the app's root (the dev server's origin). reload: true after you changed the page, if you cannot reload it yourself.",
      parameters: Type.Object({
        url: Type.String({ description: "The app's root: the dev server's origin, or its base path" }),
        reload: Type.Optional(Type.Boolean({ description: 'Have the browser reload the tabs of your channel' })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const session = ctx.sessionManager?.getSessionId?.() ?? ctx.sessionManager?.getSessionFile?.()
        const args = ['wait', '--agent', 'pi', '--url', params.url, ...(params.reload ? ['--reload'] : []), ...(session ? ['--session', `pi:${session}`] : [])]
        const child = spawn(command[0]!, [...command.slice(1), ...args], { cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
        waiting = child
        let stdout = ''
        let stderr = ''
        child.stdout!.on('data', (chunk: Buffer) => (stdout += chunk))
        child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk))

        // once it listens (its two first lines: the channel, where the reply goes), or fails
        const started = await new Promise<{ listening: boolean }>((resolve) => {
          child.stdout!.on('data', () => {
            if (/waiting for feedback[^\n]*\n[^\n]*reply[^\n]*\n/.test(stdout)) resolve({ listening: true })
          })
          child.on('error', (error) => {
            stderr += error.message
            resolve({ listening: false })
          })
          child.on('exit', () => resolve({ listening: false }))
        })

        child.on('exit', (code) => {
          if (waiting === child) waiting = undefined
          if (code === 0) {
            const feedback = stdout.trim().split('\n').at(-1)
            const round = /redline: (round \d+[^\n]*)/.exec(stdout)?.[1] ?? 'a round'
            void pi.sendUserMessage(`Redline: ${round}. Read ${feedback} and go on as the redline skill says (step 3, "On each round").`, {
              deliverAs: 'followUp',
            })
          } else if (code !== REPLACED && code !== null && started.listening)
            void pi.sendUserMessage(`Redline: the wait stopped (exit ${code}): ${(stderr || stdout).trim()}`, { deliverAs: 'followUp' })
        })

        if (!started.listening) {
          const text = `redline wait did not start: ${(stderr || stdout).trim() || 'no output'}`
          return { content: [{ type: 'text', text }], details: { error: true } }
        }
        const lines = stdout.trim().split('\n').slice(0, 2).join('\n')
        return {
          content: [{ type: 'text', text: `${lines}\nEnd your turn: when the user sends a round, a message brings it to you.` }],
          details: { channel: /redline: ([a-z]+-[a-z]+) waiting/.exec(stdout)?.[1] },
        }
      },
    })

    // pi going: its wait goes too, as a replaced one, which sends nothing
    pi.on('session_shutdown', () => {
      waiting?.kill('SIGTERM')
      waiting = undefined
    })
  }
}

export default createExtension()
