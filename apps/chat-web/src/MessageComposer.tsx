import type { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import { filesFromClipboard, type SelectedAttachment } from './attachments'
import type { ReplyReference } from './chat-state'
import type { SlashSuggestion } from './composer'
import { truncateReplyPreview } from './MessageBubble'

interface MessageComposerProps {
  attachments?: SelectedAttachment[]
  busy: boolean
  disabled: boolean
  draft: string
  onAttachments?: (files: File[]) => void
  onCancelReply?: () => void
  onChange: (value: string) => void
  onInterrupt: () => void
  onRemoveAttachment?: (id: string) => void
  onSubmit: () => void
  replyTo?: ReplyReference
  suggestions: SlashSuggestion[]
}

function fileSize(bytes: number): string {
  if (bytes < 1024) {return `${bytes} B`}

  if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`}

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Extracted for unit testing: jsdom/testing-library aren't in this project's
// test stack (renderToStaticMarkup only, no live DOM), so the height-setting
// logic itself is verified directly against a fake element shape instead.
export function autoResizeHeight(node: Pick<HTMLTextAreaElement, 'scrollHeight' | 'style'>): void {
  node.style.height = 'auto'
  node.style.height = `${node.scrollHeight}px`
}

export function MessageComposer({
  attachments = [],
  busy,
  disabled,
  draft,
  onAttachments,
  onCancelReply,
  onChange,
  onInterrupt,
  onRemoveAttachment,
  onSubmit,
  replyTo,
  suggestions
}: MessageComposerProps) {
  const hasContent = Boolean(draft.trim() || attachments.length)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false)
  const uploadMenuRef = useRef<HTMLDivElement | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Close the upload menu on an outside click or Escape, matching standard
  // popover-menu behavior (Discord's "+" attachment menu included).
  useEffect(() => {
    if (!uploadMenuOpen) {return}

    const handlePointerDown = (event: PointerEvent) => {
      if (uploadMenuRef.current?.contains(event.target as Node)) {return}
      setUploadMenuOpen(false)
    }

    const handleKeyDownGlobal = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {setUploadMenuOpen(false)}
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDownGlobal)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDownGlobal)
    }
  }, [uploadMenuOpen])

  // Auto-grow the textarea as content wraps to more lines, up to the
  // max-height cap in app.css (composer-row textarea), matching Discord's
  // message box behavior. Resets to a single row first so shrinking on
  // delete/clear works, not just growing.
  useEffect(() => {
    const node = textareaRef.current

    if (!node) {return}
    autoResizeHeight(node)
  }, [draft])

  // Focus the composer as soon as a reply target is set, so pressing
  // "Reply" on a message lets the user start typing immediately -- matching
  // Discord's own reply UX, which auto-focuses the message box the same way.
  useEffect(() => {
    if (!replyTo) {return}
    textareaRef.current?.focus()
  }, [replyTo])

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
      onSubmit={submit}
    >
      {replyTo && (
        <div aria-label="Replying to" className="composer-reply-preview">
          <span className="composer-reply-preview-label">
            Replying to <strong>{replyTo.senderName}</strong>
          </span>
          <span className="composer-reply-preview-text">{truncateReplyPreview(replyTo.text)}</span>
          <button
            aria-label="Cancel reply"
            className="composer-reply-cancel"
            onClick={onCancelReply}
            type="button"
          >×</button>
        </div>
      )}
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
      <div className="composer-row">
        <div className="composer-upload" ref={uploadMenuRef}>
          <button
            aria-expanded={uploadMenuOpen}
            aria-haspopup="menu"
            aria-label="Attach files"
            className="button composer-upload-toggle"
            disabled={disabled || busy}
            onClick={() => setUploadMenuOpen(open => !open)}
            type="button"
          >+</button>
          {uploadMenuOpen && (
            <div className="composer-upload-menu" role="menu">
              <button
                className="composer-upload-option"
                onClick={() => { photoInputRef.current?.click(); setUploadMenuOpen(false) }}
                role="menuitem"
                type="button"
              >Photo/Video</button>
              <button
                className="composer-upload-option"
                onClick={() => { fileInputRef.current?.click(); setUploadMenuOpen(false) }}
                role="menuitem"
                type="button"
              >File</button>
            </div>
          )}
          <input
            accept="image/*,video/*"
            aria-hidden
            className="composer-upload-input"
            disabled={disabled || busy}
            multiple
            onChange={selectFiles}
            ref={photoInputRef}
            tabIndex={-1}
            type="file"
          />
          <input
            aria-hidden
            className="composer-upload-input"
            disabled={disabled || busy}
            multiple
            onChange={selectFiles}
            ref={fileInputRef}
            tabIndex={-1}
            type="file"
          />
        </div>
        <textarea
          aria-label="Message"
          disabled={disabled || busy}
          onChange={event => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Message Victoria Hermes or type / for commands"
          ref={textareaRef}
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
