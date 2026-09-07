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
  constructor() {
    super({
      closedErrorMessage: 'WebSocket closed',
      connectErrorMessage: 'WebSocket connection failed',
      notConnectedErrorMessage: 'gateway not connected',
      onSocketClose: event => maybeReloadForLoopbackWsAuthFailure(event.code),
      requestIdPrefix: 'chat-web'
    })
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
  }
}
