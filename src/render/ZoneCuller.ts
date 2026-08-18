/**
 * Zone- en portaalculling voor het tekenwerk.
 *
 * De zonegraaf zegt wélke zones vanaf hier te zien zijn; dit zegt hoevéél ervan.
 * Een buurzone is alleen te zien door de opening ertussen, dus geldt daar niet de
 * camerakegel maar de camerakegel afgesneden op die opening. Vanaf de stoep is de
 * hoofdingang vijf meter breed op zeventien meter afstand, en wat daar niet
 * doorheen past hoeft niet getekend en niet beschaduwd te worden.
 *
 * De afsnijding gaat via het NDC-rechthoekje van de opening en niet via een
 * silhouet: de vlakken van een frustum liggen al vast op precies die vorm, dus een
 * rechthoek in NDC is een geldig frustum en three's eigen boltest werkt erop. Het
 * rechthoekje komt van de ribben van de opening, elk afgeknipt op het beeldvlak,
 * en niet van zijn hoekpunten: een hoekpunt achter je heeft geen NDC. Sta je in de
 * opening, dan lopen die ribben tot buiten het beeld en klemt het rechthoekje op
 * het hele scherm, wat klopt. Ligt de opening áchter je, dan is er niets van over
 * en vervalt de kegel, wat óók klopt en wat de vorige versie niet deed: die gaf
 * dan de hele camerakegel terug en cullde daarmee vanaf de stoep helemaal niets.
 */
import type { Camera, Sphere } from 'three';
import { Box3, Frustum, Matrix4, Vector3 } from 'three';
import type { ZoneId } from '#/data/zones';
import { isOpenToSky, portalsFrom, SKY_ZONES_MASK, visibleZonesMask, ZONES, zoneBit, zoneVolume } from '#/data/zones';

/** Achter dit clip-w ligt een hoekpunt op of achter het beeldvlak en telt het niet mee. */
const MIN_CLIP_W = 1e-4;

interface Cone {
	/** De zones aan de andere kant van dit portaal. */
	zones: number;
	frustum: Frustum;
}

interface Rect {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

const CORNERS: readonly (readonly [keyof Rect3, keyof Rect3, keyof Rect3])[] = [
	['minX', 'minY', 'minZ'],
	['minX', 'minY', 'maxZ'],
	['minX', 'maxY', 'minZ'],
	['minX', 'maxY', 'maxZ'],
	['maxX', 'minY', 'minZ'],
	['maxX', 'minY', 'maxZ'],
	['maxX', 'maxY', 'minZ'],
	['maxX', 'maxY', 'maxZ'],
];

/**
 * De twaalf ribben van de doos, als paren in `CORNERS`.
 *
 * Twee hoekpunten liggen op één rib als ze in precies één van hun drie keuzes
 * verschillen, en dat is hier goedkoper uit te rekenen dan uit te schrijven.
 */
const EDGES: readonly (readonly [number, number])[] = (() => {
	const pairs: [number, number][] = [];
	for (let a = 0; a < CORNERS.length; a++) {
		for (let b = a + 1; b < CORNERS.length; b++) {
			const first = CORNERS[a];
			const second = CORNERS[b];
			if (!(first && second)) continue;
			let different = 0;
			for (let axis = 0; axis < 3; axis++) {
				if (first[axis] !== second[axis]) different++;
			}
			if (different === 1) pairs.push([a, b]);
		}
	}
	return pairs;
})();

interface Rect3 {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	minZ: number;
	maxZ: number;
}

/** Eén hoekpunt in klipruimte. `w` onder `MIN_CLIP_W` ligt op of achter het beeldvlak. */
interface ClipPoint {
	x: number;
	y: number;
	w: number;
}

const CLIP_POINTS: ClipPoint[] = CORNERS.map(() => ({ x: 0, y: 0, w: 0 }));

/**
 * Wat de cull op dit standpunt met één eigenaar deed.
 *
 * `items` en `casters` zijn totalen en worden bij het opbouwen van de scene gemeld,
 * niet per frame geteld: met de cull uit telt niemand mee, en zonder die totalen is
 * een lege regel niet te onderscheiden van een eigenaar die volledig verdween.
 *
 * De schaduwtelling staat er los in omdat de schaduwpass een tweede lijst objecten
 * tekent. Wat de cull wegneemt verdwijnt uit allebei, dus `castersKept` is wat een
 * standpunt nog aan de zon aanbiedt.
 */
interface ZoneOwnerTally {
	name: string;
	items: number;
	casters: number;
	kept: number;
	hidden: number;
	castersKept: number;
	castersHidden: number;
}

interface ZoneCullStats {
	zone: ZoneId;
	visibleZones: number;
	cones: number;
	batches: number;
	hidden: number;
	/**
	 * Waaróm iets bleef staan. Zonder deze twee is een cull die te ruime zones
	 * gebruikt niet te onderscheiden van een cull waarvan de bollen te grof zijn, en
	 * die twee vragen om een tegenovergestelde ingreep.
	 */
	keptInOwnZone: number;
	keptThroughCone: number;
	owners: readonly ZoneOwnerTally[];
}

/** De doos van elke begrensde zone, één keer omgezet naar het type dat three test. */
const ZONE_BOXES: ReadonlyMap<ZoneId, Box3> = new Map(
	ZONES.flatMap((zone) => {
		const volume = zoneVolume(zone);
		if (volume === null) return [];
		const box = new Box3(new Vector3(volume.minX, volume.minY, volume.minZ), new Vector3(volume.maxX, volume.maxY, volume.maxZ));
		return [[zone, box] as const];
	}),
);

class ZoneCuller {
	private readonly ownerRows: ZoneOwnerTally[] = [];
	private readonly ownerIndex = new Map<string, ZoneOwnerTally>();
	readonly stats: ZoneCullStats = {
		zone: 'stad',
		visibleZones: 0,
		cones: 0,
		batches: 0,
		hidden: 0,
		keptInOwnZone: 0,
		keptThroughCone: 0,
		owners: this.ownerRows,
	};
	private readonly cameraFrustum = new Frustum();
	private readonly viewProjection = new Matrix4();
	private readonly cones: Cone[] = [];
	private coneCount = 0;
	private ownBit = 0;
	private visibleMask = 0;

	/**
	 * Zet de kegels voor dit frame op. Roep hem aan nadat de camera zijn
	 * wereldmatrix heeft: hij leest die matrix, hij zet hem niet.
	 */
	update(camera: Camera, zone: ZoneId): void {
		this.ownBit = zoneBit(zone);
		this.visibleMask = visibleZonesMask(zone);
		this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		this.cameraFrustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem);
		this.coneCount = 0;
		// Over de dakrand is geen opening nodig: twee zones onder de open lucht zien
		// elkaar zonder gat ertussen. De kegel is dan de doos van de zone zelf, en de
		// volle camerakegel alleen naar de stad, die nergens ophoudt.
		if (isOpenToSky(zone)) {
			for (const sky of ZONES) {
				const bit = zoneBit(sky);
				if ((SKY_ZONES_MASK & bit) === 0 || bit === this.ownBit) continue;
				const volume = zoneVolume(sky);
				if (volume === null) this.pushCone(bit).copy(this.cameraFrustum);
				else this.addPortalCone(volume, bit);
			}
		}
		for (const face of portalsFrom(zone)) {
			this.addPortalCone(face.aperture, zoneBit(face.to));
		}
		this.stats.zone = zone;
		this.stats.visibleZones = this.visibleMask;
		this.stats.cones = this.coneCount;
		this.stats.batches = 0;
		this.stats.hidden = 0;
		this.stats.keptInOwnZone = 0;
		this.stats.keptThroughCone = 0;
		for (const owner of this.ownerRows) {
			owner.kept = 0;
			owner.hidden = 0;
			owner.castersKept = 0;
			owner.castersHidden = 0;
		}
	}

	/** De regel van deze eigenaar, aangemaakt zodra hij voor het eerst genoemd wordt. */
	owner(name: string): ZoneOwnerTally {
		const known = this.ownerIndex.get(name);
		if (known) return known;
		const row: ZoneOwnerTally = { name, items: 0, casters: 0, kept: 0, hidden: 0, castersKept: 0, castersHidden: 0 };
		this.ownerIndex.set(name, row);
		this.ownerRows.push(row);
		return row;
	}

	/** Meld wat deze eigenaar te tekenen heeft, en hoeveel daarvan schaduw werpt. */
	declareOwner(name: string, items: number, casters: number): void {
		const tally = this.owner(name);
		tally.items += items;
		tally.casters += casters;
	}

	/**
	 * Schrijf één beslissing op de eigenaar.
	 *
	 * Los van `accepts`, want een batch draagt de bronnen van meerdere eigenaren en
	 * krijgt één zichtbaarheid; hoe die over hen verdeeld is weet alleen de beller.
	 */
	charge(tally: ZoneOwnerTally, shown: boolean, items: number, casters: number): void {
		if (shown) {
			tally.kept += items;
			tally.castersKept += casters;
		} else {
			tally.hidden += items;
			tally.castersHidden += casters;
		}
	}

	/**
	 * Is er op dit moment iets van deze zone te zien?
	 *
	 * De zone van de speler altijd. Een andere alleen als er een kegel naartoe loopt
	 * én de doos waar die zone in ligt in die kegel valt. Dat tweede is de hele
	 * vraag: een kegel zegt dat er een doorkijk bestaat, niet dat er iets achter
	 * ligt, en de kegel over de dakrand is de volle camerakegel. Zonder de doostest
	 * gaf dit vanuit de stad altijd ja, ook met het gebouw honderd meter achter je,
	 * en dan tikt de hele simulatie-LOD nooit trager.
	 *
	 * De stad heeft geen doos: die houdt nergens op, dus een kegel ernaartoe is het
	 * antwoord.
	 */
	seesZone(zone: ZoneId): boolean {
		const bit = zoneBit(zone);
		if ((bit & this.ownBit) !== 0) return true;
		if ((bit & this.visibleMask) === 0) return false;
		const box = ZONE_BOXES.get(zone) ?? null;
		for (let i = 0; i < this.coneCount; i++) {
			const cone = this.cones[i];
			if (!cone || (cone.zones & bit) === 0) continue;
			if (box === null || cone.frustum.intersectsBox(box)) return true;
		}
		return false;
	}

	/** Ziet de speler iets van een van deze zones? De LOD-klokken stellen hun vraag zo. */
	seesAnyOf(mask: number): boolean {
		for (const zone of ZONES) {
			if ((mask & zoneBit(zone)) === 0) continue;
			if (this.seesZone(zone)) return true;
		}
		return false;
	}

	/**
	 * Mag iets dat in `zoneMask` staat getekend worden?
	 *
	 * Alles wat de zone van de speler zelf raakt altijd: daar staat hij in, en de
	 * gewone frustumtest van three doet daar de rest. Al het andere moet door een
	 * opening passen die op die zone uitkomt.
	 */
	accepts(zoneMask: number, sphere: Sphere | null): boolean {
		this.stats.batches++;
		if ((zoneMask & this.ownBit) !== 0) {
			this.stats.keptInOwnZone++;
			return true;
		}
		if ((zoneMask & this.visibleMask) === 0) {
			this.stats.hidden++;
			return false;
		}
		if (!sphere) {
			this.stats.keptThroughCone++;
			return true;
		}
		for (let i = 0; i < this.coneCount; i++) {
			const cone = this.cones[i];
			if (!cone || (cone.zones & zoneMask) === 0) continue;
			if (cone.frustum.intersectsSphere(sphere)) {
				this.stats.keptThroughCone++;
				return true;
			}
		}
		this.stats.hidden++;
		return false;
	}

	private pushCone(zones: number): Frustum {
		let cone = this.cones[this.coneCount];
		if (!cone) {
			cone = { zones, frustum: new Frustum() };
			this.cones.push(cone);
		}
		cone.zones = zones;
		this.coneCount++;
		return cone.frustum;
	}

	private addPortalCone(aperture: Rect3, far: number): void {
		const rect = this.apertureRect(aperture);
		if (rect === null) return;
		this.narrowedFrustum(rect, this.pushCone(far));
	}

	/**
	 * Het NDC-rechthoekje van de opening, of null als er niets van in beeld valt.
	 *
	 * Over de ribben en niet over de hoekpunten, want een hoekpunt achter het
	 * beeldvlak heeft geen NDC. Wie daarop de hele camerakegel teruggaf gaf hem ook
	 * terug voor een opening die volledig áchter je ligt, en dan cullt de kegel
	 * niets: vanaf de stoep met het gebouw in de rug hield elk van de vier gevels
	 * zo zijn eigen volledige kegel. Elke rib wordt op het beeldvlak afgeknipt en
	 * alleen het stuk ervóór telt mee; de omhullende van die stukken is precies de
	 * omhullende van de geprojecteerde doos. Staat de camera in de opening zelf, dan
	 * lopen die stukken tot ver buiten het beeld en klemt het rechthoekje vanzelf op
	 * het hele scherm, wat het juiste antwoord is: dan sta je erin.
	 */
	private apertureRect(aperture: Rect3): Rect | null {
		const m = this.viewProjection.elements;
		const m0 = m[0] ?? 0;
		const m1 = m[1] ?? 0;
		const m3 = m[3] ?? 0;
		const m4 = m[4] ?? 0;
		const m5 = m[5] ?? 0;
		const m7 = m[7] ?? 0;
		const m8 = m[8] ?? 0;
		const m9 = m[9] ?? 0;
		const m11 = m[11] ?? 0;
		const m12 = m[12] ?? 0;
		const m13 = m[13] ?? 0;
		const m15 = m[15] ?? 0;
		for (let i = 0; i < CORNERS.length; i++) {
			const corner = CORNERS[i];
			const point = CLIP_POINTS[i];
			if (!(corner && point)) continue;
			const x = aperture[corner[0]];
			const y = aperture[corner[1]];
			const z = aperture[corner[2]];
			point.x = m0 * x + m4 * y + m8 * z + m12;
			point.y = m1 * x + m5 * y + m9 * z + m13;
			point.w = m3 * x + m7 * y + m11 * z + m15;
		}
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		let seen = false;
		const take = (x: number, y: number, w: number): void => {
			seen = true;
			const ndcX = x / w;
			const ndcY = y / w;
			minX = Math.min(minX, ndcX);
			maxX = Math.max(maxX, ndcX);
			minY = Math.min(minY, ndcY);
			maxY = Math.max(maxY, ndcY);
		};
		for (const [a, b] of EDGES) {
			const first = CLIP_POINTS[a];
			const second = CLIP_POINTS[b];
			if (!(first && second)) continue;
			const firstAhead = first.w > MIN_CLIP_W;
			const secondAhead = second.w > MIN_CLIP_W;
			if (!(firstAhead || secondAhead)) continue;
			if (firstAhead) take(first.x, first.y, first.w);
			if (secondAhead) take(second.x, second.y, second.w);
			if (firstAhead === secondAhead) continue;
			// Waar de rib het beeldvlak snijdt. `w` loopt lineair langs de rib, dus dit
			// is de enige parameter waarvoor `w` gelijk aan de klipgrens wordt.
			const t = (MIN_CLIP_W - first.w) / (second.w - first.w);
			take(first.x + (second.x - first.x) * t, first.y + (second.y - first.y) * t, MIN_CLIP_W);
		}
		if (!seen) return null;
		if (minX > 1 || maxX < -1 || minY > 1 || maxY < -1) return null;
		return { minX: Math.max(minX, -1), maxX: Math.min(maxX, 1), minY: Math.max(minY, -1), maxY: Math.min(maxY, 1) };
	}

	/**
	 * De camerakegel op dat rechthoekje. De zijvlakken volgen dezelfde afleiding als
	 * `Frustum.setFromProjectionMatrix`, met de rand van het beeld vervangen door de
	 * rand van de opening; voor- en achtervlak blijven die van de camera.
	 */
	private narrowedFrustum(rect: Rect, out: Frustum): void {
		const m = this.viewProjection.elements;
		const row0 = [m[0] ?? 0, m[4] ?? 0, m[8] ?? 0, m[12] ?? 0] as const;
		const row1 = [m[1] ?? 0, m[5] ?? 0, m[9] ?? 0, m[13] ?? 0] as const;
		const row3 = [m[3] ?? 0, m[7] ?? 0, m[11] ?? 0, m[15] ?? 0] as const;
		const side = (
			row: readonly [number, number, number, number],
			edge: number,
			upper: boolean,
		): [number, number, number, number] =>
			upper
				? [edge * row3[0] - row[0], edge * row3[1] - row[1], edge * row3[2] - row[2], edge * row3[3] - row[3]]
				: [row[0] - edge * row3[0], row[1] - edge * row3[1], row[2] - edge * row3[2], row[3] - edge * row3[3]];
		const write = (index: number, components: readonly [number, number, number, number]): void => {
			out.planes[index]?.setComponents(components[0], components[1], components[2], components[3]).normalize();
		};
		write(0, side(row0, rect.maxX, true));
		write(1, side(row0, rect.minX, false));
		write(2, side(row1, rect.minY, false));
		write(3, side(row1, rect.maxY, true));
		for (const index of [4, 5]) {
			const near = this.cameraFrustum.planes[index];
			if (near) out.planes[index]?.copy(near);
		}
	}
}

export { ZoneCuller };
export type { ZoneCullStats, ZoneOwnerTally };
