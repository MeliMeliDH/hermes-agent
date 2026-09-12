import { describe, expect, it } from 'vitest'

import { attachmentKind, createSelectedAttachments, filesFromClipboard, filesFromDrop, releaseAttachmentPreviews, type SelectedAttachment, uploadAndSubmitAttachments, validateAttachment } from './attachments'

function file(name: string, type: string, size: number): File {
  return { name, size, type } as File
}

describe('attachment selection and validation', () => {
  it('accepts gateway-supported images and general files with backend-aligned limits', () => {
    expect(attachmentKind(file('photo.PNG', 'image/png', 12))).toBe('image')
    expect(validateAttachment(file('photo.PNG', 'image/png', 25 * 1024 * 1024))).toBeNull()
    expect(validateAttachment(file('report.pdf', 'application/pdf', 50 * 1024 * 1024))).toBeNull()
    expect(validateAttachment(file('archive.zip', 'application/zip', 256 * 1024 * 1024))).toBeNull()
  })

  it('rejects empty, unsupported image, and oversized payloads before reading bytes', () => {
    expect(validateAttachment(file('empty.txt', 'text/plain', 0))).toBe('empty.txt is empty.')
    expect(validateAttachment(file('photo.heic', 'image/heic', 12))).toContain('unsupported image type')
    expect(validateAttachment(file('photo.png', 'image/png', 25 * 1024 * 1024 + 1))).toContain('25 MB')
    expect(validateAttachment(file('report.pdf', 'application/pdf', 50 * 1024 * 1024 + 1))).toContain('50 MB')
    expect(validateAttachment(file('archive.zip', 'application/zip', 256 * 1024 * 1024 + 1))).toContain('256 MB')
  })

  it('extracts browser-supported file drops and clipboard file items', () => {
    const dropped = file('drop.txt', 'text/plain', 4)
    const pasted = file('paste.png', 'image/png', 8)
    const ignored = { kind: 'string', getAsFile: () => null } as DataTransferItem

    expect(filesFromDrop({ files: [dropped] } as unknown as DataTransfer)).toEqual([dropped])
    expect(filesFromClipboard({
      items: [ignored, { kind: 'file', getAsFile: () => pasted } as DataTransferItem]
    } as unknown as DataTransfer)).toEqual([pasted])
    expect(filesFromClipboard(undefined)).toEqual([])
  })

  it('releases only browser object previews when attachments are removed or a session changes', () => {
    const revoked: string[] = []
    releaseAttachmentPreviews([
      { ...selected('photo.png', 'image/png', 'image'), previewUrl: 'blob:photo' },
      { ...selected('remote.png', 'image/png', 'image'), previewUrl: 'https://example.com/photo.png' }
    ], url => revoked.push(url))

    expect(revoked).toEqual(['blob:photo'])
  })

  it('creates image previews, keeps file metadata private, and reports each invalid selection', () => {
    const urls: string[] = []

    const result = createSelectedAttachments([
      file('photo.png', 'image/png', 12),
      file('notes.txt', 'text/plain', 8),
      file('bad.heic', 'image/heic', 7)
    ], candidate => {
      const url = `blob:preview-${candidate.name}`
      urls.push(url)

      return url
    })

    expect(result.attachments).toMatchObject([
      { file: { name: 'photo.png' }, kind: 'image', previewUrl: 'blob:preview-photo.png', progress: 0, status: 'selected' },
      { file: { name: 'notes.txt' }, kind: 'file', progress: 0, status: 'selected' }
    ])
    expect(result.attachments[1]).not.toHaveProperty('previewUrl')
    expect(result.errors).toEqual(['bad.heic: unsupported image type.'])
    expect(urls).toEqual(['blob:preview-photo.png'])
  })
})

function selected(name: string, type: string, kind: 'file' | 'image' | 'pdf'): SelectedAttachment {
  return { file: file(name, type, 12), id: name, kind, progress: 0, status: 'selected' }
}

function gatewayRecorder(options: { failMethod?: string } = {}) {
  const calls: Array<[string, Record<string, unknown>]> = []

  return {
    calls,
    gateway: {
      request: async (method: string, params: Record<string, unknown>) => {
        calls.push([method, params])

        if (method === options.failMethod) {throw new Error('gateway upload failed')}

        if (method === 'file.attach') {return { attached: true, ref_text: '@file:`attachments/notes.txt`' }}

        if (method === 'image.attach_bytes') {return { attached: true, path: '/home/hermes/.hermes/images/upload.png' }}

        if (method === 'pdf.attach') {
          return {
            attached: true,
            pages: [{ path: '/home/hermes/.hermes/images/pdf-p1.png' }],
            text: '[User attached PDF: report.pdf (1 page(s))]'
          }
        }

        return { status: 'streaming' }
      }
    }
  }
}

describe('attachment upload and send', () => {
  const readDataUrl = async (attachment: SelectedAttachment, onProgress: (progress: number) => void) => {
    onProgress(50)

    return attachment.kind === 'image'
      ? 'data:image/png;base64,aGVsbG8='
      : 'data:text/plain;base64,bm90ZXM='
  }

  it('sends an image-only turn through image.attach_bytes before prompt.submit', async () => {
    const { calls, gateway } = gatewayRecorder()
    const updates: SelectedAttachment[] = []

    const result = await uploadAndSubmitAttachments(
      gateway,
      'runtime-1',
      [selected('photo.png', 'image/png', 'image')],
      '',
      update => updates.push(update),
      readDataUrl
    )

    expect(calls).toEqual([
      ['image.attach_bytes', { content_base64: 'aGVsbG8=', filename: 'photo.png', session_id: 'runtime-1' }],
      ['prompt.submit', { session_id: 'runtime-1', text: 'What do you see in this image?' }]
    ])
    expect(updates.map(update => update.progress)).toEqual([5, 50, 90, 100])
    expect(result).toMatchObject({ promptText: 'What do you see in this image?', status: 'streaming' })
  })

  it('sends file-only and text-plus-file turns with the gateway returned ref_text', async () => {
    const first = gatewayRecorder()
    await uploadAndSubmitAttachments(first.gateway, 'runtime-1', [selected('notes.txt', 'text/plain', 'file')], '', () => undefined, readDataUrl)
    expect(first.calls).toEqual([
      ['file.attach', { data_url: 'data:text/plain;base64,bm90ZXM=', name: 'notes.txt', session_id: 'runtime-1' }],
      ['prompt.submit', { session_id: 'runtime-1', text: '@file:`attachments/notes.txt`' }]
    ])

    const second = gatewayRecorder()
    await uploadAndSubmitAttachments(second.gateway, 'runtime-1', [selected('notes.txt', 'text/plain', 'file')], 'Summarize this', () => undefined, readDataUrl)
    expect(second.calls[1]).toEqual([
      'prompt.submit',
      { session_id: 'runtime-1', text: '@file:`attachments/notes.txt`\n\nSummarize this' }
    ])
  })

  it('renders PDFs through pdf.attach and includes the returned label in the prompt', async () => {
    const { calls, gateway } = gatewayRecorder()

    await uploadAndSubmitAttachments(
      gateway,
      'runtime-1',
      [selected('report.pdf', 'application/pdf', 'pdf')],
      'Summarize this',
      () => undefined,
      readDataUrl
    )

    expect(calls).toEqual([
      ['pdf.attach', { content_base64: 'bm90ZXM=', filename: 'report.pdf', session_id: 'runtime-1' }],
      ['prompt.submit', {
        session_id: 'runtime-1',
        text: '[User attached PDF: report.pdf (1 page(s))]\n\nSummarize this'
      }]
    ])
  })

  it('marks a failed submit and detaches staged images so retry cannot duplicate them', async () => {
    const { calls, gateway } = gatewayRecorder({ failMethod: 'prompt.submit' })
    const updates: SelectedAttachment[] = []

    await expect(uploadAndSubmitAttachments(
      gateway,
      'runtime-1',
      [selected('photo.png', 'image/png', 'image')],
      'Describe it',
      update => updates.push(update),
      readDataUrl
    )).rejects.toThrow('gateway upload failed')

    expect(calls.map(([method]) => method)).toEqual(['image.attach_bytes', 'prompt.submit', 'image.detach'])
    expect(calls[2]?.[1]).toEqual({ path: '/home/hermes/.hermes/images/upload.png', session_id: 'runtime-1' })
    expect(updates.at(-1)).toMatchObject({ error: 'gateway upload failed', status: 'error' })
  })

  it('surfaces an upload failure and does not submit the prompt', async () => {
    const { calls, gateway } = gatewayRecorder({ failMethod: 'file.attach' })
    const updates: SelectedAttachment[] = []

    await expect(uploadAndSubmitAttachments(
      gateway,
      'runtime-1',
      [selected('notes.txt', 'text/plain', 'file')],
      'Send',
      update => updates.push(update),
      readDataUrl
    )).rejects.toThrow('gateway upload failed')

    expect(calls.map(([method]) => method)).toEqual(['file.attach'])
    expect(updates.at(-1)).toMatchObject({ error: 'gateway upload failed', status: 'error' })
  })
})
