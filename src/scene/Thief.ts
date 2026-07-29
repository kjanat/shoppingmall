import * as THREE from 'three';
import type { CollisionWorld } from '../physics/Collision';

/**
 * Long baker-beard guy who sprints through after enough shop transactions
 * and yeets everyone's juwelen/goud (coin burst).
 */
export class BakerThief {
	readonly group = new THREE.Group();
	active = false;
	private mesh: THREE.Group;
	private t = 0;
	private path: THREE.Vector3[] = [];
	private i = 0;
	private world: CollisionWorld;
	private onLoot: ((pos: THREE.Vector3) => void) | null = null;

	constructor(world: CollisionWorld) {
		this.world = world;
		this.mesh = this.build();
		this.mesh.visible = false;
		this.group.add(this.mesh);
	}

	setLootCallback(cb: (pos: THREE.Vector3) => void): void {
		this.onLoot = cb;
	}

	/** Fire the heist across the mall */
	trigger(): void {
		this.active = true;
		this.mesh.visible = true;
		this.i = 0;
		this.t = 0;
		// Visible sprint path (avoid atrium void on floor 1)
		this.path = [
			new THREE.Vector3(-28, 0, 12),
			new THREE.Vector3(-10, 0, 8),
			new THREE.Vector3(10, 0, -6),
			new THREE.Vector3(22, 0, 6),
			new THREE.Vector3(22, 6, -4),
			new THREE.Vector3(14, 6, -10),
			new THREE.Vector3(0, 6, -12),
			new THREE.Vector3(-14, 6, 10),
			new THREE.Vector3(0, 6, 16),
		];
		this.mesh.position.copy(this.path[0]);
		this.mesh.visible = true;
		this.active = true;
	}

	update(dt: number): void {
		if (!this.active || this.i >= this.path.length - 1) {
			if (this.active && this.i >= this.path.length - 1) {
				this.active = false;
				this.mesh.visible = false;
			}
			return;
		}

		const a = this.path[this.i];
		const b = this.path[this.i + 1];
		this.t += dt * 2.8; // sprint
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

	private build(): THREE.Group {
		const g = new THREE.Group();
		const skin = new THREE.MeshStandardMaterial({ color: 0xe8b896, roughness: 0.85 });
		const shirt = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 });
		const pants = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.85 });
		const beardMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.95 });
		const gold = new THREE.MeshStandardMaterial({
			color: 0xffd700,
			metalness: 0.9,
			roughness: 0.25,
		});

		const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.7, 4, 8), shirt);
		body.position.y = 1.1;
		g.add(body);
		const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.45, 3, 6), pants);
		const legR = legL.clone();
		legL.position.set(-0.12, 0.4, 0);
		legR.position.set(0.12, 0.4, 0);
		g.add(legL, legR);
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), skin);
		head.position.y = 1.7;
		g.add(head);

		// LONG baker beard
		const beard = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.85, 8), beardMat);
		beard.position.set(0, 1.25, 0.12);
		beard.rotation.x = Math.PI;
		g.add(beard);
		const beard2 = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 6), beardMat);
		beard2.position.set(0, 0.95, 0.18);
		beard2.rotation.x = Math.PI;
		g.add(beard2);

		// sack of juwelen
		const sack = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), gold);
		sack.position.set(0.35, 1.0, 0);
		g.add(sack);

		// name plate
		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 64;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = 'rgba(0,0,0,0.85)';
		ctx.fillRect(0, 0, 256, 64);
		ctx.fillStyle = '#ffd700';
		ctx.font = 'bold 22px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('BAARD-DIEF 💀', 128, 40);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sp = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: tex, transparent: true }),
		);
		sp.scale.set(2.2, 0.55, 1);
		sp.position.y = 2.4;
		g.add(sp);

		return g;
	}
}
