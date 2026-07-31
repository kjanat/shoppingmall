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
 * Wayfinding graph — edges NEVER cross the floor-1 atrium void (±8 × ±6).
 * Floor 0 y=0.15, Floor 1 y=6.15, roof y=13.65.
 *
 * Layout mirrors stores.ts (clean zones, no SW pile-up).
 */
export const NODES: GraphNode[] = [
	// ── Floor 0 spine ────────────────────────────────────
	{ id: 'kiosk', x: 0, y: 0.15, z: 9, label: 'Je bent hier' },
	{ id: 'f0_s', x: 0, y: 0.15, z: 6 },
	{ id: 'f0_c', x: 0, y: 0.15, z: 0, label: 'Atrium' },
	{ id: 'f0_n', x: 0, y: 0.15, z: -6 },
	{ id: 'f0_w', x: -14, y: 0.15, z: 0 },
	{ id: 'f0_e', x: 14, y: 0.15, z: 0 },
	{ id: 'f0_sw', x: -14, y: 0.15, z: 10 },
	{ id: 'f0_se', x: 14, y: 0.15, z: 10 },
	{ id: 'f0_nw', x: -14, y: 0.15, z: -10 },
	{ id: 'f0_ne', x: 14, y: 0.15, z: -10 },
	// Far west corridor (utilities strip)
	{ id: 'f0_ww', x: -26, y: 0.15, z: 0, label: 'West corridor' },
	{ id: 'f0_wsw', x: -26, y: 0.15, z: 12 },
	{ id: 'f0_wnw', x: -26, y: 0.15, z: -12 },

	// Floor 0 stores (approach in corridor, not inside pod)
	{ id: 's_zara', x: -22, y: 0.15, z: -12 },
	{ id: 's_hm', x: -8, y: 0.15, z: -12 },
	{ id: 's_media', x: 6, y: 0.15, z: -12 },
	{ id: 's_nike', x: 20, y: 0.15, z: -12 },
	{ id: 's_starbucks', x: -14, y: 0.15, z: 12 },
	{ id: 's_primark', x: -2, y: 0.15, z: 12 },
	{ id: 's_apple', x: 12, y: 0.15, z: 12 },
	{ id: 's_ikea', x: 26, y: 0.15, z: 12 },
	{ id: 's_douglas', x: -24, y: 0.15, z: -8 },
	{ id: 's_game', x: 24, y: 0.15, z: 0 },
	{ id: 's_saucy', x: 26, y: 0.15, z: -10, label: 'Saucy' },

	// Floor 0 utilities (match scene meshes)
	{ id: 'u_toilets', x: -28, y: 0.15, z: 12, label: 'Toiletten' },
	{ id: 'u_prayer', x: -28, y: 0.15, z: -18, label: 'Gebedsruimte' },
	{ id: 'u_beardcave', x: -31, y: 0.15, z: 18, label: "Beard-man's Cave" },
	{ id: 's_islandhop', x: -28, y: 0.15, z: 17, label: 'Island Hop Travel' },
	{ id: 'u_protest', x: 8, y: 0.15, z: 4, label: 'Protest Groupies' },

	// Vertical circulation
	{ id: 'e0', x: 22, y: 0.15, z: 8, label: 'Roltrap beneden' },
	{ id: 'e1', x: 22, y: 6.15, z: -2, label: 'Roltrap boven' },
	{ id: 'st0', x: -22, y: 0.15, z: 4, label: 'Trap beneden' },
	{ id: 'st1', x: -22, y: 6.15, z: -14, label: 'Trap boven' },
	// Glass elevator — P1 garage / V0 / V1 / dak
	{ id: 'elev_fb', x: 16, y: -5.85, z: -8, label: 'Glazen lift P1' },
	{ id: 'elev_f0', x: 16, y: 0.15, z: -8, label: 'Glazen lift V0' },
	{ id: 'elev_f1', x: 16, y: 6.15, z: -8, label: 'Glazen lift V1' },
	{ id: 'elev_f2', x: 16, y: 13.65, z: -8, label: 'Glazen lift DAK' },
	{ id: 'roof_mid', x: 20, y: 13.65, z: 4, label: 'Dak pad' },
	{ id: 'u_parking', x: 8, y: -5.85, z: 0, label: 'Parkeergarage' },

	// ── Floor 1 RING only (never through void ±8×±6) ─────
	{ id: 'f1_n', x: 0, y: 6.15, z: -10 },
	{ id: 'f1_s', x: 0, y: 6.15, z: 10 },
	{ id: 'f1_w', x: -14, y: 6.15, z: 0 },
	{ id: 'f1_e', x: 14, y: 6.15, z: 0 },
	{ id: 'f1_nw', x: -14, y: 6.15, z: -10 },
	{ id: 'f1_ne', x: 14, y: 6.15, z: -10 },
	{ id: 'f1_sw', x: -14, y: 6.15, z: 10 },
	{ id: 'f1_se', x: 14, y: 6.15, z: 10 },
	// East mid hub (escalator land) — still outside void
	{ id: 'f1_em', x: 18, y: 6.15, z: 0 },

	// Floor 1 stores
	{ id: 's_kruidvat', x: 18, y: 6.15, z: -12, label: 'Kruidvat' },
	{ id: 'spaceship', x: 0, y: 6.15, z: 7.5, label: 'Under the UFO' },
	{ id: 's_sephora', x: 0, y: 6.15, z: -12 },
	{ id: 's_uniqlo', x: -16, y: 6.15, z: -12 },
	{ id: 's_decathlon', x: -20, y: 6.15, z: 12 },
	{ id: 's_rituals', x: -8, y: 6.15, z: 12 },
	{ id: 's_coolblue', x: 10, y: 6.15, z: 12 },
	{ id: 's_action', x: 24, y: 6.15, z: 12 },
	{ id: 's_foodcourt', x: 0, y: 6.15, z: 11.5, label: 'Food court V1' },

	// Secret stairs → roof
	{ id: 'sec_f1', x: 26, y: 6.15, z: 14, label: 'Geheime trap V1' },
	{ id: 'sec_mid', x: 26, y: 10, z: 16, label: 'Geheime trap mid' },
	{ id: 'helipad', x: 22, y: 13.65, z: 16, label: 'Helipad' },
];

export const EDGES: GraphEdge[] = [
	// ── Floor 0 grid ─────────────────────────────────────
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
	// West utility strip
	{ from: 'f0_w', to: 'f0_ww' },
	{ from: 'f0_sw', to: 'f0_wsw' },
	{ from: 'f0_nw', to: 'f0_wnw' },
	{ from: 'f0_ww', to: 'f0_wsw' },
	{ from: 'f0_ww', to: 'f0_wnw' },

	// Stores floor 0
	{ from: 'f0_nw', to: 's_zara' },
	{ from: 'f0_n', to: 's_hm' },
	{ from: 'f0_n', to: 's_media' },
	{ from: 'f0_ne', to: 's_nike' },
	{ from: 'f0_sw', to: 's_starbucks' },
	{ from: 'f0_s', to: 's_primark' },
	{ from: 'f0_se', to: 's_apple' },
	{ from: 'f0_se', to: 's_ikea' },
	{ from: 'f0_ww', to: 's_douglas' },
	{ from: 'f0_wnw', to: 's_douglas' },
	{ from: 'f0_e', to: 's_game' },
	{ from: 's_game', to: 's_saucy' },
	{ from: 'f0_ne', to: 's_saucy' },

	// Utilities west (clear chain)
	{ from: 'f0_wnw', to: 'u_prayer' },
	{ from: 's_zara', to: 'u_prayer' },
	{ from: 'f0_wsw', to: 'u_toilets' },
	{ from: 'u_toilets', to: 's_islandhop' },
	{ from: 's_islandhop', to: 'u_beardcave' },
	{ from: 'u_toilets', to: 'u_beardcave' },
	{ from: 's_starbucks', to: 'u_toilets' },
	{ from: 'f0_wsw', to: 's_islandhop' },

	// Protest (east atrium ground)
	{ from: 'f0_c', to: 'u_protest' },
	{ from: 'f0_e', to: 'u_protest' },
	{ from: 'f0_se', to: 'u_protest' },
	{ from: 'kiosk', to: 'u_protest' },

	// Escalator east
	{ from: 'f0_e', to: 'e0' },
	{ from: 'f0_se', to: 'e0' },
	{ from: 's_game', to: 'e0' },
	{ from: 'e0', to: 'e1', cost: 1.15 },

	// Stairs west
	{ from: 'f0_w', to: 'st0' },
	{ from: 'f0_nw', to: 'st0' },
	{ from: 's_douglas', to: 'st0' },
	{ from: 'st0', to: 'st1', cost: 1.25 },

	// Glass elevator P1 ↔ V0 ↔ V1 ↔ dak
	{ from: 'f0_e', to: 'elev_f0' },
	{ from: 'f0_ne', to: 'elev_f0' },
	{ from: 'f0_n', to: 'elev_f0' },
	{ from: 'elev_fb', to: 'elev_f0', cost: 1.05 },
	{ from: 'elev_fb', to: 'u_parking' },
	{ from: 'elev_f0', to: 'elev_f1', cost: 1.05 },
	{ from: 'elev_f1', to: 'elev_f2', cost: 1.1 },
	{ from: 'elev_f1', to: 'f1_e' },
	{ from: 'elev_f1', to: 'f1_ne' },
	{ from: 'elev_f1', to: 'f1_n' },
	{ from: 'elev_f2', to: 'roof_mid', cost: 1.05 },
	{ from: 'roof_mid', to: 'helipad', cost: 1.1 },
	{ from: 'elev_f2', to: 'helipad', cost: 1.25 },

	// ── Floor 1 RING (no hub through void) ────────────────
	// North edge
	{ from: 'f1_nw', to: 'f1_n' },
	{ from: 'f1_n', to: 'f1_ne' },
	// East edge
	{ from: 'f1_ne', to: 'f1_e' },
	{ from: 'f1_e', to: 'f1_se' },
	{ from: 'f1_e', to: 'f1_em' },
	{ from: 'f1_em', to: 'f1_ne' },
	{ from: 'f1_em', to: 'f1_se' },
	// South edge
	{ from: 'f1_se', to: 'f1_s' },
	{ from: 'f1_s', to: 'f1_sw' },
	// West edge
	{ from: 'f1_sw', to: 'f1_w' },
	{ from: 'f1_w', to: 'f1_nw' },

	// Landings
	{ from: 'e1', to: 'f1_e' },
	{ from: 'e1', to: 'f1_ne' },
	{ from: 'e1', to: 'f1_em' },
	{ from: 'st1', to: 'f1_w' },
	{ from: 'st1', to: 'f1_nw' },
	{ from: 'st1', to: 'f1_sw' },

	// Floor 1 stores
	{ from: 'f1_ne', to: 's_kruidvat' },
	{ from: 's_kruidvat', to: 'f1_e' },
	{ from: 'f1_n', to: 's_sephora' },
	{ from: 'f1_nw', to: 's_uniqlo' },
	{ from: 'f1_sw', to: 's_decathlon' },
	{ from: 'f1_s', to: 's_rituals' },
	{ from: 'f1_s', to: 's_coolblue' },
	{ from: 'f1_se', to: 's_coolblue' },
	{ from: 'f1_se', to: 's_action' },
	// Food court + UFO balcony (south of void, walkable)
	{ from: 'f1_s', to: 's_foodcourt' },
	{ from: 's_foodcourt', to: 's_rituals' },
	{ from: 's_foodcourt', to: 's_coolblue' },
	{ from: 'f1_s', to: 'spaceship' },
	{ from: 'spaceship', to: 's_foodcourt' },
	{ from: 'spaceship', to: 'f1_se' },
	{ from: 'spaceship', to: 'f1_sw' },

	// Secret stairs → helipad
	{ from: 'f1_se', to: 'sec_f1' },
	{ from: 's_action', to: 'sec_f1' },
	{ from: 'sec_f1', to: 'sec_mid', cost: 1.1 },
	{ from: 'sec_mid', to: 'helipad', cost: 1.1 },
];
