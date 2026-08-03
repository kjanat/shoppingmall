import * as THREE from 'three';
import type { LightPool } from '@/render/LightPool';
import { labelCanvas, labelTexture } from '@/util/label';

/**
 * Baard-dief hideout — rocky west-wall cave stuffed with juwelen & goud.
 * (Pirate loot vibes, not a stereotype.) Thief path ends here after a heist.
 */
export class BeardCave {
	readonly group = new THREE.Group();
	/** World center of the cave mouth (path target) */
	readonly entrance = new THREE.Vector3(-33.5, 0, 20);
	/** Deep pile of loot (for confetti / glow) */
	readonly lootCenter = new THREE.Vector3(-34.7, 0.4, 20);
	private materials: THREE.Material[] = [];
	private lootGroup = new THREE.Group();
	private pulseT = 0;
	private glowMats: THREE.MeshStandardMaterial[] = [];
	private pool: LightPool;

	constructor(pool: LightPool) {
		this.pool = pool;
		this.group.name = 'beardCave';
		this.group.position.set(this.entrance.x, 0, this.entrance.z);
		this.buildShell();
		this.buildLoot();
		this.buildTorch();
		this.buildSigns();
		this.group.add(this.lootGroup);
	}

	/** Outer rock faces so players can't walk through the mountain */
	getColliders(): { minX: number; maxX: number; minZ: number; maxZ: number; label: string }[] {
		const cx = this.entrance.x;
		const cz = this.entrance.z;
		return [
			// back wall (west)
			{ minX: cx - 2.6, maxX: cx - 2.2, minZ: cz - 2.4, maxZ: cz + 2.4, label: 'cave_back' },
			// north / south rock
			{ minX: cx - 2.4, maxX: cx + 0.6, minZ: cz - 2.6, maxZ: cz - 2.2, label: 'cave_n' },
			{ minX: cx - 2.4, maxX: cx + 0.6, minZ: cz + 2.2, maxZ: cz + 2.6, label: 'cave_s' },
			// mouth pillars leave a walkable gap ~1.4m toward +X (mall)
		];
	}

	/** Call when the baard-dief dumps a sack — piles shimmer */
	pulseLoot(): void {
		this.pulseT = 1.2;
	}

	update(dt: number): void {
		if (this.pulseT > 0) {
			this.pulseT = Math.max(0, this.pulseT - dt);
			const boost = this.pulseT * 0.55;
			for (const m of this.glowMats) {
				m.emissiveIntensity = 0.35 + boost;
			}
			this.lootGroup.position.y = Math.sin(performance.now() * 0.012) * 0.02 * this.pulseT;
		} else {
			for (const m of this.glowMats) {
				m.emissiveIntensity = 0.28 + Math.sin(performance.now() * 0.003) * 0.06;
			}
		}
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildShell(): void {
		const rock = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x3e3429,
				roughness: 0.95,
				metalness: 0.05,
			}),
		);
		const rockDark = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x2a221c,
				roughness: 0.98,
				metalness: 0.02,
			}),
		);
		const floorMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x4a3f35,
				roughness: 0.9,
			}),
		);

		// Floor slab inside cave
		const floor = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 4.2), floorMat);
		floor.position.set(-1.0, 0.05, 0);
		this.group.add(floor);

		// Back wall + ceiling blob
		const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.8, 4.4), rockDark);
		back.position.set(-2.35, 1.35, 0);
		this.group.add(back);

		const ceil = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 4.0), rock);
		ceil.position.set(-1.0, 2.7, 0);
		this.group.add(ceil);

		// Side walls (rough)
		const nWall = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.6, 0.5), rock);
		nWall.position.set(-1.0, 1.25, -2.15);
		this.group.add(nWall);
		const sWall = nWall.clone();
		sWall.position.z = 2.15;
		this.group.add(sWall);

		// Mouth pillars + arch (opening toward mall = +X in local)
		const pillarGeo = new THREE.CylinderGeometry(0.38, 0.48, 2.6, 8);
		const pL = new THREE.Mesh(pillarGeo, rock);
		pL.position.set(0.55, 1.25, -1.15);
		const pR = new THREE.Mesh(pillarGeo, rock);
		pR.position.set(0.55, 1.25, 1.15);
		this.group.add(pL, pR);

		const arch = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.28, 8, 16, Math.PI), rock);
		arch.rotation.z = Math.PI / 2;
		arch.rotation.y = Math.PI / 2;
		arch.position.set(0.55, 2.15, 0);
		this.group.add(arch);

		// Rocky boulders framing the entrance
		for (const [x, y, z, s] of [
			[0.9, 0.35, -1.7, 0.55],
			[1.0, 0.28, 1.65, 0.48],
			[-0.3, 0.4, -2.0, 0.42],
			[-0.2, 0.32, 2.05, 0.5],
		] as const) {
			const b = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rock);
			b.position.set(x, y, z);
			b.rotation.set(Math.random(), Math.random(), Math.random());
			this.group.add(b);
		}

		// Dim gold fill light from treasure
		this.pool.register({
			color: 0xffc107,
			intensity: 1.6,
			distance: 8,
			decay: 2,
			follow: this.group,
			offset: new THREE.Vector3(-1.2, 1.4, 0),
		});
	}

	private buildLoot(): void {
		const gold = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xffd700,
				metalness: 0.95,
				roughness: 0.22,
				emissive: 0xaa7700,
				emissiveIntensity: 0.3,
			}),
		);
		this.glowMats.push(gold);

		const goldSoft = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xe6b422,
				metalness: 0.85,
				roughness: 0.35,
				emissive: 0x664400,
				emissiveIntensity: 0.2,
			}),
		);
		this.glowMats.push(goldSoft);

		const ruby = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xc62828,
				metalness: 0.4,
				roughness: 0.15,
				emissive: 0x4a0000,
				emissiveIntensity: 0.35,
			}),
		);
		const emerald = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x00c853,
				metalness: 0.45,
				roughness: 0.18,
				emissive: 0x003d1a,
				emissiveIntensity: 0.3,
			}),
		);
		const sapphire = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x1565c0,
				metalness: 0.5,
				roughness: 0.16,
				emissive: 0x001a40,
				emissiveIntensity: 0.3,
			}),
		);
		const silver = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xc0c0c0,
				metalness: 0.9,
				roughness: 0.28,
			}),
		);
		const wood = this.track(new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9 }));

		// Treasure chest
		const chest = new THREE.Group();
		chest.position.set(-1.35, 0.22, 0.15);
		const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.55, 0.75), wood);
		base.position.y = 0.28;
		chest.add(base);
		const lid = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.12, 0.78), wood);
		lid.position.set(0, 0.62, -0.12);
		lid.rotation.x = -0.55;
		chest.add(lid);
		const band = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.8), goldSoft);
		band.position.y = 0.4;
		chest.add(band);
		const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.08), gold);
		lock.position.set(0, 0.48, 0.38);
		chest.add(lock);
		this.lootGroup.add(chest);

		// Overflowing coin pile on chest
		for (let i = 0; i < 28; i++) {
			const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 10), i % 3 === 0 ? goldSoft : gold);
			const a = Math.random() * Math.PI * 2;
			const r = Math.random() * 0.38;
			coin.position.set(-1.35 + Math.cos(a) * r, 0.72 + Math.random() * 0.35, 0.1 + Math.sin(a) * r * 0.7);
			coin.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
			coin.rotation.z = Math.random() * Math.PI;
			this.lootGroup.add(coin);
		}

		// Big floor gold mound (local, deeper in cave)
		for (let i = 0; i < 55; i++) {
			const coin = new THREE.Mesh(
				new THREE.CylinderGeometry(0.07 + Math.random() * 0.04, 0.07, 0.025, 8),
				Math.random() > 0.5 ? gold : goldSoft,
			);
			const a = Math.random() * Math.PI * 2;
			const r = Math.random() * 0.95;
			coin.position.set(-1.6 + Math.cos(a) * r * 0.7, 0.18 + Math.random() * 0.45 * (1 - r * 0.5), -0.9 + Math.sin(a) * r);
			coin.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.6;
			coin.rotation.z = Math.random() * Math.PI;
			this.lootGroup.add(coin);
		}

		// Goblets
		for (const [x, z] of [
			[-0.55, 1.1],
			[-1.9, 1.0],
			[-0.7, -1.2],
		] as const) {
			const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.22, 8), gold);
			cup.position.set(x, 0.28, z);
			this.lootGroup.add(cup);
			const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.12, 6), goldSoft);
			stem.position.set(x, 0.12, z);
			this.lootGroup.add(stem);
		}

		// Gem clusters
		const gems: { mat: THREE.Material; x: number; y: number; z: number }[] = [
			{ mat: ruby, x: -1.0, y: 0.35, z: -1.4 },
			{ mat: emerald, x: -2.0, y: 0.32, z: -0.4 },
			{ mat: sapphire, x: -0.9, y: 0.38, z: 1.35 },
			{ mat: ruby, x: -1.7, y: 0.85, z: 0.2 },
			{ mat: emerald, x: -1.1, y: 0.9, z: -0.15 },
		];
		for (const g of gems) {
			const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), g.mat);
			gem.position.set(g.x, g.y, g.z);
			gem.rotation.set(0.4, Math.random(), 0.2);
			this.lootGroup.add(gem);
		}

		// Gold chains (torus loops)
		for (let i = 0; i < 6; i++) {
			const chain = new THREE.Mesh(new THREE.TorusGeometry(0.14 + Math.random() * 0.06, 0.022, 6, 14), i % 2 ? gold : silver);
			chain.position.set(-1.2 + (Math.random() - 0.5) * 1.2, 0.25 + Math.random() * 0.5, (Math.random() - 0.5) * 2.2);
			chain.rotation.set(Math.random(), Math.random(), Math.random());
			this.lootGroup.add(chain);
		}

		// Crowns / tiara
		const crown = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 16), gold);
		crown.position.set(-1.5, 0.95, -0.5);
		crown.rotation.x = Math.PI / 2;
		this.lootGroup.add(crown);
		for (let i = 0; i < 5; i++) {
			const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 5), goldSoft);
			const a = (i / 5) * Math.PI * 2;
			spike.position.set(-1.5 + Math.cos(a) * 0.2, 1.05, -0.5 + Math.sin(a) * 0.2);
			this.lootGroup.add(spike);
		}

		// Stacked ingots
		for (let i = 0; i < 8; i++) {
			const bar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.14), goldSoft);
			bar.position.set(-0.4 + (i % 3) * 0.12, 0.2 + Math.floor(i / 3) * 0.09, -1.55 + (i % 2) * 0.08);
			bar.rotation.y = (Math.random() - 0.5) * 0.3;
			this.lootGroup.add(bar);
		}

		// Pearl string (small spheres)
		for (let i = 0; i < 12; i++) {
			const pearl = new THREE.Mesh(
				new THREE.SphereGeometry(0.045, 8, 8),
				this.track(
					new THREE.MeshStandardMaterial({
						color: 0xfff8e7,
						roughness: 0.25,
						metalness: 0.15,
					}),
				),
			);
			pearl.position.set(-0.85 + i * 0.06, 0.55, 1.25 + Math.sin(i) * 0.04);
			this.lootGroup.add(pearl);
		}
	}

	private buildTorch(): void {
		const iron = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x37474f,
				metalness: 0.7,
				roughness: 0.4,
			}),
		);
		const flameMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xff6d00,
				emissive: 0xff3d00,
				emissiveIntensity: 1.2,
				roughness: 1,
			}),
		);
		this.glowMats.push(flameMat);

		const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 6), iron);
		stick.position.set(0.2, 1.35, -1.85);
		stick.rotation.z = 0.25;
		this.group.add(stick);
		const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 6), flameMat);
		flame.position.set(0.35, 1.9, -1.85);
		this.group.add(flame);

		this.pool.register({
			color: 0xff6d00,
			intensity: 1.1,
			distance: 6,
			decay: 2,
			follow: this.group,
			offset: new THREE.Vector3(0.35, 1.95, -1.85),
		});
	}

	private buildSigns(): void {
		const makePlate = (lines: string[], _w: number, _h: number, bg: string, fg: string) => {
			const { canvas: c, ctx } = labelCanvas(512, 256);
			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, 512, 256);
			ctx.strokeStyle = fg;
			ctx.lineWidth = 8;
			ctx.strokeRect(8, 8, 496, 240);
			ctx.fillStyle = fg;
			ctx.textAlign = 'center';
			ctx.font = 'bold 36px system-ui';
			lines.forEach((line, i) => {
				if (i === 0) ctx.font = 'bold 40px system-ui';
				else ctx.font = '28px system-ui';
				ctx.fillText(line, 256, 70 + i * 52);
			});
			const tex = labelTexture(c);
			return this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
		};

		const doorSign = new THREE.Mesh(
			new THREE.PlaneGeometry(1.8, 0.9),
			makePlate(["BEARD-MAN'S CAVE", 'JUWELEN · GOUD', 'baard-dief only 💀'], 512, 256, '#1a1208', '#ffd700'),
		);
		doorSign.position.set(0.75, 2.55, 0);
		doorSign.rotation.y = Math.PI / 2;
		this.group.add(doorSign);

		const lootSign = new THREE.Mesh(
			new THREE.PlaneGeometry(1.4, 0.55),
			makePlate(['★ LOOT HOARD ★', 'niet aanraken (toch wel)'], 512, 256, '#3e2723', '#ffe082'),
		);
		lootSign.position.set(-2.0, 1.9, 0);
		lootSign.rotation.y = Math.PI / 2;
		this.group.add(lootSign);
	}
}
