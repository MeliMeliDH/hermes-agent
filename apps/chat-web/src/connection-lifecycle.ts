export interface ReconnectableGateway {
  close(): void
  connect(): Promise<void>
}

interface GatewayConnectionLifecycleOptions<T extends ReconnectableGateway> {
  createClient: (onDisconnect: () => void) => T
  onConnected: (client: T, reconnected: boolean) => Promise<void> | void
  onConnecting?: (attempt: number) => void
  onDisconnected?: () => void
  onError?: (error: Error) => void
  reconnectDelayMs?: (attempt: number) => number
}

interface GatewayConnectionLifecycle<T extends ReconnectableGateway> {
  client: T
  dispose(): void
  start(): Promise<void>
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function createGatewayConnectionLifecycle<T extends ReconnectableGateway>(
  options: GatewayConnectionLifecycleOptions<T>
): GatewayConnectionLifecycle<T> {
  let attempt = 0
  let connectedOnce = false
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let connectInFlight: Promise<void> | undefined

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) {return}
    const delay = options.reconnectDelayMs?.(attempt) ?? 1_000
    attempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void connect()
    }, delay)
  }

  const client = options.createClient(() => {
    if (disposed) {return}
    options.onDisconnected?.()
    scheduleReconnect()
  })

  const connect = async (): Promise<void> => {
    if (disposed || connectInFlight) {return connectInFlight}
    options.onConnecting?.(attempt)

    connectInFlight = (async () => {
      try {
        await client.connect()
      } catch (error) {
        options.onError?.(asError(error))
        scheduleReconnect()

        return
      } finally {
        connectInFlight = undefined
      }

      if (disposed) {return}
      const reconnected = connectedOnce
      connectedOnce = true
      attempt = 0

      try {
        await options.onConnected(client, reconnected)
      } catch (error) {
        options.onError?.(asError(error))
      }
    })()

    return connectInFlight
  }

  return {
    client,
    dispose() {
      disposed = true

      if (reconnectTimer) {clearTimeout(reconnectTimer)}
      client.close()
    },
    start: connect
  }
}
