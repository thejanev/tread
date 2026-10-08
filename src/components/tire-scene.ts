import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type TireStats = {
  meters: number;
  paused: boolean;
  steered: boolean;
};

const RADIUS = 1.06;
const WIDTH = 0.8;
const PITCH = 0.168;
const CIRC = Math.PI * 2 * RADIUS;
const TREAD_DEPTH = 0.04;
const GROOVE_R = RADIUS - TREAD_DEPTH;
const TREAD_HALF = 0.355;
const ASPHALT = 0x3a3836;
const ROAD_REPEAT = 32;
const PLANE = 400;
const MAX_SAMPLES = 760;

type Rib = { x: number; w: number; gap: number; shift: number };
const RIBS: Rib[] = [
  { x: -0.292, w: 0.112, gap: 0.16, shift: 0.08 },
  { x: -0.148, w: 0.092, gap: 0.3, shift: 0 },
  { x: 0, w: 0.1, gap: 0.26, shift: 0.46 },
  { x: 0.148, w: 0.092, gap: 0.32, shift: 0.2 },
  { x: 0.292, w: 0.112, gap: 0.14, shift: 0.58 },
];

type Sample = { x: number; z: number; s: number };

export function mountTireScene(host: HTMLElement, onStats: (stats: TireStats) => void): () => void {
  return startTire(host, onStats);
}

function startTire(host: HTMLElement, onStats: (stats: TireStats) => void): () => void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  const maxRatio = Math.min(window.devicePixelRatio || 1, 2);
  let ratio = maxRatio;
  renderer.setPixelRatio(ratio);
  renderer.setSize(width(), height(), false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ASPHALT);
  scene.fog = new THREE.Fog(ASPHALT, 16, 42);
  scene.environmentIntensity = 0.38;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(34, width() / height(), 0.4, 200);

  scene.add(new THREE.HemisphereLight(0xd7e0ea, 0x2e2c28, 0.62));
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 36;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xb9c8d4, 0.32);
  fill.position.set(-6, 3.5, -7);
  scene.add(fill);

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [env];
  const keepGeo = <T extends THREE.BufferGeometry>(geo: T) => {
    geos.push(geo);
    return geo;
  };
  const keepMat = <T extends THREE.Material>(mat: T) => {
    mats.push(mat);
    return mat;
  };
  const keepTex = (tex: THREE.Texture, color = true) => {
    tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texs.push(tex);
    return tex;
  };

  const road = paintAsphalt();
  const roadMaps: THREE.Texture[] = [];
  const bindRoad = (tex: THREE.Texture, color: boolean) => {
    keepTex(tex, color);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(ROAD_REPEAT, -ROAD_REPEAT);
    roadMaps.push(tex);
    return tex;
  };
  const floorTex = bindRoad(new THREE.CanvasTexture(road.color), true);
  const floorNormal = bindRoad(new THREE.CanvasTexture(road.normal), false);
  const floorRough = bindRoad(new THREE.CanvasTexture(road.rough), false);
  const floor = new THREE.Mesh(
    keepGeo(new THREE.PlaneGeometry(PLANE, PLANE)),
    keepMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: floorTex,
        normalMap: floorNormal,
        normalScale: new THREE.Vector2(1.35, 1.35),
        roughnessMap: floorRough,
        roughness: 0.96,
        metalness: 0.03,
      }),
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const side = paintSidewall(false);
  const sideMap = keepTex(new THREE.CanvasTexture(side.color));
  const sideBump = keepTex(new THREE.CanvasTexture(side.bump), false);
  let dead = false;
  void document.fonts.ready.then(() => {
    if (dead) return;
    const next = paintSidewall(false);
    sideMap.image = next.color;
    sideMap.needsUpdate = true;
    sideBump.image = next.bump;
    sideBump.needsUpdate = true;
  });

  const carcassMat = keepMat(
    new THREE.MeshPhysicalMaterial({
      map: sideMap,
      bumpMap: sideBump,
      bumpScale: 0.014,
      color: 0xffffff,
      roughness: 0.84,
      metalness: 0.02,
      clearcoat: 0.08,
      clearcoatRoughness: 0.62,
    }),
  );
  const sipeMap = keepTex(new THREE.CanvasTexture(paintBlockFace()));
  sipeMap.wrapS = sipeMap.wrapT = THREE.RepeatWrapping;
  const blockMat = keepMat(
    new THREE.MeshPhysicalMaterial({
      map: sipeMap,
      color: 0xffffff,
      roughness: 0.74,
      metalness: 0.04,
      clearcoat: 0.16,
      clearcoatRoughness: 0.42,
    }),
  );

  const root = new THREE.Group();
  const spinner = new THREE.Group();
  root.add(spinner);
  scene.add(root);

  const carcass = new THREE.Mesh(keepGeo(tireLathe()), carcassMat);
  carcass.rotation.z = Math.PI / 2;
  carcass.castShadow = true;
  carcass.receiveShadow = true;
  spinner.add(carcass);

  const blockCount = RIBS.reduce((sum, rib) => sum + Math.floor(CIRC / PITCH) * (rib.w > 0 ? 1 : 1), 0);
  const blocks = new THREE.InstancedMesh(keepGeo(new RoundedBoxGeometry(1, 1, 1, 2, 0.16)), blockMat, blockCount);
  blocks.castShadow = true;
  blocks.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const radial = new THREE.Vector3();
  const circum = new THREE.Vector3();
  const axial = new THREE.Vector3(1, 0, 0);
  let blockIndex = 0;
  const perRib = Math.floor(CIRC / PITCH);
  for (const rib of RIBS) {
    const len = PITCH * (1 - rib.gap);
    const height = TREAD_DEPTH * 0.98;
    for (let i = 0; i < perRib; i++) {
      const along = (i + rib.shift) * PITCH + len * 0.5;
      const phi = along / RADIUS;
      const sy = Math.sin(phi);
      const cy = Math.cos(phi);
      radial.set(0, sy, cy);
      circum.set(0, cy, -sy);
      dummy.position.copy(radial).multiplyScalar(GROOVE_R + height * 0.46);
      dummy.position.x = rib.x;
      dummy.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(circum, radial, axial));
      dummy.scale.set(len * 0.94, height, rib.w);
      dummy.updateMatrix();
      blocks.setMatrixAt(blockIndex, dummy.matrix);
      const wear = 0.9 + ((i * 17 + rib.x * 40) % 7) * 0.018;
      blocks.setColorAt(blockIndex, new THREE.Color(wear, wear, wear * 0.98));
      blockIndex++;
    }
  }
  blocks.instanceMatrix.needsUpdate = true;
  if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
  spinner.add(blocks);

  const alloy = keepMat(
    new THREE.MeshStandardMaterial({ color: 0xd5d8de, roughness: 0.28, metalness: 0.88 }),
  );
  const alloyDark = keepMat(
    new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.46, metalness: 0.62 }),
  );
  const ink = keepMat(new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.55, metalness: 0.2 }));
  const chrome = keepMat(
    new THREE.MeshStandardMaterial({ color: 0xe6e8ec, roughness: 0.18, metalness: 0.94 }),
  );

  const rimR = RADIUS * 0.7;
  const lipGeo = keepGeo(new THREE.TorusGeometry(rimR, 0.016, 12, 72));
  const spokeGeo = keepGeo(new THREE.CylinderGeometry(0.016, 0.034, rimR * 0.56, 8));
  spokeGeo.translate(0, rimR * 0.3, 0.02);
  const hubGeo = keepGeo(new THREE.CylinderGeometry(0.11, 0.13, 0.05, 24));
  const capGeo = keepGeo(new THREE.CylinderGeometry(0.078, 0.078, 0.02, 24));
  const lugGeo = keepGeo(new THREE.CylinderGeometry(0.022, 0.024, 0.02, 6));
  const discGeo = keepGeo(new THREE.CylinderGeometry(RADIUS * 0.5, RADIUS * 0.5, 0.018, 40));
  const barrelGeo = keepGeo(new THREE.CylinderGeometry(rimR * 0.94, rimR * 0.94, WIDTH * 0.58, 40, 1, true));
  barrelGeo.rotateZ(Math.PI / 2);
  const barrel = new THREE.Mesh(barrelGeo, alloyDark);
  spinner.add(barrel);

  for (const faceSide of [-1, 1] as const) {
    const face = new THREE.Group();
    face.position.x = faceSide * (WIDTH / 2 - 0.01);
    face.rotation.y = faceSide === 1 ? Math.PI / 2 : -Math.PI / 2;
    spinner.add(face);

    const disc = new THREE.Mesh(discGeo, alloyDark);
    disc.rotation.x = Math.PI / 2;
    disc.position.z = -0.04;
    face.add(disc);

    const lip = new THREE.Mesh(lipGeo, alloy);
    lip.castShadow = true;
    face.add(lip);

    for (let i = 0; i < 5; i++) {
      const base = (i / 5) * Math.PI * 2 + 0.15;
      for (const twist of [-0.18, 0.18]) {
        const spoke = new THREE.Mesh(spokeGeo, alloy);
        spoke.rotation.z = base + twist;
        spoke.castShadow = true;
        face.add(spoke);
      }
    }

    const hub = new THREE.Mesh(hubGeo, ink);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.01;
    face.add(hub);
    const cap = new THREE.Mesh(capGeo, chrome);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 0.038;
    face.add(cap);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const lug = new THREE.Mesh(lugGeo, chrome);
      lug.rotation.x = Math.PI / 2;
      lug.position.set(Math.cos(a) * 0.072, Math.sin(a) * 0.072, 0.046);
      face.add(lug);
    }
  }

  const valveGeo = keepGeo(new THREE.CylinderGeometry(0.011, 0.013, 0.05, 8));
  valveGeo.rotateZ(Math.PI / 2);
  const valve = new THREE.Mesh(valveGeo, ink);
  valve.position.set(WIDTH / 2 - 0.02, RADIUS * 0.78, 0.12);
  spinner.add(valve);
  const capStem = keepGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.016, 8));
  capStem.rotateZ(Math.PI / 2);
  const valveCap = new THREE.Mesh(capStem, chrome);
  valveCap.position.set(WIDTH / 2 + 0.012, RADIUS * 0.78, 0.12);
  spinner.add(valveCap);

  const shadowTex = keepTex(new THREE.CanvasTexture(paintBlob()));
  const blob = new THREE.Mesh(
    keepGeo(new THREE.PlaneGeometry(RADIUS * 2.15, WIDTH * 1.35)),
    keepMat(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.003;
  blob.renderOrder = 1;
  scene.add(blob);

  const trackTex = keepTex(new THREE.CanvasTexture(paintTrack()));
  trackTex.wrapS = THREE.RepeatWrapping;
  trackTex.wrapT = THREE.ClampToEdgeWrapping;
  const pairs = MAX_SAMPLES + 2;
  const positions = new Float32Array(pairs * 2 * 3);
  const normals = new Float32Array(pairs * 2 * 3);
  const uvs = new Float32Array(pairs * 2 * 2);
  const indices = new Uint32Array((pairs - 1) * 6);
  for (let i = 0; i < pairs - 1; i++) {
    const a = i * 2;
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  const trackGeo = keepGeo(new THREE.BufferGeometry());
  trackGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  trackGeo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  trackGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  trackGeo.setIndex(new THREE.BufferAttribute(indices, 1));
  trackGeo.setDrawRange(0, 0);
  const track = new THREE.Mesh(
    trackGeo,
    keepMat(
      new THREE.MeshStandardMaterial({
        map: trackTex,
        roughness: 0.7,
        metalness: 0.02,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    ),
  );
  track.receiveShadow = true;
  track.frustumCulled = false;
  track.renderOrder = 2;
  scene.add(track);

  const samples: Sample[] = [];
  const pos = new THREE.Vector2(0, 0);
  const vel = new THREE.Vector2(0, 0);
  const target = new THREE.Vector2(0, 0);
  let heading = 0;
  let distance = 0;
  let grip = 0;
  let paused = false;
  let steered = false;
  let dragging = false;
  let pointerOn = false;
  let pointerAt = -1e9;
  let downX = 0;
  let downY = 0;
  let downAt = 0;
  let wander = Math.PI * 0.25;
  let elapsed = 0;
  let camBlend = reduce ? 99 : 0;
  let fit = 1;

  function pushSample(x: number, z: number, s: number) {
    samples.push({ x, z, s });
    if (samples.length > MAX_SAMPLES) samples.shift();
  }
  pushSample(0, 0, 0);

  function dampAngle(from: number, to: number, t: number) {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return from + d * t;
  }

  function step(dt: number) {
    grip += ((dragging ? 1 : 0) - grip) * (1 - Math.exp(-10 * dt));
    const follow = 16 + (34 - 16) * grip;
    const damp = 5.4 + (8.5 - 5.4) * grip;
    const maxSpeed = 8 + (12 - 8) * grip;
    vel.x += ((target.x - pos.x) * follow - vel.x * damp) * dt;
    vel.y += ((target.y - pos.y) * follow - vel.y * damp) * dt;
    const speed = Math.hypot(vel.x, vel.y);
    if (speed > maxSpeed) vel.multiplyScalar(maxSpeed / speed);
    const moved = Math.hypot(vel.x * dt, vel.y * dt);
    if (moved < 1e-6) return;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    distance += moved;
    if (speed > 0.06) {
      heading = dampAngle(heading, Math.atan2(vel.x, vel.y), 1 - Math.exp(-(7 + 6 * grip) * dt));
    }
    const last = samples[samples.length - 1];
    if (!last || (pos.x - last.x) ** 2 + (pos.y - last.z) ** 2 >= 0.08 * 0.08) {
      pushSample(pos.x, pos.y, distance);
    }
  }

  function placeTarget(time: number, dt: number, composing = false) {
    const idle = performance.now() - pointerAt > 3200;
    if (!composing && pointerOn && (dragging || !idle)) return;
    if (reduce && !composing) {
      target.copy(pos);
      return;
    }
    wander += dt * (0.34 + 0.5 * Math.sin(time * 0.31) + 0.3 * Math.sin(time * 0.113 + 2.1));
    target.set(pos.x + Math.sin(wander) * 3.8, pos.y + Math.cos(wander) * 3.8);
  }

  for (let i = 0; i < 520; i++) {
    placeTarget(elapsed, 1 / 60, true);
    step(1 / 60);
    elapsed += 1 / 60;
  }
  if (reduce) {
    vel.set(0, 0);
    target.copy(pos);
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  function aim(clientX: number, clientY: number) {
    const rect = host.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    pointerOn = true;
    pointerAt = performance.now();
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hit)) target.set(hit.x, hit.z);
  }
  function onMove(event: PointerEvent) {
    aim(event.clientX, event.clientY);
  }
  function onDown(event: PointerEvent) {
    aim(event.clientX, event.clientY);
    dragging = true;
    steered = true;
    host.style.cursor = "grabbing";
    downX = event.clientX;
    downY = event.clientY;
    downAt = performance.now();
    try {
      host.setPointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  }
  function onUp(event: PointerEvent) {
    dragging = false;
    host.style.cursor = "grab";
    try {
      host.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    const dx = event.clientX - downX;
    const dy = event.clientY - downY;
    if (dx * dx + dy * dy < 64 && performance.now() - downAt < 450) {
      paused = !paused;
      emit(true);
    }
  }
  function onCancel() {
    dragging = false;
    host.style.cursor = "grab";
  }

  host.addEventListener("pointermove", onMove, { passive: true });
  host.addEventListener("pointerdown", onDown, { passive: true });
  host.addEventListener("pointerup", onUp, { passive: true });
  host.addEventListener("pointercancel", onCancel, { passive: true });

  const half = TREAD_HALF;
  const right = new THREE.Vector2();
  const tangent = new THREE.Vector2();

  function writePair(index: number, x: number, y: number, z: number, u: number) {
    const o = index * 6;
    const n = index * 4;
    positions[o] = x + right.x * half;
    positions[o + 1] = y;
    positions[o + 2] = z + right.y * half;
    positions[o + 3] = x - right.x * half;
    positions[o + 4] = y;
    positions[o + 5] = z - right.y * half;
    normals[o] = normals[o + 3] = 0;
    normals[o + 1] = normals[o + 4] = 1;
    normals[o + 2] = normals[o + 5] = 0;
    uvs[n] = uvs[n + 2] = u;
    uvs[n + 1] = 0;
    uvs[n + 3] = 1;
  }

  function rebuildTrack() {
    const pts: Sample[] = samples.slice();
    const tail = pts[pts.length - 1];
    if (!tail || (pos.x - tail.x) ** 2 + (pos.y - tail.z) ** 2 > 1e-6) {
      pts.push({ x: pos.x, z: pos.y, s: distance });
    }
    if (pts.length < 2) {
      trackGeo.setDrawRange(0, 0);
      return;
    }
    const oldest = pts[0]!.s;
    let count = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      if (i === pts.length - 1) tangent.set(Math.sin(heading), Math.cos(heading));
      else {
        const next = pts[Math.min(pts.length - 1, i + 1)]!;
        const prev = pts[Math.max(0, i - 1)]!;
        tangent.set(next.x - prev.x, next.z - prev.z);
        if (tangent.lengthSq() < 1e-8) tangent.set(Math.sin(heading), Math.cos(heading));
        else tangent.normalize();
      }
      right.set(tangent.y, -tangent.x);
      writePair(count++, p.x, 0.016 + (p.s - oldest) * 0.0003, p.z, (p.s - RADIUS * Math.PI * 0.5) / PITCH);
    }
    trackGeo.setDrawRange(0, Math.max(0, count - 1) * 6);
    trackGeo.attributes.position!.needsUpdate = true;
    trackGeo.attributes.normal!.needsUpdate = true;
    trackGeo.attributes.uv!.needsUpdate = true;
    trackGeo.computeBoundingSphere();
  }

  const camOffset = new THREE.Vector3(4.6, 3.55, 6.7);
  const camPos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const desired = new THREE.Vector3();

  function aspectFit() {
    const aspect = width() / height();
    return aspect >= 1.2 ? 1 : 1 + (1.2 - Math.max(aspect, 0.42)) * 1.25;
  }
  function introScale() {
    const k = Math.min(camBlend / 2.2, 1);
    return 1.45 - 0.45 * (1 - (1 - k) ** 3);
  }
  function frameCamera(dt: number, snap: boolean) {
    fit += (aspectFit() - fit) * (snap ? 1 : 1 - Math.exp(-3 * dt));
    desired.set(pos.x, 0, pos.y).addScaledVector(camOffset, introScale() * fit);
    lookTarget.set(pos.x, 0.62, pos.y);
    if (snap) {
      camPos.copy(desired);
      look.copy(lookTarget);
    } else {
      const n = 1 - Math.exp(-2.6 * dt);
      camPos.lerp(desired, n);
      look.lerp(lookTarget, n);
    }
    camera.position.copy(camPos);
    camera.lookAt(look);
  }

  function pose() {
    root.position.set(pos.x, RADIUS - 0.004, pos.y);
    root.rotation.y = heading;
    spinner.rotation.x = distance / RADIUS;
    blob.position.set(pos.x, 0.004, pos.y);
    blob.rotation.z = -heading;
    floor.position.set(pos.x, 0, pos.y);
    const ox = (pos.x * ROAD_REPEAT) / PLANE - 0.5 * ROAD_REPEAT;
    const oy = (pos.y * ROAD_REPEAT) / PLANE + 0.5 * ROAD_REPEAT;
    for (const tex of roadMaps) tex.offset.set(ox, oy);
    sun.position.set(pos.x + 5.2, 11.5, pos.y + 2.4);
    sun.target.position.set(pos.x, 0.4, pos.y);
  }

  pose();
  frameCamera(1, true);
  rebuildTrack();

  let lastEmit = 0;
  function emit(force = false) {
    const now = performance.now();
    if (!force && now - lastEmit < 180) return;
    lastEmit = now;
    onStats({ meters: distance, paused, steered });
  }
  emit(true);

  let running = true;
  let raf = 0;
  let lastTick = performance.now();
  let sinceStart = 0;
  let frameMs = 16.7;
  let ratioAt = 0;

  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min((now - lastTick) / 1000, 1 / 30);
    lastTick = now;
    sinceStart += dt;
    if (!paused) {
      placeTarget(elapsed + sinceStart, dt);
      step(dt);
      pose();
      rebuildTrack();
    }
    camBlend += dt;
    frameCamera(dt, false);
    frameMs += (dt * 1000 - frameMs) * 0.05;
    if (now - ratioAt > 1200) {
      if (frameMs > 24 && ratio > 1) {
        ratio = Math.max(1, ratio - 0.25);
        renderer.setPixelRatio(ratio);
        renderer.setSize(width(), height(), false);
        ratioAt = now;
      } else if (frameMs < 14 && ratio < maxRatio) {
        ratio = Math.min(maxRatio, ratio + 0.25);
        renderer.setPixelRatio(ratio);
        renderer.setSize(width(), height(), false);
        ratioAt = now;
      }
    }
    renderer.render(scene, camera);
    emit();
  }

  function width() {
    return host.clientWidth || 1;
  }
  function height() {
    return host.clientHeight || 1;
  }
  function resize() {
    camera.aspect = width() / height();
    camera.updateProjectionMatrix();
    renderer.setSize(width(), height(), false);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  let pageVisible = true;
  let inView = true;
  const onVisibility = () => {
    pageVisible = document.visibilityState !== "hidden";
    syncRun();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const intersection = new IntersectionObserver((entries) => {
    inView = entries[0]?.isIntersecting ?? true;
    syncRun();
  });
  intersection.observe(host);
  function syncRun() {
    const should = pageVisible && inView;
    if (should && !running) {
      running = true;
      lastTick = performance.now();
      raf = requestAnimationFrame(tick);
    } else if (!should && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  }

  raf = requestAnimationFrame(tick);

  return () => {
    dead = true;
    running = false;
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    host.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerdown", onDown);
    host.removeEventListener("pointerup", onUp);
    host.removeEventListener("pointercancel", onCancel);
    for (const geo of geos) geo.dispose();
    for (const mat of mats) mat.dispose();
    for (const tex of texs) tex.dispose();
    renderer.dispose();
    canvas.remove();
  };
}

function tireLathe() {
  const rim = RADIUS * 0.7;
  const steps = 56;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = (t - 0.5) * WIDTH;
    const ax = Math.abs(y);
    let r: number;
    if (ax < 0.3) {
      r = GROOVE_R + 0.003 * (1 - (ax / 0.3) ** 2);
    } else if (ax < 0.355) {
      const k = (ax - 0.3) / 0.055;
      const s = k * k * (3 - 2 * k);
      r = GROOVE_R + (RADIUS - 0.008 - GROOVE_R) * s;
    } else {
      const span = WIDTH / 2 - 0.355;
      const k = Math.min((ax - 0.355) / span, 1);
      const s = k * k * (3 - 2 * k);
      const shoulder = RADIUS - 0.008;
      const bulge = Math.sin(k * Math.PI) * 0.01;
      r = shoulder * (1 - s) + rim * s + bulge * (1 - s);
    }
    pts.push(new THREE.Vector2(r, y));
  }
  return new THREE.LatheGeometry(pts, 96);
}

function paintAsphalt() {
  const size = 1024;
  const color = document.createElement("canvas");
  const height = document.createElement("canvas");
  const rough = document.createElement("canvas");
  color.width = height.width = rough.width = size;
  color.height = height.height = rough.height = size;
  const ctx = color.getContext("2d")!;
  const htx = height.getContext("2d")!;
  const rtx = rough.getContext("2d")!;
  ctx.fillStyle = "#3c3a36";
  ctx.fillRect(0, 0, size, size);
  htx.fillStyle = "#808080";
  htx.fillRect(0, 0, size, size);
  rtx.fillStyle = "#d0d0d0";
  rtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 36; i++) {
    const tone = 58 + Math.random() * 36;
    ctx.fillStyle = `rgba(${tone},${tone - 2},${tone - 6},${0.18 + Math.random() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(
      Math.random() * size,
      Math.random() * size,
      70 + Math.random() * 220,
      28 + Math.random() * 90,
      Math.random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  const stones: Array<[number, number, number]> = [
    [42, 40, 38],
    [78, 74, 68],
    [168, 160, 148],
    [112, 86, 68],
    [92, 90, 86],
    [196, 190, 182],
    [54, 52, 48],
  ];
  for (let i = 0; i < 7000; i++) {
    const tone = stones[i % stones.length]!;
    const roll = Math.random();
    const s = roll < 0.12 ? 5 + Math.random() * 7 : roll < 0.4 ? 2.5 + Math.random() * 3 : 1.2;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const j = (Math.random() - 0.5) * 22;
    ctx.fillStyle = `rgb(${Math.max(0, tone[0] + j)},${Math.max(0, tone[1] + j)},${Math.max(0, tone[2] + j)})`;
    ctx.fillRect(x, y, s, s * (0.55 + Math.random() * 0.8));
    if (s > 4) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(x, y, Math.max(1, s * 0.35), 1);
    }
    const bump = s > 4 ? 210 : tone[0] > 140 ? 170 : 78;
    htx.fillStyle = `rgb(${bump},${bump},${bump})`;
    htx.fillRect(x, y, s, s);
    const shine = tone[0] > 150 ? 120 : 210;
    rtx.fillStyle = `rgb(${shine},${shine},${shine})`;
    rtx.fillRect(x, y, s, s);
  }
  for (let i = 0; i < 14000; i++) {
    const n = 30 + Math.random() * 50;
    ctx.fillStyle = `rgba(${n},${n},${n - 2},${0.25 + Math.random() * 0.35})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }

  ctx.strokeStyle = "rgba(22,20,18,0.55)";
  ctx.lineWidth = 1.4;
  htx.strokeStyle = "#3a3a3a";
  htx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.beginPath();
    htx.beginPath();
    ctx.moveTo(x, y);
    htx.moveTo(x, y);
    const steps = 5 + Math.floor(Math.random() * 4);
    for (let k = 0; k < steps; k++) {
      x += (Math.random() - 0.5) * 160;
      y += (Math.random() - 0.35) * 70;
      ctx.lineTo(x, y);
      htx.lineTo(x, y);
    }
    ctx.stroke();
    htx.stroke();
  }

  const seam = size * 0.63;
  ctx.fillStyle = "rgba(18,16,14,0.62)";
  ctx.fillRect(0, seam, size, 5);
  htx.fillStyle = "#2e2e2e";
  htx.fillRect(0, seam, size, 6);
  rtx.fillStyle = "#8a8a8a";
  rtx.fillRect(0, seam, size, 7);

  for (let i = 0; i < 3; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const stain = ctx.createRadialGradient(x, y, 4, x, y, 40 + Math.random() * 50);
    stain.addColorStop(0, "rgba(20,18,16,0.45)");
    stain.addColorStop(1, "rgba(20,18,16,0)");
    ctx.fillStyle = stain;
    ctx.beginPath();
    ctx.arc(x, y, 90, 0, Math.PI * 2);
    ctx.fill();
    const wet = rtx.createRadialGradient(x, y, 4, x, y, 70);
    wet.addColorStop(0, "rgba(40,40,40,0.85)");
    wet.addColorStop(1, "rgba(40,40,40,0)");
    rtx.fillStyle = wet;
    rtx.beginPath();
    rtx.arc(x, y, 70, 0, Math.PI * 2);
    rtx.fill();
  }

  return { color, normal: heightToNormal(height), rough };
}

function heightToNormal(src: HTMLCanvasElement) {
  const w = src.width;
  const h = src.height;
  const data = src.getContext("2d")!.getImageData(0, 0, w, h).data;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const img = out.getContext("2d")!.createImageData(w, h);
  const strength = 3.2;
  const sample = (x: number, y: number) => {
    const xx = (x + w) % w;
    const yy = (y + h) % h;
    return data[(yy * w + xx) * 4]! / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = sample(x + 1, y) - sample(x - 1, y);
      const dy = sample(x, y + 1) - sample(x, y - 1);
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  out.getContext("2d")!.putImageData(img, 0, 0);
  return out;
}

function paintSidewall(bumpOnly: boolean) {
  const w = 2048;
  const h = 512;
  const color = document.createElement("canvas");
  const bump = document.createElement("canvas");
  color.width = bump.width = w;
  color.height = bump.height = h;
  const ctx = color.getContext("2d")!;
  const btx = bump.getContext("2d")!;
  ctx.fillStyle = "#1c1c20";
  ctx.fillRect(0, 0, w, h);
  btx.fillStyle = "#808080";
  btx.fillRect(0, 0, w, h);
  for (let i = 0; i < 6000; i++) {
    const n = 16 + Math.random() * 24;
    ctx.fillStyle = `rgba(${n},${n},${n},${0.35})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 1);
  }
  ctx.fillStyle = "#121214";
  ctx.fillRect(0, 0.34 * h, w, 0.32 * h);

  const ring = (y: number, shade: string, lift: string) => {
    ctx.fillStyle = shade;
    ctx.fillRect(0, y, w, 3);
    btx.fillStyle = lift;
    btx.fillRect(0, y, w, 3);
  };
  ring(0.1 * h, "#2a2a2e", "#9a9a9a");
  ring(0.22 * h, "#141416", "#6a6a6a");
  ring(0.78 * h, "#141416", "#6a6a6a");
  ring(0.9 * h, "#2a2a2e", "#9a9a9a");

  if (!bumpOnly) {
    ctx.fillStyle = "#3e3e44";
    ctx.textBaseline = "middle";
    const marks: Array<[string, number, number, string]> = [
      ["TREAD", 0.08, 0.155, "700 54px 'Instrument Sans', sans-serif"],
      ["245/40ZR18  97Y", 0.3, 0.155, "600 36px 'Instrument Sans', sans-serif"],
      ["RADIAL  ·  TUBELESS", 0.52, 0.155, "600 32px 'Instrument Sans', sans-serif"],
      ["M+S    MAX LOAD 730KG", 0.74, 0.155, "600 28px 'Instrument Sans', sans-serif"],
      ["TREAD", 0.12, 0.845, "700 54px 'Instrument Sans', sans-serif"],
      ["245/40ZR18  97Y", 0.4, 0.845, "600 36px 'Instrument Sans', sans-serif"],
      ["OUTSIDE", 0.68, 0.845, "600 30px 'Instrument Sans', sans-serif"],
    ];
    for (const [text, u, v, font] of marks) {
      ctx.font = font;
      btx.font = font;
      btx.fillStyle = "#c8c8c8";
      btx.textBaseline = "middle";
      const x = u * w;
      const y = v * h;
      ctx.fillText(text, x, y);
      btx.fillText(text, x, y);
    }
  }
  return { color, bump };
}

function paintBlockFace() {
  const w = 128;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2c2c30";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) {
    const n = 18 + Math.random() * 30;
    ctx.fillStyle = `rgba(${n},${n},${n},0.45)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
  ctx.fillStyle = "#0c0c0e";
  ctx.fillRect(0, 16, w, 2);
  ctx.fillRect(0, 33, w, 1);
  ctx.fillRect(0, 48, w, 2);
  return canvas;
}

function paintTrack() {
  const w = 512;
  const h = 280;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#141210";
  for (const rib of RIBS) {
    const len = 1 - rib.gap;
    const u0 = rib.shift % 1;
    const v0 = (rib.x - rib.w / 2 + TREAD_HALF) / (TREAD_HALF * 2);
    const bw = len * w;
    const bh = (rib.w / (TREAD_HALF * 2)) * h;
    const x = u0 * w;
    const y = v0 * h;
    const draw = (px: number) => {
      roundRect(ctx, px, y + bh * 0.08, bw, bh * 0.84, 8);
      ctx.fill();
      ctx.fillStyle = "rgba(8,8,8,0.55)";
      ctx.fillRect(px + bw * 0.33, y + bh * 0.16, Math.max(2, bw * 0.035), bh * 0.68);
      ctx.fillRect(px + bw * 0.66, y + bh * 0.16, Math.max(2, bw * 0.035), bh * 0.68);
      ctx.fillStyle = "#141210";
    };
    draw(x);
    if (x + bw > w) draw(x - w);
  }
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const edge = Math.min(1, v / 0.06, (1 - v) / 0.06);
    const feather = edge * edge * (3 - 2 * edge);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = img.data[i + 3]!;
      const dark = img.data[i]!;
      const sipe = ink > 8 && dark < 16;
      img.data[i] = 24;
      img.data[i + 1] = 20;
      img.data[i + 2] = 16;
      img.data[i + 3] = ink > 8 ? Math.round((sipe ? 64 : 196) * feather) : Math.round(14 * feather);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function paintBlob() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.45, "rgba(0,0,0,0.22)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
