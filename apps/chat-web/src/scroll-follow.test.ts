import { describe, expect, it } from 'vitest'

import { isNearBottom, NEAR_BOTTOM_THRESHOLD_PX } from './scroll-follow'

describe('isNearBottom', () => {
  it('is true when scrolled exactly to the bottom', () => {
    expect(isNearBottom({ clientHeight: 500, scrollHeight: 2000, scrollTop: 1500 })).toBe(true)
  })

  it('is true within the threshold distance from the bottom', () => {
    expect(isNearBottom({
      clientHeight: 500,
      scrollHeight: 2000,
      scrollTop: 1500 - NEAR_BOTTOM_THRESHOLD_PX
    })).toBe(true)
  })

  it('is false just past the threshold distance from the bottom', () => {
    expect(isNearBottom({
      clientHeight: 500,
      scrollHeight: 2000,
      scrollTop: 1500 - NEAR_BOTTOM_THRESHOLD_PX - 1
    })).toBe(false)
  })

  it('is false when scrolled to the top of a long conversation', () => {
    expect(isNearBottom({ clientHeight: 500, scrollHeight: 2000, scrollTop: 0 })).toBe(false)
  })

  it('is true when the content does not overflow the viewport at all', () => {
    expect(isNearBottom({ clientHeight: 500, scrollHeight: 400, scrollTop: 0 })).toBe(true)
  })
})
