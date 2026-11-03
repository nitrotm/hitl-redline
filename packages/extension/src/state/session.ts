import {
  type Annotation,
  type Answer,
  type FeedbackRound,
  type Point,
  type Reply,
  type RoundStatus,
  SCHEMA_VERSION,
  type Snapshot,
  type SnapshotWithImages,
  type Viewport,
} from '@redline/shared'

import { WINDOW } from '../devices.ts'
import { COLORS } from '../geometry.ts'
import type { AnnotationPatch, NewAnnotation } from '../messages.ts'

// A session is the annotating of one tab, from its first screenshot until Done: its rounds of
// feedback, each of snapshots, each a screenshot and the marks drawn on it. A screenshot comes
// first: the overlay shows it, frozen, and the marks go on it. The functions here are pure: the
// background (entrypoints/background.ts) stores what they return.

export type Tool = 'select' | 'rect' | 'arrow' | 'freehand'
export type DrawingTool = Exclude<Tool, 'select'>

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
  // in this round
  snapshots: Snapshot[]
  // the snapshot being annotated, whose screenshot the overlay shows; none: the live page
  current?: string
  // the mark selected, on the page and in the sidebar alike: one of the current snapshot's
  selected?: number
  comment: string
  tool: Tool
  // the last drawing tool chosen: a new screenshot starts with it
  drawingTool: DrawingTool
  color: string
  // the device the page is shown as (src/devices.ts), or the window itself
  device: string
  // the channel of the agent session it is bound to (`redline wait`): its rounds go to that
  // the agent alone, waiting while it is at work; none until an agent listens for the page
  channel?: string
  // that agent, as its wait names it (`--agent`): the sidebar says so while it is at work
  agent?: string
  // the run of the channel's wait the tab was last reloaded for (`redline wait --reload`)
  reloadedFor?: string
  // the agent's reply to the last round sent, with its questions; and the answers typed to them, by
  // question id, which go with the next round
  reply?: Reply
  answers?: Record<string, string>
  // submitted, until the bridge takes it: the round is built from the session when it is sent
  pending?: { status: RoundStatus; queuedAt: string; error?: string }
  lastSent?: { round: number; status: RoundStatus; directory: string; at: string }
}

export function createSession(tabId: number, id: string, channel?: string, agent?: string): Session {
  return {
    id,
    tabId,
    ...(channel && { channel }),
    ...(agent && { agent }),
    active: true,
    round: 1,
    nextAnnotationId: 1,
    nextSnapshotNumber: 1,
    snapshots: [],
    comment: '',
    tool: 'freehand',
    drawingTool: 'freehand',
    color: COLORS[0],
    device: WINDOW,
  }
}

// A session as an earlier version stored it, in this version's shape: its pen marks of points
// (the round's format 1) get them as one stroke, the marks drawn before screenshots came first
// (draft) go, the fields added since get their defaults.
export function upgradeSession(stored: Session): Session {
  const { draft: _, ...session } = stored as Session & { draft?: unknown }
  const annotation = (a: Annotation): Annotation => {
    const old = a as Annotation & { points?: Point[] }
    if (old.kind !== 'freehand' || old.strokes) return a
    const { points, ...rest } = old
    return { ...rest, strokes: [points ?? []] }
  }
  return {
    ...session,
    device: session.device ?? WINDOW,
    drawingTool: session.drawingTool ?? 'freehand',
    snapshots: (session.snapshots ?? []).map((s) => ({ ...s, annotations: s.annotations.map(annotation) })),
  }
}

// bound to that agent's channel, or to another one the user picked; AGENT: its name, if it gives one
export function bindChannel(session: Session, channel: string, agent?: string): Session {
  if (session.channel === channel && (!agent || session.agent === agent)) return session
  const { agent: _, ...rest } = session
  return { ...rest, channel, ...((agent ?? (session.channel === channel ? session.agent : undefined)) && { agent: agent ?? session.agent }) }
}

// Whether the channel's wait of this run (NONCE) asks for the tab to be reloaded, and it was not yet.
export function needsReload(session: Session, nonce: string, reload: boolean | undefined): boolean {
  return Boolean(reload) && session.lastSent?.status !== 'done' && session.reloadedFor !== nonce
}

export function markReloaded(session: Session, nonce: string): Session {
  return { ...session, reloadedFor: nonce }
}

export function setTool(session: Session, tool: Tool): Session {
  return { ...session, tool, drawingTool: tool === 'select' ? session.drawingTool : tool }
}

export function currentSnapshot(session: Session): Snapshot | undefined {
  return session.snapshots.find((s) => s.id === session.current)
}

function mapAnnotations(session: Session, f: (annotations: Annotation[], snapshot: Snapshot) => Annotation[]): Session {
  return { ...session, snapshots: session.snapshots.map((s) => ({ ...s, annotations: f(s.annotations, s) })) }
}

// a mark on the snapshot being annotated
export function addAnnotation(session: Session, annotation: NewAnnotation): [Session, Annotation] {
  if (!currentSnapshot(session)) throw new Error('take a screenshot first')
  const added = { ...annotation, id: session.nextAnnotationId, comment: '' } as Annotation
  const next = mapAnnotations(session, (annotations, s) => (s.id === session.current ? [...annotations, added] : annotations))
  return [{ ...next, nextAnnotationId: session.nextAnnotationId + 1 }, added]
}

export function updateAnnotation(session: Session, id: number, patch: AnnotationPatch): Session {
  return mapAnnotations(session, (annotations) => annotations.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)))
}

export function deleteAnnotation(session: Session, id: number): Session {
  const next = mapAnnotations(session, (annotations) => annotations.filter((a) => a.id !== id))
  return next.selected === id ? selectAnnotation(next, null) : next
}

// A mark of any snapshot: its snapshot becomes the one annotated. None: no mark is.
export function selectAnnotation(session: Session, id: number | null): Session {
  const { selected: _, ...rest } = session
  if (id === null) return rest
  const snapshot = session.snapshots.find((s) => s.annotations.some((a) => a.id === id))
  if (!snapshot) throw new Error(`no mark #${id}`)
  return { ...rest, current: snapshot.id, selected: id }
}

// the last mark of the snapshot being annotated
export function undo(session: Session): Session {
  const last = currentSnapshot(session)?.annotations.at(-1)
  return last ? deleteAnnotation(session, last.id) : session
}

export interface Capture {
  url: string
  title: string
  capturedAt: string
  device?: string
  viewport: Viewport
}

// a new snapshot, without marks yet, which becomes the one being annotated
export function takeSnapshot(session: Session, capture: Capture): [Session, Snapshot] {
  const snapshot: Snapshot = { id: `S${session.nextSnapshotNumber}`, ...capture, annotations: [] }
  const { selected: _, ...rest } = session
  return [
    {
      ...rest,
      nextSnapshotNumber: session.nextSnapshotNumber + 1,
      snapshots: [...session.snapshots, snapshot],
      current: snapshot.id,
      // ready to draw, with the tool drawn with last
      tool: session.drawingTool ?? 'freehand',
    },
    snapshot,
  ]
}

export function openSnapshot(session: Session, snapshotId: string): Session {
  if (!session.snapshots.some((s) => s.id === snapshotId)) throw new Error(`no snapshot ${snapshotId}`)
  if (session.current === snapshotId) return session
  const { selected: _, ...rest } = session
  return { ...rest, current: snapshotId }
}

export function closeSnapshot(session: Session): Session {
  const { current: _, selected: __, ...rest } = session
  return rest
}

export function deleteSnapshot(session: Session, snapshotId: string): Session {
  const next = { ...session, snapshots: session.snapshots.filter((s) => s.id !== snapshotId) }
  return session.current === snapshotId ? closeSnapshot(next) : next
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
    ...(answersOf(session).length && { answers: answersOf(session) }),
    snapshots: session.snapshots.map((s) => {
      const pair = images.get(s.id)
      if (!pair) throw new Error(`the screenshot of ${s.id} is missing`)
      return { ...s, images: pair }
    }),
  }
}

// the answers typed to the reply's questions, each with its question
export function answersOf(session: Session): Answer[] {
  return (session.reply?.questions ?? []).flatMap((q) => {
    const answer = session.answers?.[q.id]?.trim()
    return answer ? [{ question: q.id, text: q.text, ...(q.mark && { mark: q.mark }), answer }] : []
  })
}

// something to send: screenshots, a comment on the round, answers to the agent's questions
export function hasFeedback(session: Session): boolean {
  return session.snapshots.length > 0 || session.comment.trim() !== '' || answersOf(session).length > 0
}

// What Ctrl+D sends: the round if it has something, or else Done, which ends the loop.
export function submitStatus(session: Session): RoundStatus {
  return hasFeedback(session) ? 'feedback' : 'done'
}

// the agent's reply, kept if it is to this session's last round sent: a newer round makes it stale
export function storeReply(session: Session, reply: Reply): Session {
  if (reply.sessionId !== session.id || reply.round !== session.lastSent?.round || session.reply?.round === reply.round) return session
  const { answers: _, ...rest } = session
  return { ...rest, reply }
}

export function setAnswer(session: Session, question: string, answer: string): Session {
  return { ...session, answers: { ...session.answers, [question]: answer } }
}

// The bridge took the round: the next one starts empty, on the live page. A 'done' round ends
// the session.
export function roundSent(session: Session, directory: string, now: string): Session {
  const status = session.pending?.status ?? 'feedback'
  const { pending: _, current: __, selected: ___, reply: ____, answers: _____, ...rest } = session
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
