import { createElement, Fragment, type ReactNode } from 'react'

import type { MessageBubbleModel } from './chat-state'
import { initialsForName, type ProfileIdentity } from './identity'

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

const ALLOWED_HINT_TAGS = new Set(['A', 'BLOCKQUOTE', 'BR', 'CODE', 'EM', 'LI', 'OL', 'P', 'PRE', 'STRONG', 'UL'])

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
  const props = tag === 'a' ? { href: safeHref(element.getAttribute('href')), rel: 'noreferrer', target: '_blank' } : {}

  return createElement(tag, { ...props, key }, children)
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
          <RenderedContent message={message} />
          {message.streaming && <span aria-label="Streaming" className="streaming-caret" />}
          {message.status === 'error' && <p className="message-error">Response ended with an error.</p>}
        </div>
      </div>
    </article>
  )
}
