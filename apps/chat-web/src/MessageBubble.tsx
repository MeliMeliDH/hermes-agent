import { createElement, Fragment, type ReactNode, useEffect, useState } from 'react'

import { HERMES_BASE_PATH } from './auth'
import type { MessageBubbleModel } from './chat-state'
import { initialsForName, type ProfileIdentity } from './identity'
import { type MessageAttachment, safeMediaUrl } from './message-content'

interface MessageBubbleProps {
  identity?: ProfileIdentity
  message: MessageBubbleModel
}

const INLINE_MARKDOWN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g

function inlineMarkdown(text: string): ReactNode[] {
  return text.split(INLINE_MARKDOWN).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {return <strong key={index}>{part.slice(2, -2)}</strong>}

    if (part.startsWith('`') && part.endsWith('`')) {return <code key={index}>{part.slice(1, -1)}</code>}
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part)

    if (link) {return <a href={link[2]} key={index} rel="noreferrer" target="_blank">{link[1]}</a>}

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

export function MessageBubble({ identity, message }: MessageBubbleProps) {
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
          {message.text && <RenderedContent message={message} />}
          <AttachmentList attachments={message.attachments} />
          {message.streaming && <span aria-label="Streaming" className="streaming-caret" />}
          {message.status === 'error' && <p className="message-error">Response ended with an error.</p>}
        </div>
      </div>
    </article>
  )
}
