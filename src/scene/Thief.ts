import { CapsuleGeometry, ConeGeometry, Group, Mesh, SphereGeometry, Sprite, SpriteMaterial, Vector3 } from 'three';
import { levelY } from '#/data/levels';
import { BEARD_CAVE_SPEC } from '#/data/world';
import type { CollisionWorld } from '#/physics/Collision';
import { lit } from '#/render/material';
import { labelCanvas, labelTexture } from '#/util/label';
import { at } from '#/util/rand';
import type { BeardCave } from './BeardCave';

// ── heist ────────────────────────────────────────────────
/** Path segments per second — slow heist, you can actually see it. */
const SPRINT_SPEED = 0.5;

/**
 * Long baker-beard guy who sprints through after enough shop transactions
 * and yeets everyone's juwelen/goud — then dumps it in Beard-man's Cave.
 */
export class BakerThief {
	readonly group = new Group();
	active = false;
	private mesh: Group;
	private t = 0;
	private path: Vector3[] = [];
	private i = 0;
	private world: CollisionWorld;
	private onLoot: ((pos: Vector3) => void) | null = null;
	private onHome: ((pos: Vector3) => void) | null = null;
	private caveHome = new Vector3(BEARD_CAVE_SPEC.entrance.x, levelY('v0'), BEARD_CAVE_SPEC.entrance.z);
	private homeReported = false;
	private lingerT = 0;

	constructor(world: CollisionWorld, cave?: BeardCave) {
		this.world = world;
		if (cave) this.caveHome.copy(cave.entrance);
		this.mesh = this.build();
		this.mesh.visible = false;
		this.group.add(this.mesh);
	}

	setLootCallback(cb: (pos: Vector3) => void): void {
		this.onLoot = cb;
	}

	/** Fired once when the thief reaches the cave with the sack */
	setHomeCallback(cb: (pos: Vector3) => void): void {
		this.onHome = cb;
	}

	/** Fire the heist across the mall → home to the cave */
	trigger(): void {
		this.active = true;
		this.mesh.visible = true;
		this.i = 0;
		this.t = 0;
		this.homeReported = false;
		this.lingerT = 0;
		// Visible sprint path (avoid atrium void on floor 1), end at beard cave
		this.path = [
			new Vector3(22, 0, 6),
			new Vector3(10, 0, -6),
			new Vector3(-10, 0, 8),
			new Vector3(14, 0, 10),
			new Vector3(22, 6, -4),
			new Vector3(0, 6, -12),
			new Vector3(-14, 6, 10),
			new Vector3(-22, 0, 4),
			new Vector3(-28, 0, 14),
			this.caveHome.clone(),
		];
		this.mesh.position.copy(at(this.path, 0));
		this.mesh.visible = true;
		this.active = true;
	}

	update(dt: number): void {
		if (!this.active || this.i >= this.path.length - 1) {
			if (this.active && this.i >= this.path.length - 1) {
				if (!this.homeReported) {
					this.homeReported = true;
					this.mesh.position.copy(this.caveHome);
					this.onHome?.(this.mesh.position.clone());
				}
				// Linger a beat in the cave, then vanish into the hoard
				this.lingerT += dt;
				if (this.lingerT > 1.4) {
					this.active = false;
					this.mesh.visible = false;
				}
			}
			return;
		}

		const a = at(this.path, this.i);
		const b = at(this.path, this.i + 1);
		this.t += dt * SPRINT_SPEED;
		if (this.t >= 1) {
			this.t = 0;
			this.i++;
			this.onLoot?.(this.mesh.position.clone());
			if (this.i >= this.path.length - 1) return;
		}
		const p = a.clone().lerp(b, this.t);
		const r = this.world.resolveCircle(p.x, p.z, p.y + 1, 0.4);
		p.x = r.x;
		p.z = r.z;
		this.mesh.position.copy(p);
		const dir = b.clone().sub(a);
		if (dir.lengthSq() > 0.01) {
			this.mesh.rotation.y = Math.atan2(dir.x, dir.z);
		}
		// run bob
		this.mesh.position.y = p.y + Math.abs(Math.sin(performance.now() * 0.02)) * 0.12;
	}

	private build(): Group {
		const g = new Group();
		const skin = lit({ color: 0xe8b896, roughness: 0.85 });
		const shirt = lit({ color: 0xf5f5f5, roughness: 0.9 });
		const pants = lit({ color: 0x1a1a2e, roughness: 0.85 });
		const beardMat = lit({ color: 0x3e2723, roughness: 0.95 });
		const gold = lit({
			color: 0xffd700,
			metalness: 0.9,
			roughness: 0.25,
		});

		const body = new Mesh(new CapsuleGeometry(0.28, 0.7, 4, 8), shirt);
		body.position.y = 1.1;
		g.add(body);
		const legL = new Mesh(new CapsuleGeometry(0.1, 0.45, 3, 6), pants);
		const legR = legL.clone();
		legL.position.set(-0.12, 0.4, 0);
		legR.position.set(0.12, 0.4, 0);
		g.add(legL, legR);
		const head = new Mesh(new SphereGeometry(0.22, 10, 10), skin);
		head.position.y = 1.7;
		g.add(head);

		// LONG baker beard
		const beard = new Mesh(new ConeGeometry(0.2, 0.85, 8), beardMat);
		beard.position.set(0, 1.25, 0.12);
		beard.rotation.x = Math.PI;
		g.add(beard);
		const beard2 = new Mesh(new ConeGeometry(0.12, 0.5, 6), beardMat);
		beard2.position.set(0, 0.95, 0.18);
		beard2.rotation.x = Math.PI;
		g.add(beard2);

		// sack of juwelen
		const sack = new Mesh(new SphereGeometry(0.28, 8, 8), gold);
		sack.position.set(0.35, 1.0, 0);
		g.add(sack);

		// name plate
		const { canvas: c, ctx } = labelCanvas(256, 64);
		ctx.fillStyle = 'rgba(0,0,0,0.85)';
		ctx.fillRect(0, 0, 256, 64);
		ctx.fillStyle = '#ffd700';
		ctx.font = 'bold 22px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('BAARD-DIEF 💀', 128, 40);
		const tex = labelTexture(c);
		const sp = new Sprite(new SpriteMaterial({ map: tex, transparent: true }));
		sp.scale.set(2.2, 0.55, 1);
		sp.position.y = 2.4;
		g.add(sp);

		return g;
	}
}
