import { CatmullRomCurve3, Vector3 } from 'three';
import type { Bounds3, InteractionEmitter, SpatialVolume, Vec3 } from '#/data/spatial';
import { geometryBounds } from '#/data/spatial';
import { ROOF_SLIDE_ENTITY } from '#/data/world';
import { clamp01 } from '#/util/math';

/** Waar het oog van een glijder boven de as van de buis zit. */
const SEAT_EYE = 0.55;
/** Hoever de rit vooruit kijkt, in meters langs de bocht. */
const LOOK_AHEAD = 1;

/** Het loopvlak van een buisdeel, zoals de emitter erboven het aanwijst. */
type SlideFlow = Readonly<{ start: Vec3; end: Vec3 }>;

function rampOf(volume: SpatialVolume | undefined, emitter: InteractionEmitter): SlideFlow {
	if (!volume) throw new Error(`slide: ${emitter.id} wijst naar volume ${emitter.sourceVolumeId}, dat er niet is`);
	if (volume.geometry.kind !== 'ramp') throw new Error(`slide: ${volume.id} is geen loopvlak maar ${volume.geometry.kind}`);
	return { start: volume.geometry.start, end: volume.geometry.end };
}

function flowSpeed(emitter: InteractionEmitter): number {
	const field = emitter.field;
	if (field.kind !== 'surface') throw new Error(`slide: ${emitter.id} draagt geen loopvlakstroming maar ${field.kind}`);
	return Math.hypot(field.vector.x, field.vector.y, field.vector.z);
}

/**
 * De rit door de glijbaan, gelezen uit het wereldmodel.
 *
 * De bocht is de aaneenschakeling van de loopvlakken die de conveyor-emitters van
 * `roof-slide` aanwijzen, en de vaart is de lengte van hun stroming.
 */
export class SlideRide {
	readonly curve: CatmullRomCurve3;
	/** m/s langs de bocht. */
	readonly speed: number;
	/** Booglengte van de hele bocht. */
	readonly length: number;

	private readonly entry: Bounds3;

	constructor() {
		const entity = ROOF_SLIDE_ENTITY;
		const flows = entity.emitters
			.filter((emitter) => emitter.channel === 'conveyor')
			.map((emitter) => ({
				emitter,
				ramp: rampOf(
					entity.volumes.find((volume) => volume.id === emitter.sourceVolumeId),
					emitter,
				),
			}));
		const first = flows[0];
		if (!first) throw new Error(`slide: ${entity.id} heeft geen enkel loopvlak dat je meeneemt`);
		const entry = entity.volumes.find((volume) => volume.tags.includes('slide-entry'));
		if (!entry) throw new Error(`slide: ${entity.id} heeft geen instappunt`);

		this.entry = geometryBounds(entry.geometry);
		this.speed = flowSpeed(first.emitter);
		this.curve = new CatmullRomCurve3([
			new Vector3(first.ramp.start.x, first.ramp.start.y, first.ramp.start.z),
			...flows.map(({ ramp }) => new Vector3(ramp.end.x, ramp.end.y, ramp.end.z)),
		]);
		this.length = this.curve.getLength();
	}

	/** Staat dit lichaam in het instappunt, dus neemt de buis het mee? */
	accepts(x: number, y: number, z: number): boolean {
		return (
			x > this.entry.minX &&
			x < this.entry.maxX &&
			z > this.entry.minZ &&
			z < this.entry.maxZ &&
			y > this.entry.minY &&
			y < this.entry.maxY
		);
	}

	/** Het punt op de bocht na zoveel meter glijden. */
	pointAt(distance: number, out: Vector3): Vector3 {
		return this.curve.getPointAt(clamp01(distance / this.length), out);
	}

	/** Ooghoogte op diezelfde plek. */
	seatAt(distance: number, out: Vector3): Vector3 {
		this.pointAt(distance, out);
		out.y += SEAT_EYE;
		return out;
	}

	/** Waar de glijder naar kijkt: een stuk verder de bocht in. */
	aheadOf(distance: number, out: Vector3): Vector3 {
		return this.pointAt(distance + LOOK_AHEAD, out);
	}
}
