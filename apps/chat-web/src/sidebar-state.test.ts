import { describe, expect, it, vi } from 'vitest'

import { isCompactChatViewport, loadSidebarCollapsed, persistSidebarCollapsed } from './sidebar-state'

function storageWith(value: string | null = null) {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn()
  }
}

describe('sidebar presentation state', () => {
  it('defaults expanded and restores a persisted collapsed value', () => {
    expect(loadSidebarCollapsed(storageWith(null))).toBe(false)
    expect(loadSidebarCollapsed(storageWith('true'))).toBe(true)
  })

  it('treats phone widths as a single-pane session flow', () => {
    expect(isCompactChatViewport(720)).toBe(true)
    expect(isCompactChatViewport(721)).toBe(false)
  })

  it('persists the explicit state and tolerates unavailable storage', () => {
    const storage = storageWith()
    persistSidebarCollapsed(true, storage)
    expect(storage.setItem).toHaveBeenCalledWith('hermes.chatWeb.sidebarCollapsed', 'true')

    expect(() => persistSidebarCollapsed(false, { getItem: vi.fn(), setItem: vi.fn(() => {throw new Error('blocked')}) })).not.toThrow()
  })
})
