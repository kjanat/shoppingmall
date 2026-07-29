import * as THREE from 'three';
import { type StoreDef, STORES } from '../data/stores';

const FLOOR_H = 6;
const MALL_W = 72;
const MALL_D = 48;

function makeTextTexture(
	lines: string[],
	opts: {
		w?: number;
		h?: number;
		bg?: string;
		fg?: string;
		accent?: string;
		fontSize?: number;
	} = {},
): THREE.CanvasTexture {
	const w = opts.w ?? 512;
	const h = opts.h ?? 256;
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d')!;

	ctx.fillStyle = opts.bg ?? '#111118';
	ctx.fillRect(0, 0, w, h);

	// subtle grid
	ctx.strokeStyle = 'rgba(255,255,255,0.04)';
	for (let i = 0; i < w; i += 32) {
		ctx.beginPath();
		ctx.moveTo(i, 0);
		ctx.lineTo(i, h);
		ctx.stroke();
	}

	if (opts.accent) {
		ctx.fillStyle = opts.accent;
		ctx.fillRect(0, h - 12, w, 12);
		ctx.fillRect(0, 0, 8, h);
	}

	ctx.fillStyle = opts.fg ?? '#ffffff';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const fontSize = opts.fontSize ?? (lines.length > 1 ? 52 : 64);
	ctx.font = `700 ${fontSize}px Outfit, system-ui, sans-serif`;

	const totalH = lines.length * fontSize * 1.15;
	let y = h / 2 - totalH / 2 + fontSize / 2;
	for (const line of lines) {
		ctx.fillText(line, w / 2, y);
		y += fontSize * 1.15;
	}

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 8;
	return tex;
}

export class MallBuilder {
	readonly group = new THREE.Group();
	readonly storeMeshes = new Map<string, THREE.Group>();
	private materials: THREE.Material[] = [];

	build(): THREE.Group {
		this.group.name = 'mall';
		this.buildStructure();
		this.buildAtrium();
		this.buildEscalator();
		this.buildStores();
		this.buildKiosk();
		this.buildRailings();
		this.buildCeilingLights();
		return this.group;
	}

	dispose(): void {
		this.group.traverse((obj) => {
			if (obj instanceof THREE.Mesh) {
				obj.geometry.dispose();
			}
		});
		this.materials.forEach((m) => m.dispose());
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildStructure(): void {
		// Ground floor slab
		const floorMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x12121c,
				metalness: 0.65,
				roughness: 0.28,
				envMapIntensity: 1.2,
			}),
		);

		// Checker / tile pattern via canvas
		const tileCanvas = document.createElement('canvas');
		tileCanvas.width = 256;
		tileCanvas.height = 256;
		const tctx = tileCanvas.getContext('2d')!;
		tctx.fillStyle = '#14141f';
		tctx.fillRect(0, 0, 256, 256);
		tctx.strokeStyle = '#1e1e2e';
		tctx.lineWidth = 2;
		for (let i = 0; i <= 256; i += 32) {
			tctx.beginPath();
			tctx.moveTo(i, 0);
			tctx.lineTo(i, 256);
			tctx.stroke();
			tctx.beginPath();
			tctx.moveTo(0, i);
			tctx.lineTo(256, i);
			tctx.stroke();
		}
		// center glow strip
		tctx.fillStyle = 'rgba(0,255,200,0.06)';
		tctx.fillRect(112, 0, 32, 256);

		const tileTex = new THREE.CanvasTexture(tileCanvas);
		tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
		tileTex.repeat.set(MALL_W / 4, MALL_D / 4);
		tileTex.colorSpace = THREE.SRGBColorSpace;
		floorMat.map = tileTex;

		const floor0 = new THREE.Mesh(
			new THREE.BoxGeometry(MALL_W, 0.3, MALL_D),
			floorMat,
		);
		floor0.position.y = -0.15;
		floor0.receiveShadow = true;
		this.group.add(floor0);

		// Floor 1 ring (open atrium in center)
		const floor1Mat = this.track(floorMat.clone());
		const f1Shape = new THREE.Shape();
		f1Shape.moveTo(-MALL_W / 2, -MALL_D / 2);
		f1Shape.lineTo(MALL_W / 2, -MALL_D / 2);
		f1Shape.lineTo(MALL_W / 2, MALL_D / 2);
		f1Shape.lineTo(-MALL_W / 2, MALL_D / 2);
		f1Shape.lineTo(-MALL_W / 2, -MALL_D / 2);
		const hole = new THREE.Path();
		const aw = 16;
		const ad = 12;
		hole.moveTo(-aw / 2, -ad / 2);
		hole.lineTo(aw / 2, -ad / 2);
		hole.lineTo(aw / 2, ad / 2);
		hole.lineTo(-aw / 2, ad / 2);
		hole.lineTo(-aw / 2, -ad / 2);
		f1Shape.holes.push(hole);

		const f1Geo = new THREE.ExtrudeGeometry(f1Shape, {
			depth: 0.3,
			bevelEnabled: false,
		});
		f1Geo.rotateX(-Math.PI / 2);
		const floor1 = new THREE.Mesh(f1Geo, floor1Mat);
		floor1.position.y = FLOOR_H;
		floor1.receiveShadow = true;
		this.group.add(floor1);

		// Outer walls
		const wallMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x0e0e18,
				metalness: 0.3,
				roughness: 0.7,
			}),
		);
		const wallH = FLOOR_H * 2 + 2;

		const walls: [number, number, number, number, number, number][] = [
			// w, h, d, x, y, z
			[MALL_W + 1, wallH, 0.4, 0, wallH / 2 - 0.3, -MALL_D / 2],
			[MALL_W + 1, wallH, 0.4, 0, wallH / 2 - 0.3, MALL_D / 2],
			[0.4, wallH, MALL_D, -MALL_W / 2, wallH / 2 - 0.3, 0],
			[0.4, wallH, MALL_D, MALL_W / 2, wallH / 2 - 0.3, 0],
		];
		for (const [w, h, d, x, y, z] of walls) {
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
			mesh.position.set(x, y, z);
			mesh.receiveShadow = true;
			this.group.add(mesh);
		}

		// Ceiling with atrium opening
		const ceilMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x0a0a12,
				metalness: 0.4,
				roughness: 0.6,
				side: THREE.DoubleSide,
			}),
		);
		const ceilShape = f1Shape.clone();
		const ceilGeo = new THREE.ExtrudeGeometry(ceilShape, {
			depth: 0.25,
			bevelEnabled: false,
		});
		ceilGeo.rotateX(-Math.PI / 2);
		const ceil = new THREE.Mesh(ceilGeo, ceilMat);
		ceil.position.y = FLOOR_H * 2 + 1.5;
		this.group.add(ceil);

		// Skylight glass over atrium
		const glassMat = this.track(
			new THREE.MeshPhysicalMaterial({
				color: 0x88ccff,
				metalness: 0,
				roughness: 0.05,
				transmission: 0.75,
				thickness: 0.5,
				transparent: true,
				opacity: 0.35,
				side: THREE.DoubleSide,
			}),
		);
		const skylight = new THREE.Mesh(
			new THREE.PlaneGeometry(aw + 1, ad + 1),
			glassMat,
		);
		skylight.rotation.x = -Math.PI / 2;
		skylight.position.y = FLOOR_H * 2 + 1.4;
		this.group.add(skylight);

		// Dark exterior void plane
		const voidMat = this.track(
			new THREE.MeshBasicMaterial({ color: 0x020208 }),
		);
		const voidPlane = new THREE.Mesh(
			new THREE.PlaneGeometry(200, 200),
			voidMat,
		);
		voidPlane.rotation.x = -Math.PI / 2;
		voidPlane.position.y = -0.5;
		this.group.add(voidPlane);
	}

	private buildAtrium(): void {
		// Central fountain / sculpture
		const baseMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x1a1a28,
				metalness: 0.8,
				roughness: 0.2,
			}),
		);
		const neonMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x00ffc8,
				emissive: 0x00ffc8,
				emissiveIntensity: 2,
			}),
		);

		const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.4, 32), baseMat);
		base.position.y = 0.2;
		this.group.add(base);

		const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 4, 16), baseMat);
		pillar.position.y = 2.2;
		this.group.add(pillar);

		const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), neonMat);
		orb.position.y = 4.5;
		orb.name = 'atriumOrb';
		this.group.add(orb);

		// Ring
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(1.4, 0.06, 8, 48),
			neonMat,
		);
		ring.rotation.x = Math.PI / 2;
		ring.position.y = 4.5;
		ring.name = 'atriumRing';
		this.group.add(ring);

		// Atrium floor accent circle
		const accent = new THREE.Mesh(
			new THREE.RingGeometry(2.8, 3.2, 48),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x00ffc8,
					emissive: 0x00ffc8,
					emissiveIntensity: 0.8,
					side: THREE.DoubleSide,
				}),
			),
		);
		accent.rotation.x = -Math.PI / 2;
		accent.position.y = 0.02;
		this.group.add(accent);
	}

	private buildEscalator(): void {
		const g = new THREE.Group();
		g.position.set(8, 0, -2);
		g.name = 'escalator';

		const metal = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x333344,
				metalness: 0.9,
				roughness: 0.25,
			}),
		);
		const stepMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x222233,
				metalness: 0.6,
				roughness: 0.4,
			}),
		);
		const railMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x00a8ff,
				emissive: 0x0066aa,
				emissiveIntensity: 0.6,
				metalness: 0.5,
				roughness: 0.3,
			}),
		);

		const rise = FLOOR_H;
		const run = 8;
		const angle = Math.atan2(rise, run);
		const len = Math.hypot(rise, run);

		// Truss
		const truss = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, len), metal);
		truss.rotation.x = -angle;
		truss.position.set(0, rise / 2, -run / 2);
		g.add(truss);

		// Steps
		const steps = 14;
		for (let i = 0; i < steps; i++) {
			const t = i / (steps - 1);
			const step = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.45), stepMat);
			step.position.set(0, t * rise + 0.2, -t * run);
			g.add(step);
		}

		// Side rails
		for (const sx of [-0.85, 0.85]) {
			const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, len), railMat);
			rail.rotation.x = -angle;
			rail.position.set(sx, rise / 2 + 0.55, -run / 2);
			g.add(rail);
		}

		// Glass sides
		const glass = this.track(
			new THREE.MeshPhysicalMaterial({
				color: 0xaaccff,
				transparent: true,
				opacity: 0.15,
				transmission: 0.5,
				roughness: 0.1,
				side: THREE.DoubleSide,
			}),
		);
		for (const sx of [-0.9, 0.9]) {
			const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), glass);
			panel.rotation.y = Math.PI / 2;
			panel.rotation.x = -angle;
			panel.position.set(sx, rise / 2 + 0.3, -run / 2);
			// Fix orientation: place as side panel along escalator
			panel.rotation.set(0, Math.PI / 2, -angle);
			g.add(panel);
		}

		this.group.add(g);
	}

	private buildStores(): void {
		for (const store of STORES) {
			if (store.id === 'info') continue;
			const pod = this.buildStorePod(store);
			this.storeMeshes.set(store.id, pod);
			this.group.add(pod);
		}
	}

	private buildStorePod(store: StoreDef): THREE.Group {
		const g = new THREE.Group();
		g.name = `store_${store.id}`;
		g.position.set(store.x, store.floor * FLOOR_H, store.z);
		g.rotation.y = store.rotation;

		const w = store.width;
		const d = store.depth;
		const h = 4.2;

		const bodyMat = this.track(
			new THREE.MeshStandardMaterial({
				color: new THREE.Color(store.color).multiplyScalar(0.35),
				metalness: 0.4,
				roughness: 0.55,
			}),
		);
		const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
		body.position.set(0, h / 2, -d / 2);
		body.castShadow = true;
		body.receiveShadow = true;
		g.add(body);

		// Glass storefront
		const frontGlass = this.track(
			new THREE.MeshPhysicalMaterial({
				color: 0x88aacc,
				metalness: 0.1,
				roughness: 0.05,
				transmission: 0.55,
				thickness: 0.2,
				transparent: true,
				opacity: 0.4,
			}),
		);
		const glass = new THREE.Mesh(
			new THREE.BoxGeometry(w - 0.4, h - 0.8, 0.08),
			frontGlass,
		);
		glass.position.set(0, h / 2 - 0.1, 0.05);
		g.add(glass);

		// Interior glow
		const interior = new THREE.Mesh(
			new THREE.PlaneGeometry(w - 0.6, h - 1),
			this.track(
				new THREE.MeshStandardMaterial({
					color: new THREE.Color(store.accent),
					emissive: new THREE.Color(store.accent),
					emissiveIntensity: store.hero ? 0.55 : 0.25,
					side: THREE.DoubleSide,
				}),
			),
		);
		interior.position.set(0, h / 2, -0.3);
		g.add(interior);

		// Sign board
		const lines = store.name.split('\n');
		const signTex = makeTextTexture(lines, {
			bg: store.color,
			fg: store.accent,
			accent: store.hero ? store.accent : undefined,
			fontSize: store.hero ? 72 : 56,
			w: 512,
			h: store.hero ? 220 : 180,
		});
		const signH = store.hero ? 1.3 : 0.9;
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(w * 0.85, signH),
			this.track(
				new THREE.MeshStandardMaterial({
					map: signTex,
					emissive: new THREE.Color(store.color),
					emissiveMap: signTex,
					emissiveIntensity: store.hero ? 1.4 : 0.7,
					metalness: 0.2,
					roughness: 0.4,
				}),
			),
		);
		sign.position.set(0, h - 0.3, 0.08);
		g.add(sign);

		// Neon strip under sign
		const neon = new THREE.Mesh(
			new THREE.BoxGeometry(w * 0.9, 0.06, 0.06),
			this.track(
				new THREE.MeshStandardMaterial({
					color: store.accent,
					emissive: new THREE.Color(store.accent),
					emissiveIntensity: 3,
				}),
			),
		);
		neon.position.set(0, h - 0.95, 0.1);
		g.add(neon);

		// Pillars
		const pillarMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x222233,
				metalness: 0.7,
				roughness: 0.3,
			}),
		);
		for (const px of [-w / 2 + 0.2, w / 2 - 0.2]) {
			const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, h, 0.25), pillarMat);
			p.position.set(px, h / 2, 0);
			g.add(p);
		}

		// Hero extras for Kruidvat
		if (store.hero) {
			const crossMat = this.track(
				new THREE.MeshStandardMaterial({
					color: 0x00a651,
					emissive: 0x00a651,
					emissiveIntensity: 2.5,
				}),
			);
			const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.4, 0.15), crossMat);
			const crossH = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 0.15), crossMat);
			crossV.position.set(-w / 2 + 1.2, h - 1.8, 0.2);
			crossH.position.copy(crossV.position);
			g.add(crossV, crossH);

			// Floating beacon light
			const beacon = new THREE.PointLight(0x00a651, 4, 18, 2);
			beacon.position.set(0, h + 1, 1);
			g.add(beacon);

			const redBeacon = new THREE.PointLight(0xe30613, 3, 14, 2);
			redBeacon.position.set(0, 2, 2);
			g.add(redBeacon);
		}

		// Point light in store
		const light = new THREE.PointLight(
			new THREE.Color(store.accent),
			store.hero ? 2.5 : 1.2,
			12,
			2,
		);
		light.position.set(0, 3, 1);
		g.add(light);

		return g;
	}

	private buildKiosk(): void {
		const g = new THREE.Group();
		g.position.set(0, 0, 10);
		g.name = 'kiosk';

		const bodyMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x1a1a28,
				metalness: 0.6,
				roughness: 0.35,
			}),
		);
		const screenMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x00ffc8,
				emissive: 0x00ffc8,
				emissiveIntensity: 1.5,
			}),
		);

		const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.1, 24), bodyMat);
		base.position.y = 0.55;
		g.add(base);

		const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.2, 12), bodyMat);
		pole.position.y = 1.6;
		g.add(pole);

		const screen = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.95, 0.08), screenMat);
		screen.position.set(0, 2.4, 0.1);
		screen.rotation.x = -0.15;
		g.add(screen);

		const bezel = new THREE.Mesh(
			new THREE.BoxGeometry(1.55, 1.1, 0.1),
			bodyMat,
		);
		bezel.position.set(0, 2.4, 0.05);
		bezel.rotation.x = -0.15;
		g.add(bezel);
		// put screen in front of bezel
		screen.position.z = 0.12;

		const light = new THREE.PointLight(0x00ffc8, 2, 8, 2);
		light.position.set(0, 2.5, 1);
		g.add(light);

		// You are here marker ring
		const ring = new THREE.Mesh(
			new THREE.RingGeometry(0.9, 1.15, 40),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xff2d55,
					emissive: 0xff2d55,
					emissiveIntensity: 2,
					side: THREE.DoubleSide,
				}),
			),
		);
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.03;
		ring.name = 'youAreHere';
		g.add(ring);

		this.group.add(g);
	}

	private buildRailings(): void {
		const railMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x8899aa,
				metalness: 0.95,
				roughness: 0.15,
			}),
		);
		const glassMat = this.track(
			new THREE.MeshPhysicalMaterial({
				color: 0xaaddff,
				transparent: true,
				opacity: 0.12,
				transmission: 0.6,
				roughness: 0.05,
				side: THREE.DoubleSide,
			}),
		);

		const aw = 16;
		const ad = 12;
		// Atrium edge railings on floor 1
		const edges: [number, number, number, number, number][] = [
			// x, z, w, rotY, along axis length
			[0, -ad / 2, aw, 0, aw],
			[0, ad / 2, aw, 0, aw],
			[-aw / 2, 0, ad, Math.PI / 2, ad],
			[aw / 2, 0, ad, Math.PI / 2, ad],
		];

		for (
			const [x, z, len] of [
				[0, -ad / 2, aw],
				[0, ad / 2, aw],
			] as const
		) {
			const glass = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), glassMat);
			glass.position.set(x, FLOOR_H + 0.55, z);
			this.group.add(glass);
			const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), railMat);
			rail.position.set(x, FLOOR_H + 1.1, z);
			this.group.add(rail);
		}
		for (
			const [x, z, len] of [
				[-aw / 2, 0, ad],
				[aw / 2, 0, ad],
			] as const
		) {
			const glass = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), glassMat);
			glass.rotation.y = Math.PI / 2;
			glass.position.set(x, FLOOR_H + 0.55, z);
			this.group.add(glass);
			const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), railMat);
			rail.position.set(x, FLOOR_H + 1.1, z);
			this.group.add(rail);
		}
		void edges;
	}

	private buildCeilingLights(): void {
		const positions: [number, number, number][] = [];
		for (let x = -28; x <= 28; x += 8) {
			for (let z = -16; z <= 16; z += 8) {
				// skip atrium hole-ish
				if (Math.abs(x) < 10 && Math.abs(z) < 8) continue;
				positions.push([x, FLOOR_H * 2 + 1.2, z]);
				positions.push([x, FLOOR_H - 0.3, z]);
			}
		}

		const bulbMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xffeeb0,
				emissive: 0xffcc66,
				emissiveIntensity: 2,
			}),
		);

		for (const [x, y, z] of positions) {
			const bulb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.4), bulbMat);
			bulb.position.set(x, y, z);
			this.group.add(bulb);

			// Only some real lights for perf
			if ((x + z) % 16 === 0) {
				const l = new THREE.PointLight(0xffd8a0, 0.6, 14, 2);
				l.position.set(x, y - 0.5, z);
				this.group.add(l);
			}
		}
	}
}
