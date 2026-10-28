import { test, expect } from "@playwright/test";

test("pawns face every board edge, hop and land, without turning for shared-tile offsets", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const url = "/src/city.ts";
    const { ToyCity } = await import(url);
    const holder = document.createElement("div");
    holder.style.cssText = "width:800px;height:600px";
    document.body.replaceChildren(holder);
    const city = new ToyCity(holder, () => {});
    const player = {
      id: 0,
      position: 0,
      theme: "candy",
      color: "#ff839c",
      bankrupt: false,
    };
    const data = {
      tiles: [],
      players: [player],
      currentPlayer: 0,
      stepDuration: 420,
    };
    const angles: number[] = [],
      heights: number[] = [];
    try {
      for (const [from, to] of [
        [0, 1],
        [12, 13],
        [24, 25],
        [36, 37],
        [47, 0],
      ]) {
        player.position = from;
        city.update(data);
        await new Promise((r) => setTimeout(r, 330));
        player.position = to;
        city.update(data);
        const pawn = city.pawns.get(0);
        angles.push(pawn.group.rotation.y);
        await new Promise((r) => setTimeout(r, 145));
        heights.push(pawn.group.position.y);
        await new Promise((r) => setTimeout(r, 200));
        heights.push(pawn.group.position.y);
      }
      const before = city.pawns.get(0).group.rotation.y;
      data.players.push({ ...player, id: 1 });
      city.update(data);
      const offset = {
        angle: city.pawns.get(0).group.rotation.y,
        hopping: city.pawns.get(0).hopping,
      };
      data.stepDuration = 110;
      player.position = 1;
      city.update(data);
      const duration = city.pawns.get(0).duration;
      await new Promise((r) => setTimeout(r, 120));
      return {
        angles,
        heights,
        before,
        offset,
        duration,
        fastY: city.pawns.get(0).group.position.y,
      };
    } finally {
      city.dispose();
    }
  });
  for (const [i, expected] of [
    Math.PI / 2,
    0,
    -Math.PI / 2,
    Math.PI,
    Math.PI,
  ].entries())
    expect(result.angles[i]).toBeCloseTo(expected);
  for (let i = 0; i < result.heights.length; i += 2) {
    expect(result.heights[i]).toBeGreaterThan(0.65);
    expect(result.heights[i + 1]).toBeCloseTo(0.33);
  }
  expect(result.offset.angle).toBe(result.before);
  expect(result.offset.hopping).toBe(false);
  expect(result.duration).toBe(90);
  expect(result.fastY).toBeCloseTo(0.33);
});
