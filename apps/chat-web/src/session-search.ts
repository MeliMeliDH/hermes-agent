import { HERMES_BASE_PATH } from './auth'

export interface SessionSearchResult {
  id?: string
  is_active?: boolean
  last_active?: number
  message_count?: number
  model?: string
  preview?: string
  role?: string
  session_id?: string
  snippet?: string
  source?: string
  started_at?: number
  title?: string
}

interface SessionSearchResponse {
  results?: SessionSearchResult[]
}

/**
 * Cross-session search over message content, backed by the dashboard's
 * existing FTS5-indexed `/api/sessions/search` REST endpoint (not a gateway
 * WebSocket RPC -- this route already exists server-side for the sessions
 * dashboard UI, so this reuses it rather than adding a parallel search path).
 * Session-cookie auth via `credentials: 'include'`, matching the pattern in
 * auth.ts's `getWsTicket`.
 */
export async function searchSessions(query: string, limit = 20): Promise<SessionSearchResult[]> {
  const trimmed = query.trim()

  if (!trimmed) {return []}

  const params = new URLSearchParams({ limit: String(limit), q: trimmed })

  const response = await fetch(`${HERMES_BASE_PATH}/api/sessions/search?${params.toString()}`, {
    credentials: 'include'
  })

  if (!response.ok) {throw new Error(`/api/sessions/search: HTTP ${response.status}`)}

  const body = await response.json() as SessionSearchResponse

  return body.results ?? []
}

export function resultSessionId(result: SessionSearchResult): string | undefined {
  return result.session_id ?? result.id
}

export function resultTitle(result: SessionSearchResult): string {
  return result.title?.trim() || result.preview?.trim() || resultSessionId(result) || 'Untitled session'
}
