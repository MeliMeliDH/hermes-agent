import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { applyInputRequestEvent, applyMessageEvent, applyReasoningEvent, applyToolEvent, historyToBubbles } from './chat-state'
import { respondToInputRequest } from './input-requests'
import { MessageBubble } from './MessageBubble'

const now = () => 1_700_000_000

describe('Phase 4 timeline events', () => {
  it('upserts live tool progress and completion into one inspectable inline row', () => {
    let messages = applyToolEvent([], {
      type: 'tool.start',
      payload: { args: { path: '/tmp/report.md' }, name: 'read_file', preview: 'Reading report', tool_id: 'tool-1' }
    }, now)

    messages = applyToolEvent(messages, {
      type: 'tool.progress',
      payload: { text: '50%', tool_id: 'tool-1' }
    }, now)
    messages = applyToolEvent(messages, {
      type: 'tool.complete',
      payload: { output: 'Done', status: 'complete', tool_id: 'tool-1' }
    }, now)

    expect(messages).toHaveLength(1)
    expect(messages[0]?.tool).toMatchObject({
      args: { path: '/tmp/report.md' },
      name: 'read_file',
      progress: { text: '50%', tool_id: 'tool-1' },
      result: 'Done',
      status: 'complete',
      toolId: 'tool-1'
    })

    const html = renderToStaticMarkup(<MessageBubble message={messages[0]!} />)
    expect(html).toContain('<details class="tool-call"')
    expect(html).toContain('read_file')
    expect(html).toContain('/tmp/report.md')
    expect(html).toContain('Arguments')
    expect(html).toContain('Done')
  })

  it('renders historical tool rows through the same inspectable tool component', () => {
    const [message] = historyToBubbles([
      { args: { query: 'Hermes' }, context: 'web_search(query=Hermes)', name: 'web_search', role: 'tool' }
    ], 'default')

    expect(message?.tool).toMatchObject({ args: { query: 'Hermes' }, name: 'web_search', status: 'complete' })
    const html = renderToStaticMarkup(<MessageBubble message={message!} />)
    expect(html).toContain('<details class="tool-call"')
    expect(html).toContain('web_search')
    expect(html).toContain('&quot;query&quot;: &quot;Hermes&quot;')
  })

  it('collects live and historical reasoning into a collapsed assistant-turn section', () => {
    let live = applyReasoningEvent([], { type: 'thinking.delta', payload: { text: 'Checking ' } }, 'default', now)
    live = applyReasoningEvent(live, { type: 'reasoning.delta', payload: { text: 'the source.' } }, 'default', now)

    const [historical] = historyToBubbles([
      { reasoning_content: 'Persisted thought.', role: 'assistant', text: '' }
    ], 'default')

    expect(live[0]?.reasoning).toBe('Checking the source.')
    expect(historical?.reasoning).toBe('Persisted thought.')
    const html = renderToStaticMarkup(<MessageBubble message={live[0]!} />)
    expect(html).toContain('<details class="message-reasoning"')
    expect(html).not.toContain('<details class="message-reasoning" open=""')
    expect(html).toContain('<summary>Thinking</summary>')
    expect(html).toContain('Checking the source.')
  })

  it('keeps a failed completion visible with its structured error surface', () => {
    const [message] = applyMessageEvent([], {
      type: 'message.complete',
      payload: {
        error: 'Provider timed out',
        error_surface: { code: 'timeout', layer: 'provider', retryable: true },
        status: 'error',
        text: ''
      }
    }, 'default', now)

    expect(message).toMatchObject({ error: 'Provider timed out', status: 'error' })
    const html = renderToStaticMarkup(<MessageBubble message={message!} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Provider timed out')
    expect(html).toContain('provider')
    expect(html).toContain('timeout')
  })

  it('renders clarify and approval prompts and routes responses to their RPCs', async () => {
    let messages = applyInputRequestEvent([], {
      type: 'clarify.request',
      payload: { choices: ['short', 'detailed'], question: 'How much detail?', request_id: 'clarify-1' }
    }, now)

    messages = applyInputRequestEvent(messages, {
      type: 'approval.request',
      payload: { command: 'rm report.tmp', description: 'Delete temporary report', request_id: 'approval-1' }
    }, now)

    const clarifyHtml = renderToStaticMarkup(<MessageBubble message={messages[0]!} onInputResponse={() => Promise.resolve()} />)
    const approvalHtml = renderToStaticMarkup(<MessageBubble message={messages[1]!} onInputResponse={() => Promise.resolve()} />)
    expect(clarifyHtml).toContain('How much detail?')
    expect(clarifyHtml).toContain('short')
    expect(clarifyHtml).toContain('type="text"')
    expect(approvalHtml).toContain('Delete temporary report')
    expect(approvalHtml).toContain('rm report.tmp')
    expect(approvalHtml).toContain('Run once')
    expect(approvalHtml).toContain('Reject')

    const calls: Array<[string, Record<string, unknown>]> = []

    const gateway = { request: async (method: string, params: Record<string, unknown>) => { calls.push([method, params]);

 return {} } }

    await respondToInputRequest(gateway, messages[0]!.inputRequest!, 'detailed', 'runtime-1')
    await respondToInputRequest(gateway, messages[1]!.inputRequest!, 'once', 'runtime-1')
    expect(calls).toEqual([
      ['clarify.respond', { answer: 'detailed', request_id: 'clarify-1' }],
      ['approval.respond', { choice: 'once', request_id: 'approval-1', session_id: 'runtime-1' }]
    ])
  })
})
