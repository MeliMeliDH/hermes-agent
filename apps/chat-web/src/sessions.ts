import { HERMES_BASE_PATH } from './auth'
import type { GatewayHistoryMessage, InputRequestPayload } from './chat-state'
import type { GatewayRequester } from './identity'

export interface SessionRow {
  id: string
  message_count?: number
  preview?: string
  profile?: string
  source?: string
  started_at?: number
  title?: string
}

interface SessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const LAST_SESSION_STORAGE_KEY = 'hermes.chatWeb.lastSessionId'

function browserStorage(): SessionStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

export function loadLastSessionId(storage: SessionStorage | undefined = browserStorage()): string | null {
  try {
    return storage?.getItem(LAST_SESSION_STORAGE_KEY)?.trim() || null
  } catch {
    return null
  }
}

export function persistLastSessionId(sessionId: string, storage: SessionStorage | undefined = browserStorage()): void {
  try {
    storage?.setItem(LAST_SESSION_STORAGE_KEY, sessionId)
  } catch {
    // Session restoration is optional when storage is unavailable.
  }
}

export function selectReconnectSession(sessions: SessionRow[], activeStoredId: string | null): SessionRow | undefined {
  return sessions.find(session => session.id === activeStoredId) ?? sessions[0]
}

export interface SessionHistory {
  count: number
  messages: GatewayHistoryMessage[]
}

interface SessionRuntimeResponse {
  pending_approval?: InputRequestPayload
  pending_clarify?: InputRequestPayload
  session_id: string
  stored_session_id?: string
}

export interface PendingInputRequest {
  payload: InputRequestPayload
  type: 'approval.request' | 'clarify.request'
}

export interface RuntimeHydration {
  pendingInputRequests: PendingInputRequest[]
  runtimeId: string
}

export interface OpenedSession {
  history: SessionHistory
  pendingInputRequests: PendingInputRequest[]
  runtimeId: null | string
}

interface StoredHistoryResponse {
  messages?: GatewayHistoryMessage[]
  pagination?: { returned?: number }
}

type StoredHistoryFetcher = (session: SessionRow) => Promise<StoredHistoryResponse>

export async function fetchStoredSessionHistory(session: SessionRow): Promise<StoredHistoryResponse> {
  const query = new URLSearchParams({ include_compacted: 'true', limit: '500', order: 'latest' })

  if (session.profile && session.profile !== 'default') {query.set('profile', session.profile)}
  const headers = new Headers()

  if (!window.__HERMES_AUTH_REQUIRED__ && window.__HERMES_SESSION_TOKEN__) {
    headers.set('X-Hermes-Session-Token', window.__HERMES_SESSION_TOKEN__)
  }

  const response = await fetch(
    `${HERMES_BASE_PATH}/api/sessions/${encodeURIComponent(session.id)}/messages?${query.toString()}`,
    { credentials: 'include', headers }
  )

  if (!response.ok) {throw new Error(`Session history: HTTP ${response.status}`)}

  return response.json()
}

function pendingInputRequests(response: SessionRuntimeResponse): PendingInputRequest[] {
  return [
    ...(response.pending_approval ? [{ payload: response.pending_approval, type: 'approval.request' as const }] : []),
    ...(response.pending_clarify ? [{ payload: response.pending_clarify, type: 'clarify.request' as const }] : [])
  ]
}

export async function ensureSessionRuntime(gateway: GatewayRequester, session: SessionRow): Promise<RuntimeHydration> {
  const resumed = await gateway.request<SessionRuntimeResponse>('session.resume', {
    cols: 96,
    omit_messages: true,
    ...(session.profile && session.profile !== 'default' ? { profile: session.profile } : {}),
    session_id: session.id,
    source: 'chat-web'
  })

  return { pendingInputRequests: pendingInputRequests(resumed), runtimeId: resumed.session_id }
}

export async function openSession(
  gateway: GatewayRequester,
  session: SessionRow,
  knownRuntimeId?: string,
  fetchHistory: StoredHistoryFetcher = fetchStoredSessionHistory
): Promise<OpenedSession> {
  if (!knownRuntimeId) {
    // Opening history is a read-only action. session.resume claims a live runtime,
    // restores model history, schedules agent warm-up, and may schedule an
    // auto-continue; defer that shared-core path until the user actually sends.
    const stored = await fetchHistory(session)
    const messages = stored.messages ?? []

    return {
      history: { count: stored.pagination?.returned ?? messages.length, messages },
      pendingInputRequests: [],
      runtimeId: null
    }
  }

  const activated = await gateway.request<SessionRuntimeResponse>('session.activate', { omit_messages: true, session_id: knownRuntimeId })
  const history = await gateway.request<SessionHistory>('session.history', { session_id: knownRuntimeId })

  return { history, pendingInputRequests: pendingInputRequests(activated), runtimeId: knownRuntimeId }
}

export async function createSession(gateway: GatewayRequester): Promise<{ runtimeId: string; storedId: string }> {
  const created = await gateway.request<SessionRuntimeResponse>('session.create', { cols: 96, source: 'chat-web' })

  return { runtimeId: created.session_id, storedId: created.stored_session_id ?? created.session_id }
}

export async function deleteSession(
  gateway: GatewayRequester,
  storedId: string,
  runtimeId?: string
): Promise<void> {
  if (runtimeId) {await gateway.request('session.close', { session_id: runtimeId })}
  await gateway.request('session.delete', { session_id: storedId })
}
