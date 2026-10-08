import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export type TireStats = {
  meters: number;
  paused: boolean;
  steered: boolean;
};

const RADIUS = 1.06;
const WIDTH = 0.78;
const PITCH = 0.52;
const CIRC = Math.PI * 2 * RADIUS;
const STUDIO = 0xebeaee;
const MAX_SAMPLES = 760;

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
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(STUDIO);
  scene.fog = new THREE.Fog(STUDIO, 18, 46);
  scene.environmentIntensity = 0.55;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(34, width() / height(), 0.4, 200);

  scene.add(new THREE.HemisphereLight(0xfffaf6, 0xd5d3db, 0.55));
  const sun = new THREE.DirectionalLight(0xfff7ee, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 36;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xd7e0ff, 0.45);
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

  const floorTex = keepTex(new THREE.CanvasTexture(paintFloor()));
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(24, 24);
  const floor = new THREE.Mesh(
    keepGeo(new THREE.PlaneGeometry(400, 400)),
    keepMat(new THREE.MeshStandardMaterial({ color: 0xffffff, map: floorTex, roughness: 0.96, metalness: 0 })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const tireMap = keepTex(new THREE.CanvasTexture(paintTire(false)));
  tireMap.wrapS = THREE.RepeatWrapping;
  let dead = false;
  void document.fonts.ready.then(() => {
    if (dead) return;
    tireMap.image = paintTire(false);
    tireMap.needsUpdate = true;
  });
  const tireBump = keepTex(new THREE.CanvasTexture(paintTire(true)), false);
  tireBump.wrapS = THREE.RepeatWrapping;

  const rubber = keepMat(
    new THREE.MeshStandardMaterial({
      map: tireMap,
      bumpMap: tireBump,
      bumpScale: 0.045,
      roughness: 0.62,
      metalness: 0.08,
    }),
  );

  const root = new THREE.Group();
  const spinner = new THREE.Group();
  root.add(spinner);
  scene.add(root);

  const carcass = new THREE.Mesh(keepGeo(tireLathe()), rubber);
  carcass.rotation.z = Math.PI / 2;
  carcass.castShadow = true;
  carcass.receiveShadow = true;
  spinner.add(carcass);

  const alloy = keepMat(new THREE.MeshStandardMaterial({ color: 0xd5d8de, roughness: 0.22, metalness: 0.92 }));
  const alloyDark = keepMat(new THREE.MeshStandardMaterial({ color: 0x6e737c, roughness: 0.3, metalness: 0.85 }));
  const ink = keepMat(new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.4, metalness: 0.35 }));
  const pinline = keepMat(new THREE.MeshStandardMaterial({ color: 0xe4551f, roughness: 0.4, metalness: 0.2 }));

  const rimR = RADIUS * 0.56;
  const spokeGeo = keepGeo(new THREE.BoxGeometry(0.075, rimR * 0.78, 0.05));
  spokeGeo.translate(0, rimR * 0.46, 0.02);
  const lipGeo = keepGeo(new THREE.TorusGeometry(rimR, 0.028, 10, 48));
  const hubGeo = keepGeo(new THREE.CylinderGeometry(0.13, 0.15, 0.07, 24));
  const discGeo = keepGeo(new THREE.CylinderGeometry(RADIUS * 0.48, RADIUS * 0.48, 0.025, 32));
  const lugGeo = keepGeo(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 8));
  const pinGeo = keepGeo(new THREE.TorusGeometry(0.1, 0.008, 8, 24));

  for (const side of [-1, 1] as const) {
    const face = new THREE.Group();
    face.position.x = side * (WIDTH / 2 - 0.02);
    face.rotation.y = side === 1 ? Math.PI / 2 : -Math.PI / 2;
    spinner.add(face);

    const disc = new THREE.Mesh(discGeo, alloyDark);
    disc.rotation.x = Math.PI / 2;
    disc.position.z = -0.06;
    face.add(disc);

    const lip = new THREE.Mesh(lipGeo, alloy);
    lip.castShadow = true;
    face.add(lip);

    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(spokeGeo, alloy);
      spoke.rotation.z = (i / 5) * Math.PI * 2 + 0.18;
      spoke.castShadow = true;
      face.add(spoke);
    }

    const hub = new THREE.Mesh(hubGeo, ink);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.03;
    face.add(hub);

    const pin = new THREE.Mesh(pinGeo, pinline);
    pin.position.z = 0.066;
    face.add(pin);

    for (let i = 0; i < 5; i++) {
      const lug = new THREE.Mesh(lugGeo, alloy);
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      lug.rotation.x = Math.PI / 2;
      lug.position.set(Math.cos(a) * 0.082, Math.sin(a) * 0.082, 0.055);
      face.add(lug);
    }
  }

  const valveGeo = keepGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.07, 8));
  valveGeo.rotateZ(Math.PI / 2);
  const valve = new THREE.Mesh(valveGeo, ink);
  valve.position.set(WIDTH / 2 - 0.02, RADIUS * 0.78, 0);
  spinner.add(valve);

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
        roughness: 0.88,
        metalness: 0,
        transparent: true,
        alphaTest: 0.35,
        depthWrite: true,
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

  const half = 0.3;
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
      writePair(count++, p.x, 0.012 + (p.s - oldest) * 0.00035, p.z, p.s / PITCH);
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
    return aspect >= 1.2 ? 1 : 1 + (1.2 - Math.max(aspect, 0.45)) * 0.9;
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
    root.position.set(pos.x, RADIUS - 0.01, pos.y);
    root.rotation.y = heading;
    spinner.rotation.x = distance / RADIUS;
    blob.position.set(pos.x, 0.004, pos.y);
    blob.rotation.z = -heading;
    floor.position.set(pos.x, 0, pos.y);
    sun.position.set(pos.x + 4.4, 8.4, pos.y + 3.2);
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
  const bead = RADIUS * 0.64;
  const steps = 32;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = (t - 0.5) * WIDTH;
    const edge = Math.abs(t - 0.5) * 2;
    const crown = Math.cos(Math.min(edge, 1) * Math.PI * 0.5);
    const rounded = bead + (RADIUS - bead) * Math.pow(crown, 0.72);
    const flat = edge < 0.16 ? 1 : edge > 0.34 ? 0 : 1 - (edge - 0.16) / 0.18;
    pts.push(new THREE.Vector2(THREE.MathUtils.lerp(rounded, RADIUS, flat), y));
  }
  return new THREE.LatheGeometry(pts, 72);
}

function paintFloor() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#e7e6ea";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1600; i++) {
    const shade = 80 + Math.random() * 50;
    ctx.fillStyle = `rgba(${shade},${shade - 1},${shade + 6},${0.035 + Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 1.6, 1);
  }
  return canvas;
}

function paintTire(bump: boolean) {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bump ? "#808080" : "#2a2a30";
  ctx.fillRect(0, 0, w, h);

  if (!bump) {
    ctx.fillStyle = "#ece7df";
    ctx.font = "600 30px 'Instrument Sans', sans-serif";
    ctx.textBaseline = "middle";
    const line = "TREAD    245/40 ZR 18    TUBELESS    ";
    const lineW = ctx.measureText(line).width;
    for (const y of [0.2 * h, 0.8 * h]) {
      for (let x = 0; x < w + lineW; x += lineW) ctx.fillText(line, x, y);
    }
    ctx.fillStyle = "#e4551f";
    ctx.fillRect(0, 0.3 * h, w, 5);
    ctx.fillRect(0, 0.69 * h, w, 5);
    ctx.fillStyle = "rgba(236,231,223,0.45)";
    ctx.fillRect(0, 0.312 * h, w, 2);
    ctx.fillRect(0, 0.702 * h, w, 2);
  }

  const treadTop = 0.36 * h;
  const treadH = 0.28 * h;
  ctx.fillStyle = bump ? "#3a3a3a" : "#141418";
  ctx.fillRect(0, treadTop, w, treadH);

  const rows = 3;
  const cycles = Math.round(CIRC / PITCH);
  const rowH = treadH / rows;
  ctx.fillStyle = bump ? "#f0f0f0" : "#3c3c44";
  for (let row = 0; row < rows; row++) {
    const shift = row === 1 ? 0.5 : 0;
    for (let c = 0; c < cycles; c++) {
      const x = ((c + shift) / cycles) * w;
      const bw = (0.62 / cycles) * w;
      roundRect(ctx, x, treadTop + row * rowH + rowH * 0.16, bw, rowH * 0.68, 7);
      ctx.fill();
    }
  }
  return canvas;
}

function paintTrack() {
  const w = 256;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  const rows = 3;
  const rowH = h / rows;
  for (let row = 0; row < rows; row++) {
    const shift = row === 1 ? 0.5 : 0;
    const x = shift * w;
    const bw = 0.62 * w;
    const y = row * rowH + rowH * 0.14;
    const bh = rowH * 0.72;
    const grad = ctx.createLinearGradient(0, y, 0, y + bh);
    grad.addColorStop(0, "#2a2a30");
    grad.addColorStop(0.45, "#121216");
    grad.addColorStop(1, "#1c1c22");
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, bw, bh, 8);
    ctx.fill();
    if (x + bw > w) {
      roundRect(ctx, x - w, y, bw, bh, 8);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(x + 8, y + 4, Math.max(0, bw - 16), 2);
  }
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
  g.addColorStop(0, "rgba(18,18,20,0.38)");
  g.addColorStop(0.5, "rgba(18,18,20,0.12)");
  g.addColorStop(1, "rgba(18,18,20,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
