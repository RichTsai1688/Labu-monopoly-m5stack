import {test,expect} from '@playwright/test';
import {createGame,serializeGame} from '../src/engine';
test.use({viewport:{width:390,height:844}});
async function start(page:any,s=createGame({seed:'mobile-finance',players:[{name:'小熊'},{name:'兔兔'}]})){
 await page.route('**/api/npc/**',(r:any)=>r.fulfill({json:{configured:false}}));
 await page.addInitScript((v:string)=>{if(!localStorage.getItem('labu-toy-city-v1'))localStorage.setItem('labu-toy-city-v1',v);},serializeGame(s));await page.goto('/');await page.locator('#resume-game').click();
}
test('portrait dropdown trades away from bank, three mobile transfers and persistent chat choice',async({page})=>{
 await start(page);await expect(page.locator('.market-bar')).toBeHidden();await expect(page.locator('.side-panel')).toBeVisible();
 await page.locator('#finance-menu summary').click();await page.locator('#mobile-market').click();await expect(page.locator('#stock-form button')).toBeEnabled();await page.locator('#stock-form button').click();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('labu-toy-city-v1')!).players[0].holdings['stock-0'])).toBe(1);
 await page.locator('.modal-close').click();await page.locator('#finance-menu summary').click();await page.locator('#mobile-bank').click();
 for(let i=0;i<3;i++){await page.locator('#bank-amount').fill('1');await page.locator('#bank-form button.primary').click();}
 await expect(page.locator('#bank-form button.primary')).toBeDisabled();await expect(page.locator('#modal')).toContainText('0／3');await page.locator('.modal-close').click();
 await page.locator('#side-collapse').click();await page.reload();await expect(page.locator('#lobby')).not.toHaveClass(/visible/);await expect(page.locator('.side-panel')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'artifacts/readability/mobile-finance.png'});
});
test('central card can close and reopen without finishing the turn, season changes show a dismissible report',async({page})=>{
 const s=createGame({seed:'housing-review',seats:2,players:[{name:'小熊'},{name:'兔兔'}]});s.round=2;s.currentPlayer=1;s.phase='action';s.players[1].position=1;await start(page,s);
 await page.locator('#dismiss-decision').click();await expect(page.locator('.decision-panel')).toHaveCount(0);await page.locator('#reopen-decision').click();await expect(page.locator('.decision-panel')).toBeVisible();await page.locator('#turn-action').click();
 await expect(page.locator('#housing-notice')).toBeVisible();await expect(page.locator('.housing-rates span')).toHaveCount(6);await page.screenshot({path:'artifacts/readability/housing-market-mobile.png'});await page.locator('#housing-close').click();await expect(page.locator('#housing-notice')).toBeHidden();
});
