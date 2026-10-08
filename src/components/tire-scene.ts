import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export type TireStats = {
  meters: number;
  paused: boolean;
  steered: boolean;
};

const RADIUS = 1.06;
const WIDTH = 0.8;
const PITCH = 0.186;
const TREAD_DEPTH = 0.026;
const TREAD_HALF = 0.34;
const STUDIO = 0xe6e4e0;
const ROAD_REPEAT = 32;
const PLANE = 400;
const MAX_SAMPLES = 760;

type Rib = { x0: number; x1: number; gap: number; shift: number; sipes: number };
const RIBS: Rib[] = [
  { x0: -0.332, x1: -0.246, gap: 0.045, shift: 0, sipes: 1 },
  { x0: -0.208, x1: -0.072, gap: 0.05, shift: 0.5, sipes: 2 },
  { x0: -0.038, x1: 0.038, gap: 0.04, shift: 0.18, sipes: 2 },
  { x0: 0.072, x1: 0.208, gap: 0.05, shift: 0.68, sipes: 2 },
  { x0: 0.246, x1: 0.332, gap: 0.04, shift: 0.28, sipes: 1 },
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
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(STUDIO);
  scene.fog = new THREE.Fog(STUDIO, 20, 52);
  scene.environmentIntensity = 0.72;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(34, width() / height(), 0.4, 200);

  scene.add(new THREE.HemisphereLight(0xf4f2ee, 0xd9d5ce, 0.95));
  const sun = new THREE.DirectionalLight(0xfffaf6, 1.45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 36;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.008;
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
        normalScale: new THREE.Vector2(0.18, 0.18),
        roughnessMap: floorRough,
        roughness: 0.88,
        metalness: 0.02,
      }),
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const side = paintSidewall();
  const sideMap = keepTex(new THREE.CanvasTexture(side.color));
  const sideBump = keepTex(new THREE.CanvasTexture(side.bump), false);
  const sideRough = keepTex(new THREE.CanvasTexture(side.rough), false);
  let dead = false;
  void document.fonts.ready.then(() => {
    if (dead) return;
    const next = paintSidewall();
    sideMap.image = next.color;
    sideMap.needsUpdate = true;
    sideBump.image = next.bump;
    sideBump.needsUpdate = true;
  });

  const carcassMat = keepMat(
    new THREE.MeshPhysicalMaterial({
      map: sideMap,
      bumpMap: sideBump,
      bumpScale: 0.02,
      roughnessMap: sideRough,
      roughness: 1,
      metalness: 0,
      clearcoat: 0.04,
      clearcoatRoughness: 0.72,
      envMapIntensity: 0.42,
    }),
  );

  const root = new THREE.Group();
  const spinner = new THREE.Group();
  root.add(spinner);
  scene.add(root);

  const carcass = new THREE.Mesh(keepGeo(buildTireGeometry()), carcassMat);
  carcass.castShadow = true;
  carcass.receiveShadow = true;
  spinner.add(carcass);

  const stripeMat = keepMat(
    new THREE.MeshStandardMaterial({ color: 0x6e3028, roughness: 0.48, metalness: 0.04 }),
  );
  const stripeGeo = keepGeo(new THREE.TorusGeometry(0.8, 0.0065, 8, 80));
  for (const stripeSide of [-1, 1] as const) {
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.rotation.y = Math.PI / 2;
    stripe.position.x = stripeSide * 0.362;
    spinner.add(stripe);
  }

  const alloy = keepMat(
    new THREE.MeshStandardMaterial({
      color: 0xe4e7eb,
      roughness: 0.22,
      metalness: 0.94,
      envMapIntensity: 1.25,
    }),
  );
  const alloyDark = keepMat(
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.55, metalness: 0.45 }),
  );
  const ink = keepMat(new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6, metalness: 0.15 }));
  const chrome = keepMat(
    new THREE.MeshStandardMaterial({ color: 0xe7eaee, roughness: 0.16, metalness: 0.95, envMapIntensity: 1.2 }),
  );

  const rimR = RADIUS * 0.668;
  const wheelGeo = keepGeo(buildWheel(rimR));
  const lipGeo = keepGeo(new THREE.TorusGeometry(RADIUS * 0.708, 0.013, 10, 64));
  const hubGeo = keepGeo(new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.24, 0.028, 28));
  const capGeo = keepGeo(new THREE.SphereGeometry(rimR * 0.16, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2));
  const lugGeo = keepGeo(new THREE.CylinderGeometry(0.02, 0.022, 0.016, 6));
  const discGeo = keepGeo(new THREE.CylinderGeometry(RADIUS * 0.46, RADIUS * 0.46, 0.016, 36));
  const barrelGeo = keepGeo(new THREE.CylinderGeometry(rimR * 0.96, rimR * 0.96, WIDTH * 0.5, 40, 1, true));
  barrelGeo.rotateZ(Math.PI / 2);
  spinner.add(new THREE.Mesh(barrelGeo, alloyDark));

  const depth = 0.05;
  for (const faceSide of [-1, 1] as const) {
    const face = new THREE.Group();
    face.position.x = faceSide * (WIDTH / 2 - 0.02 - depth);
    face.rotation.y = faceSide === 1 ? Math.PI / 2 : -Math.PI / 2;
    spinner.add(face);

    const disc = new THREE.Mesh(discGeo, alloyDark);
    disc.rotation.x = Math.PI / 2;
    disc.position.z = 0.01;
    face.add(disc);

    const wheel = new THREE.Mesh(wheelGeo, alloy);
    wheel.castShadow = true;
    face.add(wheel);

    const lip = new THREE.Mesh(lipGeo, alloy);
    lip.position.z = depth * 0.72;
    lip.castShadow = true;
    face.add(lip);

    const hub = new THREE.Mesh(hubGeo, ink);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = depth + 0.004;
    face.add(hub);

    const cap = new THREE.Mesh(capGeo, chrome);
    cap.rotation.x = -Math.PI / 2;
    cap.position.z = depth + 0.01;
    face.add(cap);

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const lug = new THREE.Mesh(lugGeo, chrome);
      lug.rotation.x = Math.PI / 2;
      lug.position.set(Math.cos(a) * rimR * 0.34, Math.sin(a) * rimR * 0.34, depth + 0.02);
      face.add(lug);
    }
  }

  const valveGeo = keepGeo(new THREE.CylinderGeometry(0.01, 0.012, 0.046, 8));
  valveGeo.rotateZ(Math.PI / 2);
  const valve = new THREE.Mesh(valveGeo, ink);
  valve.position.set(WIDTH / 2 - 0.012, RADIUS * 0.74, 0.16);
  spinner.add(valve);
  const capStem = keepGeo(new THREE.CylinderGeometry(0.013, 0.013, 0.014, 8));
  capStem.rotateZ(Math.PI / 2);
  const valveCap = new THREE.Mesh(capStem, chrome);
  valveCap.position.set(WIDTH / 2 + 0.016, RADIUS * 0.74, 0.16);
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

  const camOffset = new THREE.Vector3(6.6, 1.7, 4.4);
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
    lookTarget.set(pos.x, 0.48, pos.y);
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

function carcassRadius(ax: number) {
  const a = Math.abs(ax);
  const rim = RADIUS * 0.7;
  const groove = RADIUS - TREAD_DEPTH;
  if (a <= 0.3) return groove - a * a * 0.012;
  if (a <= 0.355) {
    const k = (a - 0.3) / 0.055;
    const s = k * k * (3 - 2 * k);
    return groove + (RADIUS - 0.008 - groove) * s;
  }
  const span = WIDTH / 2 - 0.355;
  const k = Math.min((a - 0.355) / span, 1);
  const s = k * k * (3 - 2 * k);
  const shoulder = RADIUS - 0.008;
  const bulge = Math.sin(Math.min(k, 1) * Math.PI) * 0.015;
  let r = shoulder * (1 - s) + rim * s + bulge * (1 - k);
  const ribAt = Math.abs(a - 0.383);
  if (ribAt < 0.005) r += 0.0045 * (1 - ribAt / 0.005);
  return r;
}

function treadLift(ax: number, ang: number) {
  const arc = ang * RADIUS;
  for (const rib of RIBS) {
    if (ax < rib.x0 || ax > rib.x1) continue;
    let phase = (arc / PITCH + rib.shift) % 1;
    if (phase < 0) phase += 1;
    if (phase < rib.gap) return 0;
    const into = (phase - rib.gap) * PITCH;
    const blockLen = (1 - rib.gap) * PITCH;
    const edge = Math.min(into, blockLen - into);
    const chamfer = Math.min(1, edge / 0.012);
    const span = rib.x1 - rib.x0;
    const axEdge = Math.min(ax - rib.x0, rib.x1 - ax);
    const axc = Math.min(1, axEdge / Math.max(0.012, span * 0.16));
    let cut = 1;
    for (let s = 1; s <= rib.sipes; s++) {
      const at = (blockLen * s) / (rib.sipes + 1);
      if (Math.abs(into - at) < 0.008) cut = 0.62;
    }
    const a = Math.abs(ax);
    let shoulder = 1;
    if (a > 0.3) {
      const k = Math.min(1, (a - 0.3) / 0.042);
      const sm = k * k * (3 - 2 * k);
      shoulder = 1 - sm;
    }
    return TREAD_DEPTH * chamfer * axc * cut * shoulder;
  }
  return 0;
}

function radiusAt(ax: number, ang: number) {
  return carcassRadius(ax) + treadLift(ax, ang);
}

function profileV(ax: number) {
  const half = WIDTH / 2;
  const tread = 0.34;
  if (ax < -tread) return ((ax + half) / (half - tread)) * 0.36;
  if (ax > tread) return 0.64 + ((ax - tread) / (half - tread)) * 0.36;
  return 0.36 + ((ax + tread) / (2 * tread)) * 0.28;
}

function axialStations() {
  const half = WIDTH / 2;
  const raw: number[] = [];
  for (let i = 0; i <= 20; i++) raw.push(-half + ((half - 0.36) * i) / 20);
  for (let i = 1; i <= 6; i++) raw.push(-0.36 + (0.06 * i) / 6);
  for (const rib of RIBS) {
    raw.push(rib.x0 - 0.003, rib.x0, rib.x0 + 0.003);
    raw.push(rib.x1 - 0.003, rib.x1, rib.x1 + 0.003);
    for (let i = 1; i <= 3; i++) raw.push(rib.x0 + ((rib.x1 - rib.x0) * i) / 4);
  }
  for (const v of [...raw]) if (v < -0.001) raw.push(-v);
  raw.push(0);
  raw.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of raw) {
    const c = Math.max(-half, Math.min(half, v));
    if (!out.length || c - out[out.length - 1]! > 0.0015) out.push(c);
  }
  return out;
}

function buildTireGeometry() {
  const around = 560;
  const axes = axialStations();
  const across = axes.length;
  const cols = around + 1;
  const positions = new Float32Array(cols * across * 3);
  const uvs = new Float32Array(cols * across * 2);
  for (let i = 0; i <= around; i++) {
    const ang = (i / around) * Math.PI * 2;
    for (let j = 0; j < across; j++) {
      const ax = axes[j]!;
      const r = radiusAt(ax, ang);
      const o = (i * across + j) * 3;
      positions[o] = ax;
      positions[o + 1] = Math.sin(ang) * r;
      positions[o + 2] = Math.cos(ang) * r;
      uvs[(i * across + j) * 2] = i / around;
      uvs[(i * across + j) * 2 + 1] = profileV(ax);
    }
  }
  const indices = new Uint32Array(around * (across - 1) * 6);
  let n = 0;
  for (let i = 0; i < around; i++) {
    for (let j = 0; j < across - 1; j++) {
      const a = i * across + j;
      const b = (i + 1) * across + j;
      const c = (i + 1) * across + j + 1;
      const d = i * across + j + 1;
      indices[n++] = a;
      indices[n++] = d;
      indices[n++] = c;
      indices[n++] = a;
      indices[n++] = c;
      indices[n++] = b;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  const normals = geo.getAttribute("normal");
  for (let i = 0; i <= around; i++) {
    const ang = (i / around) * Math.PI * 2;
    const ry = Math.sin(ang);
    const rz = Math.cos(ang);
    for (let j = 0; j < across; j++) {
      const ny = normals.getY(i * across + j);
      const nz = normals.getZ(i * across + j);
      if (ny * ry + nz * rz < 0) {
        normals.setXYZ(i * across + j, -normals.getX(i * across + j), -ny, -nz);
      }
    }
  }
  normals.needsUpdate = true;
  return geo;
}

function buildWheel(outer: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const inner = outer * 0.3;
  const win = outer * 0.84;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.04;
    const hole = new THREE.Path();
    const p = (r: number, da: number) => [Math.cos(a + da) * r, Math.sin(a + da) * r] as const;
    const pts = [p(inner, 0.12), p(win, 0.18), p(win, -0.18), p(inner, -0.12)];
    hole.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) hole.lineTo(pts[k]![0], pts[k]![1]);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.007,
    bevelSegments: 1,
    curveSegments: 20,
  });
  geo.computeVertexNormals();
  return geo;
}

function paintAsphalt() {
  const size = 512;
  const color = document.createElement("canvas");
  const height = document.createElement("canvas");
  const rough = document.createElement("canvas");
  color.width = height.width = rough.width = size;
  color.height = height.height = rough.height = size;
  const ctx = color.getContext("2d")!;
  const htx = height.getContext("2d")!;
  const rtx = rough.getContext("2d")!;
  ctx.fillStyle = "#e4e2de";
  ctx.fillRect(0, 0, size, size);
  htx.fillStyle = "#808080";
  htx.fillRect(0, 0, size, size);
  rtx.fillStyle = "#d8d8d8";
  rtx.fillRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) {
    const tone = 210 + Math.random() * 28;
    ctx.fillStyle = `rgba(${tone},${tone - 1},${tone - 4},${0.08 + Math.random() * 0.08})`;
    ctx.beginPath();
    ctx.ellipse(
      Math.random() * size,
      Math.random() * size,
      40 + Math.random() * 120,
      20 + Math.random() * 50,
      Math.random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  for (let i = 0; i < 2500; i++) {
    const n = 150 + Math.random() * 70;
    ctx.fillStyle = `rgba(${n},${n},${n - 2},${0.04 + Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
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

function paintSidewall() {
  const w = 2048;
  const h = 1024;
  const color = document.createElement("canvas");
  const bump = document.createElement("canvas");
  const rough = document.createElement("canvas");
  color.width = bump.width = rough.width = w;
  color.height = bump.height = rough.height = h;
  const ctx = color.getContext("2d")!;
  const btx = bump.getContext("2d")!;
  const rtx = rough.getContext("2d")!;
  ctx.fillStyle = "#1b1a18";
  ctx.fillRect(0, 0, w, h);
  btx.fillStyle = "#7a7a7a";
  btx.fillRect(0, 0, w, h);
  rtx.fillStyle = "#ececec";
  rtx.fillRect(0, 0, w, h);
  for (let i = 0; i < 8000; i++) {
    const n = 18 + Math.random() * 22;
    ctx.fillStyle = `rgba(${n},${n - 1},${n - 2},0.4)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 1);
  }
  ctx.fillStyle = "#141416";
  ctx.fillRect(0, 0.36 * h, w, 0.28 * h);
  rtx.fillStyle = "#8e8e8e";
  rtx.fillRect(0, 0.36 * h, w, 0.28 * h);

  const ridge = (y: number) => {
    ctx.fillStyle = "#2a2926";
    ctx.fillRect(0, y, w, 4);
    btx.fillStyle = "#b4b4b4";
    btx.fillRect(0, y, w, 5);
  };
  ridge(0.06 * h);
  ridge(0.3 * h);
  ridge(0.7 * h);
  ridge(0.94 * h);

  ctx.fillStyle = "#3a3936";
  ctx.textBaseline = "middle";
  btx.fillStyle = "#d0d0d0";
  btx.textBaseline = "middle";
  const marks: Array<[string, number, number, string]> = [
    ["TREAD", 0.06, 0.16, "700 64px 'Instrument Sans', sans-serif"],
    ["245/40ZR18  97Y", 0.28, 0.17, "600 36px 'Instrument Sans', sans-serif"],
    ["RADIAL   TUBELESS", 0.5, 0.16, "600 30px 'Instrument Sans', sans-serif"],
    ["M+S    MAX LOAD 730KG", 0.72, 0.17, "600 26px 'Instrument Sans', sans-serif"],
    ["TREAD", 0.1, 0.84, "700 64px 'Instrument Sans', sans-serif"],
    ["245/40ZR18  97Y", 0.36, 0.83, "600 36px 'Instrument Sans', sans-serif"],
    ["OUTSIDE", 0.64, 0.84, "600 28px 'Instrument Sans', sans-serif"],
  ];
  for (const [text, u, v, font] of marks) {
    ctx.font = font;
    btx.font = font;
    ctx.fillText(text, u * w, v * h);
    btx.fillText(text, u * w, v * h);
  }
  return { color, bump, rough };
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
    let u0 = (rib.gap - rib.shift) % 1;
    if (u0 < 0) u0 += 1;
    const v0 = (rib.x0 + TREAD_HALF) / (TREAD_HALF * 2);
    const bw = len * w;
    const bh = ((rib.x1 - rib.x0) / (TREAD_HALF * 2)) * h;
    const x = u0 * w;
    const y = v0 * h;
    const draw = (px: number) => {
      roundRect(ctx, px, y + bh * 0.06, bw, bh * 0.88, 6);
      ctx.fill();
      ctx.fillStyle = "rgba(8,8,8,0.7)";
      for (let s = 1; s <= rib.sipes; s++) {
        const sx = px + bw * (s / (rib.sipes + 1));
        ctx.fillRect(sx, y + bh * 0.14, Math.max(2, bw * 0.045), bh * 0.72);
      }
      ctx.fillStyle = "#141210";
    };
    draw(x);
    if (x + bw > w) draw(x - w);
  }
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const edge = Math.min(1, v / 0.035, (1 - v) / 0.035);
    const feather = edge * edge * (3 - 2 * edge);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = img.data[i + 3]!;
      const dark = img.data[i]!;
      const sipe = ink > 8 && dark < 16;
      img.data[i] = 18;
      img.data[i + 1] = 18;
      img.data[i + 2] = 18;
      img.data[i + 3] = ink > 8 ? Math.round((sipe ? 80 : 235) * feather) : 0;
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
