import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { applyInputRequestEvent, applyInputRequestExpireEvent, applyMessageEvent, applyReasoningEvent, applyToolEvent, historyToBubbles, resolveInputRequest } from './chat-state'
import { respondToInputRequest } from './input-requests'
import { MessageBubble } from './MessageBubble'

const now = () => 1_700_000_000

describe('Phase 4 timeline events', () => {
  it('merges canonical id-less progress into its active tool row', () => {
    let messages = applyToolEvent([], {
      type: 'tool.start',
      payload: { args: { path: '/tmp/report.md' }, context: 'read_file(path=/tmp/report.md)', name: 'read_file', tool_id: 'tool-1' }
    }, now)

    messages = applyToolEvent(messages, {
      type: 'tool.progress',
      payload: { name: 'read_file', preview: 'Read 50%' }
    }, now)
    messages = applyToolEvent(messages, {
      type: 'tool.complete',
      payload: { args: { path: '/tmp/report.md' }, name: 'read_file', result: 'Done', tool_id: 'tool-1' }
    }, now, 'default')

    expect(messages).toHaveLength(1)
    expect(messages[0]?.tool).toMatchObject({
      args: { path: '/tmp/report.md' },
      name: 'read_file',
      preview: 'read_file(path=/tmp/report.md)',
      progress: { name: 'read_file', preview: 'Read 50%' },
      result: 'Done',
      status: 'complete',
      toolId: 'tool-1'
    })
    expect(messages[0]).toMatchObject({ profileName: 'default', senderName: 'Victoria Hermes' })

    const html = renderToStaticMarkup(<MessageBubble message={messages[0]!} />)
    expect(html).toContain('<details class="tool-call"')
    expect(html).toContain('read_file')
    expect(html).toContain('/tmp/report.md')
    expect(html).toContain('Arguments')
    expect(html).toContain('Done')
  })

  it('correlates canonical persisted calls and results into one inspectable tool row', () => {
    const [message] = historyToBubbles([
      {
        content: '',
        role: 'assistant',
        timestamp: 100,
        tool_calls: [{ function: { arguments: '{"query":"Hermes"}', name: 'web_search' }, id: 'call-1', type: 'function' }]
      },
      {
        args: { query: 'Hermes' },
        content: '{"results":[{"title":"Hermes Agent"}]}',
        context: 'web_search(query=Hermes)',
        role: 'tool',
        timestamp: 101,
        tool_call_id: 'call-1',
        tool_name: 'web_search'
      }
    ], 'default')

    expect(message?.tool).toMatchObject({
      args: { query: 'Hermes' },
      name: 'web_search',
      preview: 'web_search(query=Hermes)',
      result: { results: [{ title: 'Hermes Agent' }] },
      status: 'complete',
      toolId: 'call-1'
    })
    const html = renderToStaticMarkup(<MessageBubble message={message!} />)
    expect(html).toContain('<details class="tool-call"')
    expect(html).toContain('web_search')
    expect(html).toContain('&quot;query&quot;: &quot;Hermes&quot;')
    expect(html).toContain('Hermes Agent')
  })

  it('collects canonical available and delta reasoning into a collapsed assistant-turn section', () => {
    let live = applyReasoningEvent([], { type: 'reasoning.available', payload: { text: 'Initial thought. ' } }, 'default', now)
    live = applyReasoningEvent(live, { type: 'thinking.delta', payload: { text: 'Checking ' } }, 'default', now)
    live = applyReasoningEvent(live, { type: 'reasoning.delta', payload: { text: 'the source.' } }, 'default', now)

    const [historical] = historyToBubbles([
      { reasoning_content: 'Persisted thought.', role: 'assistant', text: '' }
    ], 'default')

    expect(live[0]?.reasoning).toBe('Initial thought. Checking the source.')
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

  it('expires canonical clarify cards and renders successful responses as settled', () => {
    const [pending] = applyInputRequestEvent([], {
      type: 'clarify.request',
      payload: { choices: [], question: 'Still there?', request_id: 'clarify-expiring' }
    }, now)

    const [expired] = applyInputRequestExpireEvent([pending!], {
      type: 'clarify.expire',
      payload: { request_id: 'clarify-expiring' }
    })

    expect(expired?.inputRequest).toMatchObject({ expired: true, resolved: true })
    const expiredHtml = renderToStaticMarkup(<MessageBubble message={expired!} onInputResponse={() => Promise.resolve()} />)
    expect(expiredHtml).toContain('Request expired.')
    expect(expiredHtml).not.toContain('aria-label="Response"')

    const [resolved] = resolveInputRequest([pending!], 'clarify-expiring', 'Yes')
    const resolvedHtml = renderToStaticMarkup(<MessageBubble message={resolved!} onInputResponse={() => Promise.resolve()} />)
    expect(resolvedHtml).toContain('Response sent: Yes')
    expect(resolvedHtml).not.toContain('aria-label="Response"')
  })

  it('normalizes canonical batch and multi-select clarify requests and sends per-question RPCs', async () => {
    const [batch] = applyInputRequestEvent([], {
      type: 'clarify.request',
      payload: {
        answers: { q0: 'red' },
        questions: [
          { choices: ['red', 'blue'], multi_select: true, qid: 'q0', question: 'Colors?' },
          { choices: null, multi_select: false, qid: 'q1', question: 'Name?' }
        ],
        request_id: 'clarify-batch'
      }
    }, now)

    expect(batch?.inputRequest).toMatchObject({
      answers: { q0: 'red' },
      questions: [
        { choices: ['red', 'blue'], multiSelect: true, qid: 'q0', question: 'Colors?' },
        { multiSelect: false, qid: 'q1', question: 'Name?' }
      ]
    })
    const html = renderToStaticMarkup(<MessageBubble message={batch!} onInputResponse={() => Promise.resolve()} />)
    expect(html).toContain('Colors?')
    expect(html).toContain('Name?')
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('>0<')

    const calls: Array<[string, Record<string, unknown>]> = []

    const gateway = { request: async (method: string, params: Record<string, unknown>) => { calls.push([method, params]);

 return {} } }

    await respondToInputRequest(gateway, batch!.inputRequest!, [
      { answer: '["red","blue"]', questionId: 'q0' },
      { answer: 'Victoria', questionId: 'q1' }
    ], 'runtime-1')
    expect(calls).toEqual([
      ['clarify.respond', { answer: '["red","blue"]', question_id: 'q0', request_id: 'clarify-batch' }],
      ['clarify.respond', { answer: 'Victoria', question_id: 'q1', request_id: 'clarify-batch' }]
    ])
  })

  it('keeps legacy clarify payloads and renders every canonical approval choice', async () => {
    let messages = applyInputRequestEvent([], {
      type: 'clarify.request',
      payload: { choices: ['short', 'detailed'], multi_select: true, question: 'How much detail?', request_id: 'clarify-1' }
    }, now)

    messages = applyInputRequestEvent(messages, {
      type: 'approval.request',
      payload: {
        choices: ['once', 'session', 'always', 'deny'],
        command: 'rm report.tmp',
        description: 'Delete temporary report',
        request_id: 'approval-1'
      }
    }, now)

    const clarifyHtml = renderToStaticMarkup(<MessageBubble message={messages[0]!} onInputResponse={() => Promise.resolve()} />)
    const approvalHtml = renderToStaticMarkup(<MessageBubble message={messages[1]!} onInputResponse={() => Promise.resolve()} />)
    expect(clarifyHtml).toContain('How much detail?')
    expect(clarifyHtml).toContain('type="checkbox"')
    expect(approvalHtml).toContain('Run once')
    expect(approvalHtml).toContain('Allow for session')
    expect(approvalHtml).toContain('Always allow')
    expect(approvalHtml).toContain('Reject')

    const calls: Array<[string, Record<string, unknown>]> = []

    const gateway = { request: async (method: string, params: Record<string, unknown>) => { calls.push([method, params]);

 return {} } }

    await respondToInputRequest(gateway, messages[0]!.inputRequest!, '["short","detailed"]', 'runtime-1')
    await respondToInputRequest(gateway, messages[1]!.inputRequest!, 'session', 'runtime-1')
    expect(calls).toEqual([
      ['clarify.respond', { answer: '["short","detailed"]', request_id: 'clarify-1' }],
      ['approval.respond', { choice: 'session', request_id: 'approval-1', session_id: 'runtime-1' }]
    ])
  })
})
