export interface MessageAttachment {
  kind: 'file' | 'image'
  name: string
  url?: string
  mediaPath?: string
}

export interface ExtractedMessageContent {
  attachments: MessageAttachment[]
  text: string
}

const DATA_IMAGE_RE = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi
// Local filesystem paths (this deployment's actual upload format) -- these
// can't be loaded directly by the browser; MessageBubble resolves them via
// GET /api/media (see hermes_cli/web_routers/files.py) instead of treating
// this as a normal `url`.
const IMAGE_LABEL_RE = /\[Image attached at:\s*([^\]]+)\]/gi
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi
const HTML_IMAGE_RE = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
const REFERENCE_RE = /^@(image|file):(?:"([^"]+)"|(\S+))\s*$/gim

export function safeMediaUrl(value: string): string | undefined {
  const url = value.trim()

  if (/^https?:\/\//i.test(url)) {return url}

  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(url)) {return url}

  return undefined
}

function basename(path: string): string {
  const normalized = path.trim().replace(/^['"]|['"]$/g, '').replace(/\\/g, '/')

  return normalized.split('/').filter(Boolean).at(-1) || 'attachment'
}

function imageNameFromUrl(url: string): string {
  if (url.startsWith('data:')) {return 'Attached image'}

  try {
    return basename(new URL(url).pathname) || 'Attached image'
  } catch {
    return 'Attached image'
  }
}

function altFromImageTag(tag: string): string {
  return /\balt=["']([^"']*)["']/i.exec(tag)?.[1]?.trim() || ''
}

function cleanText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractMessageContent(rawText: string): ExtractedMessageContent {
  const attachments: MessageAttachment[] = []
  let imageLabel = ''
  let text = rawText

  text = text.replace(IMAGE_LABEL_RE, (_match, path: string) => {
    const trimmedPath = path.trim()

    if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(trimmedPath)) {
      attachments.push({ kind: 'image', mediaPath: trimmedPath, name: basename(trimmedPath) })
    } else {
      attachments.push({ kind: 'file', mediaPath: trimmedPath, name: basename(trimmedPath) })
    }

    return ''
  })

  text = text.replace(MARKDOWN_IMAGE_RE, (_match, alt: string, rawUrl: string) => {
    const url = safeMediaUrl(rawUrl)

    if (!url) {return _match}
    attachments.push({ kind: 'image', name: alt.trim() || imageNameFromUrl(url), url })

    return ''
  })

  text = text.replace(HTML_IMAGE_RE, (tag, rawUrl: string) => {
    const url = safeMediaUrl(rawUrl)

    if (!url) {return tag}
    attachments.push({ kind: 'image', name: altFromImageTag(tag) || imageNameFromUrl(url), url })

    return ''
  })

  text = text.replace(DATA_IMAGE_RE, rawUrl => {
    const url = safeMediaUrl(rawUrl)

    if (url) {attachments.push({ kind: 'image', name: imageLabel || imageNameFromUrl(url), url })}

    return ''
  })

  text = text.replace(REFERENCE_RE, (_match, kind: string, quoted: string | undefined, plain: string | undefined) => {
    const path = quoted || plain || ''
    attachments.push({ kind: kind === 'image' ? 'image' : 'file', name: basename(path) })

    return ''
  })

  return { attachments, text: cleanText(text) }
}
