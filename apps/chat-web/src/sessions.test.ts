import { describe, expect, it, vi } from 'vitest'

import type { GatewayRequester } from './identity'
import { createSession, deleteSession, ensureSessionRuntime, openSession } from './sessions'

function gatewayWith(responses: Record<string, unknown>) {
  const request = vi.fn(async (method: string): Promise<unknown> => responses[method])

  return { calls: request.mock.calls, request: request as unknown as GatewayRequester['request'] }
}

describe('session operations', () => {
  it('hydrates a cold stored session through the read-only REST path without resuming it', async () => {
    const gateway = gatewayWith({})

    const fetchHistory = vi.fn(async () => ({
      messages: [{ role: 'user', text: 'real history' }],
      pagination: { returned: 1 },
      session_id: 'stored-1'
    }))

    const opened = await openSession(gateway, { id: 'stored-1', title: 'Live chat' }, undefined, fetchHistory)

    expect(opened.runtimeId).toBeNull()
    expect(opened.history).toEqual({ count: 1, messages: [{ role: 'user', text: 'real history' }] })
    expect(fetchHistory).toHaveBeenCalledWith({ id: 'stored-1', title: 'Live chat' })
    expect(gateway.calls).toEqual([])
  })

  it('activates a known runtime before rehydrating on switch', async () => {
    const gateway = gatewayWith({
      'session.activate': { session_id: 'runtime-1' },
      'session.history': { count: 0, messages: [] }
    })

    await openSession(gateway, { id: 'stored-1', title: 'Live chat' }, 'runtime-1')

    expect(gateway.calls).toEqual([
      ['session.activate', { omit_messages: true, session_id: 'runtime-1' }],
      ['session.history', { session_id: 'runtime-1' }]
    ])
  })

  it('resumes only when a read-only session first needs a live runtime', async () => {
    const gateway = gatewayWith({ 'session.resume': { session_id: 'runtime-1' } })

    const runtimeId = await ensureSessionRuntime(gateway, { id: 'stored-1', profile: 'research' })

    expect(runtimeId).toBe('runtime-1')
    expect(gateway.calls).toEqual([
      ['session.resume', {
        cols: 96,
        omit_messages: true,
        profile: 'research',
        session_id: 'stored-1',
        source: 'chat-web'
      }]
    ])
  })

  it('creates a chat-web session and closes its runtime before deleting it', async () => {
    const gateway = gatewayWith({
      'session.close': { closed: true },
      'session.create': { session_id: 'runtime-new', stored_session_id: 'stored-new' },
      'session.delete': { deleted: 'stored-new' }
    })

    const created = await createSession(gateway)
    await deleteSession(gateway, created.storedId, created.runtimeId)

    expect(created).toEqual({ runtimeId: 'runtime-new', storedId: 'stored-new' })
    expect(gateway.calls).toEqual([
      ['session.create', { cols: 96, source: 'chat-web' }],
      ['session.close', { session_id: 'runtime-new' }],
      ['session.delete', { session_id: 'stored-new' }]
    ])
  })
})
