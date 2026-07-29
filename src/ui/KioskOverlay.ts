import { CATEGORY_LABELS, type StoreCategory, type StoreDef, STORES } from '../data/stores';

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
	private elScore!: HTMLElement;
	private elNearby!: HTMLElement;
	private elPossessBanner!: HTMLElement;

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
            <p class="panel-sub"><b>WASD</b> lopen, sleep = kijken. Winkels zijn OPEN (verkopers!). Sim-gezichten = mood. <b>V</b> = RCT guest view.</p>
          </div>
          <div class="nearby-sim hidden" id="nearby-sim"></div>

          <button class="hero-cta" id="btn-kruidvat" type="button">
            <span class="hero-cta-icon">✚</span>
            <span>
              <strong>Naar Kruidvat</strong>
              <small>OPEN · gele route · first-person auto-walk</small>
            </span>
            <span class="hero-cta-go">Start →</span>
          </button>

          <button class="btn possess-btn" type="button" id="btn-possess">
            👁 Guest view (word een shopper)
          </button>
          <button class="btn disco-btn" type="button" id="btn-disco">
            🕺 DANCE PARTY
          </button>
          <button class="btn money-btn" type="button" id="btn-money">
            💰 Geef geld (dichtstbijzijnde sim)
          </button>
          <button class="btn thief-btn" type="button" id="btn-thief">
            🧔 Roep baard-dief (juwelen!)
          </button>

          <div class="search-wrap">
            <input id="search" type="search" placeholder="Zoek winkel (bijv. Rituals)…" autocomplete="off" />
          </div>

          <div class="cats" id="cats"></div>
          <div class="store-list" id="store-list"></div>

          <div class="detail hidden" id="detail"></div>
          <div class="steps hidden" id="steps"></div>
        </aside>

        <div class="minimap-wrap">
          <div class="minimap-label">Kaart</div>
          <canvas id="minimap" width="180" height="140"></canvas>
        </div>

        <div class="hint-bar" id="hint"><b>WASD</b> lopen · sleep kijken · <b>V</b> guest · <b>K</b> Kruidvat · <b>H</b> kiosk</div>
        <div class="possess-banner hidden" id="possess-banner">GUEST VIEW</div>
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

		this.elBoot = this.root.querySelector('#boot')!;
		this.elHud = this.root.querySelector('#hud')!;
		this.elSearch = this.root.querySelector('#search')!;
		this.elList = this.root.querySelector('#store-list')!;
		this.elDetail = this.root.querySelector('#detail')!;
		this.elStatus = this.root.querySelector('#status')!;
		this.elArrive = this.root.querySelector('#arrive')!;
		this.elMinimap = this.root.querySelector('#minimap')!;
		this.elSteps = this.root.querySelector('#steps')!;
		this.elScore = this.root.querySelector('#score')!;
		this.elNearby = this.root.querySelector('#nearby-sim')!;
		this.elPossessBanner = this.root.querySelector('#possess-banner')!;

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

		this.root.querySelector('#btn-home')!.addEventListener('click', () => {
			this.callbacks.onHome();
		});

		this.root.querySelector('#btn-possess')!.addEventListener('click', () => {
			this.callbacks.onPossess();
		});
		this.root.querySelector('#btn-disco')!.addEventListener('click', () => {
			this.callbacks.onDisco();
		});
		this.root.querySelector('#btn-money')!.addEventListener('click', () => {
			this.callbacks.onGiveMoney();
		});
		this.root.querySelector('#btn-thief')!.addEventListener('click', () => {
			this.callbacks.onSummonThief();
		});

		this.root.querySelector('#btn-replay')!.addEventListener('click', () => {
			this.hideArrive();
			this.callbacks.onReplay();
		});

		this.root.querySelector('#btn-done')!.addEventListener('click', () => {
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
		const title = this.root.querySelector('#arrive-title')!;
		const msg = this.root.querySelector('#arrive-msg')!;
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

	updateMinimap(
		stores: StoreDef[],
		path: { x: number; z: number }[],
		cam: { x: number; z: number },
	): void {
		const ctx = this.elMinimap.getContext('2d')!;
		const w = this.elMinimap.width;
		const h = this.elMinimap.height;
		ctx.clearRect(0, 0, w, h);

		ctx.fillStyle = '#e8eef4';
		ctx.fillRect(0, 0, w, h);

		const scale = 2.1;
		const ox = w / 2;
		const oy = h / 2;
		const tx = (x: number) => ox + x * scale;
		const tz = (z: number) => oy + z * scale;

		ctx.strokeStyle = 'rgba(30,64,175,0.2)';
		ctx.strokeRect(tx(-8), tz(-6), 16 * scale, 12 * scale);

		for (const s of stores) {
			if (s.id === 'info') continue;
			ctx.fillStyle = s.hero ? '#00a651' : 'rgba(15,23,42,0.2)';
			ctx.fillRect(tx(s.x) - 1.5, tz(s.z) - 1.5, 3, 3);
		}

		if (path.length > 1) {
			ctx.strokeStyle = '#c9a227';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(tx(path[0].x), tz(path[0].z));
			for (let i = 1; i < path.length; i++) {
				ctx.lineTo(tx(path[i].x), tz(path[i].z));
			}
			ctx.stroke();
		}

		ctx.fillStyle = '#dc2626';
		ctx.beginPath();
		ctx.arc(tx(0), tz(10), 3, 0, Math.PI * 2);
		ctx.fill();

		ctx.fillStyle = '#1d4ed8';
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

		// Rituals near top when searching mom vibes isn't needed — just clean list
		this.elList.innerHTML = items
			.map(
				(s) => `
      <button type="button" class="store-item ${this.selected?.id === s.id ? 'active' : ''} ${
					s.hero ? 'hero' : ''
				}" data-id="${s.id}">
        <span class="store-dot" style="background:${s.accent}"></span>
        <span class="store-meta">
          <strong>${s.name.replace('\n', ' ')}</strong>
          <small>V${s.floor} · ${CATEGORY_LABELS[s.category]}${s.id === 'rituals' ? ' · ❤️ mama' : ''}</small>
        </span>
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
        <button type="button" class="btn primary" id="btn-go">Start route (lopen)</button>
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
