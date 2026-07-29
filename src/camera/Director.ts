import gsap from 'gsap';
import * as THREE from 'three';
import type { GraphNode } from '../data/graph';

export type DirectorMode = 'boot' | 'idle' | 'selected' | 'touring' | 'arrived';

/**
 * Eye-height beside the directory kiosk, looking into the mall.
 * Offset in X on purpose: dead centre puts the solid kiosk base 1.5 m in front
 * of your face, so step one of walking forward was walking into it.
 */
export const HOME_POS = new THREE.Vector3(3.4, 1.68, 13);
export const HOME_TARGET = new THREE.Vector3(2.2, 1.5, 3);

const EYE = 1.68;

/**
 * Cinematic camera: intro, store focus and the guided walk.
 *
 * It owns a plain look-at target — deliberately NOT OrbitControls. An orbit rig
 * re-seats the camera on a sphere around its target every frame, which is what
 * used to drag the view back towards the middle of the mall while walking.
 */
export class Director {
	mode: DirectorMode = 'boot';
	readonly target = new THREE.Vector3();
	private camera: THREE.PerspectiveCamera;
	private tourTween: gsap.core.Tween | null = null;
	private moveTween: gsap.core.Tween | null = null;
	private onArrive: (() => void) | null = null;

	constructor(camera: THREE.PerspectiveCamera) {
		this.camera = camera;
		camera.position.copy(HOME_POS);
		this.target.copy(HOME_TARGET);
		this.applyLook();
	}

	/** True while a tween owns the camera — the player must stay hands-off. */
	get busy(): boolean {
		return this.tourTween !== null || this.moveTween !== null;
	}

	startIdle(): void {
		this.mode = 'idle';
	}

	goHome(animated = true, onDone?: () => void): void {
		this.killTour();
		this.mode = 'idle';

		if (!animated) {
			this.camera.position.copy(HOME_POS);
			this.target.copy(HOME_TARGET);
			this.applyLook();
			onDone?.();
			return;
		}

		this.animateCamera(HOME_POS, HOME_TARGET, 1.2, onDone);
	}

	focusStore(pos: THREE.Vector3, onDone?: () => void): void {
		this.killTour();
		this.mode = 'selected';

		const toCenter = new THREE.Vector3(-pos.x, 0, -pos.z);
		if (toCenter.lengthSq() < 0.01) toCenter.set(0, 0, 1);
		toCenter.normalize();
		const stand = pos.clone().addScaledVector(toCenter, 6);
		stand.y = pos.y < 3 ? EYE : 6 + EYE;
		const target = pos.clone();
		target.y = stand.y;

		this.animateCamera(stand, target, 1.2, onDone);
	}

	/** First-person walk along the yellow path. */
	tourPath(nodes: GraphNode[], onArrive: () => void): void {
		this.killTour();
		this.mode = 'touring';
		this.onArrive = onArrive;

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
		this.target.copy(startLook);
		this.applyLook();

		this.tourTween = gsap.to(progress, {
			t: 1,
			duration,
			ease: 'none',
			onUpdate: () => {
				const t = progress.t;
				const p = curve.getPointAt(t);
				const look = curve.getPointAt(Math.min(1, t + 0.04));
				this.camera.position.lerp(p, 0.35);
				this.target.lerp(look, 0.35);
				this.applyLook();
			},
			onComplete: () => {
				this.tourTween = null;
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
					this.onArrive?.();
				});
			},
		});
	}

	stopTour(): void {
		this.killTour();
		this.mode = 'idle';
	}

	playIntro(onDone: () => void): void {
		this.mode = 'boot';

		// First frame: human height looking into the mall
		this.camera.position.set(3.4, EYE, 16.5);
		this.target.set(2.2, 1.5, 4);
		this.applyLook();

		this.animateCamera(HOME_POS, HOME_TARGET, 2.0, () => {
			this.startIdle();
			onDone();
		});
	}

	/** Only touches the camera while a tween is running. */
	update(_dt: number): void {
		if (this.busy) this.applyLook();
	}

	private applyLook(): void {
		this.camera.rotation.order = 'YXZ';
		this.camera.up.set(0, 1, 0);
		this.camera.lookAt(this.target);
	}

	private animateCamera(
		pos: THREE.Vector3,
		target: THREE.Vector3,
		duration: number,
		onComplete?: () => void,
	): void {
		this.moveTween?.kill();
		const fromPos = this.camera.position.clone();
		const fromTarget = this.target.clone();
		const state = { t: 0 };

		this.moveTween = gsap.to(state, {
			t: 1,
			duration,
			ease: 'power2.inOut',
			onUpdate: () => {
				const t = state.t;
				this.camera.position.lerpVectors(fromPos, pos, t);
				this.target.lerpVectors(fromTarget, target, t);
				this.applyLook();
			},
			onComplete: () => {
				this.moveTween = null;
				onComplete?.();
			},
		});
	}

	private killTour(): void {
		this.tourTween?.kill();
		this.tourTween = null;
		this.moveTween?.kill();
		this.moveTween = null;
	}
}
