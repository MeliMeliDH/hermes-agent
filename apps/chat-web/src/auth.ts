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

export async function getWsTicket(): Promise<{ ticket: string; ttl_seconds: number }> {
  const response = await fetch(`${readBasePath()}/api/auth/ws-ticket`, {
    credentials: 'include',
    method: 'POST'
  })

  if (!response.ok) {
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
