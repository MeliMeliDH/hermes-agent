import type { InputRequestModel } from './chat-state'

interface RequestGateway {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
}

export async function respondToInputRequest(
  gateway: RequestGateway,
  request: InputRequestModel,
  response: string,
  sessionId: string
): Promise<void> {
  if (request.kind === 'clarify') {
    await gateway.request('clarify.respond', { answer: response, request_id: request.requestId })

    return
  }

  await gateway.request('approval.respond', {
    choice: response,
    request_id: request.requestId,
    session_id: sessionId
  })
}
