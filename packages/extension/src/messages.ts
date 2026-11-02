import type { Annotation, Point, RoundStatus, Target, Viewport } from '@redline/shared'

import type { Tool } from './state/session.ts'

// What the overlay and the sidebar ask the background, which owns the sessions (src/state). A
// request without tabId is for the tab of its sender: the overlay's.

export type NewAnnotation = Annotation extends infer A ? (A extends Annotation ? Omit<A, 'id' | 'comment'> : never) : never
export type AnnotationPatch = { comment?: string; color?: string; target?: Target; badge?: Point } & (
  | { rect?: Extract<Annotation, { kind: 'rect' }>['rect'] }
  | { from?: Extract<Annotation, { kind: 'arrow' }>['from']; to?: Extract<Annotation, { kind: 'arrow' }>['to'] }
  | { strokes?: Extract<Annotation, { kind: 'freehand' }>['strokes'] }
)

export type Request =
  // the tool, the color, the device; it starts the session if need be
  // every mark and screenshot of the tab's session, gone: the way out of a session gone wrong
  | { type: 'session/discard'; tabId?: number }
  | { type: 'ui/set'; tabId?: number; tool?: Tool; color?: string; device?: string }
  | { type: 'annotation/add'; tabId?: number; annotation: NewAnnotation }
  | { type: 'annotation/update'; tabId?: number; id: number; patch: AnnotationPatch }
  | { type: 'annotation/delete'; tabId?: number; id: number }
  // on the page or in the sidebar: both show it; the sidebar's opens its snapshot
  | { type: 'annotation/select'; tabId?: number; id: number | null }
  | { type: 'annotation/undo'; tabId?: number }
  // a screenshot of the page, a new snapshot to annotate; it starts the session if need be
  | { type: 'snapshot/capture'; tabId?: number }
  | { type: 'snapshot/open'; tabId?: number; snapshotId: string }
  | { type: 'snapshot/close'; tabId?: number }
  | { type: 'snapshot/delete'; tabId?: number; snapshotId: string }
  // the screenshot of a snapshot, for the overlay, which cannot read the extension's IndexedDB
  | { type: 'snapshot/image'; tabId?: number; snapshotId: string }
  | { type: 'comment/set'; tabId?: number; comment: string }
  | { type: 'round/submit'; tabId?: number; status: RoundStatus }
  | { type: 'outbox/flush' }
  | { type: 'whoami' }

export interface Responses {
  'session/discard': null
  'ui/set': null
  'annotation/add': Annotation
  'annotation/update': null
  'annotation/delete': null
  'annotation/select': null
  'annotation/undo': null
  'snapshot/capture': CaptureResult
  'snapshot/open': null
  'snapshot/close': null
  'snapshot/delete': null
  'snapshot/image': string
  'comment/set': null
  'round/submit': null
  'outbox/flush': null
  // the tab of the sender
  whoami: number
}

export interface CaptureResult {
  snapshotId: string
}

// What the background asks the overlay of a tab.
export type ContentRequest = { type: 'capture/prepare' } | { type: 'capture/restore' } | { type: 'highlight'; id: number | null } | { type: 'ping' }

export interface PreparedCapture {
  viewport: Viewport
  url: string
  title: string
  // shown as a device: its label, and where its frame is in the window (CSS px), to crop the
  // window's screenshot to
  device?: { label: string; crop: { x: number; y: number; width: number; height: number }; windowWidth: number }
}

// the background answers { ok, value } or { ok: false, error }, which send() turns back into a throw
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string }

export async function send<T extends Request['type']>(request: Extract<Request, { type: T }>): Promise<Responses[T]> {
  const reply = (await browser.runtime.sendMessage(request)) as Reply<Responses[T]> | undefined
  if (!reply) throw new Error(`no answer to ${request.type}`)
  if (!reply.ok) throw new Error(reply.error)
  return reply.value
}
