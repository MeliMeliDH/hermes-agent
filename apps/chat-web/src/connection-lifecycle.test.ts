import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGatewayConnectionLifecycle } from './connection-lifecycle'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('gateway connection lifecycle', () => {
  it('reconnects the same client instance so replay watermarks survive', async () => {
    vi.useFakeTimers()
    let disconnect: (() => void) | undefined
    const client = { close: vi.fn(), connect: vi.fn().mockResolvedValue(undefined) }

    const createClient = vi.fn((onDisconnect: () => void) => {
      disconnect = onDisconnect

      return client
    })

    const connected: boolean[] = []

    const lifecycle = createGatewayConnectionLifecycle({
      createClient,
      onConnected: async (_client, reconnected) => { connected.push(reconnected) },
      reconnectDelayMs: () => 25
    })

    await lifecycle.start()
    disconnect?.()
    await vi.advanceTimersByTimeAsync(25)

    expect(createClient).toHaveBeenCalledTimes(1)
    expect(client.connect).toHaveBeenCalledTimes(2)
    expect(connected).toEqual([false, true])

    lifecycle.dispose()
    expect(client.close).toHaveBeenCalledTimes(1)
  })

  it('retries a failed initial connection with the same client and backoff', async () => {
    vi.useFakeTimers()

    const client = {
      close: vi.fn(),
      connect: vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(undefined)
    }

    const createClient = vi.fn(() => client)
    const errors: string[] = []

    const lifecycle = createGatewayConnectionLifecycle({
      createClient,
      onConnected: async () => undefined,
      onError: error => errors.push(error.message),
      reconnectDelayMs: () => 50
    })

    await lifecycle.start()
    await vi.advanceTimersByTimeAsync(50)

    expect(createClient).toHaveBeenCalledTimes(1)
    expect(client.connect).toHaveBeenCalledTimes(2)
    expect(errors).toEqual(['offline'])
  })
})
