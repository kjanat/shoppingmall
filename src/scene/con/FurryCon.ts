import * as THREE from 'three';
import type { CollisionWorld } from '#/physics/Collision';
import type { LightPool } from '#/render/LightPool';
import { ConAdult } from '#/scene/con/ConAdult';
import { ConPlay, type ConPlayResult } from '#/scene/con/ConPlay';
import { ConTechno } from '#/scene/con/ConTechno';
import { ConVenue } from '#/scene/con/ConVenue';
import { FursuitCrowd } from '#/scene/con/FursuitCrowd';
import { disposeFurMats } from '#/scene/con/FursuitKit';

/**
 * Prairie Fur Con — venue + crowd + play hooks + adult + techno.
 */
export class FurryCon {
	readonly group = new THREE.Group();

	private readonly venue: ConVenue;
	private readonly crowd: FursuitCrowd;
	private readonly play: ConPlay;
	private readonly adult: ConAdult;
	private readonly techno = new ConTechno();
	private pendingScore: ConPlayResult | null = null;

	constructor(pool: LightPool, world: CollisionWorld) {
		this.group.name = 'furry_con';
		this.venue = new ConVenue(pool);
		this.crowd = new FursuitCrowd();
		this.play = new ConPlay();
		this.adult = new ConAdult(pool, world);

		this.group.add(this.venue.group);
		this.group.add(this.crowd.group);
		this.group.add(this.play.group);
		this.group.add(this.adult.group);
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
		return this.adult.joinAnchor ?? this.play.joinAnchor;
	}
	get ageModalOpen(): boolean {
		return this.adult.ageModalOpen;
	}

	onLot(viewer: THREE.Vector3): boolean {
		return this.play.onLot(viewer);
	}

	activityHint(viewer: THREE.Vector3): string | null {
		const adult = this.adult.nearestScene(viewer);
		if (adult) return this.adult.filming ? 'F · stop film / E join' : 'E · join scene · F film (studio)';
		return this.play.activityHint(viewer);
	}

	update(dt: number, t: number, viewer: THREE.Vector3): void {
		this.venue.update(t);
		this.crowd.update(dt, t);
		this.adult.update(dt, viewer);
		this.techno.update(viewer);
		const tick = this.play.update(dt, viewer);
		if (tick) this.pendingScore = tick;
	}

	/** Drain score event from dance ticks / etc. */
	consumeScoreEvent(): ConPlayResult | null {
		const e = this.pendingScore;
		this.pendingScore = null;
		return e;
	}

	unlockAudio(): void {
		this.techno.unlock();
	}

	/** True if E would do something at the con (SFW or adult). */
	canInteract(viewer: THREE.Vector3): boolean {
		return this.play.inRange(viewer) || this.adult.nearestScene(viewer);
	}

	nearestScene(viewer: THREE.Vector3): object | null {
		return this.adult.nearestScene(viewer) ? this.adult : null;
	}

	/** Primary E action: play spots first, then adult join. */
	tryInteract(viewer: THREE.Vector3): ConPlayResult | null {
		if (this.adult.tryJoin(viewer)) {
			return { status: 'Joined scene · Esc to leave (+3)', scoreDelta: 3 };
		}
		return this.play.tryUse(viewer);
	}

	tryJoin(viewer: THREE.Vector3): boolean {
		return this.adult.tryJoin(viewer);
	}

	tryLeaveScene(): boolean {
		if (this.play.tryLeave()) return true;
		return this.adult.tryLeave();
	}

	toggleFilm(viewer: THREE.Vector3): boolean {
		return this.adult.toggleFilm(viewer);
	}

	dispose(): void {
		this.venue.dispose();
		this.crowd.dispose();
		this.play.dispose();
		this.adult.dispose();
		this.techno.dispose();
		disposeFurMats();
	}
}
