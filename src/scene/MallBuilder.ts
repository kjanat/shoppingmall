import * as THREE from 'three';
import { getOwner } from '@/data/shopOwners';
import { STORES, type StoreDef } from '@/data/stores';
import { ctx2d } from '@/util/dom';
import { at } from '@/util/rand';

const FLOOR_H = 6;
const MALL_W = 72;
const MALL_D = 48;

/** Tiny stable hash for per-staff variety */
function hashStr(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

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
	const ctx = ctx2d(canvas);

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
		this.materials.forEach((m) => {
			m.dispose();
		});
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
		const tctx = ctx2d(tileCanvas);
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

		const floor0 = new THREE.Mesh(new THREE.BoxGeometry(MALL_W, 0.3, MALL_D), floorMat);
		floor0.position.y = -0.15;
		floor0.receiveShadow = true;
		this.group.add(floor0);

		// Floor 1 ring: atrium void + REAL openings where stairs/escalator meet floor 1
		const floor1Mat = this.track(floorMat.clone());
		const f1Shape = new THREE.Shape();
		f1Shape.moveTo(-MALL_W / 2, -MALL_D / 2);
		f1Shape.lineTo(MALL_W / 2, -MALL_D / 2);
		f1Shape.lineTo(MALL_W / 2, MALL_D / 2);
		f1Shape.lineTo(-MALL_W / 2, MALL_D / 2);
		f1Shape.lineTo(-MALL_W / 2, -MALL_D / 2);

		const rectHole = (shape: THREE.Shape, cx: number, cz: number, hw: number, hd: number) => {
			// rotateX(-π/2) maps shape-y → world −z, so cut at NEGATED z. Without
			// this every asymmetric hole landed mirrored: the stair openings sat on
			// the wrong side of the mall while the flights pierced solid slab. The
			// atrium hole at (0,0) mirrored onto itself, which is why it "worked".
			const sy = -cz;
			const h = new THREE.Path();
			h.moveTo(cx - hw, sy - hd);
			h.lineTo(cx + hw, sy - hd);
			h.lineTo(cx + hw, sy + hd);
			h.lineTo(cx - hw, sy + hd);
			h.lineTo(cx - hw, sy - hd);
			shape.holes.push(h);
		};
		const addRectHole = (cx: number, cz: number, hw: number, hd: number) => rectHole(f1Shape, cx, cz, hw, hd);

		// Center atrium
		const aw = 16;
		const ad = 12;
		addRectHole(0, 0, aw / 2, ad / 2);

		// The openings must sit OVER the flights, not next to their top landings —
		// each hole spans from just past the top down to where the incline is ~2 m
		// under the slab, which is the stretch where your head would hit concrete.
		// West stairs: incline z=+4 (bottom) → z=-14 (top), so open z -14.6 … -7.4
		addRectHole(-22, -11, 2.0, 3.6);
		// East escalator: incline z=+8 → z=-2, so open z -2.6 … +1.6
		addRectHole(22, -0.5, 1.7, 2.1);
		// Glazen lift (16, -8): schacht V0 → dak — zonder dit gat prikte de
		// glascabine dwars door de verdieping-1-plaat heen
		addRectHole(16, -8, 1.2, 1.2);

		// USA-dikke plaat (0.45), en de TOP ligt op FLOOR_H: extrude gaat +Y, dus
		// de mesh zakt een plaatdikte. Voorheen stak de plaat 6.0→6.3 omhoog en
		// liep iedereen op verdieping 1 tot de enkels in het beton.
		const SLAB_T = 0.45;
		const f1Geo = new THREE.ExtrudeGeometry(f1Shape, {
			depth: SLAB_T,
			bevelEnabled: false,
		});
		f1Geo.rotateX(-Math.PI / 2);
		const floor1 = new THREE.Mesh(f1Geo, floor1Mat);
		floor1.position.y = FLOOR_H - SLAB_T;
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
		// Own shape — NOT f1Shape.clone(): the ceiling used to inherit the two
		// stairwell holes (gaping holes above nothing) and lacked the one opening
		// it actually needs, where the secret service stairs exit to the roof.
		const ceilShape = new THREE.Shape();
		ceilShape.moveTo(-MALL_W / 2, -MALL_D / 2);
		ceilShape.lineTo(MALL_W / 2, -MALL_D / 2);
		ceilShape.lineTo(MALL_W / 2, MALL_D / 2);
		ceilShape.lineTo(-MALL_W / 2, MALL_D / 2);
		ceilShape.lineTo(-MALL_W / 2, -MALL_D / 2);
		rectHole(ceilShape, 0, 0, aw / 2, ad / 2);
		// Secret stairs run (26, y6, z14) → (26, roof, z18); hole matches the ramp
		rectHole(ceilShape, 26, 16.25, 1.5, 2.6);
		// Glazen lift naar het dak — zelfde schachtgat als in de V1-plaat
		rectHole(ceilShape, 16, -8, 1.2, 1.2);
		// Glass elevator shaft (16, −8) — hatch so cabin + dak-callstation sit on open roof
		rectHole(ceilShape, 16, -8, 1.45, 1.45);
		const ceilGeo = new THREE.ExtrudeGeometry(ceilShape, {
			depth: 0.4, // USA dikte — het dakdek (13.95) rust hier bovenop
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
		const skylight = new THREE.Mesh(new THREE.PlaneGeometry(aw + 1, ad + 1), glassMat);
		skylight.rotation.x = -Math.PI / 2;
		skylight.position.y = FLOOR_H * 2 + 1.4;
		this.group.add(skylight);

		// Parking lot-ish ground outside
		const voidMat = this.track(new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.95 }));
		const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), voidMat);
		voidPlane.rotation.x = -Math.PI / 2;
		voidPlane.position.y = -0.5;
		this.group.add(voidPlane);
	}

	/**
	 * Marble Greek god in the middle of the fountain — the owner himself.
	 * Sits inside the atrium void, so nothing pokes through the floor-1 slab.
	 */
	private buildGodStatue(): void {
		const marble = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xe9e5dd,
				roughness: 0.35,
				metalness: 0.05,
			}),
		);
		const gold = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xd4af37,
				metalness: 0.9,
				roughness: 0.25,
			}),
		);

		const g = new THREE.Group();
		g.name = 'godStatue';
		g.position.set(0, 1.12, 0);

		// Plinth
		const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.5, 16), marble);
		plinth.position.y = 0.25;
		plinth.castShadow = true;
		g.add(plinth);
		const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.08, 16), marble);
		cap.position.y = 0.54;
		g.add(cap);

		const figure = new THREE.Group();
		figure.position.y = 0.58;
		// Contrapposto — a god does not stand to attention
		figure.rotation.y = -0.35;
		g.add(figure);

		// Legs under a robe
		for (const side of [-1, 1] as const) {
			const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.9, 10), marble);
			leg.position.set(side * 0.14, 0.45, side === 1 ? 0.06 : -0.02);
			leg.rotation.x = side === 1 ? 0.12 : -0.05;
			leg.castShadow = true;
			figure.add(leg);
		}

		// Robe / himation draped from the hip
		const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.15, 14, 1, true), marble);
		robe.position.y = 0.72;
		robe.castShadow = true;
		figure.add(robe);
		const sash = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.05, 6, 14), marble);
		sash.rotation.x = Math.PI / 2 - 0.25;
		sash.position.y = 1.2;
		figure.add(sash);

		// Torso + shoulders
		const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.42, 6, 12), marble);
		torso.position.y = 1.5;
		torso.castShadow = true;
		figure.add(torso);
		const pecs = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), marble);
		pecs.scale.set(1.25, 0.62, 0.8);
		pecs.position.set(0, 1.66, 0.06);
		figure.add(pecs);

		// Head, beard, laurel
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 14), marble);
		head.position.y = 2.02;
		head.castShadow = true;
		figure.add(head);
		const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), marble);
		nose.rotation.x = Math.PI / 2;
		nose.position.set(0, 2.02, 0.2);
		figure.add(nose);
		const beard = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), marble);
		beard.scale.set(0.9, 1.1, 0.75);
		beard.position.set(0, 1.88, 0.09);
		figure.add(beard);
		const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), marble);
		hair.position.set(0, 2.04, -0.02);
		figure.add(hair);
		const laurel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 6, 16), gold);
		laurel.rotation.x = Math.PI / 2 - 0.12;
		laurel.position.y = 2.12;
		figure.add(laurel);

		// Right arm raised, holding a golden shopping bag. Obviously.
		const armGeo = new THREE.CapsuleGeometry(0.075, 0.4, 5, 8);
		const armUp = new THREE.Mesh(armGeo, marble);
		armUp.position.set(0.3, 1.78, 0.02);
		armUp.rotation.z = -1.15;
		figure.add(armUp);
		const forearm = new THREE.Mesh(armGeo, marble);
		forearm.position.set(0.54, 2.02, 0.02);
		forearm.rotation.z = -0.2;
		figure.add(forearm);

		const bag = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.14), gold);
		bag.position.set(0.6, 2.32, 0.02);
		figure.add(bag);
		const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.014, 5, 12, Math.PI), gold);
		handle.position.set(0.6, 2.47, 0.02);
		figure.add(handle);

		// Left arm down, palm out — benevolent landlord energy
		const armDown = new THREE.Mesh(armGeo, marble);
		armDown.position.set(-0.29, 1.5, 0.05);
		armDown.rotation.z = 0.28;
		figure.add(armDown);
		const hand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), marble);
		hand.scale.set(1, 0.7, 1.1);
		hand.position.set(-0.36, 1.22, 0.1);
		figure.add(hand);

		// Plaque
		const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.02), gold);
		plaque.position.set(0, 0.3, 0.69);
		g.add(plaque);

		this.group.add(g);
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
			this.track(new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.85 })),
		);
		planter.position.y = 0.7;
		this.group.add(planter);

		// Water instead of dirt — it is a fountain, not a plant pot
		const water = new THREE.Mesh(
			new THREE.CylinderGeometry(1.15, 1.15, 0.12, 24),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x2a7ea8,
					metalness: 0.35,
					roughness: 0.15,
					transparent: true,
					opacity: 0.85,
				}),
			),
		);
		water.position.y = 1.06;
		this.group.add(water);

		// The palm that used to grow out of the middle of the fountain is gone.
		// In its place: the owner, immortalised in marble.
		this.buildGodStatue();

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

	/** Small marble pedestal figure on the fountain island */
	/**
	 * ONE escalator (east) + ONE stairs (west). Never cross. Never share a shaft.
	 * Each has a hole cut in floor-1 at the top landing.
	 */
	private buildEscalator(): void {
		// East roltrap: bottom (22,0,8) → top (22,6,-2)  — only along +X wall
		this.buildStraightFlight({
			name: 'escalator',
			x: 22,
			zBottom: 8,
			zTop: -2,
			rise: FLOOR_H,
			width: 1.6,
			kind: 'escalator',
		});
		// West trap: bottom (-22,0,4) → top (-22,6,-14) — opposite wall, no cross
		this.buildStraightFlight({
			name: 'stairs',
			x: -22,
			zBottom: 4,
			zTop: -14,
			rise: FLOOR_H,
			width: 2.4,
			kind: 'stairs',
		});
	}

	/** Proper single flight: steps don't overlap, no X-crossing truss soup */
	private buildStraightFlight(opts: {
		name: string;
		x: number;
		zBottom: number;
		zTop: number;
		rise: number;
		width: number;
		kind: 'escalator' | 'stairs';
	}): void {
		const g = new THREE.Group();
		g.name = opts.name;
		// World-space build so nothing is rotated into another flight
		const z0 = opts.zBottom;
		const z1 = opts.zTop;
		const run = Math.abs(z1 - z0);
		const dir = z1 < z0 ? -1 : 1;
		const steps = opts.kind === 'stairs' ? 14 : 18;
		const metal = this.track(
			new THREE.MeshStandardMaterial({
				color: opts.kind === 'escalator' ? 0x455a64 : 0x6d4c41,
				metalness: opts.kind === 'escalator' ? 0.8 : 0.15,
				roughness: 0.4,
			}),
		);
		const tread = this.track(
			new THREE.MeshStandardMaterial({
				color: opts.kind === 'escalator' ? 0x37474f : 0xd7ccc8,
				roughness: 0.55,
			}),
		);
		const railMat = this.track(new THREE.MeshStandardMaterial({ color: 0xb0bec5, metalness: 0.7, roughness: 0.3 }));

		// Bottom landing
		const land0 = new THREE.Mesh(new THREE.BoxGeometry(opts.width + 0.6, 0.12, 1.4), metal);
		land0.position.set(opts.x, 0.06, z0 - dir * 0.5);
		g.add(land0);

		// Top landing (sits in floor-1 hole)
		const land1 = new THREE.Mesh(new THREE.BoxGeometry(opts.width + 0.6, 0.12, 1.5), metal);
		land1.position.set(opts.x, opts.rise + 0.06, z1 + dir * 0.35);
		g.add(land1);

		// Discrete steps — each tread only occupies its own band (no cross)
		const stepDepth = run / steps;
		const stepRise = opts.rise / steps;
		for (let i = 0; i < steps; i++) {
			const z = z0 + dir * (i + 0.5) * stepDepth;
			const y = (i + 1) * stepRise;
			const step = new THREE.Mesh(new THREE.BoxGeometry(opts.width, 0.12, stepDepth * 0.92), tread);
			step.position.set(opts.x, y - 0.06, z);
			g.add(step);
			// riser
			const riser = new THREE.Mesh(new THREE.BoxGeometry(opts.width, stepRise * 0.95, 0.06), metal);
			riser.position.set(opts.x, y - stepRise * 0.5, z - dir * stepDepth * 0.45);
			g.add(riser);
		}

		// Side stringers (thin vertical boards, NOT a diagonal beam that looks like a cross)
		for (const sx of [opts.x - opts.width / 2 - 0.06, opts.x + opts.width / 2 + 0.06]) {
			for (let i = 0; i < steps; i++) {
				const z = z0 + dir * (i + 0.5) * stepDepth;
				const y = (i + 0.5) * stepRise;
				const board = new THREE.Mesh(new THREE.BoxGeometry(0.1, stepRise + 0.08, stepDepth * 0.95), metal);
				board.position.set(sx, y, z);
				g.add(board);
			}
			// handrail as polyline of short segments (no single X-beam)
			for (let i = 0; i < steps; i++) {
				const z = z0 + dir * (i + 0.5) * stepDepth;
				const y = (i + 1) * stepRise + 0.75;
				const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6), railMat);
				post.position.set(sx, y - 0.35, z);
				g.add(post);
				if (i < steps - 1) {
					const z2 = z0 + dir * (i + 1.5) * stepDepth;
					const y2 = (i + 2) * stepRise + 0.75;
					const midZ = (z + z2) / 2;
					const midY = (y + y2) / 2;
					const segLen = Math.hypot(z2 - z, y2 - y);
					const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, segLen), railMat);
					rail.position.set(sx, midY, midZ);
					rail.rotation.x = Math.atan2(y2 - y, z2 - z);
					g.add(rail);
				}
			}
		}

		// Label
		const label = opts.kind === 'escalator' ? 'ROLTRAP ↑' : 'TRAP ↑';
		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 64;
		const ctx = ctx2d(c);
		ctx.fillStyle = opts.kind === 'escalator' ? '#1565c0' : '#5d4037';
		ctx.fillRect(0, 0, 256, 64);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 28px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(label, 128, 32);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(1.5, 0.38),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		sign.position.set(opts.x, 1.5, z0 - dir * 0.2);
		g.add(sign);

		// Safety rail around floor-1 hole edges (short segments)
		const holeZ = z1;
		for (const side of [-1, 1]) {
			const cap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 3.5), railMat);
			cap.position.set(opts.x + side * (opts.width / 2 + 0.5), FLOOR_H + 0.55, holeZ);
			g.add(cap);
		}

		this.group.add(g);
	}

	private buildStores(): void {
		for (const store of STORES) {
			if (store.id === 'info' || store.utility) continue;
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
		const backWall = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallT), wallMat);
		backWall.position.set(0, h / 2, backZ);
		backWall.castShadow = true;
		g.add(backWall);

		// LEFT / RIGHT walls (thin, full depth — open storefront)
		for (const sx of [-w / 2 + wallT / 2, w / 2 - wallT / 2]) {
			const side = new THREE.Mesh(new THREE.BoxGeometry(wallT, h, roomDepth), wallMat);
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

		// Counter + 5 guys on the floor (owner + 4 staff)
		const counterW = Math.min(w * 0.78, 5.2);
		const counter = new THREE.Mesh(
			new THREE.BoxGeometry(counterW, 0.85, 0.5),
			this.track(new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.7 })),
		);
		counter.position.set(0, 0.42, -roomDepth * 0.55);
		g.add(counter);

		const crew = 5;
		const span = Math.min(counterW * 0.88, 4.6);
		for (let i = 0; i < crew; i++) {
			const t = i / (crew - 1);
			const x = (t - 0.5) * span;
			const guy = this.makeShopkeeper(store, i);
			// Behind counter, facing storefront (+Z)
			guy.position.set(x, 0, -roomDepth * 0.68);
			g.add(guy);
		}

		// OPEN signs
		const openCanvas = document.createElement('canvas');
		openCanvas.width = 256;
		openCanvas.height = 96;
		const octx = ctx2d(openCanvas);
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
		// GEEN PointLights per winkel meer: 19 winkels × 2 lampen = ~38 lichten,
		// en bij forward rendering rekent élk object met ál die lichten mee — dat
		// was de grootste framekiller. Een emissive plafondpaneel leest hetzelfde.
		const lightPanel = new THREE.Mesh(
			new THREE.PlaneGeometry(w * 0.6, roomDepth * 0.5),
			this.track(new THREE.MeshBasicMaterial({ color: 0xfff4e0, toneMapped: false })),
		);
		lightPanel.rotation.x = Math.PI / 2;
		lightPanel.position.set(0, h - 0.15, -roomDepth * 0.4);
		g.add(lightPanel);

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

	/**
	 * One of five floor staff. Index 0 = named owner (`keeper_${id}` for ShopVoice).
	 * 1–4 = extra guys with store-branded uniforms.
	 */
	private makeShopkeeper(store: StoreDef, index = 0): THREE.Group {
		const owner = getOwner(store.id);
		const isBoss = index === 0;
		const g = new THREE.Group();
		g.name = isBoss ? `keeper_${store.id}` : `staff_${store.id}_${index}`;

		// Deterministic variety from store id + index
		const seed = hashStr(`${store.id}:${index}`);
		const skins = [0xe8c4a8, 0xf5c9a8, 0xd4a574, 0xc68642, 0x8d5524, 0xffdbac];
		const hairs = [0x1a1a1a, 0x2c1810, 0xc4a35a, 0x4a3728, 0xf5f5f5, 0x3e2723];
		const staffNames = ['Jan', 'Kevin', 'Mo', 'Daan', 'Luca', 'Sam', 'Omar', 'Nick', 'Bram', 'Timo', 'Jay', 'Rico'];
		const staffTitles = ['Verkoper', 'Kassa', 'Vulploeg', 'Floor', 'Stagiair'];

		const skinCol = isBoss ? (owner?.skin ?? 0xe8c4a8) : skins[seed % skins.length];
		const shirtCol = isBoss
			? (owner?.shirt ?? new THREE.Color(store.color).getHex())
			: // staff: store color, slightly varied brightness
				new THREE.Color(store.color).offsetHSL(0, 0, ((seed % 5) - 2) * 0.04).getHex();
		const hairCol = isBoss ? (owner?.hair ?? 0x2c1810) : at(hairs, seed * 3);

		g.userData['ownerName'] = isBoss ? (owner?.name ?? 'Verkoper') : at(staffNames, seed + index);
		g.userData['ownerLines'] = owner?.lines ?? ['Thanks!'];
		g.userData['ownerMeaning'] = isBoss ? (owner?.meaning ?? 'Houdt de winkel draaiende') : 'Werkt hier gewoon';

		const skin = this.track(new THREE.MeshStandardMaterial({ color: skinCol, roughness: 0.85 }));
		const uni = this.track(
			new THREE.MeshStandardMaterial({
				color: shirtCol,
				roughness: 0.8,
			}),
		);
		const hairMat = this.track(new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.9 }));
		const pants = this.track(
			new THREE.MeshStandardMaterial({
				color: isBoss ? 0x1a1a2e : 0x2c3e50,
				roughness: 0.85,
			}),
		);

		// Slight size variety so the crew doesn't look cloned
		const scale = isBoss ? 1 : 0.9 + (seed % 7) * 0.02;
		const bodyG = new THREE.Group();

		const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 3, 6), pants);
		const legR = legL.clone();
		legL.position.set(-0.1, 0.38, 0);
		legR.position.set(0.1, 0.38, 0);
		bodyG.add(legL, legR);

		const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 8), uni);
		body.position.y = 1.0;
		bodyG.add(body);

		// Store name tag on chest
		const badge = new THREE.Mesh(
			new THREE.BoxGeometry(0.18, 0.1, 0.02),
			this.track(
				new THREE.MeshStandardMaterial({
					color: store.accent ? new THREE.Color(store.accent).getHex() : 0xffffff,
					roughness: 0.5,
				}),
			),
		);
		badge.position.set(0.12, 1.15, 0.18);
		bodyG.add(badge);

		const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), skin);
		head.position.y = 1.48;
		bodyG.add(head);
		const hair = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), hairMat);
		hair.position.y = 1.6;
		hair.scale.set(1, 0.55, 1);
		bodyG.add(hair);

		const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: 0x111111 }));
		const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), eyeMat);
		const eyeR = eyeL.clone();
		eyeL.position.set(-0.055, 1.5, 0.15);
		eyeR.position.set(0.055, 1.5, 0.15);
		bodyG.add(eyeL, eyeR);
		const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), eyeMat);
		mouth.position.set(0, 1.4, 0.15);
		mouth.scale.set(1.4, 0.45, 0.5);
		bodyG.add(mouth);

		bodyG.scale.setScalar(scale);
		g.add(bodyG);

		const name = isBoss ? (owner?.name ?? 'Verkoper') : String(g.userData['ownerName'] ?? 'Verkoper');
		const title = isBoss ? (owner?.title ?? 'Shop owner') : at(staffTitles, index);
		const meaning = isBoss ? (owner?.meaning ?? '') : `Crew #${index + 1}`;

		const pc = document.createElement('canvas');
		pc.width = 320;
		pc.height = 96;
		const pctx = ctx2d(pc);
		pctx.fillStyle = '#0f172a';
		pctx.fillRect(0, 0, 320, 96);
		pctx.fillStyle = isBoss && owner ? '#4ade80' : '#38bdf8';
		pctx.fillRect(0, 0, 6, 96);
		pctx.fillStyle = '#f8fafc';
		pctx.font = 'bold 20px system-ui,sans-serif';
		pctx.textAlign = 'center';
		pctx.fillText(name.slice(0, 20), 160, 28);
		pctx.fillStyle = '#94a3b8';
		pctx.font = '14px system-ui,sans-serif';
		pctx.fillText(title.slice(0, 24), 160, 50);
		if (meaning) {
			pctx.fillStyle = isBoss ? '#a78bfa' : '#64748b';
			pctx.font = '12px system-ui,sans-serif';
			pctx.fillText(meaning.slice(0, 36), 160, 74);
		}
		const ptex = new THREE.CanvasTexture(pc);
		ptex.colorSpace = THREE.SRGBColorSpace;
		const plate = new THREE.Mesh(
			new THREE.PlaneGeometry(1.2, 0.36),
			this.track(new THREE.MeshBasicMaterial({ map: ptex, toneMapped: false })),
		);
		plate.position.set(0, 2.05 * scale, 0.12);
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

		const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.1, 0.1), bodyMat);
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

		for (const [x, z, len] of [
			[0, -ad / 2, aw],
			[0, ad / 2, aw],
		] as const) {
			const glass = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), glassMat);
			glass.position.set(x, FLOOR_H + 0.55, z);
			this.group.add(glass);
			const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), railMat);
			rail.position.set(x, FLOOR_H + 1.1, z);
			this.group.add(rail);
		}
		for (const [x, z, len] of [
			[-aw / 2, 0, ad],
			[aw / 2, 0, ad],
		] as const) {
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
