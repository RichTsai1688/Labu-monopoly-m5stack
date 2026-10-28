import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { GameState } from "../src/game-types";

const URL = "http://127.0.0.1:4174";
const SAVE_KEY = "labu-toy-city-v1";
let preview: ChildProcess | undefined;
let previewOutput = "";

test.describe("production offline installation", () => {
  test.beforeAll(async () => {
    try {
      await Promise.all(
        ["dist/index.html", "dist/sw.js", "dist/manifest.webmanifest"].map(
          (file) => access(resolve(file)),
        ),
      );
    } catch {
      throw new Error(
        "Production offline tests require a built app with its service worker. Run npm run build before npm run test:e2e.",
      );
    }
    preview = spawn(
      process.execPath,
      [
        resolve("node_modules/vite/bin/vite.js"),
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        "4174",
        "--strictPort",
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const capture = (chunk: Buffer) => {
      previewOutput = (previewOutput + chunk.toString()).slice(-6000);
    };
    preview.stdout?.on("data", capture);
    preview.stderr?.on("data", capture);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (preview.exitCode !== null)
        throw new Error(
          `Production preview did not start on port 4174: ${previewOutput}`,
        );
      if (previewOutput.includes("Local:") && previewOutput.includes("4174")) {
        try {
          if ((await fetch(URL)).ok) return;
        } catch {
          /* Preview is still opening its socket. */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      `Timed out starting the dedicated production preview on port 4174: ${previewOutput}`,
    );
  });

  test.afterAll(async () => {
    if (!preview || preview.exitCode !== null) return;
    const child = preview;
    await new Promise<void>((resolveDone) => {
      const force = setTimeout(() => {
        child.kill("SIGKILL");
      }, 2000);
      child.once("exit", () => {
        clearTimeout(force);
        resolveDone();
      });
      child.kill("SIGTERM");
    });
  });

  async function save(page: Page): Promise<GameState> {
    return page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      SAVE_KEY,
    );
  }

  test("installs static assets, reloads and plays with the network offline, without caching private chat or requesting a microphone", async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    const externalRequests: string[] = [];
    const requestsAfterOffline: string[] = [];
    let offline = false;
    page.on("pageerror", (error) => errors.push(error.message));
    context.on("request", (request) => {
      const requestUrl = request.url();
      if (!/^https?:/.test(requestUrl)) return;
      if (new globalThis.URL(requestUrl).origin !== URL)
        externalRequests.push(requestUrl);
      if (offline) requestsAfterOffline.push(requestUrl);
    });
    await page.addInitScript(() => {
      const probe = { playCalls: 0, elements: [] as HTMLMediaElement[] };
      Object.defineProperty(window, "__LABU_MEDIA_PROBE__", {
        value: probe,
        configurable: true,
      });
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        probe.playCalls++;
        if (!probe.elements.includes(this)) probe.elements.push(this);
        return originalPlay.call(this);
      };
      if (navigator.mediaDevices)
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          configurable: true,
          value: () => {
            sessionStorage.setItem(
              "labu-test-microphone-calls",
              String(
                Number(
                  sessionStorage.getItem("labu-test-microphone-calls") ?? 0,
                ) + 1,
              ),
            );
            return Promise.reject(
              new Error("Game audio must never request microphone access"),
            );
          },
        });
    });
    await page.goto(URL);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), {
        message:
          "Production service worker must control the page before offline verification",
      })
      .toBe(true);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    expect(
      await page.evaluate(() => (window as any).__LABU_MEDIA_PROBE__.playCalls),
    ).toBe(0);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as any).__LABU_DIAGNOSTICS__?.models?.loaded.length,
          ),
        {
          timeout: 30_000,
          message:
            "All eleven bundled 3D model assets must load before offline verification",
        },
      )
      .toBe(11);
    expect(
      await page.evaluate(
        () => (window as any).__LABU_DIAGNOSTICS__.models.failed,
      ),
    ).toEqual([]);

    await page.locator("#seat-count").selectOption("2");
    await page.locator("#human-count").selectOption("2");
    await page.locator("#player-name").fill("離線驗收玩家");
    await page.locator(".start-game").click();
    await page.locator("#sound").click();
    await expect(page.locator("#sound")).toHaveAttribute(
      "aria-label",
      "關閉音效",
    );
    await page.locator("#settings").click();
    await page.locator("#toggle-speed").click();
    expect(
      await page.evaluate(() => (window as any).__LABU_MEDIA_PROBE__.playCalls),
    ).toBe(0);
    await page.locator("#toggle-music").click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const media = (window as any).__LABU_MEDIA_PROBE__.elements[0] as
            HTMLMediaElement | undefined;
          return !!media && !media.paused && media.currentTime > 0;
        }),
      )
      .toBe(true);
    // Exercise the real HTMLAudioElement through the visibility handler without
    // depending on headless Chrome treating separate tabs as backgrounded.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(
      await page.evaluate(
        () =>
          ((window as any).__LABU_MEDIA_PROBE__.elements[0] as HTMLMediaElement)
            .paused,
      ),
    ).toBe(true);
    await page.evaluate(() => {
      delete (document as any).hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              (window as any).__LABU_MEDIA_PROBE__
                .elements[0] as HTMLMediaElement
            ).paused,
        ),
      )
      .toBe(false);
    await page.locator("#toggle-music").click();
    expect(
      await page.evaluate(
        () =>
          ((window as any).__LABU_MEDIA_PROBE__.elements[0] as HTMLMediaElement)
            .paused,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "關閉視窗" }).click();

    const privateMarker = `快取不可包含私人內容-${Date.now()}`;
    await page.locator('#chat-launch').click();
    await page.locator("#chat-private").click();
    await page.locator("#chat-input").fill(privateMarker);
    await page.locator("#chat-input").press("Enter");
    await expect(page.locator("#chat-messages")).toContainText(privateMarker);
    await page.locator("#turn-action").click();
    await expect.poll(async () => (await save(page)).phase).toBe("action");
    const afterFirstRoll = await save(page);
    expect(afterFirstRoll.marketTick).toBe(afterFirstRoll.die);
    expect(afterFirstRoll.marketTick).toBeGreaterThan(0);
    await page.locator("#turn-action").click();
    const beforeReload = await save(page);
    expect(beforeReload.currentPlayer).toBe(1);
    expect(beforeReload.phase).toBe("roll");

    const cacheData = await page.evaluate(async () => {
      const result: { name: string; urls: string[]; bodies: string[] }[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        const textRequests = requests.filter((request) =>
          /\/(?:index\.html|manifest\.webmanifest|icon\.svg|assets\/[^/]+\.(?:js|css))?$/.test(
            new globalThis.URL(request.url).pathname,
          ),
        );
        result.push({
          name,
          urls: requests.map((request) => request.url),
          bodies: await Promise.all(
            textRequests.map(async (request) =>
              (await cache.match(request))!.text(),
            ),
          ),
        });
      }
      return result;
    });
    expect(cacheData.some((cache) => cache.name.startsWith("labu-city-"))).toBe(
      true,
    );
    const cachedUrls = cacheData.flatMap((cache) => cache.urls);
    expect(cachedUrls).toContain(`${URL}/index.html`);
    expect(cachedUrls).toContain(`${URL}/icon-192.png`);
    expect(cachedUrls).toContain(`${URL}/icon-512.png`);
    expect(cachedUrls.some((url) => /\/assets\/.*\.js$/.test(url))).toBe(true);
    expect(cachedUrls.some((url) => /\/assets\/.*\.css$/.test(url))).toBe(true);
    expect(
      cachedUrls.filter((url) =>
        /\/assets\/(?:bear|rabbit|robot|penguin)-[^/]+\.webp$/.test(url),
      ),
    ).toHaveLength(4);
    expect(
      cachedUrls.filter((url) => /\/assets\/.*\.glb$/.test(url)),
    ).toHaveLength(11);
    expect(
      cachedUrls.filter((url) => /\/assets\/.*\.mp3$/.test(url)),
    ).toHaveLength(1);
    expect(
      cachedUrls.filter((url) =>
        /\/assets\/(?:bicycle|scooter|city-car|tesla-model-3|tesla-model-y)-[^/]+\.png$/.test(
          url,
        ),
      ),
    ).toHaveLength(5);
    for (const url of cachedUrls) {
      expect(new globalThis.URL(url).origin).toBe(URL);
      expect(new globalThis.URL(url).pathname).toMatch(
        /^\/(?:index\.html|icon\.svg|icon-(?:192|512)\.png|manifest\.webmanifest|assets\/[^/]+\.(?:js|css|webp|png|glb|mp3))?$/,
      );
    }
    expect(JSON.stringify(cacheData)).not.toContain(privateMarker);

    offline = true;
    await context.setOffline(true);
    const response = await page.reload({ waitUntil: "domcontentloaded" });
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.locator("#resume-game")).toBeVisible();
    await page.locator("#resume-game").click();
    expect(await save(page)).toEqual(beforeReload);
    expect(
      await page.evaluate(() => (window as any).__LABU_MEDIA_PROBE__.playCalls),
    ).toBe(0);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as any).__LABU_DIAGNOSTICS__?.models?.loaded.length,
          ),
        {
          timeout: 30_000,
          message:
            "All eleven model assets must also load without network access",
        },
      )
      .toBe(11);
    expect(
      await page.evaluate(
        () => (window as any).__LABU_DIAGNOSTICS__.models.failed,
      ),
    ).toEqual([]);
    await expect
      .poll(() =>
        page
          .locator(".player-card img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await page.locator("#settings").click();
    await page.locator("#toggle-music").click();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const media = (window as any).__LABU_MEDIA_PROBE__.elements[0] as
              HTMLMediaElement | undefined;
            return !!media && !media.paused && media.currentTime > 0;
          }),
        {
          message:
            "The cached local background track must play after an offline user gesture",
        },
      )
      .toBe(true);
    await page.getByRole("button", { name: "關閉視窗" }).click();
    await page.locator("#turn-action").click();
    await expect.poll(async () => (await save(page)).phase).toBe("action");
    const offlineState = await save(page);
    expect(offlineState.marketTick - beforeReload.marketTick).toBe(
      offlineState.dice.reduce((sum, die) => sum + die, 0),
    );
    expect(offlineState.marketTick).toBeGreaterThan(beforeReload.marketTick);
    expect(requestsAfterOffline.some((url) => /\/assets\//.test(url))).toBe(
      true,
    );
    expect(
      await page.evaluate(() =>
        Number(sessionStorage.getItem("labu-test-microphone-calls") ?? 0),
      ),
    ).toBe(0);
    expect(
      externalRequests,
      "Production must not load external CDN assets or make remote API calls",
    ).toEqual([]);
    expect(
      errors,
      "Production must keep working without unhandled browser errors",
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("production-offline-play.png"),
      fullPage: true,
    });
  });
});
