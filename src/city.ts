import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Offline toy city; optional local GLB templates are attached after the first playable frame. */
export interface CityData {
  tiles: {
    id: number;
    type: string;
    name: string;
    owner: number | null;
    level: number;
    effect?: "roadblock" | "trap" | "shutdown";
  }[];
  players: {
    id: number;
    position: number;
    theme: string;
    color: string;
    bankrupt: boolean;
    vehicleId?: string | null;
  }[];
  currentPlayer: number;
  stepDuration?: number;
  season?: number;
}

const TILE_SIZE = 1.3;
const EDGE = TILE_SIZE * 6;
const BANKS = [3, 11, 19, 27, 35, 43];
const C = {
  cream: "#fff5df",
  white: "#fffdf6",
  peach: "#ffb797",
  red: "#f06d58",
  blue: "#73b9e2",
  aqua: "#77cfbd",
  yellow: "#ffcd59",
  green: "#72b78c",
  leaf: "#4d9b70",
  dark: "#3c5363",
  purple: "#a38bd8",
  road: "#80949c",
  grass: "#add498",
  ink: "#344b53",
  gold: "#e9b65d",
};

export function cityTilePosition(index: number): THREE.Vector3 {
  const n = ((index % 48) + 48) % 48;
  if (n <= 12) return new THREE.Vector3((n - 6) * TILE_SIZE, 0, -EDGE);
  if (n <= 23) return new THREE.Vector3(EDGE, 0, (n - 18) * TILE_SIZE);
  if (n <= 36) return new THREE.Vector3((30 - n) * TILE_SIZE, 0, EDGE);
  return new THREE.Vector3(-EDGE, 0, (42 - n) * TILE_SIZE);
}

type Pawn = {
  group: THREE.Group;
  marker: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  movedAt: number;
  position: number;
  duration: number;
  hopping: boolean;
  theme: string;
  color: string;
  vehicleId: string | null;
};
type TileVisual = {
  group: THREE.Group;
  surface: THREE.Mesh;
  label: THREE.Mesh;
  decor: THREE.Group;
  signature: string;
};

export class ToyCity {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private controls: OrbitControls;
  private resizeObserver: ResizeObserver;
  private animationFrame = 0;
  private disposed = false;
  private lowQuality = false;
  private tileVisuals: TileVisual[] = [];
  private prankMarkers = new Map<number, { group: THREE.Group; kind: string }>();
  private clickTargets: THREE.Object3D[] = [];
  private pawns = new Map<number, Pawn>();
  private season = -1;
  private seasonParticles: THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  > | null = null;
  private materialCache = new Map<string, THREE.MeshStandardMaterial>();
  private geometryCache = new Map<string, THREE.BufferGeometry>();
  private textures = new Set<THREE.Texture>();
  private geometries = new Set<THREE.BufferGeometry>();
  private extraMaterials = new Set<THREE.Material>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDown = new THREE.Vector2();
  private activePointer = -1;
  private lastTime = 0;
  private portrait = false;
  private hasSized = false;
  private needsRender = true;
  private inViewport = true;
  private intersectionObserver: IntersectionObserver;
  private lastRenderedAt = 0;
  private renderedFrames = 0;
  private wasMoving = false;
  private fountainJet: THREE.Mesh | null = null;
  private followEnabled = true;
  private followPoint = new THREE.Vector3();
  private followedTile = -1;
  private followedPlayer = -1;
  private lastData: CityData | null = null;
  private cityCenter: THREE.Group | null = null;
  private landmarkTemplates = new Map<"bank" | "townhouse", THREE.Object3D>();
  private pawnTemplates = new Map<number, THREE.Object3D>();
  private vehicleTemplates = new Map<string, THREE.Object3D>();
  private townhouseSerial = 0;
  private contactMaterial: THREE.MeshBasicMaterial | null = null;
  private environmentMap: THREE.WebGLRenderTarget | null = null;
  private tram = new THREE.Group();
  private tramCurve: THREE.CatmullRomCurve3 | null = null;
  private wheel = new THREE.Group();
  private boardDecor = new THREE.Group();
  private currentRing: THREE.Mesh;
  private directional: THREE.DirectionalLight;
  private currentIndex = 0;
  private hoverIndex: number | null = null;
  private motionReduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;

  constructor(
    private container: HTMLElement,
    private onTileClick: (index: number) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor("#eaf1e6", 0);
    this.renderer.domElement.className = "city-canvas";
    this.renderer.domElement.style.cssText =
      "display:block;width:100%;height:100%;touch-action:none;outline:none";
    this.renderer.domElement.setAttribute(
      "aria-label",
      "48 格玩具城市棋盤，可拖曳轉動、縮放，點選地產查看詳情",
    );
    this.renderer.domElement.setAttribute("role", "img");
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-15, 15, 12, -12, 0.1, 150);
    this.camera.position.set(2.3, 20.5, 30);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = true;
    this.controls.minZoom = 0.7;
    this.controls.maxZoom = 3.2;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = Math.PI / 2.45;
    this.controls.target.set(0, 0.35, 0);
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.addEventListener("change", this.invalidate);

    // A small, locally generated studio environment gives rounded toy edges a
    // soft highlight without a full-screen effect or a downloaded HDR image.
    const environment = new RoomEnvironment();
    const environmentGenerator = new THREE.PMREMGenerator(this.renderer);
    this.environmentMap = environmentGenerator.fromScene(
      environment,
      0.06,
      0.1,
      100,
      { size: 128 },
    );
    this.scene.environment = this.environmentMap.texture;
    this.scene.environmentIntensity = 0.24;
    environment.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    environment.dispose();
    environmentGenerator.dispose();
    this.scene.add(new THREE.AmbientLight("#ffffff", 0.25));
    this.scene.add(new THREE.HemisphereLight("#e6f7ff", "#a6ae75", 0.65));
    this.directional = new THREE.DirectionalLight("#fff1cc", 2.2);
    this.directional.position.set(-12, 20, 12);
    this.directional.castShadow = true;
    this.directional.shadow.mapSize.set(2048, 2048);
    this.directional.shadow.radius = 3;
    this.directional.shadow.camera.left = -14;
    this.directional.shadow.camera.right = 14;
    this.directional.shadow.camera.top = 14;
    this.directional.shadow.camera.bottom = -14;
    this.directional.shadow.camera.near = 1;
    this.directional.shadow.camera.far = 55;
    this.directional.shadow.normalBias = 0.04;
    this.scene.add(this.directional);

    this.buildBase();
    this.buildCity();
    for (let id = 0; id < 48; id++) this.buildTile(id);
    this.scene.add(this.boardDecor);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: "#f5ac4c",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.extraMaterials.add(ringMaterial);
    this.currentRing = new THREE.Mesh(
      this.geo("ring:0.54:0.61", () => new THREE.RingGeometry(0.54, 0.61, 48)),
      ringMaterial,
    );
    this.currentRing.rotation.x = -Math.PI / 2;
    this.currentRing.position.copy(cityTilePosition(0));
    this.currentRing.position.y = 0.333;
    this.scene.add(this.currentRing);

    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.onPointerDown,
    );
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.addEventListener(
      "pointermove",
      this.onPointerMove,
    );
    this.renderer.domElement.addEventListener(
      "pointerleave",
      this.onPointerLeave,
    );
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        this.inViewport = entries.some((entry) => entry.isIntersecting);
        if (this.inViewport) this.needsRender = true;
      },
      { threshold: 0 },
    );
    this.intersectionObserver.observe(container);
    this.resize();
    this.animate();
  }

  private mat(color: string, roughness = 0.36): THREE.MeshStandardMaterial {
    const key = `${color}:${roughness}`;
    if (!this.materialCache.has(key))
      this.materialCache.set(
        key,
        new THREE.MeshStandardMaterial({
          color: this.seasonColor(color),
          roughness,
          metalness: 0.02,
        }),
      );
    return this.materialCache.get(key)!;
  }

  private seasonColor(color: string): string {
    const foliage = [
      "#74ae41",
      "#8abb47",
      "#4f9e55",
      "#6dac68",
      "#4d9b70",
      "#7dad79",
    ];
    const i = foliage.indexOf(color);
    if (i >= 0)
      return [
        ["#8cbb7b", "#f2bac8", "#79ad80", "#a6c78c"],
        ["#63a33d", "#8abb47", "#438f48", "#58a65d"],
        ["#d78b43", "#e8b35e", "#b96c43", "#cc9b54"],
        ["#c6d9d7", "#e8eeee", "#a6c2bd", "#d9e4e2"],
      ][Math.max(0, this.season)][i % 4];
    if (
      [
        "#9bc465",
        "#9ac273",
        "#add498",
        "#86ba58",
        "#65a362",
        "#77b773",
        "#8ec777",
        "#78b77c",
        "#62a878",
        "#8ac674",
      ].includes(color)
    )
      return ["#b0ce91", "#9bc465", "#cfbb83", "#e3e9df"][
        Math.max(0, this.season)
      ];
    if (color === "#7bcfe5")
      return ["#a0d6df", "#7bcfe5", "#a6ccd1", "#c2dce8"][
        Math.max(0, this.season)
      ];
    return color;
  }

  private setSeason(season: number): void {
    const next = Math.max(0, Math.min(3, Math.floor(season)));
    if (next === this.season) return;
    this.season = next;
    for (const [key, material] of this.materialCache)
      material.color.set(this.seasonColor(key.split(":")[0]));
    this.directional.color.set(
      ["#fff3eb", "#fff6d9", "#ffe0bf", "#e4efff"][next],
    );
    if (!this.seasonParticles) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(64 * 3), 3),
      );
      this.geometries.add(geometry);
      const material = new THREE.PointsMaterial({
        size: 4,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        sizeAttenuation: false,
      });
      this.extraMaterials.add(material);
      this.seasonParticles = new THREE.Points(geometry, material);
      this.seasonParticles.frustumCulled = false;
      this.scene.add(this.seasonParticles);
    }
    this.seasonParticles.material.color.set(
      ["#f6c4d5", "#fff7bb", "#dca35e", "#ffffff"][next],
    );
    this.needsRender = true;
    this.renderer.shadowMap.needsUpdate = true;
  }

  private contactShadow(
    parent: THREE.Object3D,
    x: number,
    z: number,
    width: number,
    depth: number,
    y = 0.307,
  ): void {
    if (!this.contactMaterial) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d")!;
      const gradient = context.createRadialGradient(32, 32, 3, 32, 32, 31);
      gradient.addColorStop(0, "rgba(39,59,33,0.62)");
      gradient.addColorStop(0.5, "rgba(39,59,33,0.24)");
      gradient.addColorStop(1, "rgba(39,59,33,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      const texture = new THREE.CanvasTexture(canvas);
      this.textures.add(texture);
      this.contactMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
        side: THREE.DoubleSide,
      });
      this.contactMaterial.userData.shared = true;
      this.contactMaterial.userData.batchable = true;
      this.extraMaterials.add(this.contactMaterial);
    }
    const shadow = new THREE.Mesh(
      this.geo(
        `contact:${width}:${depth}`,
        () => new THREE.PlaneGeometry(width, depth),
      ),
      this.contactMaterial,
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(x, y, z);
    parent.add(shadow);
  }

  private normalizedAsset(
    template: THREE.Object3D,
    width: number,
    height: number,
    depth: number,
  ): THREE.Group {
    const group = new THREE.Group();
    const model = template.clone(true);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const factor = Math.min(
      width / Math.max(size.x, 0.001),
      height / Math.max(size.y, 0.001),
      depth / Math.max(size.z, 0.001),
    );
    model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
    group.add(model);
    group.scale.setScalar(factor);
    group.userData.externalAsset = true;
    group.userData.dynamic = true;
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return group;
  }

  /** Templates remain owned by the external asset loader; this city only owns clones. */
  attachLandmarkModel(
    kind: "bank" | "townhouse",
    template: THREE.Object3D,
  ): void {
    if (this.disposed) return;
    this.landmarkTemplates.set(kind, template);
    if (kind === "townhouse" && this.cityCenter) {
      this.clearDecor(this.cityCenter);
      this.cityCenter.removeFromParent();
      this.tram.clear();
      this.wheel.clear();
      this.fountainJet = null;
      this.tramCurve = null;
      this.buildCity();
    }
    if (kind === "bank")
      for (const tile of this.tileVisuals) tile.signature = "";
    if (this.lastData) this.update(this.lastData);
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }

  setPawnTemplate(index: number, template: THREE.Object3D): void {
    if (this.disposed) return;
    this.pawnTemplates.set(index, template);
    const pawn = this.pawns.get(index);
    if (pawn) {
      this.clearDecor(pawn.group);
      pawn.group.removeFromParent();
      this.pawns.delete(index);
    }
    if (this.lastData) this.update(this.lastData);
  }

  setVehicleTemplate(id: string, template: THREE.Object3D): void {
    if (this.disposed) return;
    this.vehicleTemplates.set(id, template);
    for (const [key, pawn] of this.pawns) {
      if (pawn.vehicleId !== id) continue;
      this.clearDecor(pawn.group);
      pawn.group.removeFromParent();
      this.pawns.delete(key);
    }
    if (this.lastData) this.update(this.lastData);
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }

  private geo(
    key: string,
    create: () => THREE.BufferGeometry,
  ): THREE.BufferGeometry {
    if (!this.geometryCache.has(key)) {
      const geometry = create();
      this.geometryCache.set(key, geometry);
      this.geometries.add(geometry);
    }
    return this.geometryCache.get(key)!;
  }

  private box(
    parent: THREE.Object3D,
    size: number[],
    at: number[],
    color: string,
    rounded = false,
  ): THREE.Mesh {
    const [w, h, d] = size;
    const g = this.geo(`box:${size.join(":")}:${rounded}`, () =>
      rounded
        ? new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.12)
        : new THREE.BoxGeometry(w, h, d),
    );
    const mesh = new THREE.Mesh(g, this.mat(color));
    mesh.position.set(at[0], at[1], at[2]);
    mesh.castShadow = h > 0.15;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private sphere(
    parent: THREE.Object3D,
    r: number,
    at: number[],
    color: string,
    scale?: number[],
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.geo(`sphere:${r}`, () => new THREE.SphereGeometry(r, 16, 12)),
      this.mat(color),
    );
    mesh.position.set(at[0], at[1], at[2]);
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private cylinder(
    parent: THREE.Object3D,
    rt: number,
    rb: number,
    h: number,
    at: number[],
    color: string,
    segments = 12,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.geo(
        `cylinder:${rt}:${rb}:${h}:${segments}`,
        () => new THREE.CylinderGeometry(rt, rb, h, segments),
      ),
      this.mat(color),
    );
    mesh.position.set(at[0], at[1], at[2]);
    mesh.castShadow = h > 0.15;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private label(
    text: string,
    width: number,
    height: number,
    fontSize: number,
    color = C.ink,
    background = "",
    resolution = 256,
  ): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = resolution;
    canvas.height = Math.max(64, Math.round((resolution * height) / width));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = color;
    ctx.font = `800 ${fontSize}px "PingFang TC", "Noto Sans TC", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      text,
      canvas.width / 2,
      canvas.height / 2,
      canvas.width * 0.94,
    );
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.textures.add(texture);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.extraMaterials.add(material);
    return new THREE.Mesh(
      this.geo(
        `plane:${width}:${height}`,
        () => new THREE.PlaneGeometry(width, height),
      ),
      material,
    );
  }

  private groundLabel(
    parent: THREE.Object3D,
    text: string,
    x: number,
    z: number,
    width: number,
    height: number,
    color = C.ink,
    fontSize = 55,
  ): THREE.Mesh {
    const l = this.label(text, width, height, fontSize, color);
    l.rotation.x = -Math.PI / 2;
    l.position.set(x, 0.332, z);
    parent.add(l);
    return l;
  }

  private tileArtwork(
    id: number,
    type: string,
    name: string,
    color?: string,
  ): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 192;
    const context = canvas.getContext("2d")!;
    context.fillStyle = type === "bank" ? "#25b8ad" : "#fff1d4";
    context.fillRect(0, 0, 192, 192);
    context.strokeStyle = color || (type === "bank" ? "#f3cf71" : "#e4c99c");
    context.lineWidth = color ? 10 : 4;
    context.strokeRect(4, 4, 184, 184);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "800 35px system-ui";
    context.fillStyle = type === "bank" ? "#fff5cf" : "#654b31";
    context.fillText(String(id + 1).padStart(2, "0"), 96, 30);
    const palette: Record<string, string> = {
      property: color || "#ed7965",
      bank: "#f8d05f",
      event: "#edae37",
      park: "#7aaf52",
      station: "#6c9cb9",
      shop: "#e47f5b",
      construction: "#e9ac35",
      prison: "#89929e",
      police: "#7da5b9",
      tax: "#ac8ec4",
      amusement: "#df8da3",
      auction: "#c79d5c",
      start: "#579ec5",
    };
    const ink = palette[type] || "#c19b68";
    context.fillStyle = type === "bank" ? "#28a79e" : "#f9dfbd";
    context.beginPath();
    context.roundRect(47, 61, 98, 85, 12);
    context.fill();
    context.fillStyle = ink;
    if (type === "property") {
      context.beginPath();
      context.moveTo(53, 101);
      context.lineTo(96, 67);
      context.lineTo(139, 101);
      context.closePath();
      context.fill();
      context.fillRect(65, 99, 62, 42);
      context.fillStyle = "#fff4d5";
      context.fillRect(91, 114, 14, 27);
      context.fillRect(74, 107, 10, 12);
      context.fillRect(110, 107, 10, 12);
    } else if (type === "bank") {
      context.beginPath();
      context.arc(96, 105, 37, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#fff0ab";
      context.lineWidth = 4;
      context.beginPath();
      context.arc(96, 105, 29, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = "#9a672b";
      context.font = "900 42px system-ui";
      context.fillText("$", 96, 106);
    } else if (type === "park") {
      context.fillRect(90, 101, 12, 39);
      for (const [x, y, r] of [
        [78, 99, 20],
        [111, 99, 20],
        [96, 81, 22],
      ]) {
        context.beginPath();
        context.arc(x, y, r, 0, Math.PI * 2);
        context.fill();
      }
    } else {
      const symbols: Record<string, string> = {
        event: "?",
        station: "↔",
        shop: "▥",
        construction: "⚒",
        prison: "▦",
        police: "★",
        tax: "%",
        amusement: "✦",
        auction: "⚑",
        start: "GO",
      };
      context.font = `900 ${type === "start" ? 36 : 60}px system-ui`;
      context.fillText(symbols[type] || "◆", 96, 106);
    }
    context.fillStyle = type === "bank" ? "#fff4c9" : "#8a6b48";
    context.font = '700 21px "PingFang TC",system-ui';
    context.fillText(
      type === "bank" ? `BANK B${BANKS.indexOf(id) + 1}` : name.slice(0, 5),
      96,
      165,
      165,
    );
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.textures.add(texture);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
    });
    this.extraMaterials.add(material);
    const mesh = new THREE.Mesh(
      this.geo("tile-art", () => new THREE.PlaneGeometry(1.12, 1.12)),
      material,
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.327;
    return mesh;
  }

  private buildBase(): void {
    const base = new THREE.Group();
    this.scene.add(base);
    this.box(base, [18.2, 0.48, 18.2], [0, -0.29, 0], "#cad7c8", true);
    this.box(base, [18.05, 0.2, 18.05], [0, 0, 0], C.cream, true);
    this.box(base, [14.15, 0.16, 14.15], [0, 0.14, 0], "#c9dfbd", true);
    // Toy board feet and soft floor support the floating diorama.
    for (const x of [-7.3, 7.3])
      for (const z of [-7.3, 7.3])
        this.cylinder(base, 0.5, 0.45, 0.24, [x, -0.6, z], "#b8c4b2");
    const ground = this.box(base, [200, 0.1, 200], [0, -0.78, 0], "#7bcfe5");
    ground.castShadow = false;
    // Slim brass registration details make it feel like a physical board game.
    for (const x of [-8.67, 8.67])
      for (const z of [-8.67, 8.67])
        this.cylinder(base, 0.09, 0.09, 0.03, [x, 0.116, z], C.gold);
    this.compactGroup(base);
  }

  private buildTile(id: number): void {
    const group = new THREE.Group();
    group.position.copy(cityTilePosition(id));
    this.scene.add(group);
    const color = BANKS.includes(id)
      ? "#f8dc8d"
      : id === 0
        ? "#9dd6c4"
        : [C.peach, C.blue, C.aqua, C.purple, C.yellow, "#d9c4a5"][
            Math.floor(id / 8)
          ];
    const surface = this.box(
      group,
      [1.21, 0.17, 1.21],
      [0, 0.23, 0],
      color,
      true,
    );
    // A private material allows a single property to highlight without recoloring its neighbors.
    surface.material = this.mat(color).clone();
    this.extraMaterials.add(surface.material);
    surface.userData.tileId = id;
    this.clickTargets.push(surface);
    const label = this.groundLabel(
      group,
      BANKS.includes(id)
        ? `B${BANKS.indexOf(id) + 1}`
        : String(id + 1).padStart(2, "0"),
      0,
      0.25,
      0.85,
      0.4,
      C.ink,
      72,
    );
    const decor = new THREE.Group();
    const inward = group.position.clone().normalize().multiplyScalar(-1);
    // Perimeter props occupy a separate inner strip; the track remains clear for pawns.
    if (Math.abs(group.position.z) === EDGE)
      decor.position.set(0, 0.23, -Math.sign(group.position.z) * 1.05);
    else decor.position.set(-Math.sign(group.position.x) * 1.05, 0.23, 0);
    if (id === 0 || id === 12 || id === 24 || id === 36)
      decor.position.copy(inward.multiplyScalar(1.24)).setY(0.23);
    group.add(decor);
    this.tileVisuals.push({ group, surface, label, decor, signature: "" });
  }

  private tree(
    parent: THREE.Object3D,
    x: number,
    z: number,
    height = 0.9,
    color = C.green,
  ): void {
    const group = new THREE.Group();
    group.position.set(x, 0.24, z);
    parent.add(group);
    this.cylinder(
      group,
      0.045,
      0.06,
      height * 0.6,
      [0, height * 0.3, 0],
      "#bd9569",
      6,
    );
    this.sphere(
      group,
      height * 0.31,
      [0, height * 0.73, 0],
      color,
      [1, 1.18, 1],
    );
    this.sphere(group, height * 0.22, [height * 0.16, height * 0.92, 0], color);
  }

  private house(
    parent: THREE.Object3D,
    theme: string,
    level: number,
    color: string,
    decorative = false,
  ): void {
    const levels = Math.max(1, Math.min(3, level));
    const base = decorative ? 0 : 0.04;
    this.box(
      parent,
      [0.83, 0.08, 0.78],
      [0, base, 0],
      decorative ? "#f5ecdc" : color,
      true,
    );
    if (level === 0 && !decorative) {
      this.box(parent, [0.68, 0.035, 0.61], [0, 0.1, 0], "#e7d8b6", true);
      for (const x of [-0.3, 0.3])
        this.cylinder(parent, 0.025, 0.025, 0.23, [x, 0.22, 0.24], color, 12);
      this.box(parent, [0.63, 0.1, 0.035], [0, 0.27, 0.24], color, true);
      this.box(parent, [0.3, 0.18, 0.045], [0, 0.27, 0.26], "#fff6df", true);
      return;
    }
    // Rounded, fully furnished street houses. All themes share usable entrances,
    // balconies and planting, while their roofs and extensions retain identity.
    const cream = "#fff2dc",
      wood = "#a57550",
      glass = "#6499ae";
    const wall =
      theme === "forest"
        ? "#dfbc8e"
        : theme === "space"
          ? "#d7e9ee"
          : theme === "harbor"
            ? "#c3dedb"
            : "#f7d4c6";
    const accent =
      theme === "forest"
        ? "#70a985"
        : theme === "space"
          ? "#70b9d3"
          : theme === "harbor"
            ? "#518da8"
            : "#ed93ac";
    const floors = levels + 1,
      floorH = 0.34,
      ground = 0.16;
    const top = ground + floors * floorH;
    const box = (size: number[], at: number[], c: string) =>
      this.box(parent, size, at, c, true);
    const ball = (r: number, at: number[], c: string, scale?: number[]) => {
      const mesh = this.sphere(parent, r, at, c, scale);
      if (r >= 0.07)
        mesh.geometry = this.geo(
          `house-dome:${r}`,
          () => new THREE.SphereGeometry(r, 32, 24),
        );
      return mesh;
    };
    const post = (x: number, y: number, z: number, h: number, c = cream) =>
      this.cylinder(parent, 0.012, 0.012, h, [x, y, z], c, 12);
    const flowers = (x: number, y: number, z: number, width = 0.15) => {
      box(
        [width, 0.065, 0.095],
        [x, y, z],
        theme === "space" ? cream : "#cc8a70",
      );
      for (const dx of [-width * 0.29, 0, width * 0.29]) {
        ball(0.035, [x + dx, y + 0.05, z], "#6caa72", [1, 0.8, 1]);
        ball(
          0.022,
          [x + dx, y + 0.077, z + 0.014],
          dx === 0 ? "#ffe1a0" : "#ee91a9",
        );
      }
    };
    const window = (
      x: number,
      y: number,
      z: number,
      width = 0.14,
      height = 0.19,
    ) => {
      box([width + 0.035, height + 0.035, 0.038], [x, y, z], cream);
      box([width, height, 0.018], [x, y, z + 0.026], glass);
      box([0.012, height, 0.018], [x, y, z + 0.04], cream);
      box([width, 0.012, 0.018], [x, y + 0.012, z + 0.04], cream);
      box(
        [width + 0.05, 0.025, 0.075],
        [x, y - height / 2 - 0.015, z + 0.02],
        cream,
      );
    };
    const balcony = (y: number, width: number) => {
      box([width, 0.045, 0.2], [0, y, 0.345], cream);
      for (const x of [-width / 2 + 0.02, width / 2 - 0.02])
        box([0.035, 0.15, 0.19], [x, y + 0.09, 0.345], accent);
      box([width, 0.025, 0.025], [0, y + 0.17, 0.435], accent);
      for (let x = -width / 2 + 0.06; x < width / 2 - 0.03; x += 0.075)
        post(x, y + 0.095, 0.435, 0.14);
      for (const x of [-width * 0.3, width * 0.3])
        flowers(x, y + 0.18, 0.44, 0.13);
      for (const x of [-width * 0.32, width * 0.32])
        ball(0.035, [x, y - 0.05, 0.31], cream, [1, 1.8, 1]);
    };
    // Raised doorstep, layered cornices and corner pilasters give every level depth.
    box([0.69, top - ground, 0.57], [0, (top + ground) / 2, 0], wall);
    for (let f = 0; f <= floors; f++)
      box([0.74, 0.045, 0.62], [0, ground + f * floorH, 0], cream);
    for (const x of [-0.325, 0.325])
      box([0.045, top - ground, 0.045], [x, (top + ground) / 2, 0.3], cream);
    box([0.3, 0.045, 0.16], [0, 0.12, 0.35], cream);
    box([0.36, 0.035, 0.12], [0, 0.085, 0.41], "#d7c6ac");
    box([0.22, 0.29, 0.055], [0, 0.305, 0.3], cream);
    box(
      [0.16, 0.25, 0.035],
      [0, 0.3, 0.335],
      theme === "forest" ? wood : accent,
    );
    box([0.105, 0.1, 0.015], [0, 0.36, 0.36], glass);
    ball(0.015, [0.055, 0.27, 0.363], "#e8bb63");
    for (const x of [-0.245, 0.245]) {
      window(x, 0.335, 0.3, 0.105, 0.15);
      flowers(x, 0.185, 0.36, 0.14);
    }
    // Stripe awning with soft scallops, supported above the entrance.
    for (let i = 0; i < 7; i++) {
      const x = (i - 3) * 0.06;
      const canopy = box(
        [0.063, 0.04, 0.2],
        [x, 0.49, 0.375],
        i % 2 ? cream : accent,
      );
      canopy.rotation.x = 0.14;
      ball(0.033, [x, 0.46, 0.465], i % 2 ? cream : accent, [1, 0.85, 0.55]);
    }
    for (const x of [-0.2, 0.2]) post(x, 0.43, 0.42, 0.1, wood);
    for (let f = 1; f < floors; f++) {
      const y = ground + f * floorH;
      window(0, y + 0.15, 0.3, 0.16, 0.23);
      for (const x of [-0.235, 0.235]) window(x, y + 0.16, 0.3, 0.105, 0.17);
      balcony(y + 0.01, levels === 1 ? 0.44 : 0.64);
    }
    // Side windows, shutters and garden pots are visible when orbiting the board.
    for (const side of [-1, 1]) {
      for (let f = 0; f < floors; f++)
        for (const z of [-0.14, 0.12]) {
          box(
            [0.035, 0.2, 0.14],
            [side * 0.355, ground + f * floorH + 0.17, z],
            cream,
          );
          box(
            [0.018, 0.16, 0.105],
            [side * 0.377, ground + f * floorH + 0.17, z],
            glass,
          );
          box(
            [0.022, 0.18, 0.035],
            [side * 0.38, ground + f * floorH + 0.17, z - 0.09],
            accent,
          );
        }
      flowers(side * 0.31, 0.11, -0.3, 0.16);
    }
    box([0.8, 0.075, 0.69], [0, top + 0.025, 0], accent);
    if (theme === "candy") {
      box([0.71, 0.09, 0.59], [0, top + 0.1, 0], cream);
      for (let i = 0; i < 7; i++)
        ball(0.049, [(i - 3) * 0.1, top + 0.08, 0.3], cream, [1, 1.3, 0.7]);
      ball(0.17, [0, top + 0.17, 0], cream, [1.5, 0.7, 1.2]);
      ball(0.055, [0, top + 0.3, 0], "#e86979");
      if (levels >= 2)
        for (const x of [-0.25, 0.25]) {
          this.cylinder(
            parent,
            0.055,
            0.065,
            0.17,
            [x, top + 0.19, -0.16],
            accent,
            24,
          );
          ball(0.075, [x, top + 0.3, -0.16], cream);
        }
      if (levels === 3)
        for (const x of [-0.3, 0.3]) {
          this.cylinder(
            parent,
            0.08,
            0.09,
            0.37,
            [x, top + 0.19, -0.21],
            wall,
            24,
          );
          ball(0.105, [x, top + 0.4, -0.21], accent, [1, 1.4, 1]);
          ball(0.024, [x, top + 0.55, -0.21], "#e9bb62");
        }
    } else if (theme === "space") {
      ball(0.27, [0, top + 0.07, 0], "#8bc7db", [1, 0.65, 1]);
      this.cylinder(parent, 0.29, 0.3, 0.045, [0, top + 0.08, 0], cream, 32);
      for (const x of [-0.24, 0, 0.24])
        ball(0.025, [x, top + 0.05, 0.35], "#f6d786");
      if (levels >= 2) {
        post(0, top + 0.35, 0, 0.25, accent);
        ball(0.055, [0, top + 0.49, 0], "#e9bb62");
      }
      if (levels === 3)
        for (const x of [-0.3, 0.3]) {
          this.cylinder(
            parent,
            0.065,
            0.08,
            0.26,
            [x, top + 0.17, -0.18],
            cream,
            24,
          );
          ball(0.08, [x, top + 0.32, -0.18], accent, [1, 1.3, 1]);
          ball(0.028, [x, top + 0.18, -0.1], glass);
        }
    } else if (theme === "forest") {
      // Overlapping soft leaf roofs, wood rafters and a rooftop treehouse.
      for (let i = 0; i < 3; i++)
        ball(
          0.32 - i * 0.065,
          [0, top + 0.07 + i * 0.1, 0],
          i % 2 ? "#80b894" : accent,
          [1.25, 0.45, 1.1],
        );
      for (const x of [-0.3, 0.3])
        box([0.045, top - ground, 0.05], [x, (top + ground) / 2, 0.31], wood);
      if (levels >= 2) {
        box([0.055, 0.32, 0.055], [-0.25, top + 0.14, -0.19], wood);
        ball(0.12, [-0.25, top + 0.33, -0.19], "#78ac83");
        ball(0.08, [-0.32, top + 0.29, -0.17], "#98c99a");
      }
      if (levels === 3) {
        box([0.24, 0.24, 0.23], [0.19, top + 0.29, -0.15], wall);
        ball(0.19, [0.19, top + 0.44, -0.15], accent, [1, 0.6, 1]);
        box([0.07, 0.1, 0.025], [0.19, top + 0.29, -0.02], glass);
      }
    } else {
      // Rounded tiled gable, nautical stripes and a recognisable lighthouse.
      for (const side of [-1, 1]) {
        const roof = box(
          [0.47, 0.075, 0.7],
          [side * 0.18, top + 0.15, 0],
          accent,
        );
        roof.rotation.z = side * -0.48;
        for (let i = 0; i < 5; i++) {
          const tile = box(
            [0.45, 0.018, 0.018],
            [side * 0.18, top + 0.19, (i - 2) * 0.13],
            "#74a7bb",
          );
          tile.rotation.z = side * -0.48;
        }
      }
      ball(0.045, [0, top + 0.25, 0.33], cream);
      if (levels >= 2)
        for (const x of [-0.36, 0.36]) {
          this.cylinder(parent, 0.025, 0.03, 0.16, [x, 0.15, 0.34], wood, 16);
          ball(0.035, [x, 0.24, 0.34], cream);
        }
      if (levels === 3) {
        this.cylinder(
          parent,
          0.085,
          0.12,
          0.37,
          [0.23, top + 0.26, -0.18],
          cream,
          24,
        );
        this.cylinder(
          parent,
          0.1,
          0.1,
          0.065,
          [0.23, top + 0.3, -0.18],
          accent,
          24,
        );
        this.cylinder(
          parent,
          0.14,
          0.14,
          0.04,
          [0.23, top + 0.46, -0.18],
          accent,
          24,
        );
        this.cylinder(
          parent,
          0.08,
          0.08,
          0.13,
          [0.23, top + 0.54, -0.18],
          "#ffda85",
          24,
        );
        ball(0.12, [0.23, top + 0.63, -0.18], accent, [1, 0.55, 1]);
      }
    }
    // Owner plaque without obscuring the architecture.
    if (!decorative) box([0.16, 0.06, 0.025], [0, 0.12, 0.46], color);
  }

  private bank(parent: THREE.Object3D, number: number): void {
    const template = this.landmarkTemplates.get("bank");
    if (template) {
      const model = this.normalizedAsset(template, 1.03, 1.9, 0.9);
      const bounds = new THREE.Box3().setFromObject(model);
      model.scale.y *= 1.9 / Math.max(bounds.max.y - bounds.min.y, 0.01);
      parent.add(model);
      const sign = this.label(
        `B${number}`,
        0.38,
        0.25,
        130,
        "#fff0b7",
        "#178f87",
      );
      sign.position.set(0, 1.73, 0.47);
      parent.add(sign);
      return;
    }
    this.box(parent, [0.98, 0.1, 0.82], [0, 0.06, 0], "#eed19a", true);
    this.box(parent, [0.8, 1.12, 0.61], [0, 0.65, 0], "#26b5a6", true);
    this.box(parent, [0.91, 0.12, 0.73], [0, 1.24, 0], "#ffdc7e", true);
    this.box(parent, [0.84, 0.08, 0.67], [0, 0.25, 0], "#ffe5a5", true);
    this.box(parent, [0.24, 0.43, 0.045], [0, 0.46, 0.332], "#12857f", true);
    for (const x of [-0.28, 0.28]) {
      this.cylinder(parent, 0.05, 0.06, 0.67, [x, 0.62, 0.33], "#ffe9ac");
      this.box(parent, [0.13, 0.055, 0.13], [x, 0.98, 0.33], "#fff1c1");
    }
    this.sphere(parent, 0.34, [0, 1.34, 0], "#20a798", [1, 0.7, 1]);
    this.cylinder(parent, 0.018, 0.018, 0.28, [0, 1.67, 0], "#e8ba57");
    const coin = this.cylinder(
      parent,
      0.25,
      0.25,
      0.08,
      [0, 1.82, 0],
      "#f6c653",
      24,
    );
    coin.rotation.x = Math.PI / 2;
    const dollar = this.label("$", 0.31, 0.34, 150, "#fff1b4");
    dollar.position.set(0, 1.82, 0.05);
    parent.add(dollar);
    const sign = this.label(`B${number}`, 0.48, 0.32, 125, "#fff2c8");
    sign.position.set(0, 1.08, 0.384);
    parent.add(sign);
  }

  private facility(parent: THREE.Object3D, type: string, id: number): void {
    if (type === "bank") {
      this.bank(parent, Math.max(1, BANKS.indexOf(id) + 1));
      return;
    }
    if (type === "property") {
      this.box(parent, [0.72, 0.07, 0.65], [0, 0.02, 0], "#bdd6ac", true);
      this.cylinder(parent, 0.018, 0.018, 0.39, [0, 0.22, 0], "#ac956d", 5);
      this.box(parent, [0.38, 0.23, 0.04], [0, 0.44, 0], "#fff9e7", true);
      this.sphere(parent, 0.09, [-0.24, 0.12, 0.17], C.green);
      return;
    }
    if (type === "park") {
      this.tree(parent, -0.14, 0, 0.75);
      this.box(parent, [0.4, 0.08, 0.15], [0.13, 0.2, 0.25], "#b79573");
      return;
    }
    if (type === "event" || type === "chance" || type === "fortune") {
      this.box(parent, [0.52, 0.5, 0.52], [0, 0.32, 0], C.peach, true);
      this.box(parent, [0.57, 0.1, 0.57], [0, 0.61, 0], C.red, true);
      this.box(parent, [0.12, 0.57, 0.55], [0, 0.34, 0], C.yellow);
      this.sphere(parent, 0.12, [-0.09, 0.73, 0], C.yellow, [1, 0.7, 0.6]);
      this.sphere(parent, 0.12, [0.09, 0.73, 0], C.yellow, [1, 0.7, 0.6]);
      return;
    }
    if (type === "jail" || type === "prison") {
      this.box(parent, [0.81, 0.63, 0.57], [0, 0.36, 0], "#adb9bc", true);
      this.box(parent, [0.88, 0.12, 0.66], [0, 0.74, 0], "#718591", true);
      this.box(parent, [0.51, 0.31, 0.03], [0, 0.4, 0.3], "#576d77");
      for (const x of [-0.19, -0.065, 0.065, 0.19])
        this.box(parent, [0.03, 0.33, 0.04], [x, 0.4, 0.33], C.white);
      return;
    }
    if (type === "station" || type === "train") {
      this.box(parent, [0.9, 0.08, 0.7], [0, 0.07, 0], C.cream);
      for (const x of [-0.35, 0.35])
        this.box(parent, [0.05, 0.59, 0.05], [x, 0.4, 0.23], C.dark);
      this.box(parent, [0.94, 0.13, 0.76], [0, 0.75, 0], C.blue, true);
      this.box(parent, [0.56, 0.29, 0.25], [0, 0.3, -0.05], C.red, true);
      for (const x of [-0.16, 0.05, 0.24])
        this.box(parent, [0.12, 0.1, 0.025], [x, 0.34, 0.085], C.white);
      return;
    }
    if (type === "start") {
      this.cylinder(parent, 0.46, 0.46, 0.12, [0, 0.07, 0], C.white);
      this.cylinder(parent, 0.035, 0.035, 0.9, [0, 0.52, 0], C.dark, 8);
      this.box(parent, [0.43, 0.3, 0.035], [0.2, 0.85, 0], C.red);
      return;
    }
    if (type === "construction") {
      this.box(parent, [0.09, 1.25, 0.09], [-0.23, 0.65, 0], C.gold);
      this.box(parent, [0.92, 0.08, 0.08], [0.03, 1.2, 0], C.gold);
      this.box(parent, [0.015, 0.43, 0.015], [0.4, 0.96, 0], C.dark);
      this.box(parent, [0.31, 0.25, 0.27], [0.1, 0.2, 0.15], C.peach);
      return;
    }
    if (type === "amusement") {
      this.cylinder(parent, 0.42, 0.42, 0.08, [0, 0.09, 0], C.peach);
      this.cylinder(parent, 0.04, 0.04, 0.7, [0, 0.44, 0], C.gold);
      this.cylinder(parent, 0, 0.47, 0.35, [0, 0.92, 0], C.red, 8);
      for (const x of [-0.25, 0.25])
        this.sphere(parent, 0.12, [x, 0.38, 0], C.yellow, [1, 1, 0.7]);
      return;
    }
    const color =
      type === "police"
        ? C.blue
        : type === "tax"
          ? C.purple
          : type === "shop"
            ? C.red
            : C.yellow;
    this.box(parent, [0.71, 0.57, 0.56], [0, 0.34, 0], C.cream, true);
    this.box(parent, [0.8, 0.13, 0.65], [0, 0.68, 0], color, true);
    this.box(parent, [0.17, 0.28, 0.04], [0, 0.22, 0.3], "#77929c", true);
    for (const x of [-0.23, 0.23])
      this.box(parent, [0.14, 0.17, 0.035], [x, 0.39, 0.3], C.blue);
    if (type === "police") {
      this.sphere(parent, 0.08, [-0.1, 0.82, 0], C.red);
      this.sphere(parent, 0.08, [0.1, 0.82, 0], C.blue);
    }
    if (type === "shop")
      for (let i = 0; i < 5; i++)
        this.box(
          parent,
          [0.15, 0.08, 0.2],
          [(i - 2) * 0.15, 0.51, 0.36],
          i % 2 ? C.white : color,
        );
  }

  private pitchedRoof(
    parent: THREE.Object3D,
    width: number,
    depth: number,
    height: number,
    y: number,
    color: string,
  ): void {
    const geometry = this.geo(`roof:${width}:${depth}:${height}`, () => {
      const shape = new THREE.Shape();
      shape.moveTo(-width / 2, 0);
      shape.lineTo(width / 2, 0);
      shape.lineTo(0, height);
      shape.closePath();
      return new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.015,
        bevelThickness: 0.015,
      }).translate(0, 0, -depth / 2);
    });
    const roof = new THREE.Mesh(geometry, this.mat(color));
    roof.position.y = y;
    roof.castShadow = true;
    parent.add(roof);
    this.box(
      parent,
      [width + 0.08, 0.075, depth + 0.08],
      [0, y, 0],
      C.cream,
      true,
    );
    this.box(
      parent,
      [0.07, 0.07, depth + 0.06],
      [0, y + height, 0],
      color,
      true,
    );
    for (let i = 1; i < 9; i++) {
      const x = (i / 9 - 0.5) * width;
      this.box(
        parent,
        [0.025, 0.025, depth + 0.025],
        [x, y + height * (1 - Math.abs(x) / (width / 2)) + 0.015, 0],
        color,
      );
    }
  }

  private townhouse(
    parent: THREE.Object3D,
    x: number,
    z: number,
    floors: number,
    facade: string,
    roofColor: string,
    width = 1.08,
    rotation = 0,
  ): void {
    const g = new THREE.Group();
    g.position.set(x, 0.29, z);
    g.rotation.y = rotation;
    parent.add(g);
    const height = floors * 0.49 + 0.21;
    this.contactShadow(parent, x, z, width * 1.8, 1.65);
    const template = this.landmarkTemplates.get("townhouse");
    if (template && this.townhouseSerial++ % 3 === 1) {
      // Imported ornate houses are deeper than procedural facades; fit them to
      // their street frontage first, then give the roof a matching skyline height.
      const model = this.normalizedAsset(
        template,
        width + 0.22,
        height + 0.7,
        1.6,
      );
      const bounds = new THREE.Box3().setFromObject(model);
      const fittedHeight = bounds.max.y - bounds.min.y;
      model.scale.y *= (height + 0.72) / Math.max(fittedHeight, 0.01);
      g.add(model);
      return;
    }
    this.box(g, [width + 0.18, 0.12, 1.1], [0, 0.06, 0], "#f6e1bd", true);
    this.box(g, [width, height, 0.92], [0, height / 2 + 0.12, 0], facade, true);
    for (const side of [-1, 1])
      this.box(
        g,
        [0.075, height, 0.99],
        [side * (width / 2 - 0.04), height / 2 + 0.12, 0],
        "#ffedcf",
      );
    for (let floor = 0; floor < floors; floor++) {
      const y = 0.36 + floor * 0.49;
      this.box(g, [width + 0.08, 0.065, 1.0], [0, y + 0.26, 0], "#ffedcf");
      for (const wx of [-width * 0.29, width * 0.29]) {
        this.box(g, [0.29, 0.33, 0.065], [wx, y, 0.495], "#fff6dc", true);
        this.box(
          g,
          [0.205, 0.245, 0.025],
          [wx, y + 0.005, 0.536],
          "#4e98b8",
          true,
        );
        this.box(g, [0.025, 0.26, 0.028], [wx, y + 0.005, 0.553], "#ffedcf");
        this.box(g, [0.23, 0.025, 0.028], [wx, y, 0.554], "#ffedcf");
        if (floor > 0) {
          this.box(
            g,
            [0.37, 0.055, 0.21],
            [wx, y - 0.19, 0.56],
            "#f6dfb3",
            true,
          );
          this.box(g, [0.36, 0.035, 0.035], [wx, y - 0.04, 0.66], "#8098a0");
          for (const dx of [-0.14, 0, 0.14])
            this.box(
              g,
              [0.024, 0.15, 0.025],
              [wx + dx, y - 0.11, 0.66],
              "#8098a0",
            );
          this.box(
            g,
            [0.22, 0.06, 0.11],
            [wx, y - 0.17, 0.59],
            "#81b554",
            true,
          );
          for (const dx of [-0.065, 0.065])
            this.sphere(g, 0.045, [wx + dx, y - 0.105, 0.61], "#f68e9b");
        }
      }
      for (const side of [-1, 1])
        for (const wz of [-0.25, 0.22]) {
          this.box(
            g,
            [0.055, 0.3, 0.24],
            [side * (width / 2 + 0.01), y, wz],
            "#fff0d3",
            true,
          );
          this.box(
            g,
            [0.065, 0.22, 0.16],
            [side * (width / 2 + 0.025), y, wz],
            "#5798ac",
            true,
          );
        }
    }
    this.box(g, [0.28, 0.43, 0.05], [0, 0.31, 0.514], "#b97745", true);
    this.box(g, [0.2, 0.32, 0.035], [0, 0.32, 0.55], "#8a5c3d", true);
    this.sphere(g, 0.022, [0.055, 0.3, 0.575], C.gold);
    for (let i = 0; i < 6; i++) {
      const awning = this.box(
        g,
        [width / 6 + 0.006, 0.055, 0.29],
        [((i - 2.5) * width) / 6, 0.68, 0.59],
        i % 2 ? "#fff3d7" : roofColor,
      );
      awning.rotation.x = 0.18;
    }
    this.pitchedRoof(g, width + 0.16, 1.12, 0.45, height + 0.17, roofColor);
    this.box(g, [0.25, 0.27, 0.28], [0, height + 0.28, 0.37], "#fff1d0", true);
    this.box(
      g,
      [0.13, 0.16, 0.035],
      [0, height + 0.27, 0.525],
      "#5f9eb5",
      true,
    );
    this.box(
      g,
      [0.17, 0.4, 0.17],
      [-width * 0.28, height + 0.43, -0.25],
      "#c57e56",
    );
    this.box(
      g,
      [0.22, 0.055, 0.21],
      [-width * 0.28, height + 0.64, -0.25],
      "#f5d7ac",
    );
  }

  private lushTree(
    parent: THREE.Object3D,
    x: number,
    z: number,
    height = 1.05,
    variant = 0,
  ): void {
    const g = new THREE.Group();
    g.position.set(x, 0.26, z);
    parent.add(g);
    this.contactShadow(parent, x, z, height * 1.2, height * 1.1);
    this.cylinder(
      g,
      0.055,
      0.08,
      height * 0.65,
      [0, height * 0.31, 0],
      "#bb8a4a",
      7,
    );
    const leaves = ["#74ae41", "#8abb47", "#4f9e55", "#6dac68"];
    this.sphere(
      g,
      height * 0.28,
      [0, height * 0.75, 0],
      leaves[variant % 4],
      [1, 1.25, 1],
    );
    for (let i = 0; i < 5; i++) {
      const a = i * 1.256;
      this.sphere(
        g,
        height * 0.2,
        [
          Math.cos(a) * height * 0.17,
          height * (0.57 + (i % 2) * 0.14),
          Math.sin(a) * height * 0.17,
        ],
        leaves[(variant + (i % 2)) % 4],
      );
    }
    this.sphere(
      g,
      height * 0.16,
      [0, height * 1.01, 0],
      leaves[(variant + 1) % 4],
    );
  }

  private lamp(parent: THREE.Object3D, x: number, z: number): void {
    this.cylinder(parent, 0.045, 0.075, 0.11, [x, 0.3, z], "#527b91");
    this.cylinder(parent, 0.022, 0.027, 0.78, [x, 0.72, z], "#527b91", 7);
    this.box(parent, [0.16, 0.2, 0.16], [x, 1.16, z], "#ffe5a0", true);
    this.cylinder(
      parent,
      0,
      0.14,
      0.11,
      [x, 1.31, z],
      "#527b91",
      4,
    ).rotation.y = Math.PI / 4;
    this.box(parent, [0.19, 0.035, 0.19], [x, 1.04, z], "#527b91");
  }

  private plazaSign(
    parent: THREE.Object3D,
    text: string,
    x: number,
    z: number,
    width = 1.25,
  ): void {
    for (const dx of [-width * 0.35, width * 0.35])
      this.box(parent, [0.045, 0.4, 0.045], [x + dx, 0.55, z], "#af7848");
    this.box(parent, [width, 0.37, 0.1], [x, 0.87, z], "#bf8c51", true);
    this.box(
      parent,
      [width - 0.08, 0.29, 0.025],
      [x, 0.87, z + 0.065],
      "#ffedc8",
      true,
    );
    const textMesh = this.label(text, width - 0.15, 0.22, 43, "#815130");
    textMesh.position.set(x, 0.87, z + 0.084);
    parent.add(textMesh);
  }

  private buildCity(): void {
    const center = new THREE.Group();
    this.scene.add(center);
    this.cityCenter = center;
    this.townhouseSerial = 0;
    this.box(center, [13.9, 0.07, 13.9], [0, 0.23, 0], "#9bc465", true);
    // Busy, walkable city blocks around a real circular civic plaza.
    for (const x of [-2.1, 2.05])
      this.box(center, [0.77, 0.035, 12.2], [x, 0.285, 0], "#899d9d", true);
    for (const z of [-3.05, 2.75])
      this.box(center, [12.2, 0.035, 0.78], [0, 0.285, z], "#899d9d", true);
    for (const x of [-2.1, 2.05])
      for (let z = -5.7; z < 5.8; z += 0.58)
        this.box(center, [0.035, 0.008, 0.2], [x, 0.312, z], "#fff0c2");
    for (const z of [-3.05, 2.75])
      for (let x = -5.7; x < 5.8; x += 0.58)
        this.box(center, [0.2, 0.008, 0.035], [x, 0.312, z], "#fff0c2");
    for (const x of [-2.1, 2.05])
      for (const z of [-3.05, 2.75])
        for (let i = 0; i < 5; i++)
          this.box(
            center,
            [0.44, 0.008, 0.075],
            [x - 0.66, 0.315, z + (i - 2) * 0.14],
            C.white,
          );

    // Dense European toy-town silhouettes with balconies, shop awnings and dormers.
    const homes: [number, number, number, string, string, number?][] = [
      [-5.25, -4.75, 2, "#f5d899", "#4284b5"],
      [-3.85, -4.75, 3, "#edbe72", "#e77943"],
      [-0.85, -4.8, 2, "#f2ca8e", "#d74e43"],
      [0.6, -4.85, 3, "#f0d39d", "#3f8db2"],
      [-5.25, -1.9, 3, "#f4d7a6", "#d86b45"],
      [-3.85, -1.85, 4, "#e7bd73", "#4a9c94"],
      [-5.1, 3.85, 2, "#f5d8aa", "#d56e3d"],
      [-3.7, 4.5, 3, "#edc583", "#4783b6"],
      [-0.85, 5.0, 2, "#f4d9a3", "#e77a43"],
      [0.65, 5.0, 3, "#edcf8d", "#4d99a3"],
      [5.15, -4.75, 2, "#f6d8a4", "#ce7152"],
      [5.45, 0.8, 3, "#edc384", "#4699b0"],
    ];
    for (const [x, z, floors, facade, roof, width] of homes)
      this.townhouse(center, x, z, floors, facade, roof, width || 1.08);
    // A slender corner clock tower adds a strong middle-distance landmark.
    this.townhouse(center, -0.45, -1.65, 4, "#eac689", "#4c88b6", 0.9);
    this.cylinder(
      center,
      0.31,
      0.31,
      0.055,
      [-0.45, 2.61, -1.115],
      "#fff1c9",
      24,
    ).rotation.x = Math.PI / 2;
    this.box(center, [0.025, 0.19, 0.025], [-0.45, 2.65, -1.075], "#7b6349");
    this.box(center, [0.13, 0.025, 0.025], [-0.4, 2.61, -1.075], "#7b6349");

    // Central turquoise fountain and gold bear statue, surrounded by paving rings.
    this.cylinder(center, 2.05, 2.05, 0.07, [-0.25, 0.31, 0.8], "#8c9c9c", 64);
    this.cylinder(center, 1.78, 1.78, 0.08, [-0.25, 0.36, 0.8], "#f9e6c2", 64);
    this.cylinder(center, 1.39, 1.45, 0.12, [-0.25, 0.44, 0.8], "#e4cf9e", 64);
    this.cylinder(center, 1.27, 1.3, 0.18, [-0.25, 0.56, 0.8], "#fff0c5", 64);
    this.cylinder(
      center,
      1.13,
      1.13,
      0.025,
      [-0.25, 0.663, 0.8],
      "#3bbfd5",
      64,
    );
    const ripple = new THREE.Mesh(
      this.geo(
        "fountain-ripple",
        () => new THREE.TorusGeometry(0.86, 0.018, 5, 48),
      ),
      this.mat("#b4f1ed"),
    );
    ripple.rotation.x = Math.PI / 2;
    ripple.position.set(-0.25, 0.687, 0.8);
    center.add(ripple);
    this.cylinder(center, 0.34, 0.44, 0.16, [-0.25, 0.74, 0.8], "#e1bd71", 24);
    this.cylinder(center, 0.18, 0.24, 0.43, [-0.25, 1.03, 0.8], "#f4cf76", 16);
    this.sphere(center, 0.2, [-0.25, 1.4, 0.8], "#e9b955", [1, 1.1, 0.8]);
    this.sphere(center, 0.23, [-0.25, 1.72, 0.8], "#edc16b");
    for (const dx of [-0.17, 0.17])
      this.sphere(center, 0.085, [-0.25 + dx, 1.9, 0.8], "#edc16b");
    for (const dx of [-0.24, 0.24])
      this.sphere(
        center,
        0.095,
        [-0.25 + dx, 1.45, 0.8],
        "#edc16b",
        [1, 0.7, 1],
      );
    for (const dx of [-0.075, 0.075])
      this.sphere(center, 0.02, [-0.25 + dx, 1.75, 1.015], "#957541");
    this.fountainJet = this.sphere(
      center,
      0.12,
      [-0.25, 1.02, 1.32],
      "#c0f9f4",
      [0.6, 2.4, 0.6],
    );
    this.fountainJet.castShadow = false;
    this.fountainJet.userData.dynamic = true;
    for (let i = 0; i < 14; i++) {
      const a = (i * Math.PI * 2) / 14;
      const x = -0.25 + Math.cos(a) * 1.58,
        z = 0.8 + Math.sin(a) * 1.58;
      this.box(
        center,
        [0.19, 0.015, 0.12],
        [x, 0.408, z],
        "#e4c994",
      ).rotation.y = -a;
      if (i % 3 === 0)
        this.lamp(center, -0.25 + Math.cos(a) * 1.92, 0.8 + Math.sin(a) * 1.92);
    }

    // Grand toy shop: red towers, cream facade, striped awnings, and a teddy sign.
    const shop = new THREE.Group();
    shop.position.set(-4.3, 0.29, 0.8);
    center.add(shop);
    this.box(shop, [2.6, 1.2, 1.35], [0, 0.68, 0], "#edbd74", true);
    this.box(shop, [2.7, 0.12, 1.48], [0, 1.33, 0], "#fff1cc", true);
    this.pitchedRoof(shop, 2.65, 1.5, 0.5, 1.38, "#377fae");
    for (const x of [-1.08, 1.08]) {
      this.box(shop, [0.39, 1.82, 1.47], [x, 0.97, 0], "#e6694d", true);
      this.sphere(shop, 0.24, [x, 1.87, 0], "#ed7751", [1, 1, 1]);
      this.box(shop, [0.19, 0.32, 0.055], [x, 1.29, 0.765], "#ffe5a0", true);
    }
    for (const x of [-0.7, 0, 0.7]) {
      this.box(shop, [0.5, 0.73, 0.04], [x, 0.5, 0.705], "#ffebc1", true);
      this.box(shop, [0.39, 0.61, 0.04], [x, 0.5, 0.739], "#71bed1", true);
      this.box(shop, [0.04, 0.63, 0.04], [x, 0.5, 0.765], "#fff5db");
    }
    for (let i = 0; i < 12; i++)
      this.box(
        shop,
        [0.18, 0.11, 0.42],
        [(i - 5.5) * 0.18, 1.0, 0.85],
        i % 2 ? "#fff3d8" : "#e55e43",
        true,
      ).rotation.x = 0.16;
    const shopLabel = this.label(
      "玩具百貨",
      1.7,
      0.34,
      46,
      "#9a542a",
      "#fff0cc",
    );
    shopLabel.position.set(0, 1.39, 0.82);
    shop.add(shopLabel);
    this.sphere(shop, 0.32, [0, 1.96, 0.67], "#d28c42", [1, 1, 0.55]);
    for (const x of [-0.23, 0.23])
      this.sphere(shop, 0.13, [x, 2.2, 0.67], "#d28c42");
    for (const x of [-0.105, 0.105])
      this.sphere(shop, 0.032, [x, 2, 0.84], "#4e442e");
    this.sphere(shop, 0.1, [0, 1.88, 0.85], "#f3d28b", [1.3, 0.8, 0.4]);

    // Botanical garden with a glass dome, lattice ribs, pond, lilies and a swan.
    const garden = new THREE.Group();
    garden.position.set(3.7, 0, -1.45);
    center.add(garden);
    this.box(garden, [3.05, 0.065, 3.2], [0, 0.31, 0], "#bad56e", true);
    const glass = new THREE.MeshStandardMaterial({
      color: "#9ee0d0",
      roughness: 0.22,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.extraMaterials.add(glass);
    const domeGeometry = this.geo(
      "greenhouse-dome",
      () =>
        new THREE.SphereGeometry(1.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    );
    const dome = new THREE.Mesh(domeGeometry, glass);
    dome.position.set(-0.15, 0.65, -0.45);
    dome.scale.y = 1.35;
    garden.add(dome);
    this.cylinder(
      garden,
      1.05,
      1.11,
      0.28,
      [-0.15, 0.49, -0.45],
      "#e9d6a5",
      32,
    );
    const meridian = this.geo(
      "greenhouse-rib",
      () => new THREE.TorusGeometry(1.057, 0.022, 5, 32, Math.PI),
    );
    for (let i = 0; i < 8; i++) {
      const rib = new THREE.Mesh(meridian, this.mat("#f9edd1"));
      rib.position.set(-0.15, 0.65, -0.45);
      rib.rotation.y = (i * Math.PI) / 8;
      rib.scale.y = 1.35;
      garden.add(rib);
    }
    for (const angle of [0.4, 0.8, 1.12]) {
      const radius = Math.cos(angle) * 1.06;
      const ring = new THREE.Mesh(
        this.geo(
          `greenhouse-lat:${angle}`,
          () => new THREE.TorusGeometry(radius, 0.02, 5, 40),
        ),
        this.mat("#f9edd1"),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(-0.15, 0.65 + Math.sin(angle) * 1.42, -0.45);
      garden.add(ring);
    }
    this.box(garden, [0.42, 0.67, 0.22], [-0.15, 0.66, 0.56], "#f2dfb1", true);
    this.box(garden, [0.28, 0.52, 0.24], [-0.15, 0.63, 0.59], "#73bfae", true);
    this.cylinder(
      garden,
      0.88,
      0.94,
      0.08,
      [0.3, 0.38, 1.01],
      "#e5cb93",
      32,
    ).scale.z = 0.62;
    this.cylinder(
      garden,
      0.8,
      0.8,
      0.025,
      [0.3, 0.434, 1.01],
      "#4cc1d5",
      32,
    ).scale.z = 0.6;
    this.sphere(garden, 0.14, [0.4, 0.52, 1.13], "#fff7df", [1.2, 0.55, 0.75]);
    this.cylinder(garden, 0.026, 0.04, 0.2, [0.5, 0.62, 1.13], "#fff7df");
    this.sphere(garden, 0.06, [0.5, 0.74, 1.13], C.white);
    for (const [x, z] of [
      [-0.7, -0.4],
      [0.35, -0.85],
      [0.5, 0],
    ])
      this.lushTree(garden, x, z, 0.62, 2);
    this.plazaSign(center, "植物公園", 3.55, 0.6, 1.4);
    this.buildFerrisWheel(center, 3.05, -4.7);

    // Bright crane and a visibly unfinished building inside a fenced site.
    const site = new THREE.Group();
    site.position.set(4.0, 0.29, 4.22);
    center.add(site);
    this.box(site, [2.95, 0.07, 2.85], [0, 0.02, 0], "#dbb77a", true);
    for (const x of [-1.4, 1.4])
      for (let z = -1.2; z <= 1.21; z += 0.3)
        this.box(site, [0.08, 0.55, 0.23], [x, 0.31, z], "#e5c690");
    for (let x = -1.25; x <= 1.26; x += 0.3)
      this.box(site, [0.23, 0.55, 0.08], [x, 0.31, 1.35], "#e5c690");
    for (const y of [0.12, 0.7, 1.28])
      this.box(site, [1.65, 0.1, 1.3], [0.25, y, -0.3], "#b8b5a2");
    for (const x of [-0.47, 0.97])
      for (const z of [-0.86, 0.26])
        this.box(site, [0.13, 1.47, 0.13], [x, 0.78, z], "#c9c4ae");
    for (const y of [0.4, 0.98])
      this.box(site, [0.66, 0.45, 0.13], [0.62, y, -0.87], "#e2c49d");
    for (const x of [-1.05, -0.8])
      this.box(site, [0.055, 3.05, 0.055], [x, 1.58, -0.1], "#e8b633");
    for (let y = 0.25; y <= 3.1; y += 0.25)
      this.box(site, [0.3, 0.045, 0.08], [-0.925, y, -0.1], "#e8b633");
    this.box(site, [2.75, 0.16, 0.17], [0.04, 3.1, -0.1], "#f4c446");
    for (let x = -1.2; x <= 1.4; x += 0.24)
      this.box(
        site,
        [0.035, 0.34, 0.035],
        [x, 3.23, -0.1],
        "#e8b633",
      ).rotation.z = 0.55;
    this.box(site, [0.4, 0.35, 0.37], [-0.85, 2.96, 0.04], "#e7b131", true);
    this.box(site, [0.25, 0.21, 0.025], [-0.85, 2.99, 0.238], "#5d91a5");
    this.cylinder(site, 0.014, 0.014, 1.18, [1.0, 2.46, -0.1], "#69796d", 5);
    this.box(site, [0.38, 0.29, 0.36], [1.0, 1.72, -0.1], "#dcb366", true);
    this.plazaSign(center, "建設特區", 4.0, 5.72, 1.5);

    // Elevated tram winds above the northern neighborhood.
    const trackPoints = [
      new THREE.Vector3(-5.9, 1.68, -3.1),
      new THREE.Vector3(-3.6, 1.78, -3.0),
      new THREE.Vector3(-0.9, 1.82, -3.1),
      new THREE.Vector3(1.4, 1.82, -4.25),
      new THREE.Vector3(3.2, 1.82, -5.35),
      new THREE.Vector3(5.35, 1.8, -4.1),
      new THREE.Vector3(5.65, 1.68, -2.6),
    ];
    this.tramCurve = new THREE.CatmullRomCurve3(trackPoints);
    const deck = new THREE.Mesh(
      this.geo(
        "tram-deck",
        () => new THREE.TubeGeometry(this.tramCurve!, 64, 0.17, 6, false),
      ),
      this.mat("#bb8e5a"),
    );
    center.add(deck);
    for (const dz of [-0.19, 0.19]) {
      const railCurve = new THREE.CatmullRomCurve3(
        trackPoints.map((p) => p.clone().add(new THREE.Vector3(0, 0.16, dz))),
      );
      const rail = new THREE.Mesh(
        this.geo(
          `tram-rail:${dz}`,
          () => new THREE.TubeGeometry(railCurve, 64, 0.025, 5, false),
        ),
        this.mat("#b4c1bf"),
      );
      center.add(rail);
    }
    for (let i = 0; i <= 10; i++) {
      const p = this.tramCurve.getPoint(i / 10);
      this.box(
        center,
        [0.18, p.y - 0.24, 0.18],
        [p.x, (p.y + 0.24) / 2, p.z],
        "#d0b789",
      );
      for (const dz of [-0.3, 0.3])
        this.box(
          center,
          [0.035, 0.36, 0.035],
          [p.x, p.y + 0.22, p.z + dz],
          "#d9bb8d",
        );
    }
    this.tram.userData.dynamic = true;
    center.add(this.tram);
    for (const x of [-0.43, 0.43]) {
      this.box(this.tram, [0.81, 0.4, 0.47], [x, 0.31, 0], "#e46d43", true);
      this.box(this.tram, [0.85, 0.08, 0.51], [x, 0.56, 0], "#fff0ce", true);
      for (const dx of [-0.24, 0, 0.24])
        for (const side of [-1, 1])
          this.box(
            this.tram,
            [0.18, 0.2, 0.025],
            [x + dx, 0.36, side * 0.25],
            "#8ac4d6",
            true,
          );
      for (const dx of [-0.24, 0.24])
        for (const side of [-1, 1])
          this.cylinder(
            this.tram,
            0.085,
            0.085,
            0.05,
            [x + dx, 0.065, side * 0.23],
            "#52636a",
          ).rotation.x = Math.PI / 2;
    }
    this.tram.position.copy(this.tramCurve.getPoint(0.35));
    this.compactGroup(this.tram);

    // Many low bushes, flowerbeds and lanterns connect the buildings into a city.
    const treeSpots = [
      [-6.1, -5.7],
      [-4.6, -5.7],
      [-3, -5.8],
      [-1.7, -5.8],
      [1.7, -5.8],
      [3.1, -5.8],
      [4.2, -4.8],
      [-6.1, -3.6],
      [-3.1, -3.5],
      [-1.3, -3.4],
      [-6.1, -0.7],
      [-3, -0.8],
      [1.2, -1.6],
      [2.4, -2.2],
      [5.7, -1.1],
      [-6.1, 2.0],
      [-3, 2.1],
      [-1.7, 3.6],
      [1.3, 3.7],
      [2.6, 2.0],
      [5.7, 2.2],
      [-6.1, 4.8],
      [-2.8, 5.6],
      [1.9, 5.9],
      [-0.3, -5.9],
    ];
    treeSpots.forEach(([x, z], i) =>
      this.lushTree(center, x, z, 0.9 + (i % 3) * 0.12, i),
    );
    for (let i = 0; i < 55; i++) {
      const x = -6.2 + ((i * 1.83) % 12.4),
        z = -6.3 + ((i * 3.17) % 12.6);
      if (Math.abs(x + 0.25) < 2 && Math.abs(z - 0.8) < 2) continue;
      this.sphere(
        center,
        0.14,
        [x, 0.39, z],
        ["#81b64e", "#a7c65b", "#66a356"][i % 3],
        [1.45, 0.8, 1],
      );
      for (const dx of [-0.08, 0.07])
        this.sphere(
          center,
          0.055,
          [x + dx, 0.52, z],
          ["#f697a3", "#ffd571", "#fff1ce"][i % 3],
        );
    }
    for (const [x, z] of [
      [-2.65, -4.3],
      [-2.65, 0],
      [2.65, -3.1],
      [2.6, 1.75],
      [-2.7, 3.6],
      [1.5, 5.9],
      [-5.8, 2.8],
      [5.8, 5.7],
    ])
      this.lamp(center, x, z);
    this.plazaSign(center, "住宅區", -3.8, -0.7, 1.15);
    this.plazaSign(center, "中央廣場", -0.25, 3.0, 1.4);

    // Scenic waterfront outside the playable loop, without extra playable cells.
    this.buildWaterfront(center);
    this.buildOutskirts(center);
    this.compactGroup(center);
  }

  private buildWaterfront(parent: THREE.Group): void {
    this.box(parent, [23.4, 0.15, 21.0], [0, -0.47, -0.35], "#b8ca7b", true);
    this.box(parent, [23.7, 0.08, 3.5], [0, -0.5, 11.15], "#16abc9", true);
    this.box(parent, [2.1, 0.07, 21.0], [-10.4, -0.32, 0], "#28b9ce", true);
    this.box(parent, [2.1, 0.07, 21.0], [10.4, -0.32, 0], "#28b9ce", true);
    this.box(parent, [19, 0.16, 0.65], [0, -0.24, 9.5], "#c5a979", true);
    for (let x = -8.9; x < 9.1; x += 0.55)
      this.box(parent, [0.06, 0.43, 0.06], [x, 0.03, 9.76], "#c7b18b");
    for (const y of [0.02, 0.22])
      this.box(parent, [18.1, 0.045, 0.045], [0, y, 9.76], "#dbc7a4");
    for (let i = 0; i < 24; i++) {
      const x = -11 + i * 0.95,
        z = 10.4 + (i % 3) * 0.6;
      this.box(parent, [0.27, 0.012, 0.025], [x, -0.445, z], "#a9e9e7", true);
    }
    for (const x of [-7.8, 7.4]) {
      const boat = new THREE.Group();
      boat.position.set(x, -0.35, 10.9);
      parent.add(boat);
      this.sphere(boat, 0.48, [0, 0.16, 0], "#d69b58", [0.75, 0.45, 1.7]);
      this.box(boat, [0.58, 0.08, 1.25], [0, 0.34, 0], "#fff0ca", true);
      this.cylinder(boat, 0.025, 0.025, 1.65, [0, 1.1, 0], "#cda86d", 7);
      const sailShape = new THREE.Shape();
      sailShape.moveTo(0, 0);
      sailShape.lineTo(0, 1.35);
      sailShape.lineTo(0.62, 0);
      sailShape.closePath();
      const sailGeometry = this.geo(
        "sail",
        () => new THREE.ShapeGeometry(sailShape),
      );
      const sail = new THREE.Mesh(sailGeometry, this.mat("#fff5d6"));
      sail.position.set(0.04, 0.45, 0);
      boat.add(sail);
      const small = new THREE.Mesh(sailGeometry, this.mat("#f2bb65"));
      small.position.set(-0.04, 0.46, 0);
      small.rotation.y = Math.PI;
      small.scale.setScalar(0.68);
      boat.add(small);
    }
    // Keep the outer viewing edge open: low gardens instead of obstructing towers.
    for (let i = 0; i < 11; i++) {
      const x = -8.7 + i * 1.75;
      this.box(parent, [1.05, 0.12, 0.55], [x, 0.23, -10.1], "#e1c9a1", true);
      for (const dx of [-0.32, 0, 0.32]) {
        this.sphere(
          parent,
          0.16,
          [x + dx, 0.34, -10.1],
          "#7dad79",
          [1, 0.65, 1],
        );
        this.sphere(
          parent,
          0.06,
          [x + dx, 0.45, -10.1],
          i % 2 ? "#f1b7ba" : "#ffe3a3",
        );
      }
    }
    for (const side of [-1, 1])
      for (let i = 0; i < 7; i++)
        this.lushTree(
          parent,
          side * 9.22,
          -6.8 + i * 2.1,
          0.9 + (i % 2) * 0.2,
          i,
        );
  }

  /** Surrounding scenery is decorative; the playable loop remains exactly 48 cells. */
  private buildOutskirts(parent: THREE.Group): void {
    const landscape = new THREE.Group();
    parent.add(landscape);
    this.box(landscape, [28.5, 0.35, 8.1], [0, -0.48, -14.25], "#efd39a", true);
    this.box(landscape, [28.1, 0.18, 7.65], [0, -0.23, -14.3], "#86ba58", true);
    // Rounded wooded hills replace a blank backdrop behind the town skyline.
    for (const [x, z, width, height, depth, color] of [
      [-11.7, -16.3, 4.1, 1.6, 2.4, "#65a362"],
      [-7.3, -17.2, 4.5, 2.2, 2.7, "#77b773"],
      [-2.3, -16.7, 4.8, 1.7, 2.5, "#8ec777"],
      [3.1, -17.4, 4.3, 2.6, 2.8, "#78b77c"],
      [8.2, -16.8, 4.5, 1.9, 2.5, "#62a878"],
      [12, -16.0, 3.3, 1.25, 2.3, "#8ac674"],
    ] as const) {
      const hill = this.sphere(landscape, 1, [x, -0.4, z], color, [
        width,
        height,
        depth,
      ]);
      hill.castShadow = false;
    }
    const grove = new THREE.Group();
    grove.position.y = -0.43;
    landscape.add(grove);
    for (let i = 0; i < 28; i++) {
      const x = -13 + (i % 14) * 1.94 + (i >= 14 ? 0.3 : 0);
      const z = -12.6 - Math.floor(i / 14) * 1.65 - Math.sin(i * 1.6) * 0.35;
      this.lushTree(grove, x, z, 1.02 + (i % 4) * 0.18, i);
    }
    // The western harbor connects the city to the woodland by a little white bridge.
    this.box(landscape, [3.0, 0.17, 8.9], [-13, -0.24, -7.9], "#e3c78e", true);
    this.box(landscape, [2.65, 0.1, 8.5], [-13, -0.13, -7.9], "#9ac273", true);
    for (let i = 0; i < 5; i++) {
      this.box(
        landscape,
        [0.06, 0.36, 0.06],
        [-11.63, 0.1, -11.8 + i * 1.65],
        "#efe3bf",
      );
      this.lushTree(
        grove,
        -13.2,
        -11.6 + i * 1.65,
        1.0 + (i % 2) * 0.16,
        i + 2,
      );
    }
    this.box(
      landscape,
      [0.055, 0.05, 7.2],
      [-11.63, 0.25, -8.4],
      "#f9ebcb",
      true,
    );
    const bridge = new THREE.Group();
    bridge.position.set(-10.6, 0.0, -5.2);
    landscape.add(bridge);
    for (let i = 0; i < 16; i++) {
      const x = (i - 7.5) * 0.2,
        rise = Math.sin(((i + 0.5) / 16) * Math.PI) * 0.22;
      this.box(
        bridge,
        [0.205, 0.11, 0.78],
        [x, rise, 0],
        i % 2 ? "#d9b378" : "#e6c68d",
        true,
      );
      for (const z of [-0.43, 0.43]) {
        this.box(
          bridge,
          [0.055, 0.4, 0.055],
          [x, rise + 0.2, z],
          "#fff1cc",
          true,
        );
        this.box(
          bridge,
          [0.22, 0.055, 0.055],
          [x, rise + 0.4, z],
          "#fff1cc",
          true,
        );
      }
    }
    for (const x of [-1.2, 1.2])
      for (const z of [-0.28, 0.28])
        this.cylinder(bridge, 0.07, 0.09, 0.42, [x, -0.2, z], "#bca078", 8);
    // A candy-striped lighthouse and fishing cottage give the harbor a silhouette.
    const lighthouse = new THREE.Group();
    lighthouse.position.set(-12.7, -0.03, -10.8);
    landscape.add(lighthouse);
    this.cylinder(lighthouse, 0.55, 0.65, 0.15, [0, 0.08, 0], "#fff0ca", 24);
    this.cylinder(lighthouse, 0.27, 0.4, 1.65, [0, 0.95, 0], "#fff5de", 24);
    for (const y of [0.58, 1.12])
      this.cylinder(
        lighthouse,
        0.4 - y * 0.07,
        0.405 - y * 0.07,
        0.23,
        [0, y, 0],
        "#e76c4f",
        24,
      );
    this.cylinder(lighthouse, 0.45, 0.45, 0.1, [0, 1.82, 0], "#236b92", 24);
    this.cylinder(lighthouse, 0.28, 0.28, 0.36, [0, 2.04, 0], "#ffe3a0", 16);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      this.cylinder(
        lighthouse,
        0.018,
        0.018,
        0.4,
        [Math.cos(a) * 0.29, 2.04, Math.sin(a) * 0.29],
        "#327d98",
        6,
      );
    }
    this.cylinder(lighthouse, 0, 0.43, 0.3, [0, 2.37, 0], "#d95e46", 24);
    this.sphere(lighthouse, 0.06, [0, 2.55, 0], "#edc064");
    this.box(lighthouse, [0.18, 0.29, 0.035], [0, 0.35, 0.39], "#4d8eac", true);
    this.box(landscape, [1.16, 0.65, 0.9], [-13.2, 0.3, -7.7], "#f4dfb3", true);
    const cottage = new THREE.Group();
    cottage.position.set(-13.2, 0, -7.7);
    landscape.add(cottage);
    this.pitchedRoof(cottage, 1.28, 1.05, 0.42, 0.65, "#df704d");
    this.box(cottage, [0.22, 0.38, 0.035], [0, 0.22, 0.47], "#3f93ae", true);
    for (const x of [-0.37, 0.37])
      this.box(cottage, [0.18, 0.22, 0.04], [x, 0.37, 0.47], "#8dd0de", true);
    // Timber piers and softly rounded boats make the water read as a working harbor.
    for (const [x, z, rotation] of [
      [-12.1, -3.5, 0],
      [12.2, 3.7, Math.PI / 2],
    ] as const) {
      const dock = new THREE.Group();
      dock.position.set(x, -0.21, z);
      dock.rotation.y = rotation;
      landscape.add(dock);
      for (let i = 0; i < 12; i++)
        this.box(
          dock,
          [0.85, 0.11, 0.19],
          [0, 0, (i - 5.5) * 0.2],
          i % 2 ? "#b98b57" : "#cda36e",
          true,
        );
      for (const dz of [-1, 0.3, 1])
        for (const dx of [-0.35, 0.35])
          this.cylinder(dock, 0.055, 0.07, 0.5, [dx, 0.0, dz], "#a87d52", 8);
    }
    this.harborBoat(landscape, -10.6, -2.8, 0.85, "#e66b4e", -0.3);
    this.harborBoat(landscape, 12.6, 5.8, 0.95, "#357ba7", 0.35);
    this.harborBoat(landscape, -5.1, 12.1, 0.7, "#e5b84c", Math.PI / 2);
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1,
        z = -11.8 + Math.floor(i / 2) * 1.8;
      this.box(
        landscape,
        [0.38, 0.008, 0.025],
        [side * (10.0 + (i % 3) * 0.38), -0.274, z],
        "#b1eeee",
        true,
      );
    }
  }

  private harborBoat(
    parent: THREE.Object3D,
    x: number,
    z: number,
    scale: number,
    color: string,
    rotation: number,
  ): void {
    const boat = new THREE.Group();
    boat.position.set(x, -0.32, z);
    boat.scale.setScalar(scale);
    boat.rotation.y = rotation;
    parent.add(boat);
    this.sphere(boat, 0.6, [0, 0.08, 0], color, [0.66, 0.36, 1.5]);
    this.box(boat, [0.59, 0.08, 1.27], [0, 0.27, 0], "#fff1d0", true);
    this.box(boat, [0.46, 0.3, 0.53], [0, 0.47, 0.13], "#fff2da", true);
    for (const side of [-1, 1])
      this.box(
        boat,
        [0.025, 0.15, 0.32],
        [side * 0.24, 0.49, 0.13],
        "#609db3",
        true,
      );
    this.box(boat, [0.35, 0.15, 0.025], [0, 0.49, 0.415], "#609db3", true);
    this.box(boat, [0.54, 0.08, 0.61], [0, 0.66, 0.13], color, true);
    this.cylinder(boat, 0.026, 0.026, 0.65, [0, 0.84, -0.16], "#c99561", 8);
    this.box(boat, [0.24, 0.15, 0.02], [0.11, 1.08, -0.16], "#fff0bd", true);
    for (const side of [-1, 1])
      this.cylinder(
        boat,
        0.075,
        0.075,
        0.045,
        [side * 0.37, 0.25, -0.27],
        "#516e7e",
        12,
      ).rotation.z = Math.PI / 2;
  }

  private buildFerrisWheel(parent: THREE.Object3D, x: number, z: number): void {
    const support = new THREE.Group();
    support.position.set(x, 0.32, z);
    parent.add(support);
    for (const dx of [-0.44, 0.44]) {
      const leg = this.box(
        support,
        [0.11, 1.52, 0.13],
        [dx * 0.65, 0.75, 0],
        C.white,
      );
      leg.rotation.z = dx > 0 ? -0.34 : 0.34;
    }
    this.wheel.position.set(0, 1.55, 0);
    support.add(this.wheel);
    this.wheel.userData.dynamic = true;
    const rim = new THREE.Mesh(
      this.geo("ferris", () => new THREE.TorusGeometry(0.97, 0.045, 6, 48)),
      this.mat(C.red),
    );
    this.wheel.add(rim);
    this.sphere(this.wheel, 0.14, [0, 0, 0.05], C.gold);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const spoke = this.box(
        this.wheel,
        [0.035, 1.92, 0.035],
        [0, 0, 0],
        C.white,
      );
      spoke.rotation.z = a;
      const cabin = new THREE.Group();
      cabin.position.set(Math.cos(a) * 0.97, Math.sin(a) * 0.97, 0.05);
      this.wheel.add(cabin);
      this.box(
        cabin,
        [0.29, 0.25, 0.27],
        [0, -0.05, 0],
        [C.red, C.blue, C.yellow, C.aqua][i % 4],
        true,
      );
      this.box(cabin, [0.21, 0.11, 0.02], [0, 0, 0.145], C.white);
      cabin.userData.cabin = true;
    }
  }

  private makePawn(
    id: number,
    color: string,
    vehicleId: string | null,
  ): { group: THREE.Group; marker: THREE.Mesh } {
    const group = new THREE.Group();
    // Seat identity stays fixed while the player freely chooses a building theme.
    const animal = ["bear", "rabbit", "robot", "penguin"][((id % 4) + 4) % 4];
    const marker = this.cylinder(
      group,
      0.25,
      0.29,
      0.09,
      [0, 0.05, 0],
      color,
      24,
    );
    const template = this.pawnTemplates.get(id);
    if (template) {
      const asset = this.normalizedAsset(template, 0.6, 0.95, 0.6);
      asset.position.y = 0.1;
      group.add(asset);
    } else if (animal === "robot") {
      this.box(group, [0.36, 0.32, 0.23], [0, 0.32, 0], "#cce4e2", true);
      this.box(group, [0.41, 0.32, 0.29], [0, 0.65, 0], "#dcebe8", true);
      this.box(group, [0.31, 0.17, 0.035], [0, 0.65, 0.16], "#45606d", true);
      for (const x of [-0.09, 0.09])
        this.sphere(group, 0.034, [x, 0.66, 0.184], "#b6eff1");
      this.cylinder(group, 0.02, 0.02, 0.13, [0, 0.88, 0], C.dark);
      this.sphere(group, 0.05, [0, 0.96, 0], color);
      for (const x of [-0.24, 0.24])
        this.sphere(group, 0.075, [x, 0.34, 0], color, [0.8, 1.4, 1]);
      this.sphere(group, 0.06, [0, 0.34, 0.13], color);
    } else if (animal === "penguin") {
      this.sphere(group, 0.23, [0, 0.39, 0], "#58737e", [0.85, 1.27, 0.8]);
      this.sphere(group, 0.16, [0, 0.38, 0.113], C.cream, [0.9, 1.15, 0.5]);
      this.sphere(group, 0.21, [0, 0.66, 0.02], "#58737e");
      for (const x of [-0.083, 0.083]) {
        this.sphere(group, 0.065, [x, 0.68, 0.19], C.white);
        this.sphere(group, 0.026, [x, 0.68, 0.247], C.dark);
      }
      this.sphere(group, 0.065, [0, 0.6, 0.22], C.gold, [1, 0.55, 1]);
      for (const x of [-0.1, 0.1])
        this.sphere(group, 0.07, [x, 0.16, 0.11], C.gold, [1, 0.5, 1.4]);
      this.cylinder(group, 0.18, 0.19, 0.1, [0, 0.85, 0.02], color);
      this.cylinder(group, 0.23, 0.23, 0.04, [0, 0.81, 0.02], C.white);
    } else {
      const bunny = animal === "rabbit";
      const fur = bunny ? "#fff2e3" : "#c49a76";
      this.sphere(group, 0.21, [0, 0.34, 0], color, [0.9, 1, 0.85]);
      this.sphere(group, 0.23, [0, 0.65, 0.025], fur, [1, 0.93, 0.9]);
      for (const x of [-0.135, 0.135]) {
        this.sphere(
          group,
          bunny ? 0.075 : 0.092,
          [x, bunny ? 0.91 : 0.83, 0.01],
          fur,
          bunny ? [0.85, 2.25, 0.8] : [1, 1, 0.7],
        );
        this.sphere(
          group,
          bunny ? 0.043 : 0.055,
          [x, bunny ? 0.92 : 0.835, 0.065],
          "#e7b2a1",
          bunny ? [0.8, 2.15, 0.5] : [1, 1, 0.45],
        );
      }
      for (const x of [-0.08, 0.08])
        this.sphere(group, 0.025, [x, 0.67, 0.22], "#4f4947");
      this.sphere(group, 0.052, [0, 0.59, 0.224], "#f5ddc5", [1.5, 0.85, 0.55]);
      this.sphere(
        group,
        0.026,
        [0, 0.61, 0.25],
        bunny ? "#d6938d" : "#5b4e47",
        [1.15, 0.7, 0.65],
      );
      for (const x of [-0.22, 0.22])
        this.sphere(group, 0.07, [x, 0.35, 0.015], fur, [0.8, 1.3, 1]);
      for (const x of [-0.1, 0.1])
        this.sphere(group, 0.075, [x, 0.15, 0.05], fur, [1, 0.7, 1.3]);
      this.box(group, [0.33, 0.09, 0.25], [0, 0.48, 0.01], C.cream, true);
    }
    if (vehicleId) {
      const rider = new THREE.Group();
      for (const child of [...group.children])
        if (child !== marker) rider.add(child);
      group.add(rider);
      const car = vehicleId !== "bicycle" && vehicleId !== "scooter";
      let roofHeight = 0.59;
      const vehicleTemplate = this.vehicleTemplates.get(vehicleId);
      if (car && vehicleTemplate) {
        const size = new THREE.Box3().setFromObject(vehicleTemplate).getSize(new THREE.Vector3());
        const scale = Math.min(0.93 / size.x, 0.85 / size.y, 1.36 / size.z);
        roofHeight = 0.09 + size.y * scale;
      }
      // Oversized toy drivers sit down into the cabin, with faces above the sunroof.
      rider.scale.setScalar(car ? 0.76 : 0.74);
      rider.position.set(0, car ? Math.max(0.08, roofHeight - 0.42) : 0.22, car ? 0.08 : 0.02);
      this.buildVehicle(group, vehicleId, color);
      if (car) {
        const rim = new THREE.Mesh(this.geo("driver-cockpit", () => new THREE.TorusGeometry(0.175, 0.014, 8, 32)), this.mat("#405c69"));
        rim.rotation.x = Math.PI / 2;
        rim.position.set(0, roofHeight + 0.006, 0.08);
        group.add(rim);
        const steering = new THREE.Mesh(this.geo("driver-steering", () => new THREE.TorusGeometry(0.073, 0.012, 8, 24)), this.mat("#253b4a"));
        steering.rotation.x = -Math.PI / 3;
        steering.position.set(0, roofHeight + 0.045, 0.24);
        group.add(steering);
        this.sphere(group, 0.022, [0, roofHeight + 0.045, 0.24], "#8097a3");
      }
      marker.scale.set(1.3, 1, 1.3);
    }
    group.scale.setScalar(1.02);
    // Marker is intentionally separate because active-player emphasis scales it.
    marker.userData.dynamic = true;
    this.compactGroup(group);
    return { group, marker };
  }

  private buildVehicle(parent: THREE.Group, id: string, color: string): void {
    const template = this.vehicleTemplates.get(id);
    if (template) {
      const model = this.normalizedAsset(template, 0.93, 0.85, 1.36);
      model.position.y = 0.09;
      parent.add(model);
      return;
    }
    const wheel = (x: number, z: number, radius: number): void => {
      const tire = this.cylinder(
        parent,
        radius,
        radius,
        0.075,
        [x, 0.18, z],
        "#42515a",
        16,
      );
      tire.rotation.z = Math.PI / 2;
      const hub = this.cylinder(
        parent,
        radius * 0.49,
        radius * 0.49,
        0.084,
        [x, 0.18, z],
        "#dce7e7",
        12,
      );
      hub.rotation.z = Math.PI / 2;
    };
    if (id === "bicycle" || id === "scooter") {
      wheel(0, -0.32, 0.16);
      wheel(0, 0.32, 0.16);
      if (id === "bicycle") {
        const rod = (a: number[], b: number[], tint: string): void => {
          const from = new THREE.Vector3(...(a as [number, number, number]));
          const to = new THREE.Vector3(...(b as [number, number, number]));
          const distance = from.distanceTo(to);
          const bar = this.cylinder(
            parent,
            0.023,
            0.023,
            distance,
            from.clone().add(to).multiplyScalar(0.5).toArray(),
            tint,
            6,
          );
          bar.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            to.sub(from).normalize(),
          );
        };
        for (const [a, b] of [
          [
            [0, 0.18, -0.32],
            [0, 0.46, -0.1],
          ],
          [
            [0, 0.46, -0.1],
            [0, 0.21, 0.02],
          ],
          [
            [0, 0.21, 0.02],
            [0, 0.18, -0.32],
          ],
          [
            [0, 0.46, -0.1],
            [0, 0.49, 0.22],
          ],
          [
            [0, 0.49, 0.22],
            [0, 0.21, 0.02],
          ],
          [
            [0, 0.49, 0.22],
            [0, 0.18, 0.32],
          ],
        ])
          rod(a, b, color);
        this.box(parent, [0.2, 0.06, 0.17], [0, 0.52, -0.1], C.dark, true);
        this.box(parent, [0.31, 0.04, 0.05], [0, 0.58, 0.23], C.dark);
        rod([0, 0.49, 0.22], [0, 0.58, 0.23], C.dark);
      } else {
        this.box(parent, [0.25, 0.16, 0.54], [0, 0.29, -0.04], color, true);
        this.box(parent, [0.26, 0.32, 0.14], [0, 0.48, 0.26], color, true);
        this.box(parent, [0.27, 0.07, 0.29], [0, 0.45, -0.12], C.dark, true);
        this.box(parent, [0.36, 0.045, 0.08], [0, 0.65, 0.25], C.dark, true);
        this.sphere(parent, 0.062, [0, 0.54, 0.345], C.cream, [1, 0.8, 0.3]);
      }
      return;
    }
    const suv = id === "tesla-model-y";
    const tesla = id === "tesla-model-3" || suv;
    const paint = id === "tesla-model-3" ? "#f2f1eb" : suv ? "#8bafc7" : color;
    const width = suv ? 0.67 : 0.61;
    const length = tesla ? 0.98 : 0.85;
    for (const x of [-width / 2, width / 2])
      for (const z of [-length * 0.29, length * 0.29])
        wheel(x, z, suv ? 0.14 : 0.12);
    this.box(
      parent,
      [width, suv ? 0.29 : 0.23, length],
      [0, suv ? 0.36 : 0.31, 0],
      paint,
      true,
    );
    this.box(
      parent,
      [width * 0.78, suv ? 0.24 : 0.17, length * 0.5],
      [0, suv ? 0.6 : 0.51, -0.06],
      "#627f91",
      true,
    );
    this.box(
      parent,
      [width * 0.82, 0.045, length * 0.52],
      [0, suv ? 0.74 : 0.61, -0.06],
      paint,
      true,
    );
    // Contrasting slim headlights and a smooth sedan hood distinguish the Tesla toys.
    for (const x of [-width * 0.31, width * 0.31]) {
      this.box(
        parent,
        [tesla ? 0.15 : 0.12, 0.055, 0.035],
        [x, suv ? 0.4 : 0.34, length / 2 + 0.005],
        C.cream,
        true,
      );
      this.box(
        parent,
        [0.14, 0.045, 0.025],
        [x, suv ? 0.4 : 0.34, -length / 2 - 0.005],
        "#d98079",
        true,
      );
    }
    this.box(
      parent,
      [0.21, 0.06, 0.025],
      [0, 0.24, length / 2 + 0.015],
      C.dark,
      true,
    );
    if (!tesla)
      this.box(
        parent,
        [0.3, 0.045, 0.025],
        [0, 0.33, length / 2 + 0.02],
        C.dark,
      );
  }

  /** Bake static geometry by material, reducing hundreds of tiny toy draw calls. */
  private compactGroup(group: THREE.Group): void {
    group.updateWorldMatrix(true, true);
    const inverse = group.matrixWorld.clone().invert();
    const batches = new Map<THREE.Material, THREE.Mesh[]>();
    group.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        Array.isArray(object.material) ||
        (!(object.material instanceof THREE.MeshStandardMaterial) &&
          !object.material.userData.batchable)
      )
        return;
      let node: THREE.Object3D | null = object;
      while (node && node !== group) {
        if (node.userData.dynamic) return;
        node = node.parent;
      }
      const objects = batches.get(object.material) ?? [];
      objects.push(object);
      batches.set(object.material, objects);
    });
    for (const [material, meshes] of batches) {
      if (meshes.length < 2) continue;
      const parts = meshes.map((mesh) => {
        const geometry = mesh.geometry.index
          ? mesh.geometry.toNonIndexed()
          : mesh.geometry.clone();
        geometry.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
        return geometry;
      });
      const merged = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      if (!merged) continue;
      for (const mesh of meshes) mesh.removeFromParent();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = meshes.some((original) => original.castShadow);
      mesh.receiveShadow = true;
      mesh.userData.ownedGeometry = true;
      this.geometries.add(merged);
      group.add(mesh);
    }
  }

  private clearDecor(group: THREE.Group): void {
    // Geometry and plain materials are pooled; dispose only unique label resources.
    group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      let ancestor: THREE.Object3D | null = obj;
      while (ancestor && ancestor !== group) {
        if (ancestor.userData.externalAsset) return;
        ancestor = ancestor.parent;
      }
      if (obj.userData.ownedGeometry) {
        obj.geometry.dispose();
        this.geometries.delete(obj.geometry);
      }
      const material = obj.material;
      if (
        material instanceof THREE.MeshBasicMaterial &&
        material.map &&
        !material.userData.shared
      ) {
        material.map.dispose();
        this.textures.delete(material.map);
        material.dispose();
        this.extraMaterials.delete(material);
      }
      if (
        material instanceof THREE.MeshStandardMaterial &&
        this.extraMaterials.has(material) &&
        !material.userData.shared
      ) {
        material.dispose();
        this.extraMaterials.delete(material);
      }
    });
    group.clear();
  }

  /** Perimeter props change only on purchases/upgrades, so one color batch serves all 48 cells. */
  private batchBoardDecor(): void {
    this.boardDecor.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.ownedGeometry) {
        object.geometry.dispose();
        this.geometries.delete(object.geometry);
      }
    });
    this.boardDecor.clear();
    this.scene.updateMatrixWorld(true);
    for (const tile of this.tileVisuals) {
      tile.decor.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const proxy = new THREE.Mesh(object.geometry, object.material);
        proxy.matrix.copy(object.matrixWorld);
        proxy.matrixAutoUpdate = false;
        proxy.castShadow = object.castShadow;
        proxy.receiveShadow = object.receiveShadow;
        let ancestor: THREE.Object3D | null = object;
        while (ancestor && ancestor !== tile.decor) {
          if (ancestor.userData.externalAsset) {
            proxy.userData.dynamic = true;
            proxy.userData.externalAsset = true;
            break;
          }
          ancestor = ancestor.parent;
        }
        this.boardDecor.add(proxy);
      });
      tile.decor.visible = false;
    }
    this.compactGroup(this.boardDecor);
    this.renderer.shadowMap.needsUpdate = true;
  }

  update(data: CityData): void {
    if (this.disposed) return;
    this.setSeason(data.season ?? 0);
    if (this.disposed) return;
    this.lastData = data;
    this.needsRender = true;
    let boardChanged = false;
    for (const tile of data.tiles) {
      const visual = this.tileVisuals[tile.id];
      if (!visual) continue;
      let marker = this.prankMarkers.get(tile.id);
      if (tile.effect && !marker) {
        const group = new THREE.Group();
        group.position.set(0, 0.33, -0.38);
        visual.group.add(group);
        marker = { group, kind: "" };
        this.prankMarkers.set(tile.id, marker);
      }
      if (marker) {
        marker.group.visible = !!tile.effect;
        if (tile.effect && marker.kind !== tile.effect) {
          this.clearDecor(marker.group);
          marker.kind = tile.effect;
          if (tile.effect === "roadblock") {
            for (const x of [-0.28, 0.28]) this.box(marker.group, [0.07, 0.28, 0.12], [x, 0.14, 0], "#f4ae46", true);
            this.box(marker.group, [0.72, 0.15, 0.08], [0, 0.23, 0], "#fff5df", true);
            for (const x of [-0.23, 0, 0.23]) this.box(marker.group, [0.1, 0.15, 0.09], [x, 0.23, 0], "#ef7652", true);
          } else if (tile.effect === "trap") {
            this.box(marker.group, [0.33, 0.24, 0.3], [0, 0.12, 0], "#bd8ed6", true);
            this.box(marker.group, [0.08, 0.27, 0.32], [0, 0.13, 0], "#ffe394", true);
            this.sphere(marker.group, 0.065, [-0.065, 0.29, 0], "#ffe394");
            this.sphere(marker.group, 0.065, [0.065, 0.29, 0], "#ffe394");
          } else {
            this.box(marker.group, [0.06, 0.35, 0.06], [0, 0.175, 0], "#735a48", true);
            this.box(marker.group, [0.5, 0.24, 0.06], [0, 0.36, 0], "#ea6c68", true);
            this.box(marker.group, [0.3, 0.05, 0.075], [0, 0.36, 0], "#fff5df", true);
          }
        }
      }
      const owner = data.players.find((player) => player.id === tile.owner);
      const signature = `${tile.type}:${tile.name}:${tile.owner}:${tile.level}:${owner?.theme}:${owner?.color}`;
      if (visual.signature !== signature) {
        visual.signature = signature;
        boardChanged = true;
        this.clearDecor(visual.decor);
        visual.decor.scale.set(1, 1, 1);
        visual.decor.rotation.y = 0;
        if (tile.type === "property" && owner) {
          this.house(visual.decor, owner.theme, tile.level, owner.color);
          visual.decor.scale.set(0.9, 0.82, 0.9);
          const point = cityTilePosition(tile.id);
          visual.decor.rotation.y =
            Math.abs(point.z) === EDGE
              ? point.z < 0
                ? Math.PI
                : 0
              : (Math.sign(point.x) * Math.PI) / 2;
        } else this.facility(visual.decor, tile.type, tile.id);
        const name =
          tile.type === "bank"
            ? `B${Math.max(1, BANKS.indexOf(tile.id) + 1)} 銀行`
            : tile.type === "start"
              ? "GO 起點"
              : tile.name;
        const oldMaterial = visual.label.material as THREE.MeshBasicMaterial;
        if (oldMaterial.map) {
          oldMaterial.map.dispose();
          this.textures.delete(oldMaterial.map);
        }
        oldMaterial.dispose();
        this.extraMaterials.delete(oldMaterial);
        visual.group.remove(visual.label);
        visual.label = this.tileArtwork(tile.id, tile.type, name, owner?.color);
        visual.group.add(visual.label);
        const surfaceMaterial = visual.surface
          .material as THREE.MeshStandardMaterial;
        surfaceMaterial.color.set(
          owner
            ? owner.color
            : tile.type === "bank"
              ? "#f8dc8d"
              : tile.type === "property"
                ? [C.peach, C.blue, C.aqua, C.purple, C.yellow, "#d9c4a5"][
                    Math.floor(tile.id / 8)
                  ]
                : tile.type === "start"
                  ? "#9dd6c4"
                  : "#f1eadb",
        );
      }
    }
    if (boardChanged) this.batchBoardDecor();
    const now = performance.now();
    const present = new Set(data.players.map((p) => p.id));
    for (const [id, pawn] of this.pawns)
      if (!present.has(id)) {
        this.clearDecor(pawn.group);
        this.scene.remove(pawn.group);
        this.pawns.delete(id);
      }
    for (const player of data.players) {
      let pawn = this.pawns.get(player.id);
      const vehicleId = player.vehicleId || null;
      if (
        pawn &&
        (pawn.theme !== player.theme ||
          pawn.color !== player.color ||
          pawn.vehicleId !== vehicleId)
      ) {
        this.clearDecor(pawn.group);
        this.scene.remove(pawn.group);
        this.pawns.delete(player.id);
        pawn = undefined;
      }
      const destination = cityTilePosition(player.position);
      const occupants = data.players
        .filter((p) => p.position === player.position && !p.bankrupt)
        .map((p) => p.id)
        .sort((a, b) => a - b);
      const offset = Math.max(0, occupants.indexOf(player.id));
      if (occupants.length > 1) {
        destination.x += offset % 2 ? 0.27 : -0.27;
        destination.z += offset < 2 ? 0.25 : -0.25;
      }
      destination.y = 0.33;
      if (!pawn) {
        const model = this.makePawn(player.id, player.color, vehicleId);
        model.group.position.copy(destination);
        const forward = cityTilePosition(player.position + 1).sub(
          cityTilePosition(player.position),
        );
        model.group.rotation.y = Math.atan2(forward.x, forward.z);
        this.scene.add(model.group);
        pawn = {
          ...model,
          from: destination.clone(),
          to: destination.clone(),
          movedAt: 0,
          position: player.position,
          duration: 300,
          hopping: false,
          theme: player.theme,
          color: player.color,
          vehicleId,
        };
        this.pawns.set(player.id, pawn);
        this.renderer.shadowMap.needsUpdate = true;
      }
      pawn.group.visible = !player.bankrupt;
      if (pawn.to.distanceTo(destination) > 0.001) {
        pawn.from.copy(pawn.group.position);
        pawn.from.y = 0.33;
        pawn.hopping = pawn.position !== player.position;
        if (pawn.hopping) {
          const direction = cityTilePosition(player.position).sub(
            cityTilePosition(pawn.position),
          );
          pawn.group.rotation.y = Math.atan2(direction.x, direction.z);
        }
        pawn.position = player.position;
        pawn.duration = Math.max(
          60,
          Math.min(300, (data.stepDuration ?? 420) - 20),
        );
        pawn.to.copy(destination);
        pawn.movedAt = now;
        this.renderer.shadowMap.needsUpdate = true;
      }
      const active =
        player.id === data.currentPlayer ||
        (data.players[data.currentPlayer]?.id === player.id &&
          !data.players.some((p) => p.id === data.currentPlayer));
      const markerScale = (vehicleId ? 1.3 : 1) * (active ? 1.13 : 1);
      pawn.marker.scale.set(markerScale, 1, markerScale);
      pawn.group.scale.setScalar(active ? 1.22 : 1.04);
      if (active) this.currentIndex = player.position;
    }
    const currentPosition = cityTilePosition(this.currentIndex);
    this.currentRing.position.set(currentPosition.x, 0.333, currentPosition.z);
    if (this.followEnabled && (this.followedTile !== this.currentIndex || this.followedPlayer !== data.currentPlayer)) {
      this.setFollowPoint();
      this.followedTile = this.currentIndex;
      this.followedPlayer = data.currentPlayer;
    }
  }

  focus(index: number): void {
    this.followEnabled = true;
    const point = cityTilePosition(index);
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.copy(point).setY(0.2);
    this.camera.position.copy(point).add(offset);
    this.followPoint.copy(this.controls.target);
    this.camera.zoom = Math.max(this.camera.zoom, 1.35);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  resetView(): void {
    this.followEnabled = true;
    this.controls.target.set(0, 0.35, 0);
    if (this.portrait) this.camera.position.set(0.7, 38, 24);
    else this.camera.position.set(2.3, 20.5, 30);
    this.followPoint.copy(this.controls.target);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private setFollowPoint(): void {
    this.followPoint.copy(cityTilePosition(this.currentIndex));
    // Leave the active pawn just below center, with more city behind it.
    this.followPoint.x *= 0.93;
    this.followPoint.z *= 0.93;
    this.followPoint.y = 0.65;
  }

  /** Close, lower-angle phone view; resetView returns to the entire 48-cell board. */
  setFollow(enabled: boolean): void {
    if (this.disposed) return;
    this.followEnabled = enabled;
    if (!enabled) {
      this.resetView();
      return;
    }
    this.setFollowPoint();
    this.controls.target.copy(this.followPoint);
    this.camera.position.copy(this.followPoint).add(this.followCameraOffset());
    this.camera.zoom = this.portrait ? 2.65 : 1.6;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.needsRender = true;
  }

  private followCameraOffset(): THREE.Vector3 {
    const outward = cityTilePosition(this.currentIndex).normalize();
    return new THREE.Vector3(
      outward.x * 17 + outward.z * 4,
      14,
      outward.z * 17 - outward.x * 4,
    );
  }

  setQuality(low: boolean): void {
    this.lowQuality = low;
    this.renderer.setPixelRatio(
      low ? 1 : Math.min(window.devicePixelRatio || 1, 1.75),
    );
    this.renderer.shadowMap.enabled = !low;
    this.directional.castShadow = !low;
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  diagnostics(): {
    meshes: number;
    geometries: number;
    textures: number;
    drawCalls: number;
    triangles: number;
    programs: number;
    disposed: boolean;
    renderedFrames: number;
    inViewport: boolean;
    rendererRevision: string;
    following: boolean;
    cameraTarget: number[];
    cameraPosition: number[];
    cameraZoom: number;
  } {
    let meshes = 0;
    this.scene.traverseVisible((object) => {
      if (object instanceof THREE.Mesh) meshes++;
    });
    return {
      meshes,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      programs: this.renderer.info.programs?.length ?? 0,
      disposed: this.disposed,
      renderedFrames: this.renderedFrames,
      inViewport: this.inViewport,
      rendererRevision: THREE.REVISION,
      following: this.followEnabled,
      cameraTarget: this.controls.target.toArray(),
      cameraPosition: this.camera.position.toArray(),
      cameraZoom: this.camera.zoom,
    };
  }

  private resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;
    const portrait = aspect < 1.05;
    if (!this.hasSized || portrait !== this.portrait) {
      const keepFollowing = this.followEnabled;
      this.portrait = portrait;
      this.hasSized = true;
      this.resetView();
      if (keepFollowing) this.setFollowPoint();
    }
    // A higher portrait angle makes the square board readable on a narrow phone.
    // The desktop framing reserves the upper ~70 px for the heading and round HUD.
    const viewHeight = Math.max(16.8, (portrait ? 20.4 : 21.2) / aspect);
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    const shadowSize = portrait || this.lowQuality ? 1024 : 2048;
    if (this.directional.shadow.mapSize.x !== shadowSize) {
      this.directional.shadow.map?.dispose();
      this.directional.shadow.map = null;
      this.directional.shadow.mapSize.set(shadowSize, shadowSize);
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.needsRender = true;
  };

  private invalidate = (): void => {
    this.needsRender = true;
  };

  private getTile(event: PointerEvent): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.clickTargets, false)[0];
    return hit ? (hit.object.userData.tileId as number) : null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    // Orbit/zoom remain user-controlled; movement still tracks the current pawn.
    this.followPoint.copy(this.controls.target);
    this.followEnabled = true;
    if (!event.isPrimary) {
      this.activePointer = -1;
      return;
    }
    this.activePointer = event.pointerId;
    this.pointerDown.set(event.clientX, event.clientY);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      this.activePointer !== event.pointerId ||
      this.pointerDown.distanceTo(
        new THREE.Vector2(event.clientX, event.clientY),
      ) > 7
    )
      return;
    const id = this.getTile(event);
    this.activePointer = -1;
    if (id !== null) this.onTileClick(id);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch" || event.buttons) return;
    const index = this.getTile(event);
    if (index !== this.hoverIndex) {
      if (this.hoverIndex !== null)
        (
          this.tileVisuals[this.hoverIndex].surface
            .material as THREE.MeshStandardMaterial
        ).emissive.set("#000000");
      this.hoverIndex = index;
      if (index !== null)
        (
          this.tileVisuals[index].surface.material as THREE.MeshStandardMaterial
        ).emissive.set("#26200e");
      this.renderer.domElement.style.cursor =
        index === null ? "grab" : "pointer";
      this.needsRender = true;
    }
  };

  private onPointerLeave = (): void => {
    if (this.hoverIndex !== null)
      (
        this.tileVisuals[this.hoverIndex].surface
          .material as THREE.MeshStandardMaterial
      ).emissive.set("#000000");
    this.hoverIndex = null;
    this.needsRender = true;
  };

  private animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    const now = performance.now();
    if (
      document.hidden ||
      !this.inViewport ||
      now - this.lastTime < (this.lowQuality ? 32 : 15.5)
    )
      return;
    const elapsed = Math.max(0, now - this.lastTime);
    this.lastTime = now;
    if (this.followEnabled && this.controls.target.distanceToSquared(this.followPoint) > 0.00001) {
      const delta = this.followPoint.clone().sub(this.controls.target)
        .multiplyScalar(this.motionReduced ? 1 : 1 - Math.exp(-elapsed / 120));
      this.controls.target.add(delta);
      this.camera.position.add(delta); // Preserve the player's chosen angle and zoom.
      this.needsRender = true;
    }
    this.controls.update();
    let moving = false;
    for (const pawn of this.pawns.values()) {
      const progress = this.motionReduced
        ? 1
        : Math.min(1, (now - pawn.movedAt) / pawn.duration);
      const ease = progress * progress * (3 - 2 * progress);
      pawn.group.position.lerpVectors(pawn.from, pawn.to, ease);
      if (progress < 1) {
        moving = true;
        if (pawn.hopping)
          pawn.group.position.y +=
            Math.sin(progress * Math.PI) * (pawn.vehicleId ? 0.28 : 0.52);
        this.renderer.shadowMap.needsUpdate = true;
      }
    }
    if (this.seasonParticles) {
      this.seasonParticles.visible = !this.motionReduced && !this.lowQuality;
      if (this.seasonParticles.visible) {
        const position = this.seasonParticles.geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
          const speed = this.season === 1 ? 0.00008 : 0.00024;
          position.setXYZ(
            i,
            ((i * 7.17) % 18) - 9 + Math.sin(now * 0.0006 + i) * 0.18,
            4 - ((now * speed + i * 0.37) % 3.6),
            ((i * 3.71) % 18) - 9,
          );
        }
        position.needsUpdate = true;
      }
    }
    const ambientDue =
      !this.motionReduced &&
      !this.lowQuality &&
      now - this.lastRenderedAt >= 32;
    const motionChanged = moving || this.wasMoving;
    if (this.wasMoving && !moving) this.renderer.shadowMap.needsUpdate = true;
    this.wasMoving = moving;
    // Idle toys animate at 30 fps; player movement and orbit gestures may use 60.
    // Reduced-motion/low-quality scenes do not render at all while unchanged.
    if (!this.needsRender && !motionChanged && !ambientDue) return;
    if (!this.motionReduced && !this.lowQuality) {
      if (this.tramCurve) {
        const progress = (Math.sin(now * 0.000065) + 1) / 2;
        this.tram.position.copy(this.tramCurve.getPoint(progress));
        const tangent = this.tramCurve.getTangent(progress);
        this.tram.rotation.y = -Math.atan2(tangent.z, tangent.x);
      }
      this.wheel.rotation.z = now * 0.000035;
      for (const child of this.wheel.children)
        if (child.userData.cabin) child.rotation.z = -this.wheel.rotation.z;
      this.currentRing.scale.setScalar(1 + Math.sin(now * 0.003) * 0.025);
      if (this.fountainJet)
        this.fountainJet.scale.y = 1.7 + Math.sin(now * 0.0024) * 0.13;
    }
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
    this.lastRenderedAt = now;
    this.renderedFrames++;
  };

  /** Release loader-owned templates after clones are removed, before the WebGL cache closes. */
  dispose(releaseExternalAssets?: () => void): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.controls.removeEventListener("change", this.invalidate);
    // OrbitControls r180 adds a document keyup listener while Control is held,
    // but disconnect() only removes keydown. Release that temporary listener too.
    const releaseControl = (
      this.controls as unknown as { _interceptControlUp?: EventListener }
    )._interceptControlUp;
    if (releaseControl)
      this.renderer.domElement
        .getRootNode()
        .removeEventListener("keyup", releaseControl, true);
    this.controls.dispose();
    this.prankMarkers.clear();
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.onPointerDown,
    );
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.removeEventListener(
      "pointermove",
      this.onPointerMove,
    );
    this.renderer.domElement.removeEventListener(
      "pointerleave",
      this.onPointerLeave,
    );
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materialCache.values()) material.dispose();
    for (const material of this.extraMaterials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.directional.shadow.map?.dispose();
    this.directional.shadow.mapPass?.dispose();
    this.scene.environment = null;
    this.environmentMap?.dispose();
    this.environmentMap = null;
    this.seasonParticles = null;
    this.scene.clear();
    this.tram.clear();
    this.wheel.clear();
    this.boardDecor.clear();
    this.fountainJet = null;
    this.tramCurve = null;
    this.cityCenter = null;
    this.contactMaterial = null;
    this.lastData = null;
    this.landmarkTemplates.clear();
    this.pawnTemplates.clear();
    this.vehicleTemplates.clear();
    this.materialCache.clear();
    this.geometryCache.clear();
    this.geometries.clear();
    this.extraMaterials.clear();
    this.textures.clear();
    this.pawns.clear();
    this.clickTargets.length = 0;
    this.tileVisuals.length = 0;
    try {
      releaseExternalAssets?.();
    } finally {
      this.renderer.renderLists.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
    }
  }
}
