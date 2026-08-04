import { LEVELS, LEVELS_TOP_DOWN, type LevelId } from '#/data/levels';
import { qs } from '#/util/dom';

/**
 * Popup when you're in the glass elevator — pick a floor for Hans.
 * The buttons are the decks themselves, so this list can't drift from the
 * stops the cabin actually serves. Event delegation, so repaints don't kill
 * clicks.
 */
export class ElevatorPanel {
	private host: HTMLElement;
	private card!: HTMLElement;
	private btns!: HTMLElement;
	private open = false;
	private onPick: (id: LevelId) => void;
	private current: LevelId = 'v0';
	private lastPainted: LevelId | null = null;

	constructor(root: HTMLElement, onPick: (id: LevelId) => void) {
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

	show(current: LevelId): void {
		this.current = current;
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

	setCurrent(id: LevelId): void {
		if (id === this.current && id === this.lastPainted) return;
		this.current = id;
		if (this.open) this.paintButtons(false);
	}

	private paintButtons(force: boolean): void {
		if (!force && this.current === this.lastPainted) return;
		this.lastPainted = this.current;
		this.btns.innerHTML = LEVELS_TOP_DOWN.map((l) => {
			const here = l.id === this.current;
			return `
        <button type="button" class="elev-btn${here ? ' elev-here' : ''}" data-level="${l.id}">
          <span class="elev-code">${l.code}</span>
          <span class="elev-meta">
            <b>${l.name}</b>
            <small>${here ? 'Je bent hier' : l.hint}</small>
          </span>
        </button>`;
		}).join('');
	}

	/** The deck a button stands for, or null when the click missed one. */
	private pickedLevel(e: Event): LevelId | null {
		const el = (e.target as HTMLElement | null)?.closest?.('.elev-btn') as HTMLElement | null;
		if (!el || !this.open) return null;
		const id = el.dataset['level'];
		const found = LEVELS.find((l) => l.id === id);
		if (!found || found.id === this.current) return null;
		return found.id;
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
		this.card = qs(this.host, '#elev-card');
		this.btns = qs(this.host, '#elev-btns');

		// Single delegated handler — survives repaints
		this.btns.addEventListener(
			'click',
			(e) => {
				e.preventDefault();
				e.stopPropagation();
				const id = this.pickedLevel(e);
				if (id) this.onPick(id);
			},
			true,
		);

		// Also mousedown — pointer-lock games often swallow click
		this.btns.addEventListener(
			'mousedown',
			(e) => {
				e.stopPropagation();
				const id = this.pickedLevel(e);
				if (!id) return;
				e.preventDefault();
				this.onPick(id);
			},
			true,
		);
	}
}
