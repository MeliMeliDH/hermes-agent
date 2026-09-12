// @ts-expect-error The app intentionally has no Node runtime types; Vitest supplies node:fs.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8')

describe('mobile chat viewport layout', () => {
  it('tracks the dynamic viewport and protects the composer from the iOS home area', () => {
    expect(css).toMatch(/\.chat-shell\s*\{[^}]*height:\s*100dvh;/s)
    expect(css).toMatch(/\.message-composer\s*\{[^}]*env\(safe-area-inset-bottom\)/s)
  })
})
