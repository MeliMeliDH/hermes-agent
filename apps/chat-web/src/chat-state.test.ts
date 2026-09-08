import { describe, expect, it } from 'vitest'

import { appendLocalMessage, applyMessageEvent, historyToBubbles } from './chat-state'

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

  it('projects the gateway data-image history shape into an attachment', () => {
    const bubbles = historyToBubbles(
      [{
        role: 'user',
        text: 'Caption\n[Image attached at: /tmp/photo.png]\ndata:image/png;base64,aGVsbG8='
      }],
      'default'
    )

    expect(bubbles[0]).toMatchObject({
      attachments: [
        { kind: 'image', name: 'photo.png', mediaPath: '/tmp/photo.png' },
        { kind: 'image', name: 'Attached image', url: 'data:image/png;base64,aGVsbG8=' }
      ],
      role: 'user',
      text: 'Caption'
    })
  })

  it('restores canonical persisted image and file refs after reopening a session', () => {
    const [bubble] = historyToBubbles([
      {
        role: 'user',
        text: 'Review these\n@image:`/home/hermes/.hermes/images/upload one.png`\n@file:`attachments/notes one.txt`'
      }
    ], 'default')

    expect(bubble).toMatchObject({
      attachments: [
        { kind: 'image', mediaPath: '/home/hermes/.hermes/images/upload one.png', name: 'upload one.png' },
        { kind: 'file', name: 'notes one.txt' }
      ],
      text: 'Review these'
    })
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

describe('appendLocalMessage', () => {
  it('adds an optimistic attachment-only user bubble without exposing base64 payloads', () => {
    const bubbles = appendLocalMessage(
      [],
      'user',
      '',
      '',
      now,
      [{ kind: 'image', name: 'photo.png', url: 'blob:preview' }]
    )

    expect(bubbles[0]).toMatchObject({
      attachments: [{ kind: 'image', name: 'photo.png', url: 'blob:preview' }],
      role: 'user',
      text: ''
    })
  })

  it('adds an optimistic user echo and system command output with stable roles', () => {
    let bubbles = appendLocalMessage([], 'user', 'hello', 'hello', now)
    bubbles = appendLocalMessage(bubbles, 'system', '/status', 'Session is healthy.', now)

    expect(bubbles).toMatchObject([
      { role: 'user', senderName: 'You', text: 'hello', streaming: false },
      { role: 'system', senderName: 'Hermes', text: '/status\nSession is healthy.', streaming: false }
    ])
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
