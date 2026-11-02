import { DEFAULT_PORT, type FeedbackRound, RoundAccepted, Status, bridgeUrl } from '@redline/shared'

// `redline wait`, on the loopback: listening only while Claude waits for a round.

export async function bridgeStatus(port = DEFAULT_PORT): Promise<Status | undefined> {
  try {
    const response = await fetch(bridgeUrl(port, 'status'), { signal: AbortSignal.timeout(1500) })
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

export async function postRound(round: FeedbackRound, port = DEFAULT_PORT): Promise<RoundAccepted> {
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
