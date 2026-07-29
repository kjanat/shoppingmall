import gsap from 'gsap';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GraphNode } from '../data/graph';

export type DirectorMode = 'boot' | 'idle' | 'selected' | 'touring' | 'arrived';

/** Clear overview of the whole mall — default home view. */
export const HOME_POS = new THREE.Vector3(0, 42, 52);
export const HOME_TARGET = new THREE.Vector3(0, 3, 0);

/**
 * Camera director that stays in sync with OrbitControls.
 * Never fights the user: idle does NOT auto-orbit.
 * Overview-first so you always know what you're looking at.
 */
export class Director {
	mode: DirectorMode = 'boot';
	private camera: THREE.PerspectiveCamera;
	private controls: OrbitControls;
	private tourTween: gsap.core.Tween | null = null;
	private moveTween: gsap.core.Tween | null = null;
	private onArrive: (() => void) | null = null;

	constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
		this.camera = camera;
		this.controls = controls;
		camera.position.copy(HOME_POS);
		controls.target.copy(HOME_TARGET);
		controls.update();
	}

	startIdle(): void {
		this.mode = 'idle';
		this.controls.enabled = true;
	}

	/** Jump / ease back to readable overview. */
	goHome(animated = true, onDone?: () => void): void {
		this.killTour();
		this.mode = 'idle';
		this.controls.enabled = false;

		if (!animated) {
			this.camera.position.copy(HOME_POS);
			this.controls.target.copy(HOME_TARGET);
			this.controls.update();
			this.controls.enabled = true;
			onDone?.();
			return;
		}

		this.animateCamera(HOME_POS, HOME_TARGET, 1.4, () => {
			this.controls.enabled = true;
			onDone?.();
		});
	}

	focusStore(pos: THREE.Vector3, onDone?: () => void): void {
		this.killTour();
		this.mode = 'selected';
		this.controls.enabled = false;

		// High angled overview of the store — never clip into walls
		const dest = new THREE.Vector3(pos.x + 10, pos.y + 14, pos.z + 16);
		// Prefer camera that stays outside mall center
		if (Math.abs(dest.z) < 8) dest.z = pos.z >= 0 ? pos.z + 18 : pos.z - 18;

		const target = pos.clone().add(new THREE.Vector3(0, 1.2, 0));
		this.animateCamera(dest, target, 1.3, () => {
			this.controls.enabled = true;
			this.controls.maxDistance = 90;
			onDone?.();
		});
	}

	/**
	 * Elevated “drone tour” along the path — high enough to read the mall,
	 * not a claustrophobic corridor crawl into darkness.
	 */
	tourPath(nodes: GraphNode[], onArrive: () => void): void {
		this.killTour();
		this.mode = 'touring';
		this.onArrive = onArrive;
		this.controls.enabled = false;

		if (nodes.length < 2) {
			onArrive();
			return;
		}

		const points = nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z));
		const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
		const progress = { t: 0 };
		const duration = Math.max(7, Math.min(16, nodes.length * 1.25));

		// Height above path so floors/stores stay visible
		const height = 11;
		const back = 6;

		this.tourTween = gsap.to(progress, {
			t: 1,
			duration,
			ease: 'none',
			onUpdate: () => {
				const t = progress.t;
				const p = curve.getPointAt(t);
				const lookT = Math.min(1, t + 0.08);
				const look = curve.getPointAt(lookT);
				const tangent = curve.getTangentAt(Math.min(0.999, t)).normalize();

				const camPos = p
					.clone()
					.add(new THREE.Vector3(0, height, 0))
					.addScaledVector(tangent, -back);

				this.camera.position.lerp(camPos, 0.18);
				this.controls.target.lerp(look.clone().add(new THREE.Vector3(0, 1.5, 0)), 0.18);
				this.controls.update();
			},
			onComplete: () => {
				const end = points[points.length - 1];
				const prev = points[Math.max(0, points.length - 2)];
				const dir = end.clone().sub(prev).normalize();
				if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);

				const settle = end
					.clone()
					.add(new THREE.Vector3(0, 9, 0))
					.addScaledVector(dir, -12);
				const target = end.clone().add(new THREE.Vector3(0, 2, 0));

				this.animateCamera(settle, target, 1.4, () => {
					this.mode = 'arrived';
					this.controls.enabled = true;
					this.onArrive?.();
				});
			},
		});
	}

	stopTour(): void {
		this.killTour();
		this.mode = 'idle';
		this.controls.enabled = true;
	}

	playIntro(onDone: () => void): void {
		this.mode = 'boot';
		this.controls.enabled = false;

		// Start further out so the whole building reads immediately
		this.camera.position.set(0, 70, 80);
		this.controls.target.set(0, 2, 0);
		this.controls.update();

		this.animateCamera(HOME_POS, HOME_TARGET, 2.4, () => {
			this.startIdle();
			onDone();
		});
	}

	/** Called each frame only to keep controls happy — no forced lookAt fight. */
	update(_dt: number): void {
		// OrbitControls owns the camera in idle/selected/arrived
		if (this.mode === 'idle' || this.mode === 'selected' || this.mode === 'arrived') {
			this.controls.update();
		}
	}

	private animateCamera(
		pos: THREE.Vector3,
		target: THREE.Vector3,
		duration: number,
		onComplete?: () => void,
	): void {
		this.moveTween?.kill();
		const fromPos = this.camera.position.clone();
		const fromTarget = this.controls.target.clone();
		const state = { t: 0 };

		this.moveTween = gsap.to(state, {
			t: 1,
			duration,
			ease: 'power2.inOut',
			onUpdate: () => {
				const t = state.t;
				this.camera.position.lerpVectors(fromPos, pos, t);
				this.controls.target.lerpVectors(fromTarget, target, t);
				this.controls.update();
			},
			onComplete,
		});
	}

	private killTour(): void {
		this.tourTween?.kill();
		this.tourTween = null;
		this.moveTween?.kill();
		this.moveTween = null;
	}
}
