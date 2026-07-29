import gsap from 'gsap';
import * as THREE from 'three';
import type { GraphNode } from '../data/graph';

export type DirectorMode = 'boot' | 'idle' | 'selected' | 'touring' | 'arrived';

export class Director {
	mode: DirectorMode = 'boot';
	private camera: THREE.PerspectiveCamera;
	private idleAngle = 0;
	private idleRadius = 38;
	private idleHeight = 22;
	private tourTween: gsap.core.Tween | null = null;
	private onArrive: (() => void) | null = null;
	private lookAt = new THREE.Vector3(0, 2, 0);
	private manual = false;

	constructor(camera: THREE.PerspectiveCamera) {
		this.camera = camera;
		camera.position.set(0, 28, 42);
		camera.lookAt(0, 2, 0);
	}

	startIdle(): void {
		this.mode = 'idle';
		this.manual = false;
	}

	/** Soft focus when a store is selected */
	focusStore(pos: THREE.Vector3, onDone?: () => void): void {
		this.killTour();
		this.mode = 'selected';
		const dest = pos.clone().add(new THREE.Vector3(6, 8, 10));
		gsap.to(this.camera.position, {
			x: dest.x,
			y: dest.y,
			z: dest.z,
			duration: 1.4,
			ease: 'power2.inOut',
		});
		gsap.to(this.lookAt, {
			x: pos.x,
			y: pos.y + 1.5,
			z: pos.z,
			duration: 1.4,
			ease: 'power2.inOut',
			onComplete: onDone,
		});
	}

	/** Cinematic fly-along path */
	tourPath(nodes: GraphNode[], onArrive: () => void): void {
		this.killTour();
		this.mode = 'touring';
		this.onArrive = onArrive;
		this.manual = false;

		if (nodes.length < 2) {
			onArrive();
			return;
		}

		const points = nodes.map((n) => new THREE.Vector3(n.x, n.y + 0.1, n.z));
		const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);

		// Elevate camera above path with look-ahead
		const progress = { t: 0 };
		const duration = Math.max(8, Math.min(22, nodes.length * 1.6));

		this.tourTween = gsap.to(progress, {
			t: 1,
			duration,
			ease: 'power1.inOut',
			onUpdate: () => {
				const t = progress.t;
				const p = curve.getPointAt(t);
				const lookT = Math.min(1, t + 0.06);
				const look = curve.getPointAt(lookT);
				const tangent = curve.getTangentAt(t).normalize();

				// Camera offset: up and slightly back
				const side = new THREE.Vector3()
					.crossVectors(tangent, new THREE.Vector3(0, 1, 0))
					.normalize();
				const camPos = p
					.clone()
					.add(new THREE.Vector3(0, 3.2, 0))
					.addScaledVector(tangent, -2.5)
					.addScaledVector(side, 0.4);

				this.camera.position.lerp(camPos, 0.25);
				this.lookAt.lerp(look.clone().add(new THREE.Vector3(0, 1.2, 0)), 0.25);
			},
			onComplete: () => {
				// Settle in front of destination
				const end = points[points.length - 1];
				const prev = points[points.length - 2] ?? end.clone().add(new THREE.Vector3(0, 0, 4));
				const dir = end.clone().sub(prev).normalize();
				const settle = end.clone().add(new THREE.Vector3(0, 3.5, 0)).addScaledVector(dir, -7);

				gsap.to(this.camera.position, {
					x: settle.x,
					y: settle.y,
					z: settle.z,
					duration: 1.5,
					ease: 'power2.out',
				});
				gsap.to(this.lookAt, {
					x: end.x,
					y: end.y + 2,
					z: end.z,
					duration: 1.5,
					ease: 'power2.out',
					onComplete: () => {
						this.mode = 'arrived';
						this.onArrive?.();
					},
				});
			},
		});
	}

	stopTour(): void {
		this.killTour();
		this.mode = 'idle';
	}

	setManualOrbit(enabled: boolean): void {
		this.manual = enabled;
	}

	/** Called from OrbitControls when user drags in idle */
	notifyUserControl(): void {
		if (this.mode === 'idle') this.manual = true;
	}

	resumeIdleOrbit(): void {
		if (this.mode === 'idle') {
			this.manual = false;
			// sync angle from current camera
			this.idleAngle = Math.atan2(this.camera.position.x, this.camera.position.z);
		}
	}

	update(dt: number): void {
		if (this.mode === 'idle' && !this.manual) {
			this.idleAngle += dt * 0.08;
			const x = Math.sin(this.idleAngle) * this.idleRadius;
			const z = Math.cos(this.idleAngle) * this.idleRadius;
			const y = this.idleHeight + Math.sin(this.idleAngle * 0.5) * 1.5;
			this.camera.position.lerp(new THREE.Vector3(x, y, z), 0.03);
			this.lookAt.lerp(new THREE.Vector3(0, 3, 0), 0.03);
		}

		if (this.mode === 'boot') {
			// handled by intro tween
		}

		this.camera.lookAt(this.lookAt);
	}

	playIntro(onDone: () => void): void {
		this.mode = 'boot';
		this.camera.position.set(0, 45, 5);
		this.lookAt.set(0, 0, 0);
		gsap.to(this.camera.position, {
			x: 0,
			y: 22,
			z: 38,
			duration: 3.2,
			ease: 'power2.inOut',
		});
		gsap.to(this.lookAt, {
			x: 0,
			y: 2,
			z: 0,
			duration: 3.2,
			ease: 'power2.inOut',
			onComplete: () => {
				this.startIdle();
				onDone();
			},
		});
	}

	private killTour(): void {
		this.tourTween?.kill();
		this.tourTween = null;
	}
}
