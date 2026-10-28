import { test, expect } from '@playwright/test';
import { createGame, serializeGame } from '../src/engine';

test('shop lists seven prank cards and purchase respects hand limit', async ({ page }) => {
  const s = createGame({ seats: 2, players: [{ name: '小熊' }, { name: '兔兔' }] });
  s.phase = 'action';
  s.players[0].position = s.tiles.find(t => t.type === 'shop')!.id;
  s.players[0].cards = ['loadedDice', 'rentShield', 'jailFree', 'renovation'];
  await page.addInitScript(save => localStorage.setItem('labu-toy-city-v1', save), serializeGame(s));
  await page.goto('/');
  await page.locator('#resume-game').click();
  await page.locator('[data-action="shop"]').click();
  for (const card of ['wanted', 'steal', 'roadblock', 'trap', 'shutdown', 'swap', 'bodyguard']) await expect(page.locator(`[data-shop-card="${card}"]`)).toBeVisible();
  await expect(page.locator('[data-shop-card="wanted"]')).toContainText('45 萬元');
  await page.locator('[data-shop-card="bodyguard"]').click();
  await page.locator('[data-player="0"]').click();
  await expect(page.locator('[data-card="bodyguard"]')).toBeDisabled();
  await expect(page.locator('#modal')).toContainText('5/5');
});

test('targeted theft confirms opponent, transfers cash, and disables another attack', async ({ page }) => {
  const s = createGame({ seats: 2, players: [{ name: '小熊' }, { name: '兔兔' }] });
  s.players[0].cards = ['steal', 'wanted'];
  s.players[1].cards = [];
  await page.addInitScript(save => localStorage.setItem('labu-toy-city-v1', save), serializeGame(s));
  await page.goto('/');
  await page.locator('#resume-game').click();
  await page.locator('[data-player="0"]').click();
  await page.locator('[data-card="steal"]').click();
  await expect(page.locator('[data-prank-player]')).toContainText('兔兔');
  await page.locator('[data-prank-player]').click();
  await page.locator('#confirm-prank').click();
  const result = await page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!));
  expect(result.players[0].cash).toBe(s.players[0].cash + 300);
  expect(result.players[1].cash).toBe(s.players[1].cash - 300);
  expect(result.players[1].deposit).toBe(s.players[1].deposit);
  await page.locator('[data-player="0"]').click();
  await expect(page.locator('[data-card="wanted"]')).toBeDisabled();
});
