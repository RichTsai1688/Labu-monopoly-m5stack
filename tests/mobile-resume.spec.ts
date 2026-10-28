import { test, expect } from '@playwright/test';
import { createGame, serializeGame } from '../src/engine';
test.use({ viewport: { width: 390, height: 844 } });
test('tap city card, full viewport map and refresh preserves game without lobby', async ({ page }) => {
 const state = createGame({ seed:'mobile-refresh', players:[{ name:'小熊' },{ name:'兔兔' }] });
 state.players[0].cash=3210; state.players[0].position=7;
 await page.addInitScript(save=>{
   if(!localStorage.getItem('labu-toy-city-v1'))localStorage.setItem('labu-toy-city-v1',save);
   localStorage.setItem('labu-chat-open','false');
 },serializeGame(state));
 await page.route('**/api/npc/**',r=>r.fulfill({json:{configured:false}}));
 await page.goto('/'); await page.locator('#resume-game').click();
 await expect(page.locator('.illustrated-event')).toBeVisible();
 await page.locator('.illustrated-event').click();
 await expect(page.locator('.illustrated-event')).toBeHidden();
 await expect(page.locator('.public-status')).toBeVisible();
 for(const height of [844,667]) {
   await page.setViewportSize({width:390,height});
   await expect.poll(async()=> Math.round((await page.locator('#world').boundingBox())!.y+(await page.locator('#world').boundingBox())!.height)).toBe(height);
   expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
   await page.mouse.wheel(0,500); expect(await page.evaluate(()=>scrollY)).toBe(0);
 }
 await page.reload(); await expect(page.locator('#lobby')).not.toHaveClass(/visible/);
 await expect(page.locator('#turn-action')).toBeEnabled();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('labu-toy-city-v1')!));
 expect(saved.players[0].position).toBe(7); expect(saved.players[0].cash).toBe(3210);
 await page.setViewportSize({width:390,height:844});
 await page.locator('.illustrated-event').click();
 await page.screenshot({path:'artifacts/readability/mobile-fullscreen-resume.png'});
 await page.locator('#turn-action').click();
 await expect(page.locator('.illustrated-event')).toBeVisible();
});
