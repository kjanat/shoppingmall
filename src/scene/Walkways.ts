import * as THREE from 'three';

type Belt = {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  speed: number;
};

/**
 * Schiphol-style moving walkways (loopbanden) through the mall corridors.
 * Metal belt + glass handrails + moving stripe texture.
 */
export class MovingWalkways {
  readonly group = new THREE.Group();
  private belts: Belt[] = [];
  private materials: THREE.Material[] = [];

  constructor() {
    this.group.name = 'walkways';

    // Floor 0 — long N/S spines left and right of atrium
    this.addBelt({ x: -5, y: 0, z: 0, length: 22, rotY: 0, floor: 0 });
    this.addBelt({ x: 5, y: 0, z: 0, length: 22, rotY: Math.PI, floor: 0 });
    // Floor 0 — E/W connectors south & north
    this.addBelt({ x: 0, y: 0, z: 11, length: 18, rotY: Math.PI / 2, floor: 0 });
    this.addBelt({ x: 0, y: 0, z: -11, length: 18, rotY: -Math.PI / 2, floor: 0 });

    // Floor 1 — same idea
    this.addBelt({ x: -5, y: 6, z: 0, length: 20, rotY: 0, floor: 1 });
    this.addBelt({ x: 5, y: 6, z: 0, length: 20, rotY: Math.PI, floor: 1 });
    this.addBelt({ x: 0, y: 6, z: 10, length: 16, rotY: Math.PI / 2, floor: 1 });
    this.addBelt({ x: 0, y: 6, z: -10, length: 16, rotY: -Math.PI / 2, floor: 1 });

    // Spur toward escalator / Kruidvat wing
    this.addBelt({ x: 11, y: 0, z: -2, length: 10, rotY: Math.PI / 2, floor: 0 });
    this.addBelt({ x: 12, y: 6, z: -6, length: 12, rotY: -0.2, floor: 1 });
  }

  update(dt: number): void {
    for (const b of this.belts) {
      const map = b.mat.map;
      if (map) {
        map.offset.y = (map.offset.y + dt * b.speed) % 1;
      }
    }
  }

  private track<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private addBelt(opts: {
    x: number;
    y: number;
    z: number;
    length: number;
    rotY: number;
    floor: number;
  }): void {
    const g = new THREE.Group();
    g.position.set(opts.x, opts.y, opts.z);
    g.rotation.y = opts.rotY;

    const w = 1.35;
    const len = opts.length;

    // Stripe texture for moving belt
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#3a3f48';
    ctx.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#4a5160' : '#2e333c';
      ctx.fillRect(0, i * 16, 64, 16);
    }
    // yellow edge lines
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(0, 0, 4, 256);
    ctx.fillRect(60, 0, 4, 256);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, len / 2);
    tex.colorSpace = THREE.SRGBColorSpace;

    const beltMat = this.track(
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.65,
        metalness: 0.35,
      }),
    );

    const belt = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, len), beltMat);
    belt.position.y = 0.06;
    belt.receiveShadow = true;
    g.add(belt);

    // Side metal frames
    const frameMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x8a919c,
        metalness: 0.85,
        roughness: 0.3,
      }),
    );
    for (const sx of [-w / 2 - 0.06, w / 2 + 0.06]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, len), frameMat);
      rail.position.set(sx, 0.5, 0);
      g.add(rail);

      // rubber handrail
      const hand = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.08, len),
        this.track(
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 }),
        ),
      );
      hand.position.set(sx, 0.95, 0);
      g.add(hand);
    }

    // Glass panels
    const glass = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xc5d8ea,
        transparent: true,
        opacity: 0.28,
        roughness: 0.1,
        side: THREE.DoubleSide,
      }),
    );
    for (const sx of [-w / 2 - 0.02, w / 2 + 0.02]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.75), glass);
      panel.rotation.y = Math.PI / 2;
      panel.position.set(sx, 0.5, 0);
      g.add(panel);
    }

    // End caps / comb plates
    const capMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xb0b6c0, metalness: 0.7, roughness: 0.35 }),
    );
    for (const sz of [-len / 2, len / 2]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.1, 0.35), capMat);
      cap.position.set(0, 0.08, sz);
      g.add(cap);
    }

    // Small "moving walkway" plate
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 256;
    signCanvas.height = 64;
    const sctx = signCanvas.getContext('2d')!;
    sctx.fillStyle = '#1e3a5f';
    sctx.fillRect(0, 0, 256, 64);
    sctx.fillStyle = '#fff';
    sctx.font = 'bold 22px system-ui,sans-serif';
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText('←  LOOPBAND  →', 128, 32);
    const signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.28),
      this.track(new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false })),
    );
    sign.position.set(0, 1.15, -len / 2 + 0.5);
    g.add(sign);

    this.group.add(g);
    this.belts.push({ mesh: belt, mat: beltMat, speed: 0.35 });
  }
}
