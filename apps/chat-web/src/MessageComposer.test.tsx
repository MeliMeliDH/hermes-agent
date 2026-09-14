import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { SelectedAttachment } from './attachments'
import { autoResizeHeight, MessageComposer } from './MessageComposer'

const suggestions = [
  { command: '/status', description: 'Show status', kind: 'command' as const },
  { command: '/research', description: 'Research skill', kind: 'skill' as const }
]

describe('MessageComposer', () => {
  it('renders send controls and accessible slash suggestions', () => {
    const html = renderToStaticMarkup(
      <MessageComposer
        busy={false}
        disabled={false}
        draft="/"
        onChange={() => undefined}
        onInterrupt={() => undefined}
        onSubmit={() => undefined}
        suggestions={suggestions}
      />
    )

    expect(html).toContain('aria-label="Message composer"')
    expect(html).toContain('placeholder="Message Victoria Hermes or type / for commands"')
    expect(html).toContain('aria-label="Slash command suggestions"')
    expect(html).toContain('/research')
    expect(html).toContain('type="submit"')
  })

  it('shows mobile-capable image and document pickers plus removable previews', () => {
    const attachments: SelectedAttachment[] = [
      {
        file: { name: 'photo.png', size: 1536, type: 'image/png' } as File,
        id: 'photo',
        kind: 'image',
        previewUrl: 'blob:photo-preview',
        progress: 0,
        status: 'selected'
      },
      {
        file: { name: 'notes.txt', size: 8, type: 'text/plain' } as File,
        id: 'notes',
        kind: 'file',
        progress: 0,
        status: 'selected'
      }
    ]

    const html = renderToStaticMarkup(
      <MessageComposer
        attachments={attachments}
        busy={false}
        disabled={false}
        draft=""
        onAttachments={() => undefined}
        onChange={() => undefined}
        onInterrupt={() => undefined}
        onRemoveAttachment={() => undefined}
        onSubmit={() => undefined}
        suggestions={[]}
      />
    )

    expect(html).toContain('aria-label="Attach files"')
    expect(html).toContain('src="blob:photo-preview"')
    expect(html).toContain('photo.png')
    expect(html).toContain('notes.txt')
    expect(html).toContain('aria-label="Remove photo.png"')
    expect(html).toContain('1.5 KB')
  })

  it('shows a single unified attach button, not separate always-visible photo/file buttons', () => {
    const html = renderToStaticMarkup(
      <MessageComposer
        busy={false}
        disabled={false}
        draft=""
        onChange={() => undefined}
        onInterrupt={() => undefined}
        onSubmit={() => undefined}
        suggestions={[]}
      />
    )

    expect(html).toContain('aria-label="Attach files"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('aria-label="Choose photos"')
    expect(html).not.toContain('aria-label="Choose documents"')
    // Menu is closed by default -- no menu items rendered until opened.
    expect(html).not.toContain('role="menuitem"')
  })

  it('replaces send with an interrupt affordance while a turn is running', () => {
    const html = renderToStaticMarkup(
      <MessageComposer
        busy
        disabled={false}
        draft=""
        onChange={() => undefined}
        onInterrupt={() => undefined}
        onSubmit={() => undefined}
        suggestions={[]}
      />
    )

    expect(html).toContain('Stop response')
    expect(html).toContain('disabled=""')
  })

  it('shows a quoted reply preview banner with a cancel control when replying', () => {
    const html = renderToStaticMarkup(
      <MessageComposer
        busy={false}
        disabled={false}
        draft=""
        onCancelReply={() => undefined}
        onChange={() => undefined}
        onInterrupt={() => undefined}
        onSubmit={() => undefined}
        replyTo={{ role: 'assistant', senderName: 'Victoria Hermes', text: 'the earlier answer' }}
        suggestions={[]}
      />
    )

    expect(html).toContain('aria-label="Replying to"')
    expect(html).toContain('Victoria Hermes')
    expect(html).toContain('the earlier answer')
    expect(html).toContain('aria-label="Cancel reply"')
  })

  it('renders no reply preview when not replying to anything', () => {
    const html = renderToStaticMarkup(
      <MessageComposer
        busy={false}
        disabled={false}
        draft=""
        onChange={() => undefined}
        onInterrupt={() => undefined}
        onSubmit={() => undefined}
        suggestions={[]}
      />
    )

    expect(html).not.toContain('aria-label="Replying to"')
  })
})

describe('autoResizeHeight', () => {
  it('resets height to auto before measuring, then sets it to the content scroll height', () => {
    const heights: string[] = []

    const node = {
      get scrollHeight() {
        // Simulate a real textarea: scrollHeight reflects content only once
        // the CSS height has been reset to 'auto', matching why the real
        // implementation sets 'auto' first rather than reading scrollHeight
        // against the previous fixed height.
        return heights.at(-1) === 'auto' ? 84 : 0
      },
      style: {
        set height(value: string) { heights.push(value) }
      }
    }

    autoResizeHeight(node as unknown as HTMLTextAreaElement)

    expect(heights).toEqual(['auto', '84px'])
  })
})
