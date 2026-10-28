import { test, expect, type Page } from '@playwright/test';
import { createGame, serializeGame } from '../src/engine';

async function prepare(page: Page, reply = 'Labu 測試回答：買股票需停在銀行並使用存款。') {
  const requests: {text:string;kind:string;context:unknown}[] = [];
  await page.route('**/api/npc/status', r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/npc/chat', r=>{
    requests.push(r.request().postDataJSON());
    return r.fulfill({json:{text:reply,source:'ai'}});
  });
  const state=createGame({seats:4,seed:'labu-chat-test',players:['甲','乙','丙','丁'].map(name=>({name,isNpc:false}))});
  await page.addInitScript(save=>localStorage.setItem('labu-toy-city-v1',save),serializeGame(state));
  await page.goto('/');
  await page.locator('#resume-game').click();
  await page.locator('#chat-launch').click();
  await expect(page.locator('#ai-toggle')).toHaveText('關閉 AI');
  return requests;
}
async function send(page:Page,text:string) {
  await page.locator('#chat-input').fill(text);
  await page.locator('#chat-form button').click();
}

test('only mentions or explicit button ask AI; private conversations never call AI',async({page})=>{
  const requests=await prepare(page);
  await send(page,'大家一起買地吧');
  await expect(page.locator('.chat-message').last()).toContainText('大家一起買地吧');
  expect(requests).toHaveLength(0);
  for (const alias of ['老布','拉 布','ＬａＢｕ']) {
    await send(page,`${alias}，銀行怎麼用？`);
    await expect.poll(()=>requests.length).toBe(['老布','拉 布','ＬａＢｕ'].indexOf(alias)+1);
    await expect(page.locator('.chat-message').last()).toContainText('Labu 測試回答');
  }
  await page.locator('#labu-mode').click();
  await send(page,'買地要準備多少現金？');
  await expect.poll(()=>requests.length).toBe(4);
  await expect(page.locator('.chat-message').last()).toContainText('Labu 測試回答');
  await page.locator('#chat-private').click();
  await send(page,'Labu 私人機密待辦不應傳送');
  await expect(page.locator('#chat-messages')).toContainText('私人機密待辦不應傳送');
  expect(requests).toHaveLength(4);
  expect(JSON.stringify(requests)).not.toContain('私人機密');
});

test('ten questions in the same round need no cooldown and eleventh is blocked',async({page})=>{
  const requests=await prepare(page);
  // Dispatch back-to-back UI submits without waiting for answers or any cooldown timer.
  await page.evaluate(()=>{
    for(let i=1;i<=10;i++) {
      (document.querySelector('#chat-input') as HTMLInputElement).value=`拉布，第${i}個玩法問題`;
      document.querySelector('#chat-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    }
  });
  await expect.poll(()=>requests.length).toBe(10);
  await expect(page.locator('#side-content [role="status"]')).toContainText('0／10');
  await send(page,'拉布，第十一個問題');
  await expect(page.locator('body')).toContainText('本輪已詢問 Labu 10 次');
  expect(requests).toHaveLength(10);
  expect(requests.every(r=>r.kind==='question')).toBe(true);
  await send(page,'大家輪流買地吧');
  await expect(page.locator('.chat-message').last()).toContainText('大家輪流買地吧');
  expect(requests).toHaveLength(10);
});

test('6000-character replies remain intact; mobile drawer keeps dice accessible without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const reply='股市說明：'.repeat(1200);
  await prepare(page,reply);
  await expect(page.locator('#side-collapse')).toHaveAttribute('aria-expanded','true');
  await send(page,'拉布請詳細說明股市');
  await expect(page.locator('.from-labu').last().locator('p')).toHaveText(reply);
  const assertLayout=async()=>{
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    const dice=page.locator('#turn-action');
    await expect(dice).toBeVisible();
    const box=await dice.boundingBox();expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(391);
    expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(844);
    expect(await dice.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  };
  await assertLayout();
  await page.locator('#side-collapse').click();
  await expect(page.locator('#side-collapse')).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#side-content')).not.toBeVisible();
  await assertLayout();
});
