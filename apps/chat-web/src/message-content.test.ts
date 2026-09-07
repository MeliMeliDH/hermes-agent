import { describe, expect, it } from 'vitest'

import { extractMessageContent } from './message-content'

describe('extractMessageContent', () => {
  it('extracts a real local-path image label (this deployment\'s actual upload shape) as a mediaPath attachment', () => {
    const result = extractMessageContent(
      'Here is a screenshot\n[Image attached at: /home/hermes/.hermes/cache/images/img_c73b3fff60f0.png]\n[screenshot]'
    )

    expect(result.text).toBe('Here is a screenshot\n\n[screenshot]')
    expect(result.attachments).toEqual([
      { kind: 'image', name: 'img_c73b3fff60f0.png', mediaPath: '/home/hermes/.hermes/cache/images/img_c73b3fff60f0.png' }
    ])
  })

  it('extracts an inline base64 data-image payload alongside a local-path label as two attachments', () => {
    const result = extractMessageContent(
      'Before I test\n[Image attached at: /home/hermes/.hermes/cache/images/photo.png]\ndata:image/png;base64,aGVsbG8='
    )

    expect(result.text).toBe('Before I test')
    expect(result.attachments).toEqual([
      { kind: 'image', name: 'photo.png', mediaPath: '/home/hermes/.hermes/cache/images/photo.png' },
      { kind: 'image', name: 'Attached image', url: 'data:image/png;base64,aGVsbG8=' }
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
