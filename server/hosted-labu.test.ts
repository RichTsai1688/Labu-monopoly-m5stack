import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { handleHostedRooms, type RoomDatabase, type HostedLabuOptions } from './hosted-rooms';
function fixture(options: HostedLabuOptions = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE multiplayer_rooms(code TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
  const db: RoomDatabase = { prepare(query) { return { bind(...values: unknown[]) { return {
    async first<T>() { return (sql.prepare(query).get(...values as any[]) ?? null) as T | null; },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...values as any[]).changes) } }; },
  }; } }; } };
  async function send(body: object, now = 100000) {
    return await (await handleHostedRooms(new Request('https://game.example/api/rooms', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),...body}) }),db,now,options)).json() as any;
  }
  function read(code: string) { return JSON.parse((sql.prepare('SELECT data FROM multiplayer_rooms WHERE code = ?').get(code) as any).data); }
  function write(code: string, data: unknown) { sql.prepare('UPDATE multiplayer_rooms SET data = ?, revision = revision + 1 WHERE code = ?').run(JSON.stringify(data),code); }
  return {sql,send,read,write};
}
describe('hosted Labu conversation',()=> {
  it('only addresses Labu explicitly, counts ten asks per full round, dedupes retries with no cooldown',async()=> {
    const f=fixture(), {session}=await f.send({type:'create',name:'熊',seats:2});
    const ordinary=await f.send({type:'chat',...session,text:'你好大家'});
    const count=ordinary.snapshot.messages.length;
    const id=crypto.randomUUID();
    const first=await f.send({type:'chat',...session,text:'老布怎麼玩',requestId:id});
    expect(first.snapshot.messages.length).toBe(count+2); expect(first.snapshot.labu.remaining).toBe(9);
    const duplicate=await f.send({type:'chat',...session,text:'老布怎麼玩',requestId:id});
    expect(duplicate.snapshot.labu.remaining).toBe(9);
    for(let i=0;i<9;i++) expect((await f.send({type:'chat',...session,text:'怎麼買地',askLabu:true})).error).toBeUndefined();
    expect((await f.send({type:'chat',...session,text:'Labu你好'})).error).toContain('10');
    const started=await f.send({type:'start',...session}); expect(started.snapshot.labu.remaining).toBe(10);
    const stored=f.read(session.code); stored.game.round=2; f.write(session.code,stored);
    expect((await f.send({type:'chat',...session,text:'拉布你好'})).snapshot.labu.remaining).toBe(9);
    f.sql.close();
  });
  it('uses preset responses even when an AI adapter is supplied',async()=> {
    let calls=0;
    const f=fixture({ai:async()=>{calls++;return {text:'AI 回覆',source:'ai',memory:{summary:'',entries:[]}};}});
    const {session}=await f.send({type:'create',name:'熊',seats:2});
    const reply=await f.send({type:'chat',...session,text:'Labu 怎麼買股票？'});
    expect(calls).toBe(0); expect(reply.snapshot.labu.configured).toBe(false);
    expect(reply.snapshot.messages.at(-1).source).toBe('offline');
    expect(reply.snapshot.messages.at(-1).text).toContain('股票');
    f.sql.close();
  });
  it('comments on newly resolved public attacks once per turn without spending player quota',async()=> {
    const f=fixture(), {session}=await f.send({type:'create',name:'熊',seats:2});
    await f.send({type:'start',...session});
    const room=f.read(session.code);
    room.game.players[0].cards.push('steal');
    f.write(session.code,room);
    const reply=await f.send({type:'command',...session,expectedVersion:room.version,action:{type:'useCard',card:'steal',targetId:'player-1'}});
    if (reply.error) throw new Error(reply.error);
    expect(reply.snapshot.labu.remaining).toBe(10);
    expect(reply.snapshot.messages.filter((m:any)=>m.author==='Labu').length).toBeGreaterThan(1);
    const before=reply.snapshot.messages.length;
    const after=await f.send({type:'poll',...session},100100);
    expect(after.snapshot.messages.length).toBe(before);
    f.sql.close();
  });
  it('discards old queued AI requests without invoking the adapter',async()=> {
    let calls=0; const f=fixture({ai:async()=>{calls++;return {text:'AI',source:'ai',memory:{summary:'',entries:[]}};}});
    const {session}=await f.send({type:'create',name:'熊',seats:2});
    const stored=f.read(session.code); stored.labuJobs=[{id:'old',text:'secret prompt',author:'熊',at:1,context:{round:1}}]; f.write(session.code,stored);
    const result=await f.send({type:'poll',...session});
    expect(calls).toBe(0); expect(result.snapshot.labu.pending).toBe(0);
    expect(f.read(session.code).labuJobs).toHaveLength(0); f.sql.close();
  });
});
