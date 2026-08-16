import type { Material, Vector3 as Vector3Type } from 'three';
import {
	BoxGeometry,
	ConeGeometry,
	CylinderGeometry,
	DoubleSide,
	ExtrudeGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	RingGeometry,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	Vector3,
} from 'three';
import { levelY } from '#/data/levels';
import {
	HELIPAD_DECK_PLAN,
	HELIPAD_DECK_THICKNESS,
	HELIPAD_DECK_TOP_Y,
	HELIPAD_HATCH,
	HELIPAD_HATCH_FRAME_RAILS,
	HELIPAD_HATCH_FRAME_SPEC,
	HELIPAD_HATCH_GATE,
	HELIPAD_HATCH_SPEC,
	HELIPAD_PAD_SPEC,
	mechanismGateBounds,
	mechanismTriggerBounds,
	SECRET_STAIRS_OPENING_PLAN,
	stairConnector,
} from '#/data/world';
import type { CollisionWorld, RoofPad } from '#/physics/Collision';
import type { LightPool } from '#/render/LightPool';
import { lit } from '#/render/material';
import { addBoxMesh } from '#/render/meshFactory';
import { addXZPlanHole, xzPlanShape } from '#/render/xzShape';
import { backToBackLabel, labelCanvas, labelTexture } from '#/util/label';
import { clamp, half, midpoint, span } from '#/util/math';

/** Roof Y — top of the mall roof slab. */
export const ROOF_Y = levelY('roof');
/** Everything on the helipad stands on the deck, which is a few cm proud of that slab. */
const DECK_TOP = HELIPAD_DECK_TOP_Y;
/** Hoever het luikblad opengaat, uit de openstand van zijn eigen mechanisme. */
const HATCH_OPEN_ANGLE = HELIPAD_HATCH_GATE.openState.rotationRadians ?? 0;
/** Hoever het plateau in het dek zakt, zodat zijn onderrand niet met de dekplaat vecht. */
const PAD_SINK = 0.01;

/**
 * Secret service stairs (V1 → dak) + helicopter landing pad on the roof.
 * Reachable on foot; "land" = stand on the H.
 */
export class Helipad {
	readonly group = new Group();
	readonly padCenter = new Vector3(HELIPAD_PAD_SPEC.center.x, DECK_TOP, HELIPAD_PAD_SPEC.center.z);
	private materials: Material[] = [];
	private pool: LightPool;
	/** De scharniergroep staat op de noordrand van het gat; het blad hangt er in +z aan. */
	private readonly hatchLeaf = new Group();
	private readonly hatchZone = mechanismTriggerBounds(HELIPAD_HATCH, HELIPAD_HATCH_GATE.id);
	private readonly hatchFloor: RoofPad;
	/** 0 = dicht over het trapgat, 1 = rechtop. */
	private hatchOpen = 0;

	constructor(pool: LightPool, world: CollisionWorld) {
		this.pool = pool;
		this.group.name = 'helipad';
		this.buildSecretStairs();
		this.buildRoofDeck();
		this.buildPad();
		this.buildLights();
		this.buildSigns();
		this.hatchFloor = this.buildHatch(world);
	}

	/**
	 * Het luik boven de geheime trap.
	 *
	 * Staat er iemand in de aanwezigheidszone van `HELIPAD_HATCH_GATE`, dan zwaait het
	 * blad omhoog en ligt het trapgat open; staat er niemand, dan valt het dicht en is
	 * de vloer daar gewoon het dek. De zone kijkt ook onder het dek, zodat wie de trap
	 * op klimt niet tegen een dicht luik aan loopt.
	 */
	update(dt: number, subject: Vector3Type): void {
		const zone = this.hatchZone;
		const inside =
			subject.x > zone.minX &&
			subject.x < zone.maxX &&
			subject.z > zone.minZ &&
			subject.z < zone.maxZ &&
			subject.y > zone.minY &&
			subject.y < zone.maxY;
		const target = inside ? 1 : 0;
		const step = dt / HELIPAD_HATCH_SPEC.openSeconds;
		this.hatchOpen = clamp(this.hatchOpen + Math.sign(target - this.hatchOpen) * step, 0, 1);
		this.hatchLeaf.rotation.x = -HATCH_OPEN_ANGLE * this.hatchOpen;
		this.hatchFloor.disabled = this.hatchOpen >= HELIPAD_HATCH_SPEC.clearFraction;
	}

	private buildHatch(world: CollisionWorld): RoofPad {
		const gate = mechanismGateBounds(HELIPAD_HATCH, HELIPAD_HATCH_GATE.id);
		const width = span(gate.minX, gate.maxX);
		const thickness = span(gate.minY, gate.maxY);
		const depth = span(gate.minZ, gate.maxZ);
		const leaf = new Mesh(
			new BoxGeometry(width, thickness, depth),
			this.track(lit({ color: 0x546e7a, metalness: 0.5, roughness: 0.45 })),
		);
		leaf.name = 'hatch-lid';
		leaf.position.set(0, half(thickness), half(depth));
		leaf.castShadow = true;
		this.hatchLeaf.position.set(midpoint(gate.minX, gate.maxX), gate.minY, gate.minZ);
		this.hatchLeaf.add(leaf);
		this.group.add(this.hatchLeaf);
		return world.addRoofPad({
			minX: gate.minX,
			maxX: gate.maxX,
			minZ: gate.minZ,
			maxZ: gate.maxZ,
			y: ROOF_Y,
			label: 'helipad_hatch',
		});
	}

	private track<T extends Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	/** Hidden service stairwell on the SE service edge */
	private buildSecretStairs(): void {
		const stairs = stairConnector('secret-stairs');
		const { appearance } = stairs;
		const { serviceEntrance } = appearance;
		if (!serviceEntrance) throw new Error(`${stairs.id}: helipad-flight presentation is incomplete`);
		const g = new Group();
		g.name = stairs.id;
		const x = stairs.x;
		const z0 = stairs.zBottom;
		const z1 = stairs.zTop;
		const y0 = levelY(stairs.from) + appearance.surfaceOffset;
		const y1 = levelY(stairs.to);
		const rise = y1 - y0;
		const run = Math.abs(z1 - z0);
		const direction = z1 < z0 ? -1 : 1;
		const steps = stairs.steps;
		const metal = this.track(
			lit({
				color: 0x455a64,
				metalness: 0.55,
				roughness: 0.45,
			}),
		);
		const tread = this.track(lit({ color: 0x78909c, roughness: 0.55, metalness: 0.3 }));

		// Service door facade on floor 1
		const doorSpec = serviceEntrance.door;
		const door = new Mesh(
			new BoxGeometry(doorSpec.width, doorSpec.height, doorSpec.thickness),
			this.track(lit({ color: 0x37474f, roughness: 0.7 })),
		);
		door.position.set(x + doorSpec.lateralOffset, y0 + doorSpec.verticalOffset, z0 + doorSpec.depthOffset);
		g.add(door);

		const { canvas: c, ctx } = labelCanvas(256, 96);
		ctx.fillStyle = '#b71c1c';
		ctx.fillRect(0, 0, 256, 96);
		ctx.fillStyle = '#ffc107';
		ctx.font = 'bold 22px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('ALLEEN PERSONEEL', 128, 38);
		ctx.font = '16px system-ui';
		ctx.fillText('→ DAK / HELIPAD', 128, 68);
		const tex = labelTexture(c);
		const plate = new Mesh(
			new PlaneGeometry(serviceEntrance.sign.width, serviceEntrance.sign.height),
			this.track(new MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		plate.position.set(
			x + serviceEntrance.sign.lateralOffset,
			y0 + serviceEntrance.sign.verticalOffset,
			z0 + serviceEntrance.sign.depthOffset,
		);
		g.add(plate);

		// Steps climb in +Z while rising
		const stepD = run / steps;
		const stepH = rise / steps;
		for (let i = 0; i < steps; i++) {
			const z = z0 + direction * (i + 0.5) * stepD;
			const y = y0 + (i + 1) * stepH;
			const step = new Mesh(
				new BoxGeometry(
					stairs.width - appearance.step.widthInset,
					appearance.step.treadThickness,
					stepD * appearance.step.treadDepthRatio,
				),
				tread,
			);
			step.position.set(x, y - half(appearance.step.treadThickness), z);
			g.add(step);
			const riser = new Mesh(
				new BoxGeometry(
					stairs.width - appearance.step.widthInset,
					stepH * appearance.step.riserHeightRatio,
					appearance.step.riserThickness,
				),
				metal,
			);
			riser.position.set(x, y - half(stepH), z - direction * stepD * appearance.step.riserDepthRatio);
			g.add(riser);
		}

		// Side rails
		const railAppearance = appearance.rail;
		const railMaterial = this.track(lit({ color: 0xffc107, metalness: 0.6, roughness: 0.35 }));
		for (const sx of [
			x - half(stairs.width) - railAppearance.sideOffsetFromEdge,
			x + half(stairs.width) + railAppearance.sideOffsetFromEdge,
		]) {
			for (let i = 0; i < steps; i += railAppearance.postEverySteps) {
				const z = z0 + direction * (i + 0.5) * stepD;
				const y = y0 + (i + 1) * stepH + railAppearance.height;
				const post = new Mesh(
					new CylinderGeometry(railAppearance.postRadius, railAppearance.postRadius, railAppearance.height, 6),
					railMaterial,
				);
				post.position.set(sx, y - railAppearance.postCenterDrop, z);
				g.add(post);

				const nextIndex = Math.min(i + railAppearance.postEverySteps, steps - 1);
				if (nextIndex === i) continue;
				const nextZ = z0 + direction * (nextIndex + 0.5) * stepD;
				const nextY = y0 + (nextIndex + 1) * stepH + railAppearance.height;
				const segment = new Mesh(
					new BoxGeometry(railAppearance.segmentThickness, railAppearance.segmentThickness, Math.hypot(nextZ - z, nextY - y)),
					railMaterial,
				);
				segment.position.set(sx, midpoint(y, nextY), midpoint(z, nextZ));
				segment.rotation.x = -Math.atan2(nextY - y, nextZ - z);
				g.add(segment);
			}
		}

		// The old "frame" was one solid box across the opening. Four rails keep
		// the route clear and make the geometry match the declared hatch volume.
		const frameHeight = HELIPAD_HATCH_FRAME_SPEC.height;
		for (const rail of HELIPAD_HATCH_FRAME_RAILS) {
			addBoxMesh(g, metal, {
				name: `hatch-frame-${rail.id}`,
				width: rail.size.width,
				height: frameHeight,
				depth: rail.size.depth,
				position: { x: rail.center.x, y: DECK_TOP + half(frameHeight), z: rail.center.z },
			});
		}

		this.group.add(g);
	}

	private buildRoofDeck(): void {
		// Walkable roof patch SE — solid deck under helipad + approach from stairs
		// Deck starts at x=8/z=7 — the old 4..32 × 5..23 footprint overhung the
		// atrium skylight corner, so from V1 you saw roof clutter over your head.
		// Dek als shape MET een gat boven de secret stairs (26, 16.25) — de oude
		// dichte doos lag over de trapopening heen, dus boven was er geen trapgat.
		// NB: rotateX(-π/2) spiegelt shape-y → wereld −z, dus snijden op −z.
		const deckShape = xzPlanShape(HELIPAD_DECK_PLAN);
		addXZPlanHole(deckShape, SECRET_STAIRS_OPENING_PLAN);
		const deckGeo = new ExtrudeGeometry(deckShape, {
			depth: HELIPAD_DECK_THICKNESS,
			bevelEnabled: false,
		});
		deckGeo.rotateX(-Math.PI / 2);
		const deck = new Mesh(
			deckGeo,
			this.track(
				lit({
					color: 0x3a3f48,
					metalness: 0.25,
					roughness: 0.75,
				}),
			),
		);
		deck.name = 'helipad-deck';
		deck.position.y = DECK_TOP - HELIPAD_DECK_THICKNESS;
		deck.receiveShadow = true;
		this.group.add(deck);

		// Low safety wall on outer edges (not over stairs hatch)
		const wallM = this.track(lit({ color: 0x546e7a, metalness: 0.4, roughness: 0.5 }));
		const wall = (w: number, d: number, x: number, z: number) => {
			const m = new Mesh(new BoxGeometry(w, 1.1, d), wallM);
			m.position.set(x, DECK_TOP + 0.5, z);
			this.group.add(m);
		};
		wall(24, 0.2, 20, 22.8);
		wall(0.2, 16, 31.8, 15);
		wall(0.2, 16, 8.2, 15);
	}

	private buildPad(): void {
		const pad = new Mesh(
			new CylinderGeometry(HELIPAD_PAD_SPEC.topRadius, HELIPAD_PAD_SPEC.bottomRadius, HELIPAD_PAD_SPEC.height, 40),
			this.track(
				lit({
					color: 0x1a1a1a,
					metalness: 0.35,
					roughness: 0.55,
				}),
			),
		);
		pad.name = 'helipad-pad';
		pad.position.copy(this.padCenter);
		pad.position.y = DECK_TOP + half(HELIPAD_PAD_SPEC.height) - PAD_SINK;
		pad.receiveShadow = true;
		this.group.add(pad);

		// Yellow ring
		const ring = new Mesh(
			new RingGeometry(4.6, 5.1, 48),
			this.track(
				new MeshBasicMaterial({
					color: 0xf5c518,
					side: DoubleSide,
					toneMapped: false,
				}),
			),
		);
		ring.name = 'helipad-ring';
		ring.rotation.x = -Math.PI / 2;
		ring.position.set(this.padCenter.x, DECK_TOP + 0.12, this.padCenter.z);
		this.group.add(ring);

		// Big H
		const hMat = this.track(new MeshBasicMaterial({ color: 0xf5c518, toneMapped: false }));
		const h1 = new Mesh(new BoxGeometry(0.45, 0.06, 3.2), hMat);
		const h2 = new Mesh(new BoxGeometry(0.45, 0.06, 3.2), hMat);
		const h3 = new Mesh(new BoxGeometry(2.0, 0.06, 0.45), hMat);
		h1.name = 'helipad-h-west';
		h2.name = 'helipad-h-east';
		h3.name = 'helipad-h-bar';
		h1.position.set(this.padCenter.x - 1.0, DECK_TOP + 0.14, this.padCenter.z);
		h2.position.set(this.padCenter.x + 1.0, DECK_TOP + 0.14, this.padCenter.z);
		h3.position.set(this.padCenter.x, DECK_TOP + 0.14, this.padCenter.z);
		this.group.add(h1, h2, h3);

		// Windsock pole
		const pole = new Mesh(new CylinderGeometry(0.05, 0.05, 3.2, 8), this.track(lit({ color: 0x90a4ae, metalness: 0.7 })));
		pole.position.set(this.padCenter.x + 6.5, DECK_TOP + 1.6, this.padCenter.z + 4);
		this.group.add(pole);
		const sock = new Mesh(
			new ConeGeometry(0.35, 1.4, 8, 1, true),
			this.track(
				lit({
					color: 0xff5722,
					side: DoubleSide,
					roughness: 0.8,
				}),
			),
		);
		sock.rotation.z = Math.PI / 2;
		sock.position.set(this.padCenter.x + 7.2, DECK_TOP + 3.0, this.padCenter.z + 4);
		this.group.add(sock);
	}

	private buildLights(): void {
		// Perimeter landing lights
		const landingLightMaterial = this.track(new MeshBasicMaterial({ color: 0x00e676, toneMapped: false }));
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * Math.PI * 2;
			const bulb = new Mesh(new SphereGeometry(0.12, 8, 8), landingLightMaterial);
			bulb.position.set(this.padCenter.x + Math.cos(a) * 5.3, DECK_TOP + 0.2, this.padCenter.z + Math.sin(a) * 5.3);
			this.group.add(bulb);
		}
		this.pool.register({
			color: 0xfff4e0,
			intensity: 14,
			distance: 30,
			decay: 1.8,
			position: new Vector3(this.padCenter.x, DECK_TOP + 4, this.padCenter.z),
		});
	}

	private buildSigns(): void {
		const { canvas: c, ctx } = labelCanvas(512, 128);
		ctx.fillStyle = 'rgba(15,23,42,0.92)';
		ctx.fillRect(0, 0, 512, 128);
		ctx.strokeStyle = '#f5c518';
		ctx.lineWidth = 6;
		ctx.strokeRect(6, 6, 500, 116);
		ctx.fillStyle = '#f5c518';
		ctx.font = 'bold 36px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('HELIPAD · PRAIRIE LAKES', 256, 55);
		ctx.fillStyle = '#e2e8f0';
		ctx.font = '20px system-ui';
		ctx.fillText('Land soft · via geheime trap', 256, 95);
		const tex = labelTexture(c);
		// depthTest AAN: met false prikte het bord door de plafondplaat en hing
		// het als spook-signage boven verdieping 1
		const sp = new Sprite(this.track(new SpriteMaterial({ map: tex, transparent: true })));
		sp.scale.set(6, 1.5, 1);
		sp.position.set(this.padCenter.x, DECK_TOP + 3.2, this.padCenter.z);
		this.group.add(sp);

		// Point south toward glass elevator + green call pedestals
		const { canvas: c2, ctx: ctx2 } = labelCanvas(512, 160);
		ctx2.fillStyle = '#1b5e20';
		ctx2.fillRect(0, 0, 512, 160);
		ctx2.strokeStyle = '#00e676';
		ctx2.lineWidth = 10;
		ctx2.strokeRect(6, 6, 500, 148);
		ctx2.fillStyle = '#fff';
		ctx2.font = 'bold 40px system-ui,sans-serif';
		ctx2.textAlign = 'center';
		ctx2.fillText('←  GLAZEN LIFT', 256, 60);
		ctx2.font = 'bold 28px system-ui,sans-serif';
		ctx2.fillStyle = '#ffc107';
		ctx2.fillText('gele streep · groene knop · E', 256, 115);
		const tex2 = labelTexture(c2);
		const liftSign = backToBackLabel(
			new PlaneGeometry(5.5, 1.7),
			this.track(new MeshBasicMaterial({ map: tex2, toneMapped: false })),
		);
		// South edge of helipad deck → follow yellow path to green call knobs
		liftSign.position.set(18, DECK_TOP + 2.2, 8.5);
		this.group.add(liftSign);
	}
}
