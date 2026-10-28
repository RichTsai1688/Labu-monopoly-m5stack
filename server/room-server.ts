import { isRemoteFinanceAction } from '../src/engine';
import { DICE_MOVE_DELAY_MS } from "../src/presentation-timing";
import { createNpcChat, loadNpcConfig, startNpcHttpServer, type NpcChat } from './npc-chat';
import { npcContext } from '../src/npc-context';
import { shouldAskLabu } from '../src/labu-policy';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { createGame, dispatch, getNpcAction, THEMES } from '../src/engine';
import type { GameAction, GameState, Theme } from '../src/game-types';
import { createWelcomeMessages, replyAsLabu, sanitizeChatText } from '../src/companion';
import type { ChatMessage } from '../src/companion';
import type { RoomSnapshot } from '../src/network';

export interface RoomServerOptions {
  npcChat?: NpcChat;
  port?: number;
  host?: string;
  stepMs?: number;
  rollMs?: number;
  npcMs?: number;
  disconnectGraceMs?: number;
  roomTtlMs?: number;
  maxRooms?: number;
  /** Additional exact browser origins for an explicitly configured LAN test. */
  allowedOrigins?: string[];
}
interface Seat {
  id: string; name: string; theme?: Theme; token: string; socket: WebSocket | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null; pendingReclaim: boolean;
}
interface Room {
  code: string; seats: 2 | 3 | 4; maxRounds: number; hostId: string; members: Seat[];
  game: GameState | null; version: number; messages: ChatMessage[];
  timer: ReturnType<typeof setTimeout> | null; lastActivity: number;
  requests: Set<string>; lastNpcAt: number; lastNpcTurn: number;
}
interface Connection { room: Room | null; seat: Seat | null; alive: boolean; rateAt: number; rateCount: number }

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function boundedName(value: unknown): string {
  check(typeof value === 'string', '請輸入玩家名稱');
  const name = sanitizeChatText(value);
  check(name.length > 0 && name.length <= 24, '玩家名稱須為 1 至 24 字');
  return name;
}
function validTheme(value: unknown): Theme | undefined { check(value === undefined || THEMES.includes(value as Theme), '建築風格無效'); return value as Theme | undefined; }

/** In-memory local authoritative service; never deploy publicly without an authenticated proxy. */
export async function startRoomServer(options: RoomServerOptions = {}) {
  const config = {
    port: options.port ?? 5174, host: options.host ?? '127.0.0.1', stepMs: options.stepMs ?? 250, rollMs: options.rollMs ?? DICE_MOVE_DELAY_MS,
    npcMs: options.npcMs ?? 900, disconnectGraceMs: options.disconnectGraceMs ?? 15_000,
    roomTtlMs: options.roomTtlMs ?? 6 * 60 * 60 * 1000, maxRooms: options.maxRooms ?? 64,
  };
  for (const [key, value] of Object.entries(config)) if (key !== 'host') check(typeof value === 'number' && Number.isFinite(value) && value >= 0, '伺服器設定無效');
  const rooms = new Map<string, Room>();
  const connections = new Map<WebSocket, Connection>();
  let disposed = false;
  const server = new WebSocketServer({
    host: config.host, port: config.port, maxPayload: 16_384,
    verifyClient: ({ origin }: { origin: string }) => {
      // CLI/test clients may omit Origin; browsers on unrelated sites may not access local rooms.
      if (!origin) return true;
      if (options.allowedOrigins?.includes(origin)) return true;
      try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname); }
      catch { return false; }
    },
  });
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  check(address && typeof address !== 'string', '無法取得伺服器位址');

  function send(socket: WebSocket, value: object) {
    if (socket.readyState !== WebSocket.OPEN) return;
    // A stalled receiver must not retain unbounded snapshots in memory.
    if (socket.bufferedAmount > 1_000_000) { socket.close(4008, 'Slow receiver'); return; }
    socket.send(JSON.stringify(value));
  }
  function snapshot(room: Room, seat: Seat): RoomSnapshot {
    const game = room.game ? structuredClone(room.game) : null;
    // Clients receive current outcomes, never the real seed/RNG state for future dice or stocks.
    if (game) { game.seed = 'server-managed'; game.rngState = 1; }
    return {
      code: room.code, status: !game ? 'lobby' : game.phase === 'finished' ? 'finished' : 'playing',
      version: room.version, seats: room.seats, hostId: room.hostId, selfId: seat.id,
      players: room.members.map(p => ({ id: p.id, name: p.name, connected: !!p.socket, host: p.id === room.hostId })),
      game, messages: [...room.messages], pendingReclaim: seat.pendingReclaim,
    };
  }
  function broadcast(room: Room) { for (const seat of room.members) if (seat.socket) send(seat.socket, { type: 'snapshot', snapshot: snapshot(room, seat) }); }
  function addSystem(room: Room, text: string) {
    room.messages.push({ id: randomBytes(8).toString('hex'), channel: 'system', author: '遊戲系統', text, at: Date.now() });
    if (room.messages.length > 100) room.messages.shift();
  }
  function reconcile(room: Room) {
    if (!room.game) return;
    for (const seat of room.members) if (seat.socket && seat.pendingReclaim) {
      const index = room.members.indexOf(seat);
      if (room.game.currentPlayer !== index || room.game.phase === 'roll' || room.game.phase === 'finished') {
        seat.pendingReclaim = false;
        room.game.players[index].isNpc = false;
      }
    }
  }
  function speak(room: Room, text = '', speakerId?: string, askerId?: string) {
    if (!options.npcChat || !room.game) return;
    const seed = room.game.seed;
    const context = npcContext(room.game,speakerId ?? room.game.players.find(p => p.isNpc && p.name === 'Labu')?.id,room.messages);
    void options.npcChat.reply(context,text,{gameId:room.code,playerId:askerId ?? speakerId,kind:text ? "question" : "event"}).then(reply => {
      if(disposed || !rooms.has(room.code) || room.game?.seed !== seed) return;
      room.messages.push({id:randomBytes(8).toString('hex'),author:context.speaker,channel:'table',...reply,at:Date.now()});
      room.messages = room.messages.slice(-100);broadcast(room);
    }).catch(()=>{});
  }
  function apply(room: Room, action: GameAction) {
    check(room.game, '遊戲尚未開始');
    const actor = room.game.players[room.game.currentPlayer];
    room.game = dispatch(room.game, action);
    if(options.npcChat?.configured && room.members.some(m=>m.socket) && actor.isNpc && room.game.phase === 'action' && room.lastNpcTurn !== room.game.turn && Date.now()-room.lastNpcAt > 20_000 && (action.type !== 'step' || room.game.pendingSteps === 0)) {
      room.lastNpcAt=Date.now();room.lastNpcTurn=room.game.turn;speak(room,'',actor.id);
    }
    room.version++;
    room.lastActivity = Date.now();
    reconcile(room);
    broadcast(room);
    schedule(room);
  }
  function schedule(room: Room) {
    if (disposed || room.timer || !room.game || room.game.phase === 'finished') return;
    const moving = room.game.phase === 'moving';
    if (!moving && !room.game.players[room.game.currentPlayer].isNpc) return;
    room.timer = setTimeout(() => {
      room.timer = null;
      if (!rooms.has(room.code) || !room.game) return;
      try {
        const action = room.game.phase === 'moving' ? { type: 'step' as const }
          : room.game.players[room.game.currentPlayer].isNpc ? getNpcAction(room.game) : null;
        if (action) apply(room, action);
      } catch (error) {
        addSystem(room, `本機房間已暫停：${error instanceof Error ? error.message : '遊戲操作失敗'}`);
        broadcast(room);
      }
    }, moving ? (room.game.pendingSteps === room.game.die ? config.rollMs : config.stepMs) : config.npcMs);
    room.timer.unref();
  }
  function attach(socket: WebSocket, connection: Connection, room: Room, seat: Seat) {
    if (seat.disconnectTimer) clearTimeout(seat.disconnectTimer);
    seat.disconnectTimer = null;
    const previous = seat.socket;
    seat.socket = socket;
    connection.room = room;
    connection.seat = seat;
    if (previous && previous !== socket) previous.close(4001, 'Session resumed elsewhere');
    room.lastActivity = Date.now();
    send(socket, { type: 'session', session: { code: room.code, token: seat.token, playerId: seat.id } });
  }
  function destroyRoom(room: Room) {
    rooms.delete(room.code);
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    for (const seat of room.members) {
      if (seat.disconnectTimer) clearTimeout(seat.disconnectTimer);
      seat.disconnectTimer = null;
      seat.socket?.close(4004, 'Room expired');
    }
    room.requests.clear();
    room.messages.length = 0;
  }

  server.on('connection', socket => {
    if (connections.size >= 128 || disposed) { socket.close(4008, 'Connection limit'); return; }
    const connection: Connection = { room: null, seat: null, alive: true, rateAt: Date.now(), rateCount: 0 };
    connections.set(socket, connection);
    socket.on('pong', () => { connection.alive = true; });
    socket.on('error', () => { /* close handles cleanup; transport errors never crash the process */ });
    socket.on('close', () => {
      connections.delete(socket);
      const { room, seat } = connection;
      if (!room || !seat || seat.socket !== socket || !rooms.has(room.code)) return;
      seat.socket = null;
      broadcast(room);
      seat.disconnectTimer = setTimeout(() => {
        seat.disconnectTimer = null;
        if (seat.socket || !rooms.has(room.code) || !room.game || room.game.phase === 'finished') return;
        room.game.players[room.members.indexOf(seat)].isNpc = true;
        room.version++;
        addSystem(room, `${seat.name} 暫時離線，由 NPC 接手；重新連線後可取回席位。`);
        broadcast(room);
        schedule(room);
      }, config.disconnectGraceMs);
      seat.disconnectTimer.unref();
    });
    socket.on('message', (buffer, binary) => {
      let requestId: string | undefined;
      try {
        check(!binary, '只接受文字訊息');
        const request = JSON.parse(buffer.toString());
        check(request && typeof request === 'object' && !Array.isArray(request), '操作格式錯誤');
        check(typeof request.requestId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(request.requestId), '操作識別碼無效');
        requestId = request.requestId;
        if (Date.now() - connection.rateAt > 5000) { connection.rateAt = Date.now(); connection.rateCount = 0; }
        check(++connection.rateCount <= 80, '操作太頻繁，請稍後再試');
        if (request.type === 'create') {
          check(!connection.room, '已在房間內');
          check(rooms.size < config.maxRooms, '本機房間已滿');
          const name = boundedName(request.name), theme = validTheme(request.theme);
          check([2, 3, 4].includes(request.seats), '房間必須為 2 至 4 席');
          const maxRounds = request.maxRounds ?? 12;
          check(Number.isInteger(maxRounds) && maxRounds >= 1 && maxRounds <= 100, '回合數須為 1 至 100');
          let code: string; do { code = randomBytes(6).toString('hex').toUpperCase(); } while (rooms.has(code));
          const seat: Seat = { id: 'player-0', name, theme, token: randomBytes(32).toString('base64url'), socket: null, disconnectTimer: null, pendingReclaim: false };
          const room: Room = { code, seats: request.seats, maxRounds, hostId: seat.id, members: [seat], game: null, version: 0, messages: createWelcomeMessages().filter(m => m.channel !== 'private'), timer: null, lastActivity: Date.now(), requests: new Set(), lastNpcAt: 0, lastNpcTurn: 0 };
          rooms.set(code, room);
          attach(socket, connection, room, seat);
          broadcast(room);
        } else if (request.type === 'join') {
          check(!connection.room, '已在房間內');
          const room = rooms.get(String(request.code).trim().toUpperCase());
          check(room && !room.game, '找不到可加入的大廳，或遊戲已開始');
          check(room.members.length < room.seats, '房間已滿');
          const name = boundedName(request.name), theme = validTheme(request.theme);
          const seat: Seat = { id: `player-${room.members.length}`, name, theme, token: randomBytes(32).toString('base64url'), socket: null, disconnectTimer: null, pendingReclaim: false };
          room.members.push(seat); room.version++;
          attach(socket, connection, room, seat);
          broadcast(room);
        } else if (request.type === 'reconnect') {
          check(!connection.room, '已在房間內');
          check(typeof request.code === 'string' && typeof request.token === 'string', '重新連線資料無效');
          const room = rooms.get(request.code.trim().toUpperCase());
          const seat = room?.members.find(member => member.token === request.token);
          check(room && seat, '房間或重新連線憑證無效');
          attach(socket, connection, room, seat);
          if (room.game) {
            seat.pendingReclaim = room.game.players[room.members.indexOf(seat)].isNpc;
            reconcile(room);
            room.version++;
          }
          broadcast(room);
          schedule(room);
        } else {
          const { room, seat } = connection;
          check(room && seat && rooms.has(room.code) && seat.socket === socket, '請先加入房間');
          room.lastActivity = Date.now();
          const dedupeKey = `${seat.id}/${requestId}`;
          check(!room.requests.has(dedupeKey), '此操作已處理，請勿重複送出');
          if (request.type === 'start') {
            check(seat.id === room.hostId, '只有房主可以開始');
            check(!room.game, '遊戲已開始');
            room.game = createGame({ seats: room.seats, maxRounds: room.maxRounds, seed: randomBytes(32).toString('hex'), players: room.members.map(member => ({ name: member.name, theme: member.theme, isNpc: !member.socket })) });
            room.version++;
            broadcast(room);
            schedule(room);
          } else if (request.type === 'command') {
            check(room.game, '遊戲尚未開始');
            check(Number.isSafeInteger(request.expectedVersion) && request.expectedVersion === room.version, '狀態已更新，請依最新畫面重試');
            check((room.game.players[room.game.currentPlayer].id === seat.id || isRemoteFinanceAction(request.action)) && !seat.pendingReclaim && !room.game.players.find(p=>p.id===seat.id)!.isNpc, '現在不是你的回合，或 NPC 正在完成本回合');
            check(request.action && typeof request.action === 'object' && request.action.type !== 'step', '移動由伺服器處理');
            apply(room, { ...request.action, actorId: seat.id } as GameAction);
          } else if (request.type === 'chat') {
            check(request.channel === undefined || request.channel === 'table', '私人訊息不透過同桌聊天傳送');
            check(typeof request.text === 'string', '聊天內容無效');
            const text = sanitizeChatText(request.text);
            check(text.length > 0, '請輸入聊天內容');
            room.messages.push({ id: randomBytes(8).toString('hex'), author: seat.name, channel: 'table', text, at: Date.now() });
            if(options.npcChat && room.game && shouldAskLabu(text,request.askLabu === true)) speak(room,text,undefined,seat.id);
            else if (shouldAskLabu(text,request.askLabu === true)) room.messages.push({ id: randomBytes(8).toString('hex'), author: 'Labu', channel: 'table', text: replyAsLabu(text, { playerName: seat.name, round: room.game?.round ?? 1 }), at: Date.now() });
            while (room.messages.length > 100) room.messages.shift();
            broadcast(room);
          } else throw new Error('未知房間操作');
          room.requests.add(dedupeKey);
          if (room.requests.size > 512) room.requests.delete(room.requests.values().next().value!);
        }
        send(socket, { type: 'ack', requestId });
      } catch (error) {
        send(socket, { type: 'error', requestId, message: error instanceof Error ? error.message : '操作失敗' });
        if (connection.room && connection.seat) send(socket, { type: 'snapshot', snapshot: snapshot(connection.room, connection.seat) });
      }
    });
  });
  const maintenance = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) if (now - room.lastActivity > config.roomTtlMs) destroyRoom(room);
  }, Math.min(30_000, Math.max(25, config.roomTtlMs / 2)));
  maintenance.unref();
  const heartbeat = setInterval(() => {
    for (const [socket, connection] of connections) {
      if (!connection.alive) { socket.terminate(); continue; }
      connection.alive = false; socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  return {
    url: `ws://${config.host.includes(':') ? `[${config.host}]` : config.host}:${address.port}`,
    stats: () => ({ rooms: rooms.size, connections: connections.size, scheduledRooms: [...rooms.values()].filter(room => !!room.timer).length }),
    async close(): Promise<void> {
      if (disposed) return;
      disposed = true;
      clearInterval(maintenance); clearInterval(heartbeat);
      for (const room of [...rooms.values()]) destroyRoom(room);
      for (const socket of connections.keys()) socket.terminate();
      connections.clear();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const npcChat = createNpcChat(loadNpcConfig());
  const npcHttp = await startNpcHttpServer(npcChat);
  const service = await startRoomServer({ npcChat, port: Number(process.env.ROOM_PORT ?? 5174), host: process.env.ROOM_HOST ?? '127.0.0.1', allowedOrigins: process.env.ROOM_ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean) });
  console.log(`Labu local room service listening at ${service.url}`);
  const stop = () => { void Promise.all([service.close(),npcHttp.close()]).then(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
