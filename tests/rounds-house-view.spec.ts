import { test, expect } from "@playwright/test";
test("local and room selectors offer 10 and 20 rounds", async ({ page }) => {
  await page.goto("/");
  for (const rounds of ["10", "20"]) {
    await page.locator("#round-count").selectOption(rounds);
    await expect(page.locator("#round-count")).toHaveValue(rounds);
  }
  await page.getByRole("button", { name: "開始我的城市冒險" }).click();
  await expect(page.locator("#round")).toContainText("20");
  await page.getByRole("button", { name: "邀請好友", exact: true }).click();
  for (const rounds of ["10", "20"]) {
    await page.locator("#room-rounds").selectOption(rounds);
    await expect(page.locator("#room-rounds")).toHaveValue(rounds);
  }
});
test("follow camera looks from the outer edge and property footprint leaves the track clear", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/city.ts",
      three = "/node_modules/three/build/three.module.js";
    const { ToyCity, cityTilePosition } = await import(path),
      T = await import(three);
    const holder = document.createElement("div");
    holder.style.cssText = "width:800px;height:600px";
    document.body.replaceChildren(holder);
    const city = new ToyCity(holder, () => {});
    const checks = [];
    try {
      for (const position of [10, 22, 34, 46]) {
        city.update({
          tiles: [
            {
              id: position,
              type: "property",
              name: "驗收房屋",
              owner: 0,
              level: 3,
            },
          ],
          players: [
            {
              id: 0,
              position,
              theme: "harbor",
              color: "#f5be62",
              bankrupt: false,
            },
          ],
          currentPlayer: 0,
        });
        city.setFollow(true);
        const radial = cityTilePosition(position).normalize();
        const view = city.camera.position.clone().sub(city.controls.target);
        const decor = city.tileVisuals[position].decor;
        const bounds = new T.Box3().setFromObject(decor);
        checks.push({
          outward: view.dot(radial),
          height: bounds.max.y - bounds.min.y,
          scale: decor.scale.y,
        });
      }
    } finally {
      city.dispose();
    }
    return checks;
  });
  for (const c of result) {
    expect(c.outward).toBeGreaterThan(16);
    expect(c.scale).toBe(0.82);
    expect(c.height).toBeGreaterThan(1.5);
    expect(c.height).toBeLessThan(1.9);
  }
});
