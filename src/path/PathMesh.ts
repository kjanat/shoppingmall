import * as THREE from 'three';
import type { GraphNode } from '../data/graph';

/**
 * Glowing neon ribbon along a waypoint path.
 * Uses a tube-like ribbon of quads slightly above the floor + animated dash UVs.
 */
export class PathMesh {
	readonly group = new THREE.Group();
	private mesh: THREE.Mesh | null = null;
	private glow: THREE.Mesh | null = null;
	private arrows: THREE.Group | null = null;
	private material: THREE.ShaderMaterial | null = null;
	private glowMat: THREE.MeshBasicMaterial | null = null;
	private time = 0;
	private visible = false;

	constructor() {
		this.group.visible = false;
	}

	setPath(nodes: GraphNode[]): void {
		this.clear();
		if (nodes.length < 2) return;

		const points = nodes.map((n) => new THREE.Vector3(n.x, n.y + 0.04, n.z));
		// densify for smoother ribbon
		const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
		const samples = curve.getPoints(Math.max(40, nodes.length * 12));

		this.mesh = this.buildRibbon(samples, 0.55, false);
		this.glow = this.buildRibbon(samples, 1.4, true);
		this.arrows = this.buildArrows(curve);

		this.group.add(this.glow);
		this.group.add(this.mesh);
		this.group.add(this.arrows);
		this.group.visible = true;
		this.visible = true;
	}

	clear(): void {
		while (this.group.children.length) {
			const c = this.group.children[0];
			this.group.remove(c);
			if (c instanceof THREE.Mesh) {
				c.geometry.dispose();
				if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
				else c.material.dispose();
			} else if (c instanceof THREE.Group) {
				c.traverse((obj) => {
					if (obj instanceof THREE.Mesh) {
						obj.geometry.dispose();
						if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
						else obj.material.dispose();
					}
				});
			}
		}
		this.mesh = null;
		this.glow = null;
		this.arrows = null;
		this.material = null;
		this.glowMat = null;
		this.group.visible = false;
		this.visible = false;
	}

	update(dt: number): void {
		if (!this.visible || !this.material) return;
		this.time += dt;
		this.material.uniforms.uTime.value = this.time;
		if (this.glowMat) {
			this.glowMat.opacity = 0.12 + Math.sin(this.time * 2.5) * 0.04;
		}
		if (this.arrows) {
			this.arrows.children.forEach((a, i) => {
				a.position.y = 0.12 + Math.sin(this.time * 3 + i * 0.6) * 0.03;
			});
		}
	}

	private buildRibbon(samples: THREE.Vector3[], width: number, isGlow: boolean): THREE.Mesh {
		const half = width / 2;
		const positions: number[] = [];
		const uvs: number[] = [];
		const indices: number[] = [];

		let totalLen = 0;
		const seglens: number[] = [0];
		for (let i = 1; i < samples.length; i++) {
			totalLen += samples[i].distanceTo(samples[i - 1]);
			seglens.push(totalLen);
		}

		const up = new THREE.Vector3(0, 1, 0);
		for (let i = 0; i < samples.length; i++) {
			const p = samples[i];
			const tangent = i < samples.length - 1
				? samples[i + 1].clone().sub(p).normalize()
				: p.clone().sub(samples[i - 1]).normalize();
			const side = new THREE.Vector3().crossVectors(up, tangent).normalize();
			if (side.lengthSq() < 0.001) side.set(1, 0, 0);

			const l = p.clone().addScaledVector(side, half);
			const r = p.clone().addScaledVector(side, -half);
			positions.push(l.x, l.y, l.z, r.x, r.y, r.z);

			const u = totalLen > 0 ? seglens[i] / totalLen : 0;
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

		if (isGlow) {
			this.glowMat = new THREE.MeshBasicMaterial({
				color: 0x00ffc8,
				transparent: true,
				opacity: 0.15,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
			});
			return new THREE.Mesh(geo, this.glowMat);
		}

		this.material = new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.AdditiveBlending,
			uniforms: {
				uTime: { value: 0 },
				uColor: { value: new THREE.Color(0x00ffc8) },
				uColor2: { value: new THREE.Color(0x00a8ff) },
			},
			vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
			fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uColor2;
        varying vec2 vUv;
        void main() {
          float dash = fract(vUv.x * 18.0 - uTime * 1.8);
          float band = smoothstep(0.0, 0.15, dash) * smoothstep(0.55, 0.35, dash);
          float edge = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
          float core = pow(1.0 - abs(vUv.y - 0.5) * 2.0, 2.0);
          vec3 col = mix(uColor, uColor2, vUv.x);
          float alpha = (band * 0.85 + core * 0.35) * edge;
          gl_FragColor = vec4(col, alpha);
        }
      `,
		});

		return new THREE.Mesh(geo, this.material);
	}

	private buildArrows(curve: THREE.CatmullRomCurve3): THREE.Group {
		const g = new THREE.Group();
		const count = 10;
		const geo = new THREE.ConeGeometry(0.18, 0.45, 6);
		geo.rotateX(Math.PI / 2);
		const mat = new THREE.MeshStandardMaterial({
			color: 0x00ffc8,
			emissive: 0x00ffc8,
			emissiveIntensity: 2.5,
			transparent: true,
			opacity: 0.9,
		});

		for (let i = 1; i < count; i++) {
			const t = i / count;
			const p = curve.getPointAt(t);
			const tangent = curve.getTangentAt(t).normalize();
			const mesh = new THREE.Mesh(geo, mat);
			mesh.position.copy(p);
			mesh.position.y += 0.12;
			mesh.lookAt(p.clone().add(tangent));
			g.add(mesh);
		}
		return g;
	}
}
