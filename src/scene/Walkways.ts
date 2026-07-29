import * as THREE from 'three';

type Belt = {
	mat: THREE.MeshStandardMaterial;
	speed: number;
};

/**
 * Schiphol loopbanden — corridors ONLY.
 * Never overlap escalator (east x≈22) or stairs (west x≈-22).
 */
export class MovingWalkways {
	readonly group = new THREE.Group();
	private belts: Belt[] = [];
	private materials: THREE.Material[] = [];

	constructor() {
		this.group.name = 'walkways';

		// Floor 0 — N/S along corridors left of escalator / right of stairs
		this.addBelt({ x: -8, y: 0, z: 0, length: 18, rotY: 0 });
		this.addBelt({ x: 8, y: 0, z: 0, length: 18, rotY: Math.PI });
		// Floor 0 — E/W south & north (stop short of wing stairs/escalator)
		this.addBelt({ x: 0, y: 0, z: 12, length: 14, rotY: Math.PI / 2 });
		this.addBelt({ x: 0, y: 0, z: -12, length: 14, rotY: -Math.PI / 2 });

		// Floor 1 — same safe lanes
		this.addBelt({ x: -8, y: 6, z: 0, length: 16, rotY: 0 });
		this.addBelt({ x: 8, y: 6, z: 0, length: 16, rotY: Math.PI });
		this.addBelt({ x: 0, y: 6, z: 11, length: 12, rotY: Math.PI / 2 });
		this.addBelt({ x: 0, y: 6, z: -11, length: 12, rotY: -Math.PI / 2 });
	}

	update(dt: number): void {
		for (const b of this.belts) {
			if (b.mat.map) {
				b.mat.map.offset.y = (b.mat.map.offset.y + dt * b.speed) % 1;
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
	}): void {
		const g = new THREE.Group();
		g.position.set(opts.x, opts.y, opts.z);
		g.rotation.y = opts.rotY;

		const w = 1.25;
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
		belt.receiveShadow = true;
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
			const hand = new THREE.Mesh(
				new THREE.BoxGeometry(0.12, 0.08, len),
				this.track(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 })),
			);
			hand.position.set(sx, 0.92, 0);
			g.add(hand);
		}

		const glass = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xc5d8ea,
				transparent: true,
				opacity: 0.25,
				roughness: 0.1,
				side: THREE.DoubleSide,
			}),
		);
		for (const sx of [-w / 2 - 0.02, w / 2 + 0.02]) {
			const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.7), glass);
			panel.rotation.y = Math.PI / 2;
			panel.position.set(sx, 0.48, 0);
			g.add(panel);
		}

		const capMat = this.track(
			new THREE.MeshStandardMaterial({ color: 0xb0b6c0, metalness: 0.7, roughness: 0.35 }),
		);
		for (const sz of [-len / 2, len / 2]) {
			const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.1, 0.35), capMat);
			cap.position.set(0, 0.08, sz);
			g.add(cap);
		}

		this.group.add(g);
		this.belts.push({ mat: beltMat, speed: 0.35 });
	}
}
