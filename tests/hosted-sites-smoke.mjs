import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.BASE_URL || 'http://127.0.0.1:5205/game.html';
const out = new URL('../artifacts/sites-playtest/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })));
const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
for (const page of [host, guest]) page.setDefaultTimeout(30000);
function observe(page) {
  const state = { snapshot: null, errors: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  page.on('response', async response => {
    if (new URL(response.url()).pathname !== '/api/rooms') return;
    try {
      const data = await response.json();
      if (data.snapshot && (!state.snapshot || data.snapshot.version >= state.snapshot.version)) state.snapshot = data.snapshot;
    } catch {}
  });
  return state;
}
const a = observe(host), b = observe(guest);
try {
  await host.goto(base);
  await host.locator('#lobby-room').click();
  await host.locator('#room-name').fill('房主小熊');
  await host.locator('#room-seats').selectOption('4');
  await host.locator('#room-rounds').selectOption('10');
  await host.locator('#room-submit').click();
  await expect(host.locator('#invite-link')).toBeVisible();
  const invite = await host.locator('#invite-link').inputValue();
  const url = new URL(invite);
  expect([...url.searchParams.keys()]).toEqual(['room']);
  expect(url.searchParams.get('room')).toHaveLength(24);
  await guest.goto(invite);
  await expect(guest.locator('#room-code')).toHaveValue(url.searchParams.get('room'));
  await guest.locator('#room-name').fill('朋友兔兔');
  await guest.locator('#room-submit').click();
  await expect(guest.locator('#room-start')).toBeDisabled();
  await expect(host.locator('.room-members')).toContainText('朋友兔兔');
  await host.screenshot({ path: fileURLToPath(new URL('room-invitation.png', out)) });
  await host.locator('#room-start').click();
  await expect.poll(() => a.snapshot?.status).toBe('playing');
  await expect.poll(() => b.snapshot?.status).toBe('playing');
  expect(a.snapshot.game.players.filter(p => !p.isNpc)).toHaveLength(2);
  expect(a.snapshot.game.players.filter(p => p.isNpc)).toHaveLength(2);
  expect(a.snapshot.game.maxRounds).toBe(10);
  await expect(guest.locator('#turn-action')).toHaveCount(0);
  await host.locator('#chat-launch').click();
  await guest.locator('#chat-launch').click();
  await host.locator('#chat-input').fill('朋友一起蓋玩具城市！');
  await host.getByRole('button', { name: '送出聊天訊息' }).click();
  await expect(guest.locator('#chat-messages')).toContainText('朋友一起蓋玩具城市！');
  await host.locator('#chat-input').fill('Labu，股票30元一股，買一張要多少萬元？請用一句話回答。');
  await host.getByRole('button', { name: '送出聊天訊息' }).click();
  await expect.poll(() => a.snapshot?.messages?.some(m => m.author === 'Labu' && m.source === 'ai'), {timeout:45000}).toBe(true);
  await expect.poll(() => a.snapshot?.labu?.remaining).toBe(9);
  await host.locator('#turn-action').click();
  await expect.poll(() => a.snapshot?.game?.phase, { timeout: 30000 }).toBe('action');
  await expect.poll(() => b.snapshot?.version === a.snapshot?.version).toBe(true);
  await expect(guest.locator('.decision-panel')).toContainText('房主小熊');
  await expect(guest.locator('.decision-panel')).toContainText('等待對方決定');
  await expect(guest.locator('#turn-action')).toBeDisabled();
  await expect(guest.locator('#public-events')).toBeVisible();
  expect(a.snapshot.game).toEqual(b.snapshot.game);
  expect(a.snapshot.game.marketTick).toBeGreaterThan(0);
  const beforeTick = a.snapshot.game.marketTick;
  await host.screenshot({ path: fileURLToPath(new URL('host-game.png', out)) });
  await guest.screenshot({ path: fileURLToPath(new URL('guest-game.png', out)) });
  await guest.reload();
  await expect(guest.locator('#room-reconnect')).toBeVisible();
  await guest.locator('#room-reconnect').click();
  await expect.poll(() => b.snapshot?.players.find(p => p.name === '朋友兔兔')?.connected).toBe(true);
  await expect(guest.locator('#modal')).not.toBeVisible();
  await expect.poll(() => b.snapshot?.version === a.snapshot?.version).toBe(true);
  expect(b.snapshot.selfId).toBe('player-1');
  expect(b.snapshot.game.marketTick).toBe(beforeTick);
  expect(b.snapshot.game).toEqual(a.snapshot.game);
  expect(a.errors).toEqual([]); expect(b.errors).toEqual([]);
  await writeFile(new URL('result.json', out), JSON.stringify({ ok: true, checked: ['invite-link', 'two humans and two NPCs', '10 rounds', 'guest cannot start', 'chat sync', 'live Labu AI reply and quota', 'dice and market sync', 'spectator sees events and read-only choices', 'reload reconnect'], hostErrors: a.errors, guestErrors: b.errors }, null, 2));
  console.log('Hosted Sites multiplayer smoke passed');
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
