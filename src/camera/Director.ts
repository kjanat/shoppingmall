import gsap from 'gsap';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GraphNode } from '../data/graph';

export type DirectorMode = 'boot' | 'idle' | 'selected' | 'touring' | 'arrived';

/** Eye-height at the directory kiosk, looking into the mall. */
export const HOME_POS = new THREE.Vector3(0, 1.65, 12.5);
export const HOME_TARGET = new THREE.Vector3(0, 1.45, 2);

const EYE = 1.65;

/**
 * First-person mall navigator — you walk the route, not fly above the ceiling.
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
		this.applyFpControlsLimits();
		camera.position.copy(HOME_POS);
		controls.target.copy(HOME_TARGET);
		controls.update();
	}

	startIdle(): void {
		this.mode = 'idle';
		this.applyFpControlsLimits();
		this.controls.enabled = true;
	}

	goHome(animated = true, onDone?: () => void): void {
		this.killTour();
		this.mode = 'idle';
		this.controls.enabled = false;
		this.applyFpControlsLimits();

		if (!animated) {
			this.camera.position.copy(HOME_POS);
			this.controls.target.copy(HOME_TARGET);
			this.controls.update();
			this.controls.enabled = true;
			onDone?.();
			return;
		}

		this.animateCamera(HOME_POS, HOME_TARGET, 1.2, () => {
			this.controls.enabled = true;
			onDone?.();
		});
	}

	focusStore(pos: THREE.Vector3, onDone?: () => void): void {
		this.killTour();
		this.mode = 'selected';
		this.controls.enabled = false;

		const toCenter = new THREE.Vector3(-pos.x, 0, -pos.z);
		if (toCenter.lengthSq() < 0.01) toCenter.set(0, 0, 1);
		toCenter.normalize();
		const stand = pos.clone().addScaledVector(toCenter, 6);
		stand.y = pos.y < 3 ? EYE : 6 + EYE;
		const target = pos.clone();
		target.y = stand.y;

		this.animateCamera(stand, target, 1.2, () => {
			this.controls.enabled = true;
			onDone?.();
		});
	}

	/** First-person walk along the yellow path. */
	tourPath(nodes: GraphNode[], onArrive: () => void): void {
		this.killTour();
		this.mode = 'touring';
		this.onArrive = onArrive;
		this.controls.enabled = false;

		if (nodes.length < 2) {
			onArrive();
			return;
		}

		const points = nodes.map(
			(n) => new THREE.Vector3(n.x, n.y + EYE - 0.15, n.z),
		);
		const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.3);
		const progress = { t: 0 };
		const pathLen = curve.getLength();
		const duration = Math.max(10, Math.min(28, pathLen * 0.22));

		const start = curve.getPointAt(0);
		const startLook = curve.getPointAt(0.02);
		this.camera.position.copy(start);
		this.controls.target.copy(startLook);
		this.controls.update();

		this.tourTween = gsap.to(progress, {
			t: 1,
			duration,
			ease: 'none',
			onUpdate: () => {
				const t = progress.t;
				const p = curve.getPointAt(t);
				const look = curve.getPointAt(Math.min(1, t + 0.04));
				this.camera.position.lerp(p, 0.35);
				this.controls.target.lerp(look, 0.35);
				this.controls.update();
			},
			onComplete: () => {
				const end = points[points.length - 1];
				const prev = points[Math.max(0, points.length - 2)];
				const dir = end.clone().sub(prev);
				dir.y = 0;
				if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
				dir.normalize();

				let settle = end.clone().addScaledVector(dir, -1.2);
				settle.y = end.y;
				let target = end.clone().addScaledVector(dir, 3);
				target.y = end.y;

				const lastId = nodes[nodes.length - 1]?.id;
				if (lastId === 'spaceship') {
					settle = end.clone().add(new THREE.Vector3(0.5, 0, 1.5));
					settle.y = 6 + EYE;
					target = end.clone().add(new THREE.Vector3(0, 5, 0));
				}

				this.animateCamera(settle, target, 1.2, () => {
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

		// First frame: human height looking into the mall
		this.camera.position.set(0, 1.65, 16);
		this.controls.target.set(0, 1.5, 4);
		this.controls.update();

		this.animateCamera(HOME_POS, HOME_TARGET, 2.0, () => {
			this.startIdle();
			onDone();
		});
	}

	update(_dt: number): void {
		if (this.mode === 'idle' || this.mode === 'selected' || this.mode === 'arrived') {
			this.controls.update();
		}
	}

	private applyFpControlsLimits(): void {
		this.controls.minDistance = 0.5;
		this.controls.maxDistance = 8;
		this.controls.minPolarAngle = Math.PI * 0.25;
		this.controls.maxPolarAngle = Math.PI * 0.58;
		this.controls.enablePan = false;
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
