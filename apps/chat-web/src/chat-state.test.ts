import { describe, expect, it } from 'vitest'

import { activityEmojiForTool, appendLocalMessage, applyMessageEvent, buildReplyPrefixedText, groupToolSteps, historyToBubbles, splitReplyPrefix, turnJustCompleted } from './chat-state'

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

  it('marks the preceding user message seen on turn start and done on successful completion', () => {
    let bubbles = appendLocalMessage([], 'user', 'do the thing', undefined, now)
    bubbles = applyMessageEvent(bubbles, { type: 'message.start' }, 'default', now)

    expect(bubbles[0]).toMatchObject({ role: 'user', turnStatus: 'seen' })

    bubbles = applyMessageEvent(bubbles, { type: 'message.delta', payload: { text: 'Done.' } }, 'default', now)
    bubbles = applyMessageEvent(bubbles, { type: 'message.complete', payload: { status: 'complete', text: 'Done.' } }, 'default', now)

    expect(bubbles[0]).toMatchObject({ role: 'user', turnStatus: 'done' })
  })

  it('keeps the preceding user message at seen (not done) when the turn errors', () => {
    let bubbles = appendLocalMessage([], 'user', 'do the thing', undefined, now)
    bubbles = applyMessageEvent(bubbles, { type: 'message.start' }, 'default', now)
    bubbles = applyMessageEvent(
      bubbles,
      { type: 'message.complete', payload: { error: 'boom', status: 'error', text: '' } },
      'default',
      now
    )

    expect(bubbles[0]).toMatchObject({ role: 'user', turnStatus: 'seen' })
  })
})

describe('buildReplyPrefixedText', () => {
  it('prepends a disambiguation pointer matching the gateway inbound convention', () => {
    expect(buildReplyPrefixedText({ role: 'assistant', senderName: 'Hermes', text: 'The plan is X' }, 'do it')).toBe(
      '[Replying to: "The plan is X"]\n\ndo it'
    )
  })

  it("marks a reply to the user's own earlier message distinctly, like the gateway does", () => {
    expect(buildReplyPrefixedText({ role: 'user', senderName: 'You', text: 'first draft' }, 'actually change this')).toBe(
      '[Replying to your previous message: "first draft"]\n\nactually change this'
    )
  })

  it('sends the full quoted text uncut, never a truncated preview', () => {
    const long = 'a'.repeat(500)

    expect(buildReplyPrefixedText({ role: 'assistant', senderName: 'Hermes', text: long }, 'ok')).toContain(long)
  })

  it('falls back to the plain input when the quoted message is empty/whitespace-only', () => {
    expect(buildReplyPrefixedText({ role: 'assistant', senderName: 'Hermes', text: '   ' }, 'hello')).toBe('hello')
  })
})

describe('splitReplyPrefix', () => {
  it('recovers the reply banner from a stored reply-prefixed message, matching the sender name', () => {
    const result = splitReplyPrefix('[Replying to: "The plan is X"]\n\ndo it', 'Victoria Hermes')

    expect(result).toEqual({ reply: { role: 'assistant', senderName: 'Victoria Hermes', text: 'The plan is X' }, text: 'do it' })
  })

  it('recovers a self-reply as role user / "You", not the assistant name', () => {
    const result = splitReplyPrefix('[Replying to your previous message: "first draft"]\n\nactually change this', 'Victoria Hermes')

    expect(result).toEqual({ reply: { role: 'user', senderName: 'You', text: 'first draft' }, text: 'actually change this' })
  })

  it('is the exact inverse of buildReplyPrefixedText for a round trip through history', () => {
    const reply = { role: 'assistant' as const, senderName: 'Victoria Hermes', text: 'earlier answer' }
    const sent = buildReplyPrefixedText(reply, 'follow-up question')

    expect(splitReplyPrefix(sent, 'Victoria Hermes')).toEqual({ reply, text: 'follow-up question' })
  })

  it('leaves ordinary text (no reply prefix) untouched', () => {
    expect(splitReplyPrefix('just a normal message', 'Victoria Hermes')).toEqual({ text: 'just a normal message' })
  })
})

describe('activityEmojiForTool', () => {
  it('maps real registered tool names to a distinct activity icon', () => {
    expect(activityEmojiForTool('browser_exec')).toBe('🌐')
    expect(activityEmojiForTool('patch')).toBe('🔧')
    expect(activityEmojiForTool('write_file')).toBe('🔧')
    expect(activityEmojiForTool('search_files')).toBe('🔍')
    expect(activityEmojiForTool('read_file')).toBe('📖')
  })

  it('matches by prefix so a tool family shares one icon (browser_cdp, browser_exec)', () => {
    expect(activityEmojiForTool('browser_cdp')).toBe(activityEmojiForTool('browser_exec'))
  })

  it('returns undefined for an unmapped tool name rather than a wrong guess', () => {
    expect(activityEmojiForTool('some_future_tool_not_in_the_table')).toBeUndefined()
  })
})

describe('groupToolSteps', () => {
  const toolBubble = (id: string, name: string, status = 'complete') => ({
    id,
    interim: false,
    role: 'system' as const,
    senderName: 'Hermes',
    streaming: status === 'running',
    text: '',
    timestamp: 0,
    tool: { name, status, toolId: id }
  })

  const userBubble = (id: string) => ({
    id, interim: false, role: 'user' as const, senderName: 'You', streaming: false, text: 'hi', timestamp: 0
  })

  it('leaves a single isolated tool call as its own item, not wrapped in a group', () => {
    const items = groupToolSteps([userBubble('u1'), toolBubble('t1', 'read_file')])

    expect(items).toEqual([
      { kind: 'message', message: userBubble('u1') },
      { kind: 'message', message: toolBubble('t1', 'read_file') }
    ])
  })

  it('collapses a run of 2+ consecutive tool calls into one group', () => {
    const items = groupToolSteps([
      userBubble('u1'),
      toolBubble('t1', 'search_files'),
      toolBubble('t2', 'read_file'),
      toolBubble('t3', 'patch')
    ])

    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ kind: 'message', message: userBubble('u1') })
    expect(items[1]).toMatchObject({ group: { messages: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] }, kind: 'tool-group' })
  })

  it('marks a group as streaming when any of its steps is still running', () => {
    const items = groupToolSteps([toolBubble('t1', 'search_files'), toolBubble('t2', 'read_file', 'running')])

    expect(items[0]).toMatchObject({ group: { streaming: true } })
  })

  it('marks a group as not streaming once every step is complete', () => {
    const items = groupToolSteps([toolBubble('t1', 'search_files'), toolBubble('t2', 'read_file')])

    expect(items[0]).toMatchObject({ group: { streaming: false } })
  })

  it('does not merge two separate runs across an intervening non-tool message', () => {
    const items = groupToolSteps([
      toolBubble('t1', 'search_files'),
      toolBubble('t2', 'read_file'),
      userBubble('u1'),
      toolBubble('t3', 'patch'),
      toolBubble('t4', 'write_file')
    ])

    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ group: { messages: [{ id: 't1' }, { id: 't2' }] } })
    expect(items[1]).toEqual({ kind: 'message', message: userBubble('u1') })
    expect(items[2]).toMatchObject({ group: { messages: [{ id: 't3' }, { id: 't4' }] } })
  })
})

describe('turnJustCompleted', () => {
  it('is true exactly on the running -> not-running edge', () => {
    expect(turnJustCompleted(true, false)).toBe(true)
  })

  it('is false while a turn is still running (no edge crossed)', () => {
    expect(turnJustCompleted(true, true)).toBe(false)
  })

  it('is false when already idle before and after (no edge crossed)', () => {
    expect(turnJustCompleted(false, false)).toBe(false)
  })

  it('is false on the not-running -> running edge (a turn starting, not finishing)', () => {
    expect(turnJustCompleted(false, true)).toBe(false)
  })
})
