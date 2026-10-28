import { test, expect } from '@playwright/test';
import { startRoomServer } from '../server/room-server';
import { createGame, serializeGame } from '../src/engine';

test('keeps public and private chat drafts separate when changing tabs', async ({ page }) => {
  await page.goto('/');
  await page.locator('.start-game').click();
  await page.locator('#chat-launch').click();
  await page.locator('#chat-input').fill('同桌公開草稿 862');
  await page.locator('#chat-private').click();
  await expect(page.locator('#chat-input')).toHaveValue('');
  await page.locator('#chat-input').fill('我的私人草稿 391');
  await page.locator('#chat-public').click();
  await expect(page.locator('#chat-input')).toHaveValue('同桌公開草稿 862');
  await page.locator('#chat-input').press('Enter');
  await expect(page.locator('#chat-messages')).toContainText('同桌公開草稿 862');
  await expect(page.locator('#chat-messages')).not.toContainText('我的私人草稿 391');
  await page.locator('#chat-private').click();
  await expect(page.locator('#chat-input')).toHaveValue('我的私人草稿 391');
});

test('leaving an online room then reloading preserves the previous offline save', async ({ page }) => {
  // Bind an ephemeral port so this test never takes another suite's room service.
  const service = await startRoomServer({ port: 0, stepMs: 5, npcMs: 5 });
  try {
    await page.addInitScript(({ roomUrl }) => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(String(url).replace('ws://127.0.0.1:5174', roomUrl), protocols);
        }
      };
    }, { roomUrl: service.url });
    await page.goto('/');
    await page.locator('#player-name').fill('本機存檔請保留');
    await page.locator('.start-game').click();
    const offlineSave = await page.evaluate(() => localStorage.getItem('labu-toy-city-v1'));
    expect(offlineSave).toContain('本機存檔請保留');
    await page.locator('#room-open').click();
    await page.locator('#room-name').fill('連線專用房主');
    await page.locator('#room-submit').click();
    await expect(page.locator('#room-start')).toBeVisible();
    await page.locator('#room-start').click();
    await expect(page.locator('.player-card').first()).toContainText('連線專用房主');
    await page.locator('#room-open').click();
    await page.locator('#room-leave').click();
    await expect(page.locator('#resume-game')).toBeVisible();
    await page.reload();
    expect(await page.evaluate(() => localStorage.getItem('labu-toy-city-v1'))).toBe(offlineSave);
    await page.locator('#resume-game').click();
    await expect(page.locator('.player-card').first()).toContainText('本機存檔請保留');
  } finally { await service.close(); }
});

test('a failed room reconnect does not stall an existing offline NPC game', async ({ page }) => {
  const service = await startRoomServer({ port: 0 });
  const initial = serializeGame(createGame({ seed: 'reconnect-failure', seats: 2, players: [{ name: '離線 NPC', isNpc: true }] }));
  try {
    await page.addInitScript(({ roomUrl, initial }) => {
      localStorage.setItem('labu-toy-city-v1', initial);
      sessionStorage.setItem('labu-room-session', JSON.stringify({ code: 'EXPIREDROOM1', token: 'expired-test-token', playerId: 'player-0' }));
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(String(url).replace('ws://127.0.0.1:5174', roomUrl), protocols);
        }
      };
    }, { roomUrl: service.url, initial });
    await page.goto('/');
    await page.locator('#resume-game').click();
    await page.locator('#room-open').click();
    await page.locator('#room-reconnect').click();
    await expect(page.locator('#toast')).toContainText('房間或重新連線憑證無效');
    await page.getByRole('button', { name: '關閉視窗' }).click();
    const tick = await page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!).marketTick as number);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!).marketTick as number)).toBeGreaterThan(tick);
  } finally { await service.close(); }
});
