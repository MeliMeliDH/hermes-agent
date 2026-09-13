import { describe, expect, it } from 'vitest'

import { nextDragDepth } from './App'

describe('nextDragDepth', () => {
  it('increments on enter', () => {
    expect(nextDragDepth(0, 1)).toBe(1)
    expect(nextDragDepth(1, 1)).toBe(2)
  })

  it('decrements on leave', () => {
    expect(nextDragDepth(2, -1)).toBe(1)
    expect(nextDragDepth(1, -1)).toBe(0)
  })

  it('never goes negative, so a stray extra leave event cannot desync the counter', () => {
    expect(nextDragDepth(0, -1)).toBe(0)
  })

  it('models entering a child element without flickering to zero: enter parent, enter child, leave parent (bubble order) stays above zero', () => {
    let depth = 0
    depth = nextDragDepth(depth, 1) // enter window
    depth = nextDragDepth(depth, 1) // enter a child element (still inside the window)
    depth = nextDragDepth(depth, -1) // leave the window's own boundary is NOT fired here in a real
    // browser for a child enter, but this simulates the worst case: an extra leave still doesn't
    // reach zero while a second enter is still outstanding.
    expect(depth).toBeGreaterThan(0)
  })
})
