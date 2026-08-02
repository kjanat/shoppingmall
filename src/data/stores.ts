import type { NodeId } from './graph';
import type { LevelId } from './levels';

export type StoreCategory = 'beauty' | 'fashion' | 'food' | 'tech' | 'home' | 'sport' | 'services' | 'utility';

export interface StoreDef {
	id: string;
	name: string;
	category: StoreCategory;
	/** Which deck it sits on. Shops never live in the garage. */
	level: LevelId;
	/** World position of storefront center */
	x: number;
	z: number;
	/** Facing: angle around Y in radians (0 = +Z) */
	rotation: number;
	width: number;
	depth: number;
	color: string;
	accent: string;
	/** Bigger facade, red fill, accent on the shopfront. Not "the main route". */
	hero?: boolean;
	/** Graph node id for entrance */
	nodeId: NodeId;
	/**
	 * Directory-only place (WC, gebed, helipad, geheime trap, beard cave).
	 * No shop pod mesh — already built elsewhere or pure destination.
	 */
	utility?: boolean;
	/** Short blurb for the list detail panel */
	blurb?: string;
}

export const CATEGORY_LABELS: Record<StoreCategory, string> = {
	beauty: 'Beauty & gezondheid',
	fashion: 'Mode',
	food: 'Horeca',
	tech: 'Tech',
	home: 'Wonen',
	sport: 'Sport',
	services: 'Services',
	utility: 'Utilities',
};

/**
 * Mall layout (72×48, center atrium).
 *
 * FLOOR 0
 *  N wall z=-18: Zara · H&M · MediaWorld · Nike
 *  S wall z=18:  Starbucks · Primark · Apple · Ikea  (cleared SW for utilities)
 *  W wall: Douglas (−30,−8), prayer NW, toilets (−30,12), island (−30,18), cave (−33.5,20)
 *  E wall: Game (30,0), Saucy (30,−10)
 *  Center: kiosk (0,9), protest (8,4)
 *
 * FLOOR 1 (outside void ±8×±6)
 *  N wall: Uniqlo · Sephora · Kruidvat
 *  S wall: Decathlon · Rituals · Coolblue · Action
 *  Food court balcony (0, 11.5) — between void and south stores
 *  Secret stairs SE → helipad roof
 */
export const STORES: StoreDef[] = [
	// ── Floor 0 north ────────────────────────────────────
	{
		id: 'zara',
		name: 'ZARA',
		category: 'fashion',
		level: 'v0',
		x: -22,
		z: -18,
		rotation: 0,
		width: 10,
		depth: 6,
		color: '#1a1a1a',
		accent: '#ffffff',
		nodeId: 's_zara',
	},
	{
		id: 'hm',
		name: 'H&M',
		category: 'fashion',
		level: 'v0',
		x: -8,
		z: -18,
		rotation: 0,
		width: 10,
		depth: 6,
		color: '#c41e3a',
		accent: '#ffffff',
		nodeId: 's_hm',
	},
	{
		id: 'mediaworld',
		name: 'MEDIA\nWORLD',
		category: 'tech',
		level: 'v0',
		x: 6,
		z: -18,
		rotation: 0,
		width: 12,
		depth: 6,
		color: '#0b3d91',
		accent: '#ffcc00',
		nodeId: 's_media',
	},
	{
		id: 'nike',
		name: 'NIKE',
		category: 'sport',
		level: 'v0',
		x: 20,
		z: -18,
		rotation: 0,
		width: 10,
		depth: 6,
		color: '#111111',
		accent: '#ffffff',
		nodeId: 's_nike',
	},
	// ── Floor 0 south (shops east of utility strip) ───────
	{
		id: 'starbucks',
		name: 'STARBUCKS',
		category: 'food',
		level: 'v0',
		x: -14,
		z: 18,
		rotation: Math.PI,
		width: 8,
		depth: 5,
		color: '#00704a',
		accent: '#d4e9e2',
		nodeId: 's_starbucks',
	},
	{
		id: 'primark',
		name: 'PRIMARK',
		category: 'fashion',
		level: 'v0',
		x: -2,
		z: 18,
		rotation: Math.PI,
		width: 10,
		depth: 6,
		color: '#005eb8',
		accent: '#ffd100',
		nodeId: 's_primark',
	},
	{
		id: 'apple',
		name: 'APPLE',
		category: 'tech',
		level: 'v0',
		x: 12,
		z: 18,
		rotation: Math.PI,
		width: 10,
		depth: 6,
		color: '#1d1d1f',
		accent: '#a1a1a6',
		nodeId: 's_apple',
	},
	{
		id: 'ikea',
		name: 'IKEA',
		category: 'home',
		level: 'v0',
		x: 26,
		z: 18,
		rotation: Math.PI,
		width: 10,
		depth: 6,
		color: '#0051ba',
		accent: '#ffdb00',
		nodeId: 's_ikea',
	},
	// ── Floor 0 west / east sides ─────────────────────────
	{
		id: 'douglas',
		name: 'DOUGLAS',
		category: 'beauty',
		level: 'v0',
		x: -30,
		z: -8,
		rotation: Math.PI / 2,
		width: 8,
		depth: 5,
		color: '#2d0a1a',
		accent: '#e8b4c8',
		nodeId: 's_douglas',
	},
	{
		id: 'gamesman',
		name: 'GAME\nMANIA',
		category: 'tech',
		level: 'v0',
		x: 30,
		z: 0,
		rotation: -Math.PI / 2,
		width: 8,
		depth: 5,
		color: '#1a0a2e',
		accent: '#9b5de5',
		nodeId: 's_game',
	},
	{
		id: 'saucy',
		name: 'SAUCY',
		category: 'beauty',
		level: 'v0',
		x: 30,
		z: -10,
		rotation: -Math.PI / 2,
		width: 8,
		depth: 5.5,
		color: '#1a0510',
		accent: '#ff2d6a',
		nodeId: 's_saucy',
	},

	// ── Floor 1 ──────────────────────────────────────────
	{
		id: 'kruidvat',
		name: 'KRUIDVAT',
		category: 'beauty',
		level: 'v1',
		x: 18,
		z: -18,
		rotation: 0,
		width: 14,
		depth: 7,
		color: '#e30613',
		accent: '#00a651',
		hero: true,
		/** Epic route ends under the UFO (then near Kruidvat) */
		nodeId: 'spaceship',
	},
	{
		id: 'sephora',
		name: 'SEPHORA',
		category: 'beauty',
		level: 'v1',
		x: 0,
		z: -18,
		rotation: 0,
		width: 10,
		depth: 6,
		color: '#000000',
		accent: '#ffffff',
		nodeId: 's_sephora',
	},
	{
		id: 'uniqlo',
		name: 'UNIQLO',
		category: 'fashion',
		level: 'v1',
		x: -16,
		z: -18,
		rotation: 0,
		width: 10,
		depth: 6,
		color: '#ff0000',
		accent: '#ffffff',
		nodeId: 's_uniqlo',
	},
	{
		id: 'decathlon',
		name: 'DECATHLON',
		category: 'sport',
		level: 'v1',
		x: -20,
		z: 18,
		rotation: Math.PI,
		width: 12,
		depth: 6,
		color: '#0082c3',
		accent: '#ffed00',
		nodeId: 's_decathlon',
	},
	{
		id: 'rituals',
		name: 'RITUALS',
		category: 'beauty',
		level: 'v1',
		x: -8,
		z: 18,
		rotation: Math.PI,
		width: 8,
		depth: 5,
		color: '#3d2914',
		accent: '#c4a574',
		nodeId: 's_rituals',
	},
	{
		id: 'coolblue',
		name: 'COOLBLUE',
		category: 'tech',
		level: 'v1',
		x: 10,
		z: 18,
		rotation: Math.PI,
		width: 12,
		depth: 6,
		color: '#0090e3',
		accent: '#ff9c00',
		nodeId: 's_coolblue',
	},
	{
		id: 'action',
		name: 'ACTION',
		category: 'home',
		level: 'v1',
		x: 24,
		z: 18,
		rotation: Math.PI,
		width: 8,
		depth: 5,
		color: '#e30613',
		accent: '#ffffff',
		nodeId: 's_action',
	},
	/** Food court — V1 south balcony strip (not overlapping store pods) */
	{
		id: 'foodcourt',
		name: 'FOOD\nCOURT',
		category: 'food',
		level: 'v1',
		x: 0,
		z: 11.5,
		rotation: Math.PI,
		width: 14,
		depth: 5,
		color: '#bf360c',
		accent: '#ffcc02',
		nodeId: 's_foodcourt',
		utility: true,
		blurb: 'V1 balkon · hangry zone · tussen void en zuidwinkels',
	},
	{
		id: 'info',
		name: 'INFO',
		category: 'services',
		level: 'v0',
		x: 0,
		z: 9,
		rotation: Math.PI,
		width: 4,
		depth: 3,
		color: '#00ffc8',
		accent: '#0a0a12',
		nodeId: 'kiosk',
	},

	// ── Utilities (aligned with scene meshes) ────────────
	{
		id: 'toilets',
		name: 'TOILETTEN',
		category: 'utility',
		level: 'v0',
		x: -30,
		z: 12,
		rotation: Math.PI / 2,
		width: 8,
		depth: 6,
		color: '#263238',
		accent: '#90caf9',
		nodeId: 'u_toilets',
		utility: true,
		blurb: 'Westmuur · heren · dames · wudu',
	},
	{
		id: 'prayer',
		name: 'GEBEDSRUIMTE',
		category: 'utility',
		level: 'v0',
		x: -31.5,
		z: -19.5,
		rotation: Math.PI / 2,
		width: 5.5,
		depth: 4.2,
		color: '#1b5e20',
		accent: '#a5d6a7',
		nodeId: 'u_prayer',
		utility: true,
		blurb: 'NW-hoek · Allahu Trapbar · geit · ayatollahs · wudu ernaast',
	},
	{
		id: 'secret_stairs',
		name: 'GEHEIME TRAP',
		category: 'utility',
		level: 'v1',
		x: 26,
		z: 14,
		rotation: Math.PI,
		width: 3,
		depth: 4,
		color: '#37474f',
		accent: '#ffc107',
		nodeId: 'sec_f1',
		utility: true,
		blurb: 'SE service · dak / helipad',
	},
	{
		id: 'helipad',
		name: 'HELIPAD',
		category: 'utility',
		level: 'roof',
		x: 22,
		z: 16,
		rotation: 0,
		width: 12,
		depth: 12,
		color: '#1a1a1a',
		accent: '#f5c518',
		nodeId: 'helipad',
		utility: true,
		hero: true,
		blurb: 'Dak · via geheime trap',
	},
	{
		id: 'beard_cave',
		name: "BEARD-MAN'S CAVE",
		category: 'utility',
		level: 'v0',
		x: -33.5,
		z: 20,
		rotation: Math.PI / 2,
		width: 4,
		depth: 5,
		color: '#3e3429',
		accent: '#ffd700',
		nodeId: 'u_beardcave',
		utility: true,
		blurb: 'ZW-hoek · juwelen · goud · baard-dief hol',
	},
	{
		id: 'island_hop',
		name: 'ISLAND HOP\nTRAVEL',
		category: 'services',
		level: 'v0',
		x: -30,
		z: 18,
		rotation: Math.PI / 2,
		width: 4,
		depth: 3.8,
		color: '#004d40',
		accent: '#ffd54f',
		nodeId: 's_islandhop',
		utility: true,
		blurb: 'Westmuur bij toiletten · Epstein Island · NDA desk',
	},
	{
		id: 'protest',
		name: 'PROTEST GROUPIES',
		category: 'utility',
		level: 'v0',
		x: 8,
		z: 4,
		rotation: 0,
		width: 6,
		depth: 6,
		color: '#1565c0',
		accent: '#ffeb3b',
		nodeId: 'u_protest',
		utility: true,
		blurb: 'Oost-atrium · Merkel · LGBTQIA+ · Wir schaffen das',
	},
	{
		id: 'elevator',
		name: 'GLAZEN LIFT',
		category: 'utility',
		level: 'v0',
		x: 16,
		z: -8,
		rotation: 0,
		width: 2.4,
		depth: 2.4,
		color: '#b3e5fc',
		accent: '#ffd700',
		nodeId: 'elev_f0',
		utility: true,
		blurb: 'Hans · P1 garage ↔ V0 ↔ V1 ↔ DAK · stap in en wacht',
	},
	{
		id: 'parking',
		name: 'PARKEERGARAGE',
		category: 'utility',
		level: 'v0',
		x: 8,
		z: 0,
		rotation: 0,
		width: 40,
		depth: 30,
		color: '#455a64',
		accent: '#ffc107',
		nodeId: 'u_parking',
		utility: true,
		blurb: "Ondergronds P1 · auto's · pillaren · via glazen lift",
	},
];

export function getStore(id: string): StoreDef | undefined {
	return STORES.find((s) => s.id === id);
}

/**
 * De winkels: alles wat een winkelpod, schappen en een verkoper krijgt.
 * Utility-bestemmingen en de infokiosk hebben elk hun eigen bouwer (FoodCourt,
 * Helipad, Restrooms, buildKiosk), dus een generieke pod met schappen
 * erbovenop is dubbele geometrie: zolang elke bouwer zelf filterde vergat
 * StockDisplay het en stonden er rekken op het helikopterdek.
 */
const SHOPS: StoreDef[] = STORES.filter((s) => !s.utility && s.id !== 'info');

export function shopStores(): readonly StoreDef[] {
	return SHOPS;
}

/**
 * Where the kiosk's main button walks you. Kruidvat by name, not by `hero`:
 * that flag is facade styling and two stores carry it.
 */
export function getKruidvat(): StoreDef {
	const store = STORES.find((s) => s.id === 'kruidvat');
	if (!store) throw new Error('no kruidvat in STORES');
	return store;
}
