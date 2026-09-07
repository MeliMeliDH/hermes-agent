import type { FormEvent, KeyboardEvent } from 'react'

import type { SlashSuggestion } from './composer'

interface MessageComposerProps {
  busy: boolean
  disabled: boolean
  draft: string
  onChange: (value: string) => void
  onInterrupt: () => void
  onSubmit: () => void
  suggestions: SlashSuggestion[]
}

export function MessageComposer({
  busy,
  disabled,
  draft,
  onChange,
  onInterrupt,
  onSubmit,
  suggestions
}: MessageComposerProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault()

    if (!busy && !disabled && draft.trim()) {onSubmit()}
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()

      if (!busy && !disabled && draft.trim()) {onSubmit()}
    }
  }

  return (
    <form aria-label="Message composer" className="message-composer" onSubmit={submit}>
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
      <div className="composer-row">
        <textarea
          aria-label="Message"
          disabled={disabled || busy}
          onChange={event => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Victoria Hermes or type / for commands"
          rows={1}
          value={draft}
        />
        {busy ? (
          <button className="button composer-stop" onClick={onInterrupt} type="button">Stop response</button>
        ) : (
          <button className="button button-primary composer-send" disabled={disabled || !draft.trim()} type="submit">Send</button>
        )}
      </div>
      <p className="composer-hint">Enter to send · Shift+Enter for a new line</p>
    </form>
  )
}
