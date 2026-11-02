import { useEffect, useRef, useState } from 'preact/hooks'

import type { Annotation, Snapshot, Status } from '@redline/shared'

import { type Request, send } from '@/src/messages.ts'
import type { Session } from '@/src/state/session.ts'

import { type ActiveTab, useActiveTab, useBridge, useImages, useSession } from './hooks.ts'

// The sidebar: the marks of the active tab's session, a comment for each, by snapshot, and the
// buttons that send the round to Claude.

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

  return (
    <div class="app">
      <header>
        <h1>Redline</h1>
        <BridgeDot status={bridge} />
      </header>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {!tab ? (
        <p class="empty">No tab.</p>
      ) : session && (session.active || session.pending) ? (
        <SessionView tab={tab} session={session} ask={ask} />
      ) : (
        <Start tab={tab} session={session} ask={ask} />
      )}
    </div>
  )
}

type Ask = (request: Request) => Promise<unknown>

function BridgeDot({ status }: { status: Status | undefined }) {
  const project = status?.project.split('/').filter(Boolean).at(-1)
  return (
    <span class={`bridge ${status ? 'on' : ''}`} title={status ? `redline wait, in ${status.project}` : 'Run /redline in Claude Code'}>
      <span class="dot" />
      {status ? `Claude is listening${project ? ` · ${project}` : ''}` : 'Claude is not listening'}
    </span>
  )
}

function Start({ tab, session, ask }: { tab: ActiveTab; session: Session | undefined; ask: Ask }) {
  const resumable = session && session.lastSent?.status !== 'done'
  return (
    <div class="start">
      <p class="page" title={tab.url}>
        {tab.title || tab.url}
      </p>
      <button class="primary" onClick={() => ask({ type: 'session/start', tabId: tab.id })}>
        {resumable ? 'Resume annotating' : 'Annotate this page'}
      </button>
      {session?.lastSent?.status === 'done' && <p class="note">Finished: the last round went to {shortPath(session.lastSent.directory)}.</p>}
      {resumable && (
        <button class="link" onClick={() => ask({ type: 'session/discard', tabId: tab.id })}>
          Discard the session
        </button>
      )}
      <p class="help">
        Draw rectangles (<kbd>R</kbd>) or freehand marks (<kbd>P</kbd>), comment each one here, capture snapshots (<kbd>C</kbd>), and send them to Claude. Turn
        it on or off with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>.
      </p>
    </div>
  )
}

function SessionView({ tab, session, ask }: { tab: ActiveTab; session: Session; ask: Ask }) {
  const tabId = tab.id
  const locked = Boolean(session.pending)
  const [notice, setNotice] = useState<string>()

  const capture = async () => {
    setNotice(undefined)
    const result = (await ask({ type: 'snapshot/capture', tabId })) as { snapshotId: string; left: number } | undefined
    if (result?.left)
      setNotice(
        `${result.left} mark${result.left === 1 ? ' is' : 's are'} outside the view: scroll to ${result.left === 1 ? 'it' : 'them'}, and capture again.`
      )
  }
  const canSend = session.snapshots.length > 0 || session.comment.trim() !== ''

  return (
    <div class="session">
      <section>
        <div class="section-head">
          <h2>On the page</h2>
          <button onClick={capture} disabled={locked} title="Capture the visible page with its marks (C)">
            Capture snapshot
          </button>
        </div>
        {session.draft.length === 0 ? (
          <p class="empty">Draw on the page: a rectangle (R) or a freehand mark (P).</p>
        ) : (
          <ul class="marks">
            {session.draft.map((a) => (
              <Mark key={a.id} tabId={tabId} annotation={a} ask={ask} disabled={false} />
            ))}
          </ul>
        )}
        {notice && <p class="note">{notice}</p>}
      </section>

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
            Send to Claude
          </button>
          <button
            disabled={locked}
            onClick={() => ask({ type: 'round/submit', tabId, status: 'done' })}
            title="Send this round, if any, and tell Claude you are finished">
            Done
          </button>
        </div>
        {session.draft.length > 0 && session.snapshots.length > 0 && !locked && (
          <p class="note">
            {session.draft.length} mark{session.draft.length === 1 ? ' is' : 's are'} not captured: {session.draft.length === 1 ? 'it stays' : 'they stay'} on
            the page.
          </p>
        )}
        <div class="secondary">
          <button class="link" onClick={() => ask({ type: session.active ? 'session/stop' : 'session/start', tabId })}>
            {session.active ? 'Hide the overlay' : 'Show the overlay'}
          </button>
          <button class="link" onClick={() => confirm('Discard every mark and snapshot of this session?') && ask({ type: 'session/discard', tabId })}>
            Discard
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
  const images = useImages(session.id, snapshot.id)
  const time = new Date(snapshot.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <section>
      <div class="section-head">
        <h2>
          {snapshot.id} <span class="meta">{time}</span>
        </h2>
        <button
          class="icon"
          disabled={disabled}
          title={`Delete ${snapshot.id}`}
          onClick={() => ask({ type: 'snapshot/delete', tabId, snapshotId: snapshot.id })}>
          ×
        </button>
      </div>
      {images && (
        <a class="thumb" href={images.annotated} target="_blank" rel="noreferrer" title="Open the screenshot">
          <img src={images.annotated} alt={`${snapshot.id}, annotated`} />
        </a>
      )}
      {snapshot.annotations.length === 0 ? (
        <p class="empty">No marks: the screenshot alone.</p>
      ) : (
        <ul class="marks">
          {snapshot.annotations.map((a) => (
            <Mark key={a.id} tabId={tabId} annotation={a} ask={ask} disabled={disabled} captured />
          ))}
        </ul>
      )}
    </section>
  )
}

function Mark({ tabId, annotation, ask, disabled, captured }: { tabId: number; annotation: Annotation; ask: Ask; disabled: boolean; captured?: boolean }) {
  // the drafts are on the page, to show it where the pointer is
  const highlight = (id: number | null) => {
    if (!captured) void browser.tabs.sendMessage(tabId, { type: 'highlight', id }).catch(() => undefined)
  }
  return (
    <li class="mark" onMouseEnter={() => highlight(annotation.id)} onMouseLeave={() => highlight(null)}>
      <span class="badge" style={{ background: annotation.color }}>
        #{annotation.id}
      </span>
      <div class="body">
        <span class="kind">
          {annotation.kind === 'rect' ? 'Rectangle' : 'Freehand'}
          {annotation.target && <code title={annotation.target.selector}> {annotation.target.selector}</code>}
        </span>
        <CommentBox
          value={annotation.comment}
          placeholder="What should change here?"
          disabled={disabled}
          onSave={(comment) => ask({ type: 'annotation/update', tabId, id: annotation.id, patch: { comment } })}
        />
      </div>
      <button class="icon" disabled={disabled} title={`Delete #${annotation.id}`} onClick={() => ask({ type: 'annotation/delete', tabId, id: annotation.id })}>
        ×
      </button>
    </li>
  )
}

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
