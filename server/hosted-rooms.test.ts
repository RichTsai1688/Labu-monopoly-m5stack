import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { handleHostedRooms, type RoomDatabase } from './hosted-rooms';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE multiplayer_rooms(code TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
  let writes = 0;
  const db: RoomDatabase = { prepare(query) { return { bind(...values: unknown[]) { return {
    async first<T>() { return (sql.prepare(query).get(...values as any[]) ?? null) as T | null; },
    async run() { writes++; return { meta: { changes: Number(sql.prepare(query).run(...values as any[]).changes) } }; },
  }; } }; } };
  async function send(body: object, now = 100000, origin = 'https://game.example') {
    const result = await handleHostedRooms(new Request('https://game.example/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }) }), db, now);
    return await result.json() as any;
  }
  return { send, sql, writes: () => writes };
}
describe('persistent hosted rooms', () => {
  it('lets another player trade only their own account without delaying dice movement',async()=>{
    const f=fixture(),a=await f.send({type:'create',name:'主人',seats:2});
    const b=await f.send({type:'join',name:'朋友',code:a.session.code});
    const start=await f.send({type:'start',...a.session});
    const roll=await f.send({type:'command',...a.session,expectedVersion:start.snapshot.version,action:{type:'roll'}});
    const deadline=JSON.parse((f.sql.prepare('SELECT data FROM multiplayer_rooms').get() as any).data).nextAction;
    const trade=await f.send({type:'command',...b.session,expectedVersion:roll.snapshot.version,action:{type:'buyStock',actorId:a.session.playerId,stockId:'stock-0',quantity:1,expectedPrice:30}},100500);
    expect(trade.error).toBeUndefined();expect(trade.snapshot.game.players[1].deposit).toBe(1970);expect(trade.snapshot.game.players[0].deposit).toBe(2000);
    expect(JSON.parse((f.sql.prepare('SELECT data FROM multiplayer_rooms').get() as any).data).nextAction).toBe(deadline);
    const invalid=await f.send({type:'command',...b.session,expectedVersion:trade.snapshot.version,action:{type:'buy'}},100600);expect(invalid.error).toContain('不是你的回合');f.sql.close();
  });

  it('creates securely, joins concurrently once, keeps secrets private, and fills NPCs', async () => {
    const f = fixture(), requestId = crypto.randomUUID();
    const [a,b] = await Promise.all([f.send({ type: 'create', name: '小熊', seats: 4, requestId }), f.send({ type: 'create', name: '小熊', seats: 4, requestId })]);
    expect(a.session).toEqual(b.session); expect(a.session.code).toHaveLength(24); expect(a.session.token).toHaveLength(64);
    const join = { type: 'join', code: a.session.code, name: '朋友', requestId: crypto.randomUUID() };
    const [c,d] = await Promise.all([f.send(join), f.send(join)]); expect(c.session).toEqual(d.session); expect(d.snapshot.players).toHaveLength(2);
    expect((await f.send({ type: 'start', ...c.session })).error).toContain('房主');
    const started = await f.send({ type: 'start', ...a.session });
    expect(started.snapshot.game.players.map((p: any) => p.isNpc)).toEqual([false,false,true,true]);
    expect(started.snapshot.game.seed).toBe('server-managed'); expect(JSON.stringify(started.snapshot)).not.toContain(a.session.token);
    expect((await f.send({ type: 'command', ...a.session, expectedVersion: started.snapshot.version, action: { type: 'step' } })).error).toContain('伺服器');
    f.sql.close();
  });
  it('CAS prevents duplicate rolls and enforces step timing, actor and version', async () => {
    const f = fixture(), { session } = await f.send({ type: 'create', name: '主人', seats: 2 });
    const started = await f.send({ type: 'start', ...session });
    const command = { type: 'command', ...session, expectedVersion: started.snapshot.version, action: { type: 'roll' }, requestId: crypto.randomUUID() };
    const [a,b] = await Promise.all([f.send(command), f.send(command)]); expect(a.snapshot.version).toEqual(b.snapshot.version);
    const before = a.snapshot.game.pendingSteps;
    expect((await f.send({ type: 'poll', ...session },102899)).snapshot.game.pendingSteps).toBe(before);
    expect((await f.send({ type: 'poll', ...session },102900)).snapshot.game.pendingSteps).toBe(before-1);
    expect((await f.send({ type: 'poll', ...session },102900)).snapshot.game.pendingSteps).toBe(before-1);
    expect((await f.send({ ...command, requestId: crypto.randomUUID() })).error).toContain('更新');
    f.sql.close();
  });
  it('idle polling avoids writes, reconnect safely reclaims, expired/cross-origin requests fail', async () => {
    const f = fixture(), { session } = await f.send({ type: 'create', name: '主人', seats: 2 });
    await f.send({ type: 'start', ...session }); const writes = f.writes();
    await f.send({ type: 'poll', ...session },100500); expect(f.writes()).toBe(writes);
    const resumed = await f.send({ type: 'reconnect', ...session },140000);
    expect(resumed.snapshot.game.players[0].isNpc).toBe(false); expect(resumed.session).toEqual(session);
    expect((await f.send({ type: 'poll', ...session },140001,'https://evil.example')).error).toContain('跨網站');
    expect((await f.send({ type: 'poll', ...session },140000+86_400_001)).error).toContain('過期'); f.sql.close();
  });
  it('a member absent at start reclaims an NPC seat on reconnect', async () => {
    const f = fixture(), a = await f.send({ type:'create',name:'主人',seats:2 });
    const b = await f.send({ type:'join',name:'朋友',code:a.session.code });
    const started = await f.send({ type:'start',...a.session },131000);
    expect(started.snapshot.game.players[1].isNpc).toBe(true);
    const returned = await f.send({ type:'reconnect',...b.session },131001);
    expect(returned.snapshot.game.players[1].isNpc).toBe(false);
    expect(returned.snapshot.pendingReclaim).toBe(false); f.sql.close();
  });
  it('lobby leave releases a seat without leaking another member session on create retry', async () => {
    const f = fixture(), id = crypto.randomUUID(), create = { type: 'create', name:'主人', seats:2, requestId:id };
    const a = await f.send(create), b = await f.send({ type:'join',name:'朋友',code:a.session.code });
    await f.send({ type:'leave',...a.session });
    expect((await f.send(create)).error).toContain('離開');
    const c = await f.send({ type:'join',name:'新朋友',code:a.session.code }); expect(c.snapshot.players).toHaveLength(2); expect(c.snapshot.hostId).toBe(b.session.playerId);
    f.sql.close();
  });
});
