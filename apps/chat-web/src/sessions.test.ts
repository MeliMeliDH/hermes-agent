import { describe, expect, it, vi } from 'vitest'

import type { GatewayRequester } from './identity'
import { createSession, deleteSession, ensureSessionRuntime, loadLastSessionId, openSession, persistLastSessionId, selectReconnectSession } from './sessions'

function gatewayWith(responses: Record<string, unknown>) {
  const request = vi.fn(async (method: string): Promise<unknown> => responses[method])

  return { calls: request.mock.calls, request: request as unknown as GatewayRequester['request'] }
}

describe('session helpers', () => {
  it('restores and persists the last opened stored session', () => {
    const storage = { getItem: vi.fn(() => 'session-2'), setItem: vi.fn() }

    expect(loadLastSessionId(storage)).toBe('session-2')
    persistLastSessionId('session-3', storage)
    expect(storage.setItem).toHaveBeenCalledWith('hermes.chatWeb.lastSessionId', 'session-3')
  })
  it('keeps the selected stored session across reconnects', () => {
    const sessions = [
      { id: 'newest', profile: 'default' },
      { id: 'selected', profile: 'default' }
    ]

    expect(selectReconnectSession(sessions, 'selected')?.id).toBe('selected')
    expect(selectReconnectSession(sessions, 'deleted')?.id).toBe('newest')
  })

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

  it('activates a known runtime and preserves pending prompts while rehydrating', async () => {
    const gateway = gatewayWith({
      'session.activate': {
        pending_approval: {
          choices: ['once', 'deny'],
          command: 'npm publish',
          description: 'Publish package',
          request_id: 'approval-1'
        },
        session_id: 'runtime-1'
      },
      'session.history': { count: 0, messages: [] }
    })

    const opened = await openSession(gateway, { id: 'stored-1', title: 'Live chat' }, 'runtime-1')

    expect(opened.pendingInputRequests).toEqual([{
      payload: {
        choices: ['once', 'deny'],
        command: 'npm publish',
        description: 'Publish package',
        request_id: 'approval-1'
      },
      type: 'approval.request'
    }])
    expect(gateway.calls).toEqual([
      ['session.activate', { omit_messages: true, session_id: 'runtime-1' }],
      ['session.history', { session_id: 'runtime-1' }]
    ])
  })

  it('resumes only when needed and preserves a canonical pending clarify snapshot', async () => {
    const gateway = gatewayWith({
      'session.resume': {
        pending_clarify: {
          answers: { q0: 'red' },
          questions: [{ choices: ['red', 'blue'], multi_select: false, qid: 'q0', question: 'Color?' }],
          request_id: 'clarify-1'
        },
        session_id: 'runtime-1'
      }
    })

    const resumed = await ensureSessionRuntime(gateway, { id: 'stored-1', profile: 'research' })

    expect(resumed).toEqual({
      pendingInputRequests: [{
        payload: {
          answers: { q0: 'red' },
          questions: [{ choices: ['red', 'blue'], multi_select: false, qid: 'q0', question: 'Color?' }],
          request_id: 'clarify-1'
        },
        type: 'clarify.request'
      }],
      runtimeId: 'runtime-1'
    })
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
