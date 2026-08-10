import * as THREE from 'three';
import { levelY } from '#/data/levels';
import {
	BACK_TO_WALL_Y,
	RESTROOMS_DIVIDER,
	RESTROOMS_INTERIOR,
	RESTROOMS_ROOMS,
	RESTROOMS_SHELL,
	RESTROOMS_SPEC,
	WUDU_COLLIDER,
} from '#/data/world';
import type { RoomCollider } from '#/physics/Collision';
import type { LightPool } from '#/render/LightPool';
import type { LitMaterial } from '#/render/material';
import { lit } from '#/render/material';
import { labelCanvas, labelTexture } from '#/util/label';
import { half } from '#/util/math';

/**
 * Het blok kijkt naar het noorden, dus staat alles met een voorkant een halve slag
 * om: de urinoirs, de hokjes, de wastafels en elk bordje. Zonder deze draai leest de
 * hal de achterkant van de belettering en spoelt een urinoir de muur in.
 */
const FACING_NORTH_Y = Math.PI;

/**
 * Mall toilets next to the gebedsruimte (not inside it).
 * - Heren: urinoirs + 1 hokje
 * - Dames: 2 hokjes
 * - Wudu/ablution niche between prayer room and WCs (foot-wash taps)
 *
 * De opening ligt op het noorden, aan de hal van de hoofdingang. Alles wat hier een
 * kant op kijkt kijkt dus naar −z, en elke z-offset komt uit RESTROOMS_SPEC.
 */
export class Restrooms {
	readonly group = new THREE.Group();
	/** Center of the WC block (world) */
	/** West wall utility strip — clear of south-store fronts */
	readonly pos = new THREE.Vector3(RESTROOMS_SPEC.center.x, levelY('v0'), RESTROOMS_SPEC.center.z);
	private materials: THREE.Material[] = [];
	private pool: LightPool;

	constructor(pool: LightPool) {
		this.pool = pool;
		this.group.name = 'restrooms';
		this.group.position.copy(this.pos);
		this.buildShell();
		this.buildMens(RESTROOMS_ROOMS.mensX);
		this.buildWomens(RESTROOMS_ROOMS.womensX);
		this.buildWudu();
		this.buildCorridorSigns();
	}

	/** AABBs for CollisionWorld, read off the same walls the shell builds. */
	getColliders(): RoomCollider[] {
		const cx = this.pos.x;
		const cz = this.pos.z;
		const { shell, wallThickness } = RESTROOMS_SPEC;
		const { sideX, backZ } = RESTROOMS_SHELL;
		const shellX = half(shell.width);
		const shellZ = half(shell.depth);
		const halfWall = half(wallThickness);
		const halfDivider = half(RESTROOMS_DIVIDER.thickness);
		return [
			{ minX: cx - sideX - halfWall, maxX: cx - sideX + halfWall, minZ: cz - shellZ, maxZ: cz + shellZ, label: 'wc_wall_w' },
			{ minX: cx + sideX - halfWall, maxX: cx + sideX + halfWall, minZ: cz - shellZ, maxZ: cz + shellZ, label: 'wc_wall_e' },
			{ minX: cx - shellX, maxX: cx + shellX, minZ: cz + backZ - halfWall, maxZ: cz + backZ + halfWall, label: 'wc_wall_s' },
			{
				minX: cx - halfDivider,
				maxX: cx + halfDivider,
				minZ: cz + RESTROOMS_DIVIDER.minZ,
				maxZ: cz + RESTROOMS_DIVIDER.maxZ,
				label: 'wc_divider',
			},
			// De wudu-bank stond in geen enkele doos, dus je liep dwars door 38 cm zichtbaar
			// meubel. Kniehoog, dus hij houdt een lichaam tegen en geen blik.
			{
				minX: WUDU_COLLIDER.minX,
				maxX: WUDU_COLLIDER.maxX,
				minZ: WUDU_COLLIDER.minZ,
				maxZ: WUDU_COLLIDER.maxZ,
				maxY: WUDU_COLLIDER.topY,
				blocksSight: false,
				label: 'wc_wudu_bench',
			},
		];
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private tileMat(color: number): LitMaterial {
		return this.track(lit({ color, roughness: 0.55, metalness: 0.05 }));
	}

	private buildShell(): void {
		const { shell, floorThickness, wallHeight, wallThickness, fascia, divider } = RESTROOMS_SPEC;
		const { sideX, backZ, fasciaZ } = RESTROOMS_SHELL;

		const floor = new THREE.Mesh(new THREE.BoxGeometry(shell.width, floorThickness, shell.depth), this.tileMat(0xd5d0c8));
		floor.position.y = half(floorThickness);
		this.group.add(floor);

		const wall = this.tileMat(0xece8e1);
		// back wall (closed) — zuid, met de rug naar ISLAND HOP
		const back = new THREE.Mesh(new THREE.BoxGeometry(shell.width, wallHeight, wallThickness), wall);
		back.position.set(0, half(wallHeight), backZ);
		this.group.add(back);
		// side walls
		for (const sign of [-1, 1] as const) {
			const side = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, shell.depth), wall);
			side.position.set(sign * sideX, half(wallHeight), 0);
			this.group.add(side);
		}
		// scheidingswand heren/dames — hij stond alleen in de collision, dus je liep
		// tegen een onzichtbare muur van vijf meter aan
		const split = new THREE.Mesh(new THREE.BoxGeometry(divider.thickness, wallHeight, RESTROOMS_DIVIDER.depth), wall);
		split.position.set(0, half(wallHeight), RESTROOMS_DIVIDER.centerZ);
		this.group.add(split);

		// front open with partial fascia — noord, aan de rode loper
		const header = new THREE.Mesh(new THREE.BoxGeometry(shell.width, fascia.height, fascia.thickness), wall);
		header.position.set(0, wallHeight - half(fascia.height), -fasciaZ);
		this.group.add(header);

		// ceiling strip lights
		this.pool.register({
			color: 0xf5f0e6,
			intensity: 8,
			distance: 12,
			decay: 1.8,
			position: new THREE.Vector3(this.pos.x, 2.7, this.pos.z),
		});
	}

	/** Local-X offset for men's room (positive = east of the divider) */
	private buildMens(ox: number): void {
		const { zone: zoneSpec, urinalWall, urinals, mensStall, mensBasin } = RESTROOMS_INTERIOR;
		const g = new THREE.Group();
		g.position.x = ox;
		this.group.add(g);

		// floor zone color
		const zone = new THREE.Mesh(
			new THREE.BoxGeometry(zoneSpec.width, zoneSpec.thickness, zoneSpec.depth),
			this.tileMat(0xc5d5e8),
		);
		zone.position.set(0, zoneSpec.centerY, 0);
		g.add(zone);

		// urinal wall + 3 urinals
		const splash = new THREE.Mesh(
			new THREE.BoxGeometry(urinalWall.width, urinalWall.height, urinalWall.thickness),
			this.track(
				lit({
					color: 0xb0bec5,
					metalness: 0.35,
					roughness: 0.4,
				}),
			),
		);
		splash.position.set(0, urinalWall.centerY, urinalWall.offsetZ);
		g.add(splash);

		for (let i = 0; i < urinals.count; i++) {
			g.add(this.makeUrinal((i - half(urinals.count - 1)) * urinals.spacing, urinals.offsetZ));
		}

		// dividers between urinals
		const divMat = this.track(lit({ color: 0x90a4ae, metalness: 0.2, roughness: 0.5 }));
		for (const dx of [-half(urinals.spacing), half(urinals.spacing)]) {
			const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.45), divMat);
			d.position.set(dx, 0.85, 2.35);
			g.add(d);
		}

		// one sit toilet stall
		g.add(this.makeStall(mensStall.offsetX, mensStall.offsetZ, 0x90caf9));

		// sink
		g.add(this.makeSink(mensBasin.offsetX, mensBasin.offsetZ));

		// sign
		g.add(this.makeDoorSign(0.1, -3.0, 'HEREN', '♂ urinoirs + hokje', '#1565c0'));
	}

	private buildWomens(ox: number): void {
		const { zone: zoneSpec, womensStall, womensBasin } = RESTROOMS_INTERIOR;
		const g = new THREE.Group();
		g.position.x = ox;
		this.group.add(g);

		const zone = new THREE.Mesh(
			new THREE.BoxGeometry(zoneSpec.width, zoneSpec.thickness, zoneSpec.depth),
			this.tileMat(0xf0d0d8),
		);
		zone.position.set(0, zoneSpec.centerY, 0);
		g.add(zone);

		// two stalls
		g.add(this.makeStall(-womensStall.offsetX, womensStall.offsetZ, 0xf48fb1));
		g.add(this.makeStall(womensStall.offsetX, womensStall.offsetZ, 0xf48fb1));

		// sinks
		g.add(this.makeSink(-womensBasin.offsetX, womensBasin.offsetZ));
		g.add(this.makeSink(womensBasin.offsetX, womensBasin.offsetZ));

		// mirror strip
		const mirror = new THREE.Mesh(
			new THREE.BoxGeometry(3.0, 0.9, 0.04),
			this.track(
				lit({
					color: 0xcfd8dc,
					metalness: 0.85,
					roughness: 0.15,
				}),
			),
		);
		mirror.position.set(0, 1.6, -2.55);
		g.add(mirror);

		g.add(this.makeDoorSign(-0.1, -3.0, 'DAMES', '♀ 2 hokjes', '#ad1457'));
	}

	/**
	 * Ablution / wudu taps.
	 *
	 * Met zijn rug tegen de wand uit `wudu.against`, dus de hele nis staat een
	 * kwartslag gedraaid ten opzichte van de rest van het blok. De maten hieronder
	 * zijn daarom die van de nis zelf: `length` langs die wand, `depth` er vanaf.
	 * Het wereldmodel draait hetzelfde grondvlak uit dezelfde twee.
	 */
	private buildWudu(): void {
		const {
			against,
			offsetX,
			offsetZ,
			bench: benchSpec,
			basin: basinSpec,
			taps,
			water: waterSpec,
			sign: signSpec,
		} = RESTROOMS_INTERIOR.wudu;
		const g = new THREE.Group();
		g.position.set(offsetX, 0, offsetZ);
		g.rotation.y = BACK_TO_WALL_Y[against];
		this.group.add(g);

		const bench = new THREE.Mesh(
			new THREE.BoxGeometry(benchSpec.length, benchSpec.height, benchSpec.depth),
			this.track(lit({ color: 0x5d4037, roughness: 0.8 })),
		);
		bench.position.y = benchSpec.centerY;
		g.add(bench);

		// low foot-wash basin
		const basin = new THREE.Mesh(
			new THREE.BoxGeometry(basinSpec.length, basinSpec.height, basinSpec.depth),
			this.track(
				lit({
					color: 0x78909c,
					metalness: 0.5,
					roughness: 0.35,
				}),
			),
		);
		basin.position.set(0, basinSpec.centerY, 0);
		g.add(basin);

		const water = new THREE.Mesh(
			new THREE.BoxGeometry(waterSpec.length, waterSpec.thickness, waterSpec.depth),
			this.track(
				lit({
					color: 0x4fc3f7,
					transparent: true,
					opacity: 0.45,
					roughness: 0.1,
				}),
			),
		);
		water.position.set(0, waterSpec.y, 0);
		g.add(water);

		for (let i = 0; i < taps.count; i++) {
			const tap = new THREE.Mesh(
				new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8),
				this.track(
					lit({
						color: 0xb0bec5,
						metalness: 0.8,
						roughness: 0.25,
					}),
				),
			);
			tap.position.set((i - half(taps.count - 1)) * taps.spacing, taps.height, taps.reach);
			g.add(tap);
		}

		const { canvas: c, ctx } = labelCanvas(256, 64);
		ctx.fillStyle = '#0d47a1';
		ctx.fillRect(0, 0, 256, 64);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 22px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('WUDU / ABLUTIE', 128, 40);
		const tex = labelTexture(c);
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(signSpec.width, signSpec.height),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		sign.position.set(0, signSpec.y, signSpec.reach);
		sign.rotation.y = FACING_NORTH_Y;
		g.add(sign);
	}

	private makeUrinal(x: number, z: number): THREE.Group {
		const g = new THREE.Group();
		g.position.set(x, 0, z);
		g.rotation.y = FACING_NORTH_Y;
		const ceramic = this.track(
			lit({
				color: 0xf5f5f5,
				roughness: 0.25,
				metalness: 0.1,
			}),
		);
		// bowl
		const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), ceramic);
		bowl.scale.set(1, 1.15, 0.75);
		bowl.position.set(0, 0.55, 0.05);
		g.add(bowl);
		// backplate
		const plate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.55, 0.06), ceramic);
		plate.position.set(0, 0.85, -0.08);
		g.add(plate);
		// drain lip
		const lip = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.14), ceramic);
		lip.position.set(0, 0.38, 0.12);
		g.add(lip);
		// flush pipe
		const pipe = new THREE.Mesh(
			new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6),
			this.track(lit({ color: 0x90a4ae, metalness: 0.7, roughness: 0.3 })),
		);
		pipe.position.set(0, 1.15, -0.05);
		g.add(pipe);
		return g;
	}

	private makeStall(x: number, z: number, doorColor: number): THREE.Group {
		const g = new THREE.Group();
		g.position.set(x, 0, z);
		g.rotation.y = FACING_NORTH_Y;
		const panel = this.track(lit({ color: 0xcfd8dc, roughness: 0.6 }));
		// three walls of stall
		const back = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.06), panel);
		back.position.set(0, 1.0, -0.7);
		g.add(back);
		for (const sx of [-0.55, 0.55]) {
			const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.0, 1.4), panel);
			side.position.set(sx, 1.0, 0);
			g.add(side);
		}
		// door (ajar a bit)
		const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.85, 0.05), this.track(lit({ color: doorColor, roughness: 0.55 })));
		door.position.set(0.15, 0.95, 0.7);
		door.rotation.y = -0.35;
		g.add(door);
		// toilet
		const ceramic = this.track(lit({ color: 0xffffff, roughness: 0.3 }));
		const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.35, 12), ceramic);
		bowl.position.set(0, 0.35, -0.15);
		g.add(bowl);
		const seat = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 8, 16), ceramic);
		seat.rotation.x = Math.PI / 2;
		seat.position.set(0, 0.55, -0.15);
		g.add(seat);
		const tank = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.18), ceramic);
		tank.position.set(0, 0.85, -0.45);
		g.add(tank);
		return g;
	}

	private makeSink(x: number, z: number): THREE.Group {
		const g = new THREE.Group();
		g.position.set(x, 0, z);
		g.rotation.y = FACING_NORTH_Y;
		const ceramic = this.track(lit({ color: 0xfafafa, roughness: 0.3 }));
		const top = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.45), ceramic);
		top.position.y = 0.9;
		g.add(top);
		const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.12, 12), ceramic);
		bowl.position.set(0, 0.82, 0.02);
		g.add(bowl);
		const faucet = new THREE.Mesh(
			new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6),
			this.track(lit({ color: 0xb0bec5, metalness: 0.85, roughness: 0.2 })),
		);
		faucet.position.set(0, 1.1, -0.1);
		g.add(faucet);
		return g;
	}

	private makeDoorSign(x: number, z: number, title: string, sub: string, color: string): THREE.Mesh {
		const { canvas: c, ctx } = labelCanvas(256, 96);
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 256, 96);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 28px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(title, 128, 40);
		ctx.font = '16px system-ui,sans-serif';
		ctx.fillText(sub, 128, 70);
		const tex = labelTexture(c);
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(1.5, 0.55),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		mesh.position.set(x, 2.5, z);
		mesh.rotation.y = FACING_NORTH_Y;
		return mesh;
	}

	private buildCorridorSigns(): void {
		// Big wall-mounted WC bordjes on the facade (gendered, clear, boring mall energy)
		this.group.add(this.wallBoard(2.0, 3.05, -2.15, '♂ HEREN', 'urinoirs + toilet', '#0d47a1'));
		this.group.add(this.wallBoard(-2.0, 3.05, -2.15, '♀ DAMES', 'toiletten', '#880e4f'));
		// Classic square pictogram plates next to doors
		this.group.add(this.pictogram(2.0, 2.2, -2.95, '♂', '#1565c0'));
		this.group.add(this.pictogram(-2.0, 2.2, -2.95, '♀', '#c2185b'));

		// Overhead wayfinding strip
		const { canvas: c, ctx } = labelCanvas(512, 96);
		ctx.fillStyle = '#111827';
		ctx.fillRect(0, 0, 512, 96);
		ctx.fillStyle = '#22c55e';
		ctx.fillRect(0, 0, 8, 96);
		ctx.fillStyle = '#f8fafc';
		ctx.font = 'bold 28px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('TOILETTEN', 256, 40);
		ctx.font = '600 18px system-ui';
		ctx.fillStyle = '#94a3b8';
		ctx.fillText('HEREN  ·  DAMES  ·  gender apart', 256, 72);
		const tex = labelTexture(c);
		const strip = new THREE.Mesh(
			new THREE.PlaneGeometry(3.6, 0.7),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		strip.position.set(0, 2.95, -3.2);
		strip.rotation.y = FACING_NORTH_Y;
		this.group.add(strip);

		// Extra wall plates on left/right outer walls facing corridor
		this.group.add(this.sideWallPlate(4.02, 1.8, -0.5, 'WC', '♂', '#0d47a1', -1));
		this.group.add(this.sideWallPlate(-4.02, 1.8, -0.5, 'WC', '♀', '#880e4f', 1));
	}

	/** Flat board on the front (north) face */
	private wallBoard(x: number, y: number, z: number, title: string, sub: string, color: string): THREE.Mesh {
		const { canvas: c, ctx } = labelCanvas(320, 140);
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 320, 140);
		ctx.fillStyle = '#ffffff';
		ctx.font = 'bold 36px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(title, 160, 58);
		ctx.font = '20px system-ui,sans-serif';
		ctx.fillText(sub, 160, 100);
		const tex = labelTexture(c);
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(1.7, 0.75),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		mesh.position.set(x, y, z);
		mesh.rotation.y = FACING_NORTH_Y;
		return mesh;
	}

	private pictogram(x: number, y: number, z: number, symbol: string, color: string): THREE.Mesh {
		const { canvas: c, ctx } = labelCanvas(128, 128);
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 128, 128);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 72px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(symbol, 64, 68);
		const tex = labelTexture(c);
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(0.55, 0.55),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		mesh.position.set(x, y, z);
		mesh.rotation.y = FACING_NORTH_Y;
		return mesh;
	}

	/** Sign flush on outer side wall (face = ±1 for +X / −X) */
	private sideWallPlate(x: number, y: number, z: number, title: string, symbol: string, color: string, face: 1 | -1): THREE.Mesh {
		const { canvas: c, ctx } = labelCanvas(160, 200);
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 160, 200);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 56px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText(symbol, 80, 80);
		ctx.font = 'bold 32px system-ui';
		ctx.fillText(title, 80, 140);
		const tex = labelTexture(c);
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(0.7, 0.9),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide })),
		);
		mesh.position.set(x, y, z);
		mesh.rotation.y = face > 0 ? -Math.PI / 2 : Math.PI / 2;
		return mesh;
	}
}
