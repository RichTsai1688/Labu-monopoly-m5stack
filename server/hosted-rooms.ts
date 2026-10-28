import { isRemoteFinanceAction } from '../src/engine';
import { DICE_MOVE_DELAY_MS } from "../src/presentation-timing";
import { createGame, dispatch, getNpcAction, THEMES } from '../src/engine';
import { createWelcomeMessages, sanitizeChatText, type ChatMessage } from '../src/companion';
import { labuFallback } from './labu-ai';
import { npcContext, type NpcContext } from '../src/npc-context';
import { isLabuMention, LABU_TURN_QUESTION_LIMIT, type LabuMemory } from '../src/labu-policy';
import type { GameAction, GameState, Theme } from '../src/game-types';
import type { RoomSnapshot, RoomSession } from '../src/network';

export interface RoomDatabase {
  prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<{ meta?: { changes?: number } }> }; };
}
interface Member { id: string; name: string; theme?: Theme; token: string; seen: number; pendingReclaim: boolean; lastChat?: number; labuQuota?: { round: number; used: number } }
export interface HostedLabuInput { context: NpcContext; text?: string; memory?: LabuMemory; author?: string; now?: number }
export interface HostedLabuOptions {
  ai?: (input: HostedLabuInput) => Promise<{ text: string; source: string; memory: LabuMemory }>;
  waitUntil?: (task: Promise<unknown>) => void;
}
interface LabuJob { id: string; context: NpcContext; text: string; author: string; at: number; lease?: string; leaseUntil?: number }
interface HostedRoom {
  code: string; creationId: string; creatorToken?: string; creatorHash?: string; seats: 2 | 3 | 4; maxRounds: number; hostId: string; members: Member[];
  labuJobs?: LabuJob[]; labuMemory?: LabuMemory; labuEvents?: string[];
  game: GameState | null; version: number; messages: ChatMessage[]; requests: string[]; nextAction: number;
}
interface Row { data: string; revision: number; expires_at: number }
const TTL = 86_400_000, GRACE = 30_000;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function random(bytes: number) { return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), n => n.toString(16).padStart(2, '0')).join(''); }
function name(value: unknown) { check(typeof value === 'string' && value.length <= 100, '玩家名稱無效'); const result = sanitizeChatText(value); check(result.length > 0 && result.length <= 24, '玩家名稱須為 1 至 24 字'); return result; }
function theme(value: unknown): Theme | undefined { check(value === undefined || THEMES.includes(value as Theme), '建築風格無效'); return value as Theme | undefined; }
function active(member: Member, now: number) { return now - member.seen < GRACE; }
function view(room: HostedRoom, self: Member, now: number, configured = false): RoomSnapshot {
  const game = room.game ? structuredClone(room.game) : null;
  if (game) { game.seed = 'server-managed'; game.rngState = 1; }
  return { code: room.code, seats: room.seats, hostId: room.hostId, selfId: self.id, version: room.version,
    status: !game ? 'lobby' : game.phase === 'finished' ? 'finished' : 'playing', game,
    players: room.members.map(m => ({ id: m.id, name: m.name, connected: active(m, now), host: m.id === room.hostId })),
    messages: room.messages, pendingReclaim: self.pendingReclaim,
    labu: { remaining: Math.max(0, LABU_TURN_QUESTION_LIMIT - (self.labuQuota?.round === (room.game?.round ?? 0) ? self.labuQuota.used : 0)), limit: LABU_TURN_QUESTION_LIMIT, pending: room.labuJobs?.length ?? 0, configured } };
}
function reconcile(room: HostedRoom, now: number) {
  if (!room.game) return;
  for (const member of room.members) {
    const player = room.game.players.find(p => p.id === member.id)!;
    if (!active(member, now) && !player.isNpc) { player.isNpc = true; member.pendingReclaim = true; room.version++; }
    if (active(member, now) && member.pendingReclaim && (room.game.players[room.game.currentPlayer].id !== member.id || room.game.phase === 'roll' || room.game.phase === 'finished')) {
      player.isNpc = false; member.pendingReclaim = false; room.version++;
    }
  }
}
function advance(room: HostedRoom, now: number) {
  reconcile(room, now);
  if (!room.game || room.game.phase === 'finished' || !room.members.some(m => active(m, now)) || now < room.nextAction) return;
  const action = room.game.phase === 'moving' ? { type: 'step' as const } : room.game.players[room.game.currentPlayer].isNpc ? getNpcAction(room.game) : null;
  if (action) { room.game = dispatch(room.game, action); room.version++; room.nextAction = now + (room.game.phase === 'moving' ? (room.game.pendingSteps === room.game.die ? DICE_MOVE_DELAY_MS : 450) : 900); reconcile(room, now); }
}
function publicContext(room: HostedRoom): NpcContext {
  if (room.game) return npcContext(room.game, undefined, room.messages);
  return { round: 0, turn: 0, speaker: 'Labu', personality: 'balanced', self: '房間等待開始，Labu 是陪玩助手。', standings: [], events: [], market: [], conversation: room.messages.filter(m => m.channel === 'table').slice(-6).map(({ author, text }) => ({ author, text })) };
}
function enqueue(room: HostedRoom, text: string, _author: string, now: number, _options: HostedLabuOptions) {
  room.messages.push({ id: random(8), author: 'Labu', channel: 'table', text: labuFallback(publicContext(room), text), source: 'offline', at: now });
  room.messages = room.messages.slice(-100);
}
function proactive(room: HostedRoom, previous: GameState | null, now: number, options: HostedLabuOptions) {
  if (!room.game) return;
  const game = room.game;
  const event = game.log.filter(log => log.id >= (previous?.nextLogId ?? game.nextLogId)).find(log => /通緝|偷走|偷取|搶奪|抵擋|路障|陷阱|破產|股利|升級/.test(log.text));
  const key = !previous || previous.round !== game.round ? `round/${game.round}` : event ? `event/${game.round}/${game.turn}` : '';
  if (!key || room.labuEvents?.includes(key) || (room.labuJobs?.length ?? 0) >= 48) return;
  (room.labuEvents ??= []).push(key); room.labuEvents = room.labuEvents.slice(-100);
  enqueue(room, event ? `公開事件：${event.text}。請友善吐槽或提醒一句，不要羞辱玩家。` : `第 ${game.round} 輪開始，請依公開局勢給一句有趣提醒。`, '遊戲事件', now, options);
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
/** Same-origin POST API. Caller supplies a D1-compatible binding; no timers or process-local authoritative state. */
export async function handleHostedRooms(request: Request, db: RoomDatabase, now = Date.now(), options: HostedLabuOptions = {}): Promise<Response> {
  options = {}; // Chat uses built-in responses even if a caller provides an AI adapter.
  try {
    check(request.method === 'POST', '只接受 POST');
    const origin = request.headers.get('Origin');
    check(!origin || origin === new URL(request.url).origin, '不允許跨網站操作');
    check(request.headers.get('Sec-Fetch-Site') !== 'cross-site', '不允許跨網站操作');
    check(request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json', '請使用 JSON');
    check(Number(request.headers.get('Content-Length') ?? 0) <= 16_384, '操作資料過大');
    const reader = request.body?.getReader(); check(reader, '缺少操作資料');
    const chunks: Uint8Array[] = []; let length = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 16_384) { await reader.cancel(); throw new Error('操作資料過大'); } chunks.push(part.value); } } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const input = JSON.parse(new TextDecoder().decode(bytes));
    check(input && typeof input === 'object' && !Array.isArray(input), '操作格式錯誤');
    check(typeof input.requestId === 'string' && /^[A-Za-z0-9_-]{16,100}$/.test(input.requestId), '操作識別碼無效');
    if (input.type === 'create') {
      const playerName = name(input.name), playerTheme = theme(input.theme);
      check([2, 3, 4].includes(input.seats), '房間必須為 2 至 4 席');
      const maxRounds = input.maxRounds ?? 20; check([0, 6, 10, 12, 20, 24].includes(maxRounds), '回合選項無效');
      // Creation IDs are random client UUIDs and serve as recovery secrets for a lost create response.
      check(input.requestId.length >= 32, '建立房間請使用隨機 UUID 操作識別碼');
      await db.prepare('DELETE FROM multiplayer_rooms WHERE expires_at <= ?').bind(now).run();
      const room: HostedRoom = { code: random(12).toUpperCase(), creationId: input.requestId, seats: input.seats, maxRounds, hostId: 'player-0',
        members: [{ id: 'player-0', name: playerName, theme: playerTheme, token: random(32), seen: now, pendingReclaim: false }],
        game: null, version: 0, messages: createWelcomeMessages().filter(m => m.channel !== 'private'), requests: [], nextAction: now + 900 };
      room.creatorToken = room.members[0].token;
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
      room.creatorHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))), n => n.toString(16).padStart(2, '0')).join('');
      await db.prepare("INSERT INTO multiplayer_rooms (code,data,revision,expires_at) SELECT ?,?,0,? WHERE (SELECT COUNT(*) FROM multiplayer_rooms) < 64 AND (SELECT COUNT(*) FROM multiplayer_rooms WHERE json_extract(data,'$.creatorHash') = ?) < 4 AND NOT EXISTS (SELECT 1 FROM multiplayer_rooms WHERE json_extract(data,'$.creationId') = ?)").bind(room.code, JSON.stringify(room), now + TTL, room.creatorHash, input.requestId).run();
      const saved = await db.prepare("SELECT data,revision,expires_at FROM multiplayer_rooms WHERE json_extract(data,'$.creationId') = ?").bind(input.requestId).first<Row>();
      check(saved, '房間已滿，請稍後再試');
      const result = JSON.parse(saved.data) as HostedRoom, self = result.members.find(m => m.token === result.creatorToken);
      check(self, '原建立者已離開，請重新建立房間');
      return response({ snapshot: view(result, self, now, !!options.ai), session: { code: result.code, token: self.token, playerId: self.id } satisfies RoomSession });
    }
    check(typeof input.code === 'string' && /^[0-9A-Fa-f]{24}$/.test(input.code), '房間邀請碼無效');
    const code = input.code.toUpperCase();
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await db.prepare('SELECT data,revision,expires_at FROM multiplayer_rooms WHERE code = ?').bind(code).first<Row>();
      check(row && row.expires_at > now, '房間不存在或已過期');
      const room = JSON.parse(row.data) as HostedRoom;
      if (room.labuJobs?.length) room.labuJobs = [];
      const previousGame = room.game ? structuredClone(room.game) : null;
      let self: Member | undefined;
      let session: RoomSession | undefined;
      if (input.type === 'join') {
        check(input.requestId.length >= 32, '加入房間請使用隨機 UUID 操作識別碼');
        const playerName = name(input.name), playerTheme = theme(input.theme);
        // Retry recovers the same assigned seat rather than adding another player.
        const old = room.requests.find(key => key.startsWith(`join/${input.requestId}/`));
        self = old ? room.members.find(m => m.token === old.split('/')[2]) : undefined;
        if (!self) {
          check(!room.game, '遊戲已開始，無法加入新席位'); check(room.members.length < room.seats, '房間已滿');
          const occupied = new Set(room.members.map(m => m.id)); let index = 0; while (occupied.has(`player-${index}`)) index++;
          self = { id: `player-${index}`, name: playerName, theme: playerTheme, token: random(32), seen: now, pendingReclaim: false };
          room.members.push(self); room.requests.push(`join/${input.requestId}/${self.token}`); room.version++;
        }
        session = { code, token: self.token, playerId: self.id };
      } else {
        check(typeof input.token === 'string' && /^[0-9a-f]{64}$/.test(input.token), '登入憑證無效');
        self = room.members.find(m => m.token === input.token); check(self, '房間或重新連線憑證無效');
      }
      const dedupe = `${self.token}/${input.requestId}`;
      const duplicate = room.requests.includes(dedupe);
      if (!duplicate && input.type !== 'join') {
        // Determine takeover from the previous heartbeat before marking the caller online.
        reconcile(room, now); if (input.type !== 'poll' || now - self.seen >= 5000) self.seen = now; reconcile(room, now);
        if (input.type === 'reconnect') session = { code, token: self.token, playerId: self.id };
        else if (input.type === 'poll') advance(room, now);
        else if (input.type === 'start') {
          check(self.id === room.hostId, '只有房主可以開始'); check(!room.game, '遊戲已開始');
          // Lobby members retain stable IDs; empty positions are filled by NPCs.
          room.members.sort((a, b) => Number(a.id.slice(7)) - Number(b.id.slice(7)));
          const players = Array.from({ length: room.seats }, (_, index) => { const member = room.members.find(m => m.id === `player-${index}`); return member ? { name: member.name, theme: member.theme, isNpc: !active(member, now) } : { name: index === room.members.length ? 'Labu' : `玩具夥伴 ${index + 1}`, theme: THEMES[index], isNpc: true }; });
          room.game = createGame({ seats: room.seats, maxRounds: room.maxRounds, seed: random(32), players }); for (const member of room.members) member.pendingReclaim = !active(member, now); room.version++; room.nextAction = now + 900;
        } else if (input.type === 'command') {
          check(room.game, '遊戲尚未開始'); check(input.expectedVersion === room.version && Number.isSafeInteger(input.expectedVersion), '狀態已更新，請依最新畫面重試');
          const actor = room.game.players.find(p=>p.id===self.id)!; check((room.game.players[room.game.currentPlayer].id === self.id || isRemoteFinanceAction(input.action)) && !actor.isNpc && !self.pendingReclaim, '現在不是你的回合，或 NPC 正在完成本回合');
          check(input.action && typeof input.action === 'object' && !Array.isArray(input.action) && input.action.type !== 'step', '移動由伺服器處理');
          room.game = dispatch(room.game, { ...input.action, actorId: self.id } as GameAction); room.version++; if (!isRemoteFinanceAction(input.action)) room.nextAction = now + (room.game.phase === 'moving' ? (room.game.pendingSteps === room.game.die ? DICE_MOVE_DELAY_MS : 450) : 900);
        } else if (input.type === 'chat') {

          check(input.channel === undefined || input.channel === 'table', '不接受私人訊息'); check(typeof input.text === 'string' && input.text.length <= 500, '聊天限 500 字');
          const text = sanitizeChatText(input.text); check(text.length, '請輸入聊天內容');
          const ask = input.askLabu === true || isLabuMention(text);
          if (ask) {
            const round = room.game?.round ?? 0;
            if (self.labuQuota?.round !== round) self.labuQuota = { round, used: 0 };
            check(self.labuQuota.used < LABU_TURN_QUESTION_LIMIT, '本輪已詢問 Labu 10 次，下一輪會恢復額度');
            self.labuQuota.used++;
          } else { check(now - (self.lastChat ?? 0) >= 1000, '聊天太頻繁，請稍後再試'); self.lastChat = now; }
          room.messages.push({ id: random(8), author: self.name, channel: 'table', text, at: now }); room.messages = room.messages.slice(-100);
          if (ask) enqueue(room, text, self.name, now, options);
        } else if (input.type === 'leave') {
          self.seen = now - GRACE;
          // Preserve the slot and credential so refresh/reconnect can reclaim it safely.
          reconcile(room, now);
          if (!room.game) { room.members = room.members.filter(m => m.id !== self!.id); if (self.id === room.hostId) room.hostId = room.members[0]?.id ?? ''; }
          room.version++;
        } else throw new Error('未知房間操作');
      }
      if (!duplicate && ['start', 'command', 'poll'].includes(input.type)) proactive(room, previousGame, now, options);
      if (!duplicate && input.type !== 'poll') room.requests.push(dedupe);
      room.requests = room.requests.slice(-512);
      if (JSON.stringify(room) === row.data) { return response({ snapshot: view(room, self, now, !!options.ai), ...(session ? { session } : {}) }); }
      const saved = await db.prepare('UPDATE multiplayer_rooms SET data = ?, revision = revision + 1, expires_at = ? WHERE code = ? AND revision = ? AND expires_at > ?').bind(JSON.stringify(room), now + TTL, code, row.revision, now).run();
      if (saved.meta?.changes === 1) { return response({ snapshot: view(room, self, now, !!options.ai), ...(session ? { session } : {}) }); }
    }
    return response({ error: '房間忙碌中，請用相同操作識別碼重試' }, 409);
  } catch (error) { return response({ error: error instanceof Error ? error.message : '房間操作失敗' }, 400); }
}

export const handleRoomRequest = handleHostedRooms;
