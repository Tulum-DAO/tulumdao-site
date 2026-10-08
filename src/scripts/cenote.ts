// The cenote. Loaded after first paint, never under prefers-reduced-motion.
//
// Looking down a limestone shaft. Each depth is one layer of the harness, and the page's scroll
// position is the camera's depth:
//   -18  seats and generations: each seat is a light with tree rings, one ring per past generation;
//        a handoff grows a new ring that flashes ochre (the readback) and then settles
//   -28  messages: packets fly between named seats and often get a reply; a message to a busy
//        seat waits beside it and is delivered when its turn ends. While this layer is on screen
//        the seats gather round the GM and the mail runs hub and spoke, to and from it
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

// mail types, named after OrchestraOS message types; each has its own colour, none of them the
// agents' white or water-blue. The page's legend (src/pages/index.astro) uses the same colours.
export const MAIL = {
  task: new Color('#ff8a6b'),
  reply: new Color('#a8e06a'),
  task_complete: new Color('#b39dff'),
  escalate: new Color('#ff5fa8'),
} as const;
type MailKind = keyof typeof MAIL;
const pickKind = (): MailKind => {
  const r = Math.random();
  return r < 0.6 ? 'task' : r < 0.85 ? 'task_complete' : 'escalate';
};

// example names only; nothing here names a real seat
const SEAT_NAMES = ['gm', 'pm-web', 'dev-api', 'dev-ui', 'reviewer', 'docs', 'qa', 'release', 'research', 'infra', 'design', 'pm-mobile', 'dev-auth', 'ops', 'tests', 'scout', 'writer', 'security'];
const TALKER_NAMES = ['planner', 'dev-auth', 'dev-db', 'tests', 'dev-ios', 'designer', 'ops', 'scout', 'writer', 'dev-search', 'triage', 'data', 'support', 'perf', 'i18n', 'billing', 'security', 'a11y', 'devrel', 'mobile', 'sdk', 'analytics', 'release', 'qa', 'docs', 'review', 'infra', 'research'];
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
  // on wide screens each layer sits a little away from its text panel (seats and memory panels are
  // on the left, messaging's on the right); on phones the panels span the width, so no shift
  const shift = innerWidth > 900 ? 1 : 0;
  // narrow screens: clusters a little smaller so a layer fits the width of a portrait screen
  const K = innerWidth > 900 ? 1 : 0.72;
  const LX = { seats: 2.25 * shift, messages: -2.1 * shift, memory: 0.9 * shift };
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
        // the core is tinted with the light's own colour, so mail keeps its colour at small sizes
        gl_FragColor = vec4(vColor * halo * halo + mix(vec3(1.0), vColor, 0.55) * core, (halo * 0.8 + core) * vAlpha);
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
  const MAXP = 26; // packets in flight; each draws its own leading line
  const SEGS = MAXT + MAXP;
  const threads: Thread[] = [];
  const tpos = new Float32Array(SEGS * 6);
  const tcol = new Float32Array(SEGS * 8);
  const tgeo = new BufferGeometry();
  tgeo.setAttribute('position', new BufferAttribute(tpos, 3));
  tgeo.setAttribute('color', new BufferAttribute(tcol, 4));
  // fog: false — fog on an additive line ADDS the fog colour, so distant threads turned white
  // over the hero. Each thread fades by its own distance from the camera instead.
  // normal blending: additive would shift each mail colour's hue against the teal water
  // (violet + teal reads sky-blue), and the legend would no longer match
  const tmat = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false });
  const threadLines = new LineSegments(tgeo, tmat);
  threadLines.frustumCulled = false;
  scene.add(threadLines);
  const thread = (a: Vector3, b: Vector3, color: Color, max: number, message = false) => {
    if (threads.length >= MAXT) threads.shift();
    threads.push({ a, b, color, life: 0, max, message });
  };

  // ---- labels: plain HTML over the canvas, placed from 3D each frame (crisp text, no font atlas)
  const labelLayer = document.getElementById('cenote-labels');
  type Label = {
    el: HTMLElement;
    sub: HTMLElement | null;
    at: () => Vector3;
    alpha: () => number;
    last: string;
    w: number;
    h: number;
    d: number;
    x: number;
    y: number;
    a: number;
    sx: number; // its light on screen
    sy: number;
    side: string; // which side of its light it sat on last frame
    dim: Node | null; // a seat whose light dims while its name has no room
    hub: Vector3 | null; // the centre of its cluster: the name prefers the side facing away from it
    toward: boolean; // ...or facing it (a PM's name sits in the open gap between its orbit and the GM)
    group: string; // the layer it belongs to; a layer's names are solved together
    hidden: boolean; // no room in this layout: faded out until the layout changes
    o: number; // opacity on screen, eased, so a name fades instead of popping
    on: boolean; // its light is on screen this frame
    longest: string; // the longest its second line gets (busy, mid-handoff): room is kept for it
  };
  let labelGroup = 'seats'; // the layer being built; addLabel tags each name with it
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
    const l: Label = { el, sub, at, alpha, last: '', w: 0, h: 0, d: 0, x: 0, y: 0, a: 0, sx: 0, sy: 0, side: '', dim: null, hub: null, toward: false, group: labelGroup, hidden: false, o: 0, on: false, longest: '' };
    labels.push(l);
    return l;
  };
  const setSub = (l: Label, text: string) => {
    if (l.sub && l.last !== text) {
      l.sub.textContent = text;
      l.last = text;
      l.w = 0; // re-measure: the text changed width
    }
  };
  const proj = new Vector3();
  const rise = new Vector3();
  const cardFrom = new Vector3();

  // seats and generations. A seat is a light; every generation it has been through is a ring around
  // it, newest innermost, fading as it ages outward, like the rings of a tree.
  const SEATS = mobile ? 13 : 18;
  const HANDOFF = mobile ? 'handoff' : 'reading handoff'; // short on a phone, so names fit
  // fewer rings on a phone: each ring is a draw call, and wide rings would touch their neighbours
  const MAX_RINGS = mobile ? 4 : 6;
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
  const ringRadius = (i: number) => 0.3 + i * 0.11;
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
  // seat 0 is the general manager, at the centre; the others are spread across the layer with
  // room between them. A phone screen is tall and narrow, so there the spread is taller than wide.
  const seatAt = [[0, 0] as [number, number], ...spread(SEATS - 1, mobile ? 2.05 : 2.9, 2.5, mobile ? 1.05 : 1.25, [[0, 0]], 7)];
  for (let i = 0; i < SEATS; i++) {
    const [sx, sz] = seatAt[i];
    const y = i === 0 ? Y.seats : Y.seats + Math.sin(i * 2.1) * 0.6;
    const n = spawn(new Vector3(LX.seats + sx, y, sz), LIGHT, i === 0 ? 30 : 24);
    if (!n) continue;
    // a history: every seat has already been through a few generations
    const past = 1 + Math.floor(Math.random() * 4);
    const rt = runtimeFor(i);
    // the name holds steady through a handoff (the light dips; the name doesn't flicker with it)
    const label = addLabel(SEAT_NAMES[i % SEAT_NAMES.length], () => n.pos, () => Math.max(n.alpha, 0.85 * n.target), i === 0 ? 'gm' : '', {
      runtime: rt,
      role: i === 0 ? 'general manager' : undefined,
    });
    if (i > 0) {
      label.dim = n; // a seat whose name has no room shows as a dimmer, background seat
      label.hub = seats[0]?.node.pos ?? null;
    }
    label.longest = `${RUNTIMES[rt].name}, gen 10, ${HANDOFF}`;
    const l: Lineage = { node: n, rings: [], handoffAt: -100, gen: past + 1, label, rt: RUNTIMES[rt].name };
    for (let g = past - 1; g >= 0; g--) addRing(l, -100, ringRadius(g));
    seats.push(l);
  }
  // messages: a field of named seats handing each other work. Some are busy; mail for a busy seat
  // waits beside it and is delivered when its turn ends, so nobody is interrupted mid-task.
  // While this layer is on screen the seats gather into the fleet's shape: the GM at the centre,
  // project managers round it, and each PM's workers in its orbit. Mail follows that shape (worker
  // and PM most, PM and GM less; an escalation climbs worker -> PM -> GM). Scroll on and they spread
  // back out and mail each other directly.
  // radius of the ring round a busy seat, where its parked mail circles: small, so it hugs its seat
  const ORBIT = 0.19;
  type Role = 'gm' | 'pm' | 'worker';
  type Talker = {
    node: Node;
    busy: boolean;
    flipAt: number;
    ring: Line;
    label: Label | null;
    rt: string;
    role: Role;
    parent: Talker | null; // a worker's PM, a PM's GM
    // place in the shape, as polar coordinates round its parent (the GM's own is the layer centre).
    // Kept as radius + angle so the orbits can be set turning later without a rewrite.
    orbitR: number;
    orbitA: number;
    home: Vector3; // where it sits when spread out
    hub: Vector3; // its place in the shape
    phase: number;
  };
  const talkers: Talker[] = [];
  labelGroup = 'messages';
  const PM_NAMES = ['pm-web', 'pm-mobile', 'pm-data', 'pm-infra'];
  const PMS = 4;
  const PER_PM = mobile ? 4 : 6;
  const TALK = 1 + PMS + PMS * PER_PM;
  // a phone screen is tall: the shape is stretched front to back (screen up and down) there
  const ZS = mobile ? 1.3 : 1;
  const PM_R = mobile ? 1.2 : 1.75;
  const WORKER_R = mobile ? 0.56 : 0.8;
  const orbitPos = (tk: Talker, out: Vector3) => {
    if (!tk.parent) return out.set(LX.messages, Y.messages, 0);
    orbitPos(tk.parent, out);
    return out.set(out.x + Math.cos(tk.orbitA) * tk.orbitR, out.y, out.z + Math.sin(tk.orbitA) * tk.orbitR * ZS);
  };
  const talkHome = [[0, 0] as [number, number], ...spread(TALK - 1, mobile ? 2.1 : 2.9, mobile ? 2.6 : 2.8, mobile ? 0.9 : 0.95, [[0, 0]], 11)];
  let worker = 0;
  const makeTalker = (i: number, role: Role, parent: Talker | null, orbitR: number, orbitA: number, name: string) => {
    const [hx, hz] = talkHome[i];
    const home = new Vector3(LX.messages + hx, Y.messages + (role === 'gm' ? 0 : Math.sin(i * 1.7) * 0.9), hz);
    const n = spawn(home, role === 'worker' ? MAYA : LIGHT, role === 'gm' ? 30 : role === 'pm' ? 25 : 19);
    if (!n) return null;
    n.drift = 0; // talkers bob from their own phase, set each frame (they also move)
    const ring = new Line(circle, new LineBasicMaterial({ color: OCHRE, transparent: true, opacity: 0, depthWrite: false }));
    ring.scale.setScalar(ORBIT); // parked mail circles on this ring
    scene.add(ring);
    // the GM is Claude; PMs and workers mix the three runtimes
    const rt: Runtime = role === 'gm' ? 'claude' : role === 'pm' ? RUNTIME_CYCLE[i % RUNTIME_CYCLE.length] : RUNTIME_CYCLE[worker++ % RUNTIME_CYCLE.length];
    const label =
      role === 'gm'
        ? addLabel('GM', () => n.pos, () => n.alpha, 'gm', { runtime: rt, role: 'general manager' })
        : role === 'pm'
          ? addLabel(name, () => n.pos, () => n.alpha, 'pm', { runtime: rt }) // styled like every agent; only the text differs
          : addLabel(name, () => n.pos, () => n.alpha, 'talker', { runtime: rt });
    const tk: Talker = {
      node: n,
      busy: role === 'worker' && Math.random() < 0.2,
      flipAt: Math.random() * 6,
      ring,
      label,
      rt: RUNTIMES[rt].name,
      role,
      parent,
      orbitR,
      orbitA,
      home,
      hub: new Vector3(),
      phase: Math.random() * 6.28,
    };
    if (label && role === 'worker') label.longest = mobile ? `${tk.rt}, busy` : `${tk.rt}, busy: mail waits`;
    orbitPos(tk, tk.hub);
    if (role !== 'gm') tk.hub.y += Math.sin(i * 1.7) * (role === 'pm' ? 0.12 : 0.22);
    talkers.push(tk);
    return tk;
  };
  const gmTalker = makeTalker(0, 'gm', null, 0, 0, 'GM')!;
  const pms: Talker[] = [];
  for (let p = 0; p < PMS; p++) {
    // PMs on the diagonals, so the four orbits sit in the four corners of a portrait screen
    const a = Math.PI / 4 + (p / PMS) * Math.PI * 2;
    const pm = makeTalker(1 + p, 'pm', gmTalker, PM_R, a, PM_NAMES[p % PM_NAMES.length]);
    if (pm) pms.push(pm);
  }
  pms.forEach((pm, p) => {
    for (let j = 0; j < PER_PM; j++) {
      // round the PM, starting from the side facing away from the GM. With an even count the
      // offset leaves the side facing the GM open, so the GM -> PM spoke runs clear.
      const off = PER_PM % 2 === 0 ? Math.PI / PER_PM : 0;
      const a = pm.orbitA + off + (j / PER_PM) * Math.PI * 2;
      const i = 1 + PMS + p * PER_PM + j;
      makeTalker(i, 'worker', pm, WORKER_R, a, TALKER_NAMES[(i - 1 - PMS) % TALKER_NAMES.length]);
    }
  });
  // names face away from their own centre: a PM's away from the GM, a worker's away from its PM
  // ...except a PM's, which faces the GM: its workers leave that side of the orbit open
  for (const tk of talkers) {
    if (!tk.label || !tk.parent) continue;
    tk.label.hub = tk.parent.node.pos;
    tk.label.toward = tk.role === 'pm';
  }
  const workers = talkers.filter((t) => t.role === 'worker');
  let gather = 0; // 0 spread out, 1 gathered into the shape
  let gatherTarget = 0;
  // spokes: faint lines from each agent's parent to it (GM -> PMs, PM -> its workers), drawn while
  // they are gathered. The grouping reads from position and spokes alone.
  const kpos = new Float32Array(TALK * 6);
  const kcol = new Float32Array(TALK * 8);
  const kgeo = new BufferGeometry();
  kgeo.setAttribute('position', new BufferAttribute(kpos, 3));
  kgeo.setAttribute('color', new BufferAttribute(kcol, 4));
  const spokes = new LineSegments(kgeo, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false }));
  spokes.frustumCulled = false;
  scene.add(spokes);
  // fly: rides the line from one orb centre to the other. wait: the receiver is busy, so it circles
  // beside it. land: the receiver is free again, so it flies into the receiver's centre. done: it
  // has been delivered and fades out inside the receiver.
  type Packet = {
    node: Node;
    from: Talker;
    to: Talker;
    state: 'fly' | 'wait' | 'land' | 'done';
    kind: MailKind;
    t: number;
    dur: number;
    waited: number;
    landFrom: Vector3;
    ang: number; // where on the orbit it is circling
    reply: boolean;
    forward: Talker | null; // an escalation: on delivery, the receiver passes it up to this seat
  };
  const dest = new Vector3();
  // where a message should stop: the receiver's centre if it is free, otherwise the near edge of
  // its orbit (on the side the message comes from), so it never enters a busy orb
  const destFor = (pk: { from: Talker; to: Talker }, out: Vector3) => {
    const c = pk.to.node.pos;
    if (!pk.to.busy) return out.copy(c);
    const dx = pk.from.node.pos.x - c.x;
    const dz = pk.from.node.pos.z - c.z;
    const len = Math.hypot(dx, dz) || 1;
    return out.set(c.x + (dx / len) * ORBIT, c.y + 0.1, c.z + (dz / len) * ORBIT);
  };
  const packets: Packet[] = [];
  const send = (from: Talker, to: Talker, reply: boolean, kindIs?: MailKind, forward: Talker | null = null) => {
    if (packets.length >= MAXP) return;
    const kind: MailKind = reply ? 'reply' : (kindIs ?? pickKind());
    const n = spawn(from.node.pos, MAIL[kind], 22);
    if (!n) return;
    const dur = 0.9 + from.node.pos.distanceTo(to.node.pos) * 0.12;
    packets.push({ node: n, from, to, state: 'fly', kind, t: 0, dur, waited: 0, landFrom: new Vector3(), ang: 0, reply, forward });
  };
  // approvals: dim seats around the card that rises
  const askers: Node[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const n = spawn(new Vector3(Math.cos(a) * 2.3, Y.approvals, Math.sin(a) * 2.3), MAYA, 20, 0.55);
    if (n) askers.push(n);
  }

  // memory that survives a restart: a seat at the centre of the facts it has learned. Every few
  // seconds it restarts. Its light and its links go out, but the facts stay lit; the next
  // generation lights up and re-links to each fact in turn (recall).
  labelGroup = 'memory';
  const memSeat = spawn(new Vector3(LX.memory, Y.memory, -0.4), LIGHT, 30)!;
  const FACTS = mobile ? 12 : 16;
  const facts: Node[] = [];
  for (let i = 0; i < FACTS; i++) {
    const a = (i / FACTS) * Math.PI * 2 + (i % 2) * 0.2;
    const r = (i % 2 ? 2.0 + Math.random() * 0.35 : 1.1 + Math.random() * 0.3) * K;
    const f = spawn(new Vector3(LX.memory + Math.cos(a) * r, Y.memory + (Math.random() - 0.5) * 0.6, Math.sin(a) * r - 0.4), SAND, 15);
    if (f) {
      f.drift = 0; // facts hold still: they are the part that persists
      facts.push(f);
    }
  }
  FACT_LABELS.forEach((text, i) => {
    const f = facts[i * 3 + 1];
    if (f) addLabel(text, () => f.pos, () => f.alpha, 'fact', { sub: false }).hub = memSeat.pos;
  });
  // the seats' own lights: what a name may not cover (mail in flight is left out: it is gone in a
  // moment, and solving names around it would tie the layout to chance)
  const fixedLights: Node[] = [...seats.map((l) => l.node), ...talkers.map((t) => t.node), ...facts, memSeat];
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
  let apPanelTop = Infinity; // the approvals panel's top edge on screen, in px (narrow layout)
  const apPanel = document.querySelector<HTMLElement>('[data-layer="approvals"] .panel');
  const memPanel = document.querySelector<HTMLElement>('[data-layer="memory"] .panel');
  const panels = [...document.querySelectorAll<HTMLElement>('[data-layer] .panel')];
  let lastScrollAt = 0;
  const readScroll = () => {
    lastScrollAt = performance.now();
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
    if (apPanel) apPanelTop = apPanel.getBoundingClientRect().top;
    // gathered round the GM while the messaging section is near the middle of the screen
    const msg = sections.find((s) => s.dataset.layer === 'messages');
    if (msg) {
      const r = msg.getBoundingClientRect();
      gatherTarget = smooth(0.8, 0.3, Math.abs(r.top + r.height / 2 - mid) / innerHeight);
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
      // the lean follows a mouse only: on a phone every touch is a pointer move, and leaning toward
      // the thumb pushed whole layers off centre
      if (e.pointerType !== 'mouse') return;
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
    if (w <= 900) {
      // lens shift: on narrow screens each layer's card sits low, so draw the scene's centre at
      // about 30% from the top, above the card, without tilting the camera
      camera.projectionMatrix.elements[9] = -0.42;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }
    nmat.uniforms.scale.value = h * renderer.getPixelRatio() * 0.024;
    readScroll();
  };
  addEventListener('resize', resize);
  resize();
  depth = depthTarget;

  // ---- names: where each sits relative to its light, and the solve that picks it (see the label
  // pass in the loop)
  const solvedAs = new Map<string, string>(); // layer -> the layout its names were solved for
  const sideAt = (l: Label, narrow: boolean): [number, number] => {
    const { sx, sy, w, h } = l;
    switch (l.side) {
      case 'over':
        return [sx - w / 2, sy - h - 9];
      case 'right':
        return narrow ? [sx + 11, sy - h / 2] : [sx + 9, sy - 9];
      case 'left':
        return narrow ? [sx - w - 11, sy - h / 2] : [sx - w - 9, sy - 9];
      default:
        return [sx - w / 2, sy + 9];
    }
  };
  const solveNames = (group: Label[], W: number, H: number, narrow: boolean, EDGE: number) => {
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    // the text panels on screen are taken already: no name may slide under one
    for (const el of panels) {
      const r = el.getBoundingClientRect();
      if (r.bottom > 0 && r.top < H) placed.push({ x: r.left - 8, y: r.top - 8, w: r.width + 16, h: r.height + 16 });
    }
    // the seats' lights, its own included: the four sides keep clear of it, but a name pushed in
    // from the screen edge may not land on it
    const LIGHT_R = 7;
    const lights: [number, number][] = [];
    for (const n of fixedLights) {
      if (!n.live || n.alpha < 0.1) continue;
      proj.copy(n.pos).project(camera);
      if (proj.z > 1 || Math.abs(proj.x) > 1.05 || Math.abs(proj.y) > 1.05) continue;
      lights.push([(proj.x * 0.5 + 0.5) * W, (-proj.y * 0.5 + 0.5) * H]);
    }
    // the GM first, then the PMs, then the rest nearest-first
    const rank = (l: Label) => (l.el.classList.contains('gm') ? 2 : l.el.classList.contains('pm') ? 1 : 0);
    const order = [...group].sort((p, q) => rank(q) - rank(p) || p.d - q.d);
    for (const l of order) {
      const { sx, sy, h } = l;
      // room for the longest its text gets, so a name that later reads 'busy' still fits
      let w = l.w;
      if (l.longest && l.sub) {
        const now = l.sub.textContent;
        l.sub.textContent = l.longest;
        w = Math.max(w, l.el.offsetWidth);
        l.sub.textContent = now;
      }
      const wNow = l.w;
      l.w = w; // sideAt reads it: solve at the longest width
      // preference: away from the cluster's centre first (the open side), else the screen's default
      let sides = narrow ? ['under', 'over', 'right', 'left'] : ['right', 'left', 'under', 'over'];
      if (l.hub) {
        proj.copy(l.hub).project(camera);
        const flip = l.toward ? -1 : 1;
        const dx = (sx - (proj.x * 0.5 + 0.5) * W) * flip;
        const dy = (sy - (-proj.y * 0.5 + 0.5) * H) * flip;
        const lr = dx > 0 ? 'right' : 'left';
        const ud = dy > 0 ? 'under' : 'over';
        const first = Math.abs(dx) > Math.abs(dy) ? [lr, ud] : [ud, lr];
        sides = [...first, ...sides.filter((o) => !first.includes(o))];
      }
      const gm = rank(l) === 2;
      const pm = rank(l) === 1;
      let found = '';
      for (const side of sides) {
        l.side = side;
        const [x0, y0] = sideAt(l, narrow);
        const x = clamp(x0, EDGE, W - w - EDGE);
        const y = clamp(y0, EDGE, H - h - EDGE);
        // a side only counts if the name fits there as it is: a name held in by the screen edge
        // would stop riding with its light and slide against it as the layer moves
        const free =
          x === x0 &&
          y === y0 &&
          !placed.some((o) => x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h) &&
          !lights.some(([lx, ly]) => lx + LIGHT_R > x && lx - LIGHT_R < x + w && ly + LIGHT_R > y && ly - LIGHT_R < y + h);
        if (gm || free) {
          found = side;
          break;
        }
      }
      // the GM's and the PMs' names always show: with no clear side they take their first choice
      if (!found && (gm || pm)) found = sides[0];
      l.side = found || sides[0];
      l.hidden = !found;
      if (found) {
        const [x0, y0] = sideAt(l, narrow);
        const pad = gm ? 10 : pm ? 5 : 0;
        placed.push({ x: clamp(x0, EDGE, W - w - EDGE) - pad, y: clamp(y0, EDGE, H - h - EDGE) - pad, w: w + pad * 2, h: h + pad * 2 });
      }
      l.w = wNow;
      // a seat whose name has no room in this layout shows as a dimmer, background seat
      if (l.dim) l.dim.target = l.hidden ? 0.3 : 1;
    }
  };

  // ---- the loop
  let last = performance.now();
  let nextHandoff = 1.2;
  let nextMessage = 0.3;
  let clock = 0;
  let raf = 0;
  const minFrame = mobile ? 1000 / 31 : 0;
  const snap = location.search.includes('snap');
  let painted = false;
  let stopped = false;
  // frame-rate guard: if a weak GPU can't hold ~20fps, give the visitor the static page back
  let frames = 0;
  let slowSum = 0;

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dtRaw = now - last;
    // phones run at ~30fps to save battery, but never while the page is scrolling: a skipped frame
    // there leaves the scene (and the approval card) a frame behind the page, which judders
    if (dtRaw < minFrame && now - lastScrollAt > 250) return;
    last = now;
    frames++;
    if (frames > 10 && frames <= 70) slowSum += dtRaw;
    if (frames === 70 && slowSum / 60 > 50 && !location.search.includes('cenote')) {
      stop();
      return;
    }
    // ?cenote&snap (screenshots on a slow software renderer): let a slow frame cover real time
    const dt = Math.min(dtRaw / 1000, snap ? 0.3 : 0.05);
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
      setSub(l.label, since < 1.8 ? `${l.rt}, gen ${l.gen}, ${HANDOFF}` : `${l.rt}, gen ${l.gen}`);
      l.rings.forEach((ring, i) => {
        const age = clock - ring.born;
        ring.r += (ringRadius(i) - ring.r) * Math.min(1, dt * 3);
        ring.line.scale.setScalar(ring.r);
        ring.line.position.copy(l.node.pos);
        const fresh = age < 2.4;
        // ochre while the readback is checked (first ~1.2s), then the ring cools to water-blue
        ring.mat.color.copy(MAYA).lerp(OCHRE, fresh ? 1 - smooth(1.0, 1.8, age) : 0);
        const settled = 0.75 * Math.pow(0.62, i);
        // a background seat (its name had no room) keeps its rings faint too
        const bg = l.node.target < 1 ? 0.35 : 1;
        ring.mat.opacity = bg * (fresh ? Math.min(1, age * 3) * lerp(1, settled, smooth(1.2, 2.4, age)) : settled);
      });
    }
    // messages: gathered into the shape, mail follows it; spread out, agents mail each other directly
    gather += (gatherTarget - gather) * Math.min(1, dt * 1.6);
    const gk = gather * gather * (3 - 2 * gather);
    for (const tk of talkers) {
      tk.node.pos.lerpVectors(tk.home, tk.hub, gk);
      tk.node.pos.y += Math.sin(clock * 0.7 + tk.phase) * 0.11;
    }
    {
      const near = smooth(15, 9, camera.position.distanceTo(gmTalker.node.pos)) * gk;
      let k = 0;
      for (const tk of talkers) {
        if (!tk.parent) continue;
        const g = tk.parent.node.pos;
        const p = tk.node.pos;
        // GM -> PM spokes a little stronger than PM -> worker
        const a = tk.role === 'pm' ? 0.4 : 0.26;
        kpos.set([g.x, g.y, g.z, p.x, p.y, p.z], k * 6);
        kcol.set([LIGHT.r, LIGHT.g, LIGHT.b, a * near, MAYA.r, MAYA.g, MAYA.b, a * 0.4 * near], k * 8);
        k++;
      }
      kgeo.setDrawRange(0, k * 2);
      kgeo.attributes.position.needsUpdate = true;
      kgeo.attributes.color.needsUpdate = true;
      spokes.visible = near > 0.01;
    }
    if (clock > nextMessage && talkers.length > 1) {
      nextMessage = clock + 0.22 + Math.random() * 0.3;
      if (gather > 0.5) {
        // most mail is between a worker and its PM; less between a PM and the GM; an escalation
        // goes worker -> PM, and the PM passes it up to the GM
        const r = Math.random();
        const w = workers[Math.floor(Math.random() * workers.length)];
        const pm = pms[Math.floor(Math.random() * pms.length)];
        if (r < 0.34) send(w.parent!, w, false, 'task');
        else if (r < 0.62) send(w, w.parent!, false, 'task_complete');
        else if (r < 0.76) send(gmTalker, pm, false, 'task');
        else if (r < 0.9) send(pm, gmTalker, false, 'task_complete');
        else send(w, w.parent!, false, 'escalate', gmTalker);
      } else {
        const others = talkers.length - 1;
        const a = talkers[1 + Math.floor(Math.random() * others)];
        const b = talkers[1 + Math.floor(Math.random() * others)];
        if (a !== b) send(a, b, false);
      }
    }
    for (const tk of talkers) {
      if (clock > tk.flipAt && tk.role === 'worker') {
        tk.busy = !tk.busy && Math.random() < 0.35;
        tk.flipAt = clock + (tk.busy ? 2.5 + Math.random() * 3 : 1.5 + Math.random() * 4);
      }
      const m = tk.ring.material as LineBasicMaterial;
      m.opacity += ((tk.busy ? 0.9 : 0) - m.opacity) * Math.min(1, dt * 4);
      tk.ring.position.copy(tk.node.pos);
      tk.ring.visible = m.opacity > 0.01;
      // phones: the short form, so names fit beside a crowded hub
      // a PM's role goes on this line (short on a phone)
      const role = tk.role === 'pm' ? (mobile ? 'PM, ' : 'project manager, ') : '';
      if (tk.label) setSub(tk.label, tk.busy ? (mobile ? `${tk.rt}, busy` : `${tk.rt}, busy: mail waits`) : role + tk.rt);
    }
    for (let i = packets.length - 1; i >= 0; i--) {
      const pk = packets[i];
      const center = pk.to.node.pos;
      if (pk.state === 'fly') {
        pk.t += dt / pk.dur;
        const u = Math.min(1, pk.t);
        // straight along the line, so the packet always sits on its thread; toward the centre of a
        // free receiver, or the outside edge of a busy one
        pk.node.pos.copy(pk.from.node.pos).lerp(destFor(pk, dest), u * u * (3 - 2 * u));
        if (u < 1) continue;
        // arrived: the line it drew stays a moment, then fades
        thread(pk.from.node.pos, center, MAIL[pk.kind], 0.9, true);
        if (pk.to.busy) {
          pk.state = 'wait';
          pk.waited = 0;
          pk.ang = Math.atan2(pk.node.pos.z - center.z, pk.node.pos.x - center.x); // circle on from where it stopped
        } else {
          pk.state = 'done';
        }
      }
      if (pk.state === 'wait') {
        // parked OUTSIDE a busy seat; it circles there until the seat's turn ends
        pk.waited += dt;
        pk.ang += dt * 4.4; // a tight ring: turn faster so the circling still reads
        pk.node.pos.set(center.x + Math.cos(pk.ang) * ORBIT, center.y + 0.1, center.z + Math.sin(pk.ang) * ORBIT);
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
          // an escalation is passed up the line instead of answered
          if (pk.forward) send(pk.to, pk.forward, false, 'escalate');
          else if (!pk.reply && Math.random() < 0.55) send(pk.to, pk.from, true);
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
    // a delivered message's line: both ends on the two orbs' live centres, fading out
    for (const th of threads) {
      const u = th.life / th.max;
      const near = smooth(15, 9, camera.position.distanceTo(th.b));
      const a = (1 - u) * 0.6 * near;
      tpos.set([th.a.x, th.a.y, th.a.z, th.b.x, th.b.y, th.b.z], t * 6);
      tcol.set([th.color.r, th.color.g, th.color.b, a * 0.2, th.color.r, th.color.g, th.color.b, a], t * 8);
      t++;
    }
    // a message in flight leads its own line: brightest at the mail orb, fading back toward the
    // sender (never fully, so the line still visibly starts at the sender's centre)
    for (const pk of packets) {
      if (pk.state !== 'fly' || t >= SEGS) continue;
      const a0 = pk.from.node.pos;
      const h = pk.node.pos;
      const c = MAIL[pk.kind];
      const near = smooth(15, 9, camera.position.distanceTo(h)) * Math.min(1, pk.node.alpha * 1.5);
      tpos.set([a0.x, a0.y, a0.z, h.x, h.y, h.z], t * 6);
      tcol.set([c.r, c.g, c.b, 0.1 * near, c.r, c.g, c.b, 0.95 * near], t * 8);
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

    // the card rises toward you as the approvals section comes up the page. It aims at a point on
    // the SCREEN, projected into the scene: left of the panel on wide screens, and in the top part of
    // a phone screen, above its panel (which sits low there)
    const wide = innerWidth > 900;
    let e: number;
    let cardAlpha: number;
    if (wide) {
      // left of the panel; fades in as the approvals section rises, out as the floor comes up
      e = easeOut(approvalsT);
      rise.set(-0.32, 0.05, 0.5);
      cardAlpha = 0.95 * smooth(0, 0.35, approvalsT) * (1 - floorT);
    } else {
      // phones: centred just ABOVE the approvals panel, following it up the screen. It rises in as
      // the panel arrives and fades before it would leave the top of the screen.
      const vh = innerHeight;
      if (apPanel) apPanelTop = apPanel.getBoundingClientRect().top; // every frame, so it never lags the scroll
      const cardPx = vh * 0.2; // the card is about a fifth of the screen tall at this distance
      // It lives in the gap between the memory card above and its own panel below: it waits in the
      // top middle of the screen, sits just under the memory card while that is still on screen,
      // rides up with its panel once the panel meets it, and fades if the gap can't hold it.
      const prevBottom = memPanel ? memPanel.getBoundingClientRect().bottom : -Infinity;
      const lo = prevBottom + cardPx / 2 + 14;
      const hi = apPanelTop - cardPx / 2 - 18;
      const yPx = Math.max(Math.min(vh * 0.24, hi), lo);
      e = smooth(vh * 1.05, vh * 0.6, apPanelTop);
      rise.set(0, 1 - (2 * yPx) / vh, 0.5);
      cardAlpha = 0.95 * e * smooth(cardPx * 0.4, cardPx * 0.9, yPx) * smooth(-6, 30, hi - lo);
    }
    // Aim along the ray through that screen point. Two things matter here: the camera has moved
    // this frame (scroll inertia, pointer lean) and its matrix is only refreshed at render, so update
    // it first; and unproject a FAR point (ndc z 0.99), because ndc z 0.5 lands ~0.2 units in front
    // of the lens, where the camera's own movement swamps the direction. Both made the card jitter.
    rise.z = 0.99;
    camera.updateMatrixWorld();
    rise.unproject(camera).sub(camera.position).normalize().multiplyScalar(wide ? 5.2 : 5.6).add(camera.position);
    cardFrom.set(Math.sin(clock * 0.6) * 0.15, Y.approvals - 2, 0);
    card.position.copy(cardFrom).lerp(rise, easeOut(e));
    card.rotation.z = Math.sin(clock * 0.5) * 0.08 * (1 - e);
    card.visible = cardAlpha > 0.01;
    (card.material as MeshBasicMaterial).opacity = cardAlpha;

    ngeo.attributes.position.needsUpdate = true;
    ngeo.attributes.color.needsUpdate = true;
    ngeo.attributes.size.needsUpdate = true;
    ngeo.attributes.alpha.needsUpdate = true;

    renderer.render(scene, camera);

    // Labels follow their lights; they fade with distance so only the layer you are in is named.
    // Each layer's names are solved ONCE per layout and then locked: which side of its light each
    // name sits on, and which names have no room (those fade out and stay out). While the lights
    // move, a name rides with its light on its locked side; it never hops. A layout is re-solved
    // only when the layer's arrangement changes (messaging gathering or spreading) or the layer is
    // entered afresh, and the names fade across that change rather than jump.
    const W = innerWidth;
    const H = innerHeight;
    const narrow = W <= 900;
    const EDGE = 16; // every name stays this far inside the screen
    for (const l of labels) {
      const p = l.at();
      l.d = camera.position.distanceTo(p);
      l.a = clamp(l.alpha(), 0, 1) * smooth(13, 8.5, l.d) * smooth(2.2, 3.5, l.d);
      proj.copy(p).project(camera);
      l.on = proj.z <= 1 && Math.abs(proj.x) <= 1.05 && Math.abs(proj.y) <= 1.05;
      if (!l.on) l.a = 0;
      if (l.a < 0.03) l.a = 0;
      if (!l.w) {
        l.w = l.el.offsetWidth || 90;
        l.h = l.el.offsetHeight || 28;
      }
      l.sx = (proj.x * 0.5 + 0.5) * W;
      l.sy = (-proj.y * 0.5 + 0.5) * H;
    }
    // which layout each layer is in. Messaging has two (gathered, spread) and none while moving
    // between them, when its names are faded out.
    const layoutOf = (g: string) => (g !== 'messages' ? 'still' : gk > 0.9 ? 'gathered' : gk < 0.1 ? 'spread' : '');
    for (const g of ['seats', 'messages', 'memory']) {
      const group = labels.filter((l) => l.group === g);
      const layout = layoutOf(g);
      const seen = group.some((l) => l.a > 0);
      // left the layer and every name has faded: the next visit solves afresh
      if (!seen && group.every((l) => l.o < 0.01)) solvedAs.delete(g);
      // solve only once the page is at rest (camera arrived, no scroll for a moment): solved while
      // the camera is still travelling, names fit a layer that then grows under them
      const atRest = Math.abs(depthTarget - depth) < 0.003 && now - lastScrollAt > 250;
      if (seen && layout && atRest && solvedAs.get(g) !== layout) {
        solveNames(group.filter((l) => l.on), W, H, narrow, EDGE);
        for (const l of group) if (!l.on) l.hidden = true;
        solvedAs.set(g, layout);
      }
    }
    for (const l of labels) {
      const settled = layoutOf(l.group) !== '' && solvedAs.get(l.group) === layoutOf(l.group);
      const target = settled && !l.hidden ? l.a : 0;
      l.o += (target - l.o) * Math.min(1, dt * 5);
      if (l.o < 0.01) {
        if (l.el.style.opacity !== '0') l.el.style.opacity = '0';
        continue;
      }
      // rides with its light exactly: the edge margin was enforced when the side was chosen
      // (the GM's and PMs' names, which always show, are the exception and stay held in)
      const [x, y] = sideAt(l, narrow);
      const held = l.el.classList.contains('gm') || l.el.classList.contains('pm');
      l.x = held ? clamp(x, EDGE, W - l.w - EDGE) : x;
      l.y = held ? clamp(y, EDGE, H - l.h - EDGE) : y;
      l.el.style.opacity = l.o.toFixed(2);
      l.el.style.transform = `translate3d(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px, 0)`;
    }

    if (!painted) {
      painted = true;
      document.documentElement.classList.add('cenote-live');
    }
  };
  raf = requestAnimationFrame(tick);

  // ?cenote only (screenshots and tests): each layer's on-screen centroid, in CSS px
  if (location.search.includes('cenote')) {
    const centroid = (ps: Vector3[]) => {
      let x = 0;
      let y = 0;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      let gap = Infinity; // closest two lights on screen, px
      const sp = ps.map((p) => {
        proj.copy(p).project(camera);
        return [(proj.x * 0.5 + 0.5) * innerWidth, (-proj.y * 0.5 + 0.5) * innerHeight];
      });
      sp.forEach(([sx, sy], i) => {
        x += sx;
        y += sy;
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
        for (let j = i + 1; j < sp.length; j++) gap = Math.min(gap, Math.hypot(sx - sp[j][0], sy - sp[j][1]));
      });
      const r = Math.round;
      return { x: r(x / ps.length), y: r(y / ps.length), n: ps.length, box: [r(x0), r(y0), r(x1), r(y1)], gap: r(gap) };
    };
    (window as unknown as { __cenote: unknown }).__cenote = () => ({
      vw: innerWidth,
      canvasW: canvas.getBoundingClientRect().width,
      camX: +camera.position.x.toFixed(3),
      gather: +gather.toFixed(2),
      names: labels
        .filter((l) => l.o > 0.05)
        // offset of the name's anchor from its light: its centre when over or under, its inner edge
        // when beside (so a second line changing length doesn't read as movement)
        .map((l) => {
          const ax = l.side === 'left' ? l.x + l.w : l.side === 'right' ? l.x : l.x + l.w / 2;
          const ay = l.side === 'over' ? l.y + l.h : l.side === 'under' ? l.y : l.y + l.h / 2;
          return { t: l.el.firstChild?.textContent, g: l.group, side: l.side, dx: Math.round(ax - l.sx), dy: Math.round(ay - l.sy) };
        }),
      seats: centroid(seats.map((s) => s.node.pos)),
      messages: centroid(talkers.map((t) => t.node.pos)),
      memory: centroid([memSeat.pos, ...facts.map((f) => f.pos)]),
    });
  }

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

// n points spread over an ellipse (radii rx, rz) with at least `gap` between any two, around the
// points in `keep` (which are not returned). Seeded, so a layer looks the same on every visit.
function spread(n: number, rx: number, rz: number, gap: number, keep: [number, number][], seed: number): [number, number][] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pts: [number, number][] = [...keep];
  let g = gap;
  // if the ellipse can't hold them all at this gap, give a little and keep going
  for (let tries = 0; pts.length < n + keep.length; tries++) {
    if (tries > 0 && tries % 400 === 0) g *= 0.93;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const x = Math.cos(a) * r * rx;
    const z = Math.sin(a) * r * rz;
    if (pts.every(([px, pz]) => Math.hypot(px - x, pz - z) >= g)) pts.push([x, z]);
  }
  // centre the new points' weight sideways, so a layer never leans left or right of its anchor
  const out = pts.slice(keep.length);
  const mx = out.reduce((a, [x]) => a + x, 0) / out.length;
  return out.map(([x, z]) => [x - mx, z]);
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
