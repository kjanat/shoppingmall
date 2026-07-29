import * as THREE from 'three';

export class Atmosphere {
	readonly group = new THREE.Group();
	private dust: THREE.Points;
	private walkers: THREE.Group;
	private walkerData: { mesh: THREE.Mesh; speed: number; t: number; radius: number; y: number }[] = [];
	private billboards: THREE.Mesh[] = [];
	private time = 0;

	constructor() {
		this.dust = this.createDust();
		this.group.add(this.dust);

		this.walkers = this.createWalkers();
		this.group.add(this.walkers);

		this.createBillboards();
	}

	update(dt: number): void {
		this.time += dt;

		// Drift dust
		const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
		const arr = pos.array as Float32Array;
		for (let i = 0; i < arr.length; i += 3) {
			arr[i + 1] += Math.sin(this.time + i) * 0.002;
			arr[i] += Math.cos(this.time * 0.3 + i * 0.01) * 0.001;
			if (arr[i + 1] > 14) arr[i + 1] = 0.5;
		}
		pos.needsUpdate = true;

		// Walkers orbit atrium corridors
		for (const w of this.walkerData) {
			w.t += dt * w.speed;
			w.mesh.position.x = Math.cos(w.t) * w.radius;
			w.mesh.position.z = Math.sin(w.t) * w.radius * 0.65;
			w.mesh.position.y = w.y;
			w.mesh.rotation.y = -w.t + Math.PI / 2;
		}

		// Billboard subtle pulse
		for (let i = 0; i < this.billboards.length; i++) {
			const m = this.billboards[i].material as THREE.MeshStandardMaterial;
			m.emissiveIntensity = 0.6 + Math.sin(this.time * 2 + i) * 0.15;
		}

		// Atrium ornaments (if present in scene — handled externally)
	}

	private createDust(): THREE.Points {
		const count = 1200;
		const positions = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			positions[i * 3] = (Math.random() - 0.5) * 70;
			positions[i * 3 + 1] = Math.random() * 14;
			positions[i * 3 + 2] = (Math.random() - 0.5) * 46;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		const mat = new THREE.PointsMaterial({
			color: 0xaaccff,
			size: 0.06,
			transparent: true,
			opacity: 0.45,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
		});
		return new THREE.Points(geo, mat);
	}

	private createWalkers(): THREE.Group {
		const g = new THREE.Group();
		const bodyGeo = new THREE.CapsuleGeometry(0.22, 0.7, 4, 8);
		const colors = [0x00ffc8, 0xff2d55, 0x00a8ff, 0xffaa00, 0xcc66ff, 0xffffff];

		for (let i = 0; i < 18; i++) {
			const mat = new THREE.MeshStandardMaterial({
				color: colors[i % colors.length],
				emissive: colors[i % colors.length],
				emissiveIntensity: 0.15,
				metalness: 0.3,
				roughness: 0.7,
				transparent: true,
				opacity: 0.75,
			});
			const mesh = new THREE.Mesh(bodyGeo, mat);
			const floor = i < 10 ? 0 : 1;
			const y = floor * 6 + 0.85;
			const radius = 10 + (i % 5) * 2.5;
			const t = (i / 18) * Math.PI * 2;
			const speed = 0.15 + (i % 4) * 0.04;
			mesh.position.set(Math.cos(t) * radius, y, Math.sin(t) * radius * 0.65);
			g.add(mesh);
			this.walkerData.push({ mesh, speed, t, radius, y });
		}
		return g;
	}

	private createBillboards(): void {
		const ads = [
			{ text: 'SUMMER SALE\n-40%', color: '#ff2d55', x: -34, y: 4, z: -8 },
			{ text: 'NIEUW\nBINNEN', color: '#00a8ff', x: 34, y: 4, z: 8 },
			{ text: 'FOOD\nCOURT', color: '#ffaa00', x: -34, y: 10, z: 8 },
			{ text: 'KRUIDVAT\nOPEN', color: '#00a651', x: 34, y: 10, z: -8 },
		];

		for (const ad of ads) {
			const canvas = document.createElement('canvas');
			canvas.width = 512;
			canvas.height = 256;
			const ctx = canvas.getContext('2d')!;
			ctx.fillStyle = '#0a0a12';
			ctx.fillRect(0, 0, 512, 256);
			ctx.strokeStyle = ad.color;
			ctx.lineWidth = 8;
			ctx.strokeRect(8, 8, 496, 240);
			ctx.fillStyle = ad.color;
			ctx.font = '700 56px Outfit, system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			const lines = ad.text.split('\n');
			lines.forEach((line, i) => {
				ctx.fillText(line, 256, 128 + (i - (lines.length - 1) / 2) * 64);
			});
			const tex = new THREE.CanvasTexture(canvas);
			tex.colorSpace = THREE.SRGBColorSpace;
			const mat = new THREE.MeshStandardMaterial({
				map: tex,
				emissive: new THREE.Color(ad.color),
				emissiveMap: tex,
				emissiveIntensity: 0.7,
				metalness: 0.2,
				roughness: 0.4,
			});
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), mat);
			mesh.position.set(ad.x, ad.y, ad.z);
			// face inward
			mesh.lookAt(0, ad.y, 0);
			this.group.add(mesh);
			this.billboards.push(mesh);
		}
	}
}
