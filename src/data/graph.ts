export interface GraphNode {
	id: string;
	x: number;
	y: number;
	z: number;
	label?: string;
}

export interface GraphEdge {
	from: string;
	to: string;
	/** Multiplier for distance cost (escalator slightly higher) */
	cost?: number;
}

/**
 * Waypoint graph for indoor wayfinding.
 * Floor 0 y=0.15, Floor 1 y=6.15 (slightly above floor for path mesh).
 * Escalator connects e0 ↔ e1.
 */
export const NODES: GraphNode[] = [
	// Kiosk / start
	{ id: 'kiosk', x: 0, y: 0.15, z: 10, label: 'Je bent hier' },

	// Floor 0 corridor spine (center walkway)
	{ id: 'f0_s', x: 0, y: 0.15, z: 6 },
	{ id: 'f0_c', x: 0, y: 0.15, z: 0, label: 'Atrium' },
	{ id: 'f0_n', x: 0, y: 0.15, z: -6 },
	{ id: 'f0_w', x: -14, y: 0.15, z: 0 },
	{ id: 'f0_e', x: 14, y: 0.15, z: 0 },
	{ id: 'f0_sw', x: -14, y: 0.15, z: 10 },
	{ id: 'f0_se', x: 14, y: 0.15, z: 10 },
	{ id: 'f0_nw', x: -14, y: 0.15, z: -10 },
	{ id: 'f0_ne', x: 14, y: 0.15, z: -10 },

	// Floor 0 store approaches
	{ id: 's_zara', x: -22, y: 0.15, z: -12 },
	{ id: 's_hm', x: -10, y: 0.15, z: -12 },
	{ id: 's_media', x: 4, y: 0.15, z: -12 },
	{ id: 's_nike', x: 18, y: 0.15, z: -12 },
	{ id: 's_starbucks', x: -22, y: 0.15, z: 12 },
	{ id: 's_primark', x: -8, y: 0.15, z: 12 },
	{ id: 's_apple', x: 8, y: 0.15, z: 12 },
	{ id: 's_ikea', x: 22, y: 0.15, z: 12 },
	{ id: 's_douglas', x: -24, y: 0.15, z: 0 },
	{ id: 's_game', x: 24, y: 0.15, z: 0 },
	{ id: 's_saucy', x: 26, y: 0.15, z: -8, label: 'Saucy' },
	{ id: 's_foodcourt', x: 0, y: 0.15, z: 13.5, label: 'Food court' },
	// Utilities floor 0
	{ id: 'u_toilets', x: -28, y: 0.15, z: 14, label: 'Toiletten' },
	{ id: 'u_prayer', x: -28, y: 0.15, z: 8, label: 'Gebedsruimte' },
	// Secret stairs floor 1 → roof helipad
	{ id: 'sec_f1', x: 26, y: 6.15, z: 14, label: 'Geheime trap V1' },
	{ id: 'sec_mid', x: 26, y: 10, z: 16, label: 'Geheime trap mid' },
	{ id: 'helipad', x: 22, y: 13.65, z: 16, label: 'Helipad' },

	// Escalator (east wing ONLY)
	{ id: 'e0', x: 22, y: 0.15, z: 8, label: 'Roltrap beneden' },
	{ id: 'e1', x: 22, y: 6.15, z: -2, label: 'Roltrap boven' },
	// Stairs (west wing ONLY — never crosses escalator)
	{ id: 'st0', x: -22, y: 0.15, z: 4, label: 'Trap beneden' },
	{ id: 'st1', x: -22, y: 6.15, z: -14, label: 'Trap boven' },

	// Floor 1 ring OUTSIDE atrium void (±8 x ±6) — no mid-air walking
	{ id: 'f1_c', x: 12, y: 6.15, z: 0 },
	{ id: 'f1_n', x: 0, y: 6.15, z: -10 },
	{ id: 'f1_s', x: 0, y: 6.15, z: 10 },
	{ id: 'f1_w', x: -14, y: 6.15, z: 0 },
	{ id: 'f1_e', x: 14, y: 6.15, z: 0 },
	{ id: 'f1_nw', x: -14, y: 6.15, z: -10 },
	{ id: 'f1_ne', x: 14, y: 6.15, z: -10 },
	{ id: 'f1_sw', x: -14, y: 6.15, z: 10 },
	{ id: 'f1_se', x: 14, y: 6.15, z: 10 },

	// Floor 1 stores
	{ id: 's_kruidvat', x: 18, y: 6.15, z: -12, label: 'Kruidvat' },
	// Epic ending: UFO over south food-court balcony
	// Balcony rail on the south side of the atrium void — look north into the hole
	{ id: 'spaceship', x: 0, y: 6.15, z: 7.4, label: 'Under the UFO' },
	{ id: 's_sephora', x: 0, y: 6.15, z: -12 },
	{ id: 's_uniqlo', x: -16, y: 6.15, z: -12 },
	{ id: 's_decathlon', x: -22, y: 6.15, z: 12 },
	{ id: 's_rituals', x: -4, y: 6.15, z: 12 },
	{ id: 's_coolblue', x: 12, y: 6.15, z: 12 },
	{ id: 's_action', x: 26, y: 6.15, z: 12 },
];

export const EDGES: GraphEdge[] = [
	// Floor 0 grid
	{ from: 'kiosk', to: 'f0_s' },
	{ from: 'f0_s', to: 'f0_c' },
	{ from: 'f0_c', to: 'f0_n' },
	{ from: 'f0_c', to: 'f0_w' },
	{ from: 'f0_c', to: 'f0_e' },
	{ from: 'f0_s', to: 'f0_sw' },
	{ from: 'f0_s', to: 'f0_se' },
	{ from: 'f0_n', to: 'f0_nw' },
	{ from: 'f0_n', to: 'f0_ne' },
	{ from: 'f0_w', to: 'f0_sw' },
	{ from: 'f0_w', to: 'f0_nw' },
	{ from: 'f0_e', to: 'f0_se' },
	{ from: 'f0_e', to: 'f0_ne' },
	{ from: 'f0_sw', to: 'f0_se' },
	{ from: 'f0_nw', to: 'f0_ne' },

	// Stores floor 0
	{ from: 'f0_nw', to: 's_zara' },
	{ from: 'f0_n', to: 's_hm' },
	{ from: 'f0_n', to: 's_media' },
	{ from: 'f0_ne', to: 's_nike' },
	{ from: 'f0_sw', to: 's_starbucks' },
	{ from: 'f0_s', to: 's_primark' },
	{ from: 'f0_se', to: 's_apple' },
	{ from: 'f0_se', to: 's_ikea' },
	{ from: 'f0_w', to: 's_douglas' },
	{ from: 'f0_e', to: 's_game' },

	// Escalator (east)
	{ from: 'f0_e', to: 'e0' },
	{ from: 'f0_se', to: 'e0' },
	{ from: 's_game', to: 'e0' },
	{ from: 'e0', to: 'e1', cost: 1.15 },

	// Stairs (west)
	{ from: 'f0_w', to: 'st0' },
	{ from: 'f0_nw', to: 'st0' },
	{ from: 's_douglas', to: 'st0' },
	{ from: 'st0', to: 'st1', cost: 1.25 },

	// Floor 1 grid
	{ from: 'e1', to: 'f1_e' },
	{ from: 'e1', to: 'f1_ne' },
	{ from: 'e1', to: 'f1_se' },
	{ from: 'st1', to: 'f1_w' },
	{ from: 'st1', to: 'f1_nw' },
	{ from: 'st1', to: 'f1_sw' },
	{ from: 'f1_c', to: 'f1_n' },
	{ from: 'f1_c', to: 'f1_s' },
	{ from: 'f1_c', to: 'f1_w' },
	{ from: 'f1_c', to: 'f1_e' },
	{ from: 'f1_n', to: 'f1_nw' },
	{ from: 'f1_n', to: 'f1_ne' },
	{ from: 'f1_s', to: 'f1_sw' },
	{ from: 'f1_s', to: 'f1_se' },
	{ from: 'f1_w', to: 'f1_nw' },
	{ from: 'f1_w', to: 'f1_sw' },
	{ from: 'f1_e', to: 'f1_ne' },
	{ from: 'f1_e', to: 'f1_se' },

	// Saucy (floor 0 east, past Gamesman)
	{ from: 's_game', to: 's_saucy' },
	{ from: 'f0_ne', to: 's_saucy' },

	// Food court (south plaza)
	{ from: 'f0_s', to: 's_foodcourt' },
	{ from: 'kiosk', to: 's_foodcourt' },
	{ from: 'f0_se', to: 's_foodcourt' },
	{ from: 'f0_sw', to: 's_foodcourt' },
	{ from: 's_primark', to: 's_foodcourt' },

	// Utilities west
	{ from: 'f0_sw', to: 'u_toilets' },
	{ from: 'f0_w', to: 'u_prayer' },
	{ from: 'u_prayer', to: 'u_toilets' },

	// Secret stairs → helipad (east, floor 1 up to roof)
	{ from: 'f1_se', to: 'sec_f1' },
	{ from: 's_action', to: 'sec_f1' },
	{ from: 'sec_f1', to: 'sec_mid', cost: 1.1 },
	{ from: 'sec_mid', to: 'helipad', cost: 1.1 },

	// Stores floor 1
	{ from: 'f1_ne', to: 's_kruidvat' },
	{ from: 's_kruidvat', to: 'f1_se' },
	{ from: 'f1_se', to: 'spaceship' },
	{ from: 'f1_s', to: 'spaceship' },
	{ from: 'f1_n', to: 's_sephora' },
	{ from: 'f1_nw', to: 's_uniqlo' },
	{ from: 'f1_sw', to: 's_decathlon' },
	{ from: 'f1_s', to: 's_rituals' },
	{ from: 'f1_se', to: 's_coolblue' },
	{ from: 'f1_se', to: 's_action' },
];
