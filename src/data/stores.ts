export type StoreCategory =
	| 'beauty'
	| 'fashion'
	| 'food'
	| 'tech'
	| 'home'
	| 'sport'
	| 'services'
	| 'utility';

export interface StoreDef {
	id: string;
	name: string;
	category: StoreCategory;
	/** 0 = begane grond, 1 = verdieping 1, 2 = dak / helipad */
	floor: 0 | 1 | 2;
	/** World position of storefront center */
	x: number;
	z: number;
	/** Facing: angle around Y in radians (0 = +Z) */
	rotation: number;
	width: number;
	depth: number;
	color: string;
	accent: string;
	hero?: boolean;
	/** Graph node id for entrance */
	nodeId: string;
	/**
	 * Directory-only place (WC, gebed, helipad, geheime trap).
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

export const FLOOR_LABELS: Record<0 | 1 | 2, string> = {
	0: 'Begane grond',
	1: 'Verdieping 1',
	2: 'Dak',
};

/** Night-neon mall store map. Kruidvat is the hero on floor 1. */
export const STORES: StoreDef[] = [
	// ── Floor 0 ──────────────────────────────────────────
	{
		id: 'zara',
		name: 'ZARA',
		category: 'fashion',
		floor: 0,
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
		floor: 0,
		x: -10,
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
		floor: 0,
		x: 4,
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
		floor: 0,
		x: 18,
		z: -18,
		rotation: 0,
		width: 10,
		depth: 6,
		color: '#111111',
		accent: '#ffffff',
		nodeId: 's_nike',
	},
	{
		id: 'starbucks',
		name: 'STARBUCKS',
		category: 'food',
		floor: 0,
		x: -22,
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
		floor: 0,
		x: -8,
		z: 18,
		rotation: Math.PI,
		width: 12,
		depth: 6,
		color: '#005eb8',
		accent: '#ffd100',
		nodeId: 's_primark',
	},
	{
		id: 'apple',
		name: 'APPLE',
		category: 'tech',
		floor: 0,
		x: 8,
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
		floor: 0,
		x: 22,
		z: 18,
		rotation: Math.PI,
		width: 10,
		depth: 6,
		color: '#0051ba',
		accent: '#ffdb00',
		nodeId: 's_ikea',
	},
	// Side stores floor 0
	{
		id: 'douglas',
		name: 'DOUGLAS',
		category: 'beauty',
		floor: 0,
		x: -30,
		z: 0,
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
		floor: 0,
		x: 30,
		z: 0,
		rotation: -Math.PI / 2,
		width: 8,
		depth: 5,
		color: '#1a0a2e',
		accent: '#9b5de5',
		nodeId: 's_game',
	},

	// ── Floor 1 ──────────────────────────────────────────
	{
		id: 'kruidvat',
		name: 'KRUIDVAT',
		category: 'beauty',
		floor: 1,
		x: 18,
		z: -18,
		rotation: 0,
		width: 14,
		depth: 7,
		color: '#e30613',
		accent: '#00a651',
		hero: true,
		/** Epic route ends under the hovering spaceship pad */
		nodeId: 'spaceship',
	},
	{
		id: 'sephora',
		name: 'SEPHORA',
		category: 'beauty',
		floor: 1,
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
		floor: 1,
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
		floor: 1,
		x: -22,
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
		floor: 1,
		x: -4,
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
		floor: 1,
		x: 12,
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
		floor: 1,
		x: 26,
		z: 18,
		rotation: Math.PI,
		width: 8,
		depth: 5,
		color: '#e30613',
		accent: '#ffffff',
		nodeId: 's_action',
	},
	/** Adult novelty — floor 0 east wing, past Gamesman */
	{
		id: 'saucy',
		name: 'SAUCY',
		category: 'beauty',
		floor: 0,
		x: 28,
		z: -8,
		rotation: -Math.PI / 2,
		width: 8,
		depth: 5.5,
		color: '#1a0510',
		accent: '#ff2d6a',
		nodeId: 's_saucy',
	},
	/** Open food court plaza — south of kiosk / atrium */
	{
		id: 'foodcourt',
		name: 'FOOD\nCOURT',
		category: 'food',
		floor: 0,
		x: 0,
		z: 13.5,
		rotation: Math.PI,
		width: 16,
		depth: 8,
		color: '#bf360c',
		accent: '#ffcc02',
		nodeId: 's_foodcourt',
		utility: true,
		blurb: 'Hangry zone · burgers · pizza · taco · soft serve · no diet zone',
	},
	{
		id: 'info',
		name: 'INFO',
		category: 'services',
		floor: 0,
		x: 0,
		z: 8,
		rotation: Math.PI,
		width: 4,
		depth: 3,
		color: '#00ffc8',
		accent: '#0a0a12',
		nodeId: 'kiosk',
	},

	// ── Utilities (directory + inventory, no shop pod) ───
	{
		id: 'toilets',
		name: 'TOILETTEN',
		category: 'utility',
		floor: 0,
		x: -28,
		z: 15.5,
		rotation: 0,
		width: 8,
		depth: 6,
		color: '#263238',
		accent: '#90caf9',
		nodeId: 'u_toilets',
		utility: true,
		blurb: 'Heren · Dames · gender apart · wudu bij de ingang',
	},
	{
		id: 'prayer',
		name: 'GEBEDSRUIMTE',
		category: 'utility',
		floor: 0,
		x: -28,
		z: 8,
		rotation: 0,
		width: 5.5,
		depth: 4.2,
		color: '#1b5e20',
		accent: '#a5d6a7',
		nodeId: 'u_prayer',
		utility: true,
		blurb: 'Stilte · respect · wudu ernaast',
	},
	{
		id: 'secret_stairs',
		name: 'GEHEIME TRAP',
		category: 'utility',
		floor: 1,
		x: 26,
		z: 14,
		rotation: Math.PI,
		width: 3,
		depth: 4,
		color: '#37474f',
		accent: '#ffc107',
		nodeId: 'sec_f1',
		utility: true,
		blurb: 'Service only · dak / helipad · niet voor gasten (toch wel)',
	},
	{
		id: 'helipad',
		name: 'HELIPAD',
		category: 'utility',
		floor: 2,
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
		blurb: 'Dak landing zone · H-mark · via geheime trap',
	},
];

export function getStore(id: string): StoreDef | undefined {
	return STORES.find((s) => s.id === id);
}

/** Shops only (no utilities / kiosk) — for sim shopping routes */
export function shopStores(): StoreDef[] {
	return STORES.filter((s) => !s.utility && s.id !== 'info');
}

export function getHeroStore(): StoreDef {
	return STORES.find((s) => s.hero)!;
}
