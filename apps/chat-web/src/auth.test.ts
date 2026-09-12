import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildWsAuthParam } from './auth'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('buildWsAuthParam', () => {
  it('mints a fresh single-use ticket in gated mode', async () => {
    const fetch = vi.fn().mockResolvedValue({
      json: async () => ({ ticket: 'single-use-ticket', ttl_seconds: 30 }),
      ok: true
    })

    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('window', {
      __HERMES_AUTH_REQUIRED__: true,
      __HERMES_BASE_PATH__: '/hermes'
    })

    await expect(buildWsAuthParam()).resolves.toEqual(['ticket', 'single-use-ticket'])
    expect(fetch).toHaveBeenCalledWith('/hermes/api/auth/ws-ticket', {
      credentials: 'include',
      method: 'POST'
    })
  })

  it('reloads once when a gated ticket request says the dashboard session expired', async () => {
    const reload = vi.fn()
    const storage = { getItem: vi.fn(() => null), removeItem: vi.fn(), setItem: vi.fn() }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    vi.stubGlobal('window', {
      __HERMES_AUTH_REQUIRED__: true,
      __HERMES_BASE_PATH__: '',
      location: { reload },
      sessionStorage: storage
    })

    await expect(buildWsAuthParam()).rejects.toThrow('/api/auth/ws-ticket: HTTP 401')
    expect(storage.setItem).toHaveBeenCalledWith('hermes.chatWebTokenReloadAttempted', '1')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('uses the injected token only when the auth gate is off', async () => {
    const fetch = vi.fn()

    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('window', {
      __HERMES_AUTH_REQUIRED__: false,
      __HERMES_SESSION_TOKEN__: 'loopback-token'
    })

    await expect(buildWsAuthParam()).resolves.toEqual(['token', 'loopback-token'])
    expect(fetch).not.toHaveBeenCalled()
  })
})
