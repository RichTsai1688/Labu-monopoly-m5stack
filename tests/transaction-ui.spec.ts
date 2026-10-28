import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { createGame, dispatch, getNpcAction } from "../src/engine";
import type { GameAction, GameState } from "../src/game-types";
import type { RoomSnapshot } from "../src/network";

/** Transport-only mock: real reducer fixtures exercise UI acknowledgements.
 * Authentication, synchronization and lifecycle use the real server in its own tests.
 */
async function mockRoom(page: Page, initial: GameState) {
  let game = initial;
  let version = 1;
  let socket: WebSocketRoute;
  let pending: { requestId: string; action: GameAction } | undefined;
  const snapshot = (started = true) => {
    const value: RoomSnapshot = {
      code: "UIFIXTURE001",
      status: started ? "playing" : "lobby",
      version,
      seats: 2,
      hostId: "player-0",
      selfId: "player-0",
      pendingReclaim: false,
      messages: [],
      players: [
        {
          id: "player-0",
          name: game.players[0].name,
          connected: true,
          host: true,
        },
      ],
      game: started ? game : null,
    };
    socket.send(JSON.stringify({ type: "snapshot", snapshot: value }));
  };
  const ack = (requestId: string) =>
    socket.send(JSON.stringify({ type: "ack", requestId }));
  await page.routeWebSocket("ws://127.0.0.1:5174", (route) => {
    socket = route;
    route.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "create") {
        route.send(
          JSON.stringify({
            type: "session",
            session: {
              code: "UIFIXTURE001",
              token: "test-only-seat",
              playerId: "player-0",
            },
          }),
        );
        snapshot(false);
        ack(message.requestId);
      } else if (message.type === "start") {
        snapshot();
        ack(message.requestId);
      } else if (message.type === "command") {
        expect(message.expectedVersion).toBe(version);
        expect(
          pending,
          "Only one command should be outstanding in this fixture",
        ).toBeUndefined();
        pending = { requestId: message.requestId, action: message.action };
      } else throw new Error(`Unexpected fixture command: ${message.type}`);
    });
  });
  return {
    pendingType: () => pending?.action.type,
    state: () => game,
    accept() {
      if (!pending) throw new Error("No pending fixture command");
      const { requestId, action } = pending;
      pending = undefined;
      game = dispatch(game, { ...action, actorId: "player-0" });
      // The real room server owns movement and NPC turns. Reuse its actual engine
      // planner here, without waiting for animation timers in a transport UI test.
      for (
        let i = 0;
        i < 100 &&
        (game.phase === "moving" || game.players[game.currentPlayer].isNpc);
        i++
      ) {
        const next = getNpcAction(game);
        if (!next) break;
        game = dispatch(game, next);
      }
      version++;
      snapshot();
      ack(requestId);
    },
    barrier(label: string) {
      // An ordered snapshot following the ack proves the browser has consumed it.
      game = structuredClone(game);
      game.log.push({ id: game.nextLogId++, round: game.round, text: label });
      snapshot();
    },
  };
}

function fixture(position: number) {
  const game = createGame({
    seed: "transaction-ui",
    seats: 2,
    players: [{ name: "交易測試房主" }, { name: "Labu", isNpc: true }],
  });
  game.players[0].position = position;
  game.phase = "action";
  return game;
}

async function openRoom(page: Page) {
  await page.goto("/");
  await page.locator("#lobby-room").click();
  await page.locator("#room-seats").selectOption("2");
  await page.locator("#room-submit").click();
  await page.locator("#room-start").click();
  await expect(page.locator("#modal")).not.toBeVisible();
}

test.describe("room transaction UI with mocked transport and real engine", () => {
  test("refreshes a purchased Tesla and equipped three-dice vehicle after acknowledgements", async ({
    page,
  }) => {
    const room = await mockRoom(page, fixture(7));
    await openRoom(page);
    await page.locator('[data-action="vehicles"]').click();
    const previews = page.locator(".vehicle-model-preview img");
    await expect(previews).toHaveCount(5);
    await expect
      .poll(() =>
        previews.evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
      )
      .toBe(true);
    const buy = page.locator('[data-buy-vehicle="tesla-model-3"]');
    await buy.click();
    await expect.poll(room.pendingType).toBe("buyVehicle");
    room.accept();
    await expect(buy).toHaveText("已收藏");
    await expect(buy).toBeDisabled();
    expect(room.state().players[0].vehicles).toContain("tesla-model-3");
    await page.getByRole("button", { name: "關閉視窗" }).click();
    await page.locator("#turn-action").click();
    await expect.poll(room.pendingType).toBe("finishTurn");
    room.accept();
    await page.locator('#garage-launch').click();
    const equip = page.locator('[data-equip-vehicle="tesla-model-3"]');
    await equip.click();
    await expect.poll(room.pendingType).toBe("equipVehicle");
    room.accept();
    await expect(equip).toHaveText("正在使用");
    await expect(equip).toBeDisabled();
    await expect(page.locator(".garage-current")).toContainText("3 顆骰子");
    await page.getByRole("button", { name: "關閉視窗" }).click();
    const tickBefore = room.state().marketTick;
    await page.locator("#turn-action").click();
    await expect.poll(room.pendingType).toBe("roll");
    room.accept();
    expect(room.state().dice).toHaveLength(3);
    expect(room.state().marketTick - tickBefore).toBe(
      room.state().dice.reduce((sum, die) => sum + die, 0),
    );
    await expect(page.locator("#dice-reveal .dice-cube")).toHaveCount(3);
    await expect(page.locator("#tick-label")).toContainText(
      `已更新 ${room.state().marketTick} 次`,
    );
  });

  test("a delayed transaction acknowledgement cannot reopen a closed modal", async ({
    page,
  }) => {
    const room = await mockRoom(page, fixture(7));
    await openRoom(page);
    await page.locator('[data-action="vehicles"]').click();
    await page.locator('[data-buy-vehicle="tesla-model-3"]').click();
    await expect.poll(room.pendingType).toBe("buyVehicle");
    await page.getByRole("button", { name: "關閉視窗" }).click();
    room.accept();
    room.barrier("延遲交易已確認，視窗保持關閉");
    await expect(page.locator("#public-events")).toContainText(
      "延遲交易已確認，視窗保持關閉",
    );
    await expect(page.locator("#modal")).not.toBeVisible();
    await page.locator('[data-action="vehicles"]').click();
    await expect(page.locator('[data-buy-vehicle="tesla-model-3"]')).toHaveText(
      "已收藏",
    );
  });

  test("construction removes a fully upgraded property after the server reply", async ({
    page,
  }) => {
    const initial = fixture(47);
    initial.tiles[1].ownerId = "player-0";
    initial.tiles[1].level = 2;
    const room = await mockRoom(page, initial);
    await openRoom(page);
    await page.locator('[data-action="construction"]').click();
    await page.locator('[data-upgrade="1"]').click();
    await expect.poll(room.pendingType).toBe("upgrade");
    room.accept();
    await expect(page.locator('[data-upgrade="1"]')).toHaveCount(0);
    await expect(page.locator("#modal")).toBeVisible();
    expect(room.state().tiles[1].level).toBe(3);
  });
});
