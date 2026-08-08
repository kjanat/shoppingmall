import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { spatial } from '#/audio/SpatialAudio';
import { levelAt } from '#/data/levels';
import type { CollisionWorld } from '#/physics/Collision';
import { lit } from '#/render/material';
import { fitText, labelCanvas, labelTexture } from '#/util/label';
import { at, pick } from '#/util/rand';
import { tagLevelCulled } from '#/util/visibility';
import MANIFEST from '$/public/voices/protest/manifest.json' with { type: 'json' };

/** Prebaked multi-voice chants (public/voices/protest/) — different speaker each clip */
export type ProtestClip = {
	id: string;
	file: string;
	text: string;
	label: string;
	voice: string;
	kind: 'crowd' | 'merkel';
};

/**
 * The prebaked chants, straight from the manifest the generator writes next to
 * the mp3s. JSON has no unions, so `kind` narrows once here.
 */
const PROTEST_CLIPS: ProtestClip[] = MANIFEST.map((c) => ({
	...c,
	kind: c.kind === 'merkel' ? 'merkel' : 'crowd',
}));

type Protester = {
	/** Speech anchor. Merkel also keeps her bespoke visible model here. */
	root: THREE.Group;
	/** local pos relative to group (camp) */
	x: number;
	z: number;
	vx: number;
	vz: number;
	preferredAngle: number;
	preferredRadius: number;
	speed: number;
	phase: number;
	energy: number;
	facing: number;
	walkPhase: number;
	jumpY: number;
	jumpVy: number;
	jumpCooldown: number;
	jumpUrge: number;
	landSquash: number;
	separationX: number;
	separationZ: number;
	/** Null for Merkel, otherwise the shared-mesh instance index. */
	instanceIndex: number | null;
	sign?: THREE.Object3D;
	speech: THREE.Sprite;
	speechTex: THREE.CanvasTexture;
	speechCtx: CanvasRenderingContext2D;
	speechLife: number;
	fist?: THREE.Object3D;
	flag?: THREE.Object3D;
	isMerkel: boolean;
	lineIdx: number;
	/** Sticky voice identity: only play clips matching this voice key when possible */
	voiceKey: string;
	/** cooldown so one body doesn't spam audio */
	voiceCd: number;
};

const SIGN_LINES: [string, string][] = [
	['LOVE', 'WINS'],
	['CLIMATE', 'JUSTICE'],
	['WIR SCHAFFEN', 'DAS'],
	['PRIDE', ''],
	['PEACE', ''],
	['EQUALITY', ''],
	['JUSTICE', ''],
	['NO', 'BORDERS'],
];

type FlagKind = 'progress' | 'rainbow' | 'trans' | 'bi' | 'lesbian' | 'nb' | 'pan' | 'intersex';

type CrowdInstances = {
	bodies: THREE.InstancedMesh;
	faces: THREE.InstancedMesh;
	sticks: THREE.InstancedMesh;
	signs: THREE.InstancedMesh;
};

const CROWD_COUNT = 24;
const SWARM_RADIUS = 6.5;
const SWARM_WANDER_RADIUS = 8;
const SEPARATION_RADIUS = 0.9;
const SEPARATION_CELL = 1.2;
const JUMP_GRAVITY = 9.5;

/**
 * Atrium protest — liberal groupies + LGBTQIA+ flags +
 * thick elderly Angela Merkel. Swarm walks the floor like chanting zombies.
 */
export class ProtestGroupies {
	readonly group = new THREE.Group();
	/** East of atrium ground — clear of kiosk / north corridor */
	readonly pos = new THREE.Vector3(8, 0, 4);
	private materials: THREE.Material[] = [];
	private people: Protester[] = [];
	private plantedFlags: THREE.Group[] = [];
	private t = 0;
	private chantCd = 0.6;
	private audioStarted = false;
	private stopAudio: (() => void) | null = null;
	private banner!: THREE.Mesh;
	private merkelIdx = -1;
	private world: CollisionWorld;
	/** Live clip bank (manifest or hardcoded) */
	private clips: ProtestClip[] = [...PROTEST_CLIPS];
	private crowdClips: ProtestClip[] = PROTEST_CLIPS.filter((c) => c.kind === 'crowd');
	private merkelClips: ProtestClip[] = PROTEST_CLIPS.filter((c) => c.kind === 'merkel');
	/** Max concurrent spatial voices so the mall doesn't explode */
	private activeVoices = 0;
	private static readonly MAX_VOICES = 5;
	private lastGlobalClip = -1;
	private crowdInstances: CrowdInstances | null = null;
	private swarmX = 0;
	private swarmZ = 0;
	private swarmVx = 0;
	private swarmVz = 0;
	private swarmTargetX = 0;
	private swarmTargetZ = 0;
	private swarmRetargetCd = 1;
	private surgeTime = 0;
	private surgeCd = 12 + Math.random() * 10;
	private readonly separationGrid = new Map<number, number[]>();
	private readonly rootMatrix = new THREE.Matrix4();
	private readonly partMatrix = new THREE.Matrix4();
	private readonly instanceMatrix = new THREE.Matrix4();
	private readonly tempPosition = new THREE.Vector3();
	private readonly tempScale = new THREE.Vector3();
	private readonly tempRotation = new THREE.Euler();
	private readonly tempQuaternion = new THREE.Quaternion();

	constructor(world: CollisionWorld) {
		this.world = world;
		this.group.name = 'protestGroupies';
		this.group.position.copy(this.pos);
		this.buildBanner();
		this.buildPlantedFlags();
		this.buildMerkel();
		this.buildCrowd(CROWD_COUNT);
		this.buildMegaphoneStand();
	}

	ensureAudio(): void {
		if (this.audioStarted) return;
		this.audioStarted = true;
		spatial.ensure();
		// Soft ambient hum under the real voices (quieter now — voices carry the protest)
		const handle = spatial.startLoopAt(
			{ x: this.pos.x, y: 1.6, z: this.pos.z },
			(ctx, dest) => {
				let alive = true;
				let timer: number | null = null;
				const phrase = () => {
					if (!alive) return;
					// [frequency, duration] so the two never drift apart
					const phraseNotes: ReadonlyArray<readonly [number, number]> = [
						[196, 0.22],
						[220, 0.22],
						[247, 0.28],
						[262, 0.4],
						[247, 0.22],
						[220, 0.22],
						[196, 0.28],
						[175, 0.45],
					];
					let t0 = ctx.currentTime + 0.02;
					for (const [note, dur] of phraseNotes) {
						const o = ctx.createOscillator();
						const g = ctx.createGain();
						const f = ctx.createBiquadFilter();
						o.type = 'triangle';
						o.frequency.setValueAtTime(note, t0);
						f.type = 'lowpass';
						f.frequency.value = 1400;
						g.gain.setValueAtTime(0.0001, t0);
						g.gain.exponentialRampToValueAtTime(0.04, t0 + 0.03);
						g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
						o.connect(f);
						f.connect(g);
						g.connect(dest);
						o.start(t0);
						o.stop(t0 + dur + 0.02);
						t0 += dur * 0.95;
					}
					timer = window.setTimeout(phrase, 5200 + Math.random() * 2200);
				};
				phrase();
				return {
					stop: () => {
						alive = false;
						if (timer !== null) clearTimeout(timer);
					},
				};
			},
			{ volume: 0.18, k: 0.05, maxDistance: 22 },
		);
		this.stopAudio = () => handle.stop();
		// Kick a first wave so you hear them immediately
		window.setTimeout(() => this.yellWave(4), 400);
	}

	/** Fire n people yelling with real multi-voice audio */
	private yellWave(n: number): void {
		if (!this.audioStarted || !this.people.length) return;
		const order = this.people
			.map((_, i) => i)
			.sort(() => Math.random() - 0.5)
			.slice(0, n);
		order.forEach((personIndex, k) => {
			const p = this.people[personIndex];
			if (!p) return;
			window.setTimeout(() => this.yellFrom(p), k * 90 + Math.random() * 80);
		});
	}

	private pickClip(p: Protester): ProtestClip {
		const bank = p.isMerkel
			? this.merkelClips.length
				? this.merkelClips
				: this.clips
			: this.crowdClips.length
				? this.crowdClips
				: this.clips;
		// Prefer a clip we didn't just use globally; rotate through voices
		let idx = Math.floor(Math.random() * bank.length);
		if (bank.length > 1 && idx === this.lastGlobalClip % bank.length) {
			idx = (idx + 1 + Math.floor(Math.random() * (bank.length - 1))) % bank.length;
		}
		// Light sticky preference: same person often reuses their voiceKey subset
		const sticky = bank.filter((c) => c.voice.includes(p.voiceKey) || p.voiceKey.includes(c.voice.split('-').pop() ?? ''));
		if (sticky.length && Math.random() < 0.55) {
			return pick(sticky);
		}
		this.lastGlobalClip = idx;
		return at(bank, idx);
	}

	private yellFrom(p: Protester): void {
		if (p.voiceCd > 0) return;
		if (this.activeVoices >= ProtestGroupies.MAX_VOICES) {
			// Still show bubble without audio so the wall of text stays
			const clip = this.pickClip(p);
			this.showBubble(p, clip.label, !!p.isMerkel);
			return;
		}
		const clip = this.pickClip(p);
		p.voiceCd = 2.2 + Math.random() * 1.8;
		this.showBubble(p, clip.label, !!p.isMerkel);
		this.activeVoices++;
		const wx = this.pos.x + p.x;
		const wz = this.pos.z + p.z;
		const vol = p.isMerkel ? 0.95 : 0.72 + Math.random() * 0.2;
		void spatial
			.playAt(
				clip.file,
				{ x: wx, y: 1.55, z: wz },
				{
					volume: vol,
					k: 0.028,
					maxDistance: 32,
					refDistance: 2.2,
				},
			)
			.finally(() => {
				this.activeVoices = Math.max(0, this.activeVoices - 1);
			});
	}

	update(dt: number, playerPos?: THREE.Vector3): void {
		this.t += dt;
		this.chantCd -= dt;
		this.tickSwarm(dt, playerPos);

		for (const p of this.people) {
			p.voiceCd = Math.max(0, p.voiceCd - dt);
		}

		// Planted flags flutter (stay at camp)
		for (let i = 0; i < this.plantedFlags.length; i++) {
			const f = this.plantedFlags[i];
			if (!f) continue;
			const cloth = f.userData['cloth'] as THREE.Object3D | undefined;
			if (cloth) {
				cloth.rotation.y = Math.sin(this.t * 2.2 + i) * 0.25;
				cloth.rotation.z = Math.sin(this.t * 1.7 + i * 0.8) * 0.08;
			}
		}

		if (this.banner) {
			this.banner.rotation.z = Math.sin(this.t * 1.3) * 0.04;
		}

		// Empowered overlapping chants — real multi-voice audio
		if (this.chantCd <= 0) {
			this.chantCd = 0.55 + Math.random() * 0.85;
			const n = 2 + Math.floor(Math.random() * 4);
			this.yellWave(n);
			// Occasional full Merkel megaphone drop
			if (this.audioStarted && Math.random() < 0.3 && this.merkelIdx >= 0) {
				const m = this.people[this.merkelIdx];
				if (m) window.setTimeout(() => this.yellFrom(m), 200);
			}
		}
	}

	/**
	 * A soft moving centre gives the protest a readable shape. Each person keeps
	 * a stable place around it, then noise, separation and jumps disturb that
	 * composition without dissolving it into unrelated wanderers.
	 */
	private tickSwarm(dt: number, playerPos?: THREE.Vector3): void {
		this.tickSwarmCenter(dt, playerPos);
		this.rebuildSeparationGrid();
		this.measureSeparation();

		this.surgeCd -= dt;
		this.surgeTime = Math.max(0, this.surgeTime - dt);
		if (this.surgeCd <= 0) {
			this.surgeTime = 3 + Math.random() * 2;
			this.surgeCd = 18 + Math.random() * 16;
		}

		for (const p of this.people) this.tickProtester(p, dt);
		this.updateCrowdInstances();
	}

	private tickSwarmCenter(dt: number, playerPos?: THREE.Vector3): void {
		this.swarmRetargetCd -= dt;
		if (this.swarmRetargetCd <= 0) {
			const angle = Math.random() * Math.PI * 2;
			const radius = Math.sqrt(Math.random()) * SWARM_WANDER_RADIUS;
			this.swarmTargetX = Math.sin(angle) * radius;
			this.swarmTargetZ = Math.cos(angle) * radius;
			this.swarmRetargetCd = 6 + Math.random() * 6;
		}

		let targetX = this.swarmTargetX;
		let targetZ = this.swarmTargetZ;
		if (playerPos && levelAt(playerPos.y) === 'v0') {
			const playerX = playerPos.x - this.pos.x;
			const playerZ = playerPos.z - this.pos.z;
			const distance = Math.hypot(playerX - this.swarmX, playerZ - this.swarmZ);
			if (distance < 18) {
				const curiosity = 0.22 * (1 - distance / 18);
				targetX = THREE.MathUtils.lerp(targetX, playerX, curiosity);
				targetZ = THREE.MathUtils.lerp(targetZ, playerZ, curiosity);
			}
		}

		const dx = targetX - this.swarmX;
		const dz = targetZ - this.swarmZ;
		const distance = Math.hypot(dx, dz);
		const speed = this.surgeTime > 0 ? 1.05 : 0.72;
		const desiredX = distance > 0.05 ? (dx / distance) * Math.min(speed, distance * 0.45) : 0;
		const desiredZ = distance > 0.05 ? (dz / distance) * Math.min(speed, distance * 0.45) : 0;
		const follow = Math.min(1, dt * 0.9);
		this.swarmVx = THREE.MathUtils.lerp(this.swarmVx, desiredX, follow);
		this.swarmVz = THREE.MathUtils.lerp(this.swarmVz, desiredZ, follow);

		const nextX = this.swarmX + this.swarmVx * dt;
		const nextZ = this.swarmZ + this.swarmVz * dt;
		const solved = this.world.resolveCircle(this.pos.x + nextX, this.pos.z + nextZ, 0.5, 0.65, 3, true);
		this.swarmX = solved.x - this.pos.x;
		this.swarmZ = solved.z - this.pos.z;
		if (Math.abs(this.swarmX - nextX) > 0.01) this.swarmVx *= 0.25;
		if (Math.abs(this.swarmZ - nextZ) > 0.01) this.swarmVz *= 0.25;
	}

	private rebuildSeparationGrid(): void {
		for (const bucket of this.separationGrid.values()) bucket.length = 0;
		for (let i = 0; i < this.people.length; i++) {
			const p = this.people[i];
			if (!p) continue;
			const gx = Math.floor(p.x / SEPARATION_CELL);
			const gz = Math.floor(p.z / SEPARATION_CELL);
			const key = gx + gz * 1024;
			const bucket = this.separationGrid.get(key);
			if (bucket) bucket.push(i);
			else this.separationGrid.set(key, [i]);
		}
	}

	private measureSeparation(): void {
		for (let i = 0; i < this.people.length; i++) {
			const p = this.people[i];
			if (!p) continue;
			p.separationX = 0;
			p.separationZ = 0;
			p.jumpUrge = 0;
			const gx = Math.floor(p.x / SEPARATION_CELL);
			const gz = Math.floor(p.z / SEPARATION_CELL);
			for (let ox = -3; ox <= 3; ox++) {
				for (let oz = -3; oz <= 3; oz++) {
					const bucket = this.separationGrid.get(gx + ox + (gz + oz) * 1024);
					if (!bucket) continue;
					for (const otherIndex of bucket) {
						if (otherIndex === i) continue;
						const other = this.people[otherIndex];
						if (!other) continue;
						let dx = p.x - other.x;
						let dz = p.z - other.z;
						let distance = Math.hypot(dx, dz);
						if (distance < 0.001) {
							const angle = i * 2.399;
							dx = Math.sin(angle) * 0.001;
							dz = Math.cos(angle) * 0.001;
							distance = 0.001;
						}
						const personalSpace = p.isMerkel || other.isMerkel ? 1.25 : SEPARATION_RADIUS;
						if (distance < personalSpace) {
							const strength = ((personalSpace - distance) / personalSpace) * 3;
							p.separationX += (dx / distance) * strength;
							p.separationZ += (dz / distance) * strength;
						}
						if (other.jumpY > 0.08 && distance < 2.8) p.jumpUrge += 1 - distance / 2.8;
					}
				}
			}
		}
	}

	private tickProtester(p: Protester, dt: number): void {
		const orbit = Math.sin(this.t * 0.19 + p.phase) * 0.2;
		const breathe = 1 + Math.sin(this.t * 0.31 + p.phase * 1.7) * 0.08;
		const angle = p.preferredAngle + orbit;
		const radius = p.preferredRadius * breathe;
		const idealX = this.swarmX + Math.sin(angle) * radius;
		const idealZ = this.swarmZ + Math.cos(angle) * radius * 0.78;
		const dx = idealX - p.x;
		const dz = idealZ - p.z;
		const distance = Math.hypot(dx, dz);
		const surge = this.surgeTime > 0 ? 1.35 : 1;
		const maxSpeed = p.speed * p.energy * surge * (p.isMerkel ? 0.72 : 1);
		const desiredSpeed = Math.min(maxSpeed, distance * 1.2);
		const noiseX = Math.sin(this.t * 0.73 + p.phase * 4.1) * 0.18;
		const noiseZ = Math.cos(this.t * 0.61 + p.phase * 3.7) * 0.18;
		const desiredX = distance > 0.01 ? (dx / distance) * desiredSpeed : 0;
		const desiredZ = distance > 0.01 ? (dz / distance) * desiredSpeed : 0;
		const maxForce = 2.8 * p.energy;
		let forceX = desiredX - p.vx + noiseX + p.separationX;
		let forceZ = desiredZ - p.vz + noiseZ + p.separationZ;
		const force = Math.hypot(forceX, forceZ);
		if (force > maxForce) {
			forceX = (forceX / force) * maxForce;
			forceZ = (forceZ / force) * maxForce;
		}
		p.vx += forceX * dt;
		p.vz += forceZ * dt;
		const speed = Math.hypot(p.vx, p.vz);
		if (speed > maxSpeed) {
			p.vx = (p.vx / speed) * maxSpeed;
			p.vz = (p.vz / speed) * maxSpeed;
		}

		const nextX = p.x + p.vx * dt;
		const nextZ = p.z + p.vz * dt;
		const hitRadius = p.isMerkel ? 0.55 : 0.34;
		const solved = this.world.resolveCircle(this.pos.x + nextX, this.pos.z + nextZ, 0.5, hitRadius, 3, true);
		p.x = solved.x - this.pos.x;
		p.z = solved.z - this.pos.z;
		if (Math.abs(p.x - nextX) > 0.01) p.vx *= 0.35;
		if (Math.abs(p.z - nextZ) > 0.01) p.vz *= 0.35;

		const moving = Math.hypot(p.vx, p.vz);
		if (moving > 0.04) {
			const wanted = Math.atan2(p.vx, p.vz);
			p.facing += shortestAngle(p.facing, wanted) * Math.min(1, dt * 4);
		}
		p.walkPhase += dt * (2.5 + moving * 4.5) * p.energy;

		p.jumpCooldown = Math.max(0, p.jumpCooldown - dt);
		p.landSquash = Math.max(0, p.landSquash - dt);
		if (p.jumpY <= 0 && p.jumpCooldown <= 0) {
			const rate = (0.018 * p.energy + p.jumpUrge * 0.1) * (this.surgeTime > 0 ? 3 : 1);
			if (Math.random() < 1 - Math.exp(-rate * dt)) {
				p.jumpVy = 2.8 + p.energy * 0.75;
				p.jumpCooldown = 3.5 + Math.random() * 5;
			}
		}
		if (p.jumpY > 0 || p.jumpVy > 0) {
			p.jumpVy -= JUMP_GRAVITY * dt;
			p.jumpY += p.jumpVy * dt;
			if (p.jumpY <= 0) {
				p.jumpY = 0;
				p.jumpVy = 0;
				p.landSquash = 0.18;
			}
		}

		const march = Math.sin(p.walkPhase + p.phase);
		const bob = Math.abs(march) * Math.min(1, moving / Math.max(0.01, p.speed)) * (p.isMerkel ? 0.045 : 0.075);
		p.root.position.set(p.x, p.jumpY + bob, p.z);
		p.root.rotation.y = p.facing;
		p.root.rotation.z = Math.sin(p.walkPhase * 0.5 + p.phase) * 0.035;

		if (p.sign) {
			p.sign.rotation.z = Math.sin(this.t * 2.4 + p.phase) * 0.1;
			p.sign.rotation.x = Math.sin(this.t * 1.8 + p.phase * 0.5) * 0.1;
		}
		if (p.fist) {
			p.fist.position.y = 1.75 + Math.max(0, march) * 0.2;
			p.fist.rotation.z = -0.4 - Math.max(0, march) * 0.5;
		}
		if (p.flag) {
			p.flag.rotation.y = Math.sin(this.t * 2.8 + p.phase) * 0.4;
			p.flag.rotation.z = Math.sin(this.t * 3.1 + p.phase * 0.6) * 0.15;
		}

		if (p.speechLife > 0) {
			p.speechLife -= dt;
			if (p.speechLife <= 0) p.speech.visible = false;
		}
	}

	private updateCrowdInstances(): void {
		const crowd = this.crowdInstances;
		if (!crowd) return;
		for (const p of this.people) {
			const index = p.instanceIndex;
			if (index === null) continue;
			const moving = Math.hypot(p.vx, p.vz);
			const motion = Math.min(1, moving / Math.max(0.01, p.speed));
			const bob = Math.abs(Math.sin(p.walkPhase + p.phase)) * 0.075 * motion;
			const squash = p.landSquash / 0.18;
			const scale = 0.95 + (Math.sin(p.phase * 2.7) + 1) * 0.06;
			this.tempPosition.set(p.x, p.jumpY + bob, p.z);
			this.tempRotation.set(0, p.facing, Math.sin(p.walkPhase * 0.5 + p.phase) * 0.035);
			this.tempQuaternion.setFromEuler(this.tempRotation);
			this.tempScale.set(scale * (1 + squash * 0.08), scale * (1 - squash * 0.16), scale * (1 + squash * 0.08));
			this.rootMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);

			crowd.bodies.setMatrixAt(index, this.rootMatrix);
			crowd.faces.setMatrixAt(index, this.rootMatrix);
			const signTilt = Math.sin(this.t * 2.1 + p.phase) * 0.12;
			this.writePart(crowd.sticks, index, 0, 0.53, 0.42, 0, 0, signTilt * 0.3, 1, 1, 1);
			this.writePart(crowd.signs, index, 0, 1.34, 0.43, 0, 0.12, 0.08 + signTilt, 1, 1, 1);
		}
		for (const mesh of Object.values(crowd)) mesh.instanceMatrix.needsUpdate = true;
	}

	private writePart(
		mesh: THREE.InstancedMesh,
		index: number,
		x: number,
		y: number,
		z: number,
		rx: number,
		ry: number,
		rz: number,
		sx: number,
		sy: number,
		sz: number,
	): void {
		this.tempPosition.set(x, y, z);
		this.tempRotation.set(rx, ry, rz);
		this.tempQuaternion.setFromEuler(this.tempRotation);
		this.tempScale.set(sx, sy, sz);
		this.partMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
		this.instanceMatrix.multiplyMatrices(this.rootMatrix, this.partMatrix);
		mesh.setMatrixAt(index, this.instanceMatrix);
	}

	dispose(): void {
		this.stopAudio?.();
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildBanner(): void {
		const pole = this.track(lit({ color: 0x5d4037, roughness: 0.8 }));
		const pL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.6, 6), pole);
		pL.position.set(-1.6, 1.3, -1.8);
		const pR = pL.clone();
		pR.position.x = 1.6;
		this.group.add(pL, pR);

		const { canvas: c, ctx } = labelCanvas(768, 192);
		// Progress pride stripe base
		const cols = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982'];
		cols.forEach((col, i) => {
			ctx.fillStyle = col;
			ctx.fillRect(0, (i * 192) / 6, 768, 192 / 6 + 1);
		});
		// chevron suggestion
		ctx.fillStyle = '#000';
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(120, 96);
		ctx.lineTo(0, 192);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = '#784F17';
		ctx.beginPath();
		ctx.moveTo(0, 20);
		ctx.lineTo(90, 96);
		ctx.lineTo(0, 172);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = 'rgba(0,0,0,0.5)';
		ctx.fillRect(140, 28, 600, 136);
		ctx.fillStyle = '#ffffff';
		ctx.font = 'bold 48px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('WIR SCHAFFEN DAS', 440, 82);
		ctx.font = 'bold 24px system-ui';
		ctx.fillText('ANGELA + LGBTQIA+ PROTEST GROUPIES', 440, 128);
		const tex = labelTexture(c);
		this.banner = new THREE.Mesh(
			new THREE.PlaneGeometry(3.4, 0.85),
			this.track(
				new THREE.MeshBasicMaterial({
					map: tex,
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		this.banner.position.set(0, 2.35, -1.8);
		this.group.add(this.banner);

		const ring = new THREE.Mesh(
			new THREE.RingGeometry(2.6, 2.75, 32),
			this.track(
				new THREE.MeshBasicMaterial({
					color: 0xffeb3b,
					side: THREE.DoubleSide,
					transparent: true,
					opacity: 0.55,
				}),
			),
		);
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.03;
		this.group.add(ring);
	}

	/** Tall pride flag poles around the picket */
	private buildPlantedFlags(): void {
		const kinds: FlagKind[] = ['progress', 'rainbow', 'trans', 'bi', 'lesbian', 'nb', 'pan', 'intersex', 'progress', 'rainbow'];
		for (let i = 0; i < kinds.length; i++) {
			const ang = (i / kinds.length) * Math.PI * 2;
			const r = 2.85;
			const g = this.makeFlagPole(at(kinds, i), 1.55 + (i % 3) * 0.08);
			g.position.set(Math.sin(ang) * r, 0, Math.cos(ang) * r);
			g.rotation.y = ang + Math.PI;
			this.group.add(g);
			this.plantedFlags.push(g);
		}
	}

	private makeFlagPole(kind: FlagKind, height = 1.6): THREE.Group {
		const g = new THREE.Group();
		const poleMat = this.track(
			lit({
				color: 0xb0bec5,
				metalness: 0.55,
				roughness: 0.4,
			}),
		);
		const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, height, 6), poleMat);
		pole.position.y = height / 2;
		g.add(pole);
		const ball = new THREE.Mesh(
			new THREE.SphereGeometry(0.05, 8, 8),
			this.track(
				lit({
					color: 0xffd700,
					metalness: 0.8,
					roughness: 0.3,
				}),
			),
		);
		ball.position.y = height + 0.04;
		g.add(ball);

		const tex = this.makePrideFlagTex(kind);
		const cloth = new THREE.Mesh(
			new THREE.PlaneGeometry(0.72, 0.48),
			this.track(
				new THREE.MeshBasicMaterial({
					map: tex,
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		cloth.position.set(0.38, height - 0.28, 0);
		g.add(cloth);
		g.userData['cloth'] = cloth;
		return g;
	}

	/** Small handheld pride flag for groupies */
	private makeHandFlag(kind: FlagKind): THREE.Group {
		const g = new THREE.Group();
		const stick = new THREE.Mesh(
			new THREE.CylinderGeometry(0.015, 0.018, 0.7, 5),
			this.track(lit({ color: 0x8d6e63, roughness: 0.9 })),
		);
		stick.position.y = 0.35;
		g.add(stick);
		const cloth = new THREE.Mesh(
			new THREE.PlaneGeometry(0.38, 0.26),
			this.track(
				new THREE.MeshBasicMaterial({
					map: this.makePrideFlagTex(kind),
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		cloth.position.set(0.2, 0.62, 0);
		g.add(cloth);
		g.userData['cloth'] = cloth;
		return g;
	}

	private makePrideFlagTex(kind: FlagKind): THREE.CanvasTexture {
		const { canvas: c, ctx } = labelCanvas(256, 160);
		this.paintPrideFlag(ctx, kind);
		return labelTexture(c);
	}

	private paintPrideFlag(ctx: CanvasRenderingContext2D, kind: FlagKind): void {
		const stripes = (cols: string[]) => {
			const h = 160 / cols.length;
			cols.forEach((col, i) => {
				ctx.fillStyle = col;
				ctx.fillRect(0, i * h, 256, h + 1);
			});
		};

		if (kind === 'rainbow') {
			stripes(['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982']);
		} else if (kind === 'progress') {
			stripes(['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982']);
			// chevrons: black, brown, light blue, pink, white
			const chev = ['#000000', '#784F17', '#5BCEFA', '#F5A9B8', '#FFFFFF'];
			chev.forEach((col, i) => {
				const x = 8 + i * 22;
				ctx.fillStyle = col;
				ctx.beginPath();
				ctx.moveTo(0, 0);
				ctx.lineTo(x + 40, 80);
				ctx.lineTo(0, 160);
				ctx.lineTo(0, 0);
				// only draw the outer edge band by clipping with previous — simple layered triangles
				ctx.closePath();
				ctx.fill();
			});
			// re-draw outer black tip cleanly
			ctx.fillStyle = '#000';
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(28, 80);
			ctx.lineTo(0, 160);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#784F17';
			ctx.beginPath();
			ctx.moveTo(0, 18);
			ctx.lineTo(48, 80);
			ctx.lineTo(0, 142);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#5BCEFA';
			ctx.beginPath();
			ctx.moveTo(0, 36);
			ctx.lineTo(68, 80);
			ctx.lineTo(0, 124);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#F5A9B8';
			ctx.beginPath();
			ctx.moveTo(0, 52);
			ctx.lineTo(88, 80);
			ctx.lineTo(0, 108);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#FFFFFF';
			ctx.beginPath();
			ctx.moveTo(0, 64);
			ctx.lineTo(108, 80);
			ctx.lineTo(0, 96);
			ctx.closePath();
			ctx.fill();
		} else if (kind === 'trans') {
			stripes(['#5BCEFA', '#F5A9B8', '#FFFFFF', '#F5A9B8', '#5BCEFA']);
		} else if (kind === 'bi') {
			stripes(['#D60270', '#D60270', '#9B4F96', '#0038A8', '#0038A8']);
		} else if (kind === 'lesbian') {
			stripes(['#D52D00', '#EF7627', '#FF9A56', '#FFFFFF', '#D162A4', '#B55690', '#A30262']);
		} else if (kind === 'nb') {
			stripes(['#FCF434', '#FFFFFF', '#9C59D1', '#2C2C2C']);
		} else if (kind === 'pan') {
			stripes(['#FF218C', '#FFD800', '#21B1FF']);
		} else {
			// intersex
			ctx.fillStyle = '#FFD800';
			ctx.fillRect(0, 0, 256, 160);
			ctx.strokeStyle = '#7902aa';
			ctx.lineWidth = 14;
			ctx.beginPath();
			ctx.arc(128, 80, 42, 0, Math.PI * 2);
			ctx.stroke();
		}

		// thin border
		ctx.strokeStyle = 'rgba(0,0,0,0.35)';
		ctx.lineWidth = 4;
		ctx.strokeRect(2, 2, 252, 156);
	}

	/**
	 * Angela Merkel — older, thick Mutti in navy pantsuit,
	 * signature blonde bowl cut, pearls, "Wir schaffen das".
	 */
	private buildMerkel(): void {
		const root = new THREE.Group();
		const base = new THREE.Vector3(0, 0, 1.2); // floor — joins the zombie shuffle
		root.position.copy(base);

		// Soft older skin
		const skin = this.track(lit({ color: 0xe8c4a8, roughness: 0.9 }));
		const suit = this.track(lit({ color: 0x1a237e, roughness: 0.75 }));
		const suitPants = this.track(lit({ color: 0x0d1545, roughness: 0.8 }));
		const blouse = this.track(lit({ color: 0xf5f5f5, roughness: 0.7 }));
		const hairM = this.track(lit({ color: 0xd4b896, roughness: 0.85 }));
		const pearl = this.track(
			lit({
				color: 0xfff8e7,
				metalness: 0.35,
				roughness: 0.25,
			}),
		);

		// Short thick legs
		const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.38, 4, 8), suitPants);
		const legR = legL.clone();
		legL.position.set(-0.16, 0.35, 0.02);
		legR.position.set(0.16, 0.35, 0.02);
		root.add(legL, legR);

		// Wide hips / belly — "net zo oud en dik"
		const hips = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), suitPants);
		hips.scale.set(1.25, 0.7, 0.95);
		hips.position.set(0, 0.72, 0.05);
		root.add(hips);

		const belly = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 14), suit);
		belly.scale.set(1.2, 0.95, 1.05);
		belly.position.set(0, 1.15, 0.12);
		root.add(belly);

		// Soft upper bulk
		const chest = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12), suit);
		chest.scale.set(1.15, 0.75, 0.9);
		chest.position.set(0, 1.55, 0.06);
		root.add(chest);

		// White blouse peek
		const collar = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), blouse);
		collar.scale.set(1.1, 0.55, 0.8);
		collar.position.set(0, 1.72, 0.14);
		root.add(collar);

		// Head — slightly fuller, older
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), skin);
		head.position.set(0, 2.05, 0.04);
		root.add(head);

		// Signature Merkel bowl cut (blonde, short, rounded)
		const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hairM);
		bowl.position.set(0, 2.12, -0.01);
		root.add(bowl);
		// Side volume
		const sideL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), hairM);
		sideL.scale.set(0.7, 1.1, 0.9);
		sideL.position.set(-0.2, 2.02, 0.02);
		const sideR = sideL.clone();
		sideR.position.x = 0.2;
		root.add(sideL, sideR);
		// Fringe
		const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.08), hairM);
		fringe.position.set(0, 2.12, 0.18);
		root.add(fringe);

		// Simple face
		const eyeM = this.track(new THREE.MeshBasicMaterial({ color: 0x2c1810 }));
		const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeM);
		const eyeR = eyeL.clone();
		eyeL.position.set(-0.07, 2.08, 0.2);
		eyeR.position.set(0.07, 2.08, 0.2);
		root.add(eyeL, eyeR);
		// Soft smile
		const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 4, 10, Math.PI), eyeM);
		mouth.position.set(0, 1.96, 0.2);
		mouth.rotation.x = 0.3;
		root.add(mouth);

		// Pearl necklace
		for (let i = 0; i < 9; i++) {
			const a = -0.7 + (i / 8) * 1.4;
			const bead = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), pearl);
			bead.position.set(Math.sin(a) * 0.2, 1.78 + Math.cos(a) * 0.04, 0.22 + Math.cos(a) * 0.06);
			root.add(bead);
		}

		// Right hand raised (Mutti wave / fist-ish)
		const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 4, 6), suit);
		arm.position.set(0.45, 1.55, 0.1);
		arm.rotation.z = -0.85;
		root.add(arm);
		const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), skin);
		hand.position.set(0.62, 1.82, 0.12);
		root.add(hand);

		// Left hand holds progress pride mini-flag
		const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.38, 4, 6), suit);
		armL.position.set(-0.42, 1.4, 0.15);
		armL.rotation.z = 0.5;
		armL.rotation.x = -0.4;
		root.add(armL);
		const flag = this.makeHandFlag('progress');
		flag.position.set(-0.55, 1.15, 0.25);
		flag.rotation.z = 0.2;
		root.add(flag);

		// Sign: WIR SCHAFFEN DAS
		const stick = new THREE.Mesh(
			new THREE.CylinderGeometry(0.025, 0.03, 1.0, 5),
			this.track(lit({ color: 0x8d6e63, roughness: 0.9 })),
		);
		stick.position.set(0.35, 1.55, 0.35);
		root.add(stick);
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(0.95, 0.55),
			this.track(
				new THREE.MeshBasicMaterial({
					map: this.makeSignTex(['WIR SCHAFFEN', 'DAS 🇩🇪'], 0),
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		sign.position.set(0.35, 2.2, 0.35);
		root.add(sign);

		// Name plate
		const nameSp = this.makeTextSprite('ANGELA MERKEL · Mutti', '#1a237e', 220, 44);
		nameSp.position.set(0, 2.45, 0.1);
		nameSp.scale.set(1.6, 0.32, 1);
		root.add(nameSp);
		tagLevelCulled(nameSp);

		// Speech bubble
		const { canvas: sc, ctx: speechCtx } = labelCanvas(360, 90);
		const speechTex = labelTexture(sc);
		const speech = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: speechTex,
				transparent: true,
				depthTest: true,
			}),
		);
		speech.scale.set(2.4, 0.6, 1);
		speech.position.set(0, 2.75, 0);
		speech.visible = false;
		// The deck cull owns the holder's `visible`, so `speechLife` keeps owning the sprite's.
		const speechHolder = new THREE.Group();
		speechHolder.add(speech);
		root.add(speechHolder);
		tagLevelCulled(speechHolder);

		// Abandoned crate at camp (Mutti left the stage)
		const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.38, 0.75), this.track(lit({ color: 0x5d4037, roughness: 0.85 })));
		crate.position.set(0, 0.19, 0.4);
		this.group.add(crate);

		// German flag mini at camp
		const de = this.makeDeFlagPole();
		de.position.set(0.7, 0, 0.5);
		this.group.add(de);
		this.plantedFlags.push(de);

		this.group.add(root);
		this.merkelIdx = this.people.length;
		this.people.push({
			root,
			x: base.x,
			z: base.z,
			vx: 0,
			vz: 0,
			preferredAngle: 0,
			preferredRadius: 1.2,
			speed: 0.85,
			phase: 0.2,
			energy: 0.72,
			facing: 0,
			walkPhase: 0,
			jumpY: 0,
			jumpVy: 0,
			jumpCooldown: 6,
			jumpUrge: 0,
			landSquash: 0,
			separationX: 0,
			separationZ: 0,
			instanceIndex: null,
			sign,
			speech,
			speechTex,
			speechCtx,
			speechLife: 0,
			fist: hand,
			flag,
			isMerkel: true,
			lineIdx: -1,
			// Sticky German Mutti voice bank
			voiceKey: 'Killian',
			voiceCd: 0,
		});
	}

	private makeDeFlagPole(): THREE.Group {
		const g = new THREE.Group();
		const pole = new THREE.Mesh(
			new THREE.CylinderGeometry(0.025, 0.03, 1.7, 6),
			this.track(
				lit({
					color: 0xb0bec5,
					metalness: 0.5,
					roughness: 0.4,
				}),
			),
		);
		pole.position.y = 0.85;
		g.add(pole);
		const { canvas: c, ctx } = labelCanvas(256, 160);
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, 256, 53);
		ctx.fillStyle = '#DD0000';
		ctx.fillRect(0, 53, 256, 54);
		ctx.fillStyle = '#FFCE00';
		ctx.fillRect(0, 107, 256, 53);
		const tex = labelTexture(c);
		const cloth = new THREE.Mesh(
			new THREE.PlaneGeometry(0.7, 0.44),
			this.track(
				new THREE.MeshBasicMaterial({
					map: tex,
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		cloth.position.set(0.38, 1.4, 0);
		g.add(cloth);
		g.userData['cloth'] = cloth;
		return g;
	}

	private buildMegaphoneStand(): void {
		const mega = new THREE.Mesh(
			new THREE.ConeGeometry(0.16, 0.38, 10),
			this.track(
				lit({
					color: 0xffeb3b,
					metalness: 0.3,
					roughness: 0.45,
				}),
			),
		);
		mega.rotation.z = Math.PI / 2;
		mega.position.set(0.55, 0.95, 1.55);
		this.group.add(mega);
	}

	private buildCrowd(n: number): void {
		const voiceKeys = [
			'Conrad',
			'Katja',
			'Jenny',
			'Guy',
			'Ryan',
			'Sonia',
			'Natasha',
			'Connor',
			'Aria',
			'Thomas',
			'Clara',
			'Libby',
			'Michelle',
			'Neerja',
			'Molly',
			'Ana',
			'Maisie',
			'Andrew',
			'Emily',
			'Eric',
		];
		const crowd = this.buildCrowdInstances(n);
		const protestBlue = new THREE.Color(0x3a8fd6);

		for (let i = 0; i < n; i++) {
			// A sunflower distribution fills an ellipse without a dense ring or
			// overlapping centre. The spot remains this person's soft home.
			const normalizedRadius = Math.sqrt((i + 0.7) / n);
			const preferredRadius = 0.8 + normalizedRadius * SWARM_RADIUS;
			const preferredAngle = i * 2.399 + 0.2;
			const bx = Math.sin(preferredAngle) * preferredRadius;
			const bz = Math.cos(preferredAngle) * preferredRadius * 0.78;
			const root = new THREE.Group();
			root.position.set(bx, 0, bz);
			crowd.bodies.setColorAt(i, protestBlue);
			const signTiles = crowd.signs.geometry.getAttribute('instanceTile');
			signTiles.setX(i, i % SIGN_LINES.length);

			const { canvas: sc, ctx: speechCtx } = labelCanvas(320, 80);
			const speechTex = labelTexture(sc);
			const speech = new THREE.Sprite(
				new THREE.SpriteMaterial({
					map: speechTex,
					transparent: true,
					depthTest: true,
				}),
			);
			speech.scale.set(1.9, 0.48, 1);
			speech.position.set(0, 2.35, 0);
			speech.visible = false;
			// The deck cull owns the holder's `visible`, so `speechLife` keeps owning the sprite's.
			const speechHolder = new THREE.Group();
			speechHolder.add(speech);
			root.add(speechHolder);
			tagLevelCulled(speechHolder);
			this.group.add(root);
			const energy = 0.7 + normalizedRadius * 0.55 + Math.random() * 0.08;
			this.people.push({
				root,
				x: bx,
				z: bz,
				vx: 0,
				vz: 0,
				preferredAngle,
				preferredRadius,
				speed: 1.05 + Math.random() * 0.25,
				phase: i * 0.9 + 0.5,
				energy,
				facing: preferredAngle + Math.PI,
				walkPhase: Math.random() * Math.PI * 2,
				jumpY: 0,
				jumpVy: 0,
				jumpCooldown: Math.random() * 8,
				jumpUrge: 0,
				landSquash: 0,
				separationX: 0,
				separationZ: 0,
				instanceIndex: i,
				speech,
				speechTex,
				speechCtx,
				speechLife: 0,
				isMerkel: false,
				lineIdx: i,
				voiceKey: at(voiceKeys, i),
				voiceCd: 0,
			});
		}
		if (crowd.bodies.instanceColor) crowd.bodies.instanceColor.needsUpdate = true;
		crowd.signs.geometry.getAttribute('instanceTile').needsUpdate = true;
		this.crowdInstances = crowd;
		this.updateCrowdInstances();
	}

	private buildCrowdInstances(count: number): CrowdInstances {
		const bodies = this.makeCrowdMesh(
			this.makeCrowdBodyGeometry(),
			this.track(lit({ color: 0xffffff, roughness: 0.85, flatShading: true })),
			count,
			'protest bodies',
		);
		const faces = this.makeCrowdMesh(
			this.makeCrowdFaceGeometry(),
			this.track(new THREE.MeshBasicMaterial({ color: 0x1a1a1a })),
			count,
			'protest faces',
		);
		faces.castShadow = false;
		const sticks = this.makeCrowdMesh(
			new THREE.CylinderGeometry(0.02, 0.02, 1.05, 5),
			this.track(lit({ color: 0x5d4037, roughness: 0.9 })),
			count,
			'protest sign sticks',
		);

		const signGeometry = new THREE.PlaneGeometry(0.76, 0.52);
		signGeometry.setAttribute('instanceTile', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
		const signs = this.makeCrowdMesh(signGeometry, this.makeAtlasMaterial(this.makeSignAtlas(), 4, 2), count, 'protest signs');
		signs.castShadow = false;
		return { bodies, faces, sticks, signs };
	}

	private makeCrowdBodyGeometry(): THREE.BufferGeometry {
		const torso = new THREE.CylinderGeometry(0.28, 0.32, 0.75, 10);
		torso.translate(0, 0.72, 0);
		const lowerBody = new THREE.SphereGeometry(0.32, 10, 7);
		lowerBody.translate(0, 0.36, 0);
		const head = new THREE.SphereGeometry(0.26, 10, 7);
		head.translate(0, 1.28, 0);
		const raisedArm = new THREE.CylinderGeometry(0.055, 0.055, 0.4, 6);
		raisedArm.rotateZ(-0.5);
		raisedArm.translate(0.35, 0.95, 0.05);
		const merged = mergeGeometries([torso, lowerBody, head, raisedArm]);
		if (!merged) throw new Error('protester body geometry could not be merged');
		return merged;
	}

	private makeCrowdFaceGeometry(): THREE.BufferGeometry {
		const leftEye = new THREE.SphereGeometry(0.038, 5, 4);
		leftEye.translate(-0.08, 1.32, 0.23);
		const rightEye = new THREE.SphereGeometry(0.038, 5, 4);
		rightEye.translate(0.08, 1.32, 0.23);
		const mouth = new THREE.BoxGeometry(0.1, 0.028, 0.03);
		mouth.translate(0, 1.18, 0.24);
		const merged = mergeGeometries([leftEye, rightEye, mouth]);
		if (!merged) throw new Error('protester face geometry could not be merged');
		return merged;
	}

	private makeCrowdMesh(
		geometry: THREE.BufferGeometry,
		material: THREE.Material,
		count: number,
		name: string,
	): THREE.InstancedMesh {
		const mesh = new THREE.InstancedMesh(geometry, material, count);
		mesh.name = name;
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		// Instance motion does not invalidate Three's lazy bound. A fixed swarm
		// sphere stays correct while avoiding one per-instance cull walk.
		mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), SWARM_RADIUS + SWARM_WANDER_RADIUS + 8);
		this.group.add(mesh);
		return mesh;
	}

	private makeAtlasMaterial(map: THREE.CanvasTexture, columns: number, rows: number): THREE.MeshBasicMaterial {
		const material = this.track(
			new THREE.MeshBasicMaterial({
				map,
				side: THREE.DoubleSide,
				toneMapped: false,
			}),
		);
		material.onBeforeCompile = (shader) => {
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nattribute float instanceTile;')
				.replace(
					'#include <map_vertex>',
					`#include <map_vertex>
#ifdef USE_MAP
	vec2 tileSize = vec2(${columns.toFixed(1)}, ${rows.toFixed(1)});
	vec2 tile = vec2(mod(instanceTile, tileSize.x), tileSize.y - 1.0 - floor(instanceTile / tileSize.x));
	vMapUv = (clamp(vMapUv, vec2(0.006), vec2(0.994)) + tile) / tileSize;
#endif`,
				);
		};
		material.customProgramCacheKey = () => `protest-atlas-${columns}x${rows}`;
		return material;
	}

	private makeSignAtlas(): THREE.CanvasTexture {
		const { canvas, ctx } = labelCanvas(1024, 352);
		for (let i = 0; i < SIGN_LINES.length; i++) {
			ctx.save();
			ctx.translate((i % 4) * 256, Math.floor(i / 4) * 176);
			this.paintSign(ctx, at(SIGN_LINES, i), i);
			ctx.restore();
		}
		return labelTexture(canvas);
	}

	private makeSignTex(lines: [string, string], seed: number): THREE.CanvasTexture {
		const { canvas: c, ctx } = labelCanvas(256, 176);
		this.paintSign(ctx, lines, seed);
		return labelTexture(c);
	}

	private paintSign(ctx: CanvasRenderingContext2D, lines: [string, string], seed: number): void {
		ctx.fillStyle = '#f8f4e8';
		ctx.fillRect(0, 0, 256, 176);
		if (seed < 3) {
			const rainbow = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982'];
			rainbow.forEach((color, i) => {
				ctx.fillStyle = color;
				ctx.fillRect(0, i * 6, 256, 6);
				ctx.fillRect(0, 170 - i * 6, 256, 6);
			});
		} else {
			ctx.strokeStyle = '#222222';
			ctx.lineWidth = 8;
			ctx.strokeRect(4, 4, 248, 168);
		}
		const visibleLines = lines.filter((line) => line.length > 0);
		ctx.fillStyle = '#111111';
		ctx.font = 'bold 28px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		visibleLines.forEach((line, i) => {
			ctx.fillText(line, 128, 88 - (visibleLines.length - 1) * 16 + i * 32);
		});
	}

	private makeTextSprite(text: string, bg: string, w: number, h: number): THREE.Sprite {
		const { canvas: c, ctx } = labelCanvas(w, h);
		ctx.fillStyle = bg.startsWith('#') || bg.startsWith('rgb') ? bg : bg;
		ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = '#fff';
		ctx.font = `bold ${Math.floor(h * 0.4)}px system-ui`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, w / 2, h / 2);
		const tex = labelTexture(c);
		const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
		sp.scale.set(0.85, 0.22, 1);
		return sp;
	}

	private showBubble(p: Protester, text: string, merkel = false): void {
		const ctx = p.speechCtx;
		const w = merkel ? 360 : 320;
		const h = merkel ? 90 : 80;
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = merkel ? 'rgba(26,35,126,0.95)' : 'rgba(255,255,255,0.95)';
		ctx.strokeStyle = merkel ? '#ffd700' : '#1565c0';
		ctx.lineWidth = 4;
		roundRect(ctx, 8, 6, w - 16, h - 20, 12);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(w * 0.45, h - 14);
		ctx.lineTo(w * 0.5, h - 2);
		ctx.lineTo(w * 0.55, h - 14);
		ctx.closePath();
		ctx.fillStyle = merkel ? 'rgba(26,35,126,0.95)' : 'rgba(255,255,255,0.95)';
		ctx.fill();
		ctx.stroke();

		ctx.fillStyle = merkel ? '#ffeb3b' : '#0d47a1';
		fitText(ctx, text, { x: 16, y: 10, w: w - 32, h: h - 32 }, { size: merkel ? 24 : 22 });

		p.speechTex.needsUpdate = true;
		p.speech.visible = true;
		p.speechLife = merkel ? 3.2 : 2.4 + Math.random() * 0.8;
	}
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function shortestAngle(from: number, to: number): number {
	let delta = to - from;
	while (delta > Math.PI) delta -= Math.PI * 2;
	while (delta < -Math.PI) delta += Math.PI * 2;
	return delta;
}
