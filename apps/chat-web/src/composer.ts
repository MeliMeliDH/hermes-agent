import type { GatewayRequester } from './identity'

interface PromptSubmitResponse {
  status?: string
}

interface SlashDispatchResponse {
  display?: string
  message?: string
  notice?: string
  output?: string
  target?: string
  type?: string
  warning?: string
}

export interface SlashCatalog {
  commands?: Record<string, { desktop?: string | null }>
  pairs?: [string, string][]
  skills?: Record<string, { origin?: string; usage?: number }>
}

export interface SlashSuggestion {
  command: string
  description: string
  kind: 'command' | 'skill'
}

export type ComposerResult =
  | { kind: 'output'; text: string }
  | { displayText: string; kind: 'submitted'; status: string }
  | { kind: 'prefill'; text: string }

const WEB_UNAVAILABLE = new Set([
  '/clear',
  '/copy',
  '/exit',
  '/paste',
  '/prompt',
  '/quit',
  '/redraw',
  '/resume',
  '/sessions',
  '/snapshot',
  '/statusbar'
])

function parseSlash(text: string): { arg: string; command: string; name: string } {
  const command = text.trim()
  const body = command.replace(/^\/+/, '')
  const split = body.search(/\s/)
  const name = (split < 0 ? body : body.slice(0, split)).trim().toLowerCase()
  const arg = split < 0 ? '' : body.slice(split).trim()

  return { arg, command, name }
}

function outputText(result: SlashDispatchResponse): string {
  return [result.warning, result.output].filter(Boolean).join('\n')
}

async function submitPrompt(
  gateway: GatewayRequester,
  sessionId: string,
  text: string,
  displayText: string
): Promise<ComposerResult> {
  const result = await gateway.request<PromptSubmitResponse>('prompt.submit', { session_id: sessionId, text })

  return { displayText, kind: 'submitted', status: result.status ?? 'streaming' }
}

async function applyDispatch(
  gateway: GatewayRequester,
  sessionId: string,
  invocation: string,
  result: SlashDispatchResponse,
  depth: number
): Promise<ComposerResult> {
  if (result.type === 'alias' && result.target && depth < 4) {
    const { arg } = parseSlash(invocation)

    return runComposerInput(gateway, sessionId, `/${result.target}${arg ? ` ${arg}` : ''}`, depth + 1)
  }

  if (result.type === 'prefill') {
    return { kind: 'prefill', text: result.message ?? '' }
  }

  if (['send', 'skill'].includes(result.type ?? '') && result.message?.trim()) {
    return submitPrompt(gateway, sessionId, result.message, result.display?.trim() || invocation)
  }

  const output = outputText(result)

  if (output) {return { kind: 'output', text: output }}

  throw new Error(`${invocation}: gateway returned no output`)
}

export async function runComposerInput(
  gateway: GatewayRequester,
  sessionId: string,
  rawText: string,
  depth = 0
): Promise<ComposerResult> {
  const text = rawText.trim()

  if (!text) {throw new Error('Message cannot be empty')}

  if (!text.startsWith('/')) {return submitPrompt(gateway, sessionId, text, text)}

  const parsed = parseSlash(text)

  if (!parsed.name) {throw new Error('Enter a command after /')}

  let slashError: unknown

  try {
    const result = await gateway.request<SlashDispatchResponse>('slash.exec', {
      command: text.replace(/^\/+/, ''),
      session_id: sessionId
    })

    if (result.type) {return applyDispatch(gateway, sessionId, text, result, depth)}
    const output = outputText(result)

    if (output) {return { kind: 'output', text: output }}
  } catch (error) {
    slashError = error
  }

  try {
    const result = await gateway.request<SlashDispatchResponse>('command.dispatch', {
      arg: parsed.arg,
      name: parsed.name,
      session_id: sessionId
    })

    return applyDispatch(gateway, sessionId, text, result, depth)
  } catch (error) {
    throw slashError ?? error
  }
}

export function filterSlashCommands(catalog: SlashCatalog): SlashSuggestion[] {
  return (catalog.pairs ?? []).flatMap(([command, description]) => {
    const normalized = command.toLowerCase()
    const meta = catalog.commands?.[command] ?? catalog.commands?.[normalized]
    const isSkill = catalog.skills?.[command] !== undefined

    if (!isSkill && (WEB_UNAVAILABLE.has(normalized) || meta?.desktop === 'terminal' || meta?.desktop === 'messaging')) {
      return []
    }

    return [{ command, description, kind: isSkill ? 'skill' as const : 'command' as const }]
  })
}
