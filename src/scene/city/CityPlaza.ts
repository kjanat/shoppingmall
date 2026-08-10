import * as THREE from 'three';
import { MALL_FOOTPRINT } from '#/data/layout';
import type { PlanShape, Vec2 } from '#/data/spatial';
import { rectanglePlan } from '#/data/spatial';
import { lit } from '#/render/material';
import { addExtrudedXZMesh } from '#/render/xzShape';
import type { Rect } from '#/scene/city/cityPlan';
import {
	CITY_GROUND_PLAN,
	CITY_GROUND_PLANE_Y,
	PLAZA_OUTER,
	PLAZA_PLAN,
	PLAZA_TOP_Y,
	PLAZA_TRENCH_GAP,
	plazaStations,
} from '#/scene/city/cityPlan';
import { labelCanvas, labelTexture } from '#/util/label';
import { half, midpoint, span } from '#/util/math';
import { jitterWith, mulberry32 } from '#/util/rand';

/**
 * Het plein om de mall, en het maaiveld eromheen.
 *
 * Tussen de gevel en de ringweg lag alleen het grondvlak van de wereld — één
 * effen grijze plaat, en dan ook nog een halve meter onder het loopvlak. Dit legt
 * er tegels neer op de hoogte waar je loopt, en zet er om de vijfentwintig meter
 * één ding op zodat het oog iets heeft om afstand aan af te lezen.
 *
 * Diezelfde halve meter gold buiten de ringweg nog steeds, waar de torens, het park
 * en het theater met hun voet op 0 staan, dus ligt de maaiveldplaat nu hier en op de
 * hoogte waar je loopt. Beide platen hebben hetzelfde gat: de voetafdruk van de mall
 * en de mond van de uitritgeul.
 *
 * Pi-budget: twee geëxtrudeerde platen en vier InstancedMeshes voor het meubilair.
 * Geen lampen — de lantaarns dragen een emissive lens en verder niets.
 */

/** Lantaarnpaal met een vlakke kap en een lens die zonder lamp licht suggereert. */
const LANTERN = {
	poleRadius: 0.07,
	height: 4.2,
	head: { width: 0.62, depth: 0.28, height: 0.16 },
	lens: { drop: 0.09, inset: 0.06, height: 0.04 },
} as const;

/** Putdeksel: een platte schijf, net boven de tegels zodat hij niet met ze vecht. */
const MANHOLE = { radius: 0.36, rise: 0.015, segments: 16 } as const;

/** Bankje: zitting, rugleuning en twee poten, allemaal geschaalde eenheidskubussen. */
const BENCH = {
	width: 1.8,
	seat: { height: 0.45, thickness: 0.09, depth: 0.5 },
	back: { height: 0.5, thickness: 0.08, lift: 0.29 },
	leg: { width: 0.09, depth: 0.46 },
	legOffset: 0.72,
} as const;

/** Zoveel graden mag een stuk van de rooilijn afwijken. De stad legt niets met een winkelhaak. */
const YAW_JITTER = 0.5;
const PLAZA_SEED = 0x5150;

/** Bestrating: één tegel van `PLAZA_PLAN.tile` meter, in ontwerp-eenheden. */
/** Het effen grijs van het maaiveld buiten de bestrating. */
const GROUND_COLOR = 0x8a9099;

const PAVING = {
	canvas: 256,
	/** Vier vakken per tegel, dus een voeg om de halve tegel. */
	joints: 2,
	jointWidth: 3,
	base: '#9aa0a6',
	joint: '#7f858b',
	speckles: 260,
	speckleSize: 3,
} as const;

type PlazaKind = 'lantern' | 'manhole' | 'bench';

const PLAZA_KINDS: readonly PlazaKind[] = ['lantern', 'manhole', 'bench'];

type Placed = Readonly<{ at: Vec2; yaw: number }>;

export class CityPlaza {
	readonly group = new THREE.Group();

	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];
	private readonly instanced: THREE.InstancedMesh[] = [];

	private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
	private readonly dummy = new THREE.Object3D();
	private readonly random = mulberry32(PLAZA_SEED);

	constructor() {
		this.group.name = 'city_plaza';
		this.geometries.push(this.unitBox);
		this.buildGround();
		this.buildPaving();
		this.buildFurniture();
	}

	dispose(): void {
		for (const mesh of this.instanced) mesh.dispose();
		for (const material of this.materials) material.dispose();
		for (const geometry of this.geometries) geometry.dispose();
		for (const texture of this.textures) texture.dispose();
		this.group.clear();
	}

	private track<T extends THREE.Material>(material: T): T {
		this.materials.push(material);
		return material;
	}

	/** De twee gaten die elke grondplaat houdt: het gebouw zelf en de mond van de uitritgeul. */
	private groundHoles(): PlanShape[] {
		return [
			rectanglePlan({ center: { x: 0, z: 0 }, size: MALL_FOOTPRINT }),
			rectanglePlan({
				center: {
					x: midpoint(PLAZA_TRENCH_GAP.minX, PLAZA_TRENCH_GAP.maxX),
					z: midpoint(PLAZA_TRENCH_GAP.minZ, PLAZA_TRENCH_GAP.maxZ),
				},
				size: {
					width: span(PLAZA_TRENCH_GAP.minX, PLAZA_TRENCH_GAP.maxX),
					depth: span(PLAZA_TRENCH_GAP.minZ, PLAZA_TRENCH_GAP.maxZ),
				},
			}),
		];
	}

	private rectPlan(rect: Rect): PlanShape {
		return rectanglePlan({
			center: { x: midpoint(rect.minX, rect.maxX), z: midpoint(rect.minZ, rect.maxZ) },
			size: { width: span(rect.minX, rect.maxX), depth: span(rect.minZ, rect.maxZ) },
		});
	}

	/** Het maaiveld tot voorbij de wereldrand, effen grijs, op de hoogte waar je loopt. */
	private buildGround(): void {
		const ground = this.track(lit({ color: GROUND_COLOR, roughness: 0.95 }));
		const mesh = addExtrudedXZMesh(this.group, ground, {
			name: 'city_ground',
			plan: this.rectPlan(CITY_GROUND_PLAN),
			holes: this.groundHoles(),
			topY: CITY_GROUND_PLANE_Y,
			thickness: PLAZA_PLAN.thickness,
			receiveShadow: true,
		});
		this.geometries.push(mesh.geometry);
	}

	/**
	 * De hele ring als één plaat, met een gat voor het gebouw en een voor de mond
	 * van de uitritgeul. `ExtrudeGeometry` legt zijn uv's in wereldmeters, dus één
	 * texture met een herhaling per tegelmaat sluit over de hele plaat naadloos aan.
	 */
	private buildPaving(): void {
		const texture = this.pavingTexture();
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.repeat.set(1 / PLAZA_PLAN.tile, 1 / PLAZA_PLAN.tile);
		const paving = this.track(lit({ map: texture, roughness: 0.95 }));
		const mesh = addExtrudedXZMesh(this.group, paving, {
			name: 'plaza_paving',
			plan: this.rectPlan(PLAZA_OUTER),
			holes: this.groundHoles(),
			topY: PLAZA_TOP_Y,
			thickness: PLAZA_PLAN.thickness,
			receiveShadow: true,
		});
		this.geometries.push(mesh.geometry);
	}

	private pavingTexture(): THREE.CanvasTexture {
		const size = PAVING.canvas;
		const { canvas, ctx } = labelCanvas(size, size);
		ctx.fillStyle = PAVING.base;
		ctx.fillRect(0, 0, size, size);
		for (let i = 0; i < PAVING.speckles; i++) {
			const shade = 140 + Math.floor(this.random() * 40);
			ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 5})`;
			ctx.fillRect(this.random() * size, this.random() * size, PAVING.speckleSize, PAVING.speckleSize);
		}
		ctx.fillStyle = PAVING.joint;
		for (let i = 0; i < PAVING.joints; i++) {
			const at = (size * i) / PAVING.joints;
			ctx.fillRect(at, 0, PAVING.jointWidth, size);
			ctx.fillRect(0, at, size, PAVING.jointWidth);
		}
		const texture = labelTexture(canvas);
		this.textures.push(texture);
		return texture;
	}

	/** Om de beurt een lantaarn, een putdeksel en een bankje langs de twee ringen. */
	private buildFurniture(): void {
		const byKind = new Map<PlazaKind, Placed[]>(PLAZA_KINDS.map((kind): [PlazaKind, Placed[]] => [kind, []]));
		plazaStations().forEach((station, index) => {
			const kind = PLAZA_KINDS[index % PLAZA_KINDS.length];
			if (kind === undefined) return;
			// Met de rug naar buiten: alles kijkt het plein op, met een graad speling.
			const yaw = Math.atan2(-station.x, -station.z) + jitterWith(YAW_JITTER, this.random);
			byKind.get(kind)?.push({ at: station, yaw });
		});
		this.buildLanterns(byKind.get('lantern') ?? []);
		this.buildManholes(byKind.get('manhole') ?? []);
		this.buildBenches(byKind.get('bench') ?? []);
	}

	private buildLanterns(spots: readonly Placed[]): void {
		if (spots.length === 0) return;
		const poleGeometry = new THREE.CylinderGeometry(LANTERN.poleRadius, LANTERN.poleRadius, LANTERN.height, 8);
		this.geometries.push(poleGeometry);
		const steel = this.track(lit({ color: 0x39424a, roughness: 0.5, metalness: 0.6 }));
		const glow = this.track(new THREE.MeshBasicMaterial({ color: 0xffe6b0, toneMapped: false }));
		const poles = new THREE.InstancedMesh(poleGeometry, steel, spots.length);
		poles.name = 'plaza_lantern_poles';
		const heads = new THREE.InstancedMesh(this.unitBox, steel, spots.length);
		heads.name = 'plaza_lantern_heads';
		const lenses = new THREE.InstancedMesh(this.unitBox, glow, spots.length);
		lenses.name = 'plaza_lantern_lenses';
		spots.forEach((spot, index) => {
			this.place(spot, { x: 0, y: half(LANTERN.height), z: 0 }, { x: 1, y: 1, z: 1 });
			poles.setMatrixAt(index, this.dummy.matrix);
			const headY = LANTERN.height + half(LANTERN.head.height);
			this.place(spot, { x: 0, y: headY, z: 0 }, { x: LANTERN.head.width, y: LANTERN.head.height, z: LANTERN.head.depth });
			heads.setMatrixAt(index, this.dummy.matrix);
			this.place(
				spot,
				{ x: 0, y: headY - LANTERN.lens.drop, z: 0 },
				{
					x: LANTERN.head.width - LANTERN.lens.inset * 2,
					y: LANTERN.lens.height,
					z: LANTERN.head.depth - LANTERN.lens.inset * 2,
				},
			);
			lenses.setMatrixAt(index, this.dummy.matrix);
		});
		this.addInstanced(poles, heads, lenses);
	}

	private buildManholes(spots: readonly Placed[]): void {
		if (spots.length === 0) return;
		const geometry = new THREE.CylinderGeometry(MANHOLE.radius, MANHOLE.radius, MANHOLE.rise, MANHOLE.segments);
		this.geometries.push(geometry);
		const iron = this.track(lit({ color: 0x4a4640, roughness: 0.85, metalness: 0.4 }));
		const covers = new THREE.InstancedMesh(geometry, iron, spots.length);
		covers.name = 'plaza_manholes';
		spots.forEach((spot, index) => {
			this.place(spot, { x: 0, y: half(MANHOLE.rise), z: 0 }, { x: 1, y: 1, z: 1 });
			covers.setMatrixAt(index, this.dummy.matrix);
		});
		this.addInstanced(covers);
	}

	private buildBenches(spots: readonly Placed[]): void {
		if (spots.length === 0) return;
		const wood = this.track(lit({ color: 0x7a5638, roughness: 0.85 }));
		const steel = this.track(lit({ color: 0x2f3438, roughness: 0.5, metalness: 0.5 }));
		const planks = new THREE.InstancedMesh(this.unitBox, wood, spots.length * 2);
		planks.name = 'plaza_bench_planks';
		const legs = new THREE.InstancedMesh(this.unitBox, steel, spots.length * 2);
		legs.name = 'plaza_bench_legs';
		spots.forEach((spot, index) => {
			this.place(spot, { x: 0, y: BENCH.seat.height, z: 0 }, { x: BENCH.width, y: BENCH.seat.thickness, z: BENCH.seat.depth });
			planks.setMatrixAt(index * 2, this.dummy.matrix);
			this.place(
				spot,
				{ x: 0, y: BENCH.seat.height + BENCH.back.lift, z: -half(BENCH.seat.depth) },
				{ x: BENCH.width, y: BENCH.back.height, z: BENCH.back.thickness },
			);
			planks.setMatrixAt(index * 2 + 1, this.dummy.matrix);
			([-1, 1] as const).forEach((sign, leg) => {
				this.place(
					spot,
					{ x: sign * BENCH.legOffset, y: half(BENCH.seat.height), z: 0 },
					{ x: BENCH.leg.width, y: BENCH.seat.height, z: BENCH.leg.depth },
				);
				legs.setMatrixAt(index * 2 + leg, this.dummy.matrix);
			});
		});
		this.addInstanced(planks, legs);
	}

	/** Eén onderdeel in de plaatselijke as van zijn station, en de matrix staat klaar. */
	private place(spot: Placed, offset: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): void {
		const cosine = Math.cos(spot.yaw);
		const sine = Math.sin(spot.yaw);
		this.dummy.position.set(
			spot.at.x + offset.x * cosine + offset.z * sine,
			PLAZA_TOP_Y + offset.y,
			spot.at.z - offset.x * sine + offset.z * cosine,
		);
		this.dummy.rotation.set(0, spot.yaw, 0);
		this.dummy.scale.set(scale.x, scale.y, scale.z);
		this.dummy.updateMatrix();
	}

	private addInstanced(...meshes: readonly THREE.InstancedMesh[]): void {
		for (const mesh of meshes) {
			mesh.computeBoundingSphere();
			this.instanced.push(mesh);
			this.group.add(mesh);
		}
	}
}
