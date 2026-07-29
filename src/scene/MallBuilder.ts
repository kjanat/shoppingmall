import * as THREE from 'three';
import { getOwner } from '../data/shopOwners';
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
		// Warm beige mall floor (daylight American mall)
		const floorMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xd8cfc0,
				metalness: 0.05,
				roughness: 0.75,
			}),
		);

		const tileCanvas = document.createElement('canvas');
		tileCanvas.width = 256;
		tileCanvas.height = 256;
		const tctx = tileCanvas.getContext('2d')!;
		tctx.fillStyle = '#e8e0d4';
		tctx.fillRect(0, 0, 256, 256);
		tctx.strokeStyle = '#d0c8ba';
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
		// center walkway
		tctx.fillStyle = 'rgba(200, 180, 140, 0.25)';
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

		// Cream mall walls
		const wallMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xf0ebe3,
				metalness: 0.02,
				roughness: 0.9,
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
				color: 0xf5f0e8,
				metalness: 0.05,
				roughness: 0.85,
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

		// Skylight — simple transparent (no transmission black-hole)
		const glassMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xa8d4ff,
				metalness: 0.1,
				roughness: 0.15,
				transparent: true,
				opacity: 0.25,
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

		// Parking lot-ish ground outside
		const voidMat = this.track(
			new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.95 }),
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
		// Atrium planter + fake palm (classic US mall energy)
		const baseMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xb8a090,
				metalness: 0.1,
				roughness: 0.7,
			}),
		);

		const base = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.4, 0.35, 32), baseMat);
		base.position.y = 0.18;
		this.group.add(base);

		const planter = new THREE.Mesh(
			new THREE.CylinderGeometry(1.2, 1.4, 0.8, 24),
			this.track(
				new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.85 }),
			),
		);
		planter.position.y = 0.7;
		this.group.add(planter);

		// Dirt
		const dirt = new THREE.Mesh(
			new THREE.CylinderGeometry(1.05, 1.05, 0.15, 20),
			this.track(new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 1 })),
		);
		dirt.position.y = 1.05;
		this.group.add(dirt);

		// Palm trunk
		const trunk = new THREE.Mesh(
			new THREE.CylinderGeometry(0.12, 0.18, 2.4, 8),
			this.track(new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.9 })),
		);
		trunk.position.y = 2.2;
		trunk.name = 'atriumOrb';
		this.group.add(trunk);

		// Leaves
		const leafMat = this.track(
			new THREE.MeshStandardMaterial({ color: 0x2d8a4e, roughness: 0.85, side: THREE.DoubleSide }),
		);
		for (let i = 0; i < 6; i++) {
			const leaf = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), leafMat);
			const a = (i / 6) * Math.PI * 2;
			leaf.position.set(Math.cos(a) * 0.5, 3.4, Math.sin(a) * 0.5);
			leaf.rotation.y = a;
			leaf.rotation.z = -0.5;
			this.group.add(leaf);
		}

		const accent = new THREE.Mesh(
			new THREE.RingGeometry(2.6, 3.0, 48),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xc4b5a0,
					side: THREE.DoubleSide,
				}),
			),
		);
		accent.rotation.x = -Math.PI / 2;
		accent.position.y = 0.02;
		this.group.add(accent);
	}

	/**
	 * Escalator + stairs are SEPARATE and far apart — no intersecting spaghetti.
	 * Escalator: east wing (x=22), runs north so it never fights atrium hole or loopbanden.
	 * Stairs: west wing (x=-22), simple switchback-free straight run south.
	 */
	private buildEscalator(): void {
		// ── ROLTRAP (east) ─────────────────────────────────
		// Bottom near (22, 0, 6), top near (22, 6, -4)
		this.buildInclinedRun({
			name: 'escalator',
			x: 22,
			z: 6,
			// local: steps go toward -Z while rising
			run: 10,
			rise: FLOOR_H,
			width: 1.5,
			kind: 'escalator',
		});

		// ── TRAP (west) — separate structure, other side of mall ─
		this.buildInclinedRun({
			name: 'stairs',
			x: -22,
			z: -6,
			run: 10,
			rise: FLOOR_H,
			width: 2.2,
			kind: 'stairs',
		});
	}

	private buildInclinedRun(opts: {
		name: string;
		x: number;
		z: number;
		run: number;
		rise: number;
		width: number;
		kind: 'escalator' | 'stairs';
	}): void {
		const g = new THREE.Group();
		g.position.set(opts.x, 0, opts.z);
		g.name = opts.name;

		const metal = this.track(
			new THREE.MeshStandardMaterial({
				color: opts.kind === 'escalator' ? 0x455a64 : 0x8d6e63,
				metalness: opts.kind === 'escalator' ? 0.85 : 0.2,
				roughness: 0.35,
			}),
		);
		const stepMat = this.track(
			new THREE.MeshStandardMaterial({
				color: opts.kind === 'escalator' ? 0x37474f : 0xbcaaa4,
				metalness: 0.4,
				roughness: 0.5,
			}),
		);
		const railMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x90a4ae,
				metalness: 0.75,
				roughness: 0.3,
			}),
		);

		const { run, rise, width } = opts;
		const angle = Math.atan2(rise, run);
		const len = Math.hypot(rise, run);
		const stepCount = opts.kind === 'stairs' ? 12 : 16;

		// Landing pads so nothing clips into floor slabs
		const land0 = new THREE.Mesh(
			new THREE.BoxGeometry(width + 0.8, 0.15, 1.6),
			metal,
		);
		land0.position.set(0, 0.08, 0.6);
		g.add(land0);

		const land1 = new THREE.Mesh(
			new THREE.BoxGeometry(width + 0.8, 0.15, 1.6),
			metal,
		);
		land1.position.set(0, rise + 0.08, -run - 0.6);
		g.add(land1);

		// Stringer / truss under the run
		const truss = new THREE.Mesh(new THREE.BoxGeometry(width + 0.2, 0.28, len), metal);
		truss.rotation.x = -angle;
		truss.position.set(0, rise / 2 + 0.05, -run / 2);
		g.add(truss);

		// Steps along the incline (horizontal treads)
		for (let i = 0; i < stepCount; i++) {
			const t = (i + 0.5) / stepCount;
			const step = new THREE.Mesh(
				new THREE.BoxGeometry(width, 0.1, opts.kind === 'stairs' ? 0.7 : 0.42),
				stepMat,
			);
			step.position.set(0, t * rise + 0.12, -t * run);
			g.add(step);
		}

		// Handrails both sides
		for (const sx of [-width / 2 - 0.08, width / 2 + 0.08]) {
			const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), railMat);
			rail.rotation.x = -angle;
			rail.position.set(sx, rise / 2 + 0.85, -run / 2);
			g.add(rail);
			// posts
			for (let i = 0; i <= 4; i++) {
				const u = i / 4;
				const post = new THREE.Mesh(
					new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6),
					railMat,
				);
				post.position.set(sx, u * rise + 0.45, -u * run);
				g.add(post);
			}
		}

		// Simple glass sides (no broken PhysicalMaterial soup)
		const glass = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xb3d4e8,
				transparent: true,
				opacity: 0.22,
				roughness: 0.15,
				side: THREE.DoubleSide,
			}),
		);
		for (const sx of [-width / 2 - 0.05, width / 2 + 0.05]) {
			const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.7), glass);
			panel.position.set(sx, rise / 2 + 0.45, -run / 2);
			panel.rotation.order = 'YXZ';
			panel.rotation.y = Math.PI / 2;
			panel.rotation.x = -angle;
			g.add(panel);
		}

		// Label plate
		const label = opts.kind === 'escalator' ? 'ROLTRAP ↑' : 'TRAP ↑';
		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 64;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = opts.kind === 'escalator' ? '#1565c0' : '#6d4c41';
		ctx.fillRect(0, 0, 256, 64);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 28px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(label, 128, 32);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(1.4, 0.35),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		sign.position.set(0, 1.4, 0.9);
		g.add(sign);

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

		const bodyColor = new THREE.Color(store.color);
		bodyColor.offsetHSL(0, 0, 0.1);
		const wallMat = this.track(
			new THREE.MeshStandardMaterial({
				color: bodyColor,
				metalness: 0.15,
				roughness: 0.65,
			}),
		);

		/**
		 * OPEN BOX shop: front fully open toward corridor.
		 * Local +Z = entrance, local -Z = back.
		 * Thin walls ONLY on back + left + right — NOTHING in the middle.
		 */
		const wallT = 0.18;
		const roomDepth = d * 0.92;
		const backZ = -roomDepth;

		// Floor of shop (visible mat)
		const floor = new THREE.Mesh(
			new THREE.BoxGeometry(w - 0.2, 0.06, roomDepth),
			this.track(new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.85 })),
		);
		floor.position.set(0, 0.03, -roomDepth / 2);
		g.add(floor);

		// BACK wall only (thin slab at rear)
		const backWall = new THREE.Mesh(
			new THREE.BoxGeometry(w, h, wallT),
			wallMat,
		);
		backWall.position.set(0, h / 2, backZ);
		backWall.castShadow = true;
		g.add(backWall);

		// LEFT / RIGHT walls (thin, full depth — open storefront)
		for (const sx of [-w / 2 + wallT / 2, w / 2 - wallT / 2]) {
			const side = new THREE.Mesh(
				new THREE.BoxGeometry(wallT, h, roomDepth),
				wallMat,
			);
			side.position.set(sx, h / 2, -roomDepth / 2);
			g.add(side);
		}

		// Thin ceiling so it reads as a room
		const ceil = new THREE.Mesh(
			new THREE.BoxGeometry(w - 0.1, 0.1, roomDepth),
			this.track(new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.9 })),
		);
		ceil.position.set(0, h - 0.05, -roomDepth / 2);
		g.add(ceil);

		// Interior paint on back wall (facing into shop = +Z)
		const interior = new THREE.Mesh(
			new THREE.PlaneGeometry(w - 0.4, h - 0.6),
			this.track(
				new THREE.MeshStandardMaterial({
					color: new THREE.Color(store.accent).lerp(new THREE.Color(0xfff8f0), 0.5),
					roughness: 0.75,
					emissive: new THREE.Color(store.accent),
					emissiveIntensity: 0.1,
					side: THREE.DoubleSide,
				}),
			),
		);
		interior.position.set(0, h / 2, backZ + wallT / 2 + 0.02);
		g.add(interior);

		// Counter + shopkeeper in OPEN floor area (visible from door)
		const counter = new THREE.Mesh(
			new THREE.BoxGeometry(Math.min(w * 0.5, 2.8), 0.85, 0.5),
			this.track(new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.7 })),
		);
		counter.position.set(0, 0.42, -roomDepth * 0.55);
		g.add(counter);

		const keeper = this.makeShopkeeper(store);
		keeper.position.set(0, 0, -roomDepth * 0.68);
		g.add(keeper);

		// OPEN signs
		const openCanvas = document.createElement('canvas');
		openCanvas.width = 256;
		openCanvas.height = 96;
		const octx = openCanvas.getContext('2d')!;
		octx.fillStyle = '#15803d';
		octx.fillRect(0, 0, 256, 96);
		octx.fillStyle = '#fff';
		octx.font = 'bold 48px system-ui,sans-serif';
		octx.textAlign = 'center';
		octx.textBaseline = 'middle';
		octx.fillText('OPEN', 128, 48);
		const openTex = new THREE.CanvasTexture(openCanvas);
		openTex.colorSpace = THREE.SRGBColorSpace;
		const openSign = new THREE.Mesh(
			new THREE.PlaneGeometry(1.2, 0.45),
			this.track(new THREE.MeshBasicMaterial({ map: openTex, toneMapped: false })),
		);
		openSign.position.set(w * 0.32, h - 1.3, 0.08);
		g.add(openSign);

		// Bright interior lights so stock + keeper pop
		const shopLight = new THREE.PointLight(0xfff4e0, 8, 14, 1.6);
		shopLight.position.set(0, h - 0.6, -roomDepth * 0.4);
		g.add(shopLight);
		const shopLight2 = new THREE.PointLight(0xffffff, 4, 10, 2);
		shopLight2.position.set(0, 2.2, -roomDepth * 0.2);
		g.add(shopLight2);

		// Sign board — bright MeshBasic so names always readable
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
				new THREE.MeshBasicMaterial({
					map: signTex,
					toneMapped: false,
				}),
			),
		);
		sign.position.set(0, h - 0.3, 0.12);
		g.add(sign);

		// Accent strip under sign (solid color, NO emissive — flicker source)
		const strip = new THREE.Mesh(
			new THREE.BoxGeometry(w * 0.9, 0.08, 0.06),
			this.track(
				new THREE.MeshStandardMaterial({
					color: store.accent,
					roughness: 0.5,
					metalness: 0.1,
				}),
			),
		);
		strip.position.set(0, h - 0.95, 0.12);
		g.add(strip);

		// Pillars
		const pillarMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xd0cbc4,
				metalness: 0.15,
				roughness: 0.6,
			}),
		);
		for (const px of [-w / 2 + 0.2, w / 2 - 0.2]) {
			const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, h, 0.25), pillarMat);
			p.position.set(px, h / 2, 0);
			g.add(p);
		}

		// Hero extras for Kruidvat (matte green cross — still the joke destination)
		if (store.hero) {
			const crossMat = this.track(
				new THREE.MeshStandardMaterial({
					color: 0x00a651,
					roughness: 0.55,
					metalness: 0.1,
				}),
			);
			const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.4, 0.15), crossMat);
			const crossH = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 0.15), crossMat);
			crossV.position.set(-w / 2 + 1.2, h - 1.8, 0.2);
			crossH.position.copy(crossV.position);
			g.add(crossV, crossH);
		}

		return g;
	}

	private makeShopkeeper(store: StoreDef): THREE.Group {
		const owner = getOwner(store.id);
		const g = new THREE.Group();
		g.name = `keeper_${store.id}`;
		g.userData.ownerName = owner?.name ?? 'Verkoper';
		g.userData.ownerLines = owner?.lines ?? ['Thanks!'];
		g.userData.ownerMeaning = owner?.meaning ?? 'Houdt de winkel draaiende';

		const skinCol = owner?.skin ?? 0xe8c4a8;
		const shirtCol = owner?.shirt ?? new THREE.Color(store.color).getHex();
		const hairCol = owner?.hair ?? 0x2c1810;
		const skin = this.track(
			new THREE.MeshStandardMaterial({ color: skinCol, roughness: 0.85 }),
		);
		const uni = this.track(
			new THREE.MeshStandardMaterial({
				color: shirtCol,
				roughness: 0.8,
			}),
		);
		const hairMat = this.track(
			new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.9 }),
		);

		const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 4, 8), uni);
		body.position.y = 1.05;
		g.add(body);
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), skin);
		head.position.y = 1.55;
		g.add(head);
		// Hair cap
		const hair = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), hairMat);
		hair.position.y = 1.68;
		hair.scale.set(1, 0.55, 1);
		g.add(hair);

		// Simple black eyes + mouth (same language as guests)
		const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: 0x111111 }));
		const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMat);
		const eyeR = eyeL.clone();
		eyeL.position.set(-0.06, 1.58, 0.16);
		eyeR.position.set(0.06, 1.58, 0.16);
		g.add(eyeL, eyeR);
		const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), eyeMat);
		mouth.position.set(0, 1.48, 0.17);
		mouth.scale.set(1.4, 0.45, 0.5);
		g.add(mouth);

		const name = owner?.name ?? 'Verkoper';
		const title = owner?.title ?? 'Shop owner';
		const meaning = owner?.meaning ?? '';
		const pc = document.createElement('canvas');
		pc.width = 320;
		pc.height = 96;
		const pctx = pc.getContext('2d')!;
		pctx.fillStyle = '#0f172a';
		pctx.fillRect(0, 0, 320, 96);
		// accent bar for named owners
		pctx.fillStyle = owner ? '#4ade80' : '#64748b';
		pctx.fillRect(0, 0, 6, 96);
		pctx.fillStyle = '#f8fafc';
		pctx.font = 'bold 20px system-ui,sans-serif';
		pctx.textAlign = 'center';
		pctx.fillText(name.slice(0, 20), 160, 28);
		pctx.fillStyle = '#94a3b8';
		pctx.font = '14px system-ui,sans-serif';
		pctx.fillText(title.slice(0, 24), 160, 50);
		if (meaning) {
			pctx.fillStyle = '#a78bfa';
			pctx.font = '12px system-ui,sans-serif';
			pctx.fillText(meaning.slice(0, 36), 160, 74);
		}
		const ptex = new THREE.CanvasTexture(pc);
		ptex.colorSpace = THREE.SRGBColorSpace;
		const plate = new THREE.Mesh(
			new THREE.PlaneGeometry(1.35, 0.4),
			this.track(new THREE.MeshBasicMaterial({ map: ptex, toneMapped: false })),
		);
		plate.position.set(0, 2.15, 0.12);
		g.add(plate);
		return g;
	}

	private buildKiosk(): void {
		const g = new THREE.Group();
		g.position.set(0, 0, 10);
		g.name = 'kiosk';

		const bodyMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x4a5568,
				metalness: 0.3,
				roughness: 0.5,
			}),
		);
		const screenMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x3b82f6,
				roughness: 0.4,
			}),
		);

		const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.1, 24), bodyMat);
		base.position.y = 0.55;
		g.add(base);

		const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.2, 12), bodyMat);
		pole.position.y = 1.6;
		g.add(pole);

		const bezel = new THREE.Mesh(
			new THREE.BoxGeometry(1.55, 1.1, 0.1),
			bodyMat,
		);
		bezel.position.set(0, 2.4, 0.05);
		bezel.rotation.x = -0.15;
		g.add(bezel);

		const screen = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.95, 0.08), screenMat);
		screen.position.set(0, 2.4, 0.12);
		screen.rotation.x = -0.15;
		g.add(screen);

		// You are here marker (matte red, no pulse material)
		const ring = new THREE.Mesh(
			new THREE.RingGeometry(0.9, 1.15, 40),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xdc2626,
					side: THREE.DoubleSide,
					roughness: 0.6,
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
			new THREE.MeshStandardMaterial({
				color: 0xc5e0f5,
				transparent: true,
				opacity: 0.25,
				roughness: 0.1,
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

		// Fluorescent panels (matte, no emissive strobe)
		const bulbMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xf5f0e0,
				roughness: 0.4,
			}),
		);

		for (const [x, y, z] of positions) {
			const bulb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.4), bulbMat);
			bulb.position.set(x, y, z);
			this.group.add(bulb);
		}
	}
}
