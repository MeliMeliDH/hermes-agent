import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatGatewayClient } from './gateway'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubConnectedSocket() {
  let closeHandler: ((event: { code: number }) => void) | undefined

  const socket = {
    addEventListener: vi.fn((type: string, handler: (event: { code: number }) => void) => {
      if (type === 'open') {handler({ code: 0 })}

      if (type === 'close') {closeHandler = handler}
    }),
    close: vi.fn(),
    readyState: 1,
    removeEventListener: vi.fn(),
    send: vi.fn()
  }

  const WebSocketCtor = vi.fn(function WebSocketMock() {
    return socket
  })

  Object.assign(WebSocketCtor, { OPEN: 1 })
  vi.stubGlobal('WebSocket', WebSocketCtor)

  return { simulateClose: (code: number) => closeHandler?.({ code }), socket }
}

describe('ChatGatewayClient', () => {
  it('builds the current ticket-authenticated same-origin gateway URL', async () => {
    const storage = { getItem: vi.fn(() => '1'), removeItem: vi.fn(), setItem: vi.fn() }

    const socket = {
      addEventListener: vi.fn((type: string, handler: () => void) => {
        if (type === 'open') {
          handler()
        }
      }),
      close: vi.fn(),
      readyState: 1,
      removeEventListener: vi.fn(),
      send: vi.fn()
    }

    const WebSocketCtor = vi.fn(function WebSocketMock() {
      return socket
    })

    Object.assign(WebSocketCtor, { OPEN: 1 })

    vi.stubGlobal('WebSocket', WebSocketCtor)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ ticket: 'fresh-ticket', ttl_seconds: 30 }),
      ok: true
    }))
    vi.stubGlobal('window', {
      __HERMES_AUTH_REQUIRED__: true,
      __HERMES_BASE_PATH__: '',
      location: { host: 'dashboard.example:9443', protocol: 'https:' },
      sessionStorage: storage
    })

    const client = new ChatGatewayClient()
    await client.connect()

    expect(WebSocketCtor).toHaveBeenCalledWith(
      'wss://dashboard.example:9443/api/ws?ticket=fresh-ticket'
    )
    expect(storage.removeItem).toHaveBeenCalledWith('hermes.chatWebTokenReloadAttempted')
    client.close()
  })

  it('notifies onDisconnect for a real socket close (network drop), not a reload-eligible loopback 4401', async () => {
    const { simulateClose } = stubConnectedSocket()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ ticket: 'fresh-ticket', ttl_seconds: 30 }),
      ok: true
    }))
    vi.stubGlobal('window', {
      __HERMES_AUTH_REQUIRED__: true,
      __HERMES_BASE_PATH__: '',
      location: { host: 'dashboard.example:9443', protocol: 'https:' }
    })

    const onDisconnect = vi.fn()
    const client = new ChatGatewayClient({ onDisconnect })

    await client.connect()
    simulateClose(1006)
    // onDisconnect fires from a queued microtask (after the base client's own
    // close teardown), so let the microtask queue drain.
    await Promise.resolve()
    await Promise.resolve()

    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('does not call onDisconnect for a loopback 4401 (that path reloads the page instead)', async () => {
    const { simulateClose } = stubConnectedSocket()
    const reloadSpy = vi.fn()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.stubGlobal('sessionStorage', { getItem: vi.fn(() => null), setItem: vi.fn() })
    vi.stubGlobal('window', {
      __HERMES_AUTH_REQUIRED__: false,
      __HERMES_BASE_PATH__: '',
      __HERMES_SESSION_TOKEN__: 'loopback-token',
      location: { host: 'dashboard.example:9443', protocol: 'https:', reload: reloadSpy },
      sessionStorage: { getItem: vi.fn(() => null), setItem: vi.fn() }
    })

    const onDisconnect = vi.fn()
    const client = new ChatGatewayClient({ onDisconnect })

    await client.connect()
    simulateClose(4401)
    await Promise.resolve()
    await Promise.resolve()

    expect(onDisconnect).not.toHaveBeenCalled()
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('does not call onDisconnect for a close on a connection that never opened (failed connect attempt, e.g. server down)', async () => {
    // Regression test: a real bug shipped here once -- a failed connect
    // attempt (server refuses/never responds) fires BOTH a 'close' event
    // AND rejects connect()'s promise. Treating the close as a real
    // disconnect double-scheduled the caller's reconnect logic (once via
    // onDisconnect, once via the connect().catch() path), completely
    // bypassing backoff and reconnect-storming the server (~190 attempts
    // in 6 seconds, observed live before this fix).
    let closeHandler: ((event: { code: number }) => void) | undefined

    const socket = {
      addEventListener: vi.fn((type: string, handler: (event: { code: number }) => void) => {
        // Never fires 'open' -- simulates a connection that never succeeds.
        if (type === 'close') {closeHandler = handler}
      }),
      close: vi.fn(),
      readyState: 0,
      removeEventListener: vi.fn(),
      send: vi.fn()
    }

    const WebSocketCtor = vi.fn(function WebSocketMock() {
      return socket
    })

    Object.assign(WebSocketCtor, { OPEN: 1 })
    vi.stubGlobal('WebSocket', WebSocketCtor)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ ticket: 'fresh-ticket', ttl_seconds: 30 }),
      ok: true
    }))
    vi.stubGlobal('window', {
      __HERMES_AUTH_REQUIRED__: true,
      __HERMES_BASE_PATH__: '',
      location: { host: 'dashboard.example:9443', protocol: 'https:' }
    })

    const onDisconnect = vi.fn()
    const client = new ChatGatewayClient({ onDisconnect })

    // connect() never resolves (no 'open' fired) -- fire the close event
    // that a real failed TCP connect produces, without awaiting connect().
    void client.connect().catch(() => { /* expected: connect never opens */ })
    closeHandler?.({ code: 1006 })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(onDisconnect).not.toHaveBeenCalled()
  })
})
