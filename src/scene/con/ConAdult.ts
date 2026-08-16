import type { BufferGeometry, Material, Object3D, Texture } from 'three';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three';
import {
	CON_ADULT_GATE,
	CON_ADULT_GATE_LEAF,
	CON_ADULT_GATE_TRIGGER,
	CON_AGE_GATE_KEY,
	CON_BODY,
	CON_DARKROOM,
	CON_FLOOR_Y,
	CON_STUDIO,
	inBounds3,
	inRect2,
	rectCenter,
	rectInterior,
	rectSize,
} from '#/data/conPlan';
import type { AABB, CollisionWorld } from '#/physics/Collision';
import type { LightPool } from '#/render/LightPool';
import { lit } from '#/render/material';
import { ACCENT_COLORS, BELLY_COLORS, buildHeroSuit, FUR_COLORS, SPECIES } from '#/scene/con/FursuitKit';
import { backToBackLabel, fitText, labelCanvas, labelTexture } from '#/util/label';
import { midpoint, span } from '#/util/math';
import { at, mulberry32, pickWith } from '#/util/rand';

const U = CON_BODY / 1.9;
const THRUST_HZ = 2.4;
const THRUST_AMP = 0.14;
const ORAL_HIP_KICK = 0.5;
const RIDE_COUNTER_KICK = 0.5;
const COUNTER_FRAC = 0.35;
const PAD_PULSE_BASE = 0.35;
const PAD_PULSE_SPAN = 0.45;

type Pose = 'doggy' | 'stand' | 'oral' | 'bench' | 'wall' | 'ride';

interface Scene {
	group: Group;
	top: Group;
	bottom: Group;
	pose: Pose;
	phase: number;
	busy: boolean;
	baseTopZ: number;
	baseBotZ: number;
}

/**
 * Age-gated adult wing: darkroom + studio, explicit m/m fursuit scenes.
 */
export class ConAdult {
	readonly group = new Group();
	readonly filmCam = new PerspectiveCamera(50, 16 / 9, 0.1, 80);

	private unlocked = false;
	private declined = false;
	private gateMesh: Mesh | null = null;
	private readonly gateSign: Object3D;
	private gateBox: AABB;
	private readonly scenes: Scene[] = [];
	private joined: Scene | null = null;
	private readonly joinHold = new Vector3();
	private filmMode = false;
	private filmRec = 0;
	private ageHud: HTMLDivElement | null = null;
	private promptHud: HTMLDivElement | null = null;
	private filmHud: HTMLDivElement | null = null;
	private readonly materials: Material[] = [];
	private readonly geometries: BufferGeometry[] = [];
	private readonly textures: Texture[] = [];
	private readonly unitBox = new BoxGeometry(1, 1, 1);
	private readonly pulseMats: MeshBasicMaterial[] = [];

	constructor(pool: LightPool, world: CollisionWorld) {
		this.group.name = 'con_adult';
		this.geometries.push(this.unitBox);
		this.unlocked = readAge();
		const leaf = CON_ADULT_GATE_LEAF;
		this.gateBox = world.addBox(leaf.minX, leaf.maxX, leaf.minZ, leaf.maxZ, {
			minY: leaf.minY,
			maxY: leaf.maxY,
			label: 'con_adult_gate',
			outdoor: true,
			disabled: this.unlocked,
		});
		this.buildRooms(pool);
		this.gateMesh = this.buildGateMesh();
		this.gateSign = this.buildGateSign();
		this.buildScenes();
		this.group.visible = this.unlocked;
		this.syncGate();
	}

	update(dt: number, viewer: Vector3): void {
		const atGate = inBounds3(CON_ADULT_GATE_TRIGGER, viewer.x, viewer.y, viewer.z);
		if (!atGate) this.declined = false;
		if (!this.unlocked && atGate && !this.declined) this.showAgeGate();

		this.group.visible = this.unlocked;
		this.syncGate();
		if (!this.unlocked) {
			this.hidePrompt();
			return;
		}

		const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.004);
		for (const m of this.pulseMats) {
			m.opacity = PAD_PULSE_BASE + PAD_PULSE_SPAN * pulse;
		}

		for (const scene of this.scenes) {
			scene.phase += dt;
			const thrust = Math.sin(scene.phase * Math.PI * 2 * THRUST_HZ) * THRUST_AMP;
			const counter = Math.sin(scene.phase * Math.PI * 2 * THRUST_HZ + 0.4) * THRUST_AMP * COUNTER_FRAC;
			const hipsTop = scene.top.getObjectByName('hips');
			const hipsBot = scene.bottom.getObjectByName('hips');
			if (!(hipsTop && hipsBot)) continue;

			switch (scene.pose) {
				case 'doggy':
				case 'stand':
				case 'wall':
					scene.top.position.z = scene.baseTopZ + thrust;
					hipsTop.rotation.x = 0.25 + thrust * 1.2;
					hipsBot.position.z = counter * 0.4;
					break;
				case 'bench':
					scene.top.position.z = scene.baseTopZ + thrust;
					scene.top.position.y = 0.35 + Math.abs(thrust) * 0.15;
					hipsTop.rotation.x = 0.15 + thrust * 0.8;
					break;
				case 'oral':
					scene.top.position.z = scene.baseTopZ + thrust * 0.55;
					hipsTop.rotation.x = -0.05 + thrust * ORAL_HIP_KICK;
					hipsBot.rotation.x = 0.15 + Math.abs(thrust) * 0.3;
					break;
				case 'ride':
					scene.bottom.position.y = scene.baseBotZ + Math.abs(thrust) * 0.2;
					hipsBot.rotation.x = -0.15 + thrust * 0.9;
					hipsTop.rotation.x = 0.4 + counter * RIDE_COUNTER_KICK;
					break;
			}

			const shaft = scene.top.getObjectByName('shaft');
			if (shaft) shaft.scale.y = 1 + Math.abs(thrust) * 2.2;
		}

		const near = this.nearest(viewer);
		if (this.joined) this.showPrompt('Esc · leave scene');
		else if (near) {
			const studio = inRect2(CON_STUDIO, viewer.x, viewer.z);
			this.showPrompt(studio ? 'E · join fuck   F · film mode' : 'E · join scene');
		} else if (inRect2(CON_STUDIO, viewer.x, viewer.z)) {
			this.showPrompt(this.filmMode ? 'F · stop film' : 'F · film mode');
		} else if (inRect2(CON_DARKROOM, viewer.x, viewer.z)) {
			this.showPrompt('Darkroom · walk into a pair · E join');
		} else this.hidePrompt();

		if (this.filmMode) {
			this.filmRec += dt;
			const sc = rectCenter(CON_STUDIO);
			this.filmCam.position.set(sc.x - 5, 2.2, sc.z + 4);
			this.filmCam.up.set(0, 1, 0);
			this.filmCam.lookAt(sc.x, 1.2, sc.z);
			this.filmCam.updateMatrixWorld();
			this.syncFilmHud();
		}
	}

	nearestScene(viewer: Vector3, maxDist = 3.2): boolean {
		return this.nearest(viewer, maxDist) !== null;
	}

	tryJoin(viewer: Vector3): boolean {
		if (!this.unlocked || this.joined) return false;
		const scene = this.nearest(viewer);
		if (!scene) return false;
		scene.busy = true;
		this.joined = scene;
		this.joinHold.set(scene.group.position.x + 0.9, viewer.y, scene.group.position.z + 0.9);
		return true;
	}

	tryLeave(): boolean {
		if (!this.joined) return false;
		this.joined.busy = false;
		this.joined = null;
		return true;
	}

	toggleFilm(viewer: Vector3): boolean {
		if (!(this.unlocked && inRect2(CON_STUDIO, viewer.x, viewer.z))) return false;
		this.filmMode = !this.filmMode;
		if (this.filmMode) this.filmRec = 0;
		this.syncFilmHud();
		return true;
	}

	get filming(): boolean {
		return this.filmMode;
	}

	get joinAnchor(): Vector3 | null {
		return this.joined ? this.joinHold : null;
	}

	get ageModalOpen(): boolean {
		return this.ageHud !== null;
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
		this.ageHud?.remove();
		this.promptHud?.remove();
		this.filmHud?.remove();
	}

	private nearest(viewer: Vector3, maxDist = 3.2): Scene | null {
		if (!this.unlocked || this.joined) return null;
		let best: Scene | null = null;
		let bestD = maxDist;
		for (const scene of this.scenes) {
			const d = Math.hypot(scene.group.position.x - viewer.x, scene.group.position.z - viewer.z);
			if (d < bestD) {
				bestD = d;
				best = scene;
			}
		}
		return best;
	}

	private buildRooms(pool: LightPool): void {
		const black = lit({ color: 0x120810, roughness: 1 });
		this.materials.push(black);
		const red = new MeshBasicMaterial({ color: 0xff2244, toneMapped: false, transparent: true, opacity: 0.7 });
		this.materials.push(red);
		this.pulseMats.push(red);
		const d = rectInterior(CON_DARKROOM);
		const dc = rectCenter(CON_DARKROOM);
		const floor = new Mesh(this.unitBox, black);
		floor.scale.set(rectSize(CON_DARKROOM).w - 1, 0.1, rectSize(CON_DARKROOM).d - 1);
		floor.position.set(dc.x, CON_FLOOR_Y + 0.08, dc.z);
		this.group.add(floor);
		for (let i = 0; i < 6; i++) {
			const strip = new Mesh(this.unitBox, red);
			strip.scale.set(rectSize(d).w - 1, 0.06, 0.18);
			strip.position.set(dc.x, 2.4, d.minZ + 2 + i * ((d.maxZ - d.minZ - 4) / 5));
			this.group.add(strip);
		}
		const title = this.sign('DARKROOM · BOYS ONLY', 8, 0.6, 0xff4466);
		title.position.set(dc.x, 3.4, d.minZ + 1.2);
		this.group.add(title);

		pool.register({
			position: new Vector3(dc.x, 2.6, dc.z),
			intensity: 12,
			distance: 28,
			decay: 2,
			color: 0xff3366,
			priority: 1.0,
		});
		pool.register({
			position: new Vector3(dc.x - 10, 2.2, dc.z + 8),
			intensity: 8,
			distance: 18,
			decay: 2,
			color: 0xaa22ff,
			priority: 0.8,
		});
		pool.register({
			position: new Vector3(dc.x + 10, 2.2, dc.z - 8),
			intensity: 8,
			distance: 18,
			decay: 2,
			color: 0xff4488,
			priority: 0.8,
		});

		const sc = rectCenter(CON_STUDIO);
		const s = rectInterior(CON_STUDIO);
		const chroma = new MeshBasicMaterial({ color: 0x1a0a14, toneMapped: false });
		this.materials.push(chroma);
		const back = new Mesh(this.unitBox, chroma);
		back.scale.set(rectSize(s).w - 1, 3.2, 0.15);
		back.position.set(sc.x, 1.8, s.minZ + 0.4);
		this.group.add(back);
		const floorSMat = lit({ color: 0x181018, roughness: 0.95 });
		this.materials.push(floorSMat);
		const floorS = new Mesh(this.unitBox, floorSMat);
		floorS.scale.set(rectSize(CON_STUDIO).w - 1.2, 0.08, rectSize(CON_STUDIO).d - 1.2);
		floorS.position.set(sc.x, CON_FLOOR_Y + 0.06, sc.z);
		this.group.add(floorS);

		const camBody = lit({ color: 0x222228, roughness: 0.4 });
		this.materials.push(camBody);
		const cam = new Mesh(this.unitBox, camBody);
		cam.scale.set(0.5, 0.4, 0.9);
		cam.position.set(sc.x - 5, 1.5, sc.z + 4);
		this.group.add(cam);
		const rec = new MeshBasicMaterial({ color: 0xff0000, toneMapped: false });
		this.materials.push(rec);
		const recMesh = new Mesh(this.unitBox, rec);
		recMesh.scale.set(0.18, 0.18, 0.18);
		recMesh.position.set(sc.x - 5, 1.9, sc.z + 4);
		this.group.add(recMesh);
		pool.register({
			position: new Vector3(sc.x, 3.2, sc.z),
			intensity: 22,
			distance: 22,
			decay: 2,
			color: 0xffe8d8,
			priority: 1.3,
		});
		pool.register({
			position: new Vector3(sc.x + 4, 2.4, sc.z - 3),
			intensity: 10,
			distance: 14,
			decay: 2,
			color: 0xff88aa,
			priority: 0.9,
		});
		const studioSign = this.sign('STUDIO · FILM [F] · JOIN [E]', 7, 0.55, 0xffcc00);
		studioSign.position.set(sc.x, 3.3, s.minZ + 0.6);
		this.group.add(studioSign);
	}

	private buildGateMesh(): Mesh {
		const leaf = CON_ADULT_GATE_LEAF;
		const mat = lit({ color: 0x220018, roughness: 0.9 });
		this.materials.push(mat);
		const gate = new Mesh(this.unitBox, mat);
		gate.scale.set(span(leaf.minX, leaf.maxX), span(leaf.minY, leaf.maxY), span(leaf.minZ, leaf.maxZ));
		gate.position.set(midpoint(leaf.minX, leaf.maxX), midpoint(leaf.minY, leaf.maxY), midpoint(leaf.minZ, leaf.maxZ));
		return gate;
	}

	private buildGateSign(): Object3D {
		const leaf = CON_ADULT_GATE_LEAF;
		const wrap = new Group();
		const sign = this.sign('18+  ·  DARKROOM / STUDIO', 4.2, 0.5, 0xff3355);
		sign.position.set(leaf.minX - 0.15, CON_FLOOR_Y + CON_ADULT_GATE.headY + 0.35, midpoint(leaf.minZ, leaf.maxZ));
		sign.rotation.y = Math.PI / 2;
		wrap.add(sign);
		const sub = this.sign('WALK IN · AGE GATE', 3.4, 0.4, 0xff88aa);
		sub.position.set(leaf.minX - 0.15, CON_FLOOR_Y + CON_ADULT_GATE.headY - 0.15, midpoint(leaf.minZ, leaf.maxZ));
		sub.rotation.y = Math.PI / 2;
		wrap.add(sub);
		return wrap;
	}

	get doorMesh(): Mesh | null {
		return this.gateMesh;
	}

	get doorSign(): Object3D {
		return this.gateSign;
	}

	private buildScenes(): void {
		const d = rectInterior(CON_DARKROOM);
		const poses: Pose[] = ['doggy', 'stand', 'oral', 'bench', 'wall', 'ride'];
		const cols = 4;
		const rows = 3;
		let n = 0;
		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				const u = (col + 0.5) / cols;
				const v = (row + 0.5) / rows;
				const x = d.minX + (d.maxX - d.minX) * u;
				const z = d.minZ + (d.maxZ - d.minZ) * v;
				const yaw = (col * 1.3 + row * 0.9) % (Math.PI * 2);
				const pose = at(poses, n % poses.length);
				this.scenes.push(this.makeScene(x, z, yaw, pose, `dark-${n}`, false));
				n++;
			}
		}
		const sc = rectCenter(CON_STUDIO);
		const s = rectInterior(CON_STUDIO);
		const studioSpots: { x: number; z: number; yaw: number; pose: Pose; id: string }[] = [
			{ x: sc.x + 3, z: sc.z - 2, yaw: 0.3, pose: 'doggy', id: 'studio-A' },
			{ x: sc.x - 3, z: sc.z + 2, yaw: -0.8, pose: 'bench', id: 'studio-B' },
			{ x: midpoint(s.minX, sc.x), z: sc.z, yaw: 1.2, pose: 'oral', id: 'studio-C' },
			{ x: midpoint(sc.x, s.maxX), z: sc.z - 3, yaw: -1.5, pose: 'ride', id: 'studio-D' },
			{ x: sc.x, z: sc.z + 4, yaw: Math.PI, pose: 'wall', id: 'studio-E' },
			{ x: sc.x + 6, z: sc.z + 1, yaw: 0.9, pose: 'stand', id: 'studio-F' },
		];
		for (const spot of studioSpots) {
			this.scenes.push(this.makeScene(spot.x, spot.z, spot.yaw, spot.pose, spot.id, true));
		}
	}

	private makeScene(x: number, z: number, yaw: number, pose: Pose, label: string, studio: boolean): Scene {
		const group = new Group();
		group.position.set(x, CON_FLOOR_Y, z);
		group.rotation.y = yaw;
		const rand = mulberry32(hash(label));

		const top = buildHeroSuit(
			pickWith(SPECIES, rand),
			pickWith(FUR_COLORS, rand),
			pickWith(BELLY_COLORS, rand),
			pickWith(ACCENT_COLORS, rand),
			rand,
			{ male: true },
		);
		const bottom = buildHeroSuit(
			pickWith(SPECIES, rand),
			pickWith(FUR_COLORS, rand),
			pickWith(BELLY_COLORS, rand),
			pickWith(ACCENT_COLORS, rand),
			rand,
			{ male: true },
		);

		const matPad = new MeshBasicMaterial({
			color: studio ? 0xff4488 : 0xaa1133,
			toneMapped: false,
			transparent: true,
			opacity: 0.55,
		});
		this.materials.push(matPad);
		this.pulseMats.push(matPad);
		const pad = new Mesh(this.unitBox, matPad);
		pad.scale.set(1.6, 0.04, 1.6);
		pad.position.set(0, 0.03, 0);
		group.add(pad);

		if (pose === 'bench' || pose === 'ride' || studio) {
			const benchMat = lit({ color: 0x1a1018, roughness: 0.95 });
			this.materials.push(benchMat);
			const bench = new Mesh(this.unitBox, benchMat);
			bench.scale.set(1.5, 0.38, 0.7);
			bench.position.set(0, 0.22, pose === 'ride' ? 0 : -0.15);
			group.add(bench);
		}

		const base = this.applyPose(top, bottom, pose);
		group.add(top, bottom);
		this.group.add(group);
		return {
			group,
			top,
			bottom,
			pose,
			phase: rand() * 6,
			busy: false,
			baseTopZ: base.topZ,
			baseBotZ: base.botY,
		};
	}

	private applyPose(top: Group, bottom: Group, pose: Pose): { topZ: number; botY: number } {
		const hipsT = top.getObjectByName('hips');
		const hipsB = bottom.getObjectByName('hips');
		if (!(hipsT && hipsB)) return { topZ: 0, botY: 0 };

		let topZ = 0;
		let botY = 0;

		switch (pose) {
			case 'doggy': {
				bottom.position.set(0, 0, 0.15);
				bottom.rotation.set(0, 0, 0);
				hipsB.rotation.set(1.15, 0, 0);
				hipsB.position.y = CON_BODY * 0.42;
				top.position.set(0, 0.05, -0.55);
				top.rotation.set(0, 0, 0);
				hipsT.rotation.set(0.35, 0, 0);
				topZ = -0.55;
				break;
			}
			case 'stand': {
				bottom.position.set(0, 0, 0.2);
				hipsB.rotation.set(0.95, 0, 0);
				hipsB.position.y = CON_BODY * 0.55;
				top.position.set(0, 0.08, -0.48);
				hipsT.rotation.set(0.2, 0, 0);
				topZ = -0.48;
				break;
			}
			case 'wall': {
				bottom.position.set(0, 0.05, 0.25);
				hipsB.rotation.set(0.35, 0, 0);
				bottom.rotation.x = -0.1;
				top.position.set(0, 0.1, -0.42);
				hipsT.rotation.set(0.15, 0, 0);
				topZ = -0.42;
				break;
			}
			case 'oral': {
				bottom.position.set(0, -0.15, 0.35);
				hipsB.rotation.set(0.2, 0, 0);
				hipsB.position.y = CON_BODY * 0.28;
				bottom.scale.setScalar(0.95);
				top.position.set(0, 0, 0);
				hipsT.rotation.set(-0.05, 0, 0);
				topZ = 0;
				break;
			}
			case 'bench': {
				bottom.position.set(0, 0.38, 0.05);
				hipsB.rotation.set(1.35, 0, 0);
				hipsB.position.y = CON_BODY * 0.2;
				top.position.set(0, 0.4, -0.4);
				hipsT.rotation.set(0.25, 0, 0);
				topZ = -0.4;
				break;
			}
			case 'ride': {
				top.position.set(0, 0.35, 0);
				hipsT.rotation.set(0.45, 0, 0);
				hipsT.position.y = CON_BODY * 0.35;
				bottom.position.set(0, 0.75, 0.05);
				hipsB.rotation.set(-0.2, Math.PI, 0);
				botY = 0.75;
				topZ = 0;
				break;
			}
		}

		const shaft = top.getObjectByName('shaft');
		if (shaft && (pose === 'doggy' || pose === 'stand' || pose === 'wall' || pose === 'bench')) {
			shaft.position.set(0, -0.06 * U, 0.28 * U);
			shaft.rotation.x = -1.35;
		}
		return { topZ, botY };
	}

	private unlock(): void {
		this.unlocked = true;
		writeAge(true);
		this.syncGate();
		this.group.visible = true;
	}

	private syncGate(): void {
		this.gateBox.disabled = this.unlocked;
		if (!this.gateMesh) return;
		const leaf = CON_ADULT_GATE_LEAF;
		const open = this.unlocked ? 1 : 0;
		this.gateMesh.position.y = midpoint(leaf.minY, leaf.maxY) + open * (CON_ADULT_GATE.headY + 0.4);
		this.gateMesh.visible = open < 0.99;
	}

	private showAgeGate(): void {
		if (this.unlocked || this.ageHud || this.declined) return;
		const el = document.createElement('div');
		el.style.cssText =
			'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.88);font-family:system-ui,sans-serif;color:#fff';
		el.innerHTML = `
			<div role="dialog" aria-modal="true" aria-labelledby="con-age-title" style="max-width:440px;padding:28px;background:#1a0a12;border:2px solid #ff3366;border-radius:12px;text-align:center">
				<div id="con-age-title" style="font-size:22px;font-weight:700;margin-bottom:8px">18+ ADULT WING</div>
				<div style="opacity:.88;margin-bottom:10px;line-height:1.45">Darkroom + studio. Explicit adult m/m fursuit scenes.</div>
				<div style="opacity:.7;font-size:13px;margin-bottom:18px;line-height:1.4">No minors. You must be 18 or older.</div>
				<button type="button" id="con-age-yes" style="margin:0 8px;padding:10px 18px;background:#ff3366;border:0;border-radius:8px;color:#fff;font-weight:700;cursor:pointer">I am 18+</button>
				<button type="button" id="con-age-no" style="margin:0 8px;padding:10px 18px;background:#333;border:0;border-radius:8px;color:#fff;cursor:pointer">Leave</button>
			</div>`;
		document.body.appendChild(el);
		this.ageHud = el;
		const close = (ok: boolean) => {
			el.remove();
			this.ageHud = null;
			if (ok) this.unlock();
			else this.declined = true;
		};
		el.querySelector('#con-age-yes')?.addEventListener('click', () => close(true));
		el.querySelector('#con-age-no')?.addEventListener('click', () => close(false));
		globalThis.setTimeout(() => {
			const btn = el.querySelector('#con-age-yes');
			if (btn instanceof HTMLElement) btn.focus();
		}, 0);
	}

	private showPrompt(text: string): void {
		if (!this.promptHud) {
			const el = document.createElement('div');
			el.style.cssText =
				'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);z-index:50;padding:8px 14px;background:rgba(80,0,30,.78);color:#fff;font:600 14px system-ui,sans-serif;border-radius:8px;pointer-events:none;border:1px solid #ff4466';
			document.body.appendChild(el);
			this.promptHud = el;
		}
		this.promptHud.textContent = text;
		this.promptHud.style.display = 'block';
	}

	private hidePrompt(): void {
		if (this.promptHud) this.promptHud.style.display = 'none';
	}

	private syncFilmHud(): void {
		if (!this.filmMode) {
			this.filmHud?.remove();
			this.filmHud = null;
			return;
		}
		if (!this.filmHud) {
			const el = document.createElement('div');
			el.style.cssText =
				'position:fixed;top:12%;left:50%;transform:translateX(-50%);z-index:60;padding:8px 16px;background:rgba(120,0,0,.75);color:#fff;font:700 16px system-ui;border-radius:8px;pointer-events:none';
			document.body.appendChild(el);
			this.filmHud = el;
		}
		const sec = Math.floor(this.filmRec);
		this.filmHud.textContent = `● REC  ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}  ·  F to stop`;
	}

	private sign(text: string, w: number, h: number, tint: number): Object3D {
		const pxW = Math.max(128, Math.round(w * 48));
		const pxH = Math.max(48, Math.round(h * 48));
		const { canvas, ctx } = labelCanvas(pxW, pxH);
		ctx.fillStyle = '#120818';
		ctx.fillRect(0, 0, pxW, pxH);
		ctx.fillStyle = '#ffffff';
		fitText(ctx, text, { x: 8, y: 4, w: pxW - 16, h: pxH - 8 }, { size: pxH * 0.55, maxLines: 2 });
		const tex = labelTexture(canvas);
		this.textures.push(tex);
		const mat = new MeshBasicMaterial({ map: tex, transparent: true, color: tint, toneMapped: false });
		this.materials.push(mat);
		const geo = new PlaneGeometry(w, h);
		this.geometries.push(geo);
		return backToBackLabel(geo, mat);
	}
}

function readAge(): boolean {
	try {
		return sessionStorage.getItem(CON_AGE_GATE_KEY) === '1';
	} catch {
		return false;
	}
}

function writeAge(ok: boolean): void {
	try {
		if (ok) sessionStorage.setItem(CON_AGE_GATE_KEY, '1');
		else sessionStorage.removeItem(CON_AGE_GATE_KEY);
	} catch {
		/* private */
	}
}

function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return h;
}
