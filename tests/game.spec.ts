import { test as base, expect, type Page } from '@playwright/test';
import { createGame, deserializeGame, dispatch, serializeGame, VEHICLES } from '../src/engine';
import type { GameState } from '../src/game-types';

const SAVE_KEY = 'labu-toy-city-v1';
const test = base.extend<{ browserHealth: void }>({
  browserHealth: [async ({ page }, use) => {
    const errors: string[] = [], external: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url()).hostname)) external.push(request.url());
    });
    await use();
    expect(errors, 'Uncaught browser exceptions').toEqual([]);
    expect(external, 'Offline mode must not request external services').toEqual([]);
  }, { auto: true }],
});

interface Diagnostics { phase: GameState['phase']; currentPlayer: number; marketTick: number; round: number; pendingSteps: number; tiles: number; banks: number; }
async function diagnostics(page: Page): Promise<Diagnostics> { return page.evaluate(() => (window as unknown as { __LABU_DIAGNOSTICS__: Diagnostics }).__LABU_DIAGNOSTICS__); }
async function saved(page: Page): Promise<GameState> { return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SAVE_KEY); }
function fresh(seed = 'browser-test') { return createGame({ seed, seats: 2, maxRounds: 6, players: [{ name: '測試玩家' }, { name: 'Labu', isNpc: true }] }); }
function arrived(position: number, prepare?: (s: GameState) => void): GameState {
  let s = fresh(); prepare?.(s); s.players[0].position = (position + 47) % 48; s.players[0].cards.push('loadedDice');
  s = dispatch(s, { type: 'useCard', card: 'loadedDice', value: 1 }); s = dispatch(s, { type: 'roll' }); s = dispatch(s, { type: 'step' }); return s;
}
async function resumeFixture(page: Page, state: GameState) {
  const serialized = serializeGame(deserializeGame(serializeGame(state)));
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('labu-fixture-installed')) { localStorage.setItem(key, value); sessionStorage.setItem('labu-fixture-installed', 'true'); }
  }, { key: SAVE_KEY, value: serialized });
  await page.goto('/'); await page.locator('#resume-game').click(); await expect(page.locator('#lobby')).not.toHaveClass(/visible/);
}
async function enableFast(page: Page) { await page.locator('#settings').click(); await page.locator('#toggle-speed').click(); await page.getByRole('button', { name: '關閉視窗' }).click(); }
async function waitHuman(page: Page) { await expect.poll(async () => { const d = await diagnostics(page); return d.phase === 'finished' || d.currentPlayer === 0 && d.phase === 'roll'; }, { timeout: 25_000 }).toBe(true); }
async function finishMovement(page: Page) { await expect.poll(async () => (await diagnostics(page)).phase, { timeout: 15_000 }).not.toBe('moving'); }

test('starts one human plus NPCs with 48 tiles, six banks, and a read-only market', async ({ page }, testInfo) => {
  await page.goto('/'); await page.locator('#player-name').fill('小城建築師'); await page.locator('#round-count').selectOption('6'); await page.locator('.start-game').click();
  await expect(page.locator('.player-card')).toHaveCount(4); const s = await saved(page); expect(s.players.filter(p => p.isNpc)).toHaveLength(3); expect(s.players[0].cash).toBe(10000);
  await expect(page.locator('.player-card').first()).toContainText('1,000 萬元'); expect(await diagnostics(page)).toMatchObject({ tiles: 48, banks: 6 });
  await page.locator('#view-menu summary').click(); await page.locator('#board-list').click(); await expect(page.locator('[data-directory]')).toHaveCount(48); await expect(page.locator('.board-directory .bank')).toHaveCount(6); await page.getByRole('button', { name: '關閉視窗' }).click();
  await page.locator('#market-open').click(); await expect(page.locator('#modal')).toContainText('停在銀行才可交易'); await expect(page.locator('#stock-form button')).toBeDisabled(); await page.getByRole('button', { name: '關閉視窗' }).click();
  await page.screenshot({ path: testInfo.outputPath('desktop-city.png'), fullPage: true });
});

test('a real UI roll moves one square per market update and resumes exactly after reload', async ({ page }) => {
  const initial = fresh('movement-browser'); initial.players[0].cards = ['loadedDice']; await resumeFixture(page, initial); await enableFast(page);
  await page.locator('#my-assets').click(); await page.locator('[data-card="loadedDice"]').click(); await page.locator('[data-die="4"]').click(); await page.locator('#turn-action').click(); await finishMovement(page);
  const s = await saved(page); expect(s.marketTick).toBe(4); expect(s.players[0].position).toBe(4); expect(s.dice).toEqual([4]); expect(s.stocks.every(st => st.history.length === 5)).toBe(true);
  await expect(page.locator('#tick-label')).toContainText('已更新 4 次'); await page.reload(); await page.locator('#resume-game').click(); expect(await saved(page)).toEqual(s); await expect(page.locator('#turn-action')).toContainText('結束回合');
});

test('bank deposits, withdrawals, trades, and invalid amounts use current prices without extra market ticks', async ({ page }) => {
  const initial = arrived(3); const price = initial.stocks[0].price; await resumeFixture(page, initial);
  await page.locator('[data-action="bank"]').click(); await page.locator('#bank-amount').fill('100'); await page.locator('#bank-form button.primary').click();
  expect((await saved(page)).players[0]).toMatchObject({ cash: 9000, deposit: 3000 });
  await page.locator('#mode-withdraw').click(); await page.locator('#bank-amount').fill('50'); await page.locator('#bank-form button.primary').click(); expect((await saved(page)).players[0]).toMatchObject({ cash: 9500, deposit: 2500 });
  const beforeInvalid = await saved(page); await page.locator('#bank-amount').fill('99999'); await page.locator('#bank-form button.primary').click(); await expect(page.locator('#toast')).toContainText('存款不足'); expect(await saved(page)).toEqual(beforeInvalid);
  await page.locator('#bank-stocks').click(); await page.locator('#stock-qty').fill('10'); await page.locator('#stock-form button.primary').click(); expect((await saved(page)).players[0].holdings['stock-0']).toBe(10);
  await page.locator('#stock-sell').click(); await page.locator('#stock-qty').fill('11'); await page.locator('#stock-form button.primary').click(); await expect(page.locator('#toast')).toContainText('持股不足');
  await page.locator('#stock-qty').fill('4'); await page.locator('#stock-form button.primary').click(); const end = await saved(page); expect(end.players[0].holdings['stock-0']).toBe(6); expect(end.players[0].deposit).toBe(2500 - price * 6); expect(end.marketTick).toBe(initial.marketTick); expect(end.stocks).toEqual(initial.stocks);
});

test('buys a Tesla at the shop, equips it next turn, and rolls three dice through the UI', async ({ page }, testInfo) => {
  await resumeFixture(page, arrived(7)); await enableFast(page); await page.locator('[data-action="vehicles"]').click();
  await expect(page.locator('.vehicle-card')).toHaveCount(5); await page.locator('[data-buy-vehicle="tesla-model-3"]').click(); let s = await saved(page);
  expect(s.players[0].vehicles).toEqual(['tesla-model-3']); expect(s.players[0].vehicleId).toBeNull(); expect(s.players[0].cash).toBe(10000 - VEHICLES.find(v => v.id === 'tesla-model-3')!.price);
  await expect(page.locator('[data-buy-vehicle="tesla-model-y"]')).toBeDisabled(); await page.screenshot({ path: testInfo.outputPath('vehicle-showroom.png'), fullPage: true }); await page.getByRole('button', { name: '關閉視窗' }).click();
  await page.locator('#turn-action').click(); await waitHuman(page); await page.locator('#garage-launch').click(); await page.locator('[data-equip-vehicle="tesla-model-3"]').click(); await expect(page.locator('.garage-current')).toContainText('3 顆骰子'); await page.getByRole('button', { name: '關閉視窗' }).click();
  const before = await saved(page); await page.locator('#turn-action').click(); await finishMovement(page); s = await saved(page); expect(s.dice).toHaveLength(3); expect(s.marketTick - before.marketTick).toBe(s.dice.reduce((sum, die) => sum + die, 0));
});

test('upgrades owned property once and exposes no mutation when repeated', async ({ page }) => {
  const initial = arrived(1, s => { s.tiles[1].ownerId = s.players[0].id; s.players[0].cash -= s.tiles[1].price; }); await resumeFixture(page, initial);
  await page.locator('[data-action="upgrade"]').click(); expect((await saved(page)).tiles[1].level).toBe(1); expect((await saved(page)).players[0].cash).toBe(initial.players[0].cash - initial.tiles[1].upgradeCost);
  await expect(page.locator('[data-action="upgrade"]')).toHaveCount(0);
});

test('rent protection triggers automatically on arrival and preserves cash', async ({ page }) => {
  let initial = fresh(); initial.tiles[1].ownerId = initial.players[1].id; initial.players[1].cash -= initial.tiles[1].price; initial.players[0].cards = ['rentShield', 'loadedDice']; initial = dispatch(initial, { type: 'useCard', card: 'loadedDice', value: 1 });
  await resumeFixture(page, initial); await enableFast(page); await page.locator('#turn-action').click(); await finishMovement(page); const s = await saved(page);
  expect(s.players[0].cash).toBe(initial.players[0].cash); expect(s.players[0].cards).not.toContain('rentShield'); expect(s.log.some(l => l.text.includes('自動使用免租券'))).toBe(true);
});

test('chat drafts survive NPC updates; HTML remains text and personal reminders stay off the table', async ({ page }) => {
  await resumeFixture(page, arrived(3)); await enableFast(page); await page.locator('#chat-launch').click(); const draft = '這段草稿要留到 Labu 走完'; await page.locator('#chat-input').fill(draft);
  const tick = (await diagnostics(page)).marketTick; await page.locator('#turn-action').click(); await expect.poll(async () => (await diagnostics(page)).marketTick).toBeGreaterThan(tick); await expect(page.locator('#chat-input')).toHaveValue(draft); await waitHuman(page); await expect(page.locator('#chat-input')).toHaveValue(draft);
  const attack = '<img src=x onerror="window.__chatInjected=true">'; await page.locator('#chat-input').fill(attack); await page.getByRole('button', { name: '送出聊天訊息' }).click(); await expect(page.locator('.chat-message.from-player p').last()).toHaveText(attack); await expect(page.locator('#chat-messages img')).toHaveCount(0); expect(await page.evaluate(() => (window as unknown as { __chatInjected?: boolean }).__chatInjected)).toBeUndefined();
  await expect(page.locator('.reminder')).toHaveCount(0); await page.locator('#chat-private').click(); await expect(page.locator('.reminder')).toHaveCount(3); await expect(page.locator('#chat-messages')).toContainText('離線範例');
  await page.locator('#chat-input').fill('這是私人測試 726'); await page.getByRole('button', { name: '送出聊天訊息' }).click(); await page.locator('#chat-public').click(); await expect(page.locator('.reminder')).toHaveCount(0); await expect(page.locator('#chat-messages')).not.toContainText('這是私人測試 726');
});

test('rejects an invalid imported save without destroying the current game', async ({ page }) => {
  await resumeFixture(page, arrived(3)); const before = await saved(page); await page.locator('#settings').click();
  await page.locator('#import-save').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2,"players":[]}') }); await expect(page.locator('#toast')).toContainText('存檔無效'); expect(await saved(page)).toEqual(before);
});

test('mobile 390×844 supports banking and chat without horizontal page overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await resumeFixture(page, arrived(3));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.locator('[data-action="bank"]').click(); await expect(page.locator('#bank-amount')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#bank-amount').fill('50'); await page.locator('#bank-form button.primary').click(); expect((await saved(page)).players[0].deposit).toBe(2500); await page.screenshot({ path: testInfo.outputPath('mobile-bank.png'), fullPage: true }); await page.getByRole('button', { name: '關閉視窗' }).click();
  await page.locator('#chat-launch').click(); await page.locator('#chat-input').fill('Labu 你好'); await page.getByRole('button', { name: '送出聊天訊息' }).click(); await expect(page.locator('.chat-message.from-player p').last()).toHaveText('Labu 你好'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('plays a complete six-round human plus NPC game using only visible turn buttons', async ({ page }) => {
  test.setTimeout(90_000); await resumeFixture(page, fresh('complete-browser-game')); await enableFast(page);
  let humanTurns = 0;
  while ((await diagnostics(page)).phase !== 'finished' && humanTurns < 6) {
    await waitHuman(page); if ((await diagnostics(page)).phase === 'finished') break;
    await page.locator('#turn-action').click(); await finishMovement(page); if ((await diagnostics(page)).phase === 'finished') break;
    await page.locator('#turn-action').click(); humanTurns++; await waitHuman(page);
  }
  await expect.poll(async () => (await diagnostics(page)).phase, { timeout: 20_000 }).toBe('finished'); await expect(page.locator('.ranking-row')).toHaveCount(2);
  const result = await saved(page); expect(result.round).toBe(6); expect(result.winner).not.toBeNull(); expect(() => deserializeGame(serializeGame(result))).not.toThrow(); await expect(page.locator('#modal')).toContainText('資產排名');
});
