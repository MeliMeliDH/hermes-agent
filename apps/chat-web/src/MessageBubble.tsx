import { createElement, Fragment, type ReactNode, useEffect, useState } from 'react'

import { HERMES_BASE_PATH } from './auth'
import type { ClarifyQuestionModel, InputRequestModel, InputResponse, MessageBubbleModel } from './chat-state'
import { initialsForName, type ProfileIdentity } from './identity'
import { type MessageAttachment, safeMediaUrl } from './message-content'

interface MessageBubbleProps {
  identity?: ProfileIdentity
  message: MessageBubbleModel
  onInputResponse?: (request: InputRequestModel, response: InputResponse) => Promise<void>
}

const INLINE_MARKDOWN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|sandbox:\/)[^\s)]+\))/g

function sandboxDownloadHref(target: string): string | undefined {
  if (!target.startsWith('sandbox:/')) {return undefined}
  const path = target.slice('sandbox:'.length)

  if (!path.startsWith('/')) {return undefined}
  const params = new URLSearchParams({ path })

  if (typeof window !== 'undefined' && !window.__HERMES_AUTH_REQUIRED__ && window.__HERMES_SESSION_TOKEN__) {
    params.set('token', window.__HERMES_SESSION_TOKEN__)
  }

  return `${HERMES_BASE_PATH}/api/files/download?${params.toString()}`
}

function inlineMarkdown(text: string): ReactNode[] {
  return text.split(INLINE_MARKDOWN).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {return <strong key={index}>{part.slice(2, -2)}</strong>}

    if (part.startsWith('`') && part.endsWith('`')) {return <code key={index}>{part.slice(1, -1)}</code>}
    const link = /^\[([^\]]+)\]\(((?:https?:\/\/|sandbox:\/)[^\s)]+)\)$/.exec(part)

    if (link) {
      const sandboxHref = sandboxDownloadHref(link[2]!)

      if (sandboxHref) {return <a download href={sandboxHref} key={index}>{link[1]}</a>}

      return <a href={link[2]} key={index} rel="noreferrer" target="_blank">{link[1]}</a>
    }

    return <Fragment key={index}>{part}</Fragment>
  })
}

function MarkdownText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/)

  return blocks.map((block, index) => {
    const lines = block.split('\n')

    if (lines.length > 1 && lines.every(line => /^[-*]\s+/.test(line))) {
      return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{inlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>)}</ul>
    }

    if (block.startsWith('```') && block.endsWith('```')) {
      return <pre key={index}><code>{block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code></pre>
    }

    return <p key={index}>{lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{inlineMarkdown(line)}</Fragment>)}</p>
  })
}

const ALLOWED_HINT_TAGS = new Set(['A', 'BLOCKQUOTE', 'BR', 'CODE', 'EM', 'IMG', 'LI', 'OL', 'P', 'PRE', 'STRONG', 'UL'])

function safeHref(value: string | null): string | undefined {
  return value && /^https?:\/\//i.test(value) ? value : undefined
}

function hintNode(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {return node.textContent}

  if (node.nodeType !== Node.ELEMENT_NODE) {return null}
  const element = node as Element
  const children = Array.from(element.childNodes).map((child, index) => hintNode(child, index))

  if (!ALLOWED_HINT_TAGS.has(element.tagName)) {return <Fragment key={key}>{children}</Fragment>}
  const tag = element.tagName.toLowerCase()

  if (tag === 'img') {
    const src = safeMediaUrl(element.getAttribute('src') ?? '')

    return src ? <img alt={element.getAttribute('alt') ?? 'Attached image'} key={key} loading="lazy" src={src} /> : null
  }

  const props = tag === 'a' ? { href: safeHref(element.getAttribute('href')), rel: 'noreferrer', target: '_blank' } : {}

  return createElement(tag, { ...props, key }, children)
}

function AttachmentList({ attachments = [] }: { attachments?: MessageAttachment[] }) {
  if (attachments.length === 0) {return null}

  return (
    <div className="message-attachments">
      {attachments.map((attachment, index) => {
        if (attachment.mediaPath) {
          return <MediaPathAttachment attachment={attachment} key={`${attachment.mediaPath}-${index}`} />
        }

        if (attachment.kind === 'image' && attachment.url) {
          return <img alt={attachment.name} className="message-image" key={`${attachment.url}-${index}`} loading="lazy" src={attachment.url} />
        }

        const label = `${attachment.kind === 'image' ? 'Image' : 'File'} · ${attachment.name}`

        return attachment.url ? (
          <a className="message-file" href={attachment.url} key={`${attachment.name}-${index}`} rel="noreferrer" target="_blank">{label}</a>
        ) : (
          <span className="message-file" key={`${attachment.name}-${index}`}>{label}</span>
        )
      })}
    </div>
  )
}

/** Resolves a server-local path (this deployment's real upload format, e.g.
 * "[Image attached at: /home/.../img_x.png]") via GET /api/media, which
 * returns a base64 data URL for auth-gated, path-restricted files under the
 * agent's own media roots (hermes_cli/web_routers/files.py). The browser
 * cannot read an arbitrary local filesystem path directly. */
function MediaPathAttachment({ attachment }: { attachment: MessageAttachment }) {
  const [dataUrl, setDataUrl] = useState<string | undefined>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true

    setDataUrl(undefined)
    setFailed(false)

    const headers = new Headers()

    if (!window.__HERMES_AUTH_REQUIRED__ && window.__HERMES_SESSION_TOKEN__) {
      headers.set('X-Hermes-Session-Token', window.__HERMES_SESSION_TOKEN__)
    }

    fetch(`${HERMES_BASE_PATH}/api/media?path=${encodeURIComponent(attachment.mediaPath ?? '')}`, { credentials: 'include', headers })
      .then(response => { if (!response.ok) {throw new Error(`HTTP ${response.status}`)}

 return response.json() })
      .then((body: { data_url?: string }) => { if (active && body.data_url) {setDataUrl(body.data_url)} else if (active) {setFailed(true)} })
      .catch(() => { if (active) {setFailed(true)} })

    return () => { active = false }
  }, [attachment.mediaPath])

  if (failed) {
    return <span className="message-file">{`${attachment.kind === 'image' ? 'Image' : 'File'} · ${attachment.name} (unavailable)`}</span>
  }

  if (!dataUrl) {
    return <span className="message-file message-file--loading">{`Loading ${attachment.name}…`}</span>
  }

  if (attachment.kind === 'image') {
    return <img alt={attachment.name} className="message-image" loading="lazy" src={dataUrl} />
  }

  return <a className="message-file" download={attachment.name} href={dataUrl}>{`File · ${attachment.name}`}</a>
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') {return value}

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function ToolCall({ tool }: { tool: NonNullable<MessageBubbleModel['tool']> }) {
  const compactArgs = displayValue(tool.args ?? {})

  return (
    <details className="tool-call">
      <summary>
        <strong>{tool.name}</strong>
        <code>{compactArgs.replace(/\s+/g, ' ')}</code>
        <span>{tool.status}</span>
      </summary>
      <div className="tool-call-details">
        <strong>Arguments</strong>
        <pre><code>{compactArgs}</code></pre>
        {tool.preview !== undefined && <><strong>Preview</strong><pre><code>{displayValue(tool.preview)}</code></pre></>}
        {tool.progress !== undefined && <><strong>Progress</strong><pre><code>{displayValue(tool.progress)}</code></pre></>}
        {tool.result !== undefined && <><strong>Result</strong><pre><code>{displayValue(tool.result)}</code></pre></>}
      </div>
    </details>
  )
}

const APPROVAL_LABELS: Record<string, string> = {
  always: 'Always allow',
  deny: 'Reject',
  once: 'Run once',
  session: 'Allow for session'
}

function replayedSelections(question: ClarifyQuestionModel, answer: unknown): string[] {
  if (typeof answer !== 'string') {return []}

  if (question.multiSelect) {
    try {
      const parsed = JSON.parse(answer)

      if (Array.isArray(parsed) && parsed.every(value => typeof value === 'string')) {return parsed}
    } catch {
      // Legacy scalar answers remain selectable below.
    }
  }

  return question.choices?.includes(answer) ? [answer] : []
}

function InputPrompt({ onRespond, request }: {
  onRespond?: (request: InputRequestModel, response: InputResponse) => Promise<void>
  request: InputRequestModel
}) {
  const [sending, setSending] = useState(false)

  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(
    (request.questions ?? []).flatMap(question => {
      const answer = request.answers?.[question.qid]

      return typeof answer === 'string' && replayedSelections(question, answer).length === 0 ? [[question.qid, answer]] : []
    })
  ))

  const [selections, setSelections] = useState<Record<string, string[]>>(() => Object.fromEntries(
    (request.questions ?? []).map(question => [question.qid, replayedSelections(question, request.answers?.[question.qid])])
  ))

  const respond = (response: InputResponse) => {
    if (!onRespond || sending || request.resolved) {return}
    setSending(true)
    void onRespond(request, response).finally(() => setSending(false))
  }

  const toggleChoice = (key: string, choice: string, multiSelect: boolean) => {
    setDrafts(current => ({ ...current, [key]: '' }))
    setSelections(current => {
      const selected = current[key] ?? []

      const next = multiSelect
        ? selected.includes(choice) ? selected.filter(value => value !== choice) : [...selected, choice]
        : [choice]

      return { ...current, [key]: next }
    })
  }

  const responseState = request.expired
    ? 'Request expired.'
    : request.response === undefined
      ? 'Response sent.'
      : `Response sent: ${Array.isArray(request.response)
          ? request.response.map(item => item.answer).filter(Boolean).join(', ')
          : APPROVAL_LABELS[request.response] ?? request.response}`

  if (request.kind === 'approval') {
    const approvalChoices = request.choices?.length ? request.choices : ['once', 'deny']

    return (
      <section className="input-request" data-kind="approval">
        <strong>Approval required</strong>
        <p>{request.description || request.question}</p>
        {request.command && <pre><code>{request.command}</code></pre>}
        {request.resolved ? <p className="input-request-resolved" role="status">{responseState}</p> : (
          <div className="input-request-actions">
            {approvalChoices.map((choice, index) => (
              <button
                className={`button${index === 0 ? ' button-primary' : ''}`}
                disabled={sending}
                key={choice}
                onClick={() => respond(choice)}
                type="button"
              >{APPROVAL_LABELS[choice] ?? choice}</button>
            ))}
          </div>
        )}
      </section>
    )
  }

  const questions = request.questions ?? []

  if (questions.length > 0) {
    const answerFor = (question: ClarifyQuestionModel): string => {
      const selected = selections[question.qid] ?? []

      if (selected.length > 0) {return question.multiSelect ? JSON.stringify(selected) : selected[0]!}

      return (drafts[question.qid] ?? '').trim()
    }

    const allAnswered = questions.every(question => Boolean(answerFor(question)))

    return (
      <form className="input-request" data-kind="clarify" onSubmit={event => {
        event.preventDefault()

        if (allAnswered) {
          respond(questions.map(question => ({ answer: answerFor(question), questionId: question.qid })))
        }
      }}>
        <strong>Hermes needs your input</strong>
        {questions.map(question => {
          const hasChoices = Boolean(question.choices?.length)

          return (
            <fieldset className="input-request-question" disabled={sending || request.resolved} key={question.qid}>
              <legend>{question.question}</legend>
              {hasChoices && (
                <div className="input-request-options">
                  {question.choices!.map(choice => (
                    <label key={choice}>
                      <input
                        checked={(selections[question.qid] ?? []).includes(choice)}
                        onChange={() => toggleChoice(question.qid, choice, question.multiSelect)}
                        type={question.multiSelect ? 'checkbox' : 'radio'}
                      />
                      {choice}
                    </label>
                  ))}
                </div>
              )}
              <input
                aria-label={`${question.question} response`}
                onChange={event => {
                  setSelections(current => ({ ...current, [question.qid]: [] }))
                  setDrafts(current => ({ ...current, [question.qid]: event.target.value }))
                }}
                placeholder="Type your answer…"
                type="text"
                value={drafts[question.qid] ?? ''}
              />
            </fieldset>
          )
        })}
        {request.resolved
          ? <p className="input-request-resolved" role="status">{responseState}</p>
          : <button className="button button-primary" disabled={sending || !allAnswered} type="submit">Confirm and continue</button>}
      </form>
    )
  }

  const key = 'single'
  const hasChoices = Boolean(request.choices?.length)
  const selected = selections[key] ?? []
  const draft = drafts[key] ?? ''
  const answer = draft.trim() || (request.multiSelect ? (selected.length ? JSON.stringify(selected) : '') : selected[0] ?? '')

  return (
    <form className="input-request" data-kind="clarify" onSubmit={event => {
      event.preventDefault()

      if (answer) {respond(answer)}
    }}>
      <strong>Hermes needs your input</strong>
      <p>{request.question}</p>
      {hasChoices && (
        <div className="input-request-options">
          {request.choices!.map(choice => (
            <label key={choice}>
              <input
                checked={selected.includes(choice)}
                disabled={sending || request.resolved}
                onChange={() => toggleChoice(key, choice, Boolean(request.multiSelect))}
                type={request.multiSelect ? 'checkbox' : 'radio'}
              />
              {choice}
            </label>
          ))}
        </div>
      )}
      {request.resolved ? <p className="input-request-resolved" role="status">{responseState}</p> : (
        <div className="input-request-response">
          <input
            aria-label="Response"
            disabled={sending}
            name="answer"
            onChange={event => {
              setSelections(current => ({ ...current, [key]: [] }))
              setDrafts(current => ({ ...current, [key]: event.target.value }))
            }}
            type="text"
            value={draft}
          />
          <button className="button button-primary" disabled={sending || !answer} type="submit">Respond</button>
        </div>
      )}
    </form>
  )
}

function ErrorSurface({ message }: { message: MessageBubbleModel }) {
  if (message.status !== 'error') {return null}
  const detail = message.errorSurface === undefined ? '' : displayValue(message.errorSurface)

  return (
    <div className="message-error" role="alert">
      <strong>{message.error || 'Response ended with an error.'}</strong>
      {detail && <pre><code>{detail}</code></pre>}
    </div>
  )
}

function RenderedContent({ message }: { message: MessageBubbleModel }) {
  const hint = message.rendered

  if (hint && hint.includes('<') && typeof DOMParser !== 'undefined') {
    const body = new DOMParser().parseFromString(hint, 'text/html').body

    return <>{Array.from(body.childNodes).map((node, index) => hintNode(node, index))}</>
  }

  return <MarkdownText text={message.text} />
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) {return 'Time unavailable'}

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp * 1000)
}

export function MessageBubble({ identity, message, onInputResponse }: MessageBubbleProps) {
  const avatar = identity?.avatar
  const initials = initialsForName(message.senderName)
  const timestamp = formatTimestamp(message.timestamp)

  return (
    <article
      className={`message-row message-row--${message.role}`}
      data-message-bubble
      data-role={message.role}
      data-streaming={message.streaming ? 'true' : 'false'}
    >
      <div aria-label={`${message.senderName} avatar`} className="avatar">
        {avatar ? <img alt="" src={avatar} /> : <span aria-hidden>{initials}</span>}
      </div>
      <div className="message-column">
        <header className="message-meta">
          <strong>{message.senderName}</strong>
          <time dateTime={message.timestamp ? new Date(message.timestamp * 1000).toISOString() : undefined}>{timestamp}</time>
          {message.interim && <span className="message-label">Interim</span>}
        </header>
        <div className="message-bubble">
          {message.inputRequest && <InputPrompt onRespond={onInputResponse} request={message.inputRequest} />}
          {message.reasoning && (
            <details className="message-reasoning">
              <summary>Thinking</summary>
              <MarkdownText text={message.reasoning} />
            </details>
          )}
          {message.tool && <ToolCall tool={message.tool} />}
          {message.text && <RenderedContent message={message} />}
          <AttachmentList attachments={message.attachments} />
          {message.streaming && <span aria-label="Streaming" className="streaming-caret" />}
          <ErrorSurface message={message} />
        </div>
      </div>
    </article>
  )
}
