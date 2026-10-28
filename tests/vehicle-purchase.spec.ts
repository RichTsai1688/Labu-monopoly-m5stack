import { test, expect, type Page } from '@playwright/test';
import { createGame, serializeGame, VEHICLES } from '../src/engine';
import type { GameState } from '../src/game-types';

async function startWith(page: Page, state: GameState) {
  await page.addInitScript((value: string) => {
    if (!sessionStorage.getItem('vehicle-fixture-installed')) { localStorage.setItem('labu-toy-city-v1', value); sessionStorage.setItem('vehicle-fixture-installed', 'true'); }
    localStorage.setItem('labu-chat-open', 'false');
  }, serializeGame(state));
  await page.goto('/');
  await page.locator('#resume-game').click();
}

test('purchasing a car immediately equips it, retains the prior roll, and survives reload', async ({ page }) => {
  const s = createGame({ seats: 2, players: [{ name: '小熊' }, { name: '兔兔', isNpc: true }] });
  s.phase = 'action'; s.players[0].position = 7; s.dice = [1]; s.die = 1;
  await startWith(page, s);
  await page.locator('[data-action="vehicles"]').click();
  await page.locator('[data-buy-vehicle="tesla-model-3"]').click();
  await expect(page.locator('[data-buy-vehicle="tesla-model-3"]')).toHaveText('已收藏');
  await expect(page.locator('.garage-current')).toContainText('3 顆骰子');
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!));
  expect(saved.players[0].vehicleId).toBe('tesla-model-3');
  expect(saved.players[0].vehicles).toContain('tesla-model-3');
  expect(saved.players[0].cash).toBe(10000 - VEHICLES.find(v => v.id === 'tesla-model-3')!.price);
  expect(saved.dice).toEqual([1]);
  await page.locator('.modal-close').click();
  await page.locator('#garage-launch').click();
  await expect(page.locator('[data-equip-vehicle="tesla-model-3"]')).toHaveText('正在使用');
  await page.reload();
  await page.locator('#garage-launch').click();
  await expect(page.locator('[data-equip-vehicle="tesla-model-3"]')).toHaveText('正在使用');
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!));
  expect(saved.players[0].vehicleId).toBe('tesla-model-3');
});

test('header garage shows the human player inventory during an NPC turn', async ({ page }) => {
  const s = createGame({ seats: 2, players: [{ name: '小熊' }, { name: '兔兔', isNpc: true }] });
  s.currentPlayer = 1; s.phase = 'action'; s.players[1].position = 1;
  s.players[0].vehicles = ['tesla-model-y']; s.players[0].vehicleId = 'tesla-model-y';
  await startWith(page, s);
  await page.locator('#garage-launch').click();
  await expect(page.locator('#modal')).toContainText('小熊 的車庫');
  await expect(page.locator('[data-equip-vehicle="tesla-model-y"]')).toHaveText('正在使用');
  await expect(page.locator('[data-equip-vehicle="tesla-model-y"]')).toBeDisabled();
});
