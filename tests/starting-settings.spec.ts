import { test, expect } from '@playwright/test';

test('new games and room setup default to a longer game and increased starting cash', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#round-count')).toHaveValue('20');
  await page.locator('#lobby-room').click();
  await expect(page.locator('#room-rounds')).toHaveValue('20');
  await page.locator('.modal-close').click();
  await page.locator('.start-game').click();
  await expect(page.locator('.player-card').first()).toContainText('1,000 萬元');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!));
  expect(saved.maxRounds).toBe(20);
  expect(saved.players[0].cash).toBe(10000);
  expect(saved.players[0].deposit).toBe(2000);
});
