import { afterEach, describe, expect, it, vi } from 'vitest'

import { HERMES_BASE_PATH } from './auth'
import { resultSessionId, resultTitle, searchSessions } from './session-search'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('searchSessions', () => {
  it('returns an empty array without calling fetch for a blank query', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchSessions('   ')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls the sessions search endpoint with credentials and returns results', async () => {
    const results = [{ preview: 'hello world', session_id: 'abc123', snippet: 'hello world' }]

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ results }),
      ok: true
    })

    vi.stubGlobal('fetch', fetchMock)

    await expect(searchSessions('hello', 10)).resolves.toEqual(results)
    expect(fetchMock).toHaveBeenCalledWith(
      `${HERMES_BASE_PATH}/api/sessions/search?limit=10&q=hello`,
      { credentials: 'include' }
    )
  })

  it('throws with the status code on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    await expect(searchSessions('hello')).rejects.toThrow('HTTP 500')
  })
})

describe('resultSessionId', () => {
  it('prefers session_id over id', () => {
    expect(resultSessionId({ id: 'fallback', session_id: 'preferred' })).toBe('preferred')
  })

  it('falls back to id when session_id is absent', () => {
    expect(resultSessionId({ id: 'fallback' })).toBe('fallback')
  })
})

describe('resultTitle', () => {
  it('prefers title, then preview, then the session id, then a fallback', () => {
    expect(resultTitle({ preview: 'p', session_id: 's', title: 't' })).toBe('t')
    expect(resultTitle({ preview: 'p', session_id: 's' })).toBe('p')
    expect(resultTitle({ session_id: 's' })).toBe('s')
    expect(resultTitle({})).toBe('Untitled session')
  })
})
