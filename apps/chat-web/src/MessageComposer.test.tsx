import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { SelectedAttachment } from './attachments'
import { MessageComposer } from './MessageComposer'

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

    expect(html).toContain('accept="image/*"')
    expect(html).toContain('aria-label="Choose photos"')
    expect(html).toContain('aria-label="Choose documents"')
    expect(html).toContain('src="blob:photo-preview"')
    expect(html).toContain('photo.png')
    expect(html).toContain('notes.txt')
    expect(html).toContain('aria-label="Remove photo.png"')
    expect(html).toContain('Drop files here')
    expect(html).toContain('1.5 KB')
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
})
