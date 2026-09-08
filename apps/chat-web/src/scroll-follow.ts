/** Pure scroll-position logic for the message list's "stick to bottom"
 * auto-scroll and jump-to-bottom affordance. Extracted from App.tsx so the
 * threshold math has real unit coverage instead of only being exercised
 * through a mounted DOM component. */

export const NEAR_BOTTOM_THRESHOLD_PX = 80

export interface ScrollMetrics {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

/** True when the visible viewport is within NEAR_BOTTOM_THRESHOLD_PX of the
 * true bottom of the scrollable content -- the "should auto-scroll on new
 * content" zone. A user who has scrolled up to read history is outside it. */
export function isNearBottom(metrics: ScrollMetrics): boolean {
  const distanceFromBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight

  return distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX
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
