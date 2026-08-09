import { HOME_POS } from '#/camera/Director';
import { EDGES, NODES } from '#/data/graph';
import { getInventory } from '#/data/inventory';
import { ATRIUM_VOID, MALL_FOOTPRINT } from '#/data/layout';
import type { LevelId } from '#/data/levels';
import { LEVELS, LEVELS_BOTTOM_UP, level, levelAt, levelY } from '#/data/levels';
import type { MapPresentation, PlanShape, SpatialGeometry, Vec2 } from '#/data/spatial';
import { geometryBounds, planBounds } from '#/data/spatial';
import type { StoreCategory, StoreDef } from '#/data/stores';
import { CATEGORY_LABELS, getKruidvat, requireStore, STORES } from '#/data/stores';
import type { MallWorldEntity } from '#/data/world';
import { HELIPAD_PAD_SPEC, WORLD_ENTITIES } from '#/data/world';
import { POOL_POLYGON, ROOF_ISLAND_PAD, SLIDE_PLATFORM } from '#/scene/RoofIsland';
import { qs } from '#/util/dom';
import { half, midpoint, span } from '#/util/math';
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
	glyph: string;
	labelColor: string | null;
}>;

const LAYER_STYLES: Readonly<Record<MapLayer, LayerStyle>> = {
	structure: {
		fill: 'rgba(30,41,59,0.55)',
		stroke: 'rgba(148,163,184,0.6)',
		lineWidth: 2,
		dash: 0,
		glyph: '',
		labelColor: 'rgba(148,163,184,0.85)',
	},
	opening: {
		fill: 'rgba(8,11,20,0.9)',
		stroke: 'rgba(248,113,113,0.7)',
		lineWidth: 1.5,
		dash: 3.6,
		glyph: '',
		labelColor: null,
	},
	shop: {
		fill: 'rgba(148,163,184,0.28)',
		stroke: 'rgba(226,232,240,0.45)',
		lineWidth: 1.4,
		dash: 0,
		glyph: '',
		labelColor: 'rgba(241,245,249,0.92)',
	},
	circulation: {
		fill: 'rgba(251,191,36,0.35)',
		stroke: '#fbbf24',
		lineWidth: 1.4,
		dash: 0,
		glyph: '⇅',
		labelColor: '#fbbf24',
	},
	parking: {
		fill: 'rgba(69,90,100,0.5)',
		stroke: 'rgba(255,193,7,0.5)',
		lineWidth: 1.4,
		dash: 0,
		glyph: '',
		labelColor: '#ffc107',
	},
	fixture: {
		fill: 'rgba(192,132,252,0.26)',
		stroke: 'rgba(240,171,252,0.75)',
		lineWidth: 1.4,
		dash: 0,
		glyph: '',
		labelColor: '#f0abfc',
	},
	clutter: {
		fill: 'rgba(148,163,184,0.18)',
		stroke: 'rgba(148,163,184,0.3)',
		lineWidth: 1,
		dash: 0,
		glyph: '',
		labelColor: null,
	},
};

const HERO_FILL = 'rgba(0,166,81,0.55)';
const HERO_STROKE = '#00e676';
const HERO_LABEL = '#5eead4';

/**
 * A plan is a horizontal cut through the deck, so geometry that only starts
 * above it is ceiling and belongs to no room outline.
 */
const PLAN_CUT_HEIGHT = 1.2;

type MapFeature = Readonly<{
	layer: MapLayer;
	label: string;
	hero: boolean;
	priority: number;
	shapes: readonly PlanShape[];
	anchor: Vec2;
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

function featureAnchor(shapes: readonly PlanShape[]): Vec2 {
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
	return { x: midpoint(minX, maxX), z: midpoint(minZ, maxZ) };
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
		if (geometryBounds(volume.geometry).minY > cut) continue;
		const plan = volumePlan(volume.geometry);
		const key = planKey(plan);
		if (seen.has(key)) continue;
		seen.add(key);
		shapes.push(plan);
	}
	return shapes;
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
			byLevel.get(levelId)?.push({
				layer: entity.map.layer,
				label: oneLine(entity.map.label ?? ''),
				hero: store?.hero === true,
				priority: entity.map.priority,
				shapes,
				anchor: featureAnchor(shapes),
			});
		}
	}
	for (const features of byLevel.values()) features.sort((a, b) => a.priority - b.priority);
	return byLevel;
}

const FEATURES_BY_LEVEL = buildFeatures();

/** Named features, most important first, so a crowded corner keeps the label that matters. */
const LABELS_BY_LEVEL = new Map<LevelId, MapFeature[]>(
	[...FEATURES_BY_LEVEL].map(([levelId, features]): [LevelId, MapFeature[]] => [
		levelId,
		features.filter((feature) => feature.label !== '' && LAYER_STYLES[feature.layer].labelColor !== null).toReversed(),
	]),
);

function featuresOn(levelId: LevelId): readonly MapFeature[] {
	return FEATURES_BY_LEVEL.get(levelId) ?? [];
}

function labelsOn(levelId: LevelId): readonly MapFeature[] {
	return LABELS_BY_LEVEL.get(levelId) ?? [];
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

/** Screen-space spacing a label needs before it is dropped as unreadable. */
const BIG_LABEL_GAP = 22;
const MINI_LABEL_GAP = 14;

function tooClose(placed: readonly ScreenPoint[], x: number, y: number, gap: number): boolean {
	return placed.some((point) => Math.abs(point.x - x) < gap && Math.abs(point.y - y) < gap);
}

function isTypingTarget(t: EventTarget | null): boolean {
	const el = t as HTMLElement | null;
	if (!el?.tagName) return false;
	return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
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
	private zoom = 2;
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

        <aside class="panel">
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
          <b>WASD</b> lopen · <b>Shift</b> rennen · <b>Space</b> spring ·
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
		this.zoom = Math.max(0, Math.min(ZOOM_STEPS.length - 1, step));
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

	/** World → minimap screen (heading up, player centred). */
	private project(x: number, z: number, cx: number, cy: number, scale: number) {
		const dx = x - this.map.x;
		const dz = z - this.map.z;
		const c = Math.cos(this.map.yaw);
		const s = Math.sin(this.map.yaw);
		return {
			sx: cx + (dx * c - dz * s) * scale,
			sy: cy + (dx * s + dz * c) * scale,
		};
	}

	private paintMiniMap(): void {
		const size = 200;
		const ctx = this.prep(this.elMinimap, size, size);
		if (!ctx) return;

		const cx = size / 2;
		const cy = size / 2;
		const r = size / 2 - 3;
		const scale = at(ZOOM_STEPS, this.zoom);
		const lvl = this.map.level;

		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fillStyle = '#0a1020';
		ctx.fill();
		ctx.clip();

		// World layer: rotated so the way you face is up
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(this.map.yaw);
		ctx.scale(scale, scale);
		ctx.translate(-this.map.x, -this.map.z);
		this.paintWorld(ctx, lvl, scale);
		ctx.restore();

		// Upright labels for whatever is close by
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const reach = (r - 8) / scale;
		const placed: ScreenPoint[] = [];
		for (const feature of labelsOn(lvl)) {
			const style = LAYER_STYLES[feature.layer];
			if (style.labelColor === null) continue;
			if (Math.abs(feature.anchor.x - this.map.x) > reach || Math.abs(feature.anchor.z - this.map.z) > reach) continue;
			const { sx, sy } = this.project(feature.anchor.x, feature.anchor.z, cx, cy, scale);
			if (tooClose(placed, sx, sy, MINI_LABEL_GAP)) continue;
			placed.push({ x: sx, y: sy });
			if (style.glyph === '') {
				ctx.font = '600 8px ui-monospace, monospace';
				ctx.fillStyle = feature.hero ? HERO_LABEL : style.labelColor;
				ctx.fillText(feature.label.slice(0, 8), sx, sy);
			} else {
				ctx.font = '700 11px ui-monospace, monospace';
				ctx.fillStyle = style.stroke;
				ctx.fillText(style.glyph, sx, sy);
			}
		}

		// View cone — screen space, always pointing up
		const cone = 44;
		const half = 0.61; // ~70° fov
		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.arc(cx, cy, cone, -Math.PI / 2 - half, -Math.PI / 2 + half);
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
	private paintFeatures(ctx: CanvasRenderingContext2D, lvl: LevelId, px: number): void {
		for (const feature of featuresOn(lvl)) {
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
		ctx.fillStyle = 'rgba(214,196,150,0.6)'; // zand
		ctx.fillRect(
			ROOF_ISLAND_PAD.minX,
			ROOF_ISLAND_PAD.minZ,
			span(ROOF_ISLAND_PAD.minX, ROOF_ISLAND_PAD.maxX),
			span(ROOF_ISLAND_PAD.minZ, ROOF_ISLAND_PAD.maxZ),
		);

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

	private paintWorld(ctx: CanvasRenderingContext2D, lvl: LevelId, scale: number): void {
		const px = 1 / scale;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';

		// Rooms, shells, shafts and holes — whatever the schema puts on this deck
		this.paintFeatures(ctx, lvl, px);

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
		const sx = (x: number) => cssW / 2 + x * scale;
		const sy = (z: number) => cssH / 2 + z * scale;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		const placed: ScreenPoint[] = [];
		for (const feature of labelsOn(lvl)) {
			const style = LAYER_STYLES[feature.layer];
			if (style.labelColor === null) continue;
			const x = sx(feature.anchor.x);
			const y = sy(feature.anchor.z);
			if (tooClose(placed, x, y, BIG_LABEL_GAP)) continue;
			placed.push({ x, y });
			ctx.fillStyle = feature.hero ? HERO_LABEL : style.labelColor;
			ctx.font = `${feature.hero ? 700 : 600} 11px ui-monospace, monospace`;
			ctx.fillText(style.glyph === '' ? feature.label : `${style.glyph} ${feature.label}`, x, y);
		}

		ctx.fillStyle = 'rgba(148,163,184,0.8)';
		ctx.font = '600 10px ui-monospace, monospace';
		ctx.fillText('N ↑', cssW / 2, sy(-half(MALL_FOOTPRINT.depth)) - 12);
	}

	private paintBigMap(): void {
		const host = this.elBigCanvas.parentElement;
		const cssW = Math.max(320, (host?.clientWidth ?? 820) - 36);
		const cssH = cssW * ((MALL_FOOTPRINT.depth + 12) / (MALL_FOOTPRINT.width + 12));
		const ctx = this.prep(this.elBigCanvas, cssW, cssH);
		if (!ctx) return;

		ctx.fillStyle = '#0a1020';
		ctx.fillRect(0, 0, cssW, cssH);

		const scale = Math.min(cssW / (MALL_FOOTPRINT.width + 12), cssH / (MALL_FOOTPRINT.depth + 12));
		ctx.save();
		ctx.translate(cssW / 2, cssH / 2);
		ctx.scale(scale, scale);
		this.paintWorld(ctx, this.bigLevel, scale);
		ctx.restore();
		this.paintBigLabels(ctx, cssW, cssH, scale, this.bigLevel);

		// You are here — only on the deck you're standing on
		if (this.bigLevel === this.map.level) {
			const sx = cssW / 2 + this.map.x * scale;
			const sy = cssH / 2 + this.map.z * scale;
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
