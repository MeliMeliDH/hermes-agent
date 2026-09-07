import type { GatewayEvent } from '@hermes/shared'
import { reconnectBackoffDelayMs } from '@hermes/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { HERMES_BASE_PATH } from './auth'
import { appendLocalMessage, applyMessageEvent, historyToBubbles, type MessageBubbleModel, type MessagePayload } from './chat-state'
import { filterSlashCommands, runComposerInput, type SlashCatalog, type SlashSuggestion } from './composer'
import { ChatGatewayClient } from './gateway'
import { displayNameForProfile, loadProfiles, type ProfileIdentity } from './identity'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import { isNearBottom } from './scroll-follow'
import { createSession, deleteSession, ensureSessionRuntime, openSession, type SessionRow } from './sessions'
import { loadSidebarCollapsed, persistSidebarCollapsed } from './sidebar-state'

interface SessionListResult {
  sessions?: SessionRow[]
}

type ConnectionState = 'connected' | 'connecting' | 'error'

// Static identity for the human side of the conversation. There is no
// gateway concept of a "user avatar" (profiles.get_asset only covers
// bot/agent profiles), so this ships as a bundled static asset rather than
// wiring up a new RPC surface for a single-user local deployment.
const USER_IDENTITY: ProfileIdentity = {
  avatar: `${HERMES_BASE_PATH}${import.meta.env.BASE_URL}user-avatar.png`,
  displayName: 'You',
  isDefault: false,
  name: 'you'
}

function sessionTitle(session: SessionRow): string {
  return session.title?.trim() || session.preview?.trim() || 'Untitled session'
}

function sessionTime(timestamp?: number): string {
  if (!timestamp) {return ''}

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp * 1000)
}

export function App() {
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [connectionMessage, setConnectionMessage] = useState('Connecting to the Hermes gateway…')
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [activeStoredId, setActiveStoredId] = useState<string | null>(null)
  const [activeRuntimeId, setActiveRuntimeId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageBubbleModel[]>([])
  const [profiles, setProfiles] = useState<Record<string, ProfileIdentity>>({})
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [turnRunning, setTurnRunning] = useState(false)
  const [slashSuggestions, setSlashSuggestions] = useState<SlashSuggestion[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed)
  const gatewayRef = useRef<ChatGatewayClient | null>(null)
  const runtimesRef = useRef(new Map<string, string>())
  const activeRuntimeRef = useRef<string | null>(null)
  const activeProfileRef = useRef('default')
  const openGenerationRef = useRef(0)
  const messageListRef = useRef<HTMLDivElement | null>(null)
  // Tracks whether the user is scrolled near the bottom, so new/streaming
  // messages auto-scroll only when they're already following along --
  // never yank the view while they're reading scrollback further up.
  const stickToBottomRef = useRef(true)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

  const showSession = useCallback(async (session: SessionRow, gateway = gatewayRef.current) => {
    if (!gateway) {return}
    const generation = ++openGenerationRef.current
    const profileName = session.profile || 'default'
    setActiveStoredId(session.id)
    activeRuntimeRef.current = null
    setActiveRuntimeId(null)
    activeProfileRef.current = profileName
    setLoadingHistory(true)
    setSessionError(null)
    stickToBottomRef.current = true
    setShowJumpToBottom(false)

    try {
      const opened = await openSession(gateway, session, runtimesRef.current.get(session.id))

      if (generation !== openGenerationRef.current) {return}

      if (opened.runtimeId) {
        runtimesRef.current.set(session.id, opened.runtimeId)
      }

      activeRuntimeRef.current = opened.runtimeId
      setActiveRuntimeId(opened.runtimeId)
      setMessages(historyToBubbles(opened.history.messages, profileName))
    } catch (error) {
      if (generation === openGenerationRef.current) {
        setSessionError(error instanceof Error ? error.message : 'Could not open session')
      }
    } finally {
      if (generation === openGenerationRef.current) {setLoadingHistory(false)}
    }
  }, [])

  const refreshSessions = useCallback(async (gateway = gatewayRef.current) => {
    if (!gateway) {return []}
    const result = await gateway.request<SessionListResult>('session.list', { limit: 200 })
    const next = result.sessions ?? []
    setSessions(next)

    return next
  }, [])

  useEffect(() => {
    let disposed = false
    let reconnectAttempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let disposeCurrent: (() => void) | undefined

    const connectOnce = () => {
      const gateway = new ChatGatewayClient({
        onDisconnect: () => {
          if (disposed) {return}
          setConnection('error')
          setConnectionMessage('Gateway disconnected — reconnecting…')
          reconnectAttempt += 1
          reconnectTimer = setTimeout(connectOnce, reconnectBackoffDelayMs(reconnectAttempt - 1))
        }
      })

      gatewayRef.current = gateway
      let active = true
      let readyReceived = false

      const unsubscribeReady = gateway.on('gateway.ready', () => { readyReceived = true })
      const messageTypes = ['message.start', 'message.delta', 'message.interim', 'message.complete'] as const

      const unsubscribeMessages = messageTypes.map(type => gateway.on(type, event => {
        const runtimeId = activeRuntimeRef.current

        if (!runtimeId || (event.session_id && event.session_id !== runtimeId)) {return}

        if (event.type === 'message.start') {setTurnRunning(true)}

        if (event.type === 'message.complete') {setTurnRunning(false)}
        setMessages(current => applyMessageEvent(current, event as GatewayEvent<MessagePayload>, activeProfileRef.current))
      }))

      const unsubscribeTitle = gateway.on('session.title', () => { void refreshSessions(gateway) })

      void gateway.connect().then(async () => {
        const [nextSessions, nextProfiles, commandCatalog] = await Promise.all([
          refreshSessions(gateway),
          loadProfiles(gateway),
          gateway.request<SlashCatalog>('commands.catalog', {})
        ])

        if (!active) {return}
        reconnectAttempt = 0
        setProfiles(nextProfiles)
        setSlashSuggestions(filterSlashCommands(commandCatalog))
        setConnection('connected')
        setConnectionMessage(`Live gateway connected · gateway.ready ${readyReceived ? 'received' : 'pending'} · ${nextSessions.length} sessions`)

        if (nextSessions[0]) {await showSession(nextSessions[0], gateway)}
      }).catch((error: unknown) => {
        if (!active) {return}
        setConnection('error')
        setConnectionMessage(error instanceof Error ? error.message : 'Gateway connection failed')
        reconnectAttempt += 1
        reconnectTimer = setTimeout(connectOnce, reconnectBackoffDelayMs(reconnectAttempt - 1))
      })

      disposeCurrent = () => {
        active = false
        unsubscribeReady()
        unsubscribeTitle()
        unsubscribeMessages.forEach(unsubscribe => unsubscribe())
        gateway.close()
      }
    }

    connectOnce()

    return () => {
      disposed = true
      openGenerationRef.current += 1
      clearTimeout(reconnectTimer)
      disposeCurrent?.()
      gatewayRef.current = null
    }
  }, [refreshSessions, showSession])

  const handleCreate = async () => {
    const gateway = gatewayRef.current

    if (!gateway) {return}
    setSessionError(null)

    try {
      const created = await createSession(gateway)
      const draft: SessionRow = { id: created.storedId, profile: 'default', started_at: Date.now() / 1000, title: 'New session' }
      runtimesRef.current.set(created.storedId, created.runtimeId)
      activeRuntimeRef.current = created.runtimeId
      activeProfileRef.current = 'default'
      setActiveRuntimeId(created.runtimeId)
      setActiveStoredId(created.storedId)
      setMessages([])
      setSessions(current => [draft, ...current.filter(row => row.id !== draft.id)])
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not create session')
    }
  }

  const handleDelete = async (session: SessionRow) => {
    const gateway = gatewayRef.current

    if (!gateway || !window.confirm(`Delete “${sessionTitle(session)}”? This cannot be undone.`)) {return}
    setSessionError(null)

    try {
      const runtimeId = runtimesRef.current.get(session.id)
      await deleteSession(gateway, session.id, runtimeId)
      runtimesRef.current.delete(session.id)
      const next = sessions.filter(row => row.id !== session.id)
      setSessions(next)

      if (activeStoredId === session.id) {
        activeRuntimeRef.current = null
        setActiveRuntimeId(null)
        setActiveStoredId(null)
        setMessages([])

        if (next[0]) {void showSession(next[0], gateway)}
      }
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not delete session')
    }
  }

  const handleInterrupt = async () => {
    const gateway = gatewayRef.current
    const runtimeId = activeRuntimeRef.current

    if (!gateway || !runtimeId) {return}

    try {
      await gateway.request('session.interrupt', { session_id: runtimeId })
      setTurnRunning(false)
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not stop response')
    }
  }

  const handleSubmit = async () => {
    const gateway = gatewayRef.current
    const input = draft.trim()

    if (!gateway || !activeStoredId || !input || turnRunning) {return}

    if (['/new', '/reset'].includes(input.toLowerCase())) {
      setDraft('')
      await handleCreate()

      return
    }

    if (['/stop', '/interrupt'].includes(input.toLowerCase())) {
      setDraft('')
      await handleInterrupt()

      return
    }

    const selectedSession = sessions.find(session => session.id === activeStoredId)

    if (!selectedSession) {return}

    let runtimeId = activeRuntimeRef.current

    if (!runtimeId) {
      const generation = openGenerationRef.current

      try {
        runtimeId = await ensureSessionRuntime(gateway, selectedSession)
        runtimesRef.current.set(selectedSession.id, runtimeId)

        if (generation !== openGenerationRef.current) {return}
        activeRuntimeRef.current = runtimeId
        setActiveRuntimeId(runtimeId)
      } catch (error) {
        setSessionError(error instanceof Error ? error.message : 'Could not resume session')

        return
      }
    }

    const plainPrompt = !input.startsWith('/')
    setDraft('')
    setSessionError(null)

    if (plainPrompt) {
      setMessages(current => appendLocalMessage(current, 'user', input))
      setTurnRunning(true)
    }

    try {
      const result = await runComposerInput(gateway, runtimeId, input)

      if (result.kind === 'submitted') {
        if (!plainPrompt) {setMessages(current => appendLocalMessage(current, 'user', result.displayText))}
        setTurnRunning(result.status === 'streaming')

        if (result.status !== 'streaming') {
          setMessages(current => appendLocalMessage(current, 'system', input, `Gateway status: ${result.status}`))
        }

        // The gateway bumps this session's last-active ordering server-side on
        // a real send; re-pull the list so the sidebar reflects it instead of
        // showing a stale snapshot from page-load/last-refresh time.
        void refreshSessions(gateway)
      } else if (result.kind === 'output') {
        setMessages(current => appendLocalMessage(current, 'system', input, result.text))
      } else {
        setDraft(result.text)
      }
    } catch (error) {
      setTurnRunning(false)
      const message = error instanceof Error ? error.message : 'Could not send message'
      setSessionError(message)
      setMessages(current => appendLocalMessage(current, 'system', input, `Error: ${message}`))
    }
  }

  const toggleSidebar = () => {
    setSidebarCollapsed(current => {
      const next = !current
      persistSidebarCollapsed(next)

      return next
    })
  }

  // Called on every scroll of the message list: a user actively reading
  // scrollback (not near the bottom) must never be auto-scrolled away from
  // what they're reading when a new message/streaming delta arrives.
  const handleMessageListScroll = () => {
    const el = messageListRef.current

    if (!el) {return}
    const nearBottom = isNearBottom({ clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop })

    stickToBottomRef.current = nearBottom
    setShowJumpToBottom(!nearBottom)
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = messageListRef.current

    if (!el) {return}
    el.scrollTo({ behavior, top: el.scrollHeight })
    stickToBottomRef.current = true
    setShowJumpToBottom(false)
  }

  useEffect(() => {
    if (stickToBottomRef.current) {
      // No smooth-scroll here: a streaming response fires this on every
      // delta, and animating each one fights itself -- jump instantly,
      // reserve the smooth behavior for the explicit jump-to-bottom click.
      scrollToBottom('instant')
    }
  }, [messages])

  const activeSession = sessions.find(session => session.id === activeStoredId)
  const slashQuery = draft.split(/\s/, 1)[0]?.toLowerCase() ?? ''

  const visibleSlashSuggestions = draft.startsWith('/')
    ? slashSuggestions.filter(item => item.command.toLowerCase().startsWith(slashQuery)).slice(0, 8)
    : []

  return (
    <main className="chat-shell" data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}>
      <aside className="session-sidebar" id="session-sidebar">
        <div className="sidebar-heading">
          <div>
            <p className="eyebrow">Hermes Chat</p>
            <h1>Sessions</h1>
          </div>
          <button aria-label="Create session" className="button button-primary new-session-button" disabled={connection !== 'connected'} onClick={() => void handleCreate()}>+</button>
        </div>
        <div aria-live="polite" className="connection-status" data-state={connection}>
          <span aria-hidden className="status-dot" />
          <span>{connectionMessage}</span>
        </div>
        <nav aria-label="Chat sessions" className="session-list">
          {sessions.map(session => (
            <button
              className="session-row"
              data-active={session.id === activeStoredId ? 'true' : 'false'}
              key={session.id}
              onClick={() => void showSession(session)}
              type="button"
            >
              <span className="session-copy">
                <strong>{sessionTitle(session)}</strong>
                <small>{session.preview || `${session.message_count ?? 0} messages`}</small>
              </span>
              <span className="session-actions">
                <time>{sessionTime(session.started_at)}</time>
                <span
                  aria-label={`Delete ${sessionTitle(session)}`}
                  className="delete-session"
                  onClick={event => { event.stopPropagation(); void handleDelete(session) }}
                  role="button"
                  tabIndex={0}
                >×</span>
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="conversation" data-runtime-session={activeRuntimeId ?? ''}>
        <header className="conversation-heading">
          <div className="conversation-title">
            <button
              aria-controls="session-sidebar"
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? 'Show sessions' : 'Hide sessions'}
              className="button sidebar-toggle"
              onClick={toggleSidebar}
              type="button"
            >{sidebarCollapsed ? '☰' : '←'}</button>
            <div>
              <p className="eyebrow">Conversation</p>
              <h2>{activeSession ? sessionTitle(activeSession) : 'Select a session'}</h2>
            </div>
          </div>
          {activeSession && <span className="profile-pill">{displayNameForProfile(activeSession.profile || 'default')}</span>}
        </header>

        {sessionError && <div className="session-error" role="alert">{sessionError}</div>}
        <div
          aria-busy={loadingHistory}
          aria-live="polite"
          className="message-list"
          onScroll={handleMessageListScroll}
          ref={messageListRef}
        >
          {loadingHistory ? (
            <div className="empty-state">Loading session history…</div>
          ) : messages.length ? (
            messages.map(message => (
              <MessageBubble
                identity={
                  message.role === 'user'
                    ? USER_IDENTITY
                    : message.profileName
                      ? profiles[message.profileName] ?? profiles[message.profileName.toLowerCase()]
                      : undefined
                }
                key={message.id}
                message={message}
              />
            ))
          ) : (
            <div className="empty-state">{activeSession ? 'No messages in this session yet.' : 'Choose a session to view its history.'}</div>
          )}
        </div>
        {showJumpToBottom && (
          <button
            aria-label="Jump to newest messages"
            className="button jump-to-bottom"
            onClick={() => scrollToBottom('smooth')}
            type="button"
          >↓ New messages</button>
        )}
        <MessageComposer
          busy={turnRunning}
          disabled={connection !== 'connected' || !activeStoredId || loadingHistory}
          draft={draft}
          onChange={setDraft}
          onInterrupt={() => void handleInterrupt()}
          onSubmit={() => void handleSubmit()}
          suggestions={visibleSlashSuggestions}
        />
      </section>
    </main>
  )
}
