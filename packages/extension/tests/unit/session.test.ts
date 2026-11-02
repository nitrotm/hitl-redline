import { describe, expect, it } from 'vitest'

import {
  addAnnotation,
  buildRound,
  createSession,
  deleteAnnotation,
  queueRound,
  roundSent,
  takeSnapshot,
  undo,
  updateAnnotation,
} from '../../src/state/session.ts'

const viewport = { width: 1000, height: 800, dpr: 2, scrollX: 0, scrollY: 0 }
const capture = (scrollY = 0) => ({ url: 'http://localhost/', title: 'Home', capturedAt: '2026-11-02T10:00:00.000Z', viewport: { ...viewport, scrollY } })
const rect = (y: number) => ({ kind: 'rect' as const, color: '#e11d48', rect: { x: 10, y, width: 50, height: 20 } })

function drawn(...ys: number[]) {
  let session = createSession(1, 'session-1')
  for (const y of ys) [session] = addAnnotation(session, rect(y))
  return session
}

describe('annotation ids', () => {
  it('are never reused, after a delete or a snapshot', () => {
    let session = drawn(10, 20)
    session = deleteAnnotation(session, 2)
    ;[session] = takeSnapshot(session, capture())
    const [, added] = addAnnotation(session, rect(30))
    expect(added.id).toBe(3)
  })

  it('carry on from round to round', () => {
    let session = drawn(10)
    ;[session] = takeSnapshot(session, capture())
    session = roundSent(queueRound(session, 'feedback', 'now'), '/p/.redline/rounds/001', 'now')
    expect(addAnnotation(session, rect(10))[1].id).toBe(2)
  })
})

describe('takeSnapshot', () => {
  it('captures the drafts in the viewport, and leaves the others on the page', () => {
    const [session, snapshot] = takeSnapshot(drawn(100, 2000), capture())
    expect(snapshot.id).toBe('S1')
    expect(snapshot.annotations.map((a) => a.id)).toEqual([1])
    expect(session.draft.map((a) => a.id)).toEqual([2])

    const [, second] = takeSnapshot(session, capture(1800))
    expect(second.id).toBe('S2')
    expect(second.annotations.map((a) => a.id)).toEqual([2])
  })
})

describe('updateAnnotation', () => {
  it('changes a comment, drafted or captured', () => {
    let [session] = takeSnapshot(drawn(10), capture())
    ;[session] = addAnnotation(session, rect(20))
    session = updateAnnotation(updateAnnotation(session, 1, { comment: 'bigger' }), 2, { comment: 'red' })
    expect(session.snapshots[0]!.annotations[0]!.comment).toBe('bigger')
    expect(session.draft[0]!.comment).toBe('red')
  })
})

describe('undo', () => {
  it('removes the last mark still on the page', () => {
    expect(undo(drawn(10, 20)).draft.map((a) => a.id)).toEqual([1])
    expect(undo(createSession(1, 's')).draft).toEqual([])
  })
})

describe('rounds', () => {
  it('are built from the session, with the screenshots', () => {
    const [session] = takeSnapshot(drawn(10), capture())
    const images = new Map([['S1', { clean: 'data:image/png;base64,AA', annotated: 'data:image/png;base64,BB' }]])
    const round = buildRound({ ...queueRound(session, 'feedback', 'now'), comment: 'tighter' }, images)
    expect(round).toMatchObject({ version: 1, sessionId: 'session-1', round: 1, status: 'feedback', comment: 'tighter' })
    expect(round.snapshots[0]!.images.annotated).toBe('data:image/png;base64,BB')
  })

  it('start the next one empty, but for the marks on the page', () => {
    let [session] = takeSnapshot(drawn(10, 5000), capture())
    session = roundSent(queueRound({ ...session, comment: 'x' }, 'feedback', 'now'), '/d', 'later')
    expect(session).toMatchObject({ round: 2, snapshots: [], comment: '', active: true, lastSent: { round: 1, directory: '/d' } })
    expect(session.pending).toBeUndefined()
    expect(session.draft).toHaveLength(1)
  })

  it('end the session when done', () => {
    const session = roundSent(queueRound(drawn(), 'done', 'now'), '/d', 'later')
    expect(session.active).toBe(false)
    expect(session.lastSent?.status).toBe('done')
  })
})
