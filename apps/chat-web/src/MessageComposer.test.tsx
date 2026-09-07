import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

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
