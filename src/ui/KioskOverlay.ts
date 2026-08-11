import { HOME_POS } from '#/camera/Director';
import { EDGES, NODES } from '#/data/graph';
import { getInventory } from '#/data/inventory';
import { ATRIUM_VOID, MALL_FOOTPRINT } from '#/data/layout';
import type { LevelId } from '#/data/levels';
import { LEVELS, LEVELS_BOTTOM_UP, level, levelAt, levelY } from '#/data/levels';
import type { Bounds2, MapPresentation, PlanShape, SpatialGeometry, Vec2 } from '#/data/spatial';
import { geometryBounds, planBounds, pointInPlan } from '#/data/spatial';
import type { StoreCategory, StoreDef } from '#/data/stores';
import { CATEGORY_LABELS, getKruidvat, requireStore, STORES } from '#/data/stores';
import type { MallWorldEntity } from '#/data/world';
import { HELIPAD_PAD_SPEC, WORLD_ENTITIES } from '#/data/world';
import { ZONE_ENCLOSURES } from '#/data/zones';
import { POOL_POLYGON, SLIDE_PLATFORM } from '#/scene/RoofIsland';
import { isTypingTarget, qs } from '#/util/dom';
import { clamp, half, midpoint, span } from '#/util/math';
import { at } from '#/util/rand';

/** One dot on the map — a sim, mostly. */
export type MapBlip = { x: number; z: number; level: LevelId };

export type MapState = {
	x: number;
	z: number;
	yaw: number;
	level: LevelId;
	path: { x: number; y: number; z: number }[];
	blips: MapBlip[];
	target: { x: number; z: number; level: LevelId; name: string } | null;
};

const ZOOM_STEPS = [2.4, 3.4, 4.8, 6.6] as const;

const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));

/** Where the route starts: the info kiosk's own directory record. */
const KIOSK = requireStore('info');

/** Same-floor graph edges = the corridors worth drawing on the map. */
const CORRIDORS = EDGES.flatMap((e) => {
	const a = NODE_BY_ID.get(e.from);
	const b = NODE_BY_ID.get(e.to);
	if (!a || !b) return [];
	const la = levelAt(a.y);
	if (la !== levelAt(b.y)) return [];
	return [{ level: la, ax: a.x, az: a.z, bx: b.x, bz: b.z }];
});

type MapLayer = MapPresentation['layer'];

type LayerStyle = Readonly<{
	fill: string;
	stroke: string;
	lineWidth: number;
	dash: number;
	labelColor: string | null;
}>;

const LAYER_STYLES: Readonly<Record<MapLayer, LayerStyle>> = {
	structure: {
		fill: 'rgba(30,41,59,0.55)',
		stroke: 'rgba(148,163,184,0.6)',
		lineWidth: 2,
		dash: 0,
		labelColor: 'rgba(148,163,184,0.85)',
	},
	opening: {
		fill: 'rgba(8,11,20,0.9)',
		stroke: 'rgba(248,113,113,0.7)',
		lineWidth: 1.5,
		dash: 3.6,
		labelColor: null,
	},
	shop: {
		fill: 'rgba(148,163,184,0.28)',
		stroke: 'rgba(226,232,240,0.45)',
		lineWidth: 1.4,
		dash: 0,
		labelColor: 'rgba(241,245,249,0.92)',
	},
	circulation: {
		fill: 'rgba(251,191,36,0.35)',
		stroke: '#fbbf24',
		lineWidth: 1.4,
		dash: 0,
		labelColor: '#fbbf24',
	},
	parking: {
		fill: 'rgba(69,90,100,0.5)',
		stroke: 'rgba(255,193,7,0.5)',
		lineWidth: 1.4,
		dash: 0,
		labelColor: '#ffc107',
	},
	fixture: {
		fill: 'rgba(192,132,252,0.26)',
		stroke: 'rgba(240,171,252,0.75)',
		lineWidth: 1.4,
		dash: 0,
		labelColor: '#f0abfc',
	},
	clutter: {
		fill: 'rgba(148,163,184,0.18)',
		stroke: 'rgba(148,163,184,0.3)',
		lineWidth: 1,
		dash: 0,
		labelColor: null,
	},
};

const HERO_FILL = 'rgba(0,166,81,0.55)';
const HERO_STROKE = '#00e676';
const HERO_LABEL = '#5eead4';

/** De kaartachtergrond. Ook de rand om elk label, zodat lijnen eronderdoor lopen. */
const MAP_BACKDROP = '#0a1020';

/**
 * A plan is a horizontal cut through the deck, so geometry that only starts
 * above it is ceiling and belongs to no room outline.
 */
const PLAN_CUT_HEIGHT = 1.2;

type MapFeature = Readonly<{
	layer: MapLayer;
	label: string;
	glyph: string;
	hero: boolean;
	priority: number;
	shapes: readonly PlanShape[];
	anchor: Vec2;
	/** Het hele grondvlak in meters: waar de vorm ophoudt, en dus waaronder een label mag uitwijken. */
	bounds: Bounds2;
	/**
	 * De vorm waarin het label past: die waar het ankerpunt in ligt. Op `bounds`
	 * gemeten kreeg CATWALK de 5,4 m van zijn achterwand als breedte en lag het
	 * daarna dwars over de parkeeruitrit, terwijl het dek zelf 2,7 m is.
	 */
	labelBounds: Bounds2;
	/** Of hij op het grondvlak van de mall staat. De dekplattegrond tekent alleen die. */
	inMall: boolean;
}>;

function oneLine(text: string): string {
	return text.split('\n').join(' ');
}

function volumePlan(geometry: SpatialGeometry): PlanShape {
	if (geometry.kind === 'prism') return geometry.plan;
	if (geometry.kind === 'cylinder' && geometry.axis === 'y') {
		return { kind: 'circle', center: { x: geometry.center.x, z: geometry.center.z }, radius: geometry.radius };
	}
	const bounds = geometryBounds(geometry);
	return {
		kind: 'rectangle',
		center: { x: midpoint(bounds.minX, bounds.maxX), z: midpoint(bounds.minZ, bounds.maxZ) },
		width: span(bounds.minX, bounds.maxX),
		depth: span(bounds.minZ, bounds.maxZ),
		yaw: 0,
	};
}

function planKey(shape: PlanShape): string {
	if (shape.kind === 'circle') return `c ${shape.center.x} ${shape.center.z} ${shape.radius}`;
	if (shape.kind === 'polygon') return `p ${shape.points.map((point) => `${point.x},${point.z}`).join(' ')}`;
	return `r ${shape.center.x} ${shape.center.z} ${shape.width} ${shape.depth} ${shape.yaw}`;
}

function featureBounds(shapes: readonly PlanShape[]): Bounds2 {
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (const shape of shapes) {
		const bounds = planBounds(shape);
		minX = Math.min(minX, bounds.minX);
		maxX = Math.max(maxX, bounds.maxX);
		minZ = Math.min(minZ, bounds.minZ);
		maxZ = Math.max(maxZ, bounds.maxZ);
	}
	return { minX, maxX, minZ, maxZ };
}

/**
 * Alleen een trap of roltrap verdient het ⇅-teken. De lift en de parkeerhelling
 * zitten in dezelfde laag en kregen het er gratis bij: een autohelling met een
 * roltrapicoon erop.
 */
function featureGlyph(entity: MallWorldEntity): string {
	return entity.ports.some((port) => port.kind === 'escalator' || port.kind === 'stairs') ? '⇅' : '';
}

/** An opening is a hole in the slab of the highest deck it reaches, and nowhere else. */
function planLevels(entity: MallWorldEntity): readonly LevelId[] {
	if (entity.map.layer !== 'opening' || entity.levels.length < 2) return entity.levels;
	return [entity.levels.reduce((top, id) => (levelY(id) > levelY(top) ? id : top))];
}

function planShapes(entity: MallWorldEntity, levelId: LevelId): readonly PlanShape[] {
	const cut = levelY(levelId) + PLAN_CUT_HEIGHT;
	const shapes: PlanShape[] = [];
	const seen = new Set<string>();
	for (const volume of entity.volumes) {
		// Gereserveerde vloer is geen ruimte: getekend groeit elke winkel 1,5 m het
		// gangpad in en zou elk theatergangpad een eigen vorm op de kaart krijgen.
		if (volume.role === 'storefront-clearance' || volume.role === 'aisle-clearance') continue;
		if (geometryBounds(volume.geometry).minY > cut) continue;
		const plan = volumePlan(volume.geometry);
		const key = planKey(plan);
		if (seen.has(key)) continue;
		seen.add(key);
		shapes.push(plan);
	}
	return shapes;
}

function boundsArea(bounds: Bounds2): number {
	return span(bounds.minX, bounds.maxX) * span(bounds.minZ, bounds.maxZ);
}

/**
 * De ruimste vorm waar het ankerpunt in ligt. Ligt het in geen enkele vorm, zoals
 * bij een glijbaan die een krul is en geen midden heeft, dan geldt het grondvlak.
 */
function labelShapeBounds(shapes: readonly PlanShape[], anchor: Vec2, fallback: Bounds2): Bounds2 {
	let best: Bounds2 | null = null;
	for (const shape of shapes) {
		if (!pointInPlan(shape, anchor.x, anchor.z)) continue;
		const bounds = planBounds(shape);
		if (!best || boundsArea(bounds) > boundsArea(best)) best = bounds;
	}
	return best ?? fallback;
}

/**
 * De plattegrond gaat over de mall. De schotel gaat over waar je staat.
 *
 * Het theater is een tweede gebouw met een binnenkant, en op de dekplattegrond
 * hoort het niet: die past zich aan zijn ruimste vorm aan, dus vijftig meter
 * verderop een tweede gebouw erbij tekenen krimpt de mall tot een derde van het
 * vlak. De schotel is wél wereldbreed — die staat om de speler heen.
 */
const MALL_PLAN = at(ZONE_ENCLOSURES, 0).plan;

function touchesPlan(plan: Bounds2, bounds: Bounds2): boolean {
	return bounds.minX <= plan.maxX && bounds.maxX >= plan.minX && bounds.minZ <= plan.maxZ && bounds.maxZ >= plan.minZ;
}

/** The map's only source of rooms: every entity the world schema marks visible. */
function buildFeatures(): Map<LevelId, MapFeature[]> {
	const byLevel = new Map<LevelId, MapFeature[]>(LEVELS.map((deck): [LevelId, MapFeature[]] => [deck.id, []]));
	for (const entity of WORLD_ENTITIES) {
		if (!entity.map.visible) continue;
		const store = STORES.find((candidate) => `shop-${candidate.id}` === entity.id);
		for (const levelId of planLevels(entity)) {
			const shapes = planShapes(entity, levelId);
			if (shapes.length === 0) continue;
			const bounds = featureBounds(shapes);
			const anchor: Vec2 = { x: midpoint(bounds.minX, bounds.maxX), z: midpoint(bounds.minZ, bounds.maxZ) };
			byLevel.get(levelId)?.push({
				layer: entity.map.layer,
				label: oneLine(entity.map.label ?? ''),
				glyph: featureGlyph(entity),
				hero: store?.hero === true,
				priority: entity.map.priority,
				shapes,
				anchor,
				bounds,
				labelBounds: labelShapeBounds(shapes, anchor, bounds),
				inMall: touchesPlan(MALL_PLAN, bounds),
			});
		}
	}
	for (const features of byLevel.values()) features.sort((a, b) => a.priority - b.priority);
	return byLevel;
}

const FEATURES_BY_LEVEL = buildFeatures();

/**
 * Waar de plattegrond op past. De parkeeruitrit loopt tien meter voorbij de
 * gevel, en op een kader van alleen de footprint werd hij door de rand
 * afgesneden. Eén kader voor alle dekken, anders krimpt het gebouw zodra je
 * van verdieping wisselt.
 */
const PLAN_FRAME = ((): Bounds2 => {
	const frame = {
		minX: -half(MALL_FOOTPRINT.width),
		maxX: half(MALL_FOOTPRINT.width),
		minZ: -half(MALL_FOOTPRINT.depth),
		maxZ: half(MALL_FOOTPRINT.depth),
	};
	for (const features of FEATURES_BY_LEVEL.values()) {
		for (const feature of features) {
			if (!feature.inMall) continue;
			frame.minX = Math.min(frame.minX, feature.bounds.minX);
			frame.maxX = Math.max(frame.maxX, feature.bounds.maxX);
			frame.minZ = Math.min(frame.minZ, feature.bounds.minZ);
			frame.maxZ = Math.max(frame.maxZ, feature.bounds.maxZ);
		}
	}
	return frame;
})();

/** Lucht rond het kader, zodat een randlabel niet tegen de canvasrand plakt. */
const PLAN_MARGIN = 10;

const PLAN_FRAME_WIDTH = span(PLAN_FRAME.minX, PLAN_FRAME.maxX) + PLAN_MARGIN;
const PLAN_FRAME_DEPTH = span(PLAN_FRAME.minZ, PLAN_FRAME.maxZ) + PLAN_MARGIN;
const PLAN_FRAME_CENTER: Vec2 = { x: midpoint(PLAN_FRAME.minX, PLAN_FRAME.maxX), z: midpoint(PLAN_FRAME.minZ, PLAN_FRAME.maxZ) };

/** Named features, most important first, so a crowded corner keeps the label that matters. */
const LABELS_BY_LEVEL = new Map<LevelId, MapFeature[]>(
	[...FEATURES_BY_LEVEL].map(([levelId, features]): [LevelId, MapFeature[]] => [
		levelId,
		features.filter((feature) => feature.label !== '' && LAYER_STYLES[feature.layer].labelColor !== null).toReversed(),
	]),
);

/** Wat een kaart tekent: het gebouw waar de plattegrond over gaat, of de hele wereld. */
type MapScope = 'mall' | 'world';

function inScope(features: readonly MapFeature[], scope: MapScope): readonly MapFeature[] {
	return scope === 'world' ? features : features.filter((feature) => feature.inMall);
}

function featuresOn(levelId: LevelId, scope: MapScope): readonly MapFeature[] {
	return inScope(FEATURES_BY_LEVEL.get(levelId) ?? [], scope);
}

function labelsOn(levelId: LevelId, scope: MapScope): readonly MapFeature[] {
	return inScope(LABELS_BY_LEVEL.get(levelId) ?? [], scope);
}

const RECT_CORNERS = [
	[-1, -1],
	[1, -1],
	[1, 1],
	[-1, 1],
] as const;

function tracePlan(ctx: CanvasRenderingContext2D, shape: PlanShape): void {
	ctx.beginPath();
	if (shape.kind === 'circle') {
		ctx.arc(shape.center.x, shape.center.z, shape.radius, 0, Math.PI * 2);
		return;
	}
	if (shape.kind === 'polygon') {
		shape.points.forEach((point, index) => {
			if (index === 0) ctx.moveTo(point.x, point.z);
			else ctx.lineTo(point.x, point.z);
		});
		ctx.closePath();
		return;
	}
	const cosine = Math.cos(shape.yaw);
	const sine = Math.sin(shape.yaw);
	RECT_CORNERS.forEach(([signX, signZ], index) => {
		const localX = signX * half(shape.width);
		const localZ = signZ * half(shape.depth);
		const x = shape.center.x + localX * cosine + localZ * sine;
		const z = shape.center.z - localX * sine + localZ * cosine;
		if (index === 0) ctx.moveTo(x, z);
		else ctx.lineTo(x, z);
	});
	ctx.closePath();
}

type ScreenPoint = Readonly<{ x: number; y: number }>;

/** Wereld → scherm voor één canvas. De HUD-schotel draait met de speler mee, de grote plattegrond staat noord-boven. */
type Project = (x: number, z: number) => ScreenPoint;

/**
 * Waar een label bij dit punt terechtkan en hoeveel breedte het daar heeft, of null
 * als er in de buurt geen tekenvlak is. De schotel knipt op een cirkel, en wat over
 * die rand hing werd door de clip doormidden gehakt: STARBUCKS kwam er als ARBUCK uit.
 */
type LabelSpace = Readonly<{ point: ScreenPoint; width: number }>;

type LabelRoom = (point: ScreenPoint) => LabelSpace | null;

/** De grote plattegrond is rechthoekig en knipt geen enkel label af. */
const UNCLIPPED: LabelRoom = (point) => ({ point, width: Number.POSITIVE_INFINITY });

/**
 * Vrije schermruimte rondom een label. Dit was een afstand tussen middelpunten,
 * die twee labels van tachtig pixels breed naast elkaar goedkeurde zolang hun
 * middens ver genoeg uit elkaar lagen: ISLAND HOP TRAVEL en WUDU · ABLUTIE
 * stonden dwars door elkaar heen. Nu is het de marge om het hele tekstvak.
 */
const BIG_LABEL_GAP = 5;
const MINI_LABEL_GAP = 3;

/** De smalste plattegrond die de kiosk tekent, wat er om de canvas heen zit, en de val-terug. */
export const BIG_MAP_MIN_WIDTH = 320;
const BIG_MAP_PADDING = 36;
const BIG_MAP_FALLBACK_WIDTH = 820;

const LABEL_SIZE_MAX = 11;
/** Onder deze maat is monospace op een donkere kaart niet meer te lezen. */
const LABEL_SIZE_MIN = 9;
/** Hoe ver onder een bezette plek zijn label gaat hangen. */
const BELOW_LABEL_OFFSET = 9;
/** Rand in de achtergrondkleur onder de letters, zodat vloerlijnen ze niet doorsnijden. */
const LABEL_HALO_WIDTH = 3;
/** Regelafstand als factor van de tekstmaat. */
const LABEL_LINE_HEIGHT = 1.15;
/** Meer dan drie regels is geen label meer maar een alinea. */
const LABEL_MAX_LINES = 3;
/** Rand van de schotel die voor een label niet meetelt. */
const MINI_LABEL_INSET = 8;
/**
 * Hoeveel meter een label naar het midden van de schotel mag schuiven om er nog op te
 * passen. Een vorm die half over de rand hangt heeft zijn ankerpunt net erbuiten, en
 * dan viel de naam weg: vanaf de stoep vóór de hoofdingang stond de ingang zelf
 * naamloos op de kaart, met UITRIT STAD er pal naast.
 */
const MINI_LABEL_PULL = 3;
/**
 * Hoe breed een label mag worden zodra het onder of boven zijn eigen vorm hangt.
 *
 * Daar werd het nog steeds tegen de breedte van díé vorm gemeten, en dat is precies de
 * maat waar het net niet in paste. Het parkeerloket is 2,2 m, dus `P · TICKETS` kreeg
 * tweeëntwintig pixels en viel op alle vijf de plekken stil weg. Genoeg voor een naam,
 * niet genoeg voor een alinea.
 */
const ESCAPE_LABEL_WIDTH = 140;
const ELLIPSIS = '…';
/** Eén letter en drie puntjes is geen naam meer; dan liever niets. */
const ELLIPSIS_STEM_MIN = 3;

function labelFont(weight: number, size: number): string {
	return `${weight} ${size}px ui-monospace, monospace`;
}

/**
 * Wat het inpassen van een label van een canvas nodig heeft: een font zetten en tekst
 * meten. Zo kan de wereldcontrole de kaartlabels naleggen zonder een canvas te hebben,
 * en meet ze met dezelfde regels als de kiosk.
 */
export type LabelMeasure = { font: string; measureText(text: string): Readonly<{ width: number }> };

/**
 * `text` afgekapt tot het gemeten binnen `maxWidth` past, of null als er geen
 * leesbare stam overblijft. Meet met de font die al op `ctx` staat.
 */
function ellipsize(ctx: LabelMeasure, text: string, maxWidth: number): string | null {
	if (ctx.measureText(text).width <= maxWidth) return text;
	for (let length = text.length - 1; length >= ELLIPSIS_STEM_MIN; length--) {
		const cut = `${text.slice(0, length).trimEnd()}${ELLIPSIS}`;
		if (ctx.measureText(cut).width <= maxWidth) return cut;
	}
	return null;
}

type ScreenBox = Readonly<{ minX: number; maxX: number; minY: number; maxY: number }>;

function boxesOverlap(a: ScreenBox, b: ScreenBox, gap: number): boolean {
	return a.minX - gap < b.maxX && a.maxX + gap > b.minX && a.minY - gap < b.maxY && a.maxY + gap > b.minY;
}

/** Het grondvlak in schermruimte. Op de meedraaiende schotel ligt minZ niet boven, dus alle vier de hoeken tellen mee. */
function projectBounds(bounds: Bounds2, project: Project): ScreenBox {
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const x of [bounds.minX, bounds.maxX]) {
		for (const z of [bounds.minZ, bounds.maxZ]) {
			const point = project(x, z);
			minX = Math.min(minX, point.x);
			maxX = Math.max(maxX, point.x);
			minY = Math.min(minY, point.y);
			maxY = Math.max(maxY, point.y);
		}
	}
	return { minX, maxX, minY, maxY };
}

/**
 * De horizontale ruimte binnen de schotel op de hoogte van dit punt, of null als
 * het punt voorbij de straal ligt.
 */
function dishRoom(point: ScreenPoint, cx: number, cy: number, radius: number): number | null {
	const dy = point.y - cy;
	if (Math.abs(dy) >= radius) return null;
	const chord = Math.sqrt(radius * radius - dy * dy);
	const room = Math.min(point.x - (cx - chord), cx + chord - point.x);
	return room > 0 ? room * 2 : null;
}

/**
 * Waar het label van dit punt op de schotel terechtkomt.
 *
 * Ligt het punt binnen `pull` van de rand of er net buiten, dan schuift het label naar
 * het midden tot het op `radius - pull` staat en meet het zijn breedte daar. Verder weg
 * dan dat hoort het niet meer bij deze schotel.
 */
function dishSpace(point: ScreenPoint, cx: number, cy: number, radius: number, pull: number): LabelSpace | null {
	const offsetX = point.x - cx;
	const offsetY = point.y - cy;
	const distance = Math.hypot(offsetX, offsetY);
	if (distance > radius + pull) return null;
	const limit = Math.max(0, radius - pull);
	const moved =
		distance > limit && distance > 0 ? { x: cx + (offsetX * limit) / distance, y: cy + (offsetY * limit) / distance } : point;
	const width = dishRoom(moved, cx, cy, radius);
	return width === null ? null : { point: moved, width };
}

/** Een gemeten label: de regels zoals ze getekend worden, plus wat ze innemen. */
export type FittedLabel = Readonly<{ lines: readonly string[]; size: number; width: number; height: number; whole: boolean }>;

/** Eén label zoals het getekend gaat worden. */
export type PlannedLabel = Readonly<{
	text: string;
	label: FittedLabel;
	point: ScreenPoint;
	vertical: boolean;
	weight: number;
	color: string;
}>;

/** Wat er van de labels van één dek terechtkomt: wat er staat, en wat nergens paste. */
export type LabelPlan = Readonly<{ plan: readonly PlannedLabel[]; unfittable: readonly string[] }>;

/** De ronde schotel in de HUD: haar maat, de ring eromheen en de stand waarop ze begint. */
const MINIMAP = { size: 200, rim: 3, zoom: 2 } as const;

/** Waar de speler staat en hoe hij kijkt: alles wat de schotel van hem nodig heeft. */
export type MinimapView = Readonly<{ x: number; z: number; yaw: number; level: LevelId; zoom?: number }>;

/** Wereld → schotel: gedraaid zodat de kijkrichting boven ligt, met de speler in het midden. */
function dishProject(x: number, z: number, view: MinimapView, cx: number, cy: number, scale: number): ScreenPoint {
	const dx = x - view.x;
	const dz = z - view.z;
	const cosine = Math.cos(view.yaw);
	const sine = Math.sin(view.yaw);
	return { x: cx + (dx * cosine - dz * sine) * scale, y: cy + (dx * sine + dz * cosine) * scale };
}

/** Woorden over regels verdelen, elke regel zo vol als `budget` toelaat. Meet met de font die op `ctx` staat. */
function wrapWords(ctx: LabelMeasure, words: readonly string[], budget: number): string[] {
	const lines: string[] = [];
	let current = '';
	for (const word of words) {
		const candidate = current === '' ? word : `${current} ${word}`;
		if (current !== '' && ctx.measureText(candidate).width > budget) {
			lines.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	if (current !== '') lines.push(current);
	return lines;
}

/**
 * De grootste maat waarop `text` binnen `budget` bij `height` past, desnoods over
 * meer regels. `whole` zegt of de naam er nog helemaal staat. Zonder regelafbreking
 * werd ISLAND HOP TRAVEL in zijn eigen vier meter brede winkel `ISLAN…`, terwijl het
 * over drie regels past.
 *
 * Afkappen doet hij alleen als `cut` het toestaat. Anders kapte hij meteen op de
 * eerste plek af, en die plek is de vorm zelf: HOOFDINGANG werd `HOO…` in zijn eigen
 * portaal terwijl er een halve centimeter naast plek genoeg was, en de uitwijkplekken
 * kwamen nooit aan de beurt.
 */
function fitLabel(
	ctx: LabelMeasure,
	text: string,
	weight: number,
	budget: number,
	height: number,
	maxLines: number,
	cut: boolean,
): FittedLabel | null {
	const words = text.split(' ');
	for (let size = LABEL_SIZE_MAX; size >= LABEL_SIZE_MIN; size -= 0.5) {
		ctx.font = labelFont(weight, size);
		const lines = wrapWords(ctx, words, budget);
		if (lines.length > maxLines) continue;
		const block = lines.length * size * LABEL_LINE_HEIGHT;
		if (block > height) continue;
		const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
		if (width > budget) continue;
		return { lines, size, width, height: block, whole: true };
	}
	if (!cut) return null;
	ctx.font = labelFont(weight, LABEL_SIZE_MIN);
	const stem = ellipsize(ctx, text, budget);
	if (stem === null) return null;
	return {
		lines: [stem],
		size: LABEL_SIZE_MIN,
		width: ctx.measureText(stem).width,
		height: LABEL_SIZE_MIN * LABEL_LINE_HEIGHT,
		whole: stem === text,
	};
}

function labelBox(point: ScreenPoint, width: number, height: number): ScreenBox {
	return { minX: point.x - half(width), maxX: point.x + half(width), minY: point.y - half(height), maxY: point.y + half(height) };
}

function drawLabel(
	ctx: CanvasRenderingContext2D,
	label: FittedLabel,
	point: ScreenPoint,
	vertical: boolean,
	weight: number,
	color: string,
): void {
	ctx.save();
	ctx.translate(point.x, point.y);
	if (vertical) ctx.rotate(-Math.PI / 2);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.font = labelFont(weight, label.size);
	const step = label.size * LABEL_LINE_HEIGHT;
	label.lines.forEach((line, index) => {
		const y = (index - half(label.lines.length - 1)) * step;
		// De rand eerst: de kaart tekent zijn vloerlijnen onder het label door, en
		// TOILETTEN werd door negen hokjesomtrekken doorsneden.
		ctx.lineWidth = LABEL_HALO_WIDTH;
		ctx.lineJoin = 'round';
		ctx.strokeStyle = MAP_BACKDROP;
		ctx.strokeText(line, 0, y);
		ctx.fillStyle = color;
		ctx.fillText(line, 0, y);
	});
	ctx.restore();
}

/**
 * De labels van één dek, met dezelfde regels op beide kaarten: elk label wordt
 * gemeten tegen de vorm waar het bij hoort, staat rechtop of overlangs al naar
 * gelang waar zijn naam heel blijft, wijkt uit als de plek bezet is, en draagt
 * het teken uit zijn entiteit. De schotel tekende hiervoor `label.slice(0, 8)`
 * met het teken van de laag, en gaf zo de liftschacht en de parkeerhelling een
 * roltrappijl.
 *
 * Een label blijft binnen zijn eigen vorm. Uitwijkende labels deden dat niet:
 * ze kregen een vaste maat en de volle breedte van het tekenvlak, en zo hing
 * BEARD-MAN'S CAVE bijna zes meter buiten de westgevel in de lege achtergrond.
 */
function planLabels(ctx: LabelMeasure, lvl: LevelId, scope: MapScope, project: Project, gap: number, room: LabelRoom): LabelPlan {
	const plan: PlannedLabel[] = [];
	const unfittable: string[] = [];
	const placed: ScreenBox[] = [];
	for (const feature of labelsOn(lvl, scope)) {
		const style = LAYER_STYLES[feature.layer];
		if (style.labelColor === null) continue;
		const text = feature.glyph === '' ? feature.label : `${feature.glyph} ${feature.label}`;
		const weight = feature.hero ? 700 : 600;
		const box = projectBounds(feature.bounds, project);
		const shape = projectBounds(feature.labelBounds, project);
		const shapeAcross = span(shape.minX, shape.maxX);
		const shapeAlong = span(shape.minY, shape.maxY);
		const anchor = project(feature.anchor.x, feature.anchor.z);
		const oneLine = LABEL_SIZE_MAX * LABEL_LINE_HEIGHT;
		// Wijk uit voordat je afkapt, en kap af voordat je opgeeft. De hele naam in de
		// vorm, dan eronder of erboven, dan over het hele grondvlak, en pas als laatste
		// een afgekapte regel in de vorm. Dat grondvlak staat er omdat op de
		// parkeervloer precies op het ankerpunt een kolom van 0,7 m staat waar geen
		// letter in past, terwijl de naam van het dek bij het dek hoort.
		//
		// De volgorde was andersom, en `fitLabel` kapte zelf af zodra de hele naam niet
		// paste, dus won de vorm altijd meteen: HOOFDINGANG werd `HOO…` in zijn eigen
		// portaal en de uitwijkplekken kwamen nooit aan de beurt. Die twee hangen
		// buiten de vorm en worden daarom ook niet meer tegen diens breedte gemeten;
		// dat is de maat waar het label net niet in paste en waarom het uitwijkt.
		const outside = Math.max(shapeAcross, ESCAPE_LABEL_WIDTH);
		const spots: readonly {
			point: ScreenPoint;
			across: number;
			along: number;
			upright: boolean;
			maxLines: number;
			cut: boolean;
		}[] = [
			{ point: anchor, across: shapeAcross, along: shapeAlong, upright: true, maxLines: LABEL_MAX_LINES, cut: false },
			{
				point: { x: anchor.x, y: box.maxY + BELOW_LABEL_OFFSET },
				across: outside,
				along: oneLine,
				upright: false,
				maxLines: 1,
				cut: false,
			},
			{
				point: { x: anchor.x, y: box.minY - BELOW_LABEL_OFFSET },
				across: outside,
				along: oneLine,
				upright: false,
				maxLines: 1,
				cut: false,
			},
			{
				point: anchor,
				across: span(box.minX, box.maxX),
				along: span(box.minY, box.maxY),
				upright: true,
				maxLines: LABEL_MAX_LINES,
				cut: false,
			},
			{ point: anchor, across: shapeAcross, along: shapeAlong, upright: true, maxLines: 1, cut: true },
		];
		// Nergens gepast is iets anders dan verdrongen, en allebei iets anders dan buiten
		// beeld: alleen wie ergens ruimte kreeg en er tóch niet in paste is een naam die
		// de kaart kwijt is.
		let offered = false;
		let measured = false;
		for (const spot of spots) {
			const { across, along, maxLines } = spot;
			const available = room(spot.point);
			if (available === null) continue;
			offered = true;
			const point = available.point;
			const budget = Math.min(across, available.width);
			const flat = fitLabel(ctx, text, weight, budget, along, maxLines, spot.cut);
			// Een smalle, diepe vorm draagt zijn naam overlangs: het catwalkdek is
			// 2,7 m breed en tien meter lang. Alleen als de naam daar wél heel past.
			const upright =
				spot.upright && along > across && flat?.whole !== true ? fitLabel(ctx, text, weight, along, across, 1, false) : null;
			const vertical = upright?.whole === true;
			const label = vertical ? upright : flat;
			if (label === null) continue;
			measured = true;
			if (vertical) {
				const ends = [point.y - half(label.width), point.y + half(label.width)];
				if (ends.some((y) => (room({ x: point.x, y })?.width ?? 0) < label.height)) continue;
			}
			const bounds = vertical ? labelBox(point, label.height, label.width) : labelBox(point, label.width, label.height);
			if (placed.some((taken) => boxesOverlap(taken, bounds, gap))) continue;
			placed.push(bounds);
			plan.push({ text, label, point, vertical, weight, color: feature.hero ? HERO_LABEL : style.labelColor });
			break;
		}
		if (offered && !measured) unfittable.push(text);
	}
	return { plan, unfittable };
}

/**
 * De labels die de schotel vanaf deze plek tekent.
 *
 * De HUD tekent ze; check-world leest ze na. Dat de hoofdingang vanaf de stoep ervóór
 * naamloos op de schotel stond was op geen enkele plattegrond te zien, en op een
 * schermafdruk alleen als je wist waar je moest kijken.
 */
export function bigMapHeight(cssW: number): number {
	return cssW * (PLAN_FRAME_DEPTH / PLAN_FRAME_WIDTH);
}

function bigMapScale(cssW: number): number {
	return Math.min(cssW / PLAN_FRAME_WIDTH, bigMapHeight(cssW) / PLAN_FRAME_DEPTH);
}

/**
 * De labels die de grote plattegrond van dit dek tekent op een tekenvlak van `cssW`
 * breed. Op de smalste breedte die de kiosk toelaat leest de wereldcontrole ze na: een
 * naam die daar wegvalt, valt op elk smaller scherm weg.
 */
export function deckLabelPlan(ctx: LabelMeasure, lvl: LevelId, cssW: number): LabelPlan {
	const cssH = bigMapHeight(cssW);
	const scale = bigMapScale(cssW);
	const sx = (x: number): number => half(cssW) + (x - PLAN_FRAME_CENTER.x) * scale;
	const sy = (z: number): number => half(cssH) + (z - PLAN_FRAME_CENTER.z) * scale;
	return planLabels(ctx, lvl, 'mall', (x, z) => ({ x: sx(x), y: sy(z) }), BIG_LABEL_GAP, UNCLIPPED);
}

export function minimapLabelPlan(ctx: LabelMeasure, view: MinimapView): LabelPlan {
	const center = half(MINIMAP.size);
	const radius = center - MINIMAP.rim;
	const scale = at(ZOOM_STEPS, view.zoom ?? MINIMAP.zoom);
	return planLabels(
		ctx,
		view.level,
		'world',
		(x, z) => dishProject(x, z, view, center, center, scale),
		MINI_LABEL_GAP,
		(point) => dishSpace(point, center, center, radius - MINI_LABEL_INSET, MINI_LABEL_PULL * scale),
	);
}

export type UICallbacks = {
	onSelectStore: (store: StoreDef) => void;
	onStartRoute: (store: StoreDef) => void;
	onCancel: () => void;
	onReplay: () => void;
	onHome: () => void;
	onPossess: () => void;
	onDisco: () => void;
	onGiveMoney: () => void;
	onSummonThief: () => void;
	onMood: (delta: number) => void;
};

export class KioskOverlay {
	private root: HTMLElement;
	private callbacks: UICallbacks;
	private selected: StoreDef | null = null;
	private filter = '';
	private category: StoreCategory | 'all' = 'all';

	private elSearch!: HTMLInputElement;
	private elList!: HTMLElement;
	private elDetail!: HTMLElement;
	private elStatus!: HTMLElement;
	private elBoot!: HTMLElement;
	private elArrive!: HTMLElement;
	private elMinimap!: HTMLCanvasElement;
	private elMapFloor!: HTMLElement;
	private elMapFoot!: HTMLElement;
	private elBigMap!: HTMLElement;
	private elBigCanvas!: HTMLCanvasElement;
	private elCrosshair!: HTMLElement;
	private elSteps!: HTMLElement;
	private elHud!: HTMLElement;
	private elPanel!: HTMLElement;
	private elScore!: HTMLElement;
	private elNearby!: HTMLElement;
	private elPossessBanner!: HTMLElement;

	/** Waar de speler begint, tot de eerste frame hem bijwerkt. */
	private map: MapState = {
		x: HOME_POS.x,
		z: HOME_POS.z,
		yaw: 0,
		level: levelAt(HOME_POS.y),
		path: [],
		blips: [],
		target: null,
	};
	private zoom: number = MINIMAP.zoom;
	private bigOpen = false;
	private bigLevel: LevelId = 'v0';
	private mapClock = 0;
	private bigTabs: { button: HTMLButtonElement; level: LevelId }[] = [];

	constructor(root: HTMLElement, callbacks: UICallbacks) {
		this.root = root;
		this.callbacks = callbacks;
		this.mount();
	}

	private mount(): void {
		this.root.innerHTML = `
      <div class="boot" id="boot">
        <div class="boot-inner">
          <div class="boot-logo">MALL SIM</div>
          <div class="boot-sub">OPEN shops · WASD · faces · guest view · baard-dief</div>
          <div class="boot-bar"><div class="boot-bar-fill"></div></div>
          <div class="boot-hint">Winkels openen… verkopers inklokken…</div>
        </div>
      </div>

      <div class="hud hidden" id="hud">
        <header class="topbar">
          <div class="brand">
            <div>
              <div class="brand-name">MALL SIM</div>
              <div class="brand-tag">Prairie Lakes · viral walk game</div>
            </div>
          </div>
          <div class="topbar-right">
            <div class="score-chip" id="score">★ 0 · 0 sims met</div>
            <button type="button" class="btn-home" id="btn-home">← Kiosk</button>
            <div class="status-chip" id="status">Bij de kiosk</div>
          </div>
        </header>

        <aside class="panel collapsed" id="panel">
          <button type="button" class="panel-toggle" id="panel-toggle" aria-label="Winkelgids in- of uitklappen" aria-expanded="false">⌄</button>
          <div class="panel-head">
            <h1>Waar wil je heen?</h1>
            <p class="panel-sub"><b>Klik</b> = muis vangen · <b>WASD</b> lopen · <b>M</b> kaart · <b>B</b> bewoners</p>
          </div>
          <div class="nearby-sim hidden" id="nearby-sim"></div>

          <button class="hero-cta" id="btn-kruidvat" type="button">
            <span class="hero-cta-icon">✚</span>
            <span>
              <strong>Naar Kruidvat</strong>
              <small>gele route · auto-walk</small>
            </span>
            <span class="hero-cta-go">Start →</span>
          </button>

          <div class="actions-label">Acties</div>
          <div class="actions-grid">
            <button class="btn tile" type="button" id="btn-possess" title="Word een shopper (V)">
              <i>👁</i><span>Guest view</span>
            </button>
            <button class="btn tile tile-party" type="button" id="btn-disco" title="Dance party (P)">
              <i>🕺</i><span>Party</span>
            </button>
            <button class="btn tile" type="button" id="btn-money" title="Geef €25 aan de dichtstbijzijnde sim (G)">
              <i>💰</i><span>Geef geld</span>
            </button>
            <button class="btn tile" type="button" id="btn-thief" title="Roep de baard-dief (T)">
              <i>🧔</i><span>Dief</span>
            </button>
            <button type="button" class="btn tile tile-up" id="btn-mood-up" title="Iedereen blijer">
              <i>😊</i><span>Mood +</span>
            </button>
            <button type="button" class="btn tile tile-down" id="btn-mood-down" title="Iedereen chagrijniger">
              <i>😭</i><span>Mood −</span>
            </button>
          </div>

          <div class="search-wrap">
            <input id="search" type="search" placeholder="Zoek winkel (bijv. Rituals)…" autocomplete="off" />
          </div>

          <div class="cats" id="cats"></div>
          <div class="store-list" id="store-list"></div>

          <div class="detail hidden" id="detail"></div>
          <div class="steps hidden" id="steps"></div>
        </aside>

        <div class="crosshair hidden" id="crosshair"><i></i></div>

        <div class="minimap-wrap">
          <div class="minimap-head">
            <span class="minimap-label" id="minimap-floor">V0 · BEGANE GROND</span>
            <span class="minimap-zoom">
              <button type="button" id="map-out" title="Uitzoomen (−)">−</button>
              <button type="button" id="map-in" title="Inzoomen (+)">+</button>
              <button type="button" id="map-big" title="Grote plattegrond (M)">⛶</button>
            </span>
          </div>
          <canvas id="minimap"></canvas>
          <div class="minimap-foot" id="minimap-foot"><b>M</b> = grote plattegrond</div>
        </div>

        <div class="hint-bar" id="hint">
          <b>WASD</b> lopen · <b>Shift</b> rennen · <b>Ctrl</b> hurken · <b>Space</b> spring ·
          <b>M</b> kaart · <b>B</b> bewoners · <b>O</b> besturing
        </div>
        <div class="possess-banner hidden" id="possess-banner">GUEST VIEW</div>
      </div>

      <div class="bigmap hidden" id="bigmap">
        <div class="bigmap-card">
          <header class="bigmap-head">
            <div>
              <h2>Plattegrond · Prairie Lakes</h2>
              <p>Jij bent de pijl. Geel = route. <b>⇅</b> = roltrap/trap naar de andere verdieping.</p>
            </div>
            <div class="bigmap-tabs" id="bigmap-tabs">
              <button type="button" class="btn ghost" id="bigmap-close">Sluiten (M)</button>
            </div>
          </header>
          <canvas id="bigmap-canvas"></canvas>
        </div>
      </div>

      <div class="arrive hidden" id="arrive">
        <div class="arrive-card">
          <div class="arrive-badge">JE BENT ER</div>
          <h2 id="arrive-title">Kruidvat</h2>
          <p id="arrive-msg">Je staat bij de ingang.</p>
          <div class="arrive-actions">
            <button type="button" class="btn primary" id="btn-replay">Nog een keer</button>
            <button type="button" class="btn ghost" id="btn-done">Terug naar kiosk</button>
          </div>
        </div>
      </div>
    `;

		this.elBoot = qs(this.root, '#boot');
		this.elHud = qs(this.root, '#hud');
		this.elPanel = qs(this.root, '#panel');
		this.elSearch = qs<HTMLInputElement>(this.root, '#search');
		this.elList = qs(this.root, '#store-list');
		this.elDetail = qs(this.root, '#detail');
		this.elStatus = qs(this.root, '#status');
		this.elArrive = qs(this.root, '#arrive');
		this.elMinimap = qs<HTMLCanvasElement>(this.root, '#minimap');
		this.elMapFloor = qs(this.root, '#minimap-floor');
		this.elMapFoot = qs(this.root, '#minimap-foot');
		this.elBigMap = qs(this.root, '#bigmap');
		this.elBigCanvas = qs<HTMLCanvasElement>(this.root, '#bigmap-canvas');
		this.elCrosshair = qs(this.root, '#crosshair');
		this.elSteps = qs(this.root, '#steps');
		this.elScore = qs(this.root, '#score');
		this.elNearby = qs(this.root, '#nearby-sim');
		this.elPossessBanner = qs(this.root, '#possess-banner');

		this.renderCats();
		this.renderList();
		this.wireMap();

		this.elSearch.addEventListener('input', () => {
			this.filter = this.elSearch.value.trim().toLowerCase();
			this.renderList();
		});

		const panelToggle = qs<HTMLButtonElement>(this.root, '#panel-toggle');
		panelToggle.addEventListener('click', () => {
			const collapsed = this.elPanel.classList.toggle('collapsed');
			panelToggle.setAttribute('aria-expanded', String(!collapsed));
		});

		qs(this.root, '#btn-kruidvat').addEventListener('click', () => {
			const k = getKruidvat();
			this.selectStore(k);
			this.callbacks.onStartRoute(k);
		});

		qs(this.root, '#btn-home').addEventListener('click', () => {
			this.callbacks.onHome();
		});

		qs(this.root, '#btn-possess').addEventListener('click', () => {
			this.callbacks.onPossess();
		});
		qs(this.root, '#btn-disco').addEventListener('click', () => {
			this.callbacks.onDisco();
		});
		qs(this.root, '#btn-money').addEventListener('click', () => {
			this.callbacks.onGiveMoney();
		});
		qs(this.root, '#btn-thief').addEventListener('click', () => {
			this.callbacks.onSummonThief();
		});
		qs(this.root, '#btn-mood-up').addEventListener('click', () => {
			this.callbacks.onMood(-15);
		});
		qs(this.root, '#btn-mood-down').addEventListener('click', () => {
			this.callbacks.onMood(15);
		});

		qs(this.root, '#btn-replay').addEventListener('click', () => {
			this.hideArrive();
			this.callbacks.onReplay();
		});

		qs(this.root, '#btn-done').addEventListener('click', () => {
			this.hideArrive();
			this.callbacks.onHome();
		});
	}

	hideBoot(): void {
		this.elBoot.classList.add('fade-out');
		setTimeout(() => {
			this.elBoot.classList.add('hidden');
			this.elHud.classList.remove('hidden');
		}, 500);
	}

	setStatus(text: string): void {
		this.elStatus.textContent = text;
	}

	setScore(score: number, met: number): void {
		this.elScore.textContent = `★ ${score} · ${met} sims met`;
	}

	setNearbySim(line: string | null): void {
		if (!line) {
			this.elNearby.classList.add('hidden');
			this.elNearby.textContent = '';
			return;
		}
		this.elNearby.classList.remove('hidden');
		this.elNearby.textContent = `👤 ${line}`;
	}

	setPossessing(on: boolean, name?: string): void {
		if (on) {
			this.elPossessBanner.classList.remove('hidden');
			this.elPossessBanner.textContent = `👁 GUEST VIEW · ${name ?? 'Gast'} · Esc/V stop`;
		} else {
			this.elPossessBanner.classList.add('hidden');
		}
	}

	showTouring(store: StoreDef): void {
		this.setStatus(`Onderweg naar ${store.name.replace('\n', ' ')}…`);
		this.elDetail.classList.add('touring');
	}

	showArrive(store: StoreDef): void {
		this.elArrive.classList.remove('hidden');
		const title = qs(this.root, '#arrive-title');
		const msg = qs(this.root, '#arrive-msg');
		title.textContent = store.name.replace('\n', ' ');
		if (store.id === 'kruidvat') {
			msg.textContent = 'Je staat bij Kruidvat. Shampoo voor je moeder, vitamines, klaar. Fijne shopping.';
		} else if (store.id === 'rituals') {
			msg.textContent = 'Rituals! Die shampoo die zo expand… je moeder gaat “oeh, dat is leuk!” zeggen.';
		} else {
			msg.textContent = `Je staat voor ${store.name.replace('\n', ' ')}.`;
		}
		this.setStatus(`Aangekomen · ${store.name.replace('\n', ' ')}`);
	}

	hideArrive(): void {
		this.elArrive.classList.add('hidden');
	}

	showSteps(steps: string[], distanceM: number, floors: string): void {
		this.elSteps.classList.remove('hidden');
		this.elSteps.innerHTML = `
      <div class="steps-meta">
        <span>~${Math.round(distanceM)} m</span>
        <span>${floors}</span>
      </div>
      <ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    `;
	}

	hideSteps(): void {
		this.elSteps.classList.add('hidden');
	}

	clearSelection(): void {
		this.selected = null;
		this.elDetail.classList.add('hidden');
		this.elDetail.classList.remove('touring');
		this.hideSteps();
		this.renderList();
		this.setStatus('Bij de kiosk · kies een winkel in de lijst');
	}

	/** Crosshair only while the mouse is actually captured. */
	setLocked(locked: boolean): void {
		this.elCrosshair.classList.toggle('hidden', !locked);
	}

	/**
	 * Called every frame with the real player transform. Canvas work is throttled:
	 * 30 Hz for the radar, 12 Hz for the full plan — indistinguishable while
	 * walking, and it keeps the 2D repaint off the 60 Hz render budget.
	 */
	updateMap(state: MapState): void {
		this.map = state;
		this.mapClock++;
		if (this.bigOpen) {
			// The plan covers the screen; don't also paint the radar underneath
			if (this.mapClock % 5 === 0) this.paintBigMap();
			return;
		}
		if (this.mapClock % 2 === 0) {
			this.paintMiniMap();
			this.paintMapChrome();
		}
	}

	toggleBigMap(force?: boolean): void {
		const open = force === undefined ? !this.bigOpen : force;
		this.bigOpen = open;
		this.elBigMap.classList.toggle('hidden', !open);
		if (open) {
			this.bigLevel = this.map.level;
			this.renderBigTabs();
			this.paintBigMap();
		}
	}

	private wireMap(): void {
		const on = (sel: string, fn: () => void) => qs(this.root, sel).addEventListener('click', fn);

		on('#map-in', () => this.setZoom(this.zoom + 1));
		on('#map-out', () => this.setZoom(this.zoom - 1));
		on('#map-big', () => this.toggleBigMap());
		on('#bigmap-close', () => this.toggleBigMap(false));

		this.elBigMap.addEventListener('click', (e) => {
			if (e.target === this.elBigMap) this.toggleBigMap(false);
		});

		this.buildBigTabs();

		this.elMinimap.addEventListener(
			'wheel',
			(e) => {
				e.preventDefault();
				this.setZoom(this.zoom + (e.deltaY < 0 ? 1 : -1));
			},
			{ passive: false },
		);

		window.addEventListener('keydown', (e) => {
			if (isTypingTarget(e.target)) return;
			if (e.code === 'KeyM' || e.code === 'Tab') {
				e.preventDefault();
				this.toggleBigMap();
			} else if (e.code === 'Escape' && this.bigOpen) {
				this.toggleBigMap(false);
			} else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
				this.setZoom(this.zoom + 1);
			} else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
				this.setZoom(this.zoom - 1);
			}
		});

		this.renderBigTabs();
	}

	private setZoom(step: number): void {
		this.zoom = clamp(step, 0, ZOOM_STEPS.length - 1);
	}

	/** One tab per deck the world has, bottom deck first. */
	private buildBigTabs(): void {
		const host = qs(this.root, '#bigmap-tabs');
		const close = qs(this.root, '#bigmap-close');
		for (const deck of LEVELS_BOTTOM_UP) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'bigmap-tab';
			button.textContent = deck.name;
			button.title = deck.hint;
			button.addEventListener('click', () => {
				this.bigLevel = deck.id;
				this.renderBigTabs();
				this.paintBigMap();
			});
			host.insertBefore(button, close);
			this.bigTabs.push({ button, level: deck.id });
		}
	}

	private renderBigTabs(): void {
		for (const tab of this.bigTabs) tab.button.classList.toggle('active', tab.level === this.bigLevel);
	}

	private prep(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D | null {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = Math.max(1, Math.round(cssW * dpr));
		const h = Math.max(1, Math.round(cssH * dpr));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
			canvas.style.width = `${cssW}px`;
			canvas.style.height = `${cssH}px`;
		}
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, cssW, cssH);
		return ctx;
	}

	private paintMiniMap(): void {
		const size = MINIMAP.size;
		const ctx = this.prep(this.elMinimap, size, size);
		if (!ctx) return;

		const cx = half(size);
		const cy = half(size);
		const r = cx - MINIMAP.rim;
		const scale = at(ZOOM_STEPS, this.zoom);
		const lvl = this.map.level;

		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fillStyle = MAP_BACKDROP;
		ctx.fill();
		ctx.clip();

		// World layer: rotated so the way you face is up
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(this.map.yaw);
		ctx.scale(scale, scale);
		ctx.translate(-this.map.x, -this.map.z);
		this.paintWorld(ctx, lvl, 'world', scale);
		ctx.restore();

		// Upright labels for whatever is close by, under the plan's own rules
		for (const planned of minimapLabelPlan(ctx, {
			x: this.map.x,
			z: this.map.z,
			yaw: this.map.yaw,
			level: lvl,
			zoom: this.zoom,
		}).plan) {
			drawLabel(ctx, planned.label, planned.point, planned.vertical, planned.weight, planned.color);
		}

		// View cone — screen space, always pointing up
		const cone = 44;
		const halfFov = 0.61; // ~70° fov
		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.arc(cx, cy, cone, -Math.PI / 2 - halfFov, -Math.PI / 2 + halfFov);
		ctx.closePath();
		const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cone);
		grad.addColorStop(0, 'rgba(96,165,250,0.35)');
		grad.addColorStop(1, 'rgba(96,165,250,0)');
		ctx.fillStyle = grad;
		ctx.fill();

		ctx.restore(); // un-clip

		// Dish ring
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.strokeStyle = 'rgba(148,163,184,0.45)';
		ctx.lineWidth = 2;
		ctx.stroke();

		// North marker (world −Z is the top of the mall)
		const nx = cx + Math.sin(this.map.yaw) * (r - 11);
		const ny = cy - Math.cos(this.map.yaw) * (r - 11);
		ctx.fillStyle = '#f87171';
		ctx.font = '700 9px ui-monospace, monospace';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('N', nx, ny);

		this.drawArrow(ctx, cx, cy, 0, 7);
	}

	/** Every map-visible entity on this deck, painted by its schema layer. */
	private paintFeatures(ctx: CanvasRenderingContext2D, lvl: LevelId, scope: MapScope, px: number): void {
		for (const feature of featuresOn(lvl, scope)) {
			const style = LAYER_STYLES[feature.layer];
			ctx.fillStyle = feature.hero ? HERO_FILL : style.fill;
			ctx.strokeStyle = feature.hero ? HERO_STROKE : style.stroke;
			ctx.lineWidth = style.lineWidth * px;
			ctx.setLineDash(style.dash > 0 ? [style.dash * px, style.dash * px] : []);
			for (const shape of feature.shapes) {
				tracePlan(ctx, shape);
				ctx.fill();
				ctx.stroke();
			}
		}
		ctx.setLineDash([]);
	}

	/**
	 * Daklaag bovenop de schema-lagen: het zandeiland, het open skylight, de
	 * helipad-H, het zwembad en de glijbaantoren. Dekken, trapgat en liftschacht
	 * komen uit `WORLD_ENTITIES`.
	 */
	private paintRoofLayer(ctx: CanvasRenderingContext2D, px: number): void {
		// Atrium-skylight (open — hier vlieg je doorheen)
		ctx.fillStyle = 'rgba(56,120,190,0.4)';
		ctx.fillRect(-half(ATRIUM_VOID.width), -half(ATRIUM_VOID.depth), ATRIUM_VOID.width, ATRIUM_VOID.depth);
		ctx.setLineDash([1.2 * px * 3, 1.2 * px * 3]);
		ctx.strokeStyle = 'rgba(125,211,252,0.8)';
		ctx.lineWidth = 1.5 * px;
		ctx.strokeRect(-half(ATRIUM_VOID.width), -half(ATRIUM_VOID.depth), ATRIUM_VOID.width, ATRIUM_VOID.depth);
		ctx.setLineDash([]);

		// Helipad-H
		ctx.strokeStyle = '#f5c518';
		ctx.lineWidth = 2 * px;
		ctx.beginPath();
		ctx.arc(HELIPAD_PAD_SPEC.center.x, HELIPAD_PAD_SPEC.center.z, HELIPAD_PAD_SPEC.mapRadius, 0, Math.PI * 2);
		ctx.stroke();

		// Zwembad: dezelfde waterlijn waar inPool() op rekent
		ctx.fillStyle = 'rgba(56,189,248,0.75)';
		ctx.beginPath();
		POOL_POLYGON.forEach(([x, z], index) => {
			if (index === 0) ctx.moveTo(x, z);
			else ctx.lineTo(x, z);
		});
		ctx.closePath();
		ctx.fill();

		// Glijbaantoren
		ctx.fillStyle = '#ffca28';
		ctx.fillRect(
			SLIDE_PLATFORM.center.x - half(SLIDE_PLATFORM.size),
			SLIDE_PLATFORM.center.z - half(SLIDE_PLATFORM.size),
			SLIDE_PLATFORM.size,
			SLIDE_PLATFORM.size,
		);
	}

	private paintWorld(ctx: CanvasRenderingContext2D, lvl: LevelId, scope: MapScope, scale: number): void {
		const px = 1 / scale;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';

		// Rooms, shells, shafts and holes — whatever the schema puts on this deck
		this.paintFeatures(ctx, lvl, scope, px);

		if (lvl === 'roof') this.paintRoofLayer(ctx, px);

		// Walkable corridors, straight from the wayfinding graph
		ctx.strokeStyle = 'rgba(226,232,240,0.14)';
		ctx.lineWidth = 3.4 * px;
		ctx.beginPath();
		for (const c of CORRIDORS) {
			if (c.level !== lvl) continue;
			ctx.moveTo(c.ax, c.az);
			ctx.lineTo(c.bx, c.bz);
		}
		ctx.stroke();

		// Route — bright on this floor, ghosted on the other
		const path = this.map.path;
		if (path.length > 1) {
			for (const pass of [0, 1]) {
				ctx.beginPath();
				let drawn = false;
				for (let i = 1; i < path.length; i++) {
					const a = path[i - 1];
					const b = path[i];
					if (!a || !b) continue;
					const here = levelAt(midpoint(a.y, b.y)) === lvl;
					if ((pass === 0) === here) continue;
					ctx.moveTo(a.x, a.z);
					ctx.lineTo(b.x, b.z);
					drawn = true;
				}
				if (!drawn) continue;
				ctx.strokeStyle = pass === 0 ? 'rgba(234,179,8,0.25)' : '#fde047';
				ctx.lineWidth = (pass === 0 ? 2 : 3.2) * px;
				ctx.stroke();
			}
		}

		// Kiosk — alleen op het dek waar hij staat
		if (lvl === KIOSK.level) {
			ctx.fillStyle = '#22d3ee';
			ctx.beginPath();
			ctx.arc(KIOSK.x, KIOSK.z, 1.1, 0, Math.PI * 2);
			ctx.fill();
		}

		// Sims
		ctx.fillStyle = 'rgba(248,250,252,0.75)';
		for (const b of this.map.blips) {
			if (b.level !== lvl) continue;
			ctx.beginPath();
			ctx.arc(b.x, b.z, 0.55, 0, Math.PI * 2);
			ctx.fill();
		}

		// Destination
		const t = this.map.target;
		if (t) {
			ctx.strokeStyle = t.level === lvl ? '#f43f5e' : 'rgba(244,63,94,0.4)';
			ctx.lineWidth = 2 * px;
			ctx.beginPath();
			ctx.arc(t.x, t.z, 2.4, 0, Math.PI * 2);
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(t.x, t.z, 0.8, 0, Math.PI * 2);
			ctx.fillStyle = ctx.strokeStyle;
			ctx.fill();
		}
	}

	/** North-up labels for the big plan, in screen space so text stays crisp. */
	private paintBigLabels(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, scale: number, lvl: LevelId): void {
		const sx = (x: number) => half(cssW) + (x - PLAN_FRAME_CENTER.x) * scale;
		const sy = (z: number) => half(cssH) + (z - PLAN_FRAME_CENTER.z) * scale;
		for (const planned of deckLabelPlan(ctx, lvl, cssW).plan) {
			drawLabel(ctx, planned.label, planned.point, planned.vertical, planned.weight, planned.color);
		}

		ctx.fillStyle = 'rgba(148,163,184,0.8)';
		ctx.font = '600 10px ui-monospace, monospace';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('N ↑', sx(PLAN_FRAME_CENTER.x), sy(-half(MALL_FOOTPRINT.depth)) - 12);
	}

	private paintBigMap(): void {
		const host = this.elBigCanvas.parentElement;
		const cssW = Math.max(BIG_MAP_MIN_WIDTH, (host?.clientWidth ?? BIG_MAP_FALLBACK_WIDTH) - BIG_MAP_PADDING);
		const cssH = bigMapHeight(cssW);
		const ctx = this.prep(this.elBigCanvas, cssW, cssH);
		if (!ctx) return;

		ctx.fillStyle = MAP_BACKDROP;
		ctx.fillRect(0, 0, cssW, cssH);

		const scale = bigMapScale(cssW);
		ctx.save();
		ctx.translate(half(cssW), half(cssH));
		ctx.scale(scale, scale);
		ctx.translate(-PLAN_FRAME_CENTER.x, -PLAN_FRAME_CENTER.z);
		this.paintWorld(ctx, this.bigLevel, 'mall', scale);
		ctx.restore();
		this.paintBigLabels(ctx, cssW, cssH, scale, this.bigLevel);

		// You are here — only on the deck you're standing on
		if (this.bigLevel === this.map.level) {
			const sx = half(cssW) + (this.map.x - PLAN_FRAME_CENTER.x) * scale;
			const sy = half(cssH) + (this.map.z - PLAN_FRAME_CENTER.z) * scale;
			this.drawArrow(ctx, sx, sy, -this.map.yaw, 9);
		} else {
			ctx.fillStyle = 'rgba(226,232,240,0.75)';
			ctx.font = '600 12px ui-monospace, monospace';
			ctx.textAlign = 'left';
			ctx.fillText(`Je staat op ${level(this.map.level).code} — neem de roltrap (⇅) om hier te komen`, 14, cssH - 14);
		}
	}

	/** Player marker: triangle + dot, `rot` in radians (0 = up). */
	private drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, size: number): void {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(rot);
		ctx.beginPath();
		ctx.moveTo(0, -size);
		ctx.lineTo(size * 0.72, size * 0.8);
		ctx.lineTo(0, size * 0.42);
		ctx.lineTo(-size * 0.72, size * 0.8);
		ctx.closePath();
		ctx.fillStyle = '#38bdf8';
		ctx.fill();
		ctx.lineWidth = 1.4;
		ctx.strokeStyle = '#0f172a';
		ctx.stroke();
		ctx.restore();
	}

	private paintMapChrome(): void {
		const here = level(this.map.level);
		const floorText = `${here.code} · ${here.name.toUpperCase()}`;
		if (this.elMapFloor.textContent !== floorText) {
			this.elMapFloor.textContent = floorText;
		}

		const t = this.map.target;
		let foot = '<b>M</b> = grote plattegrond';
		if (t) {
			const d = Math.round(Math.hypot(t.x - this.map.x, t.z - this.map.z));
			foot = t.level === this.map.level ? `→ ${t.name} · ${d} m` : `→ ${t.name} · ${d} m · <b>⇅ ${level(t.level).code}</b>`;
		}
		if (this.elMapFoot.innerHTML !== foot) this.elMapFoot.innerHTML = foot;
	}

	private selectStore(store: StoreDef): void {
		this.selected = store;
		this.renderList();
		this.renderDetail(store);
		this.callbacks.onSelectStore(store);
	}

	private renderCats(): void {
		const el = this.root.querySelector('#cats');
		if (!el) return;
		const cats = ['all', 'beauty', 'fashion', 'tech', 'food', 'sport', 'home', 'utility'] as const;
		el.innerHTML = cats
			.map(
				(c) =>
					`<button type="button" class="cat ${c === this.category ? 'active' : ''}" data-cat="${c}">${
						c === 'all' ? 'Alles' : CATEGORY_LABELS[c]
					}</button>`,
			)
			.join('');
		// The value came from `cats` two statements up; look it back up there
		// instead of asserting a dataset string into the union.
		el.querySelectorAll<HTMLElement>('.cat').forEach((btn) => {
			btn.addEventListener('click', () => {
				const picked = cats.find((c) => c === btn.dataset['cat']);
				if (!picked) return;
				this.category = picked;
				this.renderCats();
				this.renderList();
			});
		});
	}

	private renderList(): void {
		const items = STORES.filter((s) => {
			if (s.id === 'info') return false;
			if (this.category !== 'all' && s.category !== this.category) return false;
			if (!this.filter) return true;
			const inv = getInventory(s.id);
			const blob = `${s.name} ${s.id} ${s.blurb ?? ''} ${inv?.slogan ?? ''} ${
				inv?.items.map((i) => i.name).join(' ') ?? ''
			}`.toLowerCase();
			return blob.includes(this.filter);
		});

		// Rituals near top when searching mom vibes isn't needed — just clean list
		this.elList.innerHTML = items
			.map(
				(s) => `
      <button type="button" class="store-item ${this.selected?.id === s.id ? 'active' : ''} ${s.hero ? 'hero' : ''} ${
				s.utility ? 'utility' : ''
			}" data-id="${s.id}">
        <span class="store-dot" style="background:${s.accent}"></span>
        <span class="store-meta">
          <strong>${s.name.replace('\n', ' ')}</strong>
          <small>${level(s.level).code} · ${CATEGORY_LABELS[s.category]}${s.utility ? ' · util' : ''}${
						s.id === 'rituals' ? ' · ❤️ mama' : ''
					}${s.id === 'helipad' ? ' · 🚁' : ''}</small>
        </span>
      </button>`,
			)
			.join('');

		this.elList.querySelectorAll<HTMLElement>('.store-item').forEach((btn) => {
			btn.addEventListener('click', () => {
				const store = STORES.find((s) => s.id === btn.dataset['id']);
				if (store) this.selectStore(store);
			});
		});
	}

	private renderDetail(store: StoreDef): void {
		this.elDetail.classList.remove('hidden', 'touring');
		const inv = getInventory(store.id);
		const stock = inv?.items.length
			? `<ul class="detail-stock">${inv.items
					.slice(0, 8)
					.map((i) => `<li>${i.name}${i.price > 0 ? ` · €${i.price}` : ''}</li>`)
					.join('')}</ul>`
			: '';
		const blurb = store.blurb
			? `<p class="detail-blurb">${store.blurb}</p>`
			: inv?.slogan
				? `<p class="detail-blurb">${inv.slogan}</p>`
				: '';
		this.elDetail.innerHTML = `
      <div class="detail-top">
        <div class="detail-swatch" style="background:${store.color};border-color:${store.accent}"></div>
        <div>
          <h2>${store.name.replace('\n', ' ')}</h2>
          <p>${level(store.level).name} · ${CATEGORY_LABELS[store.category]}</p>
        </div>
      </div>
      ${blurb}
      ${stock}
      <div class="detail-actions">
        <button type="button" class="btn primary" id="btn-go">Start route (lopen)</button>
        <button type="button" class="btn ghost" id="btn-cancel">Annuleer</button>
      </div>
    `;
		qs(this.elDetail, '#btn-go').addEventListener('click', () => {
			this.callbacks.onStartRoute(store);
		});
		qs(this.elDetail, '#btn-cancel').addEventListener('click', () => {
			this.clearSelection();
			this.callbacks.onCancel();
		});
	}
}
