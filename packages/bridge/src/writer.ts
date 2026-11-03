import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

import {
  type Annotation,
  type FeedbackRound,
  type PathStep,
  type Rendered,
  type Snapshot,
  type SnapshotWithImages,
  boundingBox,
  commonPrefix,
  pathText,
} from '@redline/shared'

// A round on disk, in .redline/rounds/NNN/: feedback.md for the agent (and a human) to read first,
// feedback.json with all of it, and the screenshots of each snapshot, S1.annotated.png and
// S1.clean.png. NNN counts the rounds of the project, whatever their session. They show what the
// page showed, so they are the user's only: 0700 and 0600 (Windows ignores the modes).

export interface WrittenRound {
  directory: string
  feedback: string
  annotations: number
}

const PRIVATE = { mode: 0o600 }

// PROJECT: the directory the sources are in, which their paths are written from; CHANNEL: the
// the agent session's (src/channels.ts)
export async function writeRound(root: string, round: FeedbackRound, project?: string, channel?: string): Promise<WrittenRound> {
  const rounds = join(root, 'rounds')
  await mkdir(rounds, { recursive: true, mode: 0o700 })
  const directory = await nextRoundDirectory(rounds)

  const json: FeedbackRound = { ...round, snapshots: round.snapshots.map((s) => ({ ...s, images: imageFiles(s) })) }
  await Promise.all([
    ...round.snapshots.flatMap((s) => [
      writeFile(join(directory, imageFiles(s).clean), decodePng(s.images.clean), PRIVATE),
      writeFile(join(directory, imageFiles(s).annotated), decodePng(s.images.annotated), PRIVATE),
    ]),
    writeFile(join(directory, 'feedback.json'), JSON.stringify(json, null, 2) + '\n', PRIVATE),
    writeFile(join(directory, 'feedback.md'), renderFeedback(round, project, channel), PRIVATE),
  ])

  return {
    directory,
    feedback: join(directory, 'feedback.md'),
    annotations: round.snapshots.reduce((n, s) => n + s.annotations.length, 0),
  }
}

// the first free NNN after the highest one there; mkdir fails rather than share a directory
async function nextRoundDirectory(rounds: string): Promise<string> {
  const taken = (await readdir(rounds)).map((name) => Number.parseInt(name, 10)).filter(Number.isFinite)
  for (let n = Math.max(0, ...taken) + 1; ; n++) {
    const directory = join(rounds, String(n).padStart(3, '0'))
    try {
      await mkdir(directory, { mode: 0o700 })
      return directory
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

function imageFiles(snapshot: Pick<Snapshot, 'id'>) {
  return { clean: `${snapshot.id}.clean.png`, annotated: `${snapshot.id}.annotated.png` }
}

function decodePng(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
}

// What the page tells (its title, its URL, its elements' selectors, text and components) is written
// on one line, and in code with a fence longer than any run of backticks in it: a page cannot write
// a line of its own in feedback.md, such as a status or a heading.
export function renderFeedback(round: FeedbackRound, project?: string, channel?: string): string {
  const lines: string[] = []
  lines.push(`# Redline feedback: round ${round.round}`, '')
  if (channel) lines.push(`- Channel: ${code(channel)}`)
  lines.push(`- Session: ${code(round.sessionId)}`)
  lines.push(
    round.status === 'done'
      ? '- Status: **done**. The user is finished: apply this last feedback, if any, and stop waiting for rounds.'
      : '- Status: **feedback**. Apply it, reload the page, and wait for the next round.'
  )
  lines.push(`- Snapshots: ${round.snapshots.length}, annotations: ${round.snapshots.reduce((n, s) => n + s.annotations.length, 0)}`)
  lines.push('')
  if (round.comment.trim()) lines.push('## General comment', '', quote(round.comment), '')
  const answers = (round.answers ?? []).filter((a) => a.answer.trim())
  if (answers.length) {
    lines.push('## Answers to your questions', '')
    for (const a of answers) lines.push(`- **${a.question}**${a.mark ? ` (about #${a.mark})` : ''}: ${oneLine(a.text, 200)}`, '', quote(a.answer, '  '), '')
  }

  for (const snapshot of round.snapshots) lines.push(...renderSnapshot(snapshot, project))

  if (round.snapshots.length > 0) {
    lines.push(
      '---',
      '',
      'Coordinates are CSS pixels of the screenshot, from its top left corner; a screenshot pixel is `dpr` times smaller.',
      "Each `#id` is drawn next to its mark on the annotated screenshot, and is the same mark in every snapshot of the session. The selector is the element under the mark's center, or under an arrow's tip.",
      ''
    )
  }
  return lines.join('\n')
}

function renderSnapshot(snapshot: SnapshotWithImages | Snapshot, project: string | undefined): string[] {
  const { viewport: v } = snapshot
  const files = imageFiles(snapshot)
  const lines = [
    `## ${snapshot.id}: ${oneLine(snapshot.title, 200) || '(untitled)'}`,
    '',
    `- URL: ${oneLine(snapshot.url, 2000)}`,
    `- Screenshot: \`${files.annotated}\` (without the annotations: \`${files.clean}\`)`,
    `- Viewport: ${v.width}×${v.height} CSS px${snapshot.device ? `, as a ${oneLine(snapshot.device, 80)}` : ''}, dpr ${Number(v.dpr.toFixed(2))}, scrolled to (${Math.round(v.scrollX)}, ${Math.round(v.scrollY)})`,
    '',
  ]
  // what the marks' paths begin with, written once
  const paths = snapshot.annotations.flatMap((a) => (a.target?.path?.length ? [a.target.path] : []))
  const prefix = paths.length > 1 ? commonPrefix(paths) : []
  const common = prefix.length >= MIN_COMMON ? prefix : []
  if (common.length) lines.splice(lines.length - 1, 0, `- Common path of its marks: ${code(pathText(common))}`)
  if (snapshot.annotations.length === 0) lines.push('No annotations.', '')
  for (const annotation of snapshot.annotations) lines.push(renderAnnotation(annotation, snapshot, common, project), '')
  return lines
}

// fewer steps in common than this are written in full in each path
const MIN_COMMON = 2

function renderAnnotation(annotation: Annotation, snapshot: Snapshot, common: PathStep[], project: string | undefined): string {
  // in the screenshot: the page's coordinates, less the scroll it was taken at
  const at = (p: { x: number; y: number }) => `(${Math.round(p.x - snapshot.viewport.scrollX)}, ${Math.round(p.y - snapshot.viewport.scrollY)})`
  let where: string
  if (annotation.kind === 'arrow') where = `arrow from ${at(annotation.from)} pointing at ${at(annotation.to)}`
  else {
    const box = boundingBox(annotation)
    where = `${annotation.kind === 'rect' ? 'rectangle' : 'freehand mark'} at ${at(box)}, ${Math.round(box.width)}×${Math.round(box.height)}`
  }
  const target = annotation.target ? ` on ${code(annotation.target.selector)}${annotation.target.text ? ` "${oneLine(annotation.target.text, 60)}"` : ''}` : ''
  const comment = annotation.comment.trim() ? `\n\n${quote(annotation.comment, '  ')}` : ' (no comment)'
  const rendered = renderRendered(annotation.target?.rendered, project)
  return `- **#${annotation.id}** ${where}${target}${renderPath(annotation.target?.path, common)}${rendered}${comment}`
}

// the path from under <body>, after the common path of the snapshot's marks when there is one
function renderPath(path: PathStep[] | undefined, common: PathStep[]): string {
  if (!path?.length) return ''
  if (!common.length) return `\n  - Path: ${code(pathText(path))}`
  const rest = path.slice(common.length)
  return `\n  - Path: ${code(rest.length ? `… > ${pathText(rest)}` : '… (the common path)')}`
}

// the components that rendered the element, its framework's name first, and where its JSX is, from
// the project when it is in it
const MAX_COMPONENTS = 5

function renderRendered(rendered: Rendered | undefined, project: string | undefined): string {
  if (!rendered) return ''
  const name = oneLine(rendered.framework, 40)
  const framework = name.charAt(0).toUpperCase() + name.slice(1)
  const names = rendered.components.length > MAX_COMPONENTS ? ['…', ...rendered.components.slice(-MAX_COMPONENTS)] : rendered.components
  const parts = names.length ? [code(names.join(' › '))] : []
  if (rendered.source) {
    const { file, line, column } = rendered.source
    parts.push(`its JSX at ${code(`${fromProject(file, project)}:${line}${column !== undefined ? `:${column}` : ''}`)}`)
  }
  return parts.length ? `\n  - ${framework}: ${parts.join(', ')}` : ''
}

// a source under the project, from it: on Windows too, whichever slashes the bundler wrote
function fromProject(file: string, project: string | undefined): string {
  if (!project) return file
  const path = relative(project, file)
  return path && !path.startsWith('..') && !isAbsolute(path) ? path.replaceAll('\\', '/') : file
}

// inline code, on one line, whatever backticks it holds
function code(text: string): string {
  const flat = oneLine(text, 500)
  const fence = '`'.repeat(Math.max(0, ...Array.from(flat.matchAll(/`+/g), (m) => m[0].length)) + 1)
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${flat}${pad}${fence}`
}

function quote(text: string, indent = ''): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `${indent}> ${line}`.trimEnd())
    .join('\n')
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
