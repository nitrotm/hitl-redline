import { describe, expect, it } from 'vitest'

import {
  addAnnotation,
  buildRound,
  closeSnapshot,
  createSession,
  currentSnapshot,
  deleteAnnotation,
  deleteSnapshot,
  openSnapshot,
  queueRound,
  roundSent,
  selectAnnotation,
  setTool,
  takeSnapshot,
  undo,
  updateAnnotation,
  upgradeSession,
} from '../../src/state/session.ts'

const viewport = { width: 1000, height: 800, dpr: 2, scrollX: 0, scrollY: 0 }
const capture = (scrollY = 0) => ({ url: 'http://localhost/', title: 'Home', capturedAt: '2026-11-02T10:00:00.000Z', viewport: { ...viewport, scrollY } })
const rect = (y: number) => ({ kind: 'rect' as const, color: '#e11d48', rect: { x: 10, y, width: 50, height: 20 } })

// a session with one snapshot, S1, and a mark at each of YS
function drawn(...ys: number[]) {
  let [session] = takeSnapshot(createSession(1, 'session-1'), capture())
  for (const y of ys) [session] = addAnnotation(session, rect(y))
  return session
}

describe('screenshots come first', () => {
  it('a mark needs one', () => {
    expect(() => addAnnotation(createSession(1, 's'), rect(10))).toThrow('take a screenshot first')
  })

  it('a new screenshot is the one annotated', () => {
    let session = drawn(10)
    let snapshot
    ;[session, snapshot] = takeSnapshot(session, capture(500))
    expect(snapshot).toMatchObject({ id: 'S2', annotations: [] })
    expect(session.current).toBe('S2')
    ;[session] = addAnnotation(session, rect(600))
    expect(session.snapshots.map((s) => s.annotations.map((a) => a.id))).toEqual([[1], [2]])
  })

  it('an older one can be annotated again, or left for the live page', () => {
    let [session] = takeSnapshot(drawn(10), capture())
    session = openSnapshot(session, 'S1')
    ;[session] = addAnnotation(session, rect(20))
    expect(currentSnapshot(session)?.annotations.map((a) => a.id)).toEqual([1, 2])
    expect(closeSnapshot(session).current).toBeUndefined()
    expect(() => openSnapshot(session, 'S9')).toThrow()
  })

  it('deleting the one annotated goes back to the live page', () => {
    expect(deleteSnapshot(drawn(10), 'S1')).toMatchObject({ snapshots: [] })
    expect(deleteSnapshot(drawn(10), 'S1').current).toBeUndefined()
  })
})

describe('annotation ids', () => {
  it('are never reused, after a delete or a new snapshot', () => {
    let session = deleteAnnotation(drawn(10, 20), 2)
    ;[session] = takeSnapshot(session, capture())
    expect(addAnnotation(session, rect(30))[1].id).toBe(3)
  })

  it('carry on from round to round', () => {
    let session = roundSent(queueRound(drawn(10), 'feedback', 'now'), '/p/.redline/rounds/001', 'now')
    ;[session] = takeSnapshot(session, capture())
    expect(addAnnotation(session, rect(10))[1].id).toBe(2)
    expect(session.snapshots[0]!.id).toBe('S2')
  })
})

describe('updateAnnotation', () => {
  it('changes a comment, or a color, in any snapshot', () => {
    let [session] = takeSnapshot(drawn(10), capture())
    ;[session] = addAnnotation(session, rect(20))
    session = updateAnnotation(updateAnnotation(session, 1, { comment: 'bigger' }), 2, { color: '#2563eb' })
    expect(session.snapshots[0]!.annotations[0]!.comment).toBe('bigger')
    expect(session.snapshots[1]!.annotations[0]!.color).toBe('#2563eb')
  })
})

describe('undo', () => {
  it('removes the last mark of the snapshot annotated', () => {
    expect(currentSnapshot(undo(drawn(10, 20)))?.annotations.map((a) => a.id)).toEqual([1])
    const [empty] = takeSnapshot(createSession(1, 's'), capture())
    expect(undo(empty)).toEqual(empty)
  })
})

describe('rounds', () => {
  it('are built from the session, with the screenshots', () => {
    const images = new Map([['S1', { clean: 'data:image/png;base64,AA', annotated: 'data:image/png;base64,BB' }]])
    const round = buildRound({ ...queueRound(drawn(10), 'feedback', 'now'), comment: 'tighter' }, images)
    expect(round).toMatchObject({ version: 2, sessionId: 'session-1', round: 1, status: 'feedback', comment: 'tighter' })
    expect(round.snapshots[0]!.images.annotated).toBe('data:image/png;base64,BB')
  })

  it('start the next one empty, on the live page', () => {
    const session = roundSent(queueRound({ ...drawn(10), comment: 'x' }, 'feedback', 'now'), '/d', 'later')
    expect(session).toMatchObject({ round: 2, snapshots: [], comment: '', active: true, lastSent: { round: 1, directory: '/d' } })
    expect(session.pending).toBeUndefined()
    expect(session.current).toBeUndefined()
  })

  it('end the session when done', () => {
    const session = roundSent(queueRound(drawn(), 'done', 'now'), '/d', 'later')
    expect(session.active).toBe(false)
    expect(session.lastSent?.status).toBe('done')
  })
})

describe('selectAnnotation', () => {
  it('selects a mark of any snapshot, and shows that snapshot', () => {
    let [session] = takeSnapshot(drawn(10), capture())
    session = selectAnnotation(session, 1)
    expect(session).toMatchObject({ current: 'S1', selected: 1 })
    expect(selectAnnotation(session, null).selected).toBeUndefined()
    expect(() => selectAnnotation(session, 9)).toThrow()
  })

  it('is lost with its mark, or when another snapshot shows', () => {
    const session = selectAnnotation(drawn(10, 20), 2)
    expect(deleteAnnotation(session, 2).selected).toBeUndefined()
    expect(deleteAnnotation(session, 1).selected).toBe(2)
    expect(takeSnapshot(session, capture())[0].selected).toBeUndefined()
    expect(closeSnapshot(session).selected).toBeUndefined()
  })
})

describe('tools', () => {
  it('start a screenshot with the pen, then with the drawing tool used last', () => {
    let [session] = takeSnapshot(createSession(1, 's'), capture())
    expect(session.tool).toBe('freehand')
    session = setTool(setTool(session, 'arrow'), 'select')
    expect(session).toMatchObject({ tool: 'select', drawingTool: 'arrow' })
    ;[session] = takeSnapshot(session, capture())
    expect(session.tool).toBe('arrow')
  })
})

describe('upgradeSession', () => {
  it('reads a session an earlier version stored', () => {
    const [current] = takeSnapshot(createSession(1, 's'), capture())
    const { device: _, drawingTool: __, ...old } = current
    const stored = {
      ...old,
      draft: [{ id: 9, kind: 'rect', color: '', comment: '', rect: { x: 0, y: 0, width: 1, height: 1 } }],
      snapshots: [
        {
          ...current.snapshots[0]!,
          annotations: [
            {
              id: 1,
              kind: 'freehand',
              color: '',
              comment: '',
              points: [
                { x: 1, y: 2 },
                { x: 3, y: 4 },
              ],
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof upgradeSession>[0]
    const session = upgradeSession(stored)
    expect(session).toMatchObject({ device: 'window', drawingTool: 'freehand' })
    expect('draft' in session).toBe(false)
    expect(session.snapshots[0]!.annotations[0]).toEqual({
      id: 1,
      kind: 'freehand',
      color: '',
      comment: '',
      strokes: [
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      ],
    })
  })

  it('leaves a session of this version as it is', () => {
    const session = drawn(10)
    expect(upgradeSession(session)).toEqual(session)
  })
})
