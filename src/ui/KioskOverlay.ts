import { EDGES, NODES } from '#/data/graph';
import { getInventory } from '#/data/inventory';
import { ATRIUM_VOID, MALL_FOOTPRINT } from '#/data/layout';
import { type LevelId, level, levelAt } from '#/data/levels';
import { CATEGORY_LABELS, getKruidvat, STORES, type StoreCategory, type StoreDef } from '#/data/stores';
import {
	ELEVATOR_OPENING_ROOF,
	HELIPAD_DECK_BOUNDS,
	HELIPAD_PAD_SPEC,
	SECRET_STAIRS_OPENING_BOUNDS,
	VERTICAL_CONNECTORS,
	WORLD_ENTITIES,
} from '#/data/world';
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

function connectorLevels(connector: (typeof VERTICAL_CONNECTORS)[number]): readonly LevelId[] {
	return [connector.from, connector.to];
}

/** Same-floor graph edges = the corridors worth drawing on the map. */
const CORRIDORS = EDGES.flatMap((e) => {
	const a = NODE_BY_ID.get(e.from);
	const b = NODE_BY_ID.get(e.to);
	if (!a || !b) return [];
	const la = levelAt(a.y);
	if (la !== levelAt(b.y)) return [];
	return [{ level: la, ax: a.x, az: a.z, bx: b.x, bz: b.z }];
});

/** Every authored vertical connector becomes a level-aware map feature. */
const VERTICALS = VERTICAL_CONNECTORS.map((connector) => ({
	x: connector.x,
	z: midpoint(connector.zBottom, connector.zTop),
	minZ: Math.min(connector.zBottom, connector.zTop) - connector.apron,
	maxZ: Math.max(connector.zBottom, connector.zTop) + connector.apron,
	width: connector.width,
	levels: connectorLevels(connector),
	label: connector.kind === 'escalator' ? 'ROLTRAP' : 'TRAP',
	short: '⇅',
}));

/** Things worth walking to that aren't shops. */
const LANDMARKS: { x: number; z: number; level: LevelId; short: string; label: string }[] = [
	{ x: -28, z: 3, level: 'v0', short: '👗', label: 'CATWALK' },
	{ x: 0, z: 0, level: 'v0', short: '⛲', label: 'FONTEIN · GOD' },
	{ x: 0, z: 0, level: 'v1', short: '🛸', label: 'UFO · WEIDE' },
	{ x: -31.5, z: -19.5, level: 'v0', short: '🕌', label: 'GEBEDSRUIMTE' },
	{ x: -28, z: 15.5, level: 'v0', short: '🚻', label: 'WC' },
];

function isTypingTarget(t: EventTarget | null): boolean {
	const el = t as HTMLElement | null;
	if (!el?.tagName) return false;
	return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

function shortName(store: StoreDef): string {
	return store.name.replace('\n', ' ');
}

/** Which deck a big-map tab stands for; the markup carries the id. */
function tabLevel(btn: HTMLElement): LevelId {
	const id = btn.dataset['level'];
	return LANDMARK_LEVELS.find((l) => l === id) ?? 'v0';
}

/** Decks the big map can show, in tab order. */
const LANDMARK_LEVELS = ['v0', 'v1', 'roof'] as const satisfies readonly LevelId[];

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

	private map: MapState = {
		x: 0,
		z: 10,
		yaw: 0,
		level: 'v0',
		path: [],
		blips: [],
		target: null,
	};
	private zoom = 2;
	private bigOpen = false;
	private bigLevel: LevelId = 'v0';
	private mapClock = 0;

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
            <div class="bigmap-tabs">
              <button type="button" class="bigmap-tab" data-level="v0">Begane grond</button>
              <button type="button" class="bigmap-tab" data-level="v1">Verdieping 1</button>
              <button type="button" class="bigmap-tab" data-level="roof">Dak 🚁</button>
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

		this.root.querySelectorAll<HTMLElement>('.bigmap-tab').forEach((btn) => {
			btn.addEventListener('click', () => {
				this.bigLevel = tabLevel(btn);
				this.renderBigTabs();
				this.paintBigMap();
			});
		});

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

	private renderBigTabs(): void {
		this.root.querySelectorAll<HTMLElement>('.bigmap-tab').forEach((btn) => {
			btn.classList.toggle('active', tabLevel(btn) === this.bigLevel);
		});
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
		ctx.font = '600 8px ui-monospace, monospace';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const reach = (r - 8) / scale;
		for (const s of STORES) {
			if (s.id === 'info' || s.level !== lvl) continue;
			if (Math.abs(s.x - this.map.x) > reach || Math.abs(s.z - this.map.z) > reach) continue;
			const { sx, sy } = this.project(s.x, s.z, cx, cy, scale);
			ctx.fillStyle = s.hero ? '#5eead4' : 'rgba(226,232,240,0.8)';
			ctx.fillText(shortName(s).slice(0, 8), sx, sy);
		}
		for (const v of VERTICALS) {
			const { sx, sy } = this.project(v.x, v.z, cx, cy, scale);
			ctx.fillStyle = '#fbbf24';
			ctx.font = '700 11px ui-monospace, monospace';
			ctx.fillText(v.short, sx, sy);
		}
		ctx.font = '11px system-ui, sans-serif';
		for (const l of LANDMARKS) {
			if (l.level !== lvl) continue;
			const { sx, sy } = this.project(l.x, l.z, cx, cy, scale);
			ctx.fillText(l.short, sx, sy);
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

	/** Everything in world units. `scale` converts px → world for line widths. */
	/** Daklaag: dekken, trapgat, helipad-H, eiland + zwembad, lift, skylight. */
	private paintRoofLayer(ctx: CanvasRenderingContext2D, px: number): void {
		// Loopbare dekken
		ctx.fillStyle = 'rgba(90,100,115,0.55)';
		ctx.fillRect(
			HELIPAD_DECK_BOUNDS.minX,
			HELIPAD_DECK_BOUNDS.minZ,
			span(HELIPAD_DECK_BOUNDS.minX, HELIPAD_DECK_BOUNDS.maxX),
			span(HELIPAD_DECK_BOUNDS.minZ, HELIPAD_DECK_BOUNDS.maxZ),
		);
		ctx.fillRect(12, -12, 16, 20); // lift-corridor
		ctx.fillStyle = 'rgba(214,196,150,0.6)'; // zand
		ctx.fillRect(-32, -20, 26, 40); // ROOF ISLAND

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

		// Trapgat naar V1 (secret stairs) — open gat, rood gemarkeerd
		ctx.fillStyle = 'rgba(8,11,20,0.9)';
		ctx.fillRect(
			SECRET_STAIRS_OPENING_BOUNDS.minX,
			SECRET_STAIRS_OPENING_BOUNDS.minZ,
			span(SECRET_STAIRS_OPENING_BOUNDS.minX, SECRET_STAIRS_OPENING_BOUNDS.maxX),
			span(SECRET_STAIRS_OPENING_BOUNDS.minZ, SECRET_STAIRS_OPENING_BOUNDS.maxZ),
		);
		ctx.strokeStyle = 'rgba(248,113,113,0.9)';
		ctx.lineWidth = 1.4 * px;
		ctx.strokeRect(
			SECRET_STAIRS_OPENING_BOUNDS.minX,
			SECRET_STAIRS_OPENING_BOUNDS.minZ,
			span(SECRET_STAIRS_OPENING_BOUNDS.minX, SECRET_STAIRS_OPENING_BOUNDS.maxX),
			span(SECRET_STAIRS_OPENING_BOUNDS.minZ, SECRET_STAIRS_OPENING_BOUNDS.maxZ),
		);

		// Glazen lift
		ctx.fillStyle = 'rgba(125,211,252,0.7)';
		ctx.fillRect(
			ELEVATOR_OPENING_ROOF.center.x - ELEVATOR_OPENING_ROOF.size.width / 2,
			ELEVATOR_OPENING_ROOF.center.z - ELEVATOR_OPENING_ROOF.size.depth / 2,
			ELEVATOR_OPENING_ROOF.size.width,
			ELEVATOR_OPENING_ROOF.size.depth,
		);

		// Zwembad + glijbaantoren op het eiland
		ctx.fillStyle = 'rgba(56,189,248,0.75)';
		ctx.beginPath();
		ctx.ellipse(-20, 2.5, 6.5, 4.6, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#ffca28';
		ctx.fillRect(-29.4, -10.9, 1.8, 1.8); // glijbaantoren
	}

	private paintWorld(ctx: CanvasRenderingContext2D, lvl: LevelId, scale: number): void {
		const px = 1 / scale;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';

		// Shell
		ctx.fillStyle = 'rgba(30,41,59,0.55)';
		ctx.fillRect(-half(MALL_FOOTPRINT.width), -half(MALL_FOOTPRINT.depth), MALL_FOOTPRINT.width, MALL_FOOTPRINT.depth);
		ctx.lineWidth = 2 * px;
		ctx.strokeStyle = 'rgba(148,163,184,0.6)';
		ctx.strokeRect(-half(MALL_FOOTPRINT.width), -half(MALL_FOOTPRINT.depth), MALL_FOOTPRINT.width, MALL_FOOTPRINT.depth);

		// DAK: eigen laag — geen V1-gangen maar helipad, eiland, trapgat en lift
		if (lvl === 'roof') {
			this.paintRoofLayer(ctx, px);
			return;
		}

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

		// Atrium: fountain downstairs, open void upstairs
		if (lvl === 'v0') {
			ctx.beginPath();
			ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
			ctx.fillStyle = 'rgba(56,189,248,0.35)';
			ctx.fill();
		} else {
			ctx.fillStyle = 'rgba(8,11,20,0.9)';
			ctx.fillRect(-half(ATRIUM_VOID.width), -half(ATRIUM_VOID.depth), ATRIUM_VOID.width, ATRIUM_VOID.depth);
			ctx.setLineDash([1.2 * px * 3, 1.2 * px * 3]);
			ctx.strokeStyle = 'rgba(248,113,113,0.7)';
			ctx.lineWidth = 1.5 * px;
			ctx.strokeRect(-half(ATRIUM_VOID.width), -half(ATRIUM_VOID.depth), ATRIUM_VOID.width, ATRIUM_VOID.depth);
			ctx.setLineDash([]);
		}

		// Stores
		for (const shop of WORLD_ENTITIES) {
			if (shop.category !== 'shop' || !shop.levels.includes(lvl)) continue;
			const room = shop.volumes.find((volume) => volume.id === 'room-shell');
			if (room?.geometry.kind !== 'prism' || room.geometry.plan.kind !== 'rectangle') continue;
			const store = STORES.find((candidate) => `shop-${candidate.id}` === shop.id);
			const plan = room.geometry.plan;
			ctx.save();
			ctx.translate(plan.center.x, plan.center.z);
			ctx.rotate(-plan.yaw);
			ctx.fillStyle = store?.hero ? 'rgba(0,166,81,0.55)' : 'rgba(148,163,184,0.28)';
			ctx.fillRect(-plan.width / 2, -plan.depth / 2, plan.width, plan.depth);
			ctx.lineWidth = 1.4 * px;
			ctx.strokeStyle = store?.hero ? '#00e676' : 'rgba(226,232,240,0.45)';
			ctx.strokeRect(-plan.width / 2, -plan.depth / 2, plan.width, plan.depth);
			ctx.restore();
		}

		// Escalator + stairs shafts
		for (const v of VERTICALS) {
			if (!v.levels.includes(lvl)) continue;
			ctx.fillStyle = 'rgba(251,191,36,0.35)';
			ctx.fillRect(v.x - half(v.width), v.minZ, v.width, span(v.minZ, v.maxZ));
			ctx.strokeStyle = '#fbbf24';
			ctx.lineWidth = 1.4 * px;
			ctx.strokeRect(v.x - half(v.width), v.minZ, v.width, span(v.minZ, v.maxZ));
		}

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

		// Kiosk
		ctx.fillStyle = '#22d3ee';
		ctx.beginPath();
		ctx.arc(0, 10, 1.1, 0, Math.PI * 2);
		ctx.fill();

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

		for (const s of STORES) {
			if (s.id === 'info' || s.level !== lvl) continue;
			ctx.fillStyle = s.hero ? '#5eead4' : 'rgba(241,245,249,0.92)';
			ctx.font = `${s.hero ? 700 : 600} 11px ui-monospace, monospace`;
			ctx.fillText(shortName(s), sx(s.x), sy(s.z));
		}

		ctx.fillStyle = '#fbbf24';
		ctx.font = '700 11px ui-monospace, monospace';
		for (const v of VERTICALS) {
			ctx.fillText(`${v.short} ${v.label}`, sx(v.x), sy(v.z + 7.6));
		}

		ctx.fillStyle = '#22d3ee';
		ctx.font = '600 10px ui-monospace, monospace';
		ctx.fillText('KIOSK · START', sx(0), sy(12.4));

		for (const l of LANDMARKS) {
			if (l.level !== lvl) continue;
			ctx.font = '14px system-ui, sans-serif';
			ctx.fillStyle = '#fff';
			ctx.fillText(l.short, sx(l.x), sy(l.z));
			ctx.font = '700 10px ui-monospace, monospace';
			ctx.fillStyle = '#f0abfc';
			ctx.fillText(l.label, sx(l.x), sy(l.z) + 16);
		}

		ctx.fillStyle = 'rgba(148,163,184,0.8)';
		ctx.font = '600 10px ui-monospace, monospace';
		ctx.fillText('N ↑', sx(0), sy(-half(MALL_FOOTPRINT.depth)) - 12);
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
