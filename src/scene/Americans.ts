import * as THREE from 'three';
import { NODES } from '../data/graph';

/** Unique DNA for each mall sim — every shopper is different. */
export type SimFactors = {
  id: number;
  name: string;
  /** 0–1 how thicc */
  thicc: number;
  /** walk speed m/s-ish */
  speed: number;
  /** stride length multiplier */
  stride: number;
  /** how hard feet plant (bounce) */
  stomp: number;
  /** 0–1 restless — higher = more destination changes */
  restless: number;
  /** 0–1 — pauses to “look at shops” */
  windowShop: number;
  /** personal walkway preference (stick to belts more) */
  lovesWalkway: number;
  mood: 'chill' | 'hangry' | 'hyped' | 'lost' | 'on_mission';
  goal: string;
  bag: string | null;
  shirt: number;
  pants: number;
  skin: number;
  hair: number;
  hasCap: boolean;
  isBrad: boolean;
};

type Limb = {
  group: THREE.Group;
  upper: THREE.Object3D;
  foot: THREE.Object3D;
};

type Sim = {
  factors: SimFactors;
  root: THREE.Group;
  body: THREE.Group;
  legL: Limb;
  legR: Limb;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  wait: number;
  phase: number;
  floorY: number;
  waypoints: THREE.Vector3[];
  wpIndex: number;
};

const FIRST = [
  'Brad', 'Chad', 'Kyle', 'Derek', 'Troy', 'Brett', 'Craig', 'Gary',
  'Linda', 'Karen', 'Sharon', 'Becky', 'Tammy', 'Diane', 'Peggy', 'Janet',
  'Todd', 'Randy', 'Steve', 'Doug', 'Nancy', 'Carol', 'Wayne', 'Butch',
];
const LAST = [
  'Miller', 'Johnson', 'Smith', 'Brown', 'Davis', 'Wilson', 'Moore',
  'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin',
];
const GOALS = [
  'food court pretzel',
  'bathroom ASAP',
  'Nike sale',
  'parking level B2',
  'meet Linda at 3',
  'free sample hunt',
  'escape the kids',
  'Kruidvat vitamins',
  'Rituals for mom',
  'just vibing',
  'find the exit',
  'Cinnabon emergency',
];
const BAGS = ['Nike', 'Target', 'H&M', 'Mall', 'SALE', 'Food', null, null];

const SKIN = [0xf5c9a8, 0xe8b896, 0xd4a574, 0xc68642, 0x8d5524, 0xffe0bd];
const SHIRTS = [0x2c5aa0, 0xc0392b, 0x27ae60, 0xf39c12, 0x8e44ad, 0x1abc9c, 0xe74c3c, 0x3498db, 0xffffff, 0x111111];
const PANTS = [0x2c3e50, 0x34495e, 0x5d4e37, 0x1a1a2e, 0x4a5568, 0x1e3a5f];
const HAIR = [0x2c1810, 0x5c4033, 0xc4a35a, 0x888888, 0x1a1a1a, 0xd35400, 0xf5f5f5];

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFloorNodes(floor: 0 | 1): THREE.Vector3[] {
  return NODES.filter((n) => {
    const onFloor = floor === 0 ? n.y < 3 : n.y > 3;
    // corridor-ish nodes, not deep store backs only — include store approaches for variety
    return onFloor && !n.id.startsWith('e');
  }).map((n) => new THREE.Vector3(n.x, floor * 6, n.z));
}

/**
 * Individual mall sims: unique factors, real legs + feet that walk,
 * random destinations, personal moods. Peak viral NPC energy.
 */
export class Americans {
  readonly group = new THREE.Group();
  private sims: Sim[] = [];
  private materials: THREE.Material[] = [];
  private floor0: THREE.Vector3[];
  private floor1: THREE.Vector3[];
  /** Public roster for game UI */
  readonly roster: SimFactors[] = [];

  constructor(count = 22) {
    this.group.name = 'mallSims';
    this.floor0 = pickFloorNodes(0);
    this.floor1 = pickFloorNodes(1);

    for (let i = 0; i < count; i++) {
      const factors = this.rollFactors(i);
      this.roster.push(factors);
      const sim = this.buildSim(factors);
      this.sims.push(sim);
      this.group.add(sim.root);
    }
  }

  getSimsNear(worldPos: THREE.Vector3, radius: number): SimFactors[] {
    const out: SimFactors[] = [];
    for (const s of this.sims) {
      if (s.pos.distanceTo(worldPos) < radius) out.push(s.factors);
    }
    return out;
  }

  update(dt: number): void {
    for (const s of this.sims) {
      this.tickSim(s, dt);
    }
  }

  private rollFactors(id: number): SimFactors {
    const rng = mulberry32(0xc0ffee + id * 9973);
    const isBrad = id === 0;
    const thicc = isBrad ? 0.92 : 0.35 + rng() * 0.65;
    const moodRoll = rng();
    const mood: SimFactors['mood'] =
      isBrad
        ? 'on_mission'
        : moodRoll < 0.2
          ? 'hangry'
          : moodRoll < 0.4
            ? 'lost'
            : moodRoll < 0.6
              ? 'hyped'
              : moodRoll < 0.8
                ? 'chill'
                : 'on_mission';

    const name = isBrad
      ? 'Brad Miller'
      : `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`;

    return {
      id,
      name,
      thicc,
      speed: isBrad ? 1.15 : 0.55 + rng() * 1.1,
      stride: 0.75 + rng() * 0.55,
      stomp: 0.4 + rng() * 0.9,
      restless: 0.2 + rng() * 0.8,
      windowShop: rng() * 0.7,
      lovesWalkway: rng(),
      mood,
      goal: isBrad ? 'Kruidvat vitamins' : GOALS[Math.floor(rng() * GOALS.length)],
      bag: isBrad ? 'KRUIDVAT' : BAGS[Math.floor(rng() * BAGS.length)],
      shirt: isBrad ? 0xe30613 : SHIRTS[Math.floor(rng() * SHIRTS.length)],
      pants: PANTS[Math.floor(rng() * PANTS.length)],
      skin: SKIN[Math.floor(rng() * SKIN.length)],
      hair: HAIR[Math.floor(rng() * HAIR.length)],
      hasCap: rng() > 0.55,
      isBrad,
    };
  }

  private track<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private mat(color: number, rough = 0.85): THREE.MeshStandardMaterial {
    return this.track(
      new THREE.MeshStandardMaterial({
        color,
        roughness: rough,
        metalness: 0.05,
      }),
    );
  }

  private buildSim(f: SimFactors): Sim {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const thicc = f.thicc;
    const bellyR = 0.32 + thicc * 0.38;
    const legLen = 0.5 + (1 - thicc * 0.25) * 0.2;
    const scale = 0.92 + thicc * 0.2;

    // --- Legs with FEET (pootjes that know) ---
    const legL = this.makeLeg(f.pants, f.skin, legLen, -1);
    const legR = this.makeLeg(f.pants, f.skin, legLen, 1);
    body.add(legL.group, legR.group);

    const torsoY = legLen + 0.12;

    // Belly
    const belly = new THREE.Mesh(
      new THREE.SphereGeometry(bellyR, 12, 10),
      this.mat(f.shirt, 0.9),
    );
    belly.scale.set(1.15 + thicc * 0.15, 0.85 + thicc * 0.15, 1.05 + thicc * 0.1);
    belly.position.set(0, torsoY + bellyR * 0.5, 0.06 + thicc * 0.06);
    body.add(belly);

    // Chest
    const chest = new THREE.Mesh(
      new THREE.SphereGeometry(bellyR * 0.72, 10, 8),
      this.mat(f.shirt, 0.9),
    );
    chest.scale.set(1.25, 0.65, 0.85);
    chest.position.set(0, torsoY + bellyR * 1.05, 0);
    body.add(chest);

    // Arms
    const armGeo = new THREE.CapsuleGeometry(0.09, 0.42, 3, 5);
    const armMat = this.mat(f.shirt);
    const armL = new THREE.Mesh(armGeo, armMat);
    const armR = new THREE.Mesh(armGeo, armMat);
    armL.position.set(-bellyR * 1.0, torsoY + bellyR * 0.85, 0);
    armR.position.set(bellyR * 1.0, torsoY + bellyR * 0.85, 0);
    body.add(armL, armR);

    // Hands
    const handMat = this.mat(f.skin);
    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), handMat);
    const handR = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), handMat);
    handL.position.set(-bellyR * 1.2, torsoY + 0.3, 0.12);
    handR.position.set(bellyR * 1.2, torsoY + 0.3, 0.12);
    body.add(handL, handR);

    // Head
    const headY = torsoY + bellyR * 1.45 + 0.26;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 10), this.mat(f.skin));
    head.position.set(0, headY, 0);
    body.add(head);

    if (f.hasCap) {
      const capCol = f.isBrad ? 0x00a651 : 0x1a5276;
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
        this.mat(capCol),
      );
      cap.position.set(0, headY + 0.05, 0);
      body.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.2), this.mat(capCol));
      brim.position.set(0, headY + 0.02, 0.18);
      body.add(brim);
    } else {
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
        this.mat(f.hair),
      );
      hair.position.set(0, headY + 0.04, 0);
      body.add(hair);
    }

    // Bag
    if (f.bag) {
      const bagCol = f.bag === 'KRUIDVAT' ? 0xe30613 : 0x222222;
      body.add(this.makeBag(f.bag, bagCol, bellyR * 1.3, torsoY * 0.45, 0.15));
    }

    body.scale.setScalar(scale);

    // Start position
    const nodes = Math.random() > 0.35 ? this.floor0 : this.floor1;
    const start = nodes[Math.floor(Math.random() * nodes.length)].clone();
    const floorY = start.y;
    root.position.copy(start);

    const sim: Sim = {
      factors: f,
      root,
      body,
      legL,
      legR,
      armL,
      armR,
      pos: start.clone(),
      target: start.clone(),
      wait: Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
      floorY,
      waypoints: [],
      wpIndex: 0,
    };
    this.pickNewRoute(sim);
    return sim;
  }

  private makeLeg(pants: number, _skin: number, legLen: number, side: -1 | 1): Limb {
    const group = new THREE.Group();
    group.position.set(side * 0.15, 0, 0);

    // Upper leg (thigh) — pivots at hip
    const upper = new THREE.Group();
    upper.position.set(0, legLen, 0);
    const thigh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.12, legLen * 0.55, 3, 6),
      this.mat(pants),
    );
    thigh.position.y = -legLen * 0.35;
    upper.add(thigh);

    // Lower leg + FOOT
    const lower = new THREE.Group();
    lower.position.y = -legLen * 0.55;
    const calf = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.1, legLen * 0.4, 3, 6),
      this.mat(pants),
    );
    calf.position.y = -legLen * 0.22;
    lower.add(calf);

    // THE FOOT (pootje) — knows contact with ground
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.08, 0.28),
      this.mat(0xf0f0f0, 0.7),
    );
    foot.position.set(0, -legLen * 0.48, 0.06);
    lower.add(foot);

    // sole darker
    const sole = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.03, 0.3),
      this.mat(0x222222),
    );
    sole.position.set(0, -legLen * 0.52, 0.06);
    lower.add(sole);

    upper.add(lower);
    group.add(upper);

    return { group, upper, foot };
  }

  private makeBag(text: string, bg: number, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.32, 0.1), this.mat(bg, 0.7));
    g.add(bag);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = text === 'KRUIDVAT' ? '#00a651' : '#ffffff';
    ctx.font = 'bold 18px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.slice(0, 10), 64, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.11),
      this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
    );
    label.position.z = 0.06;
    g.add(label);
    g.position.set(x, y, z);
    return g;
  }

  private pickNewRoute(s: Sim): void {
    const pool = s.floorY < 3 ? this.floor0 : this.floor1;
    // 15% chance to "change floor" by picking other pool next time — stay same floor for pathing simplicity
    const n = 2 + Math.floor(Math.random() * 3);
    s.waypoints = [];
    let cur = s.pos.clone();
    for (let i = 0; i < n; i++) {
      // Prefer somewhat nearby points for natural walk
      const sorted = [...pool].sort(
        (a, b) => a.distanceToSquared(cur) - b.distanceToSquared(cur),
      );
      const pickFrom = sorted.slice(0, Math.min(8, sorted.length));
      const next = pickFrom[Math.floor(Math.random() * pickFrom.length)].clone();
      // personal wander offset — individual factor
      next.x += (Math.random() - 0.5) * 1.5 * (0.5 + s.factors.restless);
      next.z += (Math.random() - 0.5) * 1.5 * (0.5 + s.factors.restless);
      next.y = s.floorY;
      s.waypoints.push(next);
      cur = next;
    }
    s.wpIndex = 0;
    s.target.copy(s.waypoints[0]);
  }

  private tickSim(s: Sim, dt: number): void {
    const f = s.factors;

    // Waiting / window shopping
    if (s.wait > 0) {
      s.wait -= dt;
      this.poseIdle(s, dt);
      s.root.position.copy(s.pos);
      return;
    }

    const to = s.target.clone().sub(s.pos);
    to.y = 0;
    const dist = to.length();

    if (dist < 0.35) {
      s.wpIndex++;
      if (s.wpIndex >= s.waypoints.length) {
        // Arrive: maybe window shop, then new route
        s.wait = 0.4 + f.windowShop * 2.5 + (f.mood === 'lost' ? 1.5 : 0);
        if (Math.random() < f.restless * 0.3) s.wait *= 0.4;
        this.pickNewRoute(s);
        this.poseIdle(s, dt);
        s.root.position.copy(s.pos);
        return;
      }
      s.target.copy(s.waypoints[s.wpIndex]);
    }

    // Move toward target — individual speed
    const dir = to.normalize();
    const spd = f.speed * (f.mood === 'hyped' ? 1.25 : f.mood === 'hangry' ? 1.15 : f.mood === 'chill' ? 0.85 : 1);
    s.pos.x += dir.x * spd * dt;
    s.pos.z += dir.z * spd * dt;
    s.pos.y = s.floorY;

    // Face movement
    const face = Math.atan2(dir.x, dir.z);
    // smooth-ish
    let dy = face - s.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    s.root.rotation.y += dy * Math.min(1, dt * 6);

    // Walk cycle advances with speed * stride
    s.phase += dt * spd * 5.5 * f.stride;
    this.poseWalk(s, s.phase, spd);

    s.root.position.set(s.pos.x, s.pos.y, s.pos.z);
  }

  /** Legs + feet plant with individual stomp factor */
  private poseWalk(s: Sim, phase: number, spd: number): void {
    const f = s.factors;
    const swing = Math.sin(phase) * 0.55 * f.stride;
    const swingOpp = Math.sin(phase + Math.PI) * 0.55 * f.stride;
    const plant = Math.max(0, Math.cos(phase)) * 0.08 * f.stomp;
    const plantOpp = Math.max(0, Math.cos(phase + Math.PI)) * 0.08 * f.stomp;

    // Hip pitch
    s.legL.upper.rotation.x = swing;
    s.legR.upper.rotation.x = swingOpp;

    // Knee bend on swing (child of upper is lower group — rotate foot parent)
    // foot lift when swinging forward
    s.legL.foot.rotation.x = -swing * 0.35 + plant * 2;
    s.legR.foot.rotation.x = -swingOpp * 0.35 + plantOpp * 2;

    // Body bob from stomp
    const bob = Math.abs(Math.sin(phase)) * 0.035 * f.stomp * Math.min(1, spd);
    s.body.position.y = bob;

    // Arms opposite to legs
    s.armL.rotation.x = -swing * 0.45;
    s.armR.rotation.x = -swingOpp * 0.45;
  }

  private poseIdle(s: Sim, dt: number): void {
    s.phase += dt * 1.2;
    const breath = Math.sin(s.phase * 0.8) * 0.015;
    s.legL.upper.rotation.x = THREE.MathUtils.lerp(s.legL.upper.rotation.x, 0.05, 0.1);
    s.legR.upper.rotation.x = THREE.MathUtils.lerp(s.legR.upper.rotation.x, -0.05, 0.1);
    s.legL.foot.rotation.x = 0;
    s.legR.foot.rotation.x = 0;
    s.armL.rotation.x = 0;
    s.armR.rotation.x = 0;
    s.body.position.y = breath;
  }
}
