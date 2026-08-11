import * as THREE from 'three';
import type { CollisionWorld } from '#/physics/Collision';
import type { LightPool } from '#/render/LightPool';
import { ConAdult } from '#/scene/con/ConAdult';
import { ConTechno } from '#/scene/con/ConTechno';
import { ConVenue } from '#/scene/con/ConVenue';
import { FursuitCrowd } from '#/scene/con/FursuitCrowd';
import { disposeFurMats } from '#/scene/con/FursuitKit';

/**
 * Prairie Fur Con — thin orchestrator.
 *
 * Venue (static) · Crowd (instanced) · Adult (age-gated) · Techno (audio clock).
 * Collision / zone plan live in conWorld + conPlan.
 */
export class FurryCon {
	readonly group = new THREE.Group();

	private readonly venue: ConVenue;
	private readonly crowd: FursuitCrowd;
	private readonly adult: ConAdult;
	private readonly techno = new ConTechno();

	constructor(pool: LightPool, world: CollisionWorld) {
		this.group.name = 'furry_con';
		this.venue = new ConVenue(pool);
		this.crowd = new FursuitCrowd();
		this.adult = new ConAdult(pool, world);

		this.group.add(this.venue.group);
		this.group.add(this.crowd.group);
		this.group.add(this.adult.group);
		// Door always visible in SFW space; adult content stays behind unlock.
		const door = this.adult.doorMesh;
		if (door) this.group.add(door);
		this.group.add(this.adult.doorSign);
	}

	get plazaSpot(): THREE.Vector3 {
		return this.venue.plazaSpot;
	}
	get dealersSpot(): THREE.Vector3 {
		return this.venue.dealersSpot;
	}
	get stageSpot(): THREE.Vector3 {
		return this.venue.stageSpot;
	}
	get filmCam(): THREE.PerspectiveCamera {
		return this.adult.filmCam;
	}
	get filming(): boolean {
		return this.adult.filming;
	}
	get joinAnchor(): THREE.Vector3 | null {
		return this.adult.joinAnchor;
	}
	get ageModalOpen(): boolean {
		return this.adult.ageModalOpen;
	}

	update(dt: number, t: number, viewer: THREE.Vector3): void {
		this.venue.update(t);
		this.crowd.update(dt, t);
		this.adult.update(dt, viewer);
		this.techno.update(viewer);
	}

	unlockAudio(): void {
		this.techno.unlock();
	}

	nearestScene(viewer: THREE.Vector3): object | null {
		return this.adult.nearestScene(viewer) ? this.adult : null;
	}

	tryJoin(viewer: THREE.Vector3): boolean {
		return this.adult.tryJoin(viewer);
	}

	tryLeaveScene(): boolean {
		return this.adult.tryLeave();
	}

	toggleFilm(viewer: THREE.Vector3): boolean {
		return this.adult.toggleFilm(viewer);
	}

	dispose(): void {
		this.venue.dispose();
		this.crowd.dispose();
		this.adult.dispose();
		this.techno.dispose();
		disposeFurMats();
	}
}
