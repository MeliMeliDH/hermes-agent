import { describe, expect, it } from 'vitest'

import { IMMEDIATE_SCROLL_BEHAVIOR, isNearBottom, NEAR_BOTTOM_THRESHOLD_PX, resolveScrollFollowState, scheduleAfterLayout, scheduleFollowAfterLayout, watchContentResizeForFollow, watchViewportForFollow } from './scroll-follow'

it('uses the broadly supported immediate scroll behavior', () => {
  expect(IMMEDIATE_SCROLL_BEHAVIOR).toBe('auto')
})

it('waits through two layout frames before following new content', () => {
  const queued: Array<() => void> = []
  let followed = false

  scheduleAfterLayout(callback => queued.push(callback), () => { followed = true })
  expect(followed).toBe(false)
  queued.shift()?.()
  expect(followed).toBe(false)
  queued.shift()?.()
  expect(followed).toBe(true)
})

it('does not let layout scroll events cancel an already scheduled follow', () => {
  const queued: Array<() => void> = []
  let shouldFollow = true
  let followed = false

  scheduleFollowAfterLayout(
    callback => queued.push(callback),
    () => shouldFollow,
    () => { followed = true }
  )
  shouldFollow = false
  queued.shift()?.()
  queued.shift()?.()
  expect(followed).toBe(true)
})

it('follows image-driven timeline growth while already at the bottom', () => {
  let resized: (() => void) | undefined
  let disconnected = false
  let follows = 0
  const target = {} as Element

  const dispose = watchContentResizeForFollow({
    createObserver: callback => ({
      disconnect: () => { disconnected = true },
      observe: element => {
        expect(element).toBe(target)
        resized = callback
      }
    }),
    follow: () => { follows += 1 },
    shouldFollow: () => true,
    target
  })

  resized?.()
  expect(follows).toBe(1)
  dispose()
  expect(disconnected).toBe(true)
})

it('ignores layout-driven scroll changes but honors user scroll intent', () => {
  expect(resolveScrollFollowState(true, false, false)).toBe(true)
  expect(resolveScrollFollowState(true, false, true)).toBe(false)
  expect(resolveScrollFollowState(false, true, false)).toBe(true)
})

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

describe('watchViewportForFollow', () => {
  it('follows keyboard/orientation viewport changes only while already pinned', () => {
    const handlers = new Map<string, () => void>()

    const source = {
      addEventListener: (type: string, handler: () => void) => { handlers.set(type, handler) },
      removeEventListener: (type: string) => { handlers.delete(type) }
    }

    let pinned = true
    let followed = 0

    const stop = watchViewportForFollow({
      follow: () => { followed += 1 },
      schedule: callback => callback(),
      shouldFollow: () => pinned,
      sources: [source]
    })

    handlers.get('resize')?.()
    expect(followed).toBe(1)

    pinned = false
    handlers.get('orientationchange')?.()
    expect(followed).toBe(1)

    stop()
    expect(handlers.size).toBe(0)
  })
})
