import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, KeyboardEvent } from 'react'

import { filesFromClipboard, filesFromDrop, type SelectedAttachment } from './attachments'
import type { SlashSuggestion } from './composer'

interface MessageComposerProps {
  attachments?: SelectedAttachment[]
  busy: boolean
  disabled: boolean
  draft: string
  onAttachments?: (files: File[]) => void
  onChange: (value: string) => void
  onInterrupt: () => void
  onRemoveAttachment?: (id: string) => void
  onSubmit: () => void
  suggestions: SlashSuggestion[]
}

function fileSize(bytes: number): string {
  if (bytes < 1024) {return `${bytes} B`}

  if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`}

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function MessageComposer({
  attachments = [],
  busy,
  disabled,
  draft,
  onAttachments,
  onChange,
  onInterrupt,
  onRemoveAttachment,
  onSubmit,
  suggestions
}: MessageComposerProps) {
  const hasContent = Boolean(draft.trim() || attachments.length)

  const submit = (event: FormEvent) => {
    event.preventDefault()

    if (!busy && !disabled && hasContent) {onSubmit()}
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()

      if (!busy && !disabled && hasContent) {onSubmit()}
    }
  }

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    onAttachments?.(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    const files = filesFromDrop(event.dataTransfer)

    if (files.length === 0) {return}
    event.preventDefault()

    if (busy || disabled) {return}
    onAttachments?.(files)
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromClipboard(event.clipboardData)

    if (files.length === 0 || busy || disabled) {return}
    event.preventDefault()
    onAttachments?.(files)
  }

  return (
    <form
      aria-label="Message composer"
      className="message-composer"
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) {event.preventDefault()} }}
      onDrop={handleDrop}
      onSubmit={submit}
    >
      {draft.startsWith('/') && suggestions.length > 0 && (
        <div aria-label="Slash command suggestions" className="slash-suggestions" role="listbox">
          {suggestions.map(suggestion => (
            <button
              className="slash-suggestion"
              key={suggestion.command}
              onClick={() => onChange(`${suggestion.command} `)}
              role="option"
              type="button"
            >
              <strong>{suggestion.command}</strong>
              <span>{suggestion.description}</span>
              <small>{suggestion.kind}</small>
            </button>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div aria-label="Selected attachments" className="composer-attachments">
          {attachments.map(attachment => (
            <article className="composer-attachment" data-status={attachment.status} key={attachment.id}>
              {attachment.kind === 'image' && attachment.previewUrl
                ? <img alt="" src={attachment.previewUrl} />
                : <span aria-hidden className="composer-file-icon">▤</span>}
              <span className="composer-attachment-copy">
                <strong>{attachment.file.name || 'attachment'}</strong>
                <small>{attachment.error || `${fileSize(attachment.file.size)} · ${attachment.kind}`}</small>
                {attachment.status === 'uploading' && <progress aria-label={`Uploading ${attachment.file.name}`} max={100} value={attachment.progress} />}
              </span>
              <button
                aria-label={`Remove ${attachment.file.name || 'attachment'}`}
                className="composer-attachment-remove"
                disabled={attachment.status === 'uploading'}
                onClick={() => onRemoveAttachment?.(attachment.id)}
                type="button"
              >×</button>
            </article>
          ))}
        </div>
      )}
      <div className="composer-attachment-actions">
        <label className="button composer-attachment-button">
          <input accept="image/*" aria-label="Choose photos" disabled={disabled || busy} multiple onChange={selectFiles} type="file" />
          Photo
        </label>
        <label className="button composer-attachment-button">
          <input aria-label="Choose documents" disabled={disabled || busy} multiple onChange={selectFiles} type="file" />
          File
        </label>
        <span className="composer-drop-hint">Drop files here</span>
      </div>
      <div className="composer-row">
        <textarea
          aria-label="Message"
          disabled={disabled || busy}
          onChange={event => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Message Victoria Hermes or type / for commands"
          rows={1}
          value={draft}
        />
        {busy ? (
          <button className="button composer-stop" onClick={onInterrupt} type="button">Stop response</button>
        ) : (
          <button className="button button-primary composer-send" disabled={disabled || !hasContent} type="submit">Send</button>
        )}
      </div>
      <p className="composer-hint">Enter to send · Shift+Enter for a new line</p>
    </form>
  )
}
