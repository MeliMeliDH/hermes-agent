import { describe, expect, it, vi } from 'vitest'

import { filterSlashCommands, runComposerInput } from './composer'
import type { GatewayRequester } from './identity'

function gatewayWith(handler: (method: string, params: Record<string, unknown>) => unknown) {
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => handler(method, params))

  return { calls: request.mock.calls, request: request as unknown as GatewayRequester['request'] }
}

describe('runComposerInput', () => {
  it('submits ordinary text through prompt.submit', async () => {
    const gateway = gatewayWith(() => ({ status: 'streaming' }))

    await expect(runComposerInput(gateway, 'runtime-1', '  hello Hermes  ')).resolves.toEqual({
      displayText: 'hello Hermes',
      kind: 'submitted',
      status: 'streaming'
    })
    expect(gateway.calls).toEqual([
      ['prompt.submit', { session_id: 'runtime-1', text: 'hello Hermes' }]
    ])
  })

  it('renders slash worker output without submitting it as a prompt', async () => {
    const gateway = gatewayWith(method => method === 'slash.exec' ? { output: 'Session is healthy.' } : null)

    await expect(runComposerInput(gateway, 'runtime-1', '/status')).resolves.toEqual({
      kind: 'output',
      text: 'Session is healthy.'
    })
    expect(gateway.calls).toEqual([
      ['slash.exec', { command: 'status', session_id: 'runtime-1' }]
    ])
  })

  it('falls through to command.dispatch for a skill and submits its expanded prompt', async () => {
    const gateway = gatewayWith(method => {
      if (method === 'slash.exec') {throw new Error('skill command: use command.dispatch')}

      if (method === 'command.dispatch') {
        return { display: '/research cats', message: 'expanded skill body', type: 'skill' }
      }

      return { status: 'streaming' }
    })

    await expect(runComposerInput(gateway, 'runtime-1', '/research cats')).resolves.toEqual({
      displayText: '/research cats',
      kind: 'submitted',
      status: 'streaming'
    })
    expect(gateway.calls).toEqual([
      ['slash.exec', { command: 'research cats', session_id: 'runtime-1' }],
      ['command.dispatch', { arg: 'cats', name: 'research', session_id: 'runtime-1' }],
      ['prompt.submit', { session_id: 'runtime-1', text: 'expanded skill body' }]
    ])
  })

  it('surfaces unknown slash command errors instead of silently dropping input', async () => {
    const gateway = gatewayWith(() => {throw new Error('not a quick/plugin/bundle/skill command: unknown')})

    await expect(runComposerInput(gateway, 'runtime-1', '/unknown')).rejects.toThrow('unknown')
  })
})

describe('filterSlashCommands', () => {
  it('keeps web-capable built-ins and all skill or quick-command extensions', () => {
    const rows = filterSlashCommands({
      commands: {
        '/quit': { desktop: 'terminal' },
        '/status': { desktop: null }
      },
      pairs: [
        ['/quit', 'Exit terminal'],
        ['/status', 'Show status'],
        ['/research', 'Research skill']
      ],
      skills: { '/research': { origin: 'local', usage: 3 } }
    })

    expect(rows).toEqual([
      { command: '/status', description: 'Show status', kind: 'command' },
      { command: '/research', description: 'Research skill', kind: 'skill' }
    ])
  })
})
