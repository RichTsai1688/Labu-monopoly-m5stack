import { test, expect } from '@playwright/test';
test('prank markers reuse geometry after warmup and clear with scene disposal', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath='/src/city.ts'; const {ToyCity}=await import(modulePath);
    const holder=document.createElement('div'); holder.style.cssText='width:800px;height:600px'; document.body.replaceChildren(holder);
    const city=new ToyCity(holder,()=>{}); const counts:number[][]=[];
    try {
      for(let i=0;i<24;i++) {
        city.update({tiles:Array.from({length:48},(_,id)=>({id,type:'property',name:'測試地產',owner:null,level:0,effect:['roadblock','trap','shutdown',undefined][i%4]})),players:[],currentPlayer:0});
        if(i>=4) counts.push([city.geometries.size,city.materialCache.size,city.extraMaterials.size,city.textures.size]);
      }
      return {counts,markers:city.prankMarkers.size,visible:[...city.prankMarkers.values()].filter((m:any)=>m.group.visible).length};
    } finally {city.dispose(); if(city.prankMarkers.size!==0)throw new Error('Markers retained after disposal');}
  });
  expect(new Set(result.counts.map(c=>c.join(','))).size).toBe(1);
  expect(result.markers).toBe(48); expect(result.visible).toBe(0);
});
