export type StoreCategory =
	| 'beauty'
	| 'fashion'
	| 'food'
	| 'tech'
	| 'home'
	| 'sport'
	| 'services';

export interface StoreDef {
	id: string;
	name: string;
	category: StoreCategory;
	floor: 0 | 1;
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
}

export const CATEGORY_LABELS: Record<StoreCategory, string> = {
	beauty: 'Beauty & gezondheid',
	fashion: 'Mode',
	food: 'Horeca',
	tech: 'Tech',
	home: 'Wonen',
	sport: 'Sport',
	services: 'Services',
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
];

export function getStore(id: string): StoreDef | undefined {
	return STORES.find((s) => s.id === id);
}

export function getHeroStore(): StoreDef {
	return STORES.find((s) => s.hero)!;
}
