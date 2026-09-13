import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MessageBubble } from './MessageBubble'

const assistant = {
  id: 'a1',
  interim: false,
  profileName: 'default',
  role: 'assistant' as const,
  senderName: 'Victoria Hermes',
  streaming: false,
  text: '**Hello** `Melissa`',
  timestamp: 1_700_000_000
}

describe('MessageBubble', () => {
  it('renders assistant identity, avatar, timestamp, and markdown-ish content', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        identity={{ avatar: 'data:image/png;base64,avatar', displayName: 'Victoria Hermes', isDefault: true, name: 'default' }}
        message={assistant}
      />
    )

    expect(html).toContain('data-role="assistant"')
    expect(html).toContain('Victoria Hermes')
    expect(html).toContain('data:image/png;base64,avatar')
    expect(html).toContain('<strong>Hello</strong>')
    expect(html).toContain('<code>Melissa</code>')
    expect(html).toContain('<time')
  })

  it('renders extracted image attachments as images and files as chips', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          ...assistant,
          attachments: [
            { kind: 'image', name: 'photo.png', url: 'data:image/png;base64,aGVsbG8=' },
            { kind: 'file', name: 'report.pdf' }
          ],
          text: 'Attached results'
        }}
      />
    )

    expect(html).toContain('<img alt="photo.png"')
    expect(html).toContain('data:image/png;base64,aGVsbG8=')
    expect(html).toContain('message-file')
    expect(html).toContain('report.pdf')
  })

  it('renders sandbox file links as authenticated dashboard downloads', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          ...assistant,
          text: '[Download hello-world.md](sandbox:/home/hermes/.hermes/hermes-agent/hello-world.md)'
        }}
      />
    )

    expect(html).toContain('href="/api/files/download?path=%2Fhome%2Fhermes%2F.hermes%2Fhermes-agent%2Fhello-world.md"')
    expect(html).toContain('download=""')
    expect(html).not.toContain('sandbox:')
  })

  it('uses a monogram when an avatar asset is unavailable', () => {
    const html = renderToStaticMarkup(<MessageBubble message={{ ...assistant, profileName: 'research', senderName: 'research' }} />)
    expect(html).toContain('aria-label="research avatar"')
    expect(html).toContain('>R<')
  })

  it('renders markdown headings, italics, numbered lists, and blockquotes', () => {
    const html = renderToStaticMarkup(
      <MessageBubble message={{ ...assistant, text: '## Heading\n\nSome *italic* and _also italic_ text.\n\n1. First\n2. Second\n\n> A quoted line' }} />
    )

    expect(html).toContain('<h4>Heading</h4>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<em>also italic</em>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>First</li>')
    expect(html).toContain('<li>Second</li>')
    expect(html).toContain('<blockquote>A quoted line</blockquote>')
  })

  it('does not mangle bold text or inline code containing asterisks when checking for italics', () => {
    const html = renderToStaticMarkup(
      <MessageBubble message={{ ...assistant, text: '**Bold** and `a*b` and *italic*' }} />
    )

    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<code>a*b</code>')
    expect(html).toContain('<em>italic</em>')
  })

  it('shows a copy button for a completed message but no regenerate button without a handler', () => {
    const html = renderToStaticMarkup(<MessageBubble message={assistant} />)
    expect(html).toContain('aria-label="Copy message"')
    expect(html).not.toContain('aria-label="Regenerate response"')
  })

  it('shows a regenerate button for a completed assistant message when a handler is provided', () => {
    const html = renderToStaticMarkup(<MessageBubble message={assistant} onRegenerate={() => {}} />)
    expect(html).toContain('aria-label="Regenerate response"')
  })

  it('does not show a regenerate button for a user message even with a handler provided', () => {
    const html = renderToStaticMarkup(
      <MessageBubble message={{ ...assistant, role: 'user' }} onRegenerate={() => {}} />
    )

    expect(html).not.toContain('aria-label="Regenerate response"')
  })

  it('does not show message actions while a message is still streaming', () => {
    const html = renderToStaticMarkup(
      <MessageBubble message={{ ...assistant, streaming: true }} onRegenerate={() => {}} />
    )

    expect(html).not.toContain('aria-label="Copy message"')
    expect(html).not.toContain('aria-label="Regenerate response"')
  })
})
