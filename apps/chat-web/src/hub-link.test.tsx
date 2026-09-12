import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HubLink } from './HubLink'

describe('HubLink', () => {
  it('navigates back to the private Apps Hub in the current tab', () => {
    const html = renderToStaticMarkup(<HubLink className="conversation-hub-link" />)

    expect(html).toContain('href="https://v2202609408706510466.tail617b2b.ts.net:8420"')
    expect(html).toContain('aria-label="Back to Apps Hub"')
    expect(html).toContain('class="button hub-link conversation-hub-link"')
    expect(html).toContain('← Hub')
    expect(html).not.toContain('target="_blank"')
  })
})
