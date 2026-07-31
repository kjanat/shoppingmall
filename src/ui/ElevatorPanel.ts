export type ElevStopChoice = {
	idx: number;
	code: string;
	label: string;
	hint: string;
};

export const ELEV_MENU_STOPS: ElevStopChoice[] = [
	{ idx: 0, code: 'P1', label: 'Parkeergarage', hint: "Ondergronds · auto's" },
	{ idx: 1, code: 'V0', label: 'Begane grond', hint: 'Winkels · kiosk' },
	{ idx: 2, code: 'V1', label: 'Verdieping 1', hint: 'Kruidvat · food court' },
	{ idx: 3, code: 'DAK', label: 'Dak', hint: 'Helipad · uitzicht' },
];

/**
 * Popup when you're in the glass elevator — pick a floor for Hans.
 * Uses event delegation so repaints don't kill clicks.
 */
export class ElevatorPanel {
	private host: HTMLElement;
	private card!: HTMLElement;
	private btns!: HTMLElement;
	private open = false;
	private onPick: (idx: number) => void;
	private currentIdx = 1;
	private lastPaintedIdx = -999;

	constructor(root: HTMLElement, onPick: (idx: number) => void) {
		this.onPick = onPick;
		this.host = document.createElement('div');
		this.host.className = 'elev-host';
		// Above canvas, always receive clicks when open
		this.host.style.pointerEvents = 'none';
		root.appendChild(this.host);
		this.mount();
	}

	get isOpen(): boolean {
		return this.open;
	}

	show(currentStopIdx: number): void {
		this.currentIdx = currentStopIdx;
		this.open = true;
		this.card.classList.remove('hidden');
		this.host.style.pointerEvents = 'auto';
		this.paintButtons(true);
	}

	hide(): void {
		this.open = false;
		this.card.classList.add('hidden');
		this.host.style.pointerEvents = 'none';
	}

	setCurrent(idx: number): void {
		if (idx === this.currentIdx && idx === this.lastPaintedIdx) return;
		this.currentIdx = idx;
		if (this.open) this.paintButtons(false);
	}

	private paintButtons(force: boolean): void {
		if (!force && this.currentIdx === this.lastPaintedIdx) return;
		this.lastPaintedIdx = this.currentIdx;
		this.btns.innerHTML = ELEV_MENU_STOPS.map((s) => {
			const here = s.idx === this.currentIdx;
			return `
        <button type="button" class="elev-btn${here ? ' elev-here' : ''}" data-idx="${s.idx}">
          <span class="elev-code">${s.code}</span>
          <span class="elev-meta">
            <b>${s.label}</b>
            <small>${here ? 'Je bent hier' : s.hint}</small>
          </span>
        </button>`;
		}).join('');
	}

	private mount(): void {
		this.host.innerHTML = `
      <div class="elev-card hidden" id="elev-card">
        <header class="elev-head">
          <div>
            <strong>🛗 Hans · Liftman</strong>
            <p>Welke verdieping mag het zijn?</p>
          </div>
        </header>
        <div class="elev-btns" id="elev-btns"></div>
        <footer class="elev-foot">Klik een verdieping · deuren sluiten</footer>
      </div>
    `;
		this.card = this.host.querySelector('#elev-card')!;
		this.btns = this.host.querySelector('#elev-btns')!;

		// Single delegated handler — survives repaints
		this.btns.addEventListener(
			'click',
			(e) => {
				e.preventDefault();
				e.stopPropagation();
				const el = (e.target as HTMLElement | null)?.closest?.('.elev-btn') as
					| HTMLElement
					| null;
				if (!el || !this.open) return;
				const idx = Number(el.dataset.idx);
				if (!Number.isFinite(idx)) return;
				if (idx === this.currentIdx) return;
				this.onPick(idx);
			},
			true,
		);

		// Also mousedown — pointer-lock games often swallow click
		this.btns.addEventListener(
			'mousedown',
			(e) => {
				e.stopPropagation();
				const el = (e.target as HTMLElement | null)?.closest?.('.elev-btn') as
					| HTMLElement
					| null;
				if (!el || !this.open) return;
				const idx = Number(el.dataset.idx);
				if (!Number.isFinite(idx) || idx === this.currentIdx) return;
				e.preventDefault();
				this.onPick(idx);
			},
			true,
		);
	}
}
