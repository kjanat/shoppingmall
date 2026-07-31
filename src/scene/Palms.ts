import * as THREE from 'three';

/** Florida / California mall energy: palms everywhere. */
export class PalmForest {
	readonly group = new THREE.Group();
	private materials: THREE.Material[] = [];
	private sway: { leaves: THREE.Group; phase: number }[] = [];

	constructor() {
		this.group.name = 'palms';

		// Atrium ring AROUND fountain — never on top of it (radius ~3+)
		this.plant(-4.2, 0, 0, 1.05, 0);
		this.plant(4.2, 0, 0, 1.0, 0.5);
		this.plant(0, 0, -4.2, 0.95, 1.1);
		this.plant(0, 0, 4.2, 0.95, 1.6);
		this.plant(-3.5, 0, 3.2, 0.85, 2.0);
		this.plant(3.5, 0, -3.2, 0.85, 2.5);

		// Corridor planters floor 0
		const f0: [number, number, number][] = [
			[-20, 0, -8],
			[-6, 0, -8],
			[6, 0, -8],
			[20, 0, -8],
			[-20, 0, 8],
			[-6, 0, 8],
			[6, 0, 8],
			[20, 0, 8],
			[-26, 0, -6],
			[26, 0, 6],
			[-12, 0, 0],
			[12, 0, 0],
		];
		f0.forEach(([x, y, z], i) => this.plant(x, y, z, 0.7 + (i % 3) * 0.08, i * 0.7));

		// Floor 1 balcony palms
		const f1: [number, number, number][] = [
			[-18, 6, -8],
			[-4, 6, -8],
			[10, 6, -8],
			[22, 6, -8],
			[-18, 6, 8],
			[0, 6, 8],
			[16, 6, 8],
			[24, 6, 8],
			[-10, 6, 0],
			[10, 6, 2],
		];
		f1.forEach(([x, y, z], i) => this.plant(x, y, z, 0.65 + (i % 4) * 0.06, i * 0.9 + 3));

		// Balcony accents (not mid-void)
		this.plant(14, 6, -12, 0.9, 5);
		this.plant(-14, 6, -12, 0.85, 5.5);
	}

	update(t: number): void {
		// Gentle leaf sway — very subtle, no flicker
		for (const s of this.sway) {
			s.leaves.rotation.z = Math.sin(t * 0.6 + s.phase) * 0.04;
			s.leaves.rotation.x = Math.cos(t * 0.45 + s.phase) * 0.025;
		}
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private plant(x: number, y: number, z: number, scale: number, phase: number): void {
		const g = new THREE.Group();
		g.position.set(x, y, z);
		g.scale.setScalar(scale);
		g.rotation.y = phase;

		// Pot
		const pot = new THREE.Mesh(
			new THREE.CylinderGeometry(0.55, 0.65, 0.55, 10),
			this.track(new THREE.MeshStandardMaterial({ color: 0xa08060, roughness: 0.85 })),
		);
		pot.position.y = 0.28;
		pot.castShadow = true;
		g.add(pot);

		const dirt = new THREE.Mesh(
			new THREE.CylinderGeometry(0.48, 0.48, 0.08, 10),
			this.track(new THREE.MeshStandardMaterial({ color: 0x3d2914, roughness: 1 })),
		);
		dirt.position.y = 0.55;
		g.add(dirt);

		// Trunk segments (slight curve)
		const trunkMat = this.track(new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.9 }));
		const trunkH = 2.6;
		const segs = 5;
		for (let i = 0; i < segs; i++) {
			const t = i / segs;
			const seg = new THREE.Mesh(
				new THREE.CylinderGeometry(0.1 - t * 0.03, 0.14 - t * 0.03, trunkH / segs, 6),
				trunkMat,
			);
			seg.position.set(Math.sin(t * 0.8) * 0.08, 0.55 + (i + 0.5) * (trunkH / segs), 0);
			seg.rotation.z = Math.sin(t) * 0.05;
			g.add(seg);
		}

		// Crown leaves
		const leaves = new THREE.Group();
		leaves.position.y = 0.55 + trunkH;
		const greens = [0x1b7a3d, 0x2d8a4e, 0x3d9b55, 0x228b22];
		const leafCount = 8 + Math.floor(scale * 3);
		for (let i = 0; i < leafCount; i++) {
			const a = (i / leafCount) * Math.PI * 2;
			const leafMat = this.track(
				new THREE.MeshStandardMaterial({
					color: greens[i % greens.length],
					roughness: 0.85,
					side: THREE.DoubleSide,
				}),
			);
			// elongated palm frond
			const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.8), leafMat);
			frond.position.set(Math.cos(a) * 0.15, 0.2, Math.sin(a) * 0.15);
			frond.rotation.order = 'YXZ';
			frond.rotation.y = a;
			frond.rotation.x = -0.95 - (i % 3) * 0.08;
			frond.rotation.z = i % 2 === 0 ? 0.1 : -0.1;
			leaves.add(frond);

			// second layer shorter
			if (i % 2 === 0) {
				const frond2 = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 1.3), leafMat);
				frond2.position.set(Math.cos(a + 0.3) * 0.1, 0.35, Math.sin(a + 0.3) * 0.1);
				frond2.rotation.order = 'YXZ';
				frond2.rotation.y = a + 0.3;
				frond2.rotation.x = -0.7;
				leaves.add(frond2);
			}
		}

		// coconut cluster
		const cocoMat = this.track(new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 }));
		for (let i = 0; i < 3; i++) {
			const c = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), cocoMat);
			const a = (i / 3) * Math.PI * 2;
			c.position.set(Math.cos(a) * 0.18, -0.05, Math.sin(a) * 0.18);
			leaves.add(c);
		}

		g.add(leaves);
		this.sway.push({ leaves, phase });
		this.group.add(g);
	}
}
