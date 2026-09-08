export type AttachmentKind = 'file' | 'image' | 'pdf'
export type AttachmentStatus = 'error' | 'selected' | 'uploading'

export interface SelectedAttachment {
  error?: string
  file: File
  id: string
  kind: AttachmentKind
  previewUrl?: string
  progress: number
  status: AttachmentStatus
}

export interface AttachmentSelectionResult {
  attachments: SelectedAttachment[]
  errors: string[]
}

const IMAGE_MAX_BYTES = 25 * 1024 * 1024
const PDF_MAX_BYTES = 50 * 1024 * 1024
const FILE_MAX_BYTES = 256 * 1024 * 1024
const IMAGE_EXTENSIONS = new Set(['.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.tif', '.tiff', '.webp'])

function extension(name: string): string {
  const index = name.lastIndexOf('.')

  return index < 0 ? '' : name.slice(index).toLowerCase()
}

function isPdf(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.toLowerCase() === 'application/pdf' || extension(file.name) === '.pdf'
}

export function attachmentKind(file: Pick<File, 'name' | 'type'>): AttachmentKind {
  if (isPdf(file)) {return 'pdf'}

  return file.type.toLowerCase().startsWith('image/') || IMAGE_EXTENSIONS.has(extension(file.name)) ? 'image' : 'file'
}

export function validateAttachment(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  const name = file.name || 'attachment'

  if (file.size === 0) {return `${name} is empty.`}

  if (attachmentKind(file) === 'image') {
    if (!IMAGE_EXTENSIONS.has(extension(file.name))) {return `${name}: unsupported image type.`}

    if (file.size > IMAGE_MAX_BYTES) {return `${name} is too large (maximum 25 MB).`}

    return null
  }

  if (attachmentKind(file) === 'pdf' && file.size > PDF_MAX_BYTES) {return `${name} is too large (maximum 50 MB).`}

  if (file.size > FILE_MAX_BYTES) {return `${name} is too large (maximum 256 MB).`}

  return null
}

let nextAttachmentId = 0

function attachmentId(_file: Pick<File, 'name' | 'size'>, _index: number): string {
  nextAttachmentId += 1

  return `attachment-${Date.now()}-${nextAttachmentId}`
}

export function filesFromDrop(transfer: Pick<DataTransfer, 'files'> | undefined): File[] {
  return Array.from(transfer?.files ?? [])
}

export function filesFromClipboard(transfer: Pick<DataTransfer, 'items'> | undefined): File[] {
  return Array.from(transfer?.items ?? []).flatMap(item => {
    if (item.kind !== 'file') {return []}
    const file = item.getAsFile()

    return file ? [file] : []
  })
}

export function releaseAttachmentPreviews(
  attachments: Iterable<Pick<SelectedAttachment, 'previewUrl'>>,
  revokeObjectUrl: (url: string) => void = url => URL.revokeObjectURL(url)
): void {
  Array.from(attachments).forEach(attachment => {
    if (attachment.previewUrl?.startsWith('blob:')) {revokeObjectUrl(attachment.previewUrl)}
  })
}

export interface AttachmentSubmitResult {
  promptText: string
  status: string
}

interface AttachmentGateway {
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>
}

type AttachmentUpdate = (attachment: SelectedAttachment) => void
type AttachmentReader = (attachment: SelectedAttachment, onProgress: (progress: number) => void) => Promise<string>

export function readAttachmentDataUrl(
  attachment: SelectedAttachment,
  onProgress: (progress: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadstart = () => onProgress(5)

    reader.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.max(5, Math.min(50, Math.round((event.loaded / event.total) * 50))))
      }
    }

    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${attachment.file.name}`))

    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.includes(';base64,')) {
        reject(new Error(`Could not read ${attachment.file.name}`))

        return
      }

      onProgress(50)
      resolve(reader.result)
    }

    reader.readAsDataURL(attachment.file)
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Attachment upload failed'
}

export async function uploadAndSubmitAttachments(
  gateway: AttachmentGateway,
  sessionId: string,
  attachments: SelectedAttachment[],
  text: string,
  onUpdate: AttachmentUpdate,
  readDataUrl: AttachmentReader = readAttachmentDataUrl
): Promise<AttachmentSubmitResult> {
  const refs: string[] = []
  const stagedImagePaths: string[] = []
  const uploaded: SelectedAttachment[] = []

  const cleanUpStagedImages = async () => {
    await Promise.all(stagedImagePaths.map(path => gateway.request('image.detach', { path, session_id: sessionId }).catch(() => undefined)))
  }

  for (const attachment of attachments) {
    let current = { ...attachment, error: undefined, progress: 5, status: 'uploading' as const }
    onUpdate(current)

    try {
      const dataUrl = await readDataUrl(attachment, progress => {
        current = { ...current, progress }
        onUpdate(current)
      })

      if (attachment.kind === 'image') {
        const contentBase64 = dataUrl.split(';base64,', 2)[1]

        if (!contentBase64) {throw new Error(`Could not read ${attachment.file.name}`)}

        const result = await gateway.request('image.attach_bytes', {
          content_base64: contentBase64,
          filename: attachment.file.name,
          session_id: sessionId
        }) as { attached?: boolean; message?: string; path?: string }

        if (!result.attached) {throw new Error(result.message || `Could not attach ${attachment.file.name}`)}

        if (result.path) {stagedImagePaths.push(result.path)}
      } else if (attachment.kind === 'pdf') {
        const contentBase64 = dataUrl.split(';base64,', 2)[1]

        if (!contentBase64) {throw new Error(`Could not read ${attachment.file.name}`)}

        const result = await gateway.request('pdf.attach', {
          content_base64: contentBase64,
          filename: attachment.file.name,
          session_id: sessionId
        }) as { attached?: boolean; message?: string; pages?: Array<{ path?: string }>; text?: string }

        if (!result.attached) {throw new Error(result.message || `Could not attach ${attachment.file.name}`)}
        result.pages?.forEach(page => { if (page.path) {stagedImagePaths.push(page.path)} })
        refs.push(result.text || `[User attached PDF: ${attachment.file.name}]`)
      } else {
        const result = await gateway.request('file.attach', {
          data_url: dataUrl,
          name: attachment.file.name,
          session_id: sessionId
        }) as { attached?: boolean; message?: string; ref_text?: string }

        if (!result.attached || !result.ref_text) {throw new Error(result.message || `Could not attach ${attachment.file.name}`)}
        refs.push(result.ref_text)
      }

      current = { ...current, progress: 90 }
      uploaded.push(current)
      onUpdate(current)
    } catch (error) {
      const message = errorMessage(error)
      onUpdate({ ...current, error: message, status: 'error' })
      uploaded.forEach(item => onUpdate({ ...item, error: message, status: 'error' }))
      await cleanUpStagedImages()
      throw error
    }
  }

  const visibleText = text.trim()
  const promptText = [refs.join('\n'), visibleText].filter(Boolean).join('\n\n') || 'What do you see in this image?'

  try {
    const submit = await gateway.request('prompt.submit', { session_id: sessionId, text: promptText }) as { status?: string }
    uploaded.forEach(attachment => onUpdate({ ...attachment, progress: 100 }))

    return { promptText, status: submit.status ?? 'streaming' }
  } catch (error) {
    const message = errorMessage(error)
    uploaded.forEach(attachment => onUpdate({ ...attachment, error: message, status: 'error' }))
    await cleanUpStagedImages()
    throw error
  }
}

export function createSelectedAttachments(
  files: Iterable<File>,
  createObjectUrl: (file: File) => string = file => URL.createObjectURL(file)
): AttachmentSelectionResult {
  const attachments: SelectedAttachment[] = []
  const errors: string[] = []

  Array.from(files).forEach((file, index) => {
    const error = validateAttachment(file)

    if (error) {
      errors.push(error)

      return
    }

    const kind = attachmentKind(file)
    attachments.push({
      file,
      id: attachmentId(file, index),
      kind,
      ...(kind === 'image' ? { previewUrl: createObjectUrl(file) } : {}),
      progress: 0,
      status: 'selected'
    })
  })

  return { attachments, errors }
}
