import { z } from 'zod'

// The contract between the extension and the bridge: what a round of feedback holds. A change
// here changes the bridge's writer (packages/bridge/src/writer.ts) and its tests with it.

// 2: a freehand mark has strokes, not points
export const SCHEMA_VERSION = 2

export const Point = z.object({ x: z.number(), y: z.number() })
export type Point = z.infer<typeof Point>

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
})
export type Rect = z.infer<typeof Rect>

// A step of the path to an element, from under <body> down to it: what names the element among
// its siblings and in the sources.
export const PathStep = z.object({
  tag: z.string(),
  id: z.string().optional(),
  // the first two that read like names, not generated ones
  classes: z.array(z.string()).optional(),
  // data-testid, data-test or data-cy
  testId: z.string().optional(),
  role: z.string().optional(),
  label: z.string().optional(),
  // its rank among its siblings of the same tag, and their number, when there are several
  nth: z.number().int().positive().optional(),
  of: z.number().int().positive().optional(),
  // the path goes on in its shadow root
  shadow: z.boolean().optional(),
})
export type PathStep = z.infer<typeof PathStep>

// What a framework knows of an element, in a development build: the components that rendered it,
// outermost first, and where its JSX is.
export const Rendered = z.object({
  framework: z.string(),
  components: z.array(z.string()),
  source: z.object({ file: z.string(), line: z.number().int(), column: z.number().int().optional() }).optional(),
})
export type Rendered = z.infer<typeof Rendered>

// the element under an annotation, for the agent to find it in the sources
export const Target = z.object({
  selector: z.string(),
  tag: z.string(),
  text: z.string(),
  path: z.array(PathStep).optional(),
  rendered: Rendered.optional(),
})
export type Target = z.infer<typeof Target>

// An annotation's id is unique in its session, and never reused: #7 is the same mark in every
// snapshot and every round of the session. Its coordinates are the page's (CSS pixels from the
// top left of the document), so it stays on its content when the page scrolls.
const annotationBase = {
  id: z.number().int().positive(),
  color: z.string(),
  comment: z.string(),
  target: Target.optional(),
  // the top left corner of its #id badge, where it hides the least (none: the usual place)
  badge: Point.optional(),
}

export const RectAnnotation = z.object({ ...annotationBase, kind: z.literal('rect'), rect: Rect })
// from where it starts to what it points at
export const ArrowAnnotation = z.object({ ...annotationBase, kind: z.literal('arrow'), from: Point, to: Point })
// its strokes: those drawn one soon after the other are one mark
export const FreehandAnnotation = z.object({ ...annotationBase, kind: z.literal('freehand'), strokes: z.array(z.array(Point).min(1)).min(1) })
export const Annotation = z.discriminatedUnion('kind', [RectAnnotation, ArrowAnnotation, FreehandAnnotation])
export type Annotation = z.infer<typeof Annotation>
export type AnnotationKind = Annotation['kind']

// the viewport when the snapshot was taken: its screenshot covers it, at dpr device pixels per CSS pixel
export const Viewport = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  dpr: z.number().positive(),
  scrollX: z.number(),
  scrollY: z.number(),
})
export type Viewport = z.infer<typeof Viewport>

export const SnapshotId = z.string().regex(/^S\d+$/)

export const Snapshot = z.object({
  id: SnapshotId,
  url: z.string(),
  title: z.string(),
  capturedAt: z.iso.datetime(),
  // the device the page was shown as, if not the window itself: its viewport is the device's
  device: z.string().optional(),
  viewport: Viewport,
  annotations: z.array(Annotation),
})
export type Snapshot = z.infer<typeof Snapshot>

const pngDataUrl = z.string().startsWith('data:image/png;base64,')

// a snapshot as sent: with its screenshots, without and with the annotations drawn on it
export const SnapshotWithImages = Snapshot.extend({
  images: z.object({ clean: pngDataUrl, annotated: pngDataUrl }),
})
export type SnapshotWithImages = z.infer<typeof SnapshotWithImages>

// 'done' ends the /redline loop: the agent stops waiting for another round
export const RoundStatus = z.enum(['feedback', 'done'])
export type RoundStatus = z.infer<typeof RoundStatus>

// the agent's reply to a round, shown in the sidebar until the next one is sent: what it did of each
// mark, and what it asks. `redline wait --reply` serves it.
export const Question = z.object({
  // Q1, Q2…
  id: z.string().min(1),
  text: z.string().min(1),
  // the mark it is about
  mark: z.number().int().positive().optional(),
})
export type Question = z.infer<typeof Question>

export const Reply = z.object({
  sessionId: z.string().min(1),
  // the round it replies to
  round: z.number().int().positive(),
  summary: z.string().optional(),
  marks: z.array(z.object({ id: z.number().int().positive(), text: z.string().min(1) })).optional(),
  questions: z.array(Question).optional(),
})
export type Reply = z.infer<typeof Reply>

// the user's answer to one of the reply's questions, with the question, for the agent to read together
export const Answer = z.object({ question: z.string(), text: z.string(), mark: z.number().int().positive().optional(), answer: z.string() })
export type Answer = z.infer<typeof Answer>

export const FeedbackRound = z.object({
  version: z.literal(SCHEMA_VERSION),
  sessionId: z.string().min(1),
  round: z.number().int().positive(),
  status: RoundStatus,
  comment: z.string(),
  answers: z.array(Answer).optional(),
  snapshots: z.array(SnapshotWithImages),
})
export type FeedbackRound = z.infer<typeof FeedbackRound>
