import * as THREE from 'three';
import type { CollisionWorld } from '../physics/Collision';

/**
 * Mall rat — scurries like the baard-dief, but smaller & more often.
 */
export class MallRat {
	readonly group = new THREE.Group();
	active = false;
	private mesh: THREE.Group;
	private t = 0;
	private i = 0;
	private path: THREE.Vector3[] = [];
	private cd = 18;
	private world: CollisionWorld;
	private materials: THREE.Material[] = [];

	constructor(world: CollisionWorld) {
		this.world = world;
		this.mesh = this.build();
		this.mesh.visible = false;
		this.group.add(this.mesh);
		this.group.name = 'mallRat';
	}

	trigger(): void {
		this.active = true;
		this.mesh.visible = true;
		this.i = 0;
		this.t = 0;
		// Floor 0 scurries — avoid fountain
		const routes = [
			[
				new THREE.Vector3(-24, 0.05, 14),
				new THREE.Vector3(-12, 0.05, 10),
				new THREE.Vector3(0, 0.05, 8),
				new THREE.Vector3(12, 0.05, 12),
				new THREE.Vector3(24, 0.05, 6),
				new THREE.Vector3(20, 0.05, -8),
				new THREE.Vector3(4, 0.05, -12),
				new THREE.Vector3(-18, 0.05, -8),
				new THREE.Vector3(-26, 0.05, 4),
			],
			[
				new THREE.Vector3(26, 0.05, -10),
				new THREE.Vector3(10, 0.05, -6),
				new THREE.Vector3(-6, 0.05, 4),
				new THREE.Vector3(-20, 0.05, 0),
				new THREE.Vector3(-16, 0.05, 12),
				new THREE.Vector3(0, 0.05, 14),
				new THREE.Vector3(18, 0.05, 8),
			],
		];
		this.path = routes[Math.floor(Math.random() * routes.length)];
		this.mesh.position.copy(this.path[0]);
	}

	update(dt: number): void {
		this.cd -= dt;
		if (!this.active && this.cd <= 0) {
			if (Math.random() < 0.55) this.trigger();
			this.cd = 22 + Math.random() * 40;
		}
		if (!this.active) return;
		if (this.i >= this.path.length - 1) {
			this.active = false;
			this.mesh.visible = false;
			return;
		}
		const a = this.path[this.i];
		const b = this.path[this.i + 1];
		this.t += dt * 1.35; // faster than thief
		if (this.t >= 1) {
			this.t = 0;
			this.i++;
			if (this.i >= this.path.length - 1) return;
		}
		const p = a.clone().lerp(b, this.t);
		const r = this.world.resolveCircle(p.x, p.z, 0.2, 0.2);
		p.x = r.x;
		p.z = r.z;
		this.mesh.position.set(p.x, 0.06 + Math.abs(Math.sin(performance.now() * 0.04)) * 0.04, p.z);
		const dir = b.clone().sub(a);
		if (dir.lengthSq() > 0.01) this.mesh.rotation.y = Math.atan2(dir.x, dir.z);
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private build(): THREE.Group {
		const g = new THREE.Group();
		const fur = this.track(new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 }));
		const pink = this.track(new THREE.MeshStandardMaterial({ color: 0xf8a0a0, roughness: 0.7 }));
		const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), fur);
		body.scale.set(1.4, 0.85, 1.1);
		body.position.y = 0.12;
		g.add(body);
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), fur);
		head.position.set(0, 0.14, 0.16);
		g.add(head);
		const snout = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), pink);
		snout.position.set(0, 0.12, 0.24);
		g.add(snout);
		const earL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), pink);
		const earR = earL.clone();
		earL.position.set(-0.06, 0.2, 0.14);
		earR.position.set(0.06, 0.2, 0.14);
		g.add(earL, earR);
		// tail
		const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.008, 0.35, 6), pink);
		tail.rotation.x = Math.PI / 2.4;
		tail.position.set(0, 0.12, -0.22);
		g.add(tail);
		// beady eyes
		const eye = this.track(new THREE.MeshBasicMaterial({ color: 0x111111 }));
		const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), eye);
		const e2 = e1.clone();
		e1.position.set(-0.035, 0.16, 0.22);
		e2.position.set(0.035, 0.16, 0.22);
		g.add(e1, e2);
		return g;
	}
}
