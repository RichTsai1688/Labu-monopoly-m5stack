import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { startRoomServer } from './room-server';
import type { RoomSnapshot, RoomSession } from '../src/network';
import { RoomClient } from '../src/network';

type Service = Awaited<ReturnType<typeof startRoomServer>>;
const services: Service[] = [];
const peers: Peer[] = [];
let requestNumber = 0;
const waitUntil = async (condition: () => boolean, timeout = 4000) => {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for room state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
class Peer {
  socket: WebSocket;
  snapshot: RoomSnapshot | null = null;
  session: RoomSession | null = null;
  messages: any[] = [];
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('message', data => {
      const message = JSON.parse(data.toString());
      this.messages.push(message);
      if (message.type === 'snapshot') this.snapshot = message.snapshot;
      if (message.type === 'session') this.session = message.session;
    });
    this.socket.on('error', () => {});
    peers.push(this);
  }
  async ready() { await waitUntil(() => this.socket.readyState === WebSocket.OPEN); return this; }
  async ask(type: string, data: object = {}, id = `r-${++requestNumber}`) {
    const offset = this.messages.length;
    this.socket.send(JSON.stringify({ type, requestId: id, ...data }));
    await waitUntil(() => this.messages.slice(offset).some(m => m.requestId === id && (m.type === 'ack' || m.type === 'error')));
    return this.messages.slice(offset).find(m => m.requestId === id && (m.type === 'ack' || m.type === 'error'));
  }
  command(action: object, expectedVersion = this.snapshot!.version, id?: string) { return this.ask('command', { action, expectedVersion }, id); }
  close() { this.socket.close(); }
}
async function setup(options: Parameters<typeof startRoomServer>[0] = {}) {
  const service = await startRoomServer({ port: 0, stepMs: 8, rollMs: 8, npcMs: 8, disconnectGraceMs: 40, ...options });
  services.push(service);
  const host = await new Peer(service.url).ready();
  expect((await host.ask('create', { name: '小花', seats: 4, maxRounds: 2 })).type).toBe('ack');
  const guest = await new Peer(service.url).ready();
  expect((await guest.ask('join', { code: host.session!.code, name: '小明' })).type).toBe('ack');
  return { service, host, guest };
}
afterEach(async () => {
  for (const peer of peers.splice(0)) peer.socket.terminate();
  for (const service of services.splice(0)) await service.close();
  vi.unstubAllGlobals();
});

describe('local authoritative rooms', () => {
  it('shares AI replies from authoritative public state without changing game version', async () => {
    const reply = vi.fn(async () => ({text:'我在城市裡等下一回合！',source:'ai' as const}));
    const {host,guest}=await setup({npcChat:{configured:true,reply,close(){}}});
    await host.ask('start');const version=host.snapshot!.version;
    await guest.ask('chat',{text:'Labu，你在哪？'});
    await waitUntil(()=>!!host.snapshot?.messages.some(m=>m.source==='ai'));
    expect(guest.snapshot!.messages.some(m=>m.source==='ai')).toBe(true);expect(host.snapshot!.version).toBe(version);
    expect(JSON.stringify(reply.mock.calls)).not.toMatch(/rngState|server-managed|welcome-private/);
    expect((await host.ask('chat',{text:'secret',channel:'private'})).type).toBe('error');expect(reply).toHaveBeenCalledTimes(1);
  });

  it('invites two independent clients, restricts start to host, fills NPCs, and keeps tokens private', async () => {
    const { host, guest } = await setup();
    expect(host.snapshot!.players).toHaveLength(2);
    expect((await guest.ask('start')).type).toBe('error');
    expect((await host.ask('start')).type).toBe('ack');
    expect(host.snapshot!.game!.players).toHaveLength(4);
    expect(host.snapshot!.game!.players.map(p => p.isNpc)).toEqual([false, false, true, true]);
    expect(host.snapshot!.game).toEqual(guest.snapshot!.game);
    expect(guest.snapshot!.selfId).toBe('player-1');
    expect(guest.snapshot!.game!.seed).toBe('server-managed');
    expect(JSON.stringify(guest.messages)).not.toContain(host.session!.token);
    const late = await new Peer(services[0].url).ready();
    expect((await late.ask('join', { code: host.session!.code, name: '遲到' })).type).toBe('error');
  });

  it('derives actors from sockets, rejects replay/stale/step commands, and moves stocks on the server', async () => {
    const { host, guest } = await setup({ stepMs: 30 });
    await host.ask('start');
    expect((await guest.command({ type: 'roll', actorId: 'player-0' })).type).toBe('error');
    const version = host.snapshot!.version;
    expect((await host.command({ type: 'roll', actorId: 'player-1' }, version, 'roll-replay')).type).toBe('ack');
    const distance = host.snapshot!.game!.die!;
    expect((await host.command({ type: 'roll' }, version, 'roll-replay')).message).toContain('已處理');
    expect((await host.command({ type: 'finishTurn' }, version)).message).toContain('狀態已更新');
    expect((await host.command({ type: 'step' })).message).toContain('伺服器');
    await waitUntil(() => host.snapshot!.game!.phase === 'action' && guest.snapshot!.game!.phase === 'action');
    expect(host.snapshot!.game!.marketTick).toBe(distance);
    expect(host.snapshot!.game).toEqual(guest.snapshot!.game);
    expect(host.snapshot!.game!.players[1].position).toBe(0);
  });

  it('broadcasts bounded plain chat with actual sender and keeps private reminders off the wire', async () => {
    const { host, guest } = await setup();
    const literal = '<img src=x onerror=alert(1)>';
    expect((await host.ask('chat', { text: literal, author: '偽造名字' })).type).toBe('ack');
    expect(guest.snapshot!.messages.find(m => m.text === literal)?.author).toBe('小花');
    expect(guest.snapshot!.messages.some(m => m.channel === 'private')).toBe(false);
    expect((await host.ask('chat', { channel: 'private', text: 'private-secret' })).type).toBe('error');
    expect(JSON.stringify(guest.snapshot)).not.toContain('private-secret');
    await host.ask('chat', { text: '🎲'.repeat(400) });
    expect(Array.from(guest.snapshot!.messages.at(-1)!.text)).toHaveLength(280);
    for (let i = 0; i < 55; i++) await host.ask('chat', { text: `Labu 訊息 ${i}` });
    expect(guest.snapshot!.messages).toHaveLength(100);
    expect(guest.snapshot!.messages.at(-1)!.author).toBe('Labu');
  });

  it('lets a disconnected seat run as NPC and reclaims it at a safe turn boundary', async () => {
    const { service, host, guest } = await setup({ npcMs: 40, stepMs: 40 });
    await host.ask('start');
    const session = host.session!;
    host.close();
    await waitUntil(() => guest.snapshot!.game!.players[0].isNpc && guest.snapshot!.game!.phase === 'moving');
    const resumed = await new Peer(service.url).ready();
    expect((await resumed.ask('reconnect', session)).type).toBe('ack');
    expect(resumed.snapshot!.pendingReclaim).toBe(true);
    expect((await resumed.command({ type: 'finishTurn' })).type).toBe('error');
    await waitUntil(() => resumed.snapshot!.game!.currentPlayer === 1 && !resumed.snapshot!.pendingReclaim);
    expect(resumed.snapshot!.game!.players[0].isNpc).toBe(false);
    expect(resumed.snapshot!.selfId).toBe('player-0');
    const impostor = await new Peer(service.url).ready();
    expect((await impostor.ask('reconnect', { code: session.code, token: 'wrong' })).type).toBe('error');
  });

  it('expires idle rooms and disposes connections and scheduled callbacks', async () => {
    const { service, host } = await setup({ roomTtlMs: 80 });
    await waitUntil(() => service.stats().rooms === 0);
    await waitUntil(() => host.socket.readyState === WebSocket.CLOSED);
    await service.close();
    await service.close();
    expect(service.stats()).toEqual({ rooms: 0, connections: 0, scheduledRooms: 0 });
  });

  it('limits room creation and lobby capacity', async () => {
    const { service, host } = await setup({ maxRooms: 1 });
    const another = await new Peer(service.url).ready();
    expect((await another.ask('create', { name: '別桌', seats: 2 })).message).toContain('房間已滿');
    for (const name of ['三號', '四號']) { const peer = await new Peer(service.url).ready(); expect((await peer.ask('join', { code: host.session!.code, name })).type).toBe('ack'); }
    expect((await another.ask('join', { code: host.session!.code, name: '五號' })).message).toContain('房間已滿');
  });

  it('rejects unrelated browser origins before establishing a socket', async () => {
    const { service } = await setup();
    const socket = new WebSocket(service.url, { origin: 'https://unrelated.invalid' });
    const rejected = await new Promise<boolean>(resolve => {
      socket.on('open', () => { socket.close(); resolve(false); });
      socket.on('error', () => resolve(true));
    });
    expect(rejected).toBe(true);
    expect(service.stats().connections).toBe(2);
  });

  it('runs the browser adapter through create, join, chat, start, command, and close', async () => {
    const service = await startRoomServer({ port: 0, stepMs: 5, rollMs: 5, npcMs: 5 }); services.push(service);
    vi.stubGlobal('WebSocket', WebSocket);
    let a: RoomSnapshot | null = null, b: RoomSnapshot | null = null;
    const errors: string[] = [];
    const clientA = new RoomClient(service.url, { onSnapshot: s => { a = s; }, onError: e => errors.push(e) });
    const clientB = new RoomClient(service.url, { onSnapshot: s => { b = s; } });
    try {
      await clientA.create({ name: '介面 A', seats: 2 });
      await clientB.join({ code: clientA.session!.code, name: '介面 B' });
      await clientA.chat('股票怎麼更新');
      await clientA.start();
      await clientA.command({ type: 'roll' });
      await waitUntil(() => a?.game?.phase === 'action');
      expect(a!.game!.marketTick).toBeGreaterThan(0);
      expect(b!.game).toEqual(a!.game);
      expect(errors).toEqual([]);
    } finally { clientA.close(); clientB.close(); }
  });
});
