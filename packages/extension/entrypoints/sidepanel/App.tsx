import { useEffect, useRef, useState } from 'preact/hooks'

import type { Annotation, Snapshot, Status } from '@redline/shared'

import { DEVICES, WINDOW } from '@/src/devices.ts'
import { badgeFor, fillPath } from '@/src/geometry.ts'
import { type Request, send } from '@/src/messages.ts'
import type { Session } from '@/src/state/session.ts'

import { type ActiveTab, useActiveTab, useBridge, useImage, useSession } from './hooks.ts'

// The sidebar: the snapshots of the active tab's session, their marks with a comment each, and
// the buttons that send the round to Claude. Whether Claude listens is at the bottom.

export function App() {
  const tab = useActiveTab()
  const session = useSession(tab?.id)
  const bridge = useBridge(Boolean(session?.pending))
  const [error, setError] = useState<string>()

  const ask = (request: Request) => {
    setError(undefined)
    return send(request).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
      return undefined
    })
  }

  const live = session && (session.active || session.pending) ? session : undefined
  return (
    <div class="app">
      <main>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        {!tab ? <p class="empty">No tab.</p> : live ? <SessionView tab={tab} session={live} ask={ask} /> : <Start tab={tab} session={session} ask={ask} />}
      </main>
      <StatusBar status={bridge} />
    </div>
  )
}

type Ask = (request: Request) => Promise<unknown>

function StatusBar({ status }: { status: Status | undefined }) {
  const project = status?.project.split('/').filter(Boolean).at(-1)
  return (
    <div class={`status ${status ? 'on' : ''}`} title={status ? `redline wait, in ${status.project}` : 'Run /redline in Claude Code'}>
      <span class="dot" />
      {status ? `Claude is listening${project ? ` · ${project}` : ''}` : 'Claude is not listening'}
    </div>
  )
}

function Help() {
  return (
    <div class="help">
      <p>
        <kbd>Ctrl</kbd>+<kbd>S</kbd> takes a screenshot of the page. Draw on it, then comment each mark as it is drawn.
      </p>
      <p>
        <kbd>1</kbd> select and move · <kbd>2</kbd> rectangle · <kbd>3</kbd> arrow · <kbd>4</kbd> pen
        <br />
        <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> colors · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Del</kbd> delete
      </p>
    </div>
  )
}

// the size the page is shown at, before a screenshot: phone, tablet… or the window itself
function DevicePicker({ tabId, session, ask, disabled }: { tabId: number; session: Session | undefined; ask: Ask; disabled?: boolean }) {
  return (
    <select
      class="device-picker"
      title="Show the page as a device"
      disabled={disabled}
      value={session?.active ? session.device : WINDOW}
      onChange={(e) => ask({ type: 'ui/set', tabId, device: e.currentTarget.value })}>
      <option value={WINDOW}>This window</option>
      {DEVICES.map((d) => (
        <option key={d.id} value={d.id}>
          {d.label} · {d.width}×{d.height}
        </option>
      ))}
    </select>
  )
}

function Start({ tab, session, ask }: { tab: ActiveTab; session: Session | undefined; ask: Ask }) {
  return (
    <div class="start">
      <p class="page" title={tab.url}>
        {tab.title || tab.url}
      </p>
      <div class="capture-row">
        <DevicePicker tabId={tab.id} session={session} ask={ask} />
        <button class="primary" onClick={() => ask({ type: 'snapshot/capture', tabId: tab.id })}>
          Take a screenshot
        </button>
      </div>
      {session?.lastSent?.status === 'done' && <p class="note">Finished: the last round went to {shortPath(session.lastSent.directory)}.</p>}
      <Help />
    </div>
  )
}

function SessionView({ tab, session, ask }: { tab: ActiveTab; session: Session; ask: Ask }) {
  const tabId = tab.id
  const locked = Boolean(session.pending)
  const marks = session.snapshots.reduce((n, s) => n + s.annotations.length, 0)
  const canSend = session.snapshots.length > 0 || session.comment.trim() !== ''

  return (
    <div class="session">
      <div class="capture capture-row">
        <DevicePicker tabId={tabId} session={session} ask={ask} disabled={locked} />
        <button
          class="primary"
          disabled={locked}
          onClick={() => ask({ type: 'snapshot/capture', tabId })}
          title="A screenshot of the page, to annotate (Ctrl+S)">
          Take a screenshot
        </button>
      </div>

      {session.snapshots.length === 0 && <Help />}
      {session.snapshots.map((snapshot) => (
        <SnapshotView key={snapshot.id} tabId={tabId} session={session} snapshot={snapshot} ask={ask} disabled={locked} />
      ))}

      <footer>
        <CommentBox
          value={session.comment}
          placeholder={`A comment on round ${session.round} as a whole`}
          disabled={locked}
          onSave={(comment) => ask({ type: 'comment/set', tabId, comment })}
        />
        <Outbox session={session} ask={ask} />
        <div class="actions">
          <button class="primary" disabled={locked || !canSend} onClick={() => ask({ type: 'round/submit', tabId, status: 'feedback' })}>
            Send to Claude{marks ? ` (${marks} mark${marks === 1 ? '' : 's'})` : ''}
          </button>
          <button
            disabled={locked}
            onClick={() => ask({ type: 'round/submit', tabId, status: 'done' })}
            title="Send this round, if any, and tell Claude you are finished">
            Done
          </button>
        </div>
      </footer>
    </div>
  )
}

function Outbox({ session, ask }: { session: Session; ask: Ask }) {
  if (session.pending?.error)
    return (
      <p class="error">
        {session.pending.error}{' '}
        <button class="link" onClick={() => ask({ type: 'outbox/flush' })}>
          Retry
        </button>
      </p>
    )
  if (session.pending)
    return (
      <p class="note waiting">
        Round {session.round} is ready{session.pending.status === 'done' ? ', the last one' : ''}: it goes to Claude as soon as <code>/redline</code> waits for
        it.
      </p>
    )
  if (session.lastSent)
    return (
      <p class="note sent">
        Round {session.lastSent.round} sent: {shortPath(session.lastSent.directory)}
      </p>
    )
  return null
}

function SnapshotView({ tabId, session, snapshot, ask, disabled }: { tabId: number; session: Session; snapshot: Snapshot; ask: Ask; disabled: boolean }) {
  const current = session.current === snapshot.id
  const time = new Date(snapshot.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // the newest mark, scrolled to as it is drawn
  const last = snapshot.annotations.at(-1)?.id
  return (
    <section class={current ? 'current' : ''}>
      <div class="section-head">
        <h2>
          {snapshot.id} <span class="meta">{[snapshot.device, time].filter(Boolean).join(' · ')}</span>
        </h2>
        <div class="tools">
          {current ? (
            <button onClick={() => ask({ type: 'snapshot/close', tabId })} title="Leave the screenshot, back to the live page">
              Back to page
            </button>
          ) : (
            <button
              disabled={disabled}
              onClick={() => ask({ type: 'snapshot/open', tabId, snapshotId: snapshot.id })}
              title="Show it on the page, to draw more">
              Annotate
            </button>
          )}
          <button
            class="icon"
            disabled={disabled}
            title={`Delete ${snapshot.id}`}
            onClick={() => ask({ type: 'snapshot/delete', tabId, snapshotId: snapshot.id })}>
            ×
          </button>
        </div>
      </div>
      <Preview
        session={session}
        snapshot={snapshot}
        onClick={disabled || current ? undefined : () => ask({ type: 'snapshot/open', tabId, snapshotId: snapshot.id })}
      />
      {snapshot.annotations.length === 0 ? (
        <p class="empty">{current ? 'Draw on the screenshot, on the page.' : 'No marks.'}</p>
      ) : (
        <ul class="marks">
          {snapshot.annotations.map((a) => (
            <Mark
              key={a.id}
              tabId={tabId}
              annotation={a}
              ask={ask}
              disabled={disabled}
              current={current}
              newest={a.id === last}
              selected={a.id === session.selected}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

// the screenshot, with its marks drawn over it as the overlay draws them
function Preview({ session, snapshot, onClick }: { session: Session; snapshot: Snapshot; onClick?: () => void }) {
  const image = useImage(session.id, snapshot.id)
  const { width, height, scrollX, scrollY } = snapshot.viewport
  return (
    <div class={`thumb ${onClick ? 'clickable' : ''}`} onClick={onClick} title={onClick ? 'Annotate this screenshot' : undefined}>
      <svg viewBox={`0 0 ${width} ${height}`}>
        {image && <image href={image} width={width} height={height} />}
        <g transform={`translate(${-scrollX} ${-scrollY})`}>
          {snapshot.annotations.map((a) => {
            const badge = badgeFor(a)
            return (
              <g key={a.id}>
                {a.kind === 'rect' ? (
                  <rect x={a.rect.x} y={a.rect.y} width={a.rect.width} height={a.rect.height} fill="none" stroke={a.color} stroke-width={3} />
                ) : (
                  <path d={fillPath(a)} fill={a.color} />
                )}
                <rect x={badge.x} y={badge.y} width={badge.width} height={badge.height} rx={badge.height / 2} fill={a.color} stroke="#fff" stroke-width={1.5} />
                <text x={badge.x + badge.width / 2} y={badge.y + badge.height / 2 + 0.5} class="badge-label">
                  {badge.label}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

function Mark({
  tabId,
  annotation,
  ask,
  disabled,
  current,
  newest,
  selected,
}: {
  tabId: number
  annotation: Annotation
  ask: Ask
  disabled: boolean
  current: boolean
  newest: boolean
  selected: boolean
}) {
  const item = useRef<HTMLLIElement>(null)
  // the newest mark as it is drawn, and the one selected on the page, come into view
  useEffect(() => {
    if ((newest && current) || selected) item.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [newest, current, selected])
  // the marks of the screenshot on the page, to show it where the pointer is
  const highlight = (id: number | null) => {
    if (current) void browser.tabs.sendMessage(tabId, { type: 'highlight', id }).catch(() => undefined)
  }
  return (
    <li
      ref={item}
      class={`mark ${selected ? 'selected' : ''}`}
      onMouseEnter={() => highlight(annotation.id)}
      onMouseLeave={() => highlight(null)}
      // selected here, it is selected on the page, its snapshot shown
      onClick={() => !selected && !disabled && ask({ type: 'annotation/select', tabId, id: annotation.id })}
      // its comment, all of it selected, to type over it
      onDblClick={() => {
        const area = item.current?.querySelector('textarea')
        area?.focus()
        area?.select()
      }}>
      <span class="badge" style={{ background: annotation.color }}>
        #{annotation.id}
      </span>
      <div class="body">
        <span class="kind">
          {KINDS[annotation.kind]}
          {annotation.target && <code title={annotation.target.selector}> {annotation.target.selector}</code>}
        </span>
        <CommentBox
          value={annotation.comment}
          placeholder="What should change here?"
          disabled={disabled}
          onSave={(comment) => ask({ type: 'annotation/update', tabId, id: annotation.id, patch: { comment } })}
        />
      </div>
      <button
        class="icon"
        disabled={disabled}
        title={`Delete #${annotation.id}`}
        onClick={(e) => {
          e.stopPropagation()
          void ask({ type: 'annotation/delete', tabId, id: annotation.id })
        }}>
        ×
      </button>
    </li>
  )
}

const KINDS = { rect: 'Rectangle', arrow: 'Arrow', freehand: 'Freehand' } as const

const SAVE_MS = 400

// A comment saved as it is typed, a moment after the last key; what comes back from storage does
// not overwrite what is being typed.
function CommentBox({ value, placeholder, disabled, onSave }: { value: string; placeholder: string; disabled: boolean; onSave: (value: string) => unknown }) {
  const [text, setText] = useState(value)
  const editing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing.current) setText(value)
  }, [value])
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [text])

  const save = (next: string) => {
    clearTimeout(timer.current)
    if (next !== value) onSave(next)
  }
  return (
    <textarea
      ref={area}
      rows={1}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => (editing.current = true)}
      onBlur={() => {
        editing.current = false
        save(text)
      }}
      onInput={(e) => {
        const next = e.currentTarget.value
        setText(next)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => save(next), SAVE_MS)
      }}
    />
  )
}

function shortPath(path: string): string {
  const parts = path.split('/')
  const at = parts.lastIndexOf('.redline')
  return at > 0 ? parts.slice(at).join('/') : path
}
