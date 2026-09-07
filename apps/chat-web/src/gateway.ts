import { buildHermesWebSocketUrl, JsonRpcGatewayClient } from '@hermes/shared'

import { buildWsAuthParam, HERMES_BASE_PATH } from './auth'

const TOKEN_RELOAD_STORAGE_KEY = 'hermes.chatWebTokenReloadAttempted'

function maybeReloadForLoopbackWsAuthFailure(code: number): boolean {
  if (window.__HERMES_AUTH_REQUIRED__ || code !== 4401) {
    return false
  }

  try {
    if (window.sessionStorage.getItem(TOKEN_RELOAD_STORAGE_KEY) === '1') {
      return false
    }

    window.sessionStorage.setItem(TOKEN_RELOAD_STORAGE_KEY, '1')
  } catch {
    // A reload is still the only recovery when storage is unavailable.
  }

  window.location.reload()

  return true
}

export class ChatGatewayClient extends JsonRpcGatewayClient {
  private readonly notifyDisconnect?: (event: CloseEvent) => void
  // Distinguishes "was open, then dropped" (real disconnect, worth
  // reconnecting for) from "never finished connecting" (a failed connect
  // attempt, e.g. server down) -- a browser fires 'close' for BOTH cases,
  // and the base client already rejects connect()'s promise for the latter.
  // Treating both as a disconnect double-fires the caller's retry logic
  // (one via onDisconnect, one via the connect().catch()), which bypasses
  // backoff entirely and reconnect-storms the server.
  private hasOpened = false

  constructor(options: { onDisconnect?: (event: CloseEvent) => void } = {}) {
    super({
      closedErrorMessage: 'WebSocket closed',
      connectErrorMessage: 'WebSocket connection failed',
      notConnectedErrorMessage: 'gateway not connected',
      onSocketClose: event => {
        if (maybeReloadForLoopbackWsAuthFailure(event.code)) {return true}

        if (this.hasOpened) {
          this.hasOpened = false
          // Let the base client finish its own close teardown (reject
          // pending requests, flip connectionState to 'closed') first --
          // real network drops (mobile network handoff, backgrounding,
          // sleep/wake) have no other signal.
          queueMicrotask(() => this.notifyDisconnect?.(event))
        }

        return false
      },
      requestIdPrefix: 'chat-web'
    })
    this.notifyDisconnect = options.onDisconnect
  }

  async connect(): Promise<void> {
    if (this.connectionState === 'open' || this.connectionState === 'connecting') {
      return
    }

    const authParam = await buildWsAuthParam()

    if (!authParam[1]) {
      throw new Error('Session token not available — open Chat Web through the Hermes dashboard')
    }

    await super.connect(
      buildHermesWebSocketUrl({
        authParam,
        basePath: HERMES_BASE_PATH,
        path: '/api/ws'
      })
    )
    this.hasOpened = true
  }
}
