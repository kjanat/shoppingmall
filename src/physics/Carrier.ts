import type { InteractionReceiver, Mobility } from '#/data/spatial';
import type { MallWorldEntity } from '#/data/world';

/**
 * De cabine draagt wat erin staat. ELEVATOR_ENTITY declareert dat al via
 * `kinematics.carriesTargets`, maar alleen de speler had er een uitvoering
 * voor: het schoonmaakkarretje bleef op het dek achter terwijl de cabine
 * vertrok, en de eerste fix daarvoor was een losse App-helper voor precies
 * dat ene object. Dit is de policy-vorm: de entiteit zegt óf er gedragen
 * wordt, de receiver zegt wíe meedoet, en niemand wordt bij naam genoemd.
 */
export type Carriable = Readonly<{
	id: string;
	receiver: InteractionReceiver;
	position: () => Readonly<{ x: number; y: number; z: number }>;
	setFloor: (y: number | null) => void;
}>;

/** Zo ver mag iets onder of boven de cabinevloer zitten en nog aan boord zijn. */
const BOARD_SLACK = 1.8;

const CARRY_MOBILITY: readonly Mobility[] = ['kinematic', 'dynamic', 'character'];

function eligible(receiver: InteractionReceiver): boolean {
	return (
		CARRY_MOBILITY.includes(receiver.mobility) &&
		receiver.channels.includes('linear-displacement') &&
		receiver.responses.translation === 'constrain-to-surface'
	);
}

export class CabinCarrier {
	private readonly riders: Carriable[] = [];
	private readonly carries: boolean;

	constructor(
		entity: MallWorldEntity,
		private readonly cabinFloorY: () => number,
		private readonly containsXZ: (x: number, z: number) => boolean,
	) {
		this.carries = entity.kinematics.kind === 'linear-path' && entity.kinematics.carriesTargets;
	}

	/** Een receiver die het contract niet draagt wordt stil geweigerd: geen kanaal, geen lift. */
	register(rider: Carriable): void {
		if (eligible(rider.receiver)) this.riders.push(rider);
	}

	update(): void {
		if (!this.carries) return;
		const floor = this.cabinFloorY();
		for (const rider of this.riders) {
			const p = rider.position();
			rider.setFloor(this.containsXZ(p.x, p.z) && Math.abs(p.y - floor) < BOARD_SLACK ? floor : null);
		}
	}
}
