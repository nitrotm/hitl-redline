import { type Bridge, EXTENSION_HEADER, type FeedbackRound, PORTS, RoundAccepted, Status, bridgeUrl, pickBridge } from '@redline/shared'

// The `redline wait`s, on the loopback: each listening only while Claude waits for a round, one
// per project, each on its own port of PORTS.

export async function bridges(): Promise<Bridge[]> {
  const found = await Promise.all(PORTS.map(async (port) => ({ port, status: await bridgeStatus(port) })))
  return found.flatMap(({ port, status }) => (status ? [{ port, status }] : []))
}

// the bridge of the page a tab shows (src: pickBridge)
export async function bridgeFor(tabUrl: string | undefined, sessionId?: string): Promise<Bridge | undefined> {
  return pickBridge(await bridges(), tabUrl, sessionId)
}

async function bridgeStatus(port: number): Promise<Status | undefined> {
  try {
    // with the extension's base URL, which `redline status` tells: its sidebar can open in a tab
    const response = await fetch(bridgeUrl(port, 'status'), {
      headers: { [EXTENSION_HEADER]: browser.runtime.getURL('/') },
      signal: AbortSignal.timeout(1500),
    })
    return response.ok ? Status.parse(await response.json()) : undefined
  } catch {
    return undefined
  }
}

export class BridgeError extends Error {
  // nothing listened: the round waits for the next `redline wait`
  readonly offline: boolean
  constructor(message: string, offline: boolean) {
    super(message)
    this.offline = offline
  }
}

export async function postRound(round: FeedbackRound, port: number): Promise<RoundAccepted> {
  let response: Response
  try {
    response = await fetch(bridgeUrl(port, 'rounds'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(round),
    })
  } catch {
    throw new BridgeError('Claude is not listening', true)
  }
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = (body as { error?: string }).error ?? response.statusText
    // another round got there first, or the bridge stops: the next one takes it
    throw new BridgeError(`the bridge refused the round: ${error}`, response.status === 409)
  }
  return RoundAccepted.parse(body)
}
