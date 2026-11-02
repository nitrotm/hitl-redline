import { Fragment } from 'preact'
import { useEffect, useErrorBoundary, useRef, useState } from 'preact/hooks'

import type { Annotation, Reply, Snapshot, Status } from '@redline/shared'

import { DEVICES, WINDOW } from '@/src/devices.ts'
import { RECT_STROKE, badgeFor, fillPath } from '@/src/geometry.ts'
import { type Request, send } from '@/src/messages.ts'
import { type Session, hasFeedback, submitStatus } from '@/src/state/session.ts'

import { type ActiveTab, useActiveTab, useBridge, useImage, useSession } from './hooks.ts'

// The sidebar: the snapshots of the active tab's session, their marks with a comment each, and
// the buttons that send the round to Claude. Whether Claude listens is at the bottom.

export function App() {
  const tab = useActiveTab()
  const session = useSession(tab?.id)
  const bridge = useBridge(tab?.url, session?.id, Boolean(session?.pending))
  // Claude's reply to this session's last round, as the bridge serves it: kept in the session
  const reply = bridge?.reply
  useEffect(() => {
    if (tab && session && reply && reply.sessionId === session.id && reply.round === session.lastSent?.round && session.reply?.round !== reply.round)
      void send({ type: 'reply/store', tabId: tab.id, reply }).catch(() => undefined)
  }, [tab?.id, session?.id, session?.lastSent?.round, session?.reply?.round, reply?.sessionId, reply?.round])
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
        {!tab ? (
          <p class="empty">No tab.</p>
        ) : live ? (
          <Guard tab={tab} ask={ask}>
            <SessionView tab={tab} session={live} ask={ask} listening={Boolean(bridge)} />
          </Guard>
        ) : (
          <Start tab={tab} session={session} ask={ask} listening={Boolean(bridge)} />
        )}
      </main>
      <StatusBar status={bridge} />
    </div>
  )
}

type Ask = (request: Request) => Promise<unknown>

// What fails to show the session shows as an error, with a way out, rather than an empty sidebar.
function Guard({ tab, ask, children }: { tab: ActiveTab; ask: Ask; children: preact.ComponentChildren }) {
  const [error, reset] = useErrorBoundary()
  if (!error) return <>{children}</>
  return (
    <div class="start">
      <p class="error" role="alert">
        The session cannot be shown: {error instanceof Error ? error.message : String(error)}
      </p>
      <button
        onClick={async () => {
          await ask({ type: 'session/discard', tabId: tab.id })
          reset()
        }}>
        Discard this session
      </button>
    </div>
  )
}

function StatusBar({ status }: { status: Status | undefined }) {
  const project = status?.project.split('/').filter(Boolean).at(-1)
  return (
    <div class={`status ${status ? 'on' : ''}`} title={status ? `redline wait, in ${status.project}` : 'Run /redline in Claude Code'}>
      <span class="dot" />
      {status ? `Claude is listening${project ? ` · ${project}` : ''}` : 'Claude is not listening'}
    </div>
  )
}

// the keys, one per row: a key's names are joined by +, keys side by side are alternatives
// the shortcuts that need Claude listening: a screenshot is for it, a round goes to it
const FOR_CLAUDE = new Set(['Ctrl+S', 'Ctrl+D'])

const SHORTCUTS: [string[][], string][] = [
  [[['Ctrl', 'S']], 'Take a screenshot of the live page, to draw on; on a screenshot, back to the live page'],
  [[['1']], 'Select and move a mark'],
  [[['2']], 'Rectangle'],
  [[['3']], 'Arrow, from its start to what it points at'],
  [[['4']], 'Pen; strokes close in time make one mark'],
  [[['Q'], ['W'], ['E'], ['R']], 'Colors, by place: the row under 1 to 4'],
  [[['Ctrl', 'Z']], 'Undo the last mark'],
  [[['Ctrl', 'D']], 'Send to Claude; Done when there is nothing to send'],
  [[['Del']], 'Delete the selected mark'],
  [[['Double-click']], "Edit a mark's comment"],
  [[['Enter'], ['Esc']], 'Save, close the comment'],
  [[['Alt', 'Shift', 'R']], 'Turn Redline on or off'],
]

function Help({ listening }: { listening: boolean }) {
  const shortcuts = listening ? SHORTCUTS : SHORTCUTS.filter(([keys]) => !keys.some((combo) => FOR_CLAUDE.has(combo.join('+'))))
  return (
    <div class="help">
      {listening && <p>Take a screenshot, draw on it, and comment each mark as you draw it.</p>}
      <table class="shortcuts">
        <tbody>
          {shortcuts.map(([keys, what]) => (
            <tr key={what}>
              <td>
                {keys.map((combo, i) => (
                  <span key={i} class="combo">
                    {combo.map((key, j) => (
                      <Fragment key={key}>
                        {j > 0 && '+'}
                        <kbd>{key}</kbd>
                      </Fragment>
                    ))}
                  </span>
                ))}
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

// Claude not listening for this page: nothing to take a screenshot for
function NotListening() {
  return (
    <p class="note not-listening">
      Claude is not listening for this page. Start <code>/redline</code> in Claude Code to review it.
    </p>
  )
}

function Start({ tab, session, ask, listening }: { tab: ActiveTab; session: Session | undefined; ask: Ask; listening: boolean }) {
  return (
    <div class="start">
      <p class="page" title={tab.url}>
        {tab.title || tab.url}
      </p>
      {listening ? (
        <div class="capture-row">
          <DevicePicker tabId={tab.id} session={session} ask={ask} />
          <button class="primary" onClick={() => ask({ type: 'snapshot/capture', tabId: tab.id })}>
            Take a screenshot
          </button>
        </div>
      ) : (
        <NotListening />
      )}
      {session?.lastSent?.status === 'done' && <p class="note">Finished: the last round went to {shortPath(session.lastSent.directory)}.</p>}
      {listening && <Help listening />}
    </div>
  )
}

function SessionView({ tab, session, ask, listening }: { tab: ActiveTab; session: Session; ask: Ask; listening: boolean }) {
  const tabId = tab.id
  const locked = Boolean(session.pending)
  const marks = session.snapshots.reduce((n, s) => n + s.annotations.length, 0)
  const canSend = hasFeedback(session)
  // Ctrl+D, as on the page: the round, or Done when there is nothing to send
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'd') return
      e.preventDefault()
      if (!locked) {
        // the comment being typed first: it saves as it loses the focus
        ;(document.activeElement as HTMLElement | null)?.blur()
        void ask({ type: 'round/submit', tabId, status: submitStatus(session) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div class="session">
      {/* a screenshot is of the live page: while one is annotated, the way back to it */}
      {session.current ? (
        <p class="capture note">
          Annotating {session.current}. Click its preview again (or Ctrl+S, or ✕ on the page) to go back to the page, and take another.
        </p>
      ) : !listening ? (
        <div class="capture">
          <NotListening />
        </div>
      ) : (
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
      )}

      {session.reply && <ReplyView tabId={tabId} session={session} reply={session.reply} ask={ask} disabled={locked} />}
      {session.snapshots.length === 0 && !session.reply && <Help listening={listening} />}
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
          <button class="primary" disabled={locked || !canSend} title="Ctrl+D" onClick={() => ask({ type: 'round/submit', tabId, status: 'feedback' })}>
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

// What Claude did of the last round's marks, and what it asks: an answer to each question goes
// with the next round.
function ReplyView({ tabId, session, reply, ask, disabled }: { tabId: number; session: Session; reply: Reply; ask: Ask; disabled: boolean }) {
  return (
    <section class="reply">
      <h2>Claude, on round {reply.round}</h2>
      {reply.summary && <p class="summary">{reply.summary}</p>}
      {reply.marks?.length ? (
        <ul class="reply-marks">
          {reply.marks.map((m) => (
            <li key={m.id}>
              <span class="badge plain">#{m.id}</span> {m.text}
            </li>
          ))}
        </ul>
      ) : null}
      {reply.questions?.map((q) => (
        <div key={q.id} class="question">
          <p>
            <strong>{q.id}</strong>
            {q.mark && <span class="meta"> about #{q.mark}</span>} {q.text}
          </p>
          <CommentBox
            value={session.answers?.[q.id] ?? ''}
            placeholder="Your answer"
            disabled={disabled}
            onSave={(answer) => ask({ type: 'answer/set', tabId, question: q.id, answer })}
          />
        </div>
      ))}
    </section>
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
          {current && <span class="annotating"> annotating</span>}
        </h2>
        <div class="tools">
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
        current={current}
        // a toggle: shown on the page to annotate it, or back to the live page
        onClick={disabled ? undefined : () => ask(current ? { type: 'snapshot/close', tabId } : { type: 'snapshot/open', tabId, snapshotId: snapshot.id })}
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
function Preview({ session, snapshot, current, onClick }: { session: Session; snapshot: Snapshot; current: boolean; onClick?: () => void }) {
  const image = useImage(session.id, snapshot.id)
  const { width, height, scrollX, scrollY } = snapshot.viewport
  return (
    <div
      class={`thumb ${onClick ? 'clickable' : ''} ${current ? 'on' : ''}`}
      onClick={onClick}
      title={onClick ? (current ? 'Back to the live page' : 'Annotate this screenshot, on the page') : undefined}>
      <svg viewBox={`0 0 ${width} ${height}`}>
        {image && <image href={image} width={width} height={height} />}
        <g transform={`translate(${-scrollX} ${-scrollY})`}>
          {snapshot.annotations.map((a) => {
            const badge = badgeFor(a)
            return (
              <g key={a.id}>
                {a.kind === 'rect' ? (
                  <rect x={a.rect.x} y={a.rect.y} width={a.rect.width} height={a.rect.height} fill="none" stroke={a.color} stroke-width={RECT_STROKE} />
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
      // a click on the row's own fields (its comment, its delete) leaves the selection be
      onClick={(e) => {
        if (disabled || (e.target as Element).closest('textarea, button')) return
        void ask({ type: 'annotation/select', tabId, id: selected ? null : annotation.id })
      }}
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
          {/* the components that rendered it, the innermost, when the page's framework says; its selector otherwise */}
          {annotation.target?.rendered?.components.length ? (
            <code title={annotation.target.rendered.components.join(' › ')}> {annotation.target.rendered.components.slice(-2).join(' › ')}</code>
          ) : (
            annotation.target && <code title={annotation.target.selector}> {annotation.target.selector}</code>
          )}
        </span>
        <CommentBox
          value={annotation.comment}
          placeholder="What should change here?"
          disabled={disabled}
          onSave={(comment) => ask({ type: 'annotation/update', tabId, id: annotation.id, patch: { comment } })}
        />
      </div>
      {/* deleted only while its screenshot is the one annotated, shown on the page */}
      {current && (
        <button
          class="icon trash"
          disabled={disabled}
          title={`Delete #${annotation.id}`}
          onClick={(e) => {
            e.stopPropagation()
            void ask({ type: 'annotation/delete', tabId, id: annotation.id })
          }}>
          <TrashIcon />
        </button>
      )}
    </li>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
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
