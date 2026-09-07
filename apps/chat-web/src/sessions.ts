import type { GatewayHistoryMessage } from './chat-state'
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

export interface SessionHistory {
  count: number
  messages: GatewayHistoryMessage[]
}

interface SessionRuntimeResponse {
  session_id: string
  stored_session_id?: string
}

export interface OpenedSession {
  history: SessionHistory
  runtimeId: string
}

export async function openSession(
  gateway: GatewayRequester,
  session: SessionRow,
  knownRuntimeId?: string
): Promise<OpenedSession> {
  let runtimeId = knownRuntimeId

  if (runtimeId) {
    await gateway.request('session.activate', { omit_messages: true, session_id: runtimeId })
  } else {
    const resumed = await gateway.request<SessionRuntimeResponse>('session.resume', {
      cols: 96,
      omit_messages: true,
      ...(session.profile && session.profile !== 'default' ? { profile: session.profile } : {}),
      session_id: session.id,
      source: 'chat-web'
    })

    runtimeId = resumed.session_id
  }

  const history = await gateway.request<SessionHistory>('session.history', { session_id: runtimeId })

  return { history, runtimeId }
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
