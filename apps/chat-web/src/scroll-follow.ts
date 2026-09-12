/** Pure scroll-position logic for the message list's "stick to bottom"
 * auto-scroll and jump-to-bottom affordance. Extracted from App.tsx so the
 * threshold math has real unit coverage instead of only being exercised
 * through a mounted DOM component. */

export const NEAR_BOTTOM_THRESHOLD_PX = 80
export const IMMEDIATE_SCROLL_BEHAVIOR: ScrollBehavior = 'auto'

export function scheduleAfterLayout(
  schedule: (callback: () => void) => void,
  callback: () => void
): void {
  schedule(() => {schedule(callback)})
}

export function scheduleFollowAfterLayout(
  schedule: (callback: () => void) => void,
  shouldFollow: () => boolean,
  follow: () => void
): void {
  if (shouldFollow()) {scheduleAfterLayout(schedule, follow)}
}

export interface ScrollMetrics {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

export function resolveScrollFollowState(
  wasFollowing: boolean,
  nearBottom: boolean,
  userInitiated: boolean
): boolean {
  if (nearBottom) {return true}

  return userInitiated ? false : wasFollowing
}

/** True when the visible viewport is within NEAR_BOTTOM_THRESHOLD_PX of the
 * true bottom of the scrollable content -- the "should auto-scroll on new
 * content" zone. A user who has scrolled up to read history is outside it. */
export function isNearBottom(metrics: ScrollMetrics): boolean {
  const distanceFromBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight

  return distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX
}

interface ElementResizeObserver {
  disconnect(): void
  observe(target: Element): void
}

interface WatchContentResizeOptions {
  createObserver: (callback: () => void) => ElementResizeObserver
  follow: () => void
  shouldFollow: () => boolean
  target: Element
}

export function watchContentResizeForFollow(options: WatchContentResizeOptions): () => void {
  const observer = options.createObserver(() => {
    if (options.shouldFollow()) {options.follow()}
  })

  observer.observe(options.target)

  return () => {observer.disconnect()}
}

interface ViewportEventSource {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

interface ViewportFollowOptions {
  follow: () => void
  schedule: (callback: () => void) => void
  shouldFollow: () => boolean
  sources: ViewportEventSource[]
}

export function watchViewportForFollow(options: ViewportFollowOptions): () => void {
  let scheduled = false

  const handleChange = () => {
    if (scheduled || !options.shouldFollow()) {return}
    scheduled = true
    options.schedule(() => {
      scheduled = false

      if (options.shouldFollow()) {options.follow()}
    })
  }

  for (const source of options.sources) {
    source.addEventListener('orientationchange', handleChange)
    source.addEventListener('resize', handleChange)
  }

  return () => {
    for (const source of options.sources) {
      source.removeEventListener('orientationchange', handleChange)
      source.removeEventListener('resize', handleChange)
    }
  }
}
