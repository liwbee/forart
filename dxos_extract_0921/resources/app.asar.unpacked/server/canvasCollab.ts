import type { Server } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { getAuth } from './auth.ts'
import { getCanvas } from './canvas.ts'

interface Peer {
  ws: WebSocket
  canvasId: string
  clientId: string
  userId: string
  username: string
}

const rooms = new Map<string, Set<Peer>>()

function send(peer: Peer, payload: object) {
  if (peer.ws.readyState === WebSocket.OPEN) peer.ws.send(JSON.stringify(payload))
}

function broadcast(canvasId: string, payload: object, exceptClientId?: string) {
  for (const peer of rooms.get(canvasId) || []) {
    if (peer.clientId !== exceptClientId) send(peer, payload)
  }
}

function emitPresence(canvasId: string) {
  const users = [...(rooms.get(canvasId) || [])].map((peer) => ({
    clientId: peer.clientId,
    userId: peer.userId,
    username: peer.username,
  }))
  broadcast(canvasId, { type: 'presence', users })
}

export function broadcastCanvasPatch(canvasId: string, payload: object, sourceClientId?: string) {
  broadcast(canvasId, { type: 'patch', sourceClientId, ...payload }, sourceClientId)
}

export function setupCanvasCollaboration(server: Server) {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname !== '/api/canvas/collab') return
    const auth = getAuth(request as IncomingMessage & Parameters<typeof getAuth>[0])
    const canvasId = url.searchParams.get('canvasId') || ''
    const clientId = url.searchParams.get('clientId') || ''
    if (!auth || !canvasId || !clientId) return socket.destroy()
    try { getCanvas(canvasId, auth.user) } catch { return socket.destroy() }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const peer: Peer = { ws, canvasId, clientId, userId: auth.user.id, username: auth.user.username }
      const room = rooms.get(canvasId) || new Set<Peer>()
      room.add(peer)
      rooms.set(canvasId, room)
      emitPresence(canvasId)
      ws.on('message', (raw) => {
        try {
          const message = JSON.parse(String(raw)) as { type?: string; x?: unknown; y?: unknown; cardId?: unknown }
          if (message.type !== 'cursor') return
          const x = Number(message.x)
          const y = Number(message.y)
          if (!Number.isFinite(x) || !Number.isFinite(y)) return
          broadcast(canvasId, {
            type: 'cursor',
            clientId,
            userId: peer.userId,
            username: peer.username,
            x,
            y,
            cardId: typeof message.cardId === 'string' ? message.cardId : undefined,
          }, clientId)
        } catch { /* ignore malformed collaboration messages */ }
      })
      ws.on('close', () => {
        room.delete(peer)
        if (!room.size) rooms.delete(canvasId)
        emitPresence(canvasId)
      })
    })
  })
}
