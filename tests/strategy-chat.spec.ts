import { test, expect, type Page } from "@playwright/test";
import { createGame, serializeGame } from "../src/engine";
import type { GameState } from "../src/game-types";
async function resume(page: Page, s: GameState) {
  await page.addInitScript(
    (save) => localStorage.setItem("labu-toy-city-v1", save),
    serializeGame(s),
  );
  await page.goto("/");
  await page.locator("#resume-game").click();
}
test("city goals and remote building work through the UI and persist once", async ({
  page,
}) => {
  const s = createGame({
    seats: 2,
    players: [{ name: "測試玩家" }, { name: "Labu", isNpc: true }],
  });
  s.phase = "action";
  s.players[0].cards = ["renovation"];
  s.tiles[1].ownerId = s.players[0].id;
  s.tiles[1].level = 1;
  s.tiles[2].ownerId = s.players[0].id;
  s.tiles[2].level = 2;
  await resume(page, s);
  await page.locator('[data-player="0"]').click();
  await page.locator('[data-card="renovation"]').click();
  await page.locator('[data-renovate="1"]').click();
  await expect(page.locator("#modal")).not.toBeVisible();
  await page.locator('[data-player="0"]').click();
  await page.locator("#assets-goals").click();
  await expect(page.locator('[data-goal="builder"]')).toBeEnabled();
  await page.locator('[data-goal="builder"]').click();
  await expect(page.locator('[data-goal="builder"]')).toHaveText("已領取");
  await expect(page.locator('[data-goal="builder"]')).toBeDisabled();
  const save = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("labu-toy-city-v1")!),
  );
  expect(save.players[0].completedGoals).toEqual(["builder"]);
  expect(save.players[0].cash).toBe(4600);
  expect(save.tiles[1].level).toBe(2);
});
test("AI public chat gets only projected context; private chat never calls AI; disabling AI works", async ({
  page,
}) => {
  const requests: unknown[] = [];
  await page.route("**/api/npc/status", (r) =>
    r.fulfill({ json: { configured: true } }),
  );
  await page.route("**/api/npc/chat", (r) => {
    requests.push(r.request().postDataJSON());
    return r.fulfill({
      json: {
        text: "我現在在市政廣場，現金 400 萬元，要留點錢買地！",
        source: "ai",
      },
    });
  });
  await resume(page, createGame({ seats: 2, seed: "SECRET-RNG-SEED" }));
  await page.locator("#chat-launch").click();
  await page.locator("#chat-input").fill("Labu 你在哪？");
  await page.locator("#chat-form button").click();
  await expect(page.locator(".chat-message").last()).toContainText("400 萬元");
  await expect(page.locator(".chat-message").last()).toContainText("AI");
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests)).not.toMatch(
    /SECRET-RNG-SEED|rngState|demo-working/,
  );
  await page.locator("#chat-private").click();
  await page.locator("#chat-input").fill("PRIVATE-REMINDER");
  await page.locator("#chat-form button").click();
  expect(requests).toHaveLength(1);
  await page.locator("#chat-public").click();
  await page.locator(".chat-privacy summary").click();
  await page.locator("#ai-toggle").click();
  await page.locator("#chat-input").fill("銀行怎麼用？");
  await page.locator("#chat-form button").click();
  await expect(page.locator(".chat-message").last()).toContainText("銀行");
  expect(requests).toHaveLength(1);
});
test("NPC automatically comments on its own arrival without stopping the next player", async ({
  page,
}) => {
  let context: any;
  await page.route("**/api/npc/status", (r) =>
    r.fulfill({ json: { configured: true } }),
  );
  await page.route("**/api/npc/chat", (r) => {
    context = r.request().postDataJSON().context;
    return r.fulfill({
      json: { text: "我被送進監獄了，下次得守規矩！", source: "ai" },
    });
  });
  const s = createGame({ seats: 2 });
  s.currentPlayer = 1;
  s.phase = "moving";
  s.players[1].position = 23;
  s.dice = [1];
  s.die = 1;
  s.pendingSteps = 1;
  await resume(page, s);
  await expect.poll(() => context?.self).toContain("正在服刑");
  expect(context.speaker).toBe("Labu");
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("labu-toy-city-v1")!).currentPlayer,
      ),
    )
    .toBe(0);
});
