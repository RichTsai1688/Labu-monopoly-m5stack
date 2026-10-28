import { test, expect } from "@playwright/test";
import { createGame, serializeGame } from "../src/engine";
test("bank shows per-share quotes and lot costs; seasonal dividends reach deposits", async ({
  page,
}) => {
  const s = createGame({
    seats: 2,
    players: [{ name: "小熊" }, { name: "兔兔" }],
  });
  s.round = 2;
  s.currentPlayer = 1;
  s.phase = "action";
  s.players[1].position = 3;
  s.players[0].holdings["stock-0"] = 10;
  s.players[0].costBasis["stock-0"] = 300;
  await page.addInitScript(
    (save) => localStorage.setItem("labu-toy-city-v1", save),
    serializeGame(s),
  );
  await page.goto("/");
  await page.locator("#resume-game").click();
  await page.locator('[data-action="market"]').click();
  await expect(page.locator(".stock-heading")).toContainText("30 元／股");
  await page.locator("#stock-qty").fill("2");
  await expect(page.locator("#stock-preview")).toContainText("6 萬元");
  await page
    .locator('#stock-form button[type="submit"], #stock-form button.primary')
    .click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("labu-toy-city-v1")!).players[1]
          .holdings["stock-0"],
    ),
  ).toBe(2);
  await page.keyboard.press("Escape");
  await page.locator("#turn-action").click();
  await expect(page.locator("#round")).toContainText("夏季");
  const n = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("labu-toy-city-v1")!),
  );
  expect(n.players[0].deposit).toBe(2010);
  expect(n.players[1].deposit).toBe(1942);
  expect(n.stocks[0].price).toBe(29);
  await page.locator("#my-assets").click();
  await expect(page.locator("#modal")).toContainText("累計股利：1 萬元");
});
test("season switches reuse resources, recolor scenery, and respect reduced motion", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/city.ts";
    const { ToyCity } = await import(path);
    const holder = document.createElement("div");
    holder.style.cssText = "width:800px;height:600px";
    document.body.replaceChildren(holder);
    const city = new ToyCity(holder, () => {});
    try {
      const colors = [],
        sizes = [];
      for (let i = 0; i < 12; i++) {
        city.update({
          tiles: [],
          players: [],
          currentPlayer: 0,
          season: i % 4,
        });
        colors.push(
          city.materialCache.get("#9bc465:0.36").color.getHexString(),
        );
        sizes.push([city.geometries.size, city.extraMaterials.size]);
      }
      city.motionReduced = true;
      await new Promise((r) => setTimeout(r, 100));
      return { colors, sizes, hidden: !city.seasonParticles.visible };
    } finally {
      city.dispose();
    }
  });
  expect(new Set(result.colors).size).toBe(4);
  expect(new Set(result.sizes.map((x) => x.join(","))).size).toBe(1);
  expect(result.hidden).toBe(true);
});
