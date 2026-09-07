import type { GatewayEvent } from '@hermes/shared'

import { displayNameForProfile } from './identity'
import { extractMessageContent, type MessageAttachment } from './message-content'

export interface GatewayHistoryMessage {
  args?: unknown
  content?: unknown
  context?: unknown
  display_content?: unknown
  display_kind?: string
  name?: string
  reasoning?: unknown
  reasoning_content?: unknown
  reasoning_details?: unknown
  codex_reasoning_items?: unknown
  role: string
  row_id?: number
  text?: unknown
  timestamp?: number
}

export interface ToolCallModel {
  args?: unknown
  name: string
  preview?: unknown
  progress?: unknown
  result?: unknown
  status: string
  toolId: string
}

export interface InputRequestModel {
  choices?: string[]
  command?: string
  description?: string
  kind: 'approval' | 'clarify'
  question: string
  requestId: string
  resolved?: boolean
}

export interface MessageBubbleModel {
  attachments?: MessageAttachment[]
  error?: string
  errorSurface?: unknown
  id: string
  inputRequest?: InputRequestModel
  interim: boolean
  profileName?: string
  rendered?: string
  reasoning?: string
  role: 'assistant' | 'system' | 'user'
  senderName: string
  status?: string
  streaming: boolean
  text: string
  timestamp: number
  tool?: ToolCallModel
  usage?: unknown
}

export interface ToolPayload {
  args?: unknown
  name?: string
  output?: unknown
  preview?: unknown
  result?: unknown
  status?: string
  tool_id?: string
  [key: string]: unknown
}

export interface MessagePayload {
  already_streamed?: boolean
  error?: string
  error_surface?: unknown
  reasoning?: unknown
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

function reasoningText(value: unknown): string {
  if (typeof value === 'string') {return value}

  if (Array.isArray(value)) {return value.map(reasoningText).filter(Boolean).join('\n')}

  if (!value || typeof value !== 'object') {return ''}

  const record = value as Record<string, unknown>

  return reasoningText(record.text ?? record.summary ?? record.content)
}

function historyReasoning(message: GatewayHistoryMessage): string {
  return [message.reasoning, message.reasoning_content, message.reasoning_details, message.codex_reasoning_items]
    .map(reasoningText)
    .find(Boolean) ?? ''
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
    const id = message.row_id === undefined ? `history-${index}` : `history-row-${message.row_id}`
    const timestamp = typeof message.timestamp === 'number' ? message.timestamp : 0

    if (message.role === 'tool') {
      return [toolRow({
        ...(message.args !== undefined ? { args: message.args } : {}),
        ...(message.context !== undefined ? { preview: message.context } : {}),
        name: message.name?.trim() || 'tool',
        status: 'complete',
        toolId: id
      }, timestamp)]
    }

    const content = extractMessageContent(historyText(message).trim())
    const text = content.text
    const reasoning = historyReasoning(message)

    if ((!text && content.attachments.length === 0 && !reasoning) || message.display_kind === 'hidden') {return []}

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
      return [{ ...assistantBubble(id, profileName, timestamp, text, false, content.attachments), ...(reasoning ? { reasoning } : {}) }]
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

function toolRow(tool: ToolCallModel, timestamp: number): MessageBubbleModel {
  return {
    id: `tool-${tool.toolId}`,
    interim: false,
    role: 'system',
    senderName: 'Hermes',
    streaming: tool.status === 'running',
    text: '',
    timestamp,
    tool
  }
}

export interface InputRequestPayload {
  choices?: unknown
  command?: unknown
  description?: unknown
  question?: unknown
  request_id?: unknown
}

export function applyInputRequestEvent(
  messages: MessageBubbleModel[],
  event: Pick<GatewayEvent<InputRequestPayload>, 'payload' | 'type'>,
  now: () => number = () => Date.now() / 1000
): MessageBubbleModel[] {
  if (!['clarify.request', 'approval.request'].includes(event.type)) {return messages}
  const payload = event.payload ?? {}
  const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''

  if (!requestId) {return messages}
  const kind = event.type === 'approval.request' ? 'approval' : 'clarify'
  const description = typeof payload.description === 'string' ? payload.description : ''
  const command = typeof payload.command === 'string' ? payload.command : ''
  const question = typeof payload.question === 'string' ? payload.question : description || 'Approval required'
  const choices = Array.isArray(payload.choices) ? payload.choices.filter((choice): choice is string => typeof choice === 'string') : undefined

  const inputRequest: InputRequestModel = {
    ...(choices?.length ? { choices } : {}),
    ...(command ? { command } : {}),
    ...(description ? { description } : {}),
    kind,
    question,
    requestId
  }

  const index = messages.findIndex(message => message.inputRequest?.requestId === requestId)

  const row: MessageBubbleModel = {
    id: `input-${requestId}`,
    inputRequest,
    interim: false,
    role: 'system',
    senderName: 'Hermes',
    streaming: false,
    text: '',
    timestamp: now()
  }

  if (index < 0) {return [...messages, row]}
  const next = [...messages]
  next[index] = { ...next[index]!, inputRequest }

  return next
}

export function resolveInputRequest(messages: MessageBubbleModel[], requestId: string): MessageBubbleModel[] {
  return messages.map(message => message.inputRequest?.requestId === requestId
    ? { ...message, inputRequest: { ...message.inputRequest, resolved: true } }
    : message)
}

export interface ReasoningPayload {
  text?: string
}

export function applyReasoningEvent(
  messages: MessageBubbleModel[],
  event: Pick<GatewayEvent<ReasoningPayload>, 'payload' | 'type'>,
  profileName: string,
  now: () => number = () => Date.now() / 1000
): MessageBubbleModel[] {
  if (!['thinking.delta', 'reasoning.delta'].includes(event.type)) {return messages}
  const delta = event.payload?.text ?? ''

  if (!delta) {return messages}
  const next = [...messages]
  let streamIndex = findStreamingIndex(next)

  if (streamIndex < 0) {
    next.push(assistantBubble(`live-${now()}-${next.length}`, profileName, now()))
    streamIndex = next.length - 1
  }

  const bubble = next[streamIndex]!
  next[streamIndex] = { ...bubble, reasoning: `${bubble.reasoning ?? ''}${delta}` }

  return next
}

export function applyToolEvent(
  messages: MessageBubbleModel[],
  event: Pick<GatewayEvent<ToolPayload>, 'payload' | 'type'>,
  now: () => number = () => Date.now() / 1000
): MessageBubbleModel[] {
  if (!['tool.start', 'tool.progress', 'tool.complete'].includes(event.type)) {return messages}

  const payload = event.payload ?? {}
  const toolId = typeof payload.tool_id === 'string' && payload.tool_id ? payload.tool_id : `${payload.name ?? 'tool'}-${now()}`
  const index = messages.findIndex(message => message.tool?.toolId === toolId)
  const previous = index >= 0 ? messages[index]!.tool : undefined
  const progress = event.type === 'tool.progress' ? payload : previous?.progress
  const result = event.type === 'tool.complete' ? (payload.result ?? payload.output) : previous?.result

  const tool: ToolCallModel = {
    ...(previous ?? {}),
    ...(payload.args !== undefined ? { args: payload.args } : {}),
    ...(payload.preview !== undefined ? { preview: payload.preview } : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(result !== undefined ? { result } : {}),
    name: typeof payload.name === 'string' ? payload.name : previous?.name ?? 'tool',
    status: event.type === 'tool.complete' ? payload.status ?? 'complete' : 'running',
    toolId
  }

  if (index < 0) {return [...messages, toolRow(tool, now())]}
  const next = [...messages]
  next[index] = { ...next[index]!, streaming: tool.status === 'running', tool }

  return next
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

  if (streamIndex < 0 && !(payload.text ?? '').trim() && payload.status !== 'error' && !payload.error_surface) {return next}
  const bubble = ensureStream()
  const completedContent = extractMessageContent(payload.text ?? bubble.text)
  next[streamIndex] = {
    ...bubble,
    ...(completedContent.attachments.length ? { attachments: completedContent.attachments } : {}),
    error: payload.error,
    errorSurface: payload.error_surface,
    rendered: payload.rendered ?? bubble.rendered,
    reasoning: reasoningText(payload.reasoning) || bubble.reasoning,
    status: payload.status ?? (payload.error ? 'error' : 'complete'),
    streaming: false,
    text: completedContent.text,
    usage: payload.usage
  }

  return next
}
