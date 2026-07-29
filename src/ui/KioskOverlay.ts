import { CATEGORY_LABELS, type StoreCategory, type StoreDef, STORES } from '../data/stores';

export type UICallbacks = {
	onSelectStore: (store: StoreDef) => void;
	onStartRoute: (store: StoreDef) => void;
	onCancel: () => void;
	onReplay: () => void;
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
	private elSteps!: HTMLElement;
	private elHud!: HTMLElement;

	constructor(root: HTMLElement, callbacks: UICallbacks) {
		this.root = root;
		this.callbacks = callbacks;
		this.mount();
	}

	private mount(): void {
		this.root.innerHTML = `
      <div class="boot" id="boot">
        <div class="boot-inner">
          <div class="boot-logo">MallOS</div>
          <div class="boot-sub">3D WAYFINDING SYSTEM</div>
          <div class="boot-bar"><div class="boot-bar-fill"></div></div>
          <div class="boot-hint">Initialiseren van de mall…</div>
        </div>
      </div>

      <div class="hud hidden" id="hud">
        <header class="topbar">
          <div class="brand">
            <span class="brand-mark"></span>
            <div>
              <div class="brand-name">MallOS</div>
              <div class="brand-tag">Neon Plaza · Directory</div>
            </div>
          </div>
          <div class="status-chip" id="status">IDLE · je bent bij de kiosk</div>
        </header>

        <aside class="panel">
          <div class="panel-head">
            <h1>Waar wil je heen?</h1>
            <p class="panel-sub">Zoek een winkel of kies Kruidvat — de ultimate route.</p>
          </div>

          <button class="hero-cta" id="btn-kruidvat" type="button">
            <span class="hero-cta-icon">✚</span>
            <span>
              <strong>Naar Kruidvat</strong>
              <small>Verdieping 1 · via roltrap · cinematic tour</small>
            </span>
            <span class="hero-cta-go">GO →</span>
          </button>

          <div class="search-wrap">
            <input id="search" type="search" placeholder="Zoek winkel…" autocomplete="off" />
          </div>

          <div class="cats" id="cats"></div>
          <div class="store-list" id="store-list"></div>

          <div class="detail hidden" id="detail"></div>
          <div class="steps hidden" id="steps"></div>
        </aside>

        <div class="minimap-wrap">
          <div class="minimap-label">LIVE MAP</div>
          <canvas id="minimap" width="180" height="140"></canvas>
        </div>

        <div class="hint-bar" id="hint">Sleep om te kijken · scroll om te zoomen</div>
      </div>

      <div class="arrive hidden" id="arrive">
        <div class="arrive-card">
          <div class="arrive-badge">BESTEMMING BEREIKT</div>
          <h2 id="arrive-title">Kruidvat</h2>
          <p id="arrive-msg">Je staat voor de ingang. Fijne shopping!</p>
          <div class="arrive-actions">
            <button type="button" class="btn primary" id="btn-replay">Nog een keer</button>
            <button type="button" class="btn ghost" id="btn-done">Terug naar overzicht</button>
          </div>
        </div>
      </div>
    `;

		this.elBoot = this.root.querySelector('#boot')!;
		this.elHud = this.root.querySelector('#hud')!;
		this.elSearch = this.root.querySelector('#search')!;
		this.elList = this.root.querySelector('#store-list')!;
		this.elDetail = this.root.querySelector('#detail')!;
		this.elStatus = this.root.querySelector('#status')!;
		this.elArrive = this.root.querySelector('#arrive')!;
		this.elMinimap = this.root.querySelector('#minimap')!;
		this.elSteps = this.root.querySelector('#steps')!;

		this.renderCats();
		this.renderList();

		this.elSearch.addEventListener('input', () => {
			this.filter = this.elSearch.value.trim().toLowerCase();
			this.renderList();
		});

		this.root.querySelector('#btn-kruidvat')!.addEventListener('click', () => {
			const k = STORES.find((s) => s.id === 'kruidvat')!;
			this.selectStore(k);
			this.callbacks.onStartRoute(k);
		});

		this.root.querySelector('#btn-replay')!.addEventListener('click', () => {
			this.hideArrive();
			this.callbacks.onReplay();
		});

		this.root.querySelector('#btn-done')!.addEventListener('click', () => {
			this.hideArrive();
			this.callbacks.onCancel();
		});
	}

	hideBoot(): void {
		this.elBoot.classList.add('fade-out');
		setTimeout(() => {
			this.elBoot.classList.add('hidden');
			this.elHud.classList.remove('hidden');
		}, 700);
	}

	setStatus(text: string): void {
		this.elStatus.textContent = text;
	}

	showTouring(store: StoreDef): void {
		this.setStatus(`ROUTE · onderweg naar ${store.name.replace('\n', ' ')}`);
		this.elDetail.classList.add('touring');
	}

	showArrive(store: StoreDef): void {
		this.elArrive.classList.remove('hidden');
		const title = this.root.querySelector('#arrive-title')!;
		const msg = this.root.querySelector('#arrive-msg')!;
		title.textContent = store.name.replace('\n', ' ');
		msg.textContent = store.id === 'kruidvat'
			? 'Je staat voor de Kruidvat. Vitamines, shampoo, of die ene aanbieding — je bent er.'
			: `Je staat voor ${store.name.replace('\n', ' ')}. Fijne shopping!`;
		this.setStatus(`ARRIVED · ${store.name.replace('\n', ' ')}`);
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
		this.setStatus('IDLE · je bent bij de kiosk');
	}

	updateMinimap(
		stores: StoreDef[],
		path: { x: number; z: number }[],
		cam: { x: number; z: number },
	): void {
		const ctx = this.elMinimap.getContext('2d')!;
		const w = this.elMinimap.width;
		const h = this.elMinimap.height;
		ctx.clearRect(0, 0, w, h);

		// bg
		ctx.fillStyle = '#0a0a14';
		ctx.fillRect(0, 0, w, h);

		const scale = 2.1;
		const ox = w / 2;
		const oy = h / 2;
		const tx = (x: number) => ox + x * scale;
		const tz = (z: number) => oy + z * scale;

		// atrium
		ctx.strokeStyle = 'rgba(0,255,200,0.25)';
		ctx.strokeRect(tx(-8), tz(-6), 16 * scale, 12 * scale);

		// stores
		for (const s of stores) {
			if (s.id === 'info') continue;
			ctx.fillStyle = s.hero ? '#00a651' : 'rgba(255,255,255,0.2)';
			const sx = 3.5;
			ctx.fillRect(tx(s.x) - sx / 2, tz(s.z) - sx / 2, sx, sx);
		}

		// path
		if (path.length > 1) {
			ctx.strokeStyle = '#00ffc8';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(tx(path[0].x), tz(path[0].z));
			for (let i = 1; i < path.length; i++) {
				ctx.lineTo(tx(path[i].x), tz(path[i].z));
			}
			ctx.stroke();
		}

		// kiosk
		ctx.fillStyle = '#ff2d55';
		ctx.beginPath();
		ctx.arc(tx(0), tz(10), 3, 0, Math.PI * 2);
		ctx.fill();

		// camera
		ctx.fillStyle = '#00a8ff';
		ctx.beginPath();
		ctx.arc(tx(cam.x * 0.15), tz(cam.z * 0.15), 2.5, 0, Math.PI * 2);
		ctx.fill();
	}

	private selectStore(store: StoreDef): void {
		this.selected = store;
		this.renderList();
		this.renderDetail(store);
		this.callbacks.onSelectStore(store);
	}

	private renderCats(): void {
		const el = this.root.querySelector('#cats')!;
		const cats: Array<StoreCategory | 'all'> = [
			'all',
			'beauty',
			'fashion',
			'tech',
			'food',
			'sport',
			'home',
		];
		el.innerHTML = cats
			.map(
				(c) =>
					`<button type="button" class="cat ${c === this.category ? 'active' : ''}" data-cat="${c}">${
						c === 'all' ? 'Alles' : CATEGORY_LABELS[c]
					}</button>`,
			)
			.join('');
		el.querySelectorAll('.cat').forEach((btn) => {
			btn.addEventListener('click', () => {
				this.category = (btn as HTMLElement).dataset.cat as StoreCategory | 'all';
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
			return s.name.toLowerCase().includes(this.filter) || s.id.includes(this.filter);
		});

		this.elList.innerHTML = items
			.map(
				(s) => `
      <button type="button" class="store-item ${this.selected?.id === s.id ? 'active' : ''} ${
					s.hero ? 'hero' : ''
				}" data-id="${s.id}">
        <span class="store-dot" style="background:${s.accent};box-shadow:0 0 8px ${s.accent}"></span>
        <span class="store-meta">
          <strong>${s.name.replace('\n', ' ')}</strong>
          <small>V${s.floor} · ${CATEGORY_LABELS[s.category]}</small>
        </span>
        ${s.hero ? '<span class="pill">HERO</span>' : ''}
      </button>`,
			)
			.join('');

		this.elList.querySelectorAll('.store-item').forEach((btn) => {
			btn.addEventListener('click', () => {
				const id = (btn as HTMLElement).dataset.id!;
				const store = STORES.find((s) => s.id === id)!;
				this.selectStore(store);
			});
		});
	}

	private renderDetail(store: StoreDef): void {
		this.elDetail.classList.remove('hidden', 'touring');
		this.elDetail.innerHTML = `
      <div class="detail-top">
        <div class="detail-swatch" style="background:${store.color};border-color:${store.accent}"></div>
        <div>
          <h2>${store.name.replace('\n', ' ')}</h2>
          <p>Verdieping ${store.floor} · ${CATEGORY_LABELS[store.category]}</p>
        </div>
      </div>
      <div class="detail-actions">
        <button type="button" class="btn primary" id="btn-go">Start route</button>
        <button type="button" class="btn ghost" id="btn-cancel">Annuleer</button>
      </div>
    `;
		this.elDetail.querySelector('#btn-go')!.addEventListener('click', () => {
			this.callbacks.onStartRoute(store);
		});
		this.elDetail.querySelector('#btn-cancel')!.addEventListener('click', () => {
			this.clearSelection();
			this.callbacks.onCancel();
		});
	}
}
