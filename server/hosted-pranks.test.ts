import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CARD_PRICES } from '../src/engine';
import type { Card, GameState } from '../src/game-types';
import { handleHostedRooms, type RoomDatabase } from './hosted-rooms';

// Each test uses only isolated in-memory SQLite and fake local authenticated sessions.
async function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE multiplayer_rooms(code TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
  const db: RoomDatabase = { prepare(query) { return { bind(...values: unknown[]) { return {
    async first<T>() { return (sql.prepare(query).get(...values as any[]) ?? null) as T | null; },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...values as any[]).changes) } }; },
  }; } }; } };
  async function send(body: object, now = 100000) {
    const response = await handleHostedRooms(new Request('https://game.example/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://game.example' }, body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }) }), db, now);
    return response.json() as Promise<any>;
  }
  const host = (await send({ type: 'create', name: '攻擊者', seats: 3 })).session;
  const guest = (await send({ type: 'join', name: '對手', code: host.code })).session;
  const observer = (await send({ type: 'join', name: '旁觀玩家', code: host.code })).session;
  await send({ type: 'start', ...host });
  function edit(change: (game: GameState) => void) {
    const row = sql.prepare('SELECT data FROM multiplayer_rooms WHERE code = ?').get(host.code) as { data: string };
    const room = JSON.parse(row.data); change(room.game);
    sql.prepare('UPDATE multiplayer_rooms SET data = ? WHERE code = ?').run(JSON.stringify(room), host.code);
    return room.version as number;
  }
  async function command(action: object, version: number, session = host, extra = {}) {
    return send({ type: 'command', ...session, expectedVersion: version, action, ...extra });
  }
  return { sql, send, edit, command, host, guest, observer };
}

describe('hosted prank cards', () => {
  it.each<Card>(['wanted', 'steal', 'roadblock', 'trap', 'shutdown', 'swap', 'bodyguard'])('sells %s and replicates payment and inventory to another authenticated seat', async card => {
    const f = await fixture();
    try {
      const version = f.edit(g => { g.phase = 'action'; g.players[0].position = g.tiles.find(t => t.type === 'shop')!.id; });
      const bought = await f.command({ type: 'shop', card }, version);
      expect(bought.error).toBeUndefined();
      expect(bought.snapshot.game.players[0].cash).toBe(4000 - CARD_PRICES[card]);
      expect(bought.snapshot.game.players[0].cards).toEqual([card]);
      const other = await f.send({ type: 'poll', ...f.guest });
      expect(other.snapshot.game).toEqual(bought.snapshot.game);
    } finally { f.sql.close(); }
  });

  it('binds actions to the authenticated seat, rejects invalid targets, and deduplicates a cash attack', async () => {
    const f = await fixture();
    try {
      const version = f.edit(g => { g.players[0].cards = ['steal']; });
      expect((await f.command({ type: 'useCard', card: 'steal', targetId: f.host.playerId, actorId: f.host.playerId }, version, f.guest)).error).toContain('回合');
      for (const targetId of [f.host.playerId, 'player-does-not-exist']) {
        expect((await f.command({ type: 'useCard', card: 'steal', targetId }, version)).error).toContain('玩家');
      }
      const requestId = crypto.randomUUID();
      const action = { type: 'useCard', card: 'steal', targetId: f.guest.playerId, actorId: f.guest.playerId, amount: 999999 };
      const a = await f.command(action, version, f.host, { requestId });
      expect(a.error).toBeUndefined();
      expect(a.snapshot.game.players.map((p: any) => p.cash)).toEqual([4300, 3700, 4000]);
      expect(a.snapshot.game.players.map((p: any) => p.deposit)).toEqual([2000, 2000, 2000]);
      const b = await f.command(action, version, f.host, { requestId });
      expect(b.snapshot.game).toEqual(a.snapshot.game);
      expect(b.snapshot.version).toBe(a.snapshot.version);
      expect((await f.command(action, version)).error).toContain('更新');
      const observer = await f.send({ type: 'poll', ...f.observer });
      expect(observer.snapshot.game).toEqual(a.snapshot.game);
    } finally { f.sql.close(); }
  });

  it.each<Card>(['wanted', 'steal'])('consumes the target bodyguard instead of applying %s', async card => {
    const f = await fixture();
    try {
      const version = f.edit(g => { g.players[0].cards = [card]; g.players[1].cards = ['bodyguard']; });
      const result = await f.command({ type: 'useCard', card, targetId: f.guest.playerId }, version);
      expect(result.error).toBeUndefined();
      const players = result.snapshot.game.players;
      expect(players[0].cards).toEqual([]); expect(players[1].cards).toEqual([]);
      expect(players[1].cash).toBe(4000); expect(players[1].jailTurns).toBe(0);
      expect(players[1].position).toBe(0);
      expect((await f.send({ type: 'poll', ...f.guest })).snapshot.game).toEqual(result.snapshot.game);
    } finally { f.sql.close(); }
  });

  it.each<Card>(['wanted', 'swap', 'shutdown'])('replicates unguarded %s effects from authoritative state', async card => {
    const f = await fixture();
    try {
      let tileId = 0;
      const version = f.edit(g => {
        g.players[0].cards = [card]; g.players[0].position = 3; g.players[1].position = 7;
        const tile = g.tiles.find(t => t.type === 'property')!; tile.ownerId = g.players[1].id; tile.level = 1; tileId = tile.id;
      });
      const result = await f.command({ type: 'useCard', card, targetId: f.guest.playerId, tileId }, version);
      expect(result.error).toBeUndefined();
      const g = result.snapshot.game;
      if (card === 'wanted') { expect(g.players[1].position).toBe(12); expect(g.players[1].wantedSkip).toBe(true); }
      if (card === 'swap') { expect(g.players[0].position).toBe(7); expect(g.players[1].position).toBe(3); expect(g.players.map((p: any) => p.cash)).toEqual([4000, 4000, 4000]); }
      if (card === 'shutdown') expect(g.tiles[tileId].closedUntilTurn).toBe(g.turn + 3);
      expect((await f.send({ type: 'poll', ...f.observer })).snapshot.game).toEqual(g);
    } finally { f.sql.close(); }
  });

  it.each<Card>(['roadblock', 'trap'])('triggers %s only on a timed server movement step', async card => {
    const f = await fixture();
    try {
      let tileId = 0;
      const version = f.edit(g => { g.players[0].cards = [card]; tileId = g.tiles.find(t => t.type === 'property')!.id; });
      const placed = await f.command({ type: 'useCard', card, tileId }, version);
      expect(placed.error).toBeUndefined();
      expect(placed.snapshot.game.hazards).toHaveLength(1);
      // Prepare a legitimate movement immediately before the placed tile; the API alone advances it.
      const movingVersion = f.edit(g => { g.currentPlayer = 1; g.players[1].position = tileId - 1; g.phase = 'moving'; g.pendingSteps = 3; });
      expect((await f.command({ type: 'step' }, movingVersion, f.guest)).error).toContain('伺服器');
      const early = await f.send({ type: 'poll', ...f.guest }, 100899);
      expect(early.snapshot.game.hazards).toHaveLength(1);
      const landed = await f.send({ type: 'poll', ...f.guest }, 100900);
      const g = landed.snapshot.game;
      expect(g.players[1].position).toBe(tileId); expect(g.hazards).toEqual([]);
      expect(g.marketTick).toBe(placed.snapshot.game.marketTick + 1);
      if (card === 'roadblock') { expect(g.pendingSteps).toBe(0); expect(g.phase).toBe('action'); }
      else { expect(g.pendingSteps).toBe(2); expect(g.players[0].cash).toBe(4150); expect(g.players[1].cash).toBe(3850); }
      expect((await f.send({ type: 'poll', ...f.observer }, 100900)).snapshot.game).toEqual(g);
    } finally { f.sql.close(); }
  });

  it('supports an existing persisted room without optional prank fields', async () => {
    const f = await fixture();
    try {
      const version = f.edit(g => {
        delete g.hazards;
        for (const p of g.players) { delete p.wantedSkip; delete p.wantedImmuneUntilRound; }
        for (const t of g.tiles) delete t.closedUntilTurn;
        g.players[0].cards = ['steal'];
      });
      const result = await f.command({ type: 'useCard', card: 'steal', targetId: f.guest.playerId }, version);
      expect(result.error).toBeUndefined();
      expect(result.snapshot.game.players[0].cash).toBe(4300);
      expect((await f.send({ type: 'reconnect', ...f.guest })).snapshot.game).toEqual(result.snapshot.game);
    } finally { f.sql.close(); }
  });
});
