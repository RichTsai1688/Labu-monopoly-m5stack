import { test, expect, type Page } from '@playwright/test';
import { startRoomServer } from '../server/room-server';
import type { RoomSnapshot } from '../src/network';

let service: Awaited<ReturnType<typeof startRoomServer>>;
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => { service = await startRoomServer({ port: 5174, stepMs: 65, npcMs: 100, disconnectGraceMs: 700, roomTtlMs: 60_000 }); });
test.afterAll(async () => { await service?.close(); });

function observe(page: Page) {
  const errors: string[] = [], external: string[] = [];
  let snapshot: RoomSnapshot | null = null;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)) external.push(request.url()); });
  page.on('websocket', socket => {
    if (!socket.url().includes(':5174')) return;
    socket.on('framereceived', frame => {
      try { const message = JSON.parse(String(frame.payload)); if (message.type === 'snapshot') snapshot = message.snapshot; } catch { /* Non-JSON transport frames are not application snapshots. */ }
    });
  });
  return { get snapshot() { return snapshot; }, errors, external };
}

test('two browser players share one authoritative room, chat privately/publicly, and reconnect safely', async ({ browser }) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 1280, height: 960 } });
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 1280, height: 960 } });
  for (const context of [hostContext,guestContext]) await context.addInitScript(()=>localStorage.setItem('labu-chat-open','false'));
  // Disable only development hot reloads during the test; game WebSockets on 5174 stay real.
  for (const context of [hostContext, guestContext]) await context.routeWebSocket(url => url.port === '5173', socket => socket.send(JSON.stringify({ type: 'connected' })));
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  const a = observe(host), b = observe(guest);
  try {
    await host.goto('/'); await host.locator('#lobby-room').click(); await host.locator('#room-name').fill('房主小熊'); await host.locator('#room-seats').selectOption('4'); await host.locator('#room-rounds').selectOption('6'); await host.locator('#room-submit').click();
    await expect(host.locator('.room-code')).toBeVisible(); const code = (await host.locator('.room-code').innerText()).trim(); expect(code.length).toBeGreaterThanOrEqual(4);
    await guest.goto('/'); await guest.locator('#lobby-room').click(); await guest.locator('#room-name').fill('來賓小兔'); await guest.locator('#room-code').fill(code); await guest.locator('#room-submit').click();
    await expect(guest.locator('.room-code')).toHaveText(code); await expect(guest.locator('#room-start')).toBeDisabled(); await expect(host.locator('.room-members')).toContainText('來賓小兔');
    await host.locator('#room-start').click(); await expect(host.locator('#modal')).not.toBeVisible(); await expect(guest.locator('#modal')).not.toBeVisible();
    await expect.poll(() => a.snapshot?.game?.players.length).toBe(4); await expect.poll(() => b.snapshot?.status).toBe('playing');
    expect(a.snapshot!.game!.players.filter(p => p.isNpc)).toHaveLength(2); expect(a.snapshot!.game).toEqual(b.snapshot!.game); expect(a.snapshot!.selfId).not.toBe(b.snapshot!.selfId);
    await expect(host.locator('#turn-action')).toBeEnabled(); await expect(guest.locator('#turn-action')).toHaveCount(0);

    await guest.locator('#finance-menu summary').click();await guest.locator('#mobile-market').click();await guest.locator('#stock-form button').click();await expect.poll(()=>b.snapshot?.game?.players[1].holdings['stock-0']).toBe(1);expect(b.snapshot!.game!.currentPlayer).toBe(0);await guest.locator('.modal-close').click();
    await host.locator('#turn-action').click(); await expect.poll(() => a.snapshot?.game?.phase).toBe('action'); await expect.poll(() => b.snapshot?.version).toBe(a.snapshot!.version);
    expect(a.snapshot!.game).toEqual(b.snapshot!.game); const firstMove = a.snapshot!.game!; expect(firstMove.marketTick).toBe(firstMove.dice.reduce((sum, die) => sum + die, 0));
    await expect(host.locator('.observing-decision')).toHaveCount(0);
    await expect(guest.locator('.observing-decision')).toBeVisible();
    const ownCard = (await host.locator('#turn-card').boundingBox())!;
    expect(ownCard.x + ownCard.width / 2).toBeCloseTo(640, 0);
    for (const viewport of [{width:1280,height:960},{width:390,height:844}]) {
      await guest.setViewportSize(viewport);
      const card = (await guest.locator('#turn-card').boundingBox())!;
      expect(card.width).toBeLessThanOrEqual(320);
      expect(viewport.width - card.x - card.width).toBeLessThanOrEqual(15);
      expect(viewport.height - card.y - card.height).toBeLessThanOrEqual(19);
      await guest.screenshot({path:`artifacts/readability/observer-${viewport.width}.png`});
    }
    await guest.setViewportSize({width:1280,height:960});
    const heldVersion = a.snapshot!.version, heldTick = firstMove.marketTick;
    // A human action phase is stable long enough to catch accidental local NPC/movement timers.
    const stableUntil = Date.now() + 1200;
    await expect.poll(() => { expect(a.snapshot!.version).toBe(heldVersion); expect(b.snapshot!.game!.marketTick).toBe(heldTick); return Date.now() >= stableUntil; }, { intervals: [100, 200, 300], timeout: 3000 }).toBe(true);

    await host.locator('#chat-launch').click(); await guest.locator('#chat-launch').click();
    const beforeMessages = a.snapshot!.messages.length; await host.locator('#chat-input').fill('Labu，這桌的股票怎麼買？'); await host.getByRole('button', { name: '送出聊天訊息' }).click();
    await expect(guest.locator('#chat-messages')).toContainText('這桌的股票怎麼買？'); await expect.poll(() => a.snapshot?.messages.length).toBe(beforeMessages + 2); expect(a.snapshot!.messages.slice(-2).map(m => m.author)).toEqual(['房主小熊', 'Labu']); expect(a.snapshot!.messages).toEqual(b.snapshot!.messages);
    await expect(host.locator('#chat-messages .from-labu').last()).toContainText('每位玩家每走過 1 格');

    await host.locator('#chat-private').click(); await expect(host.locator('.reminder')).toHaveCount(3); await expect(guest.locator('.reminder')).toHaveCount(0);
    const publicCount = a.snapshot!.messages.length; await host.locator('#chat-input').fill('私人提醒測試：不要同步這段 9182'); await host.getByRole('button', { name: '送出聊天訊息' }).click(); await expect(host.locator('#chat-messages')).toContainText('不要同步這段 9182');
    expect(a.snapshot!.messages.length).toBe(publicCount); await expect(guest.locator('#chat-messages')).not.toContainText('不要同步這段 9182');
    await guest.locator('#chat-private').click(); await guest.locator('#chat-input').fill('來賓自己的私人備忘 443'); await guest.getByRole('button', { name: '送出聊天訊息' }).click();
    await expect(guest.locator('.chat-message.from-player small').last()).toHaveText('來賓小兔'); await expect(host.locator('#chat-messages')).not.toContainText('來賓自己的私人備忘 443'); expect(a.snapshot!.messages.length).toBe(publicCount);

    await host.locator('#turn-action').click(); await expect.poll(() => b.snapshot?.game?.currentPlayer).toBe(1); await expect(guest.locator('#turn-action')).toBeEnabled(); await expect(host.locator('#turn-action')).toHaveCount(0);
    await guest.locator('#turn-action').click(); await expect.poll(() => b.snapshot?.game?.phase).toBe('action'); await guest.locator('#turn-action').click();
    await expect.poll(() => a.snapshot?.game?.currentPlayer === 0 && a.snapshot.game.phase === 'roll', { timeout: 20_000 }).toBe(true); await expect.poll(() => b.snapshot?.version).toBe(a.snapshot!.version); expect(a.snapshot!.game).toEqual(b.snapshot!.game);

    const beforeReconnect = a.snapshot!.game!; await guest.reload();
    await expect(guest.locator('#modal')).not.toBeVisible(); await expect(guest.locator('#lobby')).not.toHaveClass(/visible/); await expect.poll(() => a.snapshot?.players.find(p => p.name === '來賓小兔')?.connected).toBe(true);
    await expect.poll(() => b.snapshot?.pendingReclaim).toBe(false); await expect.poll(() => b.snapshot?.version).toBe(a.snapshot!.version); expect(a.snapshot!.game).toEqual(b.snapshot!.game);
    expect(b.snapshot!.game!.marketTick).toBe(beforeReconnect.marketTick); expect(b.snapshot!.game!.players[1].isNpc).toBe(false); expect(b.snapshot!.selfId).toBe('player-1');
    await expect(guest.locator('#turn-action')).toHaveCount(0); await expect(host.locator('#turn-action')).toBeEnabled();
    await host.locator('#room-open').click(); await expect(host.locator('.room-code')).toHaveText(code); await expect(host.locator('.room-members')).toContainText('來賓小兔'); await host.locator('#room-back').click();
    expect(service.stats()).toMatchObject({ rooms: 1, connections: 2, scheduledRooms: 0 });
  } finally {
    await guestContext.close(); await hostContext.close();
  }
  expect(a.errors).toEqual([]); expect(b.errors).toEqual([]); expect(a.external).toEqual([]); expect(b.external).toEqual([]);
});
