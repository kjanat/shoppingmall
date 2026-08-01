import * as THREE from 'three';
import type { GraphNode } from '@/data/graph';
import { at } from '@/util/rand';

/**
 * Solid mall-directory floor path — yellow tape style.
 * No animated shaders, no additive glow pulse (those caused flicker).
 */
export class PathMesh {
	readonly group = new THREE.Group();
	private mesh: THREE.Mesh | null = null;
	private arrows: THREE.Group | null = null;

	constructor() {
		this.group.visible = false;
	}

	setPath(nodes: GraphNode[]): void {
		this.clear();
		if (nodes.length < 2) return;

		const points = nodes.map((n) => new THREE.Vector3(n.x, n.y + 0.05, n.z));
		const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
		const samples = curve.getPoints(Math.max(40, nodes.length * 12));

		this.mesh = this.buildRibbon(samples, 0.7);
		this.arrows = this.buildArrows(curve);

		this.group.add(this.mesh);
		this.group.add(this.arrows);
		this.group.visible = true;
	}

	clear(): void {
		while (this.group.children.length) {
			const c = at(this.group.children, 0);
			this.group.remove(c);
			if (c instanceof THREE.Mesh) {
				c.geometry.dispose();
				(c.material as THREE.Material).dispose();
			} else if (c instanceof THREE.Group) {
				c.traverse((obj) => {
					if (obj instanceof THREE.Mesh) {
						obj.geometry.dispose();
						(obj.material as THREE.Material).dispose();
					}
				});
			}
		}
		this.mesh = null;
		this.arrows = null;
		this.group.visible = false;
	}

	update(_dt: number): void {
		// Static path — no animation = no flicker
	}

	private buildRibbon(samples: THREE.Vector3[], width: number): THREE.Mesh {
		const half = width / 2;
		const positions: number[] = [];
		const uvs: number[] = [];
		const indices: number[] = [];
		const up = new THREE.Vector3(0, 1, 0);

		for (let i = 0; i < samples.length; i++) {
			const p = at(samples, i);
			const tangent =
				i < samples.length - 1
					? at(samples, i + 1)
							.clone()
							.sub(p)
							.normalize()
					: p
							.clone()
							.sub(at(samples, i - 1))
							.normalize();
			const side = new THREE.Vector3().crossVectors(up, tangent).normalize();
			if (side.lengthSq() < 0.001) side.set(1, 0, 0);

			const l = p.clone().addScaledVector(side, half);
			const r = p.clone().addScaledVector(side, -half);
			positions.push(l.x, l.y, l.z, r.x, r.y, r.z);
			const u = i / (samples.length - 1);
			uvs.push(u, 0, u, 1);

			if (i < samples.length - 1) {
				const base = i * 2;
				indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
			}
		}

		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
		geo.setIndex(indices);
		geo.computeVertexNormals();

		// Solid directory yellow — MeshBasic so it stays readable, no bloom dance
		const mat = new THREE.MeshBasicMaterial({
			color: 0xf5c518,
			transparent: true,
			opacity: 0.92,
			depthWrite: false,
			side: THREE.DoubleSide,
			toneMapped: false,
		});

		return new THREE.Mesh(geo, mat);
	}

	private buildArrows(curve: THREE.CatmullRomCurve3): THREE.Group {
		const g = new THREE.Group();
		const count = 8;
		const geo = new THREE.ConeGeometry(0.2, 0.4, 6);
		geo.rotateX(Math.PI / 2);
		const mat = new THREE.MeshBasicMaterial({
			color: 0xe8a200,
			toneMapped: false,
		});

		for (let i = 1; i < count; i++) {
			const t = i / count;
			const p = curve.getPointAt(t);
			const tangent = curve.getTangentAt(t).normalize();
			const mesh = new THREE.Mesh(geo, mat);
			mesh.position.copy(p);
			mesh.position.y += 0.15;
			mesh.lookAt(p.clone().add(tangent));
			g.add(mesh);
		}
		return g;
	}
}
