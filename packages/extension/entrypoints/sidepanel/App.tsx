import { Fragment } from 'preact'
import { useEffect, useErrorBoundary, useRef, useState } from 'preact/hooks'

import type { Annotation, Reply, Snapshot } from '@redline/shared'

import { DEVICES, WINDOW } from '@/src/devices.ts'
import { RECT_STROKE, badgeFor, fillPath } from '@/src/geometry.ts'
import { type Request, send } from '@/src/messages.ts'
import { type Session, hasFeedback, submitStatus } from '@/src/state/session.ts'

import { type ActiveTab, type Listening, useActiveTab, useImage, useListening, useSession } from './hooks.ts'

// The sidebar: the snapshots of the active tab's session, their marks with a comment each, and
// the buttons that send the round to the agent. Whether the agent listens is at the bottom.

export function App() {
  const tab = useActiveTab()
  const session = useSession(tab?.id)
  const listening = useListening(tab, session)
  const bridge = listening.bridge?.status
  // the agent's reply to this session's last round, as the bridge serves it: kept in the session
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
            <SessionView tab={tab} session={live} ask={ask} listening={listening} />
          </Guard>
        ) : (
          <Start tab={tab} session={session} ask={ask} listening={listening} />
        )}
      </main>
      <StatusBar tab={tab} session={session} listening={listening} ask={ask} />
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

// the channel the tab is bound to, while its session goes on
function boundChannel(session: Session | undefined): string | undefined {
  return session && session.lastSent?.status !== 'done' ? session.channel : undefined
}

// The agent of the tab, as its wait names it (`--agent`): the one listening, or the one it is
// bound to, at work; "your agent" when none says.
function agentOf(listening: Listening, session: Session | undefined): string {
  return listening.bridge?.status.agent ?? (boundChannel(session) ? session?.agent : undefined) ?? 'your agent'
}

function capitalized(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function baseName(path: string): string | undefined {
  return path.split(/[\\/]/).filter(Boolean).at(-1)
}

// Whether the agent of the tab listens, and which: its channel's name, and its project. With
// several agents for the page's app, the one the tab sends its rounds to, to pick another.
function StatusBar({ tab, session, listening, ask }: { tab: ActiveTab | undefined; session: Session | undefined; listening: Listening; ask: Ask }) {
  const status = listening.bridge?.status
  const bound = boundChannel(session)
  const project = status && baseName(status.project)
  const agent = capitalized(agentOf(listening, session))
  const text = status
    ? `${agent} is listening · ${status.channel}${project ? ` · ${project}` : ''}`
    : bound
      ? `${agent} · ${bound} is at work: the next round waits for it`
      : 'No agent is listening'
  const choices = [
    ...new Map([...(bound ? [[bound, ''] as const] : []), ...listening.candidates.map((b) => [b.status.channel, baseName(b.status.project) ?? ''] as const)]),
  ]
  return (
    <div class={`status ${status ? 'on' : ''}`} title={status ? `redline wait, in ${status.project}` : 'Ask your agent to review the page (/redline)'}>
      <span class="dot" />
      <span class="status-text">{text}</span>
      {tab && session && choices.length > 1 && (
        <select
          class="channel-picker"
          title="The agent this tab sends its rounds to"
          value={bound ?? status?.channel}
          onChange={(e) => {
            const channel = e.currentTarget.value
            const agent = listening.candidates.find((b) => b.status.channel === channel)?.status.agent
            void ask({ type: 'session/bind', tabId: tab.id, channel, ...(agent && { agent }) })
          }}>
          {choices.map(([channel, project]) => (
            <option key={channel} value={channel}>
              {channel}
              {project && ` · ${project}`}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

// the keys, one per row: a key's names are joined by +, keys side by side are alternatives
// the shortcuts that need the agent listening: a screenshot is for it, a round goes to it
const FOR_CLAUDE = new Set(['Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+D', 'Alt+Shift+S', 'Alt+Shift+D'])

const SHORTCUTS: [string[][], string][] = [
  [[['Ctrl', 'S']], 'Take a screenshot of the live page, to draw on; on a screenshot, back to the live page'],
  [[['Ctrl', 'Shift', 'S']], 'A screenshot with an open dropdown: share the browser’s window, then open it during the countdown'],
  [
    [
      ['Alt', 'Shift', 'S'],
      ['Alt', 'Shift', 'D'],
    ],
    'Ctrl+S and Ctrl+D, with the focus anywhere in the browser',
  ],
  [[['1']], 'Select and move a mark'],
  [[['2']], 'Rectangle'],
  [[['3']], 'Arrow, from its start to what it points at'],
  [[['4']], 'Pen; strokes close in time make one mark'],
  [[['Q'], ['W'], ['E'], ['R']], 'Colors, by place: the row under 1 to 4'],
  [[['Ctrl', 'Z']], 'Undo the last mark'],
  [[['Ctrl', 'D']], 'Send the round to your agent; Done when there is nothing to send'],
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
                  <span key={i} class={combo.length > 1 ? 'combo chord' : 'combo'}>
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

// The agent not listening for this page: nothing to take a screenshot for. Why, when it can be told:
// its agent is at work, another page is the one listened for, or the browser is not paired.
function NotListening({ session, listening, ask }: { session: Session | undefined; listening: Listening; ask: Ask }) {
  const bound = boundChannel(session)
  const agent = capitalized(agentOf(listening, session))
  // never paired, and a redline listens: the pairing first
  if (!listening.paired && listening.unpaired) return <PairBox ask={ask} />
  const elsewhere = [...new Set(listening.all.flatMap((b) => (b.status.url ? [b.status.url] : [])))]
  return (
    <>
      <p class="note not-listening">
        {bound ? (
          <>
            {agent} ({bound}) is at work on the last round: the next screenshot can be taken once it listens again.
          </>
        ) : elsewhere.length ? (
          <>
            Your agent is listening for {elsewhere.join(', ')}, not this page. Ask it to review this one (<code>/redline</code>).
          </>
        ) : (
          <>
            No agent is listening for this page. Ask yours to review it (<code>/redline</code>).
          </>
        )}
      </p>
      {/* paired, but a redline refuses the token: another user's, an older one, or the token was made anew */}
      {listening.unpaired && !listening.all.length && <PairBox ask={ask} again />}
    </>
  )
}

// A `redline wait` answered, but the browser does not know the user's token: from the native host
// once `redline install` ran, or pasted here.
function PairBox({ ask, again }: { ask: Ask; again?: boolean }) {
  const [token, setToken] = useState('')
  return (
    <div class="note pair">
      {again ? (
        <p>
          A <code>redline wait</code> listens that does not know this browser's token: another user's, or one of yours older than the token. If it is yours,
          paste what <code>redline token</code> prints:
        </p>
      ) : (
        <p>
          A <code>redline wait</code> listens, but this browser is not paired with you. Run <code>redline install</code> once and restart the browser, or paste
          what <code>redline token</code> prints:
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask({ type: 'pair/set', token }).then(() => setToken(''))
        }}>
        <input type="password" autocomplete="off" placeholder="Your token" value={token} onInput={(e) => setToken(e.currentTarget.value)} />
        <button class="primary" type="submit" disabled={!token.trim()}>
          Pair
        </button>
      </form>
    </div>
  )
}

function Start({ tab, session, ask, listening: found }: { tab: ActiveTab; session: Session | undefined; ask: Ask; listening: Listening }) {
  const listening = Boolean(found.bridge)
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
        <NotListening session={session} listening={found} ask={ask} />
      )}
      {session?.lastSent?.status === 'done' && <p class="note">Finished: the last round went to {shortPath(session.lastSent.directory)}.</p>}
      {listening && <Help listening />}
    </div>
  )
}

function SessionView({ tab, session, ask, listening: found }: { tab: ActiveTab; session: Session; ask: Ask; listening: Listening }) {
  const listening = Boolean(found.bridge)
  const agent = agentOf(found, session)
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
          <NotListening session={session} listening={found} ask={ask} />
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

      {session.snapshots.length === 0 && !session.reply && <Help listening={listening} />}
      {session.snapshots.map((snapshot) => (
        <SnapshotView
          key={snapshot.id}
          tabId={tabId}
          session={session}
          snapshot={snapshot}
          ask={ask}
          disabled={locked}
          newest={snapshot.id === session.snapshots.at(-1)?.id}
        />
      ))}

      <footer>
        <CommentBox
          value={session.comment}
          placeholder={`A comment on round ${session.round} as a whole`}
          disabled={locked}
          onSave={(comment) => ask({ type: 'comment/set', tabId, comment })}
        />
        <Outbox session={session} agent={agent} ask={ask} />
        {/* by the button that sends the round: its answers go with it, and its last word is read before */}
        {session.reply && <ReplyView tabId={tabId} session={session} reply={session.reply} agent={agent} ask={ask} disabled={locked} />}
        <div class="actions">
          <button class="primary" disabled={locked || !canSend} title="Ctrl+D" onClick={() => ask({ type: 'round/submit', tabId, status: 'feedback' })}>
            Send to {agent}
            {marks ? ` (${marks} mark${marks === 1 ? '' : 's'})` : ''}
          </button>
          <button
            disabled={locked}
            onClick={() => ask({ type: 'round/submit', tabId, status: 'done' })}
            title={`Send this round, if any, and tell ${agent} you are finished`}>
            Done
          </button>
        </div>
      </footer>
    </div>
  )
}

// What the agent did of the last round's marks, and what it asks: an answer to each question goes
// with the next round.
function ReplyView({
  tabId,
  session,
  reply,
  agent,
  ask,
  disabled,
}: {
  tabId: number
  session: Session
  reply: Reply
  agent: string
  ask: Ask
  disabled: boolean
}) {
  return (
    <section class="reply">
      <h2>
        {capitalized(agent)}, on round {reply.round}
      </h2>
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

function Outbox({ session, agent, ask }: { session: Session; agent: string; ask: Ask }) {
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
        Round {session.round} is ready{session.pending.status === 'done' ? ', the last one' : ''}: it goes to {agent} as soon as it waits for it.
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

function SnapshotView({
  tabId,
  session,
  snapshot,
  ask,
  disabled,
  newest,
}: {
  tabId: number
  session: Session
  snapshot: Snapshot
  ask: Ask
  disabled: boolean
  newest: boolean
}) {
  const current = session.current === snapshot.id
  const time = new Date(snapshot.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // the newest mark, scrolled to as it is drawn
  const last = snapshot.annotations.at(-1)?.id
  const section = useRef<HTMLElement>(null)
  // the newest screenshot comes into view as it is taken, and as the sidebar opens, with what is
  // under it as far as it fits: the button that sends the round
  useEffect(() => {
    if (newest) section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [newest])
  return (
    <section ref={section} class={current ? 'current' : ''}>
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
  // The newest mark as it is drawn comes into view with what is under it, as far as it fits: the
  // button that sends the round. The one selected on the page, just into view.
  useEffect(() => {
    if (newest && current) item.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    else if (selected) item.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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
