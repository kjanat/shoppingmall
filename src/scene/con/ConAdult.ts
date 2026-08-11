import * as THREE from 'three';
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
import { ACCENT_COLORS, FUR_COLORS, furMat, partGeometry, SPECIES, type Species } from '#/scene/con/FursuitKit';
import { backToBackLabel, fitText, labelCanvas, labelTexture } from '#/util/label';
import { midpoint, span } from '#/util/math';
import { at, mulberry32, pickWith } from '#/util/rand';

const THRUST_COUNTER = 0.5;
const EAR_FLARE = 0.5;

type Scene = {
	group: THREE.Group;
	actors: THREE.Group[];
	phase: number;
	busy: boolean;
};

/**
 * Age-gated adult wing: solid door, darkroom/studio, join + film.
 * Hero meshes only here (few) — crowd stays instanced outside.
 */
export class ConAdult {
	readonly group = new THREE.Group();
	readonly filmCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 80);

	private unlocked = false;
	private declined = false;
	private gateMesh: THREE.Mesh | null = null;
	private readonly gateSign: THREE.Object3D;
	private gateBox: AABB;
	private readonly scenes: Scene[] = [];
	private joined: Scene | null = null;
	private readonly joinHold = new THREE.Vector3();
	private filmMode = false;
	private filmRec = 0;
	private ageHud: HTMLDivElement | null = null;
	private promptHud: HTMLDivElement | null = null;
	private filmHud: HTMLDivElement | null = null;
	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];
	private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);

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

	update(dt: number, viewer: THREE.Vector3): void {
		const atGate = inBounds3(CON_ADULT_GATE_TRIGGER, viewer.x, viewer.y, viewer.z);
		if (!atGate) this.declined = false;
		if (!this.unlocked && atGate && !this.declined) this.showAgeGate();

		this.group.visible = this.unlocked;
		this.syncGate();
		if (!this.unlocked) {
			this.hidePrompt();
			return;
		}

		for (const scene of this.scenes) {
			scene.phase += dt;
			const thrust = Math.sin(scene.phase * 5) * 0.08;
			for (let i = 0; i < scene.actors.length; i++) {
				const actor = at(scene.actors, i);
				const hips = actor.getObjectByName('hips');
				if (!hips) continue;
				hips.position.z = (i === 0 ? 0 : 0.1) + (i === 0 ? thrust : -thrust * THRUST_COUNTER);
				hips.rotation.x = (i === 0 ? 0.55 : -0.35) + thrust * 0.4;
			}
		}

		const near = this.nearest(viewer);
		if (this.joined) this.showPrompt('Esc · leave scene');
		else if (near) {
			const studio = inRect2(CON_STUDIO, viewer.x, viewer.z);
			this.showPrompt(studio ? 'E · join   F · film mode' : 'E · join scene');
		} else if (inRect2(CON_STUDIO, viewer.x, viewer.z)) {
			this.showPrompt(this.filmMode ? 'F · stop film' : 'F · film mode');
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

	nearestScene(viewer: THREE.Vector3, maxDist = 2.4): boolean {
		return this.nearest(viewer, maxDist) !== null;
	}

	tryJoin(viewer: THREE.Vector3): boolean {
		if (!this.unlocked || this.joined) return false;
		const scene = this.nearest(viewer);
		if (!scene) return false;
		scene.busy = true;
		this.joined = scene;
		this.joinHold.copy(viewer);
		return true;
	}

	tryLeave(): boolean {
		if (!this.joined) return false;
		this.joined.busy = false;
		this.joined = null;
		return true;
	}

	toggleFilm(viewer: THREE.Vector3): boolean {
		if (!this.unlocked || !inRect2(CON_STUDIO, viewer.x, viewer.z)) return false;
		this.filmMode = !this.filmMode;
		if (this.filmMode) this.filmRec = 0;
		this.syncFilmHud();
		return true;
	}

	get filming(): boolean {
		return this.filmMode;
	}

	get joinAnchor(): THREE.Vector3 | null {
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

	private nearest(viewer: THREE.Vector3, maxDist = 2.4): Scene | null {
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
		const black = lit({ color: 0x0a060c, roughness: 1 });
		this.materials.push(black);
		const red = new THREE.MeshBasicMaterial({ color: 0xaa1122, toneMapped: false });
		this.materials.push(red);
		const d = rectInterior(CON_DARKROOM);
		const dc = rectCenter(CON_DARKROOM);
		const floor = new THREE.Mesh(this.unitBox, black);
		floor.scale.set(rectSize(CON_DARKROOM).w - 1, 0.1, rectSize(CON_DARKROOM).d - 1);
		floor.position.set(dc.x, CON_FLOOR_Y + 0.08, dc.z);
		this.group.add(floor);
		for (let i = 0; i < 5; i++) {
			const strip = new THREE.Mesh(this.unitBox, red);
			strip.scale.set(rectSize(d).w - 1, 0.05, 0.12);
			strip.position.set(dc.x, 2.6, d.minZ + 2 + i * ((d.maxZ - d.minZ - 4) / 4));
			this.group.add(strip);
		}
		pool.register({
			position: new THREE.Vector3(dc.x, 2.2, dc.z),
			intensity: 4,
			distance: 12,
			decay: 2,
			color: 0xff2244,
			priority: 0.6,
		});

		const sc = rectCenter(CON_STUDIO);
		const s = rectInterior(CON_STUDIO);
		const chroma = new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false });
		this.materials.push(chroma);
		const back = new THREE.Mesh(this.unitBox, chroma);
		back.scale.set(rectSize(s).w - 1, 3.2, 0.15);
		back.position.set(sc.x, 1.8, s.minZ + 0.4);
		this.group.add(back);
		const camBody = lit({ color: 0x222228, roughness: 0.4 });
		this.materials.push(camBody);
		const cam = new THREE.Mesh(this.unitBox, camBody);
		cam.scale.set(0.4, 0.35, 0.7);
		cam.position.set(sc.x - 4, 1.5, sc.z + 3);
		this.group.add(cam);
		const rec = new THREE.MeshBasicMaterial({ color: 0xff0000, toneMapped: false });
		this.materials.push(rec);
		const recMesh = new THREE.Mesh(this.unitBox, rec);
		recMesh.scale.set(0.15, 0.15, 0.15);
		recMesh.position.set(sc.x - 4, 1.85, sc.z + 3);
		this.group.add(recMesh);
		pool.register({
			position: new THREE.Vector3(sc.x, 3, sc.z),
			intensity: 14,
			distance: 16,
			decay: 2,
			color: 0xffe8d0,
			priority: 1.1,
		});
		const studioSign = this.sign('STUDIO · FILM MODE [F]', 5, 0.5, 0xffcc00);
		studioSign.position.set(sc.x, 3.2, s.minZ + 0.6);
		this.group.add(studioSign);
	}

	private buildGateMesh(): THREE.Mesh {
		const leaf = CON_ADULT_GATE_LEAF;
		const mat = lit({ color: 0x220018, roughness: 0.9 });
		this.materials.push(mat);
		const gate = new THREE.Mesh(this.unitBox, mat);
		gate.scale.set(span(leaf.minX, leaf.maxX), span(leaf.minY, leaf.maxY), span(leaf.minZ, leaf.maxZ));
		gate.position.set(midpoint(leaf.minX, leaf.maxX), midpoint(leaf.minY, leaf.maxY), midpoint(leaf.minZ, leaf.maxZ));
		return gate;
	}

	private buildGateSign(): THREE.Object3D {
		const leaf = CON_ADULT_GATE_LEAF;
		const sign = this.sign('18+  ·  DARKROOM', 3.2, 0.45, 0xff3355);
		sign.position.set(leaf.minX - 0.15, CON_FLOOR_Y + CON_ADULT_GATE.headY + 0.25, midpoint(leaf.minZ, leaf.maxZ));
		sign.rotation.y = Math.PI / 2;
		return sign;
	}

	/** Door stays outside the adult group so it is visible before unlock. */
	get doorMesh(): THREE.Mesh | null {
		return this.gateMesh;
	}

	get doorSign(): THREE.Object3D {
		return this.gateSign;
	}

	private buildScenes(): void {
		const d = rectInterior(CON_DARKROOM);
		// Pack m/m pairs through the darkroom on a grid.
		const cols = 4;
		const rows = 3;
		let n = 0;
		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				const u = (col + 0.5) / cols;
				const v = (row + 0.5) / rows;
				const x = d.minX + (d.maxX - d.minX) * u;
				const z = d.minZ + (d.maxZ - d.minZ) * v;
				const yaw = (col + row) * 0.7;
				this.scenes.push(this.makeScene(x, z, yaw, `dark-${n}`, false));
				n++;
			}
		}
		const sc = rectCenter(CON_STUDIO);
		const s = rectInterior(CON_STUDIO);
		this.scenes.push(this.makeScene(sc.x + 2, sc.z - 1, 0.2, 'studio-A', true));
		this.scenes.push(this.makeScene(sc.x - 2, sc.z + 1, -0.6, 'studio-B', true));
		this.scenes.push(this.makeScene(midpoint(s.minX, sc.x), sc.z, 1.1, 'studio-C', true));
		this.scenes.push(this.makeScene(midpoint(sc.x, s.maxX), sc.z - 2, -1.4, 'studio-D', true));
	}

	private makeScene(x: number, z: number, yaw: number, label: string, studio: boolean): Scene {
		const group = new THREE.Group();
		group.position.set(x, CON_FLOOR_Y, z);
		group.rotation.y = yaw;
		const rand = mulberry32(hash(label));
		// Gay con: both partners male.
		const a = this.hero(pickWith(SPECIES, rand), pickWith(FUR_COLORS, rand), pickWith(ACCENT_COLORS, rand), rand, true);
		const b = this.hero(pickWith(SPECIES, rand), pickWith(FUR_COLORS, rand), pickWith(ACCENT_COLORS, rand), rand, true);
		a.position.set(-0.32, 0, 0);
		b.position.set(0.32, 0, 0.12);
		a.rotation.y = 0.35;
		b.rotation.y = -0.45;
		const hipsA = a.getObjectByName('hips');
		const hipsB = b.getObjectByName('hips');
		if (hipsA) hipsA.rotation.x = 0.55;
		if (hipsB) hipsB.rotation.x = -0.4;
		group.add(a, b);
		if (studio || label.includes('dark-0') || label.includes('dark-5') || label.includes('dark-9')) {
			const benchMat = lit({ color: 0x1a1018, roughness: 0.95 });
			this.materials.push(benchMat);
			const bench = new THREE.Mesh(this.unitBox, benchMat);
			bench.scale.set(1.4, 0.35, 0.6);
			bench.position.set(0, 0.2, -0.2);
			group.add(bench);
		}
		this.group.add(group);
		return { group, actors: [a, b], phase: rand() * 6, busy: false };
	}

	private hero(species: Species, fur: number, accent: number, rand: () => number, male: boolean): THREE.Group {
		const root = new THREE.Group();
		const skin = furMat(fur);
		const cloth = furMat(accent);
		const dark = furMat(0x1a1218);
		const hips = new THREE.Group();
		hips.name = 'hips';
		hips.position.y = CON_BODY * (0.92 / 1.9);
		root.add(hips);

		const add = (
			geo: THREE.BufferGeometry,
			mat: THREE.Material,
			parent: THREE.Object3D,
			y: number,
			sx = 1,
			sy = 1,
			sz = 1,
			x = 0,
			z = 0,
		) => {
			this.geometries.push(geo);
			const m = new THREE.Mesh(geo, mat);
			m.scale.set(sx, sy, sz);
			m.position.set(x, y, z);
			parent.add(m);
			return m;
		};

		add(partGeometry('pelvis'), skin, hips, 0, 1.35, 0.85, 1.15);
		add(partGeometry('waist'), skin, hips, 0.28, 1.05, 1.1, 0.9);
		add(partGeometry('chest'), skin, hips, 0.55, 1.45, 1.05, 1.1, 0, 0.04);
		add(partGeometry('top'), cloth, hips, 0.52, 1.5, 0.7, 1.15);
		for (const sx of [-1, 1] as const) {
			const leg = new THREE.Group();
			leg.position.set(sx * 0.14, 0, 0);
			add(partGeometry('thighL'), skin, leg, -0.28);
			add(partGeometry('shinL'), skin, leg, -0.62);
			add(partGeometry('footL'), dark, leg, -0.88, 1.1, 0.55, 1.6, 0, 0.06);
			hips.add(leg);
			add(partGeometry('armL'), skin, hips, 0.48, 1, 1, 1, sx * 0.32, 0);
		}
		const head = new THREE.Group();
		head.position.y = 0.95;
		hips.add(head);
		add(partGeometry('skull'), skin, head, 0);
		add(partGeometry('snout'), skin, head, -0.04, 0.9, 0.75, 1.4, 0, 0.14);
		const earGeo = new THREE.ConeGeometry(0.07, 0.16, 6);
		this.geometries.push(earGeo);
		for (const sx of [-1, 1] as const) {
			const ear = new THREE.Mesh(earGeo, skin);
			ear.position.set(sx * 0.12, 0.16, -0.02);
			if (species === 'bunny') ear.scale.set(0.7, 2.2, EAR_FLARE);
			else if (species === 'dragon') {
				ear.scale.set(0.6, 1.4, 0.4);
				ear.rotation.z = sx * EAR_FLARE;
			}
			head.add(ear);
		}
		add(partGeometry('tail'), skin, hips, 0.1, 1, 1, 1, 0, -0.28).rotation.x = 0.9;

		if (male) {
			const shaft = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.22, 4, 6), furMat(0xe8b090));
			this.geometries.push(shaft.geometry);
			shaft.position.set(0, -0.08, 0.22);
			shaft.rotation.x = -1.1;
			hips.add(shaft);
			const balls = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), furMat(0xe0a888));
			this.geometries.push(balls.geometry);
			balls.scale.set(1.4, 0.9, 1);
			balls.position.set(0, -0.14, 0.14);
			hips.add(balls);
		} else {
			const mound = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), furMat(0xe8b090));
			this.geometries.push(mound.geometry);
			mound.scale.set(1.1, 0.7, 0.9);
			mound.position.set(0, -0.06, 0.18);
			hips.add(mound);
		}
		root.scale.setScalar(0.92 + rand() * 0.12);
		return root;
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
				<div style="opacity:.88;margin-bottom:10px;line-height:1.45">Darkroom + recording studio. Explicit adult content between consenting adult characters only.</div>
				<div style="opacity:.7;font-size:13px;margin-bottom:18px;line-height:1.4">No minors. You must be 18 or older to enter.</div>
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
		window.setTimeout(() => {
			const btn = el.querySelector('#con-age-yes');
			if (btn instanceof HTMLElement) btn.focus();
		}, 0);
	}

	private showPrompt(text: string): void {
		if (!this.promptHud) {
			const el = document.createElement('div');
			el.style.cssText =
				'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);z-index:50;padding:8px 14px;background:rgba(0,0,0,.65);color:#fff;font:600 14px system-ui,sans-serif;border-radius:8px;pointer-events:none';
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

	private sign(text: string, w: number, h: number, tint: number): THREE.Object3D {
		const pxW = Math.max(128, Math.round(w * 48));
		const pxH = Math.max(48, Math.round(h * 48));
		const { canvas, ctx } = labelCanvas(pxW, pxH);
		ctx.fillStyle = '#120818';
		ctx.fillRect(0, 0, pxW, pxH);
		ctx.fillStyle = '#ffffff';
		fitText(ctx, text, { x: 8, y: 4, w: pxW - 16, h: pxH - 8 }, { size: pxH * 0.55, maxLines: 2 });
		const tex = labelTexture(canvas);
		this.textures.push(tex);
		const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: tint, toneMapped: false });
		this.materials.push(mat);
		const geo = new THREE.PlaneGeometry(w, h);
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
