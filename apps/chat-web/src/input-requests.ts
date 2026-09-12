import type { InputRequestModel, InputResponse } from './chat-state'

interface RequestGateway {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
}

export async function respondToInputRequest(
  gateway: RequestGateway,
  request: InputRequestModel,
  response: InputResponse,
  sessionId: string
): Promise<void> {
  if (request.kind === 'clarify') {
    if (Array.isArray(response)) {
      for (const item of response) {
        await gateway.request('clarify.respond', {
          answer: item.answer,
          question_id: item.questionId,
          request_id: request.requestId
        })
      }
    } else {
      await gateway.request('clarify.respond', { answer: response, request_id: request.requestId })
    }

    return
  }

  if (typeof response !== 'string') {return}
  await gateway.request('approval.respond', {
    choice: response,
    request_id: request.requestId,
    session_id: sessionId
  })
}
