import * as THREE from 'three';
import type { CollisionWorld } from '../physics/Collision';

const EYE = 1.65;
const SPEED = 5.5;
const RADIUS = 0.4;

/**
 * Normal mall navigation: WASD + mouse look (pointer lock optional).
 * OrbitControls should be disabled while this is active.
 */
export class PlayerControls {
	enabled = true;
	private keys = new Set<string>();
	private cam: THREE.PerspectiveCamera;
	private world: CollisionWorld;
	private yaw = 0;
	private pitch = 0;
	private dragging = false;
	private lastX = 0;
	private lastY = 0;
	private dom: HTMLElement;

	constructor(
		camera: THREE.PerspectiveCamera,
		dom: HTMLElement,
		world: CollisionWorld,
	) {
		this.cam = camera;
		this.dom = dom;
		this.world = world;
		// init yaw from camera
		const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
		this.yaw = e.y;
		this.pitch = e.x;

		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		dom.addEventListener('pointerdown', this.onPointerDown);
		window.addEventListener('pointerup', this.onPointerUp);
		window.addEventListener('pointermove', this.onPointerMove);
	}

	dispose(): void {
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		this.dom.removeEventListener('pointerdown', this.onPointerDown);
		window.removeEventListener('pointerup', this.onPointerUp);
		window.removeEventListener('pointermove', this.onPointerMove);
	}

	/** Sync yaw/pitch from external camera (after intro / tour) */
	syncFromCamera(): void {
		const e = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
		this.yaw = e.y;
		this.pitch = e.x;
	}

	update(dt: number): void {
		if (!this.enabled) return;

		const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
		const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		const move = new THREE.Vector3();
		if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.add(forward);
		if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.sub(forward);
		if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.sub(right);
		if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.add(right);

		if (move.lengthSq() > 0) {
			move.normalize().multiplyScalar(SPEED * dt);
			const p = this.cam.position;
			// floor stick: 0 or 6 based on height
			const floorY = p.y < 4 ? EYE : 6 + EYE;
			p.y = THREE.MathUtils.lerp(p.y, floorY, 0.15);
			p.x += move.x;
			p.z += move.z;
			const r = this.world.resolveCircle(p.x, p.z, p.y, RADIUS);
			p.x = r.x;
			p.z = r.z;
		}

		this.cam.rotation.order = 'YXZ';
		this.cam.rotation.y = this.yaw;
		this.cam.rotation.x = this.pitch;
	}

	private onKeyDown = (e: KeyboardEvent): void => {
		this.keys.add(e.code);
	};
	private onKeyUp = (e: KeyboardEvent): void => {
		this.keys.delete(e.code);
	};
	private onPointerDown = (e: PointerEvent): void => {
		if (!this.enabled) return;
		// only when left button and not clicking UI
		if (e.button !== 0) return;
		this.dragging = true;
		this.lastX = e.clientX;
		this.lastY = e.clientY;
	};
	private onPointerUp = (): void => {
		this.dragging = false;
	};
	private onPointerMove = (e: PointerEvent): void => {
		if (!this.dragging || !this.enabled) return;
		const dx = e.clientX - this.lastX;
		const dy = e.clientY - this.lastY;
		this.lastX = e.clientX;
		this.lastY = e.clientY;
		this.yaw -= dx * 0.004;
		this.pitch -= dy * 0.003;
		this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
	};
}
