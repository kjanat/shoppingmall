import * as THREE from 'three';

type Belt = {
	mat: THREE.MeshStandardMaterial;
	speed: number;
	/** World-space footprint + drift for conveyance */
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	y: number;
	/** m/s along world X (both belts run east-west) */
	driftX: number;
};

/** How fast a belt carries whoever stands on it (m/s). */
const CONVEY_SPEED = 1.6;

/**
 * Minimal loopbanden — brother was right, too many was ugly.
 * Only two short belts, far from stairs/escalator/void.
 */
export class MovingWalkways {
	readonly group = new THREE.Group();
	private belts: Belt[] = [];
	private materials: THREE.Material[] = [];

	constructor() {
		this.group.name = 'walkways';
		// One on floor 0 south corridor, one on floor 1 north — that's it
		this.addBelt({ x: 0, y: 0, z: 13, length: 10, rotY: Math.PI / 2 });
		this.addBelt({ x: 0, y: 6, z: -13, length: 10, rotY: -Math.PI / 2 });
	}

	update(dt: number): void {
		for (const b of this.belts) {
			if (b.mat.map) {
				b.mat.map.offset.y = (b.mat.map.offset.y + dt * b.speed) % 1;
			}
		}
	}

	/**
	 * Drift for anyone standing on a belt at (x, y, z), else null.
	 * The loopband finally carries the shitties instead of scrolling under them.
	 */
	beltVelocityAt(x: number, y: number, z: number): { x: number; z: number } | null {
		for (const b of this.belts) {
			if (Math.abs(y - b.y) > 1.2) continue;
			if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
			return { x: b.driftX, z: 0 };
		}
		return null;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private addBelt(opts: { x: number; y: number; z: number; length: number; rotY: number }): void {
		const g = new THREE.Group();
		g.position.set(opts.x, opts.y, opts.z);
		g.rotation.y = opts.rotY;

		const w = 1.2;
		const len = opts.length;

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
		g.add(belt);

		const frameMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x8a919c,
				metalness: 0.85,
				roughness: 0.3,
			}),
		);
		for (const sx of [-w / 2 - 0.06, w / 2 + 0.06]) {
			const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, len), frameMat);
			rail.position.set(sx, 0.48, 0);
			g.add(rail);
		}

		this.group.add(g);
		// rotY ±π/2 turns local Z into world ∓X; scroll direction follows the sign
		const dir = opts.rotY > 0 ? 1 : -1;
		this.belts.push({
			mat: beltMat,
			speed: 0.35,
			minX: opts.x - len / 2,
			maxX: opts.x + len / 2,
			minZ: opts.z - w / 2 - 0.1,
			maxZ: opts.z + w / 2 + 0.1,
			y: opts.y,
			driftX: dir * CONVEY_SPEED,
		});
	}
}
