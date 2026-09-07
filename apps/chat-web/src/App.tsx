import { useEffect, useState } from 'react'

import { ChatGatewayClient } from './gateway'

interface SessionListResult {
  sessions?: unknown[]
}

type ConnectionView =
  | { kind: 'connecting'; message: string }
  | { kind: 'connected'; message: string }
  | { kind: 'error'; message: string }

export function App() {
  const [connection, setConnection] = useState<ConnectionView>({
    kind: 'connecting',
    message: 'Connecting to the Hermes gateway…'
  })

  useEffect(() => {
    const gateway = new ChatGatewayClient()
    let active = true
    let readyReceived = false

    const unsubscribeReady = gateway.on('gateway.ready', () => {
      readyReceived = true
    })

    void gateway
      .connect()
      .then(async () => {
        const result = await gateway.request<SessionListResult>('session.list', { limit: 200 })

        if (!active) {
          return
        }

        const sessionCount = result.sessions?.length ?? 0
        setConnection({
          kind: 'connected',
          message: `Live gateway connected · gateway.ready ${readyReceived ? 'received' : 'pending'} · ${sessionCount} sessions`
        })
      })
      .catch((error: unknown) => {
        if (active) {
          setConnection({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Gateway connection failed'
          })
        }
      })

    return () => {
      active = false
      unsubscribeReady()
      gateway.close()
    }
  }, [])

  return (
    <main className="connection-shell">
      <section aria-live="polite" className="card connection-card">
        <p className="eyebrow">Hermes Chat Web</p>
        <h1>Structured chat client</h1>
        <p className="text-muted">Phase 1 connection scaffold. Message UI arrives in Phase 2.</p>
        <div className="connection-status" data-state={connection.kind}>
          <span aria-hidden className="status-dot" />
          <span>{connection.message}</span>
        </div>
      </section>
    </main>
  )
}
