import type { GatewayEvent } from '@hermes/shared'
import { reconnectBackoffDelayMs } from '@hermes/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createSelectedAttachments, filesFromDrop, releaseAttachmentPreviews, type SelectedAttachment, uploadAndSubmitAttachments } from './attachments'
import { HERMES_BASE_PATH } from './auth'
import { appendLocalMessage, applyInputRequestEvent, applyInputRequestExpireEvent, applyMessageEvent, applyReasoningEvent, applyToolEvent, buildReplyPrefixedText, groupToolSteps, historyToBubbles, type InputRequestExpirePayload, type InputRequestModel, type InputRequestPayload, type InputResponse, type MessageBubbleModel, type MessagePayload, type ReasoningPayload, type ReplyReference, resolveInputRequest, type ToolPayload, turnJustCompleted } from './chat-state'
import { filterSlashCommands, runComposerInput, type SlashCatalog, type SlashSuggestion } from './composer'
import { createGatewayConnectionLifecycle } from './connection-lifecycle'
import { ChatGatewayClient } from './gateway'
import { HubLink } from './HubLink'
import { displayNameForProfile, loadProfiles, type ProfileIdentity } from './identity'
import { respondToInputRequest } from './input-requests'
import { MessageBubble, ToolStepGroup } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import { IMMEDIATE_SCROLL_BEHAVIOR, isNearBottom, resolveScrollFollowState, scheduleAfterLayout, scheduleFollowAfterLayout, watchContentResizeForFollow, watchViewportForFollow } from './scroll-follow'
import { resultSessionId, resultTitle, searchSessions, type SessionSearchResult } from './session-search'
import { createSession, deleteSession, ensureSessionRuntime, loadLastSessionId, openSession, persistLastSessionId, selectReconnectSession, selectSessionAfterDelete, type SessionRow } from './sessions'
import { isCompactChatViewport, loadSidebarCollapsed, persistSidebarCollapsed } from './sidebar-state'

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

// Extracted for unit testing: a dragenter/dragleave depth counter rather than
// a naive enter/leave boolean, because entering a CHILD element fires a
// leave on the parent first -- a plain flag would flicker false while still
// dragging over the window. Pure so it's testable without a live DOM.
export function nextDragDepth(current: number, delta: 1 | -1): number {
  return Math.max(0, current + delta)
}

export function App() {
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [connectionMessage, setConnectionMessage] = useState('Connecting to the Hermes gateway…')
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [activeStoredId, setActiveStoredId] = useState<string | null>(null)
  const [activeRuntimeId, setActiveRuntimeId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageBubbleModel[]>([])
  const [profiles, setProfiles] = useState<Record<string, ProfileIdentity>>({})
  // #87: profile picker for new sessions + model verification banner.
  const [newSessionProfile, setNewSessionProfile] = useState('default')
  const [newSessionPickerOpen, setNewSessionPickerOpen] = useState(false)
  const [sessionModelInfo, setSessionModelInfo] = useState<Record<string, { model?: string; profileName?: string }>>({})
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [selectedAttachments, setSelectedAttachments] = useState<SelectedAttachment[]>([])
  const [turnRunning, setTurnRunning] = useState(false)
  const previousTurnRunningRef = useRef(false)
  const [turnJustCompletedFlash, setTurnJustCompletedFlash] = useState(false)
  const [slashSuggestions, setSlashSuggestions] = useState<SlashSuggestion[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed)
  const [windowDragActive, setWindowDragActive] = useState(false)
  const windowDragDepthRef = useRef(0)
  const [replyTarget, setReplyTarget] = useState<{ id: string; reference: ReplyReference } | undefined>()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SessionSearchResult[]>([])
  const [searchStatus, setSearchStatus] = useState<'error' | 'idle' | 'loading'>('idle')
  const searchGenerationRef = useRef(0)
  const gatewayRef = useRef<ChatGatewayClient | null>(null)
  const activeStoredRef = useRef<string | null>(loadLastSessionId())
  const sessionsRef = useRef<SessionRow[]>([])
  const attachmentPreviewsRef = useRef(new Set<string>())
  const runtimesRef = useRef(new Map<string, string>())
  const activeRuntimeRef = useRef<string | null>(null)
  const activeProfileRef = useRef('default')
  const extraProfilesRef = useRef(new Set<string>())
  const openGenerationRef = useRef(0)
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const messageContentRef = useRef<HTMLDivElement | null>(null)
  const userScrollIntentRef = useRef(false)
  // Tracks whether the user is scrolled near the bottom, so new/streaming
  // messages auto-scroll only when they're already following along --
  // never yank the view while they're reading scrollback further up.
  const stickToBottomRef = useRef(true)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

  const releasePreviews = () => {
    releaseAttachmentPreviews(Array.from(attachmentPreviewsRef.current, previewUrl => ({ previewUrl })))
    attachmentPreviewsRef.current.clear()
  }

  const showSession = useCallback(async (
    session: SessionRow,
    gateway = gatewayRef.current,
    preserveAttachments = false
  ) => {
    if (!gateway) {return}

    if (isCompactChatViewport(window.innerWidth)) {
      setSidebarCollapsed(true)
      persistSidebarCollapsed(true)
    }

    const generation = ++openGenerationRef.current
    const profileName = session.profile || 'default'
    setActiveStoredId(session.id)
    activeStoredRef.current = session.id
    persistLastSessionId(session.id)
    activeRuntimeRef.current = null
    setActiveRuntimeId(null)
    activeProfileRef.current = profileName
    setLoadingHistory(true)
    setSessionError(null)

    if (!preserveAttachments) {
      releasePreviews()
      setSelectedAttachments([])
    }

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
      const historyMessages = historyToBubbles(opened.history.messages, profileName)
      setMessages(opened.pendingInputRequests.reduce(
        (current, event) => applyInputRequestEvent(current, event),
        historyMessages
      ))
    } catch (error) {
      if (generation === openGenerationRef.current) {
        setSessionError(error instanceof Error ? error.message : 'Could not open session')
      }
    } finally {
      if (generation === openGenerationRef.current) {setLoadingHistory(false)}
    }
  }, [])

  const handleInputResponse = useCallback(async (request: InputRequestModel, response: InputResponse) => {
    const gateway = gatewayRef.current
    const runtimeId = activeRuntimeRef.current

    if (!gateway || !runtimeId) {return}

    try {
      await respondToInputRequest(gateway, request, response, runtimeId)
      setSessionError(null)
      setMessages(current => resolveInputRequest(current, request.requestId, response))
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not send response')
    }
  }, [])

  const refreshSessions = useCallback(async (gateway = gatewayRef.current) => {
    if (!gateway) {return []}
    // #87: merge in any non-default profile the picker has actually created a session under this tab
    // (extraProfilesRef), so switching to e.g. `ollamaworker` doesn't vanish from the sidebar on the next
    // periodic refresh — session.list is profile-scoped server-side, same as session.create/resume.
    const extraProfiles = [...extraProfilesRef.current].filter(profile => profile && profile !== 'default')
    const [defaultResult, ...extraResults] = await Promise.all([
      gateway.request<SessionListResult>('session.list', { limit: 200 }),
      ...extraProfiles.map(profile => gateway.request<SessionListResult>('session.list', { limit: 200, profile }))
    ])
    const merged = new Map<string, SessionRow>()
    for (const row of [...(defaultResult.sessions ?? []), ...extraResults.flatMap(r => r.sessions ?? [])]) {
      merged.set(row.id, row)
    }
    const next = [...merged.values()].sort((first, second) => (second.started_at ?? 0) - (first.started_at ?? 0))
    sessionsRef.current = next
    setSessions(next)

    return next
  }, [])

  useEffect(() => {
    let disposed = false
    let readyReceived = false

    const lifecycle = createGatewayConnectionLifecycle({
      createClient: onDisconnect => new ChatGatewayClient({ onDisconnect }),
      onConnected: async (gateway, reconnected) => {
        const [nextSessions, nextProfiles, commandCatalog] = await Promise.all([
          refreshSessions(gateway), loadProfiles(gateway), gateway.request<SlashCatalog>('commands.catalog', {})
        ])

        if (disposed) {return}
        setProfiles(nextProfiles)
        setSlashSuggestions(filterSlashCommands(commandCatalog))
        setConnection('connected')
        setConnectionMessage(`Live gateway connected · gateway.ready ${readyReceived ? 'received' : 'pending'} · ${nextSessions.length} sessions`)

        const previousStoredId = activeStoredRef.current
        const selected = selectReconnectSession(nextSessions, previousStoredId)

        if (!selected) {
          activeStoredRef.current = null
          activeRuntimeRef.current = null
          setActiveStoredId(null)
          setActiveRuntimeId(null)
          setMessages([])

          return
        }

        if (!reconnected || selected.id !== previousStoredId) {
          await showSession(selected, gateway)

          return
        }

        const runtimeId = runtimesRef.current.get(selected.id)

        if (!runtimeId) {return}

        try {
          await gateway.request('session.activate', { omit_messages: true, session_id: runtimeId })
          activeRuntimeRef.current = runtimeId
          setActiveRuntimeId(runtimeId)
        } catch {
          runtimesRef.current.delete(selected.id)
          activeRuntimeRef.current = null
          setActiveRuntimeId(null)
          setTurnRunning(false)
          await showSession(selected, gateway, true)
        }
      },
      onConnecting: () => {
        setConnection('connecting')
        setConnectionMessage('Connecting to the Hermes gateway…')
      },
      onDisconnected: () => {
        setConnection('error')
        setConnectionMessage('Gateway disconnected — reconnecting…')
      },
      onError: error => {
        if (disposed) {return}
        setConnection('error')
        setConnectionMessage(error.message || 'Gateway connection failed')
      },
      reconnectDelayMs: reconnectBackoffDelayMs
    })

    const gateway = lifecycle.client
    gatewayRef.current = gateway

    const unsubscribeReady = gateway.on('gateway.ready', () => { readyReceived = true })
    const messageTypes = ['message.start', 'message.delta', 'message.interim', 'message.complete'] as const

    const unsubscribeMessages = messageTypes.map(type => gateway.on(type, event => {
      const runtimeId = activeRuntimeRef.current

      if (!runtimeId || (event.session_id && event.session_id !== runtimeId)) {return}

      if (event.type === 'message.start') {setTurnRunning(true)}

      if (event.type === 'message.complete') {setTurnRunning(false)}
      setMessages(current => applyMessageEvent(current, event as GatewayEvent<MessagePayload>, activeProfileRef.current))
    }))

    const toolTypes = ['tool.start', 'tool.progress', 'tool.complete'] as const

    const unsubscribeTools = toolTypes.map(type => gateway.on(type, event => {
      const runtimeId = activeRuntimeRef.current

      if (!runtimeId || (event.session_id && event.session_id !== runtimeId)) {return}
      setMessages(current => applyToolEvent(current, event as GatewayEvent<ToolPayload>, undefined, activeProfileRef.current))
    }))

    const reasoningTypes = ['thinking.delta', 'reasoning.delta', 'reasoning.available'] as const

    const unsubscribeReasoning = reasoningTypes.map(type => gateway.on(type, event => {
      const runtimeId = activeRuntimeRef.current

      if (!runtimeId || (event.session_id && event.session_id !== runtimeId)) {return}
      setMessages(current => applyReasoningEvent(current, event as GatewayEvent<ReasoningPayload>, activeProfileRef.current))
    }))

    const inputTypes = ['clarify.request', 'approval.request'] as const

    const unsubscribeInput = inputTypes.map(type => gateway.on(type, event => {
      const runtimeId = activeRuntimeRef.current

      if (!runtimeId || (event.session_id && event.session_id !== runtimeId)) {return}
      setMessages(current => applyInputRequestEvent(current, event as GatewayEvent<InputRequestPayload>, undefined, activeProfileRef.current))
    }))

    const unsubscribeInputExpire = gateway.on('clarify.expire', event => {
      const runtimeId = activeRuntimeRef.current

      if (!runtimeId || (event.session_id && event.session_id !== runtimeId)) {return}
      setMessages(current => applyInputRequestExpireEvent(current, event as GatewayEvent<InputRequestExpirePayload>))
    })

    const unsubscribeTitle = gateway.on('session.title', () => { void refreshSessions(gateway) })
    void lifecycle.start()

    return () => {
      disposed = true
      openGenerationRef.current += 1
      unsubscribeReady()
      unsubscribeTitle()
      unsubscribeMessages.forEach(unsubscribe => unsubscribe())
      unsubscribeTools.forEach(unsubscribe => unsubscribe())
      unsubscribeReasoning.forEach(unsubscribe => unsubscribe())
      unsubscribeInput.forEach(unsubscribe => unsubscribe())
      unsubscribeInputExpire()
      lifecycle.dispose()
      gatewayRef.current = null
      releasePreviews()
    }
  }, [refreshSessions, showSession])

  const handleCreate = async (profileOverride?: string) => {
    const gateway = gatewayRef.current

    if (!gateway) {return}
    setSessionError(null)

    const profile = profileOverride ?? newSessionProfile

    if (profile && profile !== 'default') {extraProfilesRef.current.add(profile)}

    try {
      const created = await createSession(gateway, profile)
      const draft: SessionRow = { id: created.storedId, profile, started_at: Date.now() / 1000, title: 'New session' }
      runtimesRef.current.set(created.storedId, created.runtimeId)
      activeRuntimeRef.current = created.runtimeId
      activeProfileRef.current = profile
      setActiveRuntimeId(created.runtimeId)
      setActiveStoredId(created.storedId)
      activeStoredRef.current = created.storedId
      persistLastSessionId(created.storedId)
      // Server-verified model/provider (session.create's own resolved info, not model self-report) —
      // shown as a banner so switching profiles is confirmed, the way Discord's /new confirms it.
      if (created.info?.model) {
        setSessionModelInfo(current => ({
          ...current,
          [created.storedId]: { model: created.info!.model, profileName: created.info!.profile_name }
        }))
      }
      releasePreviews()
      setSelectedAttachments([])
      setMessages([])
      setNewSessionPickerOpen(false)
      setSessions(current => {
        const next = [draft, ...current.filter(row => row.id !== draft.id)]
        sessionsRef.current = next

        return next
      })

      if (isCompactChatViewport(window.innerWidth)) {
        setSidebarCollapsed(true)
        persistSidebarCollapsed(true)
      }
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
      const deleted = selectSessionAfterDelete(sessionsRef.current, session.id, activeStoredRef.current)
      sessionsRef.current = deleted.remaining
      setSessions(deleted.remaining)

      if (deleted.next) {
        activeRuntimeRef.current = null
        activeStoredRef.current = null
        setActiveRuntimeId(null)
        setActiveStoredId(null)
        setMessages([])
        void showSession(deleted.next, gateway)
      } else if (activeStoredRef.current === session.id) {
        activeRuntimeRef.current = null
        activeStoredRef.current = null
        setActiveRuntimeId(null)
        setActiveStoredId(null)
        setMessages([])
      }
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not delete session')
    }
  }

  // Debounced cross-session search: fires 250ms after the user stops typing,
  // discards results from a stale/superseded request via a generation
  // counter (avoids a slow earlier search overwriting a faster later one).
  useEffect(() => {
    const query = searchQuery.trim()

    if (!query) {
      setSearchResults([])
      setSearchStatus('idle')

      return
    }

    const generation = ++searchGenerationRef.current
    setSearchStatus('loading')

    const timer = setTimeout(() => {
      void searchSessions(query).then(results => {
        if (generation !== searchGenerationRef.current) {return}
        setSearchResults(results)
        setSearchStatus('idle')
      }).catch(() => {
        if (generation !== searchGenerationRef.current) {return}
        setSearchResults([])
        setSearchStatus('error')
      })
    }, 250)

    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleSearchResultClick = (result: SessionSearchResult) => {
    const sessionId = resultSessionId(result)

    if (!sessionId) {
      setSearchQuery('')
      setSearchResults([])

      return
    }

    // The matched session may not be in the currently-loaded sidebar list
    // (200-row cap, or an older/archived session) -- fall back to a minimal
    // SessionRow built from the search result rather than silently no-oping.
    const target: SessionRow = sessionsRef.current.find(session => session.id === sessionId) ?? {
      id: sessionId,
      message_count: result.message_count,
      preview: result.preview,
      started_at: result.started_at,
      title: result.title
    }

    void showSession(target)
    setSearchQuery('')
    setSearchResults([])
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

  const handleAttachments = (files: File[]) => {
    const selected = createSelectedAttachments(files)

    if (selected.attachments.length > 0) {
      selected.attachments.forEach(attachment => {
        if (attachment.previewUrl) {attachmentPreviewsRef.current.add(attachment.previewUrl)}
      })
      setSelectedAttachments(current => [...current, ...selected.attachments])
    }

    setSessionError(selected.errors.length > 0 ? selected.errors.join(' ') : null)
  }

  // Global drag-and-drop: a file can be dropped anywhere in the window, not
  // just the composer's own small drop target (matching Discord). Uses a
  // dragenter/dragleave depth counter rather than a naive enter/leave pair --
  // entering a CHILD element fires a leave on the parent first, so a plain
  // boolean flag flickers/false-clears while still dragging over the window.
  useEffect(() => {
    const isFileDrag = (event: globalThis.DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'))

    const handleWindowDragEnter = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) {return}
      event.preventDefault()
      windowDragDepthRef.current = nextDragDepth(windowDragDepthRef.current, 1)
      setWindowDragActive(true)
    }

    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) {return}
      event.preventDefault()
    }

    const handleWindowDragLeave = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) {return}
      windowDragDepthRef.current = nextDragDepth(windowDragDepthRef.current, -1)

      if (windowDragDepthRef.current === 0) {setWindowDragActive(false)}
    }

    const handleWindowDrop = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) {return}
      event.preventDefault()
      windowDragDepthRef.current = 0
      setWindowDragActive(false)

      if (turnRunning || connection !== 'connected' || !activeStoredId) {return}
      const files = filesFromDrop(event.dataTransfer ?? undefined)

      if (files.length > 0) {handleAttachments(files)}
    }

    window.addEventListener('dragenter', handleWindowDragEnter)
    window.addEventListener('dragover', handleWindowDragOver)
    window.addEventListener('dragleave', handleWindowDragLeave)
    window.addEventListener('drop', handleWindowDrop)

    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter)
      window.removeEventListener('dragover', handleWindowDragOver)
      window.removeEventListener('dragleave', handleWindowDragLeave)
      window.removeEventListener('drop', handleWindowDrop)
    }
  }, [activeStoredId, connection, turnRunning])

  // #11: a brief affirmative flash on the composer the moment a turn
  // finishes (running -> not running), rather than the streaming caret
  // just silently vanishing -- which read ambiguously as "done" vs.
  // "stalled". Auto-clears after a fixed duration so it reads as a
  // one-off pulse, not a stuck state.
  useEffect(() => {
    if (turnJustCompleted(previousTurnRunningRef.current, turnRunning)) {
      setTurnJustCompletedFlash(true)
      const timer = window.setTimeout(() => setTurnJustCompletedFlash(false), 1200)

      previousTurnRunningRef.current = turnRunning

      return () => window.clearTimeout(timer)
    }

    previousTurnRunningRef.current = turnRunning
  }, [turnRunning])

  const handleRemoveAttachment = (id: string) => {
    setSelectedAttachments(current => {
      const removed = current.find(attachment => attachment.id === id)

      if (removed?.previewUrl) {
        releaseAttachmentPreviews([removed])
        attachmentPreviewsRef.current.delete(removed.previewUrl)
      }

      return current.filter(attachment => attachment.id !== id)
    })
  }

  const updateSelectedAttachment = (update: SelectedAttachment) => {
    setSelectedAttachments(current => current.map(attachment => attachment.id === update.id ? update : attachment))
  }

  const handleSubmit = async (overrideText?: string, overrideReply?: ReplyReference) => {
    const gateway = gatewayRef.current
    const displayInput = (overrideText ?? draft).trim()
    const activeReply = overrideText === undefined ? replyTarget?.reference : overrideReply
    // The prompt actually sent to the gateway carries the disambiguation
    // pointer (matches the gateway's own inbound convention for every other
    // platform, gateway/run_inbound.py `_prepend_inbound_reply_context`) so
    // Hermes genuinely has the quoted context, not just a visual quote --
    // but the message BUBBLE shown to the user stays plain text; the quote
    // renders separately via `replyTo` (MessageBubble reply-preview UI).
    const input = activeReply ? buildReplyPrefixedText(activeReply, displayInput) : displayInput
    const attachments = selectedAttachments

    if (!gateway || !activeStoredId || (!displayInput && attachments.length === 0) || turnRunning) {return}

    if (attachments.length === 0 && ['/new', '/reset'].includes(displayInput.toLowerCase())) {
      setDraft('')
      await handleCreate()

      return
    }

    if (attachments.length === 0 && ['/stop', '/interrupt'].includes(displayInput.toLowerCase())) {
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
        const resumed = await ensureSessionRuntime(gateway, selectedSession)
        runtimeId = resumed.runtimeId
        runtimesRef.current.set(selectedSession.id, runtimeId)

        if (generation !== openGenerationRef.current) {return}
        activeRuntimeRef.current = runtimeId
        setActiveRuntimeId(runtimeId)

        if (resumed.pendingInputRequests.length > 0) {
          setMessages(current => resumed.pendingInputRequests.reduce(
            (next, event) => applyInputRequestEvent(next, event),
            current
          ))

          return
        }
      } catch (error) {
        setSessionError(error instanceof Error ? error.message : 'Could not resume session')

        return
      }
    }

    setSessionError(null)

    if (attachments.length > 0) {
      try {
        const result = await uploadAndSubmitAttachments(gateway, runtimeId, attachments, input, updateSelectedAttachment)

        const previews = attachments.map(attachment => ({
          kind: attachment.kind === 'image' ? 'image' as const : 'file' as const,
          name: attachment.file.name || 'attachment',
          ...(attachment.previewUrl ? { url: attachment.previewUrl } : {})
        }))

        setMessages(current => appendLocalMessage(current, 'user', displayInput, displayInput, undefined, previews, activeReply))
        setDraft('')
        setReplyTarget(undefined)
        setSelectedAttachments([])
        setTurnRunning(result.status === 'streaming')

        if (result.status !== 'streaming') {
          setMessages(current => appendLocalMessage(current, 'system', displayInput, `Gateway status: ${result.status}`))
        }

        void refreshSessions(gateway)
      } catch (error) {
        setTurnRunning(false)
        const message = error instanceof Error ? error.message : 'Could not upload attachment'
        setSessionError(message)
        setMessages(current => appendLocalMessage(current, 'system', displayInput || 'Attachment', `Error: ${message}`))
      }

      return
    }

    const plainPrompt = !displayInput.startsWith('/')
    setDraft('')
    setReplyTarget(undefined)

    if (plainPrompt) {
      setMessages(current => appendLocalMessage(current, 'user', displayInput, displayInput, undefined, [], activeReply))
      setTurnRunning(true)
    }

    try {
      const result = await runComposerInput(gateway, runtimeId, input)

      if (result.kind === 'submitted') {
        if (!plainPrompt) {setMessages(current => appendLocalMessage(current, 'user', result.displayText))}
        setTurnRunning(result.status === 'streaming')

        if (result.status !== 'streaming') {
          setMessages(current => appendLocalMessage(current, 'system', displayInput, `Gateway status: ${result.status}`))
        }

        // The gateway bumps this session's last-active ordering server-side on
        // a real send; re-pull the list so the sidebar reflects it instead of
        // showing a stale snapshot from page-load/last-refresh time.
        void refreshSessions(gateway)
      } else if (result.kind === 'output') {
        setMessages(current => appendLocalMessage(current, 'system', displayInput, result.text))
      } else {
        setDraft(result.text)
      }
    } catch (error) {
      setTurnRunning(false)
      const message = error instanceof Error ? error.message : 'Could not send message'
      setSessionError(message)
      setMessages(current => appendLocalMessage(current, 'system', displayInput, `Error: ${message}`))
    }
  }

  const handleReply = (message: MessageBubbleModel) => {
    setReplyTarget({ id: message.id, reference: { role: message.role, senderName: message.senderName, text: message.text } })
  }

  const clearReply = () => setReplyTarget(undefined)

  // Regenerate = resend the user turn that produced this assistant message.
  // There is no dedicated gateway RPC for this; resubmitting the same text
  // as a fresh prompt reuses every existing send code path (attachments,
  // runtime resolution, error handling) instead of duplicating it. Passing
  // the text directly to handleSubmit (rather than setDraft + a deferred
  // call) avoids resending against a stale closure over the old draft value.
  // Its own reply target (if any) rides along too, so a regenerated turn
  // that was originally a reply keeps disambiguating the same earlier
  // message rather than silently losing that context.
  const handleRegenerate = (message: MessageBubbleModel) => {
    if (turnRunning) {return}
    const index = messages.findIndex(candidate => candidate.id === message.id)

    if (index < 0) {return}

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = messages[cursor]!

      if (candidate.role === 'user') {
        void handleSubmit(candidate.text, candidate.replyTo)

        return
      }
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

    stickToBottomRef.current = resolveScrollFollowState(
      stickToBottomRef.current,
      nearBottom,
      userScrollIntentRef.current
    )
    userScrollIntentRef.current = false
    setShowJumpToBottom(!stickToBottomRef.current)
  }

  const markUserScrollIntent = () => {userScrollIntentRef.current = true}

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = messageListRef.current

    if (!el) {return}
    el.scrollTo({ behavior, top: el.scrollHeight })
    stickToBottomRef.current = true
    setShowJumpToBottom(false)
  }

  useEffect(() => {
    // Capture the follow intent before replacing the timeline. The browser can
    // emit a layout-driven scroll event while rich cards/history settle; that
    // must not cancel the follow already requested for this render.
    scheduleFollowAfterLayout(
      requestAnimationFrame,
      () => stickToBottomRef.current,
      () => scrollToBottom(IMMEDIATE_SCROLL_BEHAVIOR)
    )
  }, [messages])

  useEffect(() => watchViewportForFollow({
    follow: () => scrollToBottom(IMMEDIATE_SCROLL_BEHAVIOR),
    schedule: callback => {scheduleAfterLayout(requestAnimationFrame, callback)},
    shouldFollow: () => stickToBottomRef.current,
    sources: window.visualViewport ? [window, window.visualViewport] : [window]
  }), [])

  useEffect(() => {
    const target = messageContentRef.current

    if (!target || typeof ResizeObserver === 'undefined') {return}

    return watchContentResizeForFollow({
      createObserver: callback => new ResizeObserver(callback),
      follow: () => scrollToBottom(IMMEDIATE_SCROLL_BEHAVIOR),
      shouldFollow: () => stickToBottomRef.current,
      target
    })
  }, [])

  const activeSession = sessions.find(session => session.id === activeStoredId)
  const slashQuery = draft.split(/\s/, 1)[0]?.toLowerCase() ?? ''

  // #87: close the profile-picker dropdown on an outside click (native <select> was tried first but
  // rendered as an unusable near-zero-width sliver in this layout — a plain button + menu is more
  // predictable to style).
  useEffect(() => {
    if (!newSessionPickerOpen) {return}

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.new-session-profile-menu')) {
        setNewSessionPickerOpen(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)

    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [newSessionPickerOpen])

  const visibleSlashSuggestions = draft.startsWith('/')
    ? slashSuggestions.filter(item => item.command.toLowerCase().startsWith(slashQuery)).slice(0, 8)
    : []

  return (
    <main className="chat-shell" data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}>
      {windowDragActive && (
        <div aria-hidden className="window-drop-overlay">
          <p>Drop files to attach</p>
        </div>
      )}
      <aside className="session-sidebar" id="session-sidebar">
        <div className="sidebar-heading">
          <div>
            <p className="eyebrow">Hermes Chat</p>
            <h1>Sessions</h1>
          </div>
          <div className="sidebar-heading-actions">
            <HubLink />
            <div className="new-session-profile-menu">
              <button
                aria-expanded={newSessionPickerOpen}
                aria-label="Choose profile for new session"
                className="button new-session-profile-toggle"
                disabled={connection !== 'connected'}
                onClick={() => setNewSessionPickerOpen(open => !open)}
                title="Choose profile before starting a new session"
                type="button"
              >⌄</button>
              {newSessionPickerOpen && (
                <div className="new-session-profile-dropdown" role="menu">
                  {Object.values(profiles).map(profile => (
                    <button
                      className="new-session-profile-option"
                      data-active={profile.name === newSessionProfile ? 'true' : 'false'}
                      key={profile.name}
                      onClick={() => {
                        setNewSessionProfile(profile.name)
                        void handleCreate(profile.name)
                      }}
                      role="menuitem"
                      type="button"
                    >{profile.displayName}</button>
                  ))}
                </div>
              )}
            </div>
            <button aria-label="Create session" className="button button-primary new-session-button" disabled={connection !== 'connected'} onClick={() => void handleCreate()}>+</button>
          </div>
        </div>
        <div aria-live="polite" className="connection-status" data-state={connection}>
          <span aria-hidden className="status-dot" />
          <span>{connectionMessage}</span>
        </div>
        <div className="session-search">
          <input
            aria-label="Search sessions"
            className="session-search-input"
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Search all sessions…"
            type="search"
            value={searchQuery}
          />
          {searchQuery.trim() && (
            <div className="session-search-results" role="listbox">
              {searchStatus === 'loading' && <p className="session-search-status">Searching…</p>}
              {searchStatus === 'error' && <p className="session-search-status">Search failed. Try again.</p>}
              {searchStatus === 'idle' && searchResults.length === 0 && (
                <p className="session-search-status">No matches.</p>
              )}
              {searchResults.map((result, index) => (
                <button
                  className="session-search-result"
                  key={`${resultSessionId(result) ?? 'result'}-${index}`}
                  onClick={() => handleSearchResultClick(result)}
                  type="button"
                >
                  <strong>{resultTitle(result)}</strong>
                  {result.snippet && <small>{result.snippet}</small>}
                </button>
              ))}
            </div>
          )}
        </div>
        <nav aria-label="Chat sessions" className="session-list">
          {sessions.map((session, index) => (
            <button
              className="session-row"
              data-active={session.id === activeStoredId ? 'true' : 'false'}
              key={session.id}
              onClick={() => void showSession(session)}
              type="button"
            >
              <span className="session-copy">
                <strong>
                  {sessionTitle(session)}
                  {index === 0 && sessions.length > 1 && <span className="session-most-recent-badge">Most recent</span>}
                </strong>
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
          <div className="conversation-actions">
            {activeSession && <span className="profile-pill">{displayNameForProfile(activeSession.profile || 'default')}</span>}
            <HubLink className="conversation-hub-link" />
          </div>
        </header>

        {sessionError && <div className="session-error" role="alert">{sessionError}</div>}
        {activeStoredId && sessionModelInfo[activeStoredId] && (
          <div className="session-model-banner" role="status">
            Session started · Profile: {displayNameForProfile(sessionModelInfo[activeStoredId]?.profileName || activeSession?.profile || 'default')} · Model: {sessionModelInfo[activeStoredId]?.model}
          </div>
        )}
        <div
          aria-busy={loadingHistory}
          aria-live="polite"
          className="message-list"
          onPointerDown={markUserScrollIntent}
          onScroll={handleMessageListScroll}
          onTouchStart={markUserScrollIntent}
          onWheel={markUserScrollIntent}
          ref={messageListRef}
        >
          <div className="message-list-content" ref={messageContentRef}>
            {loadingHistory ? (
              <div className="empty-state">Loading session history…</div>
            ) : messages.length ? (
              groupToolSteps(messages).map(item => item.kind === 'tool-group' ? (
                <ToolStepGroup group={item.group} key={item.group.id} />
              ) : (
                <MessageBubble
                  identity={
                    item.message.role === 'user'
                      ? USER_IDENTITY
                      : item.message.profileName
                        ? profiles[item.message.profileName] ?? profiles[item.message.profileName.toLowerCase()]
                        : undefined
                  }
                  key={item.message.id}
                  message={item.message}
                  onInputResponse={handleInputResponse}
                  onRegenerate={handleRegenerate}
                  onReply={handleReply}
                />
              ))
            ) : (
              <div className="empty-state">{activeSession ? 'No messages in this session yet.' : 'Choose a session to view its history.'}</div>
            )}
          </div>
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
          attachments={selectedAttachments}
          busy={turnRunning}
          disabled={connection !== 'connected' || !activeStoredId || loadingHistory}
          draft={draft}
          onAttachments={handleAttachments}
          onCancelReply={clearReply}
          onChange={setDraft}
          onInterrupt={() => void handleInterrupt()}
          onRemoveAttachment={handleRemoveAttachment}
          onSubmit={() => void handleSubmit()}
          replyTo={replyTarget?.reference}
          suggestions={visibleSlashSuggestions}
          turnJustCompleted={turnJustCompletedFlash}
        />
      </section>
    </main>
  )
}
