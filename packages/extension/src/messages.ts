import type { Annotation, RoundStatus, Target, Viewport } from '@redline/shared'

import type { Session, Tool } from './state/session.ts'

// What the overlay and the sidebar ask the background, which owns the sessions (src/state). A
// request without tabId is for the tab of its sender: the overlay's.

export type NewAnnotation = Annotation extends infer A ? (A extends Annotation ? Omit<A, 'id' | 'comment'> : never) : never
export type AnnotationPatch = { comment?: string; target?: Target } & (
  { rect?: Extract<Annotation, { kind: 'rect' }>['rect'] } | { points?: Extract<Annotation, { kind: 'freehand' }>['points'] }
)

export type Request =
  | { type: 'session/start'; tabId?: number }
  | { type: 'session/stop'; tabId?: number }
  | { type: 'session/discard'; tabId?: number }
  | { type: 'ui/set'; tabId?: number; tool?: Tool; color?: string }
  | { type: 'annotation/add'; tabId?: number; annotation: NewAnnotation }
  | { type: 'annotation/update'; tabId?: number; id: number; patch: AnnotationPatch }
  | { type: 'annotation/delete'; tabId?: number; id: number }
  | { type: 'annotation/undo'; tabId?: number }
  | { type: 'snapshot/capture'; tabId?: number }
  | { type: 'snapshot/delete'; tabId?: number; snapshotId: string }
  | { type: 'comment/set'; tabId?: number; comment: string }
  | { type: 'round/submit'; tabId?: number; status: RoundStatus }
  | { type: 'outbox/flush' }
  | { type: 'whoami' }

export interface Responses {
  'session/start': Session
  'session/stop': null
  'session/discard': null
  'ui/set': null
  'annotation/add': Annotation
  'annotation/update': null
  'annotation/delete': null
  'annotation/undo': null
  'snapshot/capture': CaptureResult
  'snapshot/delete': null
  'comment/set': null
  'round/submit': null
  'outbox/flush': null
  // the tab of the sender
  whoami: number
}

export interface CaptureResult {
  snapshotId: string
  captured: number
  // the drafts outside the viewport, left on the page for another snapshot
  left: number
}

// What the background asks the overlay of a tab.
export type ContentRequest = { type: 'capture/prepare' } | { type: 'capture/restore' } | { type: 'highlight'; id: number | null } | { type: 'ping' }

export interface PreparedCapture {
  viewport: Viewport
  url: string
  title: string
}

// the background answers { ok, value } or { ok: false, error }, which send() turns back into a throw
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string }

export async function send<R extends Request>(request: R): Promise<Responses[R['type']]> {
  const reply = (await browser.runtime.sendMessage(request)) as Reply<Responses[R['type']]> | undefined
  if (!reply) throw new Error(`no answer to ${request.type}`)
  if (!reply.ok) throw new Error(reply.error)
  return reply.value
}
