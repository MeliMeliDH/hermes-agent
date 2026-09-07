import { describe, expect, it } from 'vitest'

import { extractMessageContent } from './message-content'

describe('extractMessageContent', () => {
  it('extracts the real session.history data-image shape and removes its raw source', () => {
    const result = extractMessageContent(
      'Before I test\n[Image attached at: /home/hermes/.hermes/cache/images/photo.png]\ndata:image/png;base64,aGVsbG8='
    )

    expect(result.text).toBe('Before I test')
    expect(result.attachments).toEqual([
      { kind: 'image', name: 'photo.png', url: 'data:image/png;base64,aGVsbG8=' }
    ])
  })

  it('extracts markdown images and file references without treating unsafe URLs as media', () => {
    const result = extractMessageContent(
      'Screenshot: ![diagram](https://example.com/diagram.png)\n<img src="https://example.com/second.webp" alt="second">\n@file:"/tmp/report.pdf"\n<img src="javascript:alert(1)">'
    )

    expect(result.attachments).toEqual([
      { kind: 'image', name: 'diagram', url: 'https://example.com/diagram.png' },
      { kind: 'image', name: 'second', url: 'https://example.com/second.webp' },
      { kind: 'file', name: 'report.pdf' }
    ])
    expect(result.text).toContain('<img src="javascript:alert(1)">')
  })
})
