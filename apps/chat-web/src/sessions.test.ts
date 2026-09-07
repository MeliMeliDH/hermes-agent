import { describe, expect, it, vi } from 'vitest'

import type { GatewayRequester } from './identity'
import { createSession, deleteSession, openSession } from './sessions'

function gatewayWith(responses: Record<string, unknown>) {
  const request = vi.fn(async (method: string): Promise<unknown> => responses[method])

  return { calls: request.mock.calls, request: request as unknown as GatewayRequester['request'] }
}

describe('session operations', () => {
  it('resumes a stored session then hydrates its transcript through session.history', async () => {
    const gateway = gatewayWith({
      'session.history': { count: 2, messages: [{ role: 'user', text: 'real history' }] },
      'session.resume': { session_id: 'runtime-1' }
    })

    const opened = await openSession(gateway, { id: 'stored-1', title: 'Live chat' })

    expect(opened.runtimeId).toBe('runtime-1')
    expect(opened.history.messages[0]).toMatchObject({ text: 'real history' })
    expect(gateway.calls).toEqual([
      ['session.resume', { cols: 96, omit_messages: true, session_id: 'stored-1', source: 'chat-web' }],
      ['session.history', { session_id: 'runtime-1' }]
    ])
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
