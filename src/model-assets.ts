import vehicle0Url from "./assets/models/bicycle.glb?url";
import vehicle1Url from "./assets/models/scooter.glb?url";
import vehicle2Url from "./assets/models/city-car.glb?url";
import vehicle3Url from "./assets/models/tesla-model-3.glb?url";
import vehicle4Url from "./assets/models/tesla-model-y.glb?url";
import { Mesh, Texture, type Object3D, type Material } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import robotUrl from "./assets/models/robot.glb?url";
import penguinUrl from "./assets/models/penguin.glb?url";
import townhouseUrl from "./assets/models/townhouse.glb?url";
import bearUrl from "./assets/models/bear.glb?url";
import rabbitUrl from "./assets/models/rabbit.glb?url";
import bankUrl from "./assets/models/bank.glb?url";
import type { ToyCity } from "./city";

/** Owns shared template resources; dispose AFTER ToyCity removes its clones. */
export class CityModelAssets {
  private controller = new AbortController();
  private templates: Object3D[] = [];
  private closed = false;
  private loaded: string[] = [];
  private failed: string[] = [];
  readonly ready: Promise<void>;

  constructor(city: ToyCity) {
    const entries = [
      {
        id: "bicycle",
        url: vehicle0Url,
        attach: (scene: Object3D) => city.setVehicleTemplate("bicycle", scene),
      },
      {
        id: "scooter",
        url: vehicle1Url,
        attach: (scene: Object3D) => city.setVehicleTemplate("scooter", scene),
      },
      {
        id: "city-car",
        url: vehicle2Url,
        attach: (scene: Object3D) => city.setVehicleTemplate("city-car", scene),
      },
      {
        id: "tesla-model-3",
        url: vehicle3Url,
        attach: (scene: Object3D) =>
          city.setVehicleTemplate("tesla-model-3", scene),
      },
      {
        id: "tesla-model-y",
        url: vehicle4Url,
        attach: (scene: Object3D) =>
          city.setVehicleTemplate("tesla-model-y", scene),
      },

      {
        id: "bank",
        url: bankUrl,
        attach: (scene: Object3D) => city.attachLandmarkModel("bank", scene),
      },
      {
        id: "bear",
        url: bearUrl,
        attach: (scene: Object3D) => city.setPawnTemplate(0, scene),
      },
      {
        id: "rabbit",
        url: rabbitUrl,
        attach: (scene: Object3D) => city.setPawnTemplate(1, scene),
      },
      {
        id: "robot",
        url: robotUrl,
        attach: (scene: Object3D) => city.setPawnTemplate(2, scene),
      },
      {
        id: "penguin",
        url: penguinUrl,
        attach: (scene: Object3D) => city.setPawnTemplate(3, scene),
      },
      {
        id: "townhouse",
        url: townhouseUrl,
        attach: (scene: Object3D) =>
          city.attachLandmarkModel("townhouse", scene),
      },
    ];
    // The procedural city is already playable; local model decoding never gates a turn.
    this.ready = Promise.all(
      entries.map(async (entry) => {
        try {
          const response = await fetch(entry.url, {
            signal: this.controller.signal,
          });
          if (!response.ok) throw new Error("asset response");
          const gltf = await new GLTFLoader().parseAsync(
            await response.arrayBuffer(),
            "",
          );
          if (this.closed) {
            releaseTemplate(gltf.scene);
            return;
          }
          this.templates.push(gltf.scene);
          entry.attach(gltf.scene);
          this.loaded.push(entry.id);
        } catch (error) {
          if (!this.closed) {
            this.failed.push(entry.id);
            console.warn(`保留輕量模型：${entry.id}`, error);
          }
        }
      }),
    ).then(() => {});
  }

  diagnostics() {
    return {
      loaded: [...this.loaded],
      failed: [...this.failed],
      disposed: this.closed,
    };
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    this.templates.forEach(releaseTemplate);
    this.templates.length = 0;
  }
}

function releaseTemplate(scene: Object3D): void {
  const geometries = new Set<Mesh["geometry"]>(),
    materials = new Set<Material>(),
    textures = new Set<Texture>();
  const bitmaps = new Set<ImageBitmap>();
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof Texture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    if (
      typeof ImageBitmap !== "undefined" &&
      texture.image instanceof ImageBitmap
    )
      bitmaps.add(texture.image);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
}
