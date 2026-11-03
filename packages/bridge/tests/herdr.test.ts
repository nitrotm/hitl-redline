import { describe, expect, it } from 'vitest'

import { type Herdr, nameHerdrAgent } from '../src/herdr.ts'

// a Herdr whose pane hosts an agent of that NAME (none: no name; null: no agent), and what it was asked
function fakeHerdr(name?: string | null) {
  const calls: string[][] = []
  const herdr: Herdr = async (args) => {
    calls.push(args)
    if (args[1] === 'get') {
      if (name === null) throw new Error('agent_not_found')
      return JSON.stringify({ result: { agent: { agent: 'claude', pane_id: args[2], ...(name && { name }) }, type: 'agent_info' } })
    }
    return '{}'
  }
  return { herdr, calls }
}

const IN_PANE = { HERDR_PANE_ID: 'w1:p2' }
const isChannel = (name: string) => name === 'calm-dog'

describe('nameHerdrAgent', () => {
  it("names the pane's agent after the channel", async () => {
    const { herdr, calls } = fakeHerdr()
    expect(await nameHerdrAgent('brave-cat', isChannel, IN_PANE, herdr)).toBe(true)
    expect(calls).toEqual([
      ['agent', 'get', 'w1:p2'],
      ['agent', 'rename', 'w1:p2', 'brave-cat'],
    ])
  })

  it("replaces the name of another channel, but not the user's", async () => {
    const channel = fakeHerdr('calm-dog')
    expect(await nameHerdrAgent('brave-cat', isChannel, IN_PANE, channel.herdr)).toBe(true)
    expect(channel.calls.at(-1)).toEqual(['agent', 'rename', 'w1:p2', 'brave-cat'])

    const users = fakeHerdr('reviewer')
    expect(await nameHerdrAgent('brave-cat', isChannel, IN_PANE, users.herdr)).toBe(false)
    expect(users.calls).toHaveLength(1)
  })

  it('leaves a name that is already the channel', async () => {
    const { herdr, calls } = fakeHerdr('brave-cat')
    expect(await nameHerdrAgent('brave-cat', isChannel, IN_PANE, herdr)).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('does nothing out of Herdr, nor in a pane without an agent', async () => {
    const outside = fakeHerdr()
    expect(await nameHerdrAgent('brave-cat', isChannel, {}, outside.herdr)).toBe(false)
    expect(outside.calls).toEqual([])

    const shell = fakeHerdr(null)
    expect(await nameHerdrAgent('brave-cat', isChannel, IN_PANE, shell.herdr)).toBe(false)
    expect(shell.calls).toHaveLength(1)
  })
})
