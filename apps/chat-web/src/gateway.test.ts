import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatGatewayClient } from './gateway'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ChatGatewayClient', () => {
  it('builds the current ticket-authenticated same-origin gateway URL', async () => {
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
      location: { host: 'dashboard.example:9443', protocol: 'https:' }
    })

    const client = new ChatGatewayClient()
    await client.connect()

    expect(WebSocketCtor).toHaveBeenCalledWith(
      'wss://dashboard.example:9443/api/ws?ticket=fresh-ticket'
    )
    client.close()
  })
})
