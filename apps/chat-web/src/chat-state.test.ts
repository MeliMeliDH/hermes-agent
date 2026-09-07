import { describe, expect, it } from 'vitest'

import { applyMessageEvent, historyToBubbles } from './chat-state'

const now = () => 1_700_000_000

describe('historyToBubbles', () => {
  it('projects real gateway history into attributed user and assistant bubbles', () => {
    const bubbles = historyToBubbles(
      [
        { role: 'user', text: 'Hello', timestamp: 100 },
        { role: 'assistant', text: 'Hi **Melissa**', timestamp: 101 }
      ],
      'default'
    )

    expect(bubbles).toMatchObject([
      { role: 'user', senderName: 'You', text: 'Hello', timestamp: 100 },
      { role: 'assistant', profileName: 'default', senderName: 'Victoria Hermes', text: 'Hi **Melissa**', timestamp: 101 }
    ])
  })

  it('renders an inter-agent delivery as the sending profile instead of the human', () => {
    const bubbles = historyToBubbles(
      [{ role: 'user', text: 'Message from 🤖 Researcher (@research): Findings ready.' }],
      'default'
    )

    expect(bubbles[0]).toMatchObject({
      role: 'assistant',
      profileName: 'research',
      senderName: 'Researcher',
      text: 'Findings ready.'
    })
  })
})

describe('applyMessageEvent', () => {
  it('appends deltas and finalizes one streaming assistant bubble without duplication', () => {
    let bubbles = applyMessageEvent([], { type: 'message.start' }, 'default', now)
    bubbles = applyMessageEvent(bubbles, { type: 'message.delta', payload: { text: 'Hel' } }, 'default', now)
    bubbles = applyMessageEvent(bubbles, { type: 'message.delta', payload: { text: 'lo' } }, 'default', now)
    bubbles = applyMessageEvent(
      bubbles,
      { type: 'message.complete', payload: { rendered: '<p>Hello</p>', status: 'complete', text: 'Hello', usage: { calls: 1 } } },
      'default',
      now
    )

    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]).toMatchObject({
      rendered: '<p>Hello</p>',
      status: 'complete',
      streaming: false,
      text: 'Hello',
      usage: { calls: 1 }
    })
  })

  it('seals interim commentary and starts a later final segment', () => {
    let bubbles = applyMessageEvent([], { type: 'message.delta', payload: { text: 'Checking.' } }, 'helper', now)
    bubbles = applyMessageEvent(
      bubbles,
      { type: 'message.interim', payload: { already_streamed: true, text: 'Checking.' } },
      'helper',
      now
    )
    bubbles = applyMessageEvent(bubbles, { type: 'message.delta', payload: { text: 'Done.' } }, 'helper', now)
    bubbles = applyMessageEvent(bubbles, { type: 'message.complete', payload: { status: 'complete', text: 'Done.' } }, 'helper', now)

    expect(bubbles).toMatchObject([
      { interim: true, streaming: false, text: 'Checking.' },
      { interim: false, streaming: false, text: 'Done.' }
    ])
  })
})
