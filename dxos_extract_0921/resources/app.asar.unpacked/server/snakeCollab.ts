import type { IncomingMessage } from 'node:http'
import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

type Point = { x: number; y: number }
type Direction = 'up' | 'down' | 'left' | 'right'
type RoomMode = 'practice' | 'room'
type SuctionEvent = { snakeId: string; from: Point; to: Point }
type Snake = {
  id: string
  name: string
  color: string
  body: Point[]
  direction: Direction
  queuedDirection: Direction
  score: number
  alive: boolean
  ai: boolean
  boosting: boolean
  respawnAt: number
}
type Peer = { ws: WebSocket; roomCode: string; snakeId: string }
type Room = {
  code: string
  mode: RoomMode
  hostPeerId: string
  aiCount: number
  started: boolean
  ended: boolean
  lan: boolean
  snakes: Map<string, Snake>
  pellets: Point[]
  peers: Set<Peer>
  lastTick: number
  timer: NodeJS.Timeout
}

const WORLD = 3400
const TICK_MS = 80
const PELLET_CAP = 560
const START_RADIUS = 720
const SUCTION_RADIUS = 108
const NORMAL_STEP = 24
const BOOST_STEP = 42
const SPAWN_MARGIN = 160
const COLORS = ['#35c978', '#ff9f43', '#6c8cff', '#d66bff', '#ff5f7a', '#22c1c3', '#f4c95d']
const rooms = new Map<string, Room>()

function send(peer: Peer, payload: object) {
  if (peer.ws.readyState === WebSocket.OPEN) peer.ws.send(JSON.stringify(payload))
}
function broadcast(room: Room, payload: object) {
  for (const peer of room.peers) send(peer, payload)
}
function randomPoint(radius = WORLD / 2): Point {
  return { x: Math.round((Math.random() - .5) * radius * 2), y: Math.round((Math.random() - .5) * radius * 2) }
}
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
function clampPoint(point: Point, margin = 0): Point {
  const edge = WORLD / 2 - margin
  return {
    x: Math.round(clamp(point.x, -edge, edge)),
    y: Math.round(clamp(point.y, -edge, edge)),
  }
}
function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y) }
function isOpposite(a: Direction, b: Direction) {
  return (a === 'up' && b === 'down') || (a === 'down' && b === 'up') || (a === 'left' && b === 'right') || (a === 'right' && b === 'left')
}
function nextHead(snake: Snake): Point {
  const head = snake.body[0]
  const step = snake.boosting ? BOOST_STEP : NORMAL_STEP
  const next = { ...head }
  if (snake.direction === 'up') next.y -= step
  if (snake.direction === 'down') next.y += step
  if (snake.direction === 'left') next.x -= step
  if (snake.direction === 'right') next.x += step
  return next
}
function createSnake(id: string, name: string, ai: boolean, index: number, center = randomPoint(START_RADIUS)): Snake {
  const head = clampPoint({ x: center.x + Math.round((Math.random() - .5) * 220), y: center.y + Math.round((Math.random() - .5) * 220) }, SPAWN_MARGIN)
  const body = [head, { x: head.x - NORMAL_STEP, y: head.y }, { x: head.x - NORMAL_STEP * 2, y: head.y }]
  return { id, name: name.slice(0, 18) || (ai ? `AI ${index + 1}` : '玩家'), color: COLORS[index % COLORS.length], body, direction: 'right', queuedDirection: 'right', score: 0, alive: true, ai, boosting: false, respawnAt: 0 }
}
function occupied(room: Room, point: Point) {
  for (const snake of room.snakes.values()) for (const part of snake.body) if (distance(part, point) < 46) return true
  return false
}
function seedPellets(room: Room, count = PELLET_CAP) {
  while (room.pellets.length < count) {
    const point = randomPoint()
    if (!occupied(room, point)) room.pellets.push(point)
  }
}
function aiTurn(room: Room, snake: Snake) {
  const head = snake.body[0]
  const nearestPellet = [...room.pellets].sort((a, b) => distance(head, a) - distance(head, b))[0]
  if (!nearestPellet) return
  const dx = nearestPellet.x - head.x
  const dy = nearestPellet.y - head.y
  let desired: Direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
  const edge = WORLD / 2 - 260
  if (head.x > edge) desired = 'left'
  else if (head.x < -edge) desired = 'right'
  else if (head.y > edge) desired = 'up'
  else if (head.y < -edge) desired = 'down'
  if (!isOpposite(desired, snake.direction)) snake.queuedDirection = desired
}
function respawn(room: Room, snake: Snake) {
  const nearby = [...room.snakes.values()].find((item) => item.alive && item.id !== snake.id)?.body[0]
  const fresh = createSnake(snake.id, snake.name, snake.ai, [...room.snakes.values()].indexOf(snake), nearby ? { x: nearby.x + 180, y: nearby.y + 180 } : undefined)
  Object.assign(snake, fresh)
}
function explode(room: Room, snake: Snake) {
  const body = snake.body.slice()
  const pelletCount = Math.min(70, Math.max(14, Math.round(body.length * 1.25)))
  for (let i = 0; i < pelletCount; i += 1) {
    const anchor = body[Math.min(body.length - 1, Math.floor((i / pelletCount) * body.length))] || { x: 0, y: 0 }
    const angle = Math.random() * Math.PI * 2
    const radius = 12 + Math.random() * 62
    room.pellets.push({
      x: Math.round(anchor.x + Math.cos(angle) * radius),
      y: Math.round(anchor.y + Math.sin(angle) * radius),
    })
  }
  snake.alive = false
  snake.respawnAt = Date.now() + (snake.ai ? 1800 : 0)
}
function addAi(room: Room) {
  const current = [...room.snakes.values()].filter((snake) => snake.ai).length
  const center = [...room.snakes.values()].find((snake) => !snake.ai)?.body[0] || { x: 0, y: 0 }
  for (let i = current; i < room.aiCount; i += 1) {
    const ai = createSnake(`ai-${i + 1}`, `AI ${i + 1}`, true, i + 1, { x: center.x + (Math.random() - .5) * 800, y: center.y + (Math.random() - .5) * 800 })
    room.snakes.set(ai.id, ai)
  }
}
function roomPlayers(room: Room) {
  return [...room.peers].map((peer) => {
    const snake = room.snakes.get(peer.snakeId)
    return { id: peer.snakeId, name: snake?.name || '玩家', color: snake?.color || '#35c978' }
  })
}
function publicRoom(room: Room) {
  return {
    type: 'room',
    roomCode: room.code,
    mode: room.mode,
    started: room.started,
    ended: room.ended,
    hostPeerId: room.hostPeerId,
    aiCount: room.aiCount,
    lan: room.lan,
    players: roomPlayers(room),
  }
}
function broadcastRoom(room: Room) {
  broadcast(room, publicRoom(room))
}
function publicState(room: Room, suction: SuctionEvent[] = []) {
  return {
    type: 'state',
    roomCode: room.code,
    world: WORLD,
    started: room.started,
    ended: room.ended,
    pellets: room.pellets,
    suction,
    snakes: [...room.snakes.values()].map(({ id, name, color, body, score, alive, ai, boosting, respawnAt }) => ({ id, name, color, body, score, alive, ai, boosting, respawnAt })),
  }
}
function broadcastState(room: Room, suction: SuctionEvent[] = []) {
  broadcast(room, publicState(room, suction))
}
function tickRoom(room: Room) {
  if (!room.started) return
  const now = Date.now()
  room.lastTick = now
  const suction: SuctionEvent[] = []
  // Resolve human players first so a round-ending death prevents any AI step
  // from sneaking into the final tick.
  const turnOrder = [...room.snakes.values()].sort((a, b) => Number(a.ai) - Number(b.ai))
  for (const snake of turnOrder) {
    if (!snake.alive) {
      if (snake.ai && now >= snake.respawnAt) respawn(room, snake)
      continue
    }
    if (snake.ai) aiTurn(room, snake)
    snake.direction = snake.queuedDirection
    const next = nextHead(snake)
    const hitWall = Math.abs(next.x) > WORLD / 2 || Math.abs(next.y) > WORLD / 2
    const hitBody = [...room.snakes.values()].some((other) => other.alive && other.body.some((part, index) => {
      // 移动步长为 24：忽略自己的当前头部与尾部，身体碰撞半径不能大于相邻节距。
      if (other.id === snake.id && (index === 0 || index === other.body.length - 1)) return false
      return distance(part, next) < (index === 0 ? 28 : 18)
    }))
    if (hitWall || hitBody) {
      explode(room, snake)
      const humansAlive = [...room.snakes.values()].some((item) => !item.ai && item.alive)
      if (!humansAlive) {
        room.started = false
        room.ended = true
        break
      }
      continue
    }
    snake.body.unshift(next)
    const collected = room.pellets.filter((pellet) => distance(pellet, next) < SUCTION_RADIUS)
    if (collected.length) {
      const collectedSet = new Set(collected)
      room.pellets = room.pellets.filter((pellet) => !collectedSet.has(pellet))
      snake.score += collected.length * 10
      suction.push(...collected.map((from) => ({ snakeId: snake.id, from, to: { ...next } })))
      for (let i = 1; i < collected.length; i += 1) {
        const tail = snake.body[snake.body.length - 1]
        snake.body.push({ ...tail })
      }
    } else {
      snake.body.pop()
    }
  }
  seedPellets(room, 500)
  broadcastState(room, suction)
}
function createRoom(code: string, mode: RoomMode, aiCount: number, hostPeerId: string, lan = false): Room {
  const room: Room = { code, mode, hostPeerId, aiCount: Math.max(0, Math.min(8, Math.round(aiCount))), started: mode === 'practice', ended: false, lan, snakes: new Map(), pellets: [], peers: new Set(), lastTick: Date.now(), timer: setInterval(() => tickRoom(room), TICK_MS) }
  seedPellets(room)
  rooms.set(code, room)
  return room
}
function roomCode(input: unknown) {
  const raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  return raw || Math.random().toString(36).slice(2, 8).toUpperCase()
}
function newPeerId() { return `p-${Math.random().toString(36).slice(2, 10)}` }

export function setupSnakeCollaboration(server: Server) {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname !== '/api/snake/room') return
    wss.handleUpgrade(request as IncomingMessage, socket, head, (ws) => {
      let peer: Peer | null = null
      ws.on('message', (raw) => {
        try {
          const message = JSON.parse(String(raw)) as { type?: string; roomCode?: string; name?: string; direction?: Direction; mode?: RoomMode; aiCount?: number; create?: boolean; enabled?: boolean; lan?: boolean }
          if (message.type === 'list') {
            const list = [...rooms.values()]
              .filter((room) => room.lan && room.mode === 'room' && !room.ended)
              .map((room) => {
                const players = roomPlayers(room)
                return { code: room.code, host: players[0]?.name || '房主', players: players.length, started: room.started }
              })
            ws.send(JSON.stringify({ type: 'rooms', rooms: list }))
            return
          }
          if (message.type === 'join' && !peer) {
            const id = newPeerId()
            const requestedCode = String(message.roomCode || '').trim().toUpperCase()
            const mode = message.mode === 'room' ? 'room' : 'practice'
            const code = requestedCode || (message.create ? roomCode('') : '')
            const existing = code ? rooms.get(code) : undefined
            if (!existing && !message.create && mode === 'room') {
              send({ ws, roomCode: '', snakeId: id }, { type: 'error', message: '房间不存在，请检查房间号。' })
              return
            }
            const room = existing || createRoom(code || roomCode(''), mode, Number(message.aiCount ?? 5), id, mode === 'room' ? !!message.lan : false)
            if (room.started && room.mode === 'room' && !room.peers.size) room.hostPeerId = id
            const nearby = [...room.snakes.values()].find((snake) => snake.alive)?.body[0]
            const snake = createSnake(id, String(message.name || '玩家'), false, room.snakes.size, nearby)
            room.snakes.set(snake.id, snake)
            peer = { ws, roomCode: room.code, snakeId: snake.id }
            room.peers.add(peer)
            if (room.mode === 'practice') addAi(room)
            send(peer, { ...publicRoom(room), type: 'joined', snakeId: snake.id })
            broadcastRoom(room)
            return
          }
          if (!peer) return
          const room = rooms.get(peer.roomCode)
          const snake = room?.snakes.get(peer.snakeId)
          if (!room || !snake) return
          if (message.type === 'input' && message.direction && !isOpposite(message.direction, snake.direction)) snake.queuedDirection = message.direction
          if (message.type === 'boost') snake.boosting = !!message.enabled
          if (message.type === 'respawn' && room.ended) {
            for (const item of room.snakes.values()) respawn(room, item)
            room.ended = false
            room.started = true
            broadcastRoom(room)
            broadcastState(room)
          } else if (message.type === 'respawn' && !snake.alive) {
            respawn(room, snake)
            broadcastState(room)
          }
          if (message.type === 'start' && room.mode === 'room' && peer.snakeId === room.hostPeerId) {
            room.started = true
            room.ended = false
            addAi(room)
            broadcastRoom(room)
          }
          if (message.type === 'set-ai' && room.mode === 'room' && peer.snakeId === room.hostPeerId && !room.started) {
            room.aiCount = Math.max(0, Math.min(8, Math.round(Number(message.aiCount ?? room.aiCount))))
            broadcastRoom(room)
          }
          if (message.type === 'set-lan' && room.mode === 'room' && peer.snakeId === room.hostPeerId && !room.started) {
            room.lan = !!message.lan
            broadcastRoom(room)
          }
          if (message.type === 'leave') ws.close()
        } catch { /* ignore malformed messages */ }
      })
      ws.on('close', () => {
        if (!peer) return
        const room = rooms.get(peer.roomCode)
        if (!room) return
        room.peers.delete(peer)
        room.snakes.delete(peer.snakeId)
        if (room.hostPeerId === peer.snakeId) room.hostPeerId = [...room.peers][0]?.snakeId || ''
        if (!room.peers.size) {
          clearInterval(room.timer)
          rooms.delete(room.code)
        } else {
          broadcastRoom(room)
        }
      })
    })
  })
}
