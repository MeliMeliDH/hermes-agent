declare global {
  interface Window {
    __HERMES_AUTH_REQUIRED__?: boolean
    __HERMES_BASE_PATH__?: string
    __HERMES_SESSION_TOKEN__?: string
  }
}

function readBasePath(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const raw = window.__HERMES_BASE_PATH__ ?? ''

  if (!raw) {
    return ''
  }

  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`

  return withLeadingSlash.replace(/\/+$/, '')
}

export const HERMES_BASE_PATH = readBasePath()

const TOKEN_RELOAD_STORAGE_KEY = 'hermes.chatWebTokenReloadAttempted'

function sessionStorage(): Pick<Storage, 'getItem' | 'removeItem' | 'setItem'> | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function clearAuthReloadAttempt(): void {
  try {
    sessionStorage()?.removeItem(TOKEN_RELOAD_STORAGE_KEY)
  } catch {
    // Storage can be blocked in browser privacy modes.
  }
}

export function attemptAuthReloadOnce(): boolean {
  const storage = sessionStorage()

  try {
    if (storage?.getItem(TOKEN_RELOAD_STORAGE_KEY) === '1') {return false}
    storage?.setItem(TOKEN_RELOAD_STORAGE_KEY, '1')
  } catch {
    // Reload remains the only recovery when storage is unavailable.
  }

  window.location.reload()

  return true
}

export function maybeReloadForLoopbackWsAuthFailure(code: number): boolean {
  return !window.__HERMES_AUTH_REQUIRED__ && code === 4401 && attemptAuthReloadOnce()
}

export async function getWsTicket(): Promise<{ ticket: string; ttl_seconds: number }> {
  const response = await fetch(`${readBasePath()}/api/auth/ws-ticket`, {
    credentials: 'include',
    method: 'POST'
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {attemptAuthReloadOnce()}
    throw new Error(`/api/auth/ws-ticket: HTTP ${response.status}`)
  }

  return response.json()
}

/** Mint a new ticket for every gated WebSocket dial; tokens are loopback-only. */
export async function buildWsAuthParam(): Promise<[string, string]> {
  if (window.__HERMES_AUTH_REQUIRED__) {
    const { ticket } = await getWsTicket()

    return ['ticket', ticket]
  }

  return ['token', window.__HERMES_SESSION_TOKEN__ ?? '']
}

export {}
