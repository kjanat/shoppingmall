import * as THREE from 'three';

/**
 * Dance party mode: spinning disco balls + colored spotlights everywhere.
 */
export class DiscoParty {
	readonly group = new THREE.Group();
	active = false;
	private lights: THREE.PointLight[] = [];
	private balls: THREE.Mesh[] = [];
	private floorGlow: THREE.Mesh[] = [];
	private materials: THREE.Material[] = [];
	private t = 0;

	constructor() {
		this.group.name = 'disco';
		this.group.visible = false;

		const spots: [number, number, number][] = [
			[0, 5, 0],
			[-18, 4, -12],
			[18, 4, -12],
			[-18, 4, 12],
			[18, 4, 12],
			[0, 10, 0],
			[-10, 10, 8],
			[10, 10, -8],
			[0, 4, 14],
			[-22, 4, 0],
			[22, 4, 0],
		];

		const colors = [0xff0088, 0x00ffcc, 0xffee00, 0x8800ff, 0x00aaff, 0xff4400];

		for (let i = 0; i < spots.length; i++) {
			const [x, y, z] = spots[i];
			const col = colors[i % colors.length];
			const light = new THREE.PointLight(col, 0, 28, 1.6);
			light.position.set(x, y, z);
			this.group.add(light);
			this.lights.push(light);

			// disco ball
			const ball = new THREE.Mesh(
				new THREE.IcosahedronGeometry(0.35, 1),
				this.track(
					new THREE.MeshStandardMaterial({
						color: 0xdddddd,
						metalness: 0.95,
						roughness: 0.15,
						emissive: col,
						emissiveIntensity: 0.25,
					}),
				),
			);
			ball.position.set(x, y + 0.5, z);
			this.group.add(ball);
			this.balls.push(ball);

			// floor glow disc
			const glow = new THREE.Mesh(
				new THREE.CircleGeometry(2.2, 24),
				this.track(
					new THREE.MeshBasicMaterial({
						color: col,
						transparent: true,
						opacity: 0.15,
						depthWrite: false,
						side: THREE.DoubleSide,
					}),
				),
			);
			glow.rotation.x = -Math.PI / 2;
			glow.position.set(x, y > 7 ? 6.05 : 0.05, z);
			this.group.add(glow);
			this.floorGlow.push(glow);
		}
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	setActive(on: boolean): void {
		this.active = on;
		this.group.visible = on;
		for (const l of this.lights) {
			l.intensity = on ? 12 : 0;
		}
	}

	toggle(): boolean {
		this.setActive(!this.active);
		return this.active;
	}

	update(dt: number): void {
		if (!this.active) return;
		this.t += dt;
		for (let i = 0; i < this.lights.length; i++) {
			const l = this.lights[i];
			const pulse = 8 + Math.sin(this.t * 4 + i) * 6;
			l.intensity = pulse;
			// hue cycle
			const c = new THREE.Color().setHSL((this.t * 0.15 + i * 0.12) % 1, 0.95, 0.5);
			l.color.copy(c);
			const ball = this.balls[i];
			ball.rotation.y += dt * (1.5 + i * 0.1);
			ball.rotation.x += dt * 0.8;
			const mat = ball.material as THREE.MeshStandardMaterial;
			mat.emissive.copy(c);
			const glow = this.floorGlow[i];
			(glow.material as THREE.MeshBasicMaterial).color.copy(c);
			(glow.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(this.t * 5 + i) * 0.08;
		}
	}
}
