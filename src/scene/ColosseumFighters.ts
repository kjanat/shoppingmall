import type { BufferGeometry, Material } from 'three';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import { lit } from '#/render/material';
import type { CityColosseum } from '#/scene/city/CityColosseum';
import { COLOSSEUM_PLAN } from '#/scene/city/cityPlan';
import { clamp, lerp } from '#/util/math';

export type GladiatorRole = 'secutor' | 'retiarius' | 'thraex' | 'murmillo';
export type FighterState = 'entrance' | 'taunt' | 'circling' | 'attack' | 'block' | 'hit' | 'defeat' | 'victory';

export interface Gladiator {
	id: string;
	name: string;
	role: GladiatorRole;
	group: Group;
	hp: number;
	maxHp: number;
	state: FighterState;
	stateTime: number;
	pos: Vector3;
	targetPos: Vector3;
	rotY: number;
	targetRotY: number;
	weaponMesh: Mesh;
	shieldMesh: Mesh | null;
	netMesh?: Mesh | null;
	healthBarMesh: Mesh;
	healthBarMat: MeshBasicMaterial;
}

/**
 * ColosseumFighters — Gladiator combat simulator for the Mega Colosseum arena.
 * Highly detailed 3D Roman gladiators with plumed Galea helmets, bronze armor plates,
 * greaves, Gladius swords, Scutum shields, Trident & Net, hit spark & dust effects,
 * health meters, and AI fight round loop.
 */
export class ColosseumFighters {
	readonly group = new Group();

	private readonly materials: Material[] = [];
	private readonly geometries: BufferGeometry[] = [];
	private readonly gladiators: Gladiator[] = [];
	private readonly unitBox = new BoxGeometry(1, 1, 1);

	// Hit effect spark and dust meshes
	private readonly hitSparks: { mesh: Mesh; life: number }[] = [];
	private sparkMat: MeshBasicMaterial;

	private roundTime = 0;
	private roundState: 'fighting' | 'ended' = 'fighting';
	private colosseum: CityColosseum | null = null;

	constructor() {
		this.group.name = 'colosseum_fighters';
		this.geometries.push(this.unitBox);

		this.sparkMat = new MeshBasicMaterial({ color: 0xffcc22, toneMapped: false });
		this.materials.push(this.sparkMat);

		this.spawnInitialFighters();
	}

	bindColosseum(colosseum: CityColosseum): void {
		this.colosseum = colosseum;
		if (this.colosseum) {
			this.colosseum.setGates('opening');
		}
	}

	update(dt: number, time: number): void {
		this.roundTime += dt;

		// Update hit spark & dust effects
		for (let i = this.hitSparks.length - 1; i >= 0; i--) {
			const spark = this.hitSparks[i];
			if (!spark) continue;
			spark.life -= dt * 3.2;
			spark.mesh.scale.multiplyScalar(0.9);
			if (spark.life <= 0) {
				this.group.remove(spark.mesh);
				this.hitSparks.splice(i, 1);
			}
		}

		if (this.gladiators.length < 2) return;

		const f1 = this.gladiators[0];
		const f2 = this.gladiators[1];
		if (!(f1 && f2)) return;

		if (this.roundState === 'fighting') {
			this.updateFighterAI(f1, f2, dt, time);
			this.updateFighterAI(f2, f1, dt, time);

			if (f1.hp <= 0 || f2.hp <= 0) {
				this.roundState = 'ended';
				if (f1.hp <= 0) {
					f1.state = 'defeat';
					f2.state = 'victory';
				} else {
					f2.state = 'defeat';
					f1.state = 'victory';
				}
				f1.stateTime = 0;
				f2.stateTime = 0;
			}
		} else if (this.roundState === 'ended' && this.roundTime > 10.0) {
			this.resetRound();
		}
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
	}

	private spawnInitialFighters(): void {
		const { x: cx, z: cz, arenaRadiusZ } = COLOSSEUM_PLAN;

		// Fighter 1: Secutor Gladiator (Maximus) from North Gate
		const g1 = this.createGladiator({ id: 'g1', name: 'MAXIMUS THE SECUTOR', role: 'secutor', startPos: new Vector3(cx - 3, 0.1, cz - arenaRadiusZ + 5), startRotY: 0 });

		// Fighter 2: Retiarius Gladiator (Flavius) from South Gate
		const g2 = this.createGladiator({
			id: 'g2',
			name: 'FLAVIUS THE RETIARIUS',
			role: 'retiarius',
			startPos: new Vector3(cx + 3, 0.1, cz + arenaRadiusZ - 5),
			startRotY: Math.PI,
		});

		this.gladiators.push(g1, g2);
		this.group.add(g1.group);
		this.group.add(g2.group);
	}

	private createGladiator({ id, name, role, startPos, startRotY }: {
		id: string;
		name: string;
		role: GladiatorRole;
		startPos: Vector3;
		startRotY: number;
	}): Gladiator {
		const gGroup = new Group();
		gGroup.position.copy(startPos);
		gGroup.rotation.y = startRotY;

		// Materials
		const skinMat = lit({ color: 0xc89868, roughness: 0.7 });
		const brassMat = lit({ color: 0xc59b27, roughness: 0.3, metalness: 0.8 });
		const tunicMat = lit({ color: role === 'secutor' ? 0x990000 : 0x1b4d3e, roughness: 0.8 });
		const steelMat = lit({ color: 0x999999, roughness: 0.2, metalness: 0.9 });
		const leatherMat = lit({ color: 0x4a3425, roughness: 0.8 });
		this.materials.push(skinMat, brassMat, tunicMat, steelMat, leatherMat);

		// Muscular Torso & Belt
		const torso = new Mesh(this.unitBox, skinMat);
		torso.scale.set(0.65, 0.85, 0.42);
		torso.position.set(0, 1.15, 0);
		torso.castShadow = true;
		gGroup.add(torso);

		// Subligaculum (Leather Tunic/Loincloth) & Balteus Belt
		const tunic = new Mesh(this.unitBox, tunicMat);
		tunic.scale.set(0.68, 0.55, 0.45);
		tunic.position.set(0, 0.75, 0);
		gGroup.add(tunic);

		const belt = new Mesh(this.unitBox, brassMat);
		belt.scale.set(0.7, 0.18, 0.47);
		belt.position.set(0, 0.95, 0);
		gGroup.add(belt);

		// Armor: Lorica Segmentata or Galerus Shoulder Guard
		if (role === 'secutor') {
			const armor = new Mesh(this.unitBox, brassMat);
			armor.scale.set(0.7, 0.55, 0.46);
			armor.position.set(0, 1.3, 0);
			gGroup.add(armor);
		} else {
			// Retiarius Shoulder Guard (Galerus)
			const galerus = new Mesh(this.unitBox, brassMat);
			galerus.scale.set(0.35, 0.5, 0.35);
			galerus.position.set(-0.38, 1.45, 0);
			gGroup.add(galerus);
		}

		// Legs & Bronze Ocreae Greaves
		const leftLeg = new Mesh(this.unitBox, skinMat);
		leftLeg.scale.set(0.24, 0.7, 0.24);
		leftLeg.position.set(-0.17, 0.35, 0);

		const rightLeg = new Mesh(this.unitBox, skinMat);
		rightLeg.scale.set(0.24, 0.7, 0.24);
		rightLeg.position.set(0.17, 0.35, 0);

		const leftGreave = new Mesh(this.unitBox, brassMat);
		leftGreave.scale.set(0.26, 0.5, 0.26);
		leftGreave.position.set(-0.17, 0.3, 0.02);

		gGroup.add(leftLeg, rightLeg, leftGreave);

		// Head + Plumed Galea Helmet
		const head = new Mesh(this.unitBox, skinMat);
		head.scale.set(0.32, 0.32, 0.32);
		head.position.set(0, 1.7, 0);
		gGroup.add(head);

		const helmet = new Mesh(this.unitBox, brassMat);
		helmet.scale.set(0.38, 0.35, 0.38);
		helmet.position.set(0, 1.75, 0);
		gGroup.add(helmet);

		// Helmet Red Feather Plume Crest
		const crest = new Mesh(this.unitBox, tunicMat);
		crest.scale.set(0.08, 0.3, 0.5);
		crest.position.set(0, 2.02, 0);
		gGroup.add(crest);

		// Weapon Mesh (Gladius or Trident)
		let weaponMesh: Mesh;
		let shieldMesh: Mesh | null = null;
		let netMesh: Mesh | null = null;

		if (role === 'retiarius') {
			// Trident Spear
			weaponMesh = new Mesh(this.unitBox, steelMat);
			weaponMesh.scale.set(0.06, 2.2, 0.06);
			weaponMesh.position.set(0.42, 1.2, 0.3);

			// Retiarius Weighted Net
			netMesh = new Mesh(this.unitBox, leatherMat);
			netMesh.scale.set(0.5, 0.5, 0.1);
			netMesh.position.set(-0.42, 1.1, 0.2);
			gGroup.add(netMesh);
		} else {
			// Gladius Shortsword
			weaponMesh = new Mesh(this.unitBox, steelMat);
			weaponMesh.scale.set(0.08, 1.0, 0.08);
			weaponMesh.position.set(0.42, 1.2, 0.3);
			weaponMesh.rotation.x = Math.PI / 4;

			// Scutum Rectangular Shield with Brass Boss
			shieldMesh = new Mesh(this.unitBox, tunicMat);
			shieldMesh.scale.set(0.6, 0.95, 0.1);
			shieldMesh.position.set(-0.42, 1.15, 0.25);

			const boss = new Mesh(this.unitBox, brassMat);
			boss.scale.set(0.2, 0.2, 0.15);
			boss.position.set(-0.42, 1.15, 0.32);
			gGroup.add(shieldMesh, boss);
		}
		gGroup.add(weaponMesh);

		// Floating 3D Health Meter
		const hpBgMat = new MeshBasicMaterial({ color: 0x222222 });
		const hpFgMat = new MeshBasicMaterial({ color: 0x22cc44 });
		this.materials.push(hpBgMat, hpFgMat);

		const hpBg = new Mesh(this.unitBox, hpBgMat);
		hpBg.scale.set(1.2, 0.14, 0.05);
		hpBg.position.set(0, 2.35, 0);

		const hpFg = new Mesh(this.unitBox, hpFgMat);
		hpFg.scale.set(1.2, 0.16, 0.06);
		hpFg.position.set(0, 2.35, 0.01);
		gGroup.add(hpBg, hpFg);

		return {
			id,
			name,
			role,
			group: gGroup,
			hp: 100,
			maxHp: 100,
			state: 'entrance',
			stateTime: 0,
			pos: startPos.clone(),
			targetPos: startPos.clone(),
			rotY: startRotY,
			targetRotY: startRotY,
			weaponMesh,
			shieldMesh,
			netMesh,
			healthBarMesh: hpFg,
			healthBarMat: hpFgMat,
		};
	}

	private updateFighterAI(self: Gladiator, opp: Gladiator, dt: number, time: number): void {
		self.stateTime += dt;

		// Health Bar fill & color
		const hpFrac = clamp(self.hp / self.maxHp, 0, 1);
		self.healthBarMesh.scale.x = hpFrac * 1.2;
		if (hpFrac > 0.5) {
			self.healthBarMat.color.setHex(0x22cc44);
		} else if (hpFrac > 0.25) {
			self.healthBarMat.color.setHex(0xeec200);
		} else {
			self.healthBarMat.color.setHex(0xdd2222);
		}

		if (self.state === 'entrance') {
			// March from gates to arena center
			const { x: cx, z: cz } = COLOSSEUM_PLAN;
			const target = new Vector3(cx + (self.id === 'g1' ? -3 : 3), 0.1, cz + (self.id === 'g1' ? -6 : 6));
			self.pos.lerp(target, dt * 1.6);
			self.group.position.copy(self.pos);

			if (self.pos.distanceTo(target) < 0.5) {
				self.state = 'taunt';
				self.stateTime = 0;
			}
		} else if (self.state === 'taunt') {
			// Raise weapon to Imperial Pulvinar & crowd
			self.weaponMesh.position.y = 1.7 + 0.25 * Math.sin(time * 7.5);
			if (self.stateTime > 2.0) {
				self.state = 'circling';
				self.stateTime = 0;
			}
		} else if (self.state === 'circling') {
			// Face opponent
			const dx = opp.pos.x - self.pos.x;
			const dz = opp.pos.z - self.pos.z;
			self.rotY = Math.atan2(dx, dz);
			self.group.rotation.y = self.rotY;

			const dist = self.pos.distanceTo(opp.pos);
			if (dist > 3.2) {
				const dir = opp.pos.clone().sub(self.pos).normalize();
				self.pos.addScaledVector(dir, dt * 2.4);
				self.group.position.copy(self.pos);
			} else if (Math.random() < 0.06) {
				self.state = 'attack';
				self.stateTime = 0;
			}
		} else if (self.state === 'attack') {
			// Sword strike animation
			const attackProgress = Math.sin(self.stateTime * Math.PI * 4);
			self.weaponMesh.position.z = 0.3 + attackProgress * 0.7;
			self.weaponMesh.rotation.x = Math.PI / 4 + attackProgress * 0.9;

			if (self.stateTime > 0.35) {
				const dist = self.pos.distanceTo(opp.pos);
				if (dist < 3.4 && opp.state !== 'hit' && opp.state !== 'defeat') {
					if (opp.shieldMesh && Math.random() < 0.42) {
						opp.state = 'block';
						opp.stateTime = 0;
						this.spawnSpark(opp.pos.clone().add(new Vector3(0, 1.2, 0)));
					} else {
						opp.hp = Math.max(0, opp.hp - 20);
						opp.state = 'hit';
						opp.stateTime = 0;
						this.spawnSpark(opp.pos.clone().add(new Vector3(0, 1.2, 0)));
					}
				}
				self.state = 'circling';
				self.stateTime = 0;
			}
		} else if (self.state === 'block') {
			if (self.shieldMesh) self.shieldMesh.position.z = 0.5;
			if (self.stateTime > 0.5) {
				if (self.shieldMesh) self.shieldMesh.position.z = 0.25;
				self.state = 'circling';
				self.stateTime = 0;
			}
		} else if (self.state === 'hit') {
			self.group.position.z += Math.sin(self.stateTime * 22.0) * 0.06;
			if (self.stateTime > 0.4) {
				self.state = 'circling';
				self.stateTime = 0;
			}
		} else if (self.state === 'defeat') {
			// Kneel/fall to sand
			self.group.rotation.x = lerp(self.group.rotation.x, -Math.PI / 2, dt * 4.5);
			self.group.position.y = lerp(self.group.position.y, 0.2, dt * 4.5);
		} else if (self.state === 'victory') {
			self.weaponMesh.position.y = 1.9 + Math.sin(time * 6.5) * 0.25;
		}
	}

	private spawnSpark(pos: Vector3): void {
		const spark = new Mesh(new SphereGeometry(0.25, 6, 6), this.sparkMat);
		spark.position.copy(pos);
		this.group.add(spark);
		this.hitSparks.push({ mesh: spark, life: 1.0 });
		this.geometries.push(spark.geometry);
	}

	private resetRound(): void {
		this.roundTime = 0;
		this.roundState = 'fighting';

		const f1 = this.gladiators[0];
		const f2 = this.gladiators[1];
		if (!(f1 && f2)) return;

		const { x: cx, z: cz, arenaRadiusZ } = COLOSSEUM_PLAN;

		f1.hp = 100;
		f1.state = 'entrance';
		f1.stateTime = 0;
		f1.pos.set(cx - 3, 0.1, cz - arenaRadiusZ + 5);
		f1.group.position.copy(f1.pos);
		f1.group.rotation.set(0, 0, 0);

		f2.hp = 100;
		f2.state = 'entrance';
		f2.stateTime = 0;
		f2.pos.set(cx + 3, 0.1, cz + arenaRadiusZ - 5);
		f2.group.position.copy(f2.pos);
		f2.group.rotation.set(0, Math.PI, 0);
	}
}
