import {test,expect} from '@playwright/test';
import {createGame,serializeGame} from '../src/engine';
async function load(page:any, shop=false) {
 const state=createGame({seed:'map-first',players:['小熊','兔兔','Labu','企鵝'].map(name=>({name,isNpc:false}))});
 if(shop){state.players[0].position=state.tiles.find(t=>t.type==='shop')!.id;state.phase='action';}
 await page.route('**/api/npc/**',(r:any)=>r.fulfill({json:{configured:false}}));
 await page.addInitScript((s:string)=>localStorage.setItem('labu-toy-city-v1',s),serializeGame(state));
 await page.goto('/');await page.locator('#resume-game').click();
}
test('mobile map-first controls collapse and dice disappear after rolling',async({page})=>{
 await page.setViewportSize({width:390,height:844});await load(page);
 await expect(page.locator('[data-panel="city"]')).toHaveCount(0);
 expect((await page.locator('#players').boundingBox())!.height).toBeLessThan(110);
 await page.locator('#chat-launch').click();await expect(page.locator('#side-content')).toBeVisible();
 await page.locator('#side-collapse').click();await expect(page.locator('#side-content')).not.toBeVisible();
 await page.locator('#turn-action').click();await expect(page.locator('.dice-hand')).toHaveCount(0);
 await expect(page.locator('.decision-panel')).toBeVisible({timeout:15000});
 await expect(page.locator('#public-events')).toBeVisible();
 await expect(page.locator('#location-open')).toHaveCount(0);
 await page.locator('#turn-action').click();
 await expect(page.locator('#turn-action')).toContainText('擲骰子');
});
test('all eleven shop cards have bundled illustrations and expandable exact rules',async({page})=>{
 await page.setViewportSize({width:360,height:740});await load(page,true);
 await page.locator('[data-action="shop"]').click();
 await expect(page.locator('.card-shop-item .card-art')).toHaveCount(11);
 const artUrl=await page.locator('.card-art').first().evaluate(e=>getComputedStyle(e).backgroundImage.slice(5,-2));
 expect((await page.request.get(artUrl)).ok()).toBe(true);
 await page.locator('.card-rules summary').first().click();await expect(page.locator('.card-rules').first().locator('p')).toBeVisible();
 expect(await page.locator('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await page.screenshot({path:'artifacts/readability/cards-360.png'});
});
