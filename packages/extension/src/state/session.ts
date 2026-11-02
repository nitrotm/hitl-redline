import { type Annotation, type FeedbackRound, type RoundStatus, SCHEMA_VERSION, type Snapshot, type SnapshotWithImages, type Viewport } from '@redline/shared'

import { COLORS, boundingBox, intersects } from '../geometry.ts'
import type { AnnotationPatch, NewAnnotation } from '../messages.ts'

// A session is the annotating of one tab, from Start until Done: its rounds of feedback, each of
// snapshots, each a screenshot and the annotations captured with it. The functions here are pure:
// the background (entrypoints/background.ts) stores what they return.

export type Tool = 'select' | 'rect' | 'freehand'

export interface Session {
  id: string
  tabId: number
  // the overlay is on the page
  active: boolean
  // the round being prepared; 1 for the first
  round: number
  // ids are never reused in a session: #7 means one mark, in every snapshot and every round
  nextAnnotationId: number
  nextSnapshotNumber: number
  // drawn on the page, not captured yet
  draft: Annotation[]
  // captured, in this round
  snapshots: Snapshot[]
  comment: string
  tool: Tool
  color: string
  // submitted, until the bridge takes it: the round is built from the session when it is sent
  pending?: { status: RoundStatus; queuedAt: string; error?: string }
  lastSent?: { round: number; status: RoundStatus; directory: string; at: string }
}

export function createSession(tabId: number, id: string): Session {
  return {
    id,
    tabId,
    active: true,
    round: 1,
    nextAnnotationId: 1,
    nextSnapshotNumber: 1,
    draft: [],
    snapshots: [],
    comment: '',
    tool: 'rect',
    color: COLORS[0],
  }
}

export function addAnnotation(session: Session, annotation: NewAnnotation): [Session, Annotation] {
  const added = { ...annotation, id: session.nextAnnotationId, comment: '' } as Annotation
  return [{ ...session, nextAnnotationId: session.nextAnnotationId + 1, draft: [...session.draft, added] }, added]
}

// a draft's or a captured one's: comments stay editable until the round is sent
export function updateAnnotation(session: Session, id: number, patch: AnnotationPatch): Session {
  const apply = (a: Annotation): Annotation => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)
  return {
    ...session,
    draft: session.draft.map(apply),
    snapshots: session.snapshots.map((s) => ({ ...s, annotations: s.annotations.map(apply) })),
  }
}

export function deleteAnnotation(session: Session, id: number): Session {
  const keep = (a: Annotation) => a.id !== id
  return {
    ...session,
    draft: session.draft.filter(keep),
    snapshots: session.snapshots.map((s) => ({ ...s, annotations: s.annotations.filter(keep) })),
  }
}

// the last mark drawn, if it is still on the page
export function undo(session: Session): Session {
  const last = session.draft.at(-1)
  return last ? deleteAnnotation(session, last.id) : session
}

export interface Capture {
  url: string
  title: string
  capturedAt: string
  viewport: Viewport
}

// The drafts in the viewport go into a new snapshot; the others stay on the page, for a snapshot
// of their own once scrolled to.
export function takeSnapshot(session: Session, capture: Capture): [Session, Snapshot] {
  const { viewport: v } = capture
  const visible = { x: v.scrollX, y: v.scrollY, width: v.width, height: v.height }
  const captured = session.draft.filter((a) => intersects(boundingBox(a), visible))
  const snapshot: Snapshot = { id: `S${session.nextSnapshotNumber}`, ...capture, annotations: captured }
  return [
    {
      ...session,
      nextSnapshotNumber: session.nextSnapshotNumber + 1,
      draft: session.draft.filter((a) => !captured.includes(a)),
      snapshots: [...session.snapshots, snapshot],
    },
    snapshot,
  ]
}

export function deleteSnapshot(session: Session, snapshotId: string): Session {
  return { ...session, snapshots: session.snapshots.filter((s) => s.id !== snapshotId) }
}

export function queueRound(session: Session, status: RoundStatus, now: string): Session {
  return { ...session, pending: { status, queuedAt: now } }
}

export function buildRound(session: Session, images: Map<string, SnapshotWithImages['images']>): FeedbackRound {
  if (!session.pending) throw new Error('no round to send')
  return {
    version: SCHEMA_VERSION,
    sessionId: session.id,
    round: session.round,
    status: session.pending.status,
    comment: session.comment,
    snapshots: session.snapshots.map((s) => {
      const pair = images.get(s.id)
      if (!pair) throw new Error(`the screenshots of ${s.id} are missing`)
      return { ...s, images: pair }
    }),
  }
}

// The bridge took the round: the next one starts empty, but for the marks still on the page. A
// 'done' round ends the session.
export function roundSent(session: Session, directory: string, now: string): Session {
  const status = session.pending?.status ?? 'feedback'
  const { pending: _, ...rest } = session
  return {
    ...rest,
    active: status === 'done' ? false : session.active,
    round: session.round + 1,
    snapshots: [],
    comment: '',
    lastSent: { round: session.round, status, directory, at: now },
  }
}

export function roundFailed(session: Session, error: string): Session {
  return session.pending ? { ...session, pending: { ...session.pending, error } } : session
}
