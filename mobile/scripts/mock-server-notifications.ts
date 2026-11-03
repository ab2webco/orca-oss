import { randomUUID } from 'node:crypto'
import type { WebSocket } from 'ws'
import type { RpcRequest, RpcRespond, RpcResponse } from './mock-server-rpc-handlers'

type Subscriber = { ws: WebSocket; push: (event: unknown) => void }

const EPOCH = `mock-notifications:${randomUUID()}`
const subscribers = new Map<string, Subscriber>()
let seq = 0

/** Sends a desktop notification to every subscribed phone, as the host does on an owner question. */
export function broadcastMockNotification(event: {
  source: 'game-owner-question' | 'agent-task-complete' | 'test'
  title: string
  body: string
  worktreeId?: string
  terminal?: string
}): number {
  seq += 1
  const payload = {
    type: 'notification',
    ...event,
    notificationId: `${EPOCH}:${seq}`,
    notificationSeq: seq,
    notificationEpoch: EPOCH
  }
  for (const subscriber of subscribers.values()) {
    subscriber.push(payload)
  }
  return subscribers.size
}

export function handleMockNotificationRequest(
  request: RpcRequest,
  respond: RpcRespond,
  success: (id: string, result: unknown, streaming?: boolean) => RpcResponse,
  ws: WebSocket
): boolean {
  switch (request.method) {
    case 'notifications.subscribe': {
      const subscriptionId = `sub-${randomUUID()}`
      const isOpen = () => ws.readyState === ws.OPEN && subscribers.has(subscriptionId)
      subscribers.set(subscriptionId, {
        ws,
        push: (event) => respond(success(request.id, event, true), isOpen)
      })
      ws.once('close', () => subscribers.delete(subscriptionId))
      respond(success(request.id, { type: 'ready', subscriptionId, epoch: EPOCH }, true))
      return true
    }
    case 'notifications.unsubscribe':
      subscribers.delete(String(request.params?.subscriptionId ?? ''))
      respond(success(request.id, { unsubscribed: true }))
      return true
    case 'notifications.getMissedSince':
      respond(success(request.id, { notifications: [], epoch: EPOCH }))
      return true
    default:
      return false
  }
}
