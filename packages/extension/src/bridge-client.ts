import { type Bridge, type FeedbackRound, HEADERS, RoundAccepted, askBridges, bridgeForSession, bridgeUrl, roundAuth } from '@redline/shared'

import { pairingKey, renewToken } from './pairing.ts'
import type { Session } from './state/session.ts'
import { getSessions } from './state/store.ts'

// The `redline wait`s, on the loopback: each listening only while its agent waits for a round,
// one per agent session, each on its own port of PORTS. Only those that prove they know the
// user's token count; the others are another user's, or older than the token.

export interface Found {
  bridges: Bridge[]
  // ports where a redline that does not know the token listens
  unpaired: number[]
  // whether the extension has a token at all
  paired: boolean
}

export async function findBridges(): Promise<Found> {
  const extension = browser.runtime.getURL('/')
  let key = await pairingKey()
  let found = await askBridges(key, extension)
  // a bridge that refuses the token: the host may have a newer one
  if (found.unpaired.length && (await renewToken())) {
    key = await pairingKey()
    found = await askBridges(key, extension)
  }
  return { ...found, paired: key !== undefined }
}

// the channels the sessions of the other tabs are bound to, until they are done
export async function heldChannels(tabId?: number): Promise<Set<string>> {
  const sessions = Object.values(await getSessions())
  return new Set(sessions.flatMap((s) => (s.tabId !== tabId && s.channel && s.lastSent?.status !== 'done' ? [s.channel] : [])))
}

// The bridge of a tab's session (bridgeForSession): its channel's, or for an unbound one, the
// likeliest of the page's app that no other tab holds.
export async function bridgeForTab(
  tabUrl: string | undefined,
  session: Pick<Session, 'tabId' | 'channel'> | undefined,
  found?: Found
): Promise<Bridge | undefined> {
  const { bridges } = found ?? (await findBridges())
  return bridgeForSession(bridges, tabUrl, session?.channel, await heldChannels(session?.tabId))
}

export class BridgeError extends Error {
  // nothing listened: the round waits for the next `redline wait`
  readonly offline: boolean
  constructor(message: string, offline: boolean) {
    super(message)
    this.offline = offline
  }
}

// The round, signed for the bridge that proved itself: its port and its run's nonce.
export async function postRound(round: FeedbackRound, bridge: Bridge): Promise<RoundAccepted> {
  const key = await pairingKey()
  if (!key) throw new BridgeError('not paired with your agent', true)
  const body = JSON.stringify(round)
  let response: Response
  try {
    response = await fetch(bridgeUrl(bridge.port, 'rounds'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [HEADERS.auth]: await roundAuth(key, bridge, body) },
      body,
    })
  } catch {
    throw new BridgeError('the agent is not listening', true)
  }
  const reply: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = (reply as { error?: string }).error ?? response.statusText
    // another round got there first, or the bridge stops, or its token changed: the next one takes it
    throw new BridgeError(`the bridge refused the round: ${error}`, response.status === 409 || response.status === 401)
  }
  return RoundAccepted.parse(reply)
}
