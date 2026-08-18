/**
 * Zonecull voor alles wat níét in een batch zit.
 *
 * SceneBatcher voegt samen wat samen te voegen valt, en dat is bij lange na niet
 * het hele beeld: een groep van één mesh, een InstancedMesh, een sprite of een
 * puntenwolk gaat er ongemoeid langs en tekent zijn eigen draw call. Vanaf de
 * stoep was 338 batches tegen ruim vierhonderd losse objecten, dus een cull die
 * alleen op batches werkt verandert vrijwel niets aan het aantal draws.
 *
 * Zichtbaarheid gaat via `layers` en niet via `visible`, precies zoals de batcher
 * zijn bronmeshes uitschakelt: `visible` heeft bij een spraakballon, een verborgen
 * prop of een gepossedeerde sim al een eigenaar, en die twee zouden om de beurt
 * winnen. Een laagmasker van nul haalt het object uit elke camera, de schaduwcamera
 * meegerekend, zonder dat de spelregels eromheen iets merken.
 */
import type { Object3D, Scene } from 'three';
import { BatchedMesh, Box3, Line, Mesh, Points, Sphere, Sprite, Vector3 } from 'three';
import { zoneMaskAround, zoneMaskOfBounds } from '#/data/zones';
import { ownerName } from '#/render/sceneOwner';
import type { ZoneCuller, ZoneOwnerTally } from '#/render/ZoneCuller';

interface Occupant {
	object: Object3D;
	/** Het laagmasker dat het object zelf koos; hersteld zodra het weer mag. */
	layers: number;
	radius: number;
	dynamic: boolean;
	zoneMask: number;
	/** Zones die het object verklaart bovenop wat zijn doos raakt; zie `tagZoneSpan`. */
	declared: number;
	sphere: Sphere;
	/** De feature die dit object bouwde, en zijn regel in de cull-telling. */
	ownerName: string;
	casts: boolean;
	tally: ZoneOwnerTally | null;
}

/** Zones die een object verklaart bovenop de zones die zijn eigen doos raakt. */
const zoneSpans = new WeakMap<Object3D, number>();

/**
 * Verklaar dat dit object óók bij deze zones hoort, buiten de zones die zijn doos
 * raakt.
 *
 * Een bord op de mond van de roltrap staat met zijn hele lichaam op V0, maar het
 * hangt aan een connector die V0 en V1 verbindt en hoort vanaf beide dekken te zien
 * te zijn. Zonder deze verklaring valt het weg zodra de camerazone naar V1 klapt
 * terwijl de camera nog onder de V1-plaat de schacht in kijkt: geen enkele
 * V1→V0-portaalkegel dekt het dan, en het verdwijnt terwijl je er recht naar kijkt.
 */
function tagZoneSpan(object: Object3D, mask: number): void {
	zoneSpans.set(object, (zoneSpans.get(object) ?? 0) | mask);
}

/** De zones die dit object bovenop zijn doos verklaart; 0 als het niets verklaarde. */
function zoneSpanOf(object: Object3D): number {
	return zoneSpans.get(object) ?? 0;
}

/** Wat één feature aan losse objecten in de scene heeft staan. */
interface OccupantOwnerStats {
	name: string;
	occupants: number;
	casters: number;
}

interface ZoneVisibilityStats {
	occupants: number;
	dynamic: number;
	hidden: number;
	owners: readonly OccupantOwnerStats[];
}

const SCAN_BOX = new Box3();
const SCAN_MIN = new Vector3();
const SCAN_MAX = new Vector3();
const WORLD_POSITION = new Vector3();

function renderable(object: Object3D): boolean {
	if (object instanceof BatchedMesh) return false;
	return object instanceof Mesh || object instanceof Sprite || object instanceof Points || object instanceof Line;
}

/**
 * De straal om de wereldpositie van het object heen die zijn hele lichaam dekt.
 *
 * Om de wereldpositie en niet om het midden van zijn doos: een geanimeerd lid
 * verschuift dat midden per frame en de straal moet dan alsnog kloppen. Ruim is
 * hier goed, want te krap laat geometrie verdwijnen die er wel degelijk staat.
 */
function occupantRadius(object: Object3D): number {
	SCAN_BOX.setFromObject(object, true);
	if (SCAN_BOX.isEmpty()) return 0;
	object.getWorldPosition(WORLD_POSITION);
	SCAN_MIN.copy(SCAN_BOX.min).sub(WORLD_POSITION);
	SCAN_MAX.copy(SCAN_BOX.max).sub(WORLD_POSITION);
	return Math.max(SCAN_MIN.length(), SCAN_MAX.length());
}

/**
 * De zones die het object werkelijk beslaat, uit zijn wereldsdoos.
 *
 * `SCAN_BOX` staat er nog van `occupantRadius`, dus dit is dezelfde meting. Een
 * bol om een vloerplaat heen zou de hele stad claimen; de doos claimt één dek.
 */
function scannedZoneMask(): number {
	if (SCAN_BOX.isEmpty()) return 0;
	return zoneMaskOfBounds({
		minX: SCAN_BOX.min.x,
		maxX: SCAN_BOX.max.x,
		minY: SCAN_BOX.min.y,
		maxY: SCAN_BOX.max.y,
		minZ: SCAN_BOX.min.z,
		maxZ: SCAN_BOX.max.z,
	});
}

class ZoneVisibility {
	private readonly ownerRows: OccupantOwnerStats[] = [];
	readonly stats: ZoneVisibilityStats = { occupants: 0, dynamic: 0, hidden: 0, owners: this.ownerRows };
	private readonly occupants: Occupant[] = [];

	/**
	 * Loop de scene af zoals hij er na het batchen bij ligt.
	 *
	 * Ná SceneBatcher, want die zet het laagmasker van elke bron die hij overnam op
	 * nul en die bronnen tekenen dus toch al niets; ze horen hier niet nog eens
	 * geteld te worden.
	 */
	constructor(scene: Scene, dynamicRoots: readonly Object3D[]) {
		const dynamic = new WeakSet<Object3D>();
		for (const root of dynamicRoots) root.traverse((object) => dynamic.add(object));
		const ownerIndex = new Map<string, OccupantOwnerStats>();
		scene.traverse((object) => {
			if (!renderable(object) || object.layers.mask === 0) return;
			const radius = occupantRadius(object);
			const declared = zoneSpanOf(object);
			const zoneMask = scannedZoneMask() | declared;
			object.getWorldPosition(WORLD_POSITION);
			const name = ownerName(object);
			const owner = ownerIndex.get(name) ?? { name, occupants: 0, casters: 0 };
			owner.occupants++;
			if (object.castShadow) owner.casters++;
			if (!ownerIndex.has(name)) {
				ownerIndex.set(name, owner);
				this.ownerRows.push(owner);
			}
			this.occupants.push({
				object,
				layers: object.layers.mask,
				radius,
				dynamic: dynamic.has(object),
				zoneMask,
				declared,
				sphere: new Sphere(WORLD_POSITION.clone(), radius),
				ownerName: name,
				casts: object.castShadow,
				tally: null,
			});
		});
		this.stats.occupants = this.occupants.length;
		this.stats.dynamic = this.occupants.filter((occupant) => occupant.dynamic).length;
	}

	/**
	 * Zet de zonecull op de scene zoals hij nu staat.
	 *
	 * Roep hem aan na `SceneBatcher.update()`: dat is wat de wereldmatrices van de
	 * bewegende wortels ververst, en zonder die verversing staat een bewegende sim
	 * hier op zijn plek van vorig frame.
	 */
	apply(culler: ZoneCuller): void {
		let hidden = 0;
		for (const occupant of this.occupants) {
			if (occupant.dynamic) {
				occupant.object.getWorldPosition(WORLD_POSITION);
				occupant.sphere.center.copy(WORLD_POSITION);
				occupant.zoneMask =
					zoneMaskAround(WORLD_POSITION.x, WORLD_POSITION.y, WORLD_POSITION.z, occupant.radius) | occupant.declared;
			}
			const shown = culler.accepts(occupant.zoneMask, occupant.sphere);
			occupant.object.layers.mask = shown ? occupant.layers : 0;
			occupant.tally ??= culler.owner(occupant.ownerName);
			culler.charge(occupant.tally, shown, 1, occupant.casts ? 1 : 0);
			if (!shown) hidden++;
		}
		this.stats.hidden = hidden;
	}

	/** Alles weer aan, wat de zones ook zeggen. */
	showAll(): void {
		for (const occupant of this.occupants) occupant.object.layers.mask = occupant.layers;
		this.stats.hidden = 0;
	}
}

export { tagZoneSpan, zoneSpanOf, ZoneVisibility };
export type { OccupantOwnerStats, ZoneVisibilityStats };
