// The cenote. Loaded after first paint, never under prefers-reduced-motion.
//
// Looking down a limestone shaft. Each depth is one layer of the harness, and the page's scroll
// position is the camera's depth:
//   -18  seats and generations: each seat is a light with tree rings, one ring per past generation;
//        a handoff grows a new ring that flashes ochre (the readback) and then settles
//   -28  messages: packets fly between named seats and often get a reply; a message to a busy
//        seat waits beside it and is delivered when its turn ends
//   -38  memory: a seat at the centre of what it remembers; it restarts, its light goes out, the
//        facts stay lit, and the next generation re-links to every one of them
// Seats carry HTML name labels (example names) projected from 3D every frame.
//   -49  approvals: one ochre card rises toward the surface, toward you
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  DoubleSide,
} from 'three';
import { RUNTIMES, type Runtime } from './runtimes';

// Each layer sits ~7 units below where the camera is when that layer's panel is mid-screen
// (camera y = CAM_TOP + (CAM_BOTTOM - CAM_TOP) * depth; panels at depth .3 / .5 / .7 / .88).
const Y = { seats: -18.5, messages: -28.5, memory: -38, approvals: -49 };
const CAM_TOP = 3;
const CAM_BOTTOM = -45;

const LIGHT = new Color('#f4fbf6');
const MAYA = new Color('#a6e3dc');
const OCHRE = new Color('#e2a94f');
const SAND = new Color('#f3e6c4');

// example names only; nothing here names a real seat
const SEAT_NAMES = ['gm', 'pm-web', 'dev-api', 'dev-ui', 'reviewer', 'docs', 'qa', 'release', 'research', 'infra', 'design'];
const TALKER_NAMES = ['planner', 'dev-auth', 'dev-db', 'tests', 'pm-mobile', 'designer', 'ops', 'scout', 'writer', 'dev-search', 'triage', 'data', 'support', 'perf', 'i18n', 'billing', 'security', 'a11y', 'devrel', 'mobile', 'sdk', 'analytics'];
// which CLI each seat runs on: the general manager is Claude; the rest mix the three runtimes the
// OrchestraOS README supports
const RUNTIME_CYCLE: Runtime[] = ['claude', 'codex', 'claude', 'gemini'];
const runtimeFor = (i: number): Runtime => (i === 0 ? 'claude' : RUNTIME_CYCLE[i % RUNTIME_CYCLE.length]);
const FACT_LABELS = ['tests: make test', 'deploy from main only', 'keys live in env', 'ask before deleting data', 'small commits'];

type Node = {
  pos: Vector3;
  color: Color;
  size: number;
  alpha: number;
  target: number; // alpha it is fading toward
  live: boolean;
  drift: number;
};
// a and b are LIVE references to the two orbs' positions, so a line's ends stay on the orb centres
// however the orbs float
type Thread = { a: Vector3; b: Vector3; color: Color; life: number; max: number; message: boolean };

export function mount(canvas: HTMLCanvasElement) {
  const mobile = Math.min(innerWidth, innerHeight) < 700;
  let renderer: WebGLRenderer;
  try {
    // Opaque on purpose: an alpha canvas composited over the page turns every fading additive glow
    // into a dark ring (the glow writes alpha with dim colour). We clear to the water colour instead.
    renderer = new WebGLRenderer({ canvas, alpha: false, antialias: !mobile, powerPreference: 'low-power' });
  } catch {
    return; // no WebGL: the page is already complete without us
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
  renderer.setClearColor(0xe9e3d3, 1);

  const scene = new Scene();
  const fog = new Fog(0xe9e3d3, 2, 26);
  scene.fog = fog;

  const camera = new PerspectiveCamera(55, 1, 0.1, 140);
  camera.position.set(0, CAM_TOP, 2.2);
  camera.rotation.x = -Math.PI / 2 + 0.32;

  scene.add(new HemisphereLight(0xffffff, 0x0b4f52, 1.15));
  const sun = new DirectionalLight(0xfff6e0, 1.5);
  sun.position.set(2, 10, 3);
  scene.add(sun);

  // ---- the shaft: a narrow mouth that opens into a bell, limestone fading into teal
  const shaft = new CylinderGeometry(8, 8, 84, mobile ? 40 : 64, mobile ? 50 : 84, true);
  shaft.translate(0, -38, 0);
  const sp = shaft.attributes.position as BufferAttribute;
  const shaftColors = new Float32Array(sp.count * 3);
  const top = new Color('#efe9da');
  const mid = new Color('#5fb8b3');
  const low = new Color('#0b4f52');
  const c = new Color();
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i);
    const y = sp.getY(i);
    const z = sp.getZ(i);
    const th = Math.atan2(z, x);
    const bell = 1 + 0.55 * smooth(-2, -22, y);
    const rough = 1.1 * Math.sin(3 * th + y * 0.17) + 0.6 * Math.sin(7 * th - y * 0.31) + 0.35 * Math.sin(13 * th + y * 0.9);
    const r = 8 * bell + rough;
    sp.setXYZ(i, Math.cos(th) * r, y, Math.sin(th) * r);
    const t = smooth(4, -40, y);
    c.copy(top).lerp(mid, Math.min(1, t * 1.6)).lerp(low, Math.max(0, t * 1.6 - 0.6));
    shaftColors.set([c.r, c.g, c.b], i * 3);
  }
  shaft.setAttribute('color', new BufferAttribute(shaftColors, 3));
  shaft.computeVertexNormals();
  scene.add(new Mesh(shaft, new MeshLambertMaterial({ vertexColors: true, side: BackSide, flatShading: true })));

  // ---- the lights: one pooled Points object for every seat and pulse
  const MAX = 200;
  const nodes: Node[] = Array.from({ length: MAX }, () => ({
    pos: new Vector3(),
    color: new Color(),
    size: 0,
    alpha: 0,
    target: 0,
    live: false,
    drift: Math.random() * 6.28,
  }));
  const npos = new Float32Array(MAX * 3);
  const ncol = new Float32Array(MAX * 3);
  const nsize = new Float32Array(MAX);
  const nalpha = new Float32Array(MAX);
  const ngeo = new BufferGeometry();
  ngeo.setAttribute('position', new BufferAttribute(npos, 3));
  ngeo.setAttribute('color', new BufferAttribute(ncol, 3));
  ngeo.setAttribute('size', new BufferAttribute(nsize, 1));
  ngeo.setAttribute('alpha', new BufferAttribute(nalpha, 1));
  const nmat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { scale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float size; attribute float alpha;
      uniform float scale; varying vec3 vColor; varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(size * scale / -mv.z, 56.0); // a light that drifts close stays a light, not a sun
        vColor = color; vAlpha = alpha * clamp(1.0 - (-mv.z - 4.0) / 30.0, 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float halo = smoothstep(0.5, 0.0, d);
        float core = smoothstep(0.14, 0.0, d);
        gl_FragColor = vec4(vColor * halo * halo + core, (halo * 0.8 + core) * vAlpha);
      }`,
  });
  // geometries rewritten every frame: their bounding spheres are computed once (from the first,
  // often all-zero, buffer), so frustum culling would hide them. Never cull them.
  const lights = new Points(ngeo, nmat);
  lights.frustumCulled = false;
  scene.add(lights);

  const take = (): Node | null => nodes.find((n) => !n.live) ?? null;
  const spawn = (pos: Vector3, color: Color, size: number, alpha = 1): Node | null => {
    const n = take();
    if (!n) return null;
    n.pos.copy(pos);
    n.color.copy(color);
    n.size = size;
    n.alpha = 0;
    n.target = alpha;
    n.live = true;
    return n;
  };

  // ---- threads: handoffs and messages
  const MAXT = 96;
  const threads: Thread[] = [];
  const tpos = new Float32Array(MAXT * 6);
  const tcol = new Float32Array(MAXT * 8);
  const tgeo = new BufferGeometry();
  tgeo.setAttribute('position', new BufferAttribute(tpos, 3));
  tgeo.setAttribute('color', new BufferAttribute(tcol, 4));
  // fog: false — fog on an additive line ADDS the fog colour, so distant threads turned white
  // over the hero. Each thread fades by its own distance from the camera instead.
  const tmat = new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false });
  const threadLines = new LineSegments(tgeo, tmat);
  threadLines.frustumCulled = false;
  scene.add(threadLines);
  const thread = (a: Vector3, b: Vector3, color: Color, max: number, message = false) => {
    if (threads.length >= MAXT) threads.shift();
    threads.push({ a, b, color, life: 0, max, message });
  };

  // ---- labels: plain HTML over the canvas, placed from 3D each frame (crisp text, no font atlas)
  const labelLayer = document.getElementById('cenote-labels');
  type Label = { el: HTMLElement; sub: HTMLElement | null; at: () => Vector3; alpha: () => number; last: string };
  const labels: Label[] = [];
  const addLabel = (
    name: string,
    at: () => Vector3,
    alpha: () => number,
    cls = '',
    opts: { sub?: boolean; runtime?: Runtime; role?: string } = { sub: true },
  ): Label => {
    const el = document.createElement('div');
    el.className = `cl ${cls}`;
    const nm = document.createElement('span');
    nm.textContent = name;
    el.appendChild(nm);
    if (opts.role) {
      const role = document.createElement('span');
      role.className = 'role';
      role.textContent = opts.role;
      el.appendChild(role);
    }
    let sub: HTMLElement | null = null;
    if (opts.sub !== false) {
      const line = document.createElement('small');
      if (opts.runtime) {
        // the mark is static, trusted markup from runtimes.ts
        const mark = document.createElement('span');
        mark.className = 'rt';
        mark.innerHTML = RUNTIMES[opts.runtime].mark;
        line.appendChild(mark);
      }
      sub = document.createElement('span');
      line.appendChild(sub);
      el.appendChild(line);
    }
    labelLayer?.appendChild(el);
    const l = { el, sub, at, alpha, last: '' };
    labels.push(l);
    return l;
  };
  const setSub = (l: Label, text: string) => {
    if (l.sub && l.last !== text) {
      l.sub.textContent = text;
      l.last = text;
    }
  };
  const proj = new Vector3();

  // seats and generations. A seat is a light; every generation it has been through is a ring around
  // it, newest innermost, fading as it ages outward, like the rings of a tree.
  const SEATS = mobile ? 8 : 11;
  const MAX_RINGS = 6;
  const circle = new BufferGeometry();
  {
    const SEG = 64;
    const pts = new Float32Array((SEG + 1) * 3);
    for (let i = 0; i <= SEG; i++) {
      const t = (i / SEG) * Math.PI * 2;
      pts.set([Math.cos(t), 0, Math.sin(t)], i * 3);
    }
    circle.setAttribute('position', new BufferAttribute(pts, 3));
  }
  type Ring = { line: Line; mat: LineBasicMaterial; born: number; r: number };
  type Lineage = { node: Node; rings: Ring[]; handoffAt: number; gen: number; label: Label; rt: string };
  const ringRadius = (i: number) => 0.42 + i * 0.17;
  const addRing = (l: Lineage, born: number, r: number) => {
    // normal blending: additive would turn the ochre readback flash pale against the teal water
    const mat = new LineBasicMaterial({ color: MAYA.clone(), transparent: true, opacity: 0, depthWrite: false });
    const line = new Line(circle, mat);
    line.scale.setScalar(r);
    scene.add(line);
    l.rings.unshift({ line, mat, born, r });
    if (l.rings.length > MAX_RINGS) {
      const gone = l.rings.pop()!;
      scene.remove(gone.line);
      gone.mat.dispose();
    }
  };
  const seats: Lineage[] = [];
  for (let i = 0; i < SEATS; i++) {
    const a = (i / SEATS) * Math.PI * 2;
    const r = 3.2 + (i % 3) * 0.7;
    const n = spawn(new Vector3(Math.cos(a) * r, Y.seats + Math.sin(i * 2.1) * 0.8, Math.sin(a) * r), LIGHT, 24);
    if (!n) continue;
    // a history: every seat has already been through a few generations
    const past = 1 + Math.floor(Math.random() * 4);
    const rt = runtimeFor(i);
    const label = addLabel(SEAT_NAMES[i % SEAT_NAMES.length], () => n.pos, () => n.alpha, i === 0 ? 'gm' : '', {
      runtime: rt,
      role: i === 0 ? 'general manager' : undefined,
    });
    const l: Lineage = { node: n, rings: [], handoffAt: -100, gen: past + 1, label, rt: RUNTIMES[rt].name };
    for (let g = past - 1; g >= 0; g--) addRing(l, -100, ringRadius(g));
    seats.push(l);
  }
  // messages: a field of named seats handing each other work. Some are busy; mail for a busy seat
  // waits beside it and is delivered when its turn ends, so nobody is interrupted mid-task.
  type Talker = { node: Node; busy: boolean; flipAt: number; ring: Line; label: Label | null; rt: string };
  const talkers: Talker[] = [];
  const TALK = mobile ? 12 : 22;
  for (let i = 0; i < TALK; i++) {
    const a = (i / TALK) * Math.PI * 2 + Math.random() * 0.4;
    const r = 1.2 + Math.sqrt(Math.random()) * 5.6;
    const n = spawn(new Vector3(Math.cos(a) * r, Y.messages + (Math.random() - 0.5) * 3.5, Math.sin(a) * r), MAYA, 20);
    if (!n) continue;
    const ring = new Line(circle, new LineBasicMaterial({ color: OCHRE, transparent: true, opacity: 0, depthWrite: false }));
    ring.scale.setScalar(0.32);
    scene.add(ring);
    // on a phone every other seat is named, so the names don't crowd the field
    const rt = runtimeFor(i + 1);
    const label = !mobile || i % 2 === 0 ? addLabel(TALKER_NAMES[i % TALKER_NAMES.length], () => n.pos, () => n.alpha, 'talker', { runtime: rt }) : null;
    talkers.push({ node: n, busy: Math.random() < 0.2, flipAt: Math.random() * 6, ring, label, rt: RUNTIMES[rt].name });
  }
  // fly: rides the line from one orb centre to the other. wait: the receiver is busy, so it circles
  // beside it. land: the receiver is free again, so it flies into the receiver's centre. done: it
  // has been delivered and fades out inside the receiver.
  type Packet = {
    node: Node;
    from: Talker;
    to: Talker;
    state: 'fly' | 'wait' | 'land' | 'done';
    t: number;
    dur: number;
    waited: number;
    landFrom: Vector3;
    reply: boolean;
  };
  const packets: Packet[] = [];
  const send = (from: Talker, to: Talker, reply: boolean) => {
    if (packets.length >= 26) return;
    const n = spawn(from.node.pos, LIGHT, 18);
    if (!n) return;
    const dur = 0.9 + from.node.pos.distanceTo(to.node.pos) * 0.12;
    thread(from.node.pos, to.node.pos, MAYA, dur + 0.4, true);
    packets.push({ node: n, from, to, state: 'fly', t: 0, dur, waited: 0, landFrom: new Vector3(), reply });
  };
  // approvals: dim seats around the card that rises
  const askers: Node[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const n = spawn(new Vector3(Math.cos(a) * 3.6, Y.approvals, Math.sin(a) * 3.6), MAYA, 20, 0.55);
    if (n) askers.push(n);
  }

  // memory that survives a restart: a seat at the centre of the facts it has learned. Every few
  // seconds it restarts. Its light and its links go out, but the facts stay lit; the next
  // generation lights up and re-links to each fact in turn (recall).
  const memSeat = spawn(new Vector3(0, Y.memory, -0.4), LIGHT, 30)!;
  const FACTS = mobile ? 12 : 16;
  const facts: Node[] = [];
  for (let i = 0; i < FACTS; i++) {
    const a = (i / FACTS) * Math.PI * 2 + (i % 2) * 0.2;
    const r = i % 2 ? 2.9 + Math.random() * 0.5 : 1.6 + Math.random() * 0.4;
    const f = spawn(new Vector3(Math.cos(a) * r, Y.memory + (Math.random() - 0.5) * 0.6, Math.sin(a) * r - 0.4), SAND, 15);
    if (f) {
      f.drift = 0; // facts hold still: they are the part that persists
      facts.push(f);
    }
  }
  FACT_LABELS.forEach((text, i) => {
    const f = facts[i * 3 + 1];
    if (f) addLabel(text, () => f.pos, () => f.alpha, 'fact', { sub: false });
  });
  let memGen = 7;
  const memLabel = addLabel('dev-api', () => memSeat.pos, () => (memSeat.alpha < 0.1 ? 0.85 : memSeat.alpha), 'mem', { runtime: 'claude' });
  const lpos = new Float32Array(FACTS * 6);
  const lcol = new Float32Array(FACTS * 8);
  const lgeo = new BufferGeometry();
  lgeo.setAttribute('position', new BufferAttribute(lpos, 3));
  lgeo.setAttribute('color', new BufferAttribute(lcol, 4));
  const memLines = new LineSegments(lgeo, new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }));
  memLines.frustumCulled = false;
  scene.add(memLines);
  const MEM_CYCLE = 7.5;

  // a little sediment drifting down, for depth
  const SED = mobile ? 160 : 360;
  const spos = new Float32Array(SED * 3);
  const svel = new Float32Array(SED);
  for (let i = 0; i < SED; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 7.5;
    spos.set([Math.cos(a) * r, Y.memory + 6 - Math.random() * 12, Math.sin(a) * r], i * 3);
    svel[i] = 0.12 + Math.random() * 0.35;
  }
  const sgeo = new BufferGeometry();
  sgeo.setAttribute('position', new BufferAttribute(spos, 3));
  const sediment = new Points(
    sgeo,
    new PointsMaterial({ color: 0xcfe6e4, size: 0.07, map: dot(), transparent: true, opacity: 0.45, depthWrite: false }),
  );
  scene.add(sediment);
  const FLOOR = Y.memory - 6;

  // the card
  const card = new Mesh(
    new PlaneGeometry(2.4, 1.5),
    new MeshBasicMaterial({ map: cardFace(), transparent: true, opacity: 0.95, fog: false, side: DoubleSide }),
  );
  card.rotation.x = -Math.PI / 2 + 0.3;
  card.position.set(0, Y.approvals - 2, 0);
  scene.add(card);

  // ---- scroll -> depth, and the water colour behind the canvas
  const backdrop = document.getElementById('backdrop');
  const sections = [...document.querySelectorAll<HTMLElement>('[data-depth]')];
  const bgs = sections.map((s) => new Color(s.dataset.bg));
  const depths = sections.map((s) => Number(s.dataset.depth));
  const water = new Color();
  let depth = 0;
  let depthTarget = 0;
  let approvalsT = 0;
  let floorT = 0; // 0 until "Two ways to run it" comes up, 1 once it reaches mid-screen
  const readScroll = () => {
    const mid = innerHeight / 2;
    let i = 0;
    let f = 0;
    for (let k = 0; k < sections.length; k++) {
      const r = sections[k].getBoundingClientRect();
      if (r.top + r.height / 2 <= mid) {
        i = k;
        const next = sections[k + 1]?.getBoundingClientRect();
        f = next ? clamp((mid - (r.top + r.height / 2)) / (next.top + next.height / 2 - (r.top + r.height / 2)), 0, 1) : 0;
      }
    }
    if (sections[0] && sections[0].getBoundingClientRect().top + sections[0].offsetHeight / 2 > mid) {
      i = 0;
      f = 0;
    }
    const j = Math.min(i + 1, sections.length - 1);
    depthTarget = lerp(depths[i], depths[j], f);
    water.copy(bgs[i]).lerp(bgs[j], f);
    const ap = sections.find((s) => s.dataset.layer === 'approvals');
    if (ap) {
      const r = ap.getBoundingClientRect();
      approvalsT = clamp(1 - (r.top + r.height * 0.35) / innerHeight, 0, 1);
    }
    const floor = sections.find((s) => s.classList.contains('paths'));
    if (floor) floorT = smooth(0.95, 0.5, floor.getBoundingClientRect().top / innerHeight);
  };
  addEventListener('scroll', readScroll, { passive: true });

  let px = 0;
  let py = 0;
  addEventListener(
    'pointermove',
    (e) => {
      px = e.clientX / innerWidth - 0.5;
      py = e.clientY / innerHeight - 0.5;
    },
    { passive: true },
  );

  const resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 70 : 55;
    camera.updateProjectionMatrix();
    nmat.uniforms.scale.value = h * renderer.getPixelRatio() * 0.024;
    readScroll();
  };
  addEventListener('resize', resize);
  resize();
  depth = depthTarget;

  // ---- the loop
  let last = performance.now();
  let nextHandoff = 1.2;
  let nextMessage = 0.3;
  let clock = 0;
  let raf = 0;
  const minFrame = mobile ? 1000 / 31 : 0;
  let painted = false;
  let stopped = false;
  // frame-rate guard: if a weak GPU can't hold ~20fps, give the visitor the static page back
  let frames = 0;
  let slowSum = 0;

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dtRaw = now - last;
    if (dtRaw < minFrame) return;
    last = now;
    frames++;
    if (frames > 10 && frames <= 70) slowSum += dtRaw;
    if (frames === 70 && slowSum / 60 > 50 && !location.search.includes('cenote')) {
      stop();
      return;
    }
    const dt = Math.min(dtRaw / 1000, 0.05);
    clock += dt;

    // camera follows the scroll with a little inertia, and leans toward the pointer
    depth += (depthTarget - depth) * Math.min(1, dt * 4);
    camera.position.y = lerp(CAM_TOP, CAM_BOTTOM, depth);
    camera.position.x += (px * 1.4 - camera.position.x) * dt * 2;
    camera.position.z += (2.2 + py * 1.2 - camera.position.z) * dt * 2;
    fog.color.copy(water);
    renderer.setClearColor(water, 1);
    fog.far = lerp(26, 17, depth);
    if (backdrop) backdrop.style.backgroundColor = `#${water.getHexString()}`;

    // a handoff: the seat's light dips as the generation retires, a new ring grows out of the core
    // and flashes ochre while the successor proves it read the handoff, then settles into the rings
    if (clock > nextHandoff && seats.length) {
      nextHandoff = clock + 1.8 + Math.random() * 1.8;
      const l = seats[Math.floor(Math.random() * seats.length)];
      l.node.alpha = 0.15;
      l.handoffAt = clock;
      l.gen++;
      addRing(l, clock, 0.05);
    }
    for (const l of seats) {
      // the core glows ochre while the successor answers the readback, then turns back to light
      const since = clock - l.handoffAt;
      l.node.color.copy(LIGHT).lerp(OCHRE, since < 2 ? smooth(0, 0.3, since) * (1 - smooth(1.2, 2, since)) : 0);
      setSub(l.label, since < 1.8 ? `${l.rt}, gen ${l.gen}, reading handoff` : `${l.rt}, gen ${l.gen}`);
      l.rings.forEach((ring, i) => {
        const age = clock - ring.born;
        ring.r += (ringRadius(i) - ring.r) * Math.min(1, dt * 3);
        ring.line.scale.setScalar(ring.r);
        ring.line.position.copy(l.node.pos);
        const fresh = age < 2.4;
        // ochre while the readback is checked (first ~1.2s), then the ring cools to water-blue
        ring.mat.color.copy(MAYA).lerp(OCHRE, fresh ? 1 - smooth(1.0, 1.8, age) : 0);
        const settled = 0.75 * Math.pow(0.62, i);
        ring.mat.opacity = fresh ? Math.min(1, age * 3) * lerp(1, settled, smooth(1.2, 2.4, age)) : settled;
      });
    }
    // messages: a steady loop of sends across the whole field
    if (clock > nextMessage && talkers.length > 1) {
      nextMessage = clock + 0.22 + Math.random() * 0.3;
      const a = talkers[Math.floor(Math.random() * talkers.length)];
      const b = talkers[Math.floor(Math.random() * talkers.length)];
      if (a !== b) send(a, b, false);
    }
    for (const tk of talkers) {
      if (clock > tk.flipAt) {
        tk.busy = !tk.busy && Math.random() < 0.35;
        tk.flipAt = clock + (tk.busy ? 2.5 + Math.random() * 3 : 1.5 + Math.random() * 4);
      }
      const m = tk.ring.material as LineBasicMaterial;
      m.opacity += ((tk.busy ? 0.9 : 0) - m.opacity) * Math.min(1, dt * 4);
      tk.ring.position.copy(tk.node.pos);
      tk.ring.visible = m.opacity > 0.01;
      if (tk.label) setSub(tk.label, tk.busy ? `${tk.rt}, busy: mail waits` : tk.rt);
    }
    for (let i = packets.length - 1; i >= 0; i--) {
      const pk = packets[i];
      const center = pk.to.node.pos;
      if (pk.state === 'fly') {
        pk.t += dt / pk.dur;
        const u = Math.min(1, pk.t);
        // straight along the line, so the packet always sits on its thread
        pk.node.pos.copy(pk.from.node.pos).lerp(center, u * u * (3 - 2 * u));
        if (u < 1) continue;
        if (pk.to.busy) {
          pk.state = 'wait';
          pk.waited = 0;
        } else {
          pk.state = 'done';
        }
      }
      if (pk.state === 'wait') {
        // parked beside a busy seat; it circles until the seat's turn ends
        pk.waited += dt;
        const ang = pk.waited * 2.2;
        const r = 0.45 * Math.min(1, pk.waited * 4); // eases out from the centre into its orbit
        pk.node.pos.set(center.x + Math.cos(ang) * r, center.y + 0.1 * Math.min(1, pk.waited * 4), center.z + Math.sin(ang) * r);
        if (pk.to.busy) continue;
        pk.state = 'land';
        pk.t = 0;
        pk.landFrom.copy(pk.node.pos).sub(center); // offset from the centre, so landing tracks a floating orb
      }
      if (pk.state === 'land') {
        // the seat is free: the message flies into its centre
        pk.t += dt / 0.4;
        const u = Math.min(1, pk.t);
        const k = u * u * (3 - 2 * u);
        pk.node.pos.copy(center).addScaledVector(pk.landFrom, 1 - k);
        if (u < 1) continue;
        pk.state = 'done';
      }
      if (pk.state === 'done') {
        if (pk.node.target !== 0) {
          // delivered: the receiver flares, and often answers
          pk.node.target = 0;
          pk.to.node.alpha = 1.6;
          if (!pk.reply && Math.random() < 0.55) send(pk.to, pk.from, true);
        }
        // fade out inside the receiver, following it as it floats. Let go above the pool's 0.02
        // reclaim threshold, so this packet never holds a node the pool has handed to a new one.
        pk.node.pos.copy(center);
        if (pk.node.alpha < 0.05) packets.splice(i, 1);
      }
    }

    // memory: work, restart (light out, facts stay), then the next generation recalls every fact
    {
      const ph = clock % MEM_CYCLE;
      // only visible when you are down in this layer; from above it would read as a hub in the others
      const near = smooth(15, 10, camera.position.distanceTo(memSeat.pos));
      const restartAt = 4.2;
      const backAt = 5.2;
      if (ph < restartAt) {
        memSeat.target = Math.max(near, 0.05);
        setSub(memLabel, `Claude, gen ${memGen}`);
      } else if (ph < backAt) {
        memSeat.target = 0.03;
        setSub(memLabel, 'Claude, restarting');
      } else {
        if (memSeat.target < 0.05) memGen++;
        memSeat.target = Math.max(near, 0.05);
        setSub(memLabel, ph < backAt + 1.6 ? `Claude, gen ${memGen}, recalling` : `Claude, gen ${memGen}`);
      }
      for (let i = 0; i < facts.length; i++) {
        const f = facts[i];
        // the facts never go out; they glow a little brighter while the seat is down
        f.target = (ph >= restartAt && ph < backAt + 0.4 ? 1 : 0.8) * Math.max(near, 0.05);
        let a: number;
        if (ph < restartAt) a = 0.55;
        else if (ph < backAt) a = 0.55 * (1 - smooth(restartAt, restartAt + 0.5, ph));
        else a = 0.55 * smooth(backAt + 0.15 + i * 0.09, backAt + 0.45 + i * 0.09, ph);
        lpos.set([memSeat.pos.x, memSeat.pos.y, memSeat.pos.z, f.pos.x, f.pos.y, f.pos.z], i * 6);
        lcol.set([SAND.r, SAND.g, SAND.b, a * 0.5 * near, SAND.r, SAND.g, SAND.b, a * near], i * 8);
      }
      lgeo.attributes.position.needsUpdate = true;
      lgeo.attributes.color.needsUpdate = true;
    }

    // nodes: drift, fade, recycle
    for (let i = 0; i < MAX; i++) {
      const n = nodes[i];
      if (n.live) {
        n.alpha += (n.target - n.alpha) * Math.min(1, dt * 2.2);
        if (n.target === 0 && n.alpha < 0.02) n.live = false;
        if (n.drift) n.pos.y += Math.sin(clock * 0.7 + n.drift) * dt * 0.08;
      }
      npos[i * 3] = n.pos.x;
      npos[i * 3 + 1] = n.pos.y;
      npos[i * 3 + 2] = n.pos.z;
      ncol[i * 3] = n.color.r;
      ncol[i * 3 + 1] = n.color.g;
      ncol[i * 3 + 2] = n.color.b;
      nsize[i] = n.live ? n.size : 0;
      nalpha[i] = n.live ? n.alpha : 0;
    }

    // threads: draw in, hold, fade; message pulses ride along them
    let t = 0;
    for (let i = threads.length - 1; i >= 0; i--) {
      const th = threads[i];
      th.life += dt;
      if (th.life > th.max) {
        threads.splice(i, 1);
        continue;
      }
    }
    for (const th of threads) {
      const u = th.life / th.max;
      // full length from the first frame: both ends sit on the two orbs' live centres
      const end = th.b;
      const near = smooth(15, 9, camera.position.distanceTo(end));
      const a = Math.sin(Math.PI * u) * (th.message ? 0.6 : 0.8) * near;
      tpos.set([th.a.x, th.a.y, th.a.z, end.x, end.y, end.z], t * 6);
      tcol.set([th.color.r, th.color.g, th.color.b, a * 0.4, th.color.r, th.color.g, th.color.b, a], t * 8);
      t++;
    }
    tgeo.setDrawRange(0, t * 2);
    tgeo.attributes.position.needsUpdate = true;
    tgeo.attributes.color.needsUpdate = true;

    // sediment
    for (let i = 0; i < SED; i++) {
      // settle on the floor and stay; now and then one lifts and falls again
      const y = spos[i * 3 + 1] - svel[i] * dt * 0.6;
      spos[i * 3 + 1] = y > FLOOR ? y : Math.random() < dt * 0.05 ? Y.memory + 6 : FLOOR;
    }
    sgeo.attributes.position.needsUpdate = true;

    // the card rises toward you as the approvals section comes up the page
    const e = easeOut(approvalsT);
    card.position.y = lerp(Y.approvals - 2, camera.position.y - 4.2, e);
    card.position.x = Math.sin(clock * 0.6) * 0.15 * (1 - e) - (innerWidth > 900 ? 1.1 * e : 0);
    card.rotation.z = Math.sin(clock * 0.5) * 0.08 * (1 - e);
    // it fades in as the approvals section rises, and fades out as the floor section comes up
    const cardAlpha = 0.95 * smooth(0, 0.35, approvalsT) * (1 - floorT);
    card.visible = cardAlpha > 0.01;
    (card.material as MeshBasicMaterial).opacity = cardAlpha;

    ngeo.attributes.position.needsUpdate = true;
    ngeo.attributes.color.needsUpdate = true;
    ngeo.attributes.size.needsUpdate = true;
    ngeo.attributes.alpha.needsUpdate = true;

    renderer.render(scene, camera);

    // labels follow their lights; they fade with distance so only the layer you are in is named
    const W = innerWidth;
    const H = innerHeight;
    for (const l of labels) {
      const p = l.at();
      const dist = camera.position.distanceTo(p);
      const a = clamp(l.alpha(), 0, 1) * smooth(13, 8.5, dist) * smooth(2.2, 3.5, dist);
      proj.copy(p).project(camera);
      if (a < 0.03 || proj.z > 1 || Math.abs(proj.x) > 1.05 || Math.abs(proj.y) > 1.05) {
        if (l.el.style.opacity !== '0') l.el.style.opacity = '0';
        continue;
      }
      l.el.style.opacity = a.toFixed(2);
      l.el.style.transform = `translate3d(${((proj.x * 0.5 + 0.5) * W + 9).toFixed(1)}px, ${((-proj.y * 0.5 + 0.5) * H - 9).toFixed(1)}px, 0)`;
    }

    if (!painted) {
      painted = true;
      document.documentElement.classList.add('cenote-live');
    }
  };
  raf = requestAnimationFrame(tick);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    document.documentElement.classList.remove('cenote-live');
  };
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(raf);
    if (!document.hidden && !stopped) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  });
  reduce.addEventListener('change', () => reduce.matches && stop());
}

// the approval card as it looks on the watch: a question, then approve or deny
function cardFace() {
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 300;
  const g = c.getContext('2d')!;
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  };
  g.fillStyle = '#d0902f';
  round(0, 0, 480, 300, 34);
  g.fillStyle = 'rgba(18,32,31,.85)';
  round(36, 40, 300, 22, 11);
  g.fillStyle = 'rgba(18,32,31,.45)';
  round(36, 82, 380, 16, 8);
  round(36, 110, 330, 16, 8);
  g.fillStyle = '#12201f';
  round(36, 196, 190, 64, 32);
  g.strokeStyle = '#12201f';
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(250, 198, 190, 60, 30);
  g.stroke();
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  t.colorSpace = SRGBColorSpace;
  return t;
}

// a soft round sprite, so sediment is grains and not squares
function dot() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function smooth(a: number, b: number, v: number) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
