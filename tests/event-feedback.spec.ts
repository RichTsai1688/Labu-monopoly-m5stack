import {test,expect,type Page} from '@playwright/test';
import {createGame,serializeGame,getUpgradeCost} from '../src/engine';
async function fixture(page:Page,build=false) {
 await page.addInitScript(()=>localStorage.setItem('labu-chat-open','false'));
 const s=createGame({seed:'events-review',players:[{name:'小熊',isNpc:false},{name:'兔兔',isNpc:false}]});
 s.nextDice=1;
 if(build){s.players[0].position=1;s.tiles[1].ownerId=s.players[0].id;s.phase='action';}
 await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:false}}));
 await page.addInitScript(v=>localStorage.setItem('labu-toy-city-v1',v),serializeGame(s));
 await page.goto('/');await page.locator('#resume-game').click();return s;
}
test('build recommendation is automatic and the payment receipt names recipient and amount',async({page})=>{
 await page.setViewportSize({width:390,height:844});const s=await fixture(page,true);
 await expect(page.locator('.decision-heading')).toContainText('可以蓋房子');
 await expect(page.locator('[data-action="upgrade"]')).toBeVisible();
 await expect(page.locator('dialog[open]')).toHaveCount(0);
 await page.screenshot({path:'artifacts/readability/decisions-mobile.png'});
 await page.locator('[data-action="upgrade"]').click();
 await expect(page.locator('#public-events')).toContainText(`小熊 → 建設公司：${getUpgradeCost(s,s.tiles[1])/10} 萬元`);
 await expect(page.locator('[data-action="upgrade"]')).toHaveCount(0);
 await expect(page.locator('#turn-action')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.waitForTimeout(500);
 await page.screenshot({path:'artifacts/readability/payment-mobile.png'});
});
for(const view of ['overview','closeup','rotated'])test(`camera keeps following in ${view} while retaining zoom and angle`,async({page})=>{
 await fixture(page);await page.waitForTimeout(500);
 await page.locator('#view-menu summary').click();
 await page.locator(view==='closeup'?'#follow-view':'#reset-view').click();
 if(view==='rotated') {const box=(await page.locator('#world canvas').boundingBox())!;await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.5,{steps:10});await page.mouse.up();}
 await page.waitForTimeout(1600);
 const camera=()=>page.evaluate(()=>(window as any).__LABU_DIAGNOSTICS__.city);
 const before=await camera();await page.locator('#turn-action').click();await expect(page.locator('.decision-panel')).toBeVisible();await page.waitForTimeout(650);
 const after=await camera();expect(after.following).toBe(true);expect(after.cameraZoom).toBeCloseTo(before.cameraZoom,3);
 expect(after.cameraTarget).not.toEqual(before.cameraTarget);
 for(let i=0;i<3;i++)expect(after.cameraPosition[i]-after.cameraTarget[i]).toBeCloseTo(before.cameraPosition[i]-before.cameraTarget[i],1);
});
test('new reply lights chat badge while closed and opening clears it',async({page})=>{
 await fixture(page);await page.route('**/api/npc/status',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/npc/chat',async r=>{await new Promise(resolve=>setTimeout(resolve,800));await r.fulfill({json:{source:'ai',text:'收到，這是新的回覆。'}});});
 await page.reload();await page.locator('#resume-game').click();await page.locator('#chat-launch').click();
 await page.locator('#chat-input').fill('Labu你好');await page.locator('#chat-form button').click();await page.locator('#side-collapse').click();
 await expect(page.locator('#chat-unread')).toBeVisible();await page.locator('#chat-launch').click();
 await expect(page.locator('#chat-unread')).toBeHidden();await expect(page.locator('#chat-messages')).toContainText('新的回覆');
});

test('three dice reveal the authoritative sum and event cards load real illustrations',async({page})=>{
 const s=createGame({seed:'three-dice-art',players:[{name:'小熊',isNpc:false},{name:'兔兔',isNpc:false}]});
 s.players[0].vehicles=['tesla-model-3'];s.players[0].vehicleId='tesla-model-3';
 await page.route('**/api/npc/**',r=>r.fulfill({json:{configured:false}}));
 await page.addInitScript(v=>localStorage.setItem('labu-toy-city-v1',v),serializeGame(s));
 await page.goto('/');await page.locator('#resume-game').click();await page.locator('#turn-action').click();
 await expect(page.locator('#dice-reveal .dice-cube')).toHaveCount(3);
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('labu-toy-city-v1')!));
 await expect(page.locator('.dice-result')).toContainText(`${stored.die} 格`);
 await page.waitForTimeout(2000);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('labu-toy-city-v1')!).players[0].position)).toBe(s.players[0].position);
 await page.screenshot({path:'artifacts/readability/dice-animation.png'});
 await expect(page.locator('#dice-reveal')).toBeHidden();
 const url=await page.locator('.event-art').first().evaluate(e=>getComputedStyle(e).backgroundImage.slice(5,-2));
 const res=await page.request.get(url);expect(res.ok()).toBe(true);
});
