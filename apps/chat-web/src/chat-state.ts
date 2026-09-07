import type { GatewayEvent } from '@hermes/shared'

import { displayNameForProfile } from './identity'
import { extractMessageContent, type MessageAttachment } from './message-content'

export interface GatewayHistoryMessage {
  content?: unknown
  display_content?: unknown
  display_kind?: string
  role: string
  row_id?: number
  text?: unknown
  timestamp?: number
}

export interface MessageBubbleModel {
  attachments?: MessageAttachment[]
  id: string
  interim: boolean
  profileName?: string
  rendered?: string
  role: 'assistant' | 'system' | 'user'
  senderName: string
  status?: string
  streaming: boolean
  text: string
  timestamp: number
  usage?: unknown
}

export interface MessagePayload {
  already_streamed?: boolean
  error?: string
  rendered?: string
  status?: string
  text?: string
  usage?: unknown
}

const AGENT_MESSAGE_RE =
  /^(?:Message from (?:🤖\s*)?([^:\n(]{1,64}?)(?:\s*\(@([a-z0-9][a-z0-9_-]{0,63})\))?:\s*|\[Message from agent '([^']{1,64})'\]\s*)([\s\S]*)$/u

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') {return value}

  if (!Array.isArray(value)) {return ''}

  return value
    .map(part => {
      if (typeof part === 'string') {return part}

      if (!part || typeof part !== 'object') {return ''}
      const candidate = part as { content?: unknown; text?: unknown }

      return textFromUnknown(candidate.text ?? candidate.content)
    })
    .filter(Boolean)
    .join('\n')
}

function historyText(message: GatewayHistoryMessage): string {
  return textFromUnknown(message.display_content ?? message.text ?? message.content)
}

function assistantBubble(
  id: string,
  profileName: string,
  timestamp: number,
  text = '',
  streaming = true,
  attachments?: MessageAttachment[]
): MessageBubbleModel {
  return {
    ...(attachments?.length ? { attachments } : {}),
    id,
    interim: false,
    profileName,
    role: 'assistant',
    senderName: displayNameForProfile(profileName),
    streaming,
    text,
    timestamp
  }
}

export function historyToBubbles(history: GatewayHistoryMessage[], profileName: string): MessageBubbleModel[] {
  return history.flatMap((message, index) => {
    const content = extractMessageContent(historyText(message).trim())
    const text = content.text

    if ((!text && content.attachments.length === 0) || message.display_kind === 'hidden' || message.role === 'tool') {return []}

    const id = message.row_id === undefined ? `history-${index}` : `history-row-${message.row_id}`
    const timestamp = typeof message.timestamp === 'number' ? message.timestamp : 0

    if (message.role === 'user') {
      const delivery = AGENT_MESSAGE_RE.exec(text)

      if (delivery) {
        const senderName = (delivery[1] || delivery[3] || 'agent').trim()
        const senderProfile = (delivery[2] || delivery[3] || senderName).trim()

        return [{
          ...assistantBubble(id, senderProfile, timestamp, (delivery[4] || '').trim(), false, content.attachments),
          senderName
        }]
      }

      return [{
        ...(content.attachments.length ? { attachments: content.attachments } : {}),
        id,
        interim: false,
        role: 'user' as const,
        senderName: 'You',
        streaming: false,
        text,
        timestamp
      }]
    }

    if (message.role === 'assistant') {
      return [assistantBubble(id, profileName, timestamp, text, false, content.attachments)]
    }

    return [{
      ...(content.attachments.length ? { attachments: content.attachments } : {}),
      id,
      interim: false,
      role: 'system' as const,
      senderName: 'Hermes',
      streaming: false,
      text,
      timestamp
    }]
  })
}

export function appendLocalMessage(
  messages: MessageBubbleModel[],
  role: 'system' | 'user',
  displayText: string,
  body = displayText,
  now: () => number = () => Date.now() / 1000
): MessageBubbleModel[] {
  const text = role === 'system' && displayText !== body ? `${displayText}\n${body}` : body

  return [
    ...messages,
    {
      id: `local-${role}-${now()}-${messages.length}`,
      interim: false,
      role,
      senderName: role === 'user' ? 'You' : 'Hermes',
      streaming: false,
      text,
      timestamp: now()
    }
  ]
}

function findStreamingIndex(messages: MessageBubbleModel[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant' && messages[index]?.streaming) {return index}
  }

  return -1
}

export function applyMessageEvent(
  messages: MessageBubbleModel[],
  event: Pick<GatewayEvent<MessagePayload>, 'payload' | 'type'>,
  profileName: string,
  now: () => number = () => Date.now() / 1000
): MessageBubbleModel[] {
  if (!['message.start', 'message.delta', 'message.interim', 'message.complete'].includes(event.type)) {return messages}

  const payload = event.payload ?? {}
  const next = [...messages]
  let streamIndex = findStreamingIndex(next)

  const ensureStream = () => {
    if (streamIndex < 0) {
      next.push(assistantBubble(`live-${now()}-${next.length}`, profileName, now()))
      streamIndex = next.length - 1
    }

    return next[streamIndex]!
  }

  if (event.type === 'message.start') {
    ensureStream()

    return next
  }

  if (event.type === 'message.delta') {
    const bubble = ensureStream()
    next[streamIndex] = {
      ...bubble,
      rendered: payload.rendered ? `${bubble.rendered ?? ''}${payload.rendered}` : bubble.rendered,
      text: bubble.text + (payload.text ?? '')
    }

    return next
  }

  if (event.type === 'message.interim') {
    const text = payload.text ?? ''

    if (payload.already_streamed && streamIndex >= 0) {
      const bubble = next[streamIndex]!
      next[streamIndex] = { ...bubble, interim: true, streaming: false, text: bubble.text || text }
    } else if (text) {
      next.push({ ...assistantBubble(`interim-${now()}-${next.length}`, profileName, now(), text, false), interim: true })
    }

    return next
  }

  if (streamIndex < 0 && !(payload.text ?? '').trim()) {return next}
  const bubble = ensureStream()
  const completedContent = extractMessageContent(payload.text ?? bubble.text)
  next[streamIndex] = {
    ...bubble,
    ...(completedContent.attachments.length ? { attachments: completedContent.attachments } : {}),
    rendered: payload.rendered ?? bubble.rendered,
    status: payload.status ?? (payload.error ? 'error' : 'complete'),
    streaming: false,
    text: completedContent.text,
    usage: payload.usage
  }

  return next
}
