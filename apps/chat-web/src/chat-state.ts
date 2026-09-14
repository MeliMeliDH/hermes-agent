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
  tool_call_id?: null | string
  tool_calls?: unknown
  tool_name?: string
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

// Contextual activity icon (#9): a quick visual flag for what KIND of
// activity a tool call represents, matching the pattern Melissa already
// gets from Discord bots (browser icon for web browsing, wrench for
// patching/coding, etc.) -- keyed off the real tool names registered in
// tools/registry.py (see tools/AGENTS.md). Table-driven, not an if/elif
// ladder on tool name (root code-shape rule), and matched by PREFIX since
// several tool families share one (search_files vs read_file are both
// "file", browser_exec vs browser_cdp are both "browser").
const ACTIVITY_EMOJI_TABLE: [prefix: string, emoji: string][] = [
  ['browser', '🌐'],
  ['patch', '🔧'],
  ['write_file', '🔧'],
  ['terminal', '🔧'],
  ['execute_code', '🔧'],
  ['read_file', '📖'],
  ['search_files', '🔍'],
  ['session_search', '🔍'],
  ['web_search', '🔍'],
  ['web_extract', '🔍'],
  ['send_message', '✍️'],
  ['text_to_speech', '🎙️'],
  ['image_generate', '🎨'],
  ['clarify', '❓'],
  ['delegate_task', '🤝'],
  ['memory', '🧠'],
  ['todo', '📋'],
  ['cronjob', '⏰'],
  ['computer_use', '🖥️'],
  ['vision_analyze', '👁️']
]

export function activityEmojiForTool(name: string): string | undefined {
  return ACTIVITY_EMOJI_TABLE.find(([prefix]) => name.startsWith(prefix))?.[1]
}

export interface ClarifyQuestionModel {
  choices?: string[]
  multiSelect: boolean
  qid: string
  question: string
}

export interface ClarifyAnswer {
  answer: string
  questionId: string
}

export type InputResponse = ClarifyAnswer[] | string

export interface InputRequestModel {
  answers?: Record<string, unknown>
  choices?: string[]
  command?: string
  description?: string
  expired?: boolean
  kind: 'approval' | 'clarify'
  multiSelect?: boolean
  question: string
  questions?: ClarifyQuestionModel[]
  requestId: string
  resolved?: boolean
  response?: InputResponse
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
  // The message this one was sent as a reply to (Discord-style quote-reply,
  // #8). Kept as a lightweight snapshot (role/senderName/text), not a live
  // reference to the original bubble, so it survives history reloads and
  // regenerate/resend without needing the original message to still exist
  // in the current `messages` array.
  replyTo?: ReplyReference
  role: 'assistant' | 'system' | 'user'
  senderName: string
  status?: string
  streaming: boolean
  text: string
  timestamp: number
  tool?: ToolCallModel
  // Derived, user-message-only status mirroring a Discord-style reaction:
  // no gateway event distinguishes "seen" from "turn started" or "task
  // complete" from "turn complete", so this is set client-side from the
  // existing message.start / message.complete events on the assistant
  // turn that followed this user message.
  turnStatus?: 'done' | 'pending' | 'seen'
  usage?: unknown
}

export interface ReplyReference {
  role: MessageBubbleModel['role']
  senderName: string
  text: string
}

// Mirrors the exact gateway-side convention (gateway/run_inbound.py
// `_prepend_inbound_reply_context`): a `[Replying to: "..."]` pointer
// prepended to the actual prompt text sent to the model, so Hermes has real
// disambiguating context -- not just a client-side visual quote. Sends the
// FULL quoted text, never a truncated preview (a preview would silently
// drop later list items/code from the model's view of what's being quoted).
export function buildReplyPrefixedText(reply: ReplyReference, input: string): string {
  const quoted = reply.text.trim()

  if (!quoted) {return input}
  const who = reply.role === 'user' ? ' your previous message' : ''

  return `[Replying to${who}: "${quoted}"]\n\n${input}`
}

// Inverse of buildReplyPrefixedText, applied when replaying stored history
// so the quoted-reply UI (MessageBubble's reply preview) survives a page
// reload instead of showing the raw `[Replying to: "..."]` bracket as part
// of the message body. The exact quoted sender's name/role isn't
// recoverable from the bracket text alone (only "your previous message"
// vs. not distinguishes user-quoting-self from quoting the assistant), so
// this only reconstructs enough to render a reply banner, not to re-link to
// the original bubble.
const REPLY_PREFIX_RE = /^\[Replying to( your previous message)?: "([\s\S]*)"\]\n\n([\s\S]*)$/

export function splitReplyPrefix(text: string, assistantName: string): { reply?: ReplyReference; text: string } {
  const match = REPLY_PREFIX_RE.exec(text)

  if (!match) {return { text }}
  const isOwnMessage = Boolean(match[1])

  return {
    reply: { role: isOwnMessage ? 'user' : 'assistant', senderName: isOwnMessage ? 'You' : assistantName, text: match[2]! },
    text: match[3]!
  }
}

export interface ToolPayload {
  args?: unknown
  context?: unknown
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

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') {return value}

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function storedToolCall(call: unknown, fallbackId: string): ToolCallModel {
  const row = recordFromUnknown(call) ?? {}
  const fn = recordFromUnknown(row.function)
  const input = recordFromUnknown(row.input)
  const rawArgs = fn?.arguments ?? row.arguments ?? row.args ?? row.input

  return {
    ...(rawArgs !== undefined ? { args: parseMaybeJson(rawArgs) } : {}),
    name: String(row.name ?? row.tool_name ?? fn?.name ?? input?.name ?? 'tool'),
    status: 'running',
    toolId: String(row.id ?? row.tool_call_id ?? fallbackId)
  }
}

export function historyToBubbles(history: GatewayHistoryMessage[], profileName: string): MessageBubbleModel[] {
  const bubbles: MessageBubbleModel[] = []

  history.forEach((message, index) => {
    const id = message.row_id === undefined ? `history-${index}` : `history-row-${message.row_id}`
    const timestamp = typeof message.timestamp === 'number' ? message.timestamp : 0

    if (message.role === 'tool') {
      const toolId = message.tool_call_id?.trim() || id
      const name = message.tool_name?.trim() || message.name?.trim() || 'tool'
      const match = bubbles.findLastIndex(bubble => bubble.tool?.toolId === toolId || (!message.tool_call_id && bubble.tool?.name === name))
      const result = parseMaybeJson(message.content ?? message.text ?? message.context ?? '')
      const preview = message.context

      if (match >= 0) {
        const bubble = bubbles[match]!
        const tool = bubble.tool!
        bubbles[match] = {
          ...bubble,
          streaming: false,
          tool: {
            ...tool,
            ...(message.args !== undefined ? { args: parseMaybeJson(message.args) } : {}),
            ...(preview !== undefined ? { preview } : {}),
            name,
            result,
            status: 'complete'
          }
        }
      } else {
        bubbles.push(toolRow({
          ...(message.args !== undefined ? { args: parseMaybeJson(message.args) } : {}),
          ...(preview !== undefined ? { preview } : {}),
          name,
          result,
          status: 'complete',
          toolId
        }, timestamp, profileName))
      }

      return
    }

    const content = extractMessageContent(historyText(message).trim())
    const text = content.text
    const reasoning = historyReasoning(message)

    if (message.display_kind !== 'hidden') {
      if (message.role === 'user' && (text || content.attachments.length > 0)) {
        const delivery = AGENT_MESSAGE_RE.exec(text)

        if (delivery) {
          const senderName = (delivery[1] || delivery[3] || 'agent').trim()
          const senderProfile = (delivery[2] || delivery[3] || senderName).trim()
          bubbles.push({
            ...assistantBubble(id, senderProfile, timestamp, (delivery[4] || '').trim(), false, content.attachments),
            senderName
          })
        } else {
          const { reply, text: bodyText } = splitReplyPrefix(text, displayNameForProfile(profileName))
          bubbles.push({
            ...(content.attachments.length ? { attachments: content.attachments } : {}),
            ...(reply ? { replyTo: reply } : {}),
            id,
            interim: false,
            role: 'user',
            senderName: 'You',
            streaming: false,
            text: bodyText,
            timestamp
          })
        }
      } else if (message.role === 'assistant' && (text || content.attachments.length > 0 || reasoning)) {
        bubbles.push({ ...assistantBubble(id, profileName, timestamp, text, false, content.attachments), ...(reasoning ? { reasoning } : {}) })
      } else if (message.role !== 'assistant' && message.role !== 'user' && (text || content.attachments.length > 0 || reasoning)) {
        bubbles.push({
          ...(content.attachments.length ? { attachments: content.attachments } : {}),
          id,
          interim: false,
          role: 'system',
          senderName: 'Hermes',
          streaming: false,
          text,
          timestamp
        })
      }
    }

    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      message.tool_calls.forEach((call, callIndex) => {
        bubbles.push(toolRow(storedToolCall(call, `${id}-tool-${callIndex}`), timestamp, profileName))
      })
    }
  })

  return bubbles
}

export function appendLocalMessage(
  messages: MessageBubbleModel[],
  role: 'system' | 'user',
  displayText: string,
  body = displayText,
  now: () => number = () => Date.now() / 1000,
  attachments: MessageAttachment[] = [],
  replyTo?: ReplyReference
): MessageBubbleModel[] {
  const text = role === 'system' && displayText !== body ? `${displayText}\n${body}` : body

  return [
    ...messages,
    {
      ...(attachments.length ? { attachments } : {}),
      ...(replyTo ? { replyTo } : {}),
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

// Finds the most recent user message at or before `beforeIndex` (or at the
// end of the list when omitted) so its derived turnStatus can be updated as
// the assistant's response to it progresses.
function findLastUserIndex(messages: MessageBubbleModel[], beforeIndex = messages.length): number {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {return index}
  }

  return -1
}

function withUserTurnStatus(
  messages: MessageBubbleModel[],
  status: MessageBubbleModel['turnStatus'],
  beforeIndex?: number
): MessageBubbleModel[] {
  const userIndex = findLastUserIndex(messages, beforeIndex)

  if (userIndex < 0 || messages[userIndex]!.turnStatus === status) {return messages}

  const next = [...messages]
  next[userIndex] = { ...next[userIndex]!, turnStatus: status }

  return next
}

function toolRow(tool: ToolCallModel, timestamp: number, profileName: string): MessageBubbleModel {
  return {
    id: `tool-${tool.toolId}`,
    interim: false,
    profileName,
    role: 'system',
    senderName: displayNameForProfile(profileName),
    streaming: tool.status === 'running',
    text: '',
    timestamp,
    tool
  }
}

export interface InputRequestPayload {
  answers?: unknown
  choices?: unknown
  command?: unknown
  description?: unknown
  multi_select?: unknown
  question?: unknown
  questions?: unknown
  request_id?: unknown
}

export function applyInputRequestEvent(
  messages: MessageBubbleModel[],
  event: Pick<GatewayEvent<InputRequestPayload>, 'payload' | 'type'>,
  now: () => number = () => Date.now() / 1000,
  profileName = 'default'
): MessageBubbleModel[] {
  if (!['clarify.request', 'approval.request'].includes(event.type)) {return messages}
  const payload = event.payload ?? {}
  const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''

  if (!requestId) {return messages}
  const kind = event.type === 'approval.request' ? 'approval' : 'clarify'
  const description = typeof payload.description === 'string' ? payload.description : ''
  const command = typeof payload.command === 'string' ? payload.command : ''

  const questions = Array.isArray(payload.questions)
    ? payload.questions.flatMap(item => {
        const row = recordFromUnknown(item)

        if (!row || typeof row.qid !== 'string' || typeof row.question !== 'string') {return []}

        const itemChoices = Array.isArray(row.choices)
          ? row.choices.filter((choice): choice is string => typeof choice === 'string')
          : undefined

        return [{
          ...(itemChoices?.length ? { choices: itemChoices } : {}),
          multiSelect: row.multi_select === true,
          qid: row.qid,
          question: row.question
        }]
      })
    : undefined

  const question = typeof payload.question === 'string'
    ? payload.question
    : questions?.length ? 'Hermes needs your input' : description || 'Approval required'

  const choices = Array.isArray(payload.choices) ? payload.choices.filter((choice): choice is string => typeof choice === 'string') : undefined
  const answers = recordFromUnknown(payload.answers)

  const inputRequest: InputRequestModel = {
    ...(answers ? { answers } : {}),
    ...(choices?.length ? { choices } : {}),
    ...(command ? { command } : {}),
    ...(description ? { description } : {}),
    ...(kind === 'clarify' && payload.multi_select === true ? { multiSelect: true } : {}),
    ...(questions?.length ? { questions } : {}),
    kind,
    question,
    requestId
  }

  const index = messages.findIndex(message => message.inputRequest?.requestId === requestId)

  const row: MessageBubbleModel = {
    id: `input-${requestId}`,
    inputRequest,
    interim: false,
    profileName,
    role: 'system',
    senderName: displayNameForProfile(profileName),
    streaming: false,
    text: '',
    timestamp: now()
  }

  if (index < 0) {return [...messages, row]}
  const next = [...messages]
  next[index] = { ...next[index]!, inputRequest }

  return next
}

export interface InputRequestExpirePayload {
  request_id?: unknown
}

export function applyInputRequestExpireEvent(
  messages: MessageBubbleModel[],
  event: Pick<GatewayEvent<InputRequestExpirePayload>, 'payload' | 'type'>
): MessageBubbleModel[] {
  if (!['clarify.expire', 'approval.expire'].includes(event.type)) {return messages}
  const requestId = typeof event.payload?.request_id === 'string' ? event.payload.request_id : ''

  if (!requestId) {return messages}

  return messages.map(message => message.inputRequest?.requestId === requestId
    ? { ...message, inputRequest: { ...message.inputRequest, expired: true, resolved: true } }
    : message)
}

export function resolveInputRequest(
  messages: MessageBubbleModel[],
  requestId: string,
  response?: InputResponse
): MessageBubbleModel[] {
  return messages.map(message => message.inputRequest?.requestId === requestId
    ? { ...message, inputRequest: { ...message.inputRequest, ...(response !== undefined ? { response } : {}), resolved: true } }
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
  if (!['thinking.delta', 'reasoning.delta', 'reasoning.available'].includes(event.type)) {return messages}
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
  now: () => number = () => Date.now() / 1000,
  profileName = 'default'
): MessageBubbleModel[] {
  if (!['tool.start', 'tool.progress', 'tool.complete'].includes(event.type)) {return messages}

  const payload = event.payload ?? {}
  const suppliedToolId = typeof payload.tool_id === 'string' && payload.tool_id ? payload.tool_id : undefined
  let index = suppliedToolId ? messages.findIndex(message => message.tool?.toolId === suppliedToolId) : -1

  if (!suppliedToolId && event.type === 'tool.progress') {
    if (typeof payload.name !== 'string' || !payload.preview) {return messages}
    index = messages.findIndex(message => message.tool?.status === 'running' && message.tool.name === payload.name)

    if (index < 0) {return messages}
  }

  if (!suppliedToolId && event.type !== 'tool.progress') {return messages}
  const previous = index >= 0 ? messages[index]!.tool : undefined
  const toolId = suppliedToolId ?? previous!.toolId
  const progress = event.type === 'tool.progress' ? payload : previous?.progress
  const result = event.type === 'tool.complete' ? (payload.result ?? payload.output) : previous?.result
  const preview = event.type === 'tool.start' ? payload.context : previous?.preview

  const tool: ToolCallModel = {
    ...(previous ?? {}),
    ...(payload.args !== undefined ? { args: payload.args } : {}),
    ...(preview !== undefined ? { preview } : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(result !== undefined ? { result } : {}),
    name: typeof payload.name === 'string' ? payload.name : previous?.name ?? 'tool',
    status: event.type === 'tool.complete' ? 'complete' : 'running',
    toolId
  }

  if (index < 0) {return [...messages, toolRow(tool, now(), profileName)]}
  const next = [...messages]
  next[index] = { ...next[index]!, streaming: tool.status === 'running', tool }

  return next
}

// Collapses a run of consecutive tool-call bubbles into one group for
// display (#10): once Hermes finishes a reply, several raw
// search_files/read_file/patch steps stayed visible as separate expanded
// blocks indefinitely -- noisy after the turn is done. Groups by
// ADJACENCY in the flat `messages` array (tool bubbles from one turn are
// already contiguous there), not by session/turn id, so this stays a pure
// projection with no new bookkeeping on MessageBubbleModel itself. A
// single isolated tool call is left as its own item (not wrapped) --
// grouping only pays off for a real run of 2+ steps; wrapping a lone call
// would add an extra collapse layer for no benefit.
export interface ToolStepGroupModel {
  id: string
  messages: MessageBubbleModel[]
  streaming: boolean
}

export type DisplayItem =
  | { group: ToolStepGroupModel; kind: 'tool-group' }
  | { kind: 'message'; message: MessageBubbleModel }

export function groupToolSteps(messages: MessageBubbleModel[]): DisplayItem[] {
  const items: DisplayItem[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]!

    if (message.role !== 'system' || !message.tool) {
      items.push({ kind: 'message', message })
      index += 1

      continue
    }

    const run: MessageBubbleModel[] = []
    let cursor = index

    while (cursor < messages.length) {
      const candidate = messages[cursor]!

      if (candidate.role !== 'system' || !candidate.tool) {break}
      run.push(candidate)
      cursor += 1
    }

    if (run.length > 1) {
      items.push({
        group: { id: `toolgroup-${run[0]!.id}`, messages: run, streaming: run.some(item => item.tool!.status === 'running') },
        kind: 'tool-group'
      })
    } else {
      items.push({ kind: 'message', message: run[0]! })
    }

    index = cursor
  }

  return items
}

// #11: a brief affirmative "ready for your next message" signal once a
// turn finishes, rather than the streaming-caret simply vanishing (which
// reads ambiguously as "done" vs. "stalled" -- Melissa's own framing when
// redirecting this item's scope, see #75 item 11). Pure edge-detector so
// the transition logic is unit-testable without a live timer/DOM: true
// only on the exact tick a turn goes from running to not-running. Deliberately
// does NOT fire on running->running (a queued follow-up starting immediately
// stays running, never crosses this edge) or on false->false (already idle).
export function turnJustCompleted(previousRunning: boolean, running: boolean): boolean {
  return previousRunning && !running
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

    return withUserTurnStatus(next, 'seen')
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

  // Errored turns stay marked "seen" rather than a false "done" checkmark --
  // the assistant read the message but did not successfully finish the task.
  const isError = Boolean(payload.error) || Boolean(payload.error_surface) || payload.status === 'error'

  return withUserTurnStatus(next, isError ? 'seen' : 'done', streamIndex)
}
