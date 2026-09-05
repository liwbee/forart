import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { getAuth } from './auth.ts'

interface RealtimePeer {
  ws: WebSocket
  clientId: string
  userId: string
  username: string
  timestamps: number[]
  alive: boolean
}

interface RealtimeRoom {
  id: string
  appId: string
  name: string
  ownerId: string
  discoverable: boolean
  maxMembers: number
  state: unknown
  createdAt: number
  updatedAt: number
  allowedUserIds?: Set<string>
  peers: Map<string, RealtimePeer>
}

const rooms = new Map<string, RealtimeRoom>()
const MAX_MESSAGE_BYTES = 64 * 1024
const IDLE_ROOM_TTL_MS = 30 * 60 * 1000
const HEARTBEAT_INTERVAL_MS = 15 * 1000

export function developerRealtimeStats() {
  let peers = 0
  for (const room of rooms.values()) peers += room.peers.size
  return { rooms: rooms.size, peers }
}

function publicRoom(room: RealtimeRoom) {
  return { id: room.id, appId: room.appId, name: room.name, ownerId: room.ownerId, discoverable: room.discoverable, maxMembers: room.maxMembers, members: room.peers.size, createdAt: room.createdAt }
}

function emit(room: RealtimeRoom, payload: object, exceptClientId?: string) {
  const text = JSON.stringify(payload)
  for (const peer of room.peers.values()) if (peer.clientId !== exceptClientId && peer.ws.readyState === WebSocket.OPEN) peer.ws.send(text)
}

function members(room: RealtimeRoom) {
  return [...room.peers.values()].map((peer) => ({ clientId: peer.clientId, userId: peer.userId, username: peer.username }))
}

function emitMembers(room: RealtimeRoom) {
  emit(room, { type: 'members', roomId: room.id, ownerId: room.ownerId, members: members(room) })
}

function touch(room: RealtimeRoom) { room.updatedAt = Date.now() }

function transferOwnerIfNeeded(room: RealtimeRoom, departedUserId: string) {
  if (room.ownerId !== departedUserId) return
  if ([...room.peers.values()].some((peer) => peer.userId === departedUserId)) return
  const successor = room.peers.values().next().value as RealtimePeer | undefined
  if (!successor) return
  room.ownerId = successor.userId
  emit(room, { type: 'owner', roomId: room.id, ownerId: room.ownerId, clientId: successor.clientId })
}

export function cleanupDeveloperRealtimeRooms(now = Date.now()) {
  let removed = 0
  for (const [roomId, room] of rooms) {
    if (room.peers.size || room.updatedAt > now - IDLE_ROOM_TTL_MS) continue
    rooms.delete(roomId)
    removed++
  }
  return removed
}

export function createDeveloperRealtimeRoom(appId: string, ownerId: string, input: { name?: unknown; discoverable?: unknown; maxMembers?: unknown; state?: unknown }) {
  const room: RealtimeRoom = {
    id: randomUUID(), appId, ownerId,
    name: String(input.name || '协作房间').trim().slice(0, 60) || '协作房间',
    discoverable: input.discoverable === true,
    maxMembers: Math.max(2, Math.min(32, Math.round(Number(input.maxMembers) || 8))),
    state: input.state ?? null, createdAt: Date.now(), updatedAt: Date.now(), peers: new Map(),
  }
  if (Buffer.byteLength(JSON.stringify(room.state), 'utf8') > MAX_MESSAGE_BYTES) throw new Error('房间初始状态不能超过 64 KB')
  rooms.set(room.id, room)
  return publicRoom(room)
}

export function ensureDeveloperRealtimeRoom(appId: string, roomId: string, ownerId: string, input: { name?: unknown; maxMembers?: unknown; state?: unknown; allowedUserIds?: string[] }) {
  const existing = rooms.get(roomId)
  if (existing && existing.appId !== appId) throw new Error('实时房间 ID 已被占用')
  const room = existing || {
    id: roomId,
    appId,
    ownerId,
    name: String(input.name || '协同项目').trim().slice(0, 60) || '协同项目',
    discoverable: false,
    maxMembers: Math.max(2, Math.min(32, Math.round(Number(input.maxMembers) || 32))),
    state: input.state ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    peers: new Map<string, RealtimePeer>(),
  }
  room.ownerId = ownerId
  room.name = String(input.name || room.name).trim().slice(0, 60) || room.name
  room.state = input.state ?? room.state
  room.allowedUserIds = new Set([ownerId, ...(input.allowedUserIds || [])])
  if (Buffer.byteLength(JSON.stringify(room.state), 'utf8') > MAX_MESSAGE_BYTES) throw new Error('房间状态不能超过 64 KB')
  rooms.set(roomId, room)
  touch(room)
  for (const peer of room.peers.values()) if (!room.allowedUserIds.has(peer.userId)) peer.ws.close(1008, 'room access revoked')
  return publicRoom(room)
}

export function updateDeveloperRealtimeRoomState(appId: string, roomId: string, state: unknown) {
  const room = rooms.get(roomId)
  if (!room || room.appId !== appId) return false
  if (Buffer.byteLength(JSON.stringify(state ?? null), 'utf8') > MAX_MESSAGE_BYTES) throw new Error('房间状态不能超过 64 KB')
  room.state = state ?? null
  touch(room)
  emit(room, { type: 'state', roomId, state: room.state, source: 'server' })
  return true
}

export function closeDeveloperRealtimeRoomSystem(appId: string, roomId: string) {
  const room = rooms.get(roomId)
  if (!room || room.appId !== appId) return false
  emit(room, { type: 'closed', roomId })
  for (const peer of room.peers.values()) peer.ws.close(1000, 'room closed')
  rooms.delete(roomId)
  return true
}

export function listDeveloperRealtimeRooms(appId: string, userId: string) {
  return [...rooms.values()].filter((room) => room.appId === appId && (room.discoverable || room.ownerId === userId || [...room.peers.values()].some((peer) => peer.userId === userId))).map(publicRoom)
}

export function developerRealtimeRoom(appId: string, roomId: string) {
  const room = rooms.get(roomId)
  if (!room || room.appId !== appId) throw new Error('实时房间不存在')
  return { ...publicRoom(room), state: room.state, memberList: members(room) }
}

export function closeDeveloperRealtimeRoom(appId: string, roomId: string, userId: string) {
  const room = rooms.get(roomId)
  if (!room || room.appId !== appId) throw new Error('实时房间不存在')
  if (room.ownerId !== userId) throw new Error('只有房主可以关闭实时房间')
  emit(room, { type: 'closed', roomId })
  for (const peer of room.peers.values()) peer.ws.close(1000, 'room closed')
  rooms.delete(roomId)
  return { closed: true, roomId }
}

export function setupDeveloperRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true })
  const heartbeat = setInterval(() => {
    cleanupDeveloperRealtimeRooms()
    for (const room of rooms.values()) for (const peer of room.peers.values()) {
      if (!peer.alive) { peer.ws.terminate(); continue }
      peer.alive = false
      peer.ws.ping()
    }
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()
  server.once('close', () => clearInterval(heartbeat))
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname !== '/api/developer-realtime') return
    const auth = getAuth(request as IncomingMessage & Parameters<typeof getAuth>[0])
    const appId = String(url.searchParams.get('appId') || '')
    const roomId = String(url.searchParams.get('roomId') || '')
    const clientId = String(url.searchParams.get('clientId') || '')
    const room = rooms.get(roomId)
    const existingPeer = room?.peers.get(clientId)
    if (!auth || !room || room.appId !== appId || (room.allowedUserIds && !room.allowedUserIds.has(auth.user.id)) || !/^[a-zA-Z0-9_.-]{3,100}$/.test(clientId)
      || (existingPeer && existingPeer.userId !== auth.user.id) || (room.peers.size >= room.maxMembers && !existingPeer)) return socket.destroy()
    wss.handleUpgrade(request, socket, head, (ws) => {
      existingPeer?.ws.close(1000, 'client reconnected')
      const peer: RealtimePeer = { ws, clientId, userId: auth.user.id, username: auth.user.username, timestamps: [], alive: true }
      room.peers.set(clientId, peer)
      touch(room)
      ws.send(JSON.stringify({ type: 'joined', room: publicRoom(room), state: room.state, members: members(room) }))
      emitMembers(room)
      ws.on('pong', () => { peer.alive = true })
      ws.on('message', (raw) => {
        try {
          peer.alive = true
          const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer)
          if (data.byteLength > MAX_MESSAGE_BYTES) return ws.close(1009, 'message too large')
          const now = Date.now()
          peer.timestamps = peer.timestamps.filter((stamp) => stamp > now - 1000)
          if (peer.timestamps.length >= 30) return ws.close(1008, 'rate limit')
          peer.timestamps.push(now)
          const message = JSON.parse(data.toString('utf8')) as { type?: string; data?: unknown; state?: unknown }
          touch(room)
          if (message.type === 'send') emit(room, { type: 'message', roomId, clientId, userId: peer.userId, username: peer.username, data: message.data }, clientId)
          else if (message.type === 'setState') {
            if (room.ownerId !== peer.userId) throw new Error('只有房主可以设置权威状态')
            room.state = message.state ?? null
            emit(room, { type: 'state', roomId, state: room.state, clientId })
          } else if (message.type === 'getState') ws.send(JSON.stringify({ type: 'state', roomId, state: room.state }))
          else if (message.type === 'members') ws.send(JSON.stringify({ type: 'members', roomId, members: members(room) }))
        } catch (error) {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: String((error as Error).message || error) }))
        }
      })
      ws.on('close', () => {
        if (room.peers.get(clientId) !== peer) return
        room.peers.delete(clientId)
        touch(room)
        transferOwnerIfNeeded(room, peer.userId)
        if (rooms.has(room.id)) emitMembers(room)
      })
    })
  })
}
