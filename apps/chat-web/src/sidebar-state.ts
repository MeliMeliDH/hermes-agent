interface SidebarStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const SIDEBAR_STORAGE_KEY = 'hermes.chatWeb.sidebarCollapsed'

export function isCompactChatViewport(viewportWidth: number): boolean {
  return viewportWidth <= 720
}

function browserStorage(): SidebarStorage | undefined {
  if (typeof window === 'undefined') {return undefined}

  return window.localStorage
}

export function loadSidebarCollapsed(storage: SidebarStorage | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function persistSidebarCollapsed(
  collapsed: boolean,
  storage: SidebarStorage | undefined = browserStorage()
): void {
  try {
    storage?.setItem(SIDEBAR_STORAGE_KEY, String(collapsed))
  } catch {
    // Presentation state persistence is optional when storage is unavailable.
  }
}
