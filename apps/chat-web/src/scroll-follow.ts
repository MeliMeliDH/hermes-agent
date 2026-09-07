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
