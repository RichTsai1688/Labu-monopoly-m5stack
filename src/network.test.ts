import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomClient, type RoomSnapshot } from './network';

const session = { code: 'ABCD12', token: 'private-token', playerId: 'p0' };
const snapshot = (version = 1): RoomSnapshot => ({ code: session.code, version, status: 'lobby', seats: 4, hostId: 'p0', selfId: 'p0', players: [], game: null, messages: [], pendingReclaim: false });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('hosted room HTTP transport', () => {
  it('authenticates polls, ignores unchanged and old snapshots, and leaves without further polling', async () => {
    vi.useFakeTimers();
    const onSnapshot = vi.fn(), onSession = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ session, snapshot: snapshot(2) }))
      .mockResolvedValueOnce(Response.json({ snapshot: snapshot(2) }))
      .mockResolvedValueOnce(Response.json({ snapshot: snapshot(1) }))
      .mockImplementation(() => Promise.resolve(Response.json({ snapshot: snapshot(3) })));
    vi.stubGlobal('fetch', fetcher);
    const client = new RoomClient('/api/rooms', { onSnapshot, onSession });
    await client.create({ name: '小熊', seats: 4 });
    expect(onSession).toHaveBeenCalledWith(session);
    await vi.advanceTimersByTimeAsync(900);
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    const poll = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(poll).toMatchObject({ type: 'poll', code: session.code, token: session.token });
    client.close();
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).type).toBe('leave');
    const count = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetcher).toHaveBeenCalledTimes(count);
  });

  it('backs off temporary polling failures and resumes when service recovers', async () => {
    vi.useFakeTimers();
    const onSnapshot = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ session, snapshot: snapshot() }))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockImplementation(() => Promise.resolve(Response.json({ snapshot: snapshot(2) })));
    vi.stubGlobal('fetch', fetcher);
    const client = new RoomClient('/api/rooms', { onSnapshot });
    await client.join({ code: session.code, name: '朋友' });
    await vi.advanceTimersByTimeAsync(450);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(899);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    client.close();
  });

  it('retries an uncertain create once with the identical idempotency key and body', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('response lost after commit'))
      .mockResolvedValueOnce(Response.json({ session, snapshot: snapshot() }))
      .mockImplementation(() => Promise.resolve(Response.json({})));
    vi.stubGlobal('fetch', fetcher);
    const client = new RoomClient('/api/rooms', { onSnapshot: vi.fn() });
    const operation = client.create({ name: '小熊', seats: 4 });
    await vi.advanceTimersByTimeAsync(500);
    await operation;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(client.session).toEqual(session);
    client.close();
  });

  it('sends expected game version and suppresses a late response after close', async () => {
    vi.useFakeTimers();
    let complete!: (value: Response) => void;
    const onSnapshot = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ session, snapshot: snapshot(8) }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }))
      .mockImplementation(() => Promise.resolve(Response.json({})));
    vi.stubGlobal('fetch', fetcher);
    const client = new RoomClient('/api/rooms', { onSnapshot });
    await client.reconnect(session);
    const command = client.command({ type: 'roll' });
    await Promise.resolve();
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ type: 'command', expectedVersion: 8 });
    client.close();
    complete(Response.json({ snapshot: snapshot(9) }));
    await command;
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });
  it('sends explicit Labu intent and preserves quota updates and long replies', async () => {
    vi.useFakeTimers();
    const onSnapshot = vi.fn();
    const reply = '這是完整遊戲解說。'.repeat(700);
    const next = { ...snapshot(2), labu: { remaining: 9, limit: 10, pending: 1, configured: true }, messages: [{ id: 'labu', author: 'Labu', channel: 'table', text: reply, at: 1, source: 'ai' }] };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ session, snapshot: snapshot() }))
      .mockResolvedValueOnce(Response.json({ snapshot: next }))
      .mockImplementation(() => Promise.resolve(Response.json({})));
    vi.stubGlobal('fetch', fetcher);
    const client = new RoomClient('/api/rooms', { onSnapshot });
    await client.create({ name: '小熊', seats: 4 });
    await client.chat('怎麼玩？', true);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ type: 'chat', askLabu: true, text: '怎麼玩？' });
    expect(client.snapshot?.messages[0].text).toBe(reply);
    expect(client.snapshot?.labu).toEqual(next.labu);
    await client.chat('大家好');
    expect(JSON.parse(fetcher.mock.calls[2][1].body).askLabu).toBe(false);
    client.close();
  });

});
