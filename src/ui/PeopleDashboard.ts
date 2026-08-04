import { level } from '#/data/levels';
import type { PersonRow } from '#/scene/Americans';
import { qs } from '#/util/dom';

/** Non-shopper rows: dief, aap, DJ, catwalk-dame — the mall's fixed cast. */
export type CastRow = {
	icon: string;
	name: string;
	doing: string;
	floor: string;
};

function moodFace(u: number): string {
	if (u >= 70) return '😡';
	if (u >= 45) return '😒';
	if (u >= 25) return '🙂';
	return '😄';
}

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Bewoners-dashboard (B): every person in the mall, live — where they are,
 * what they're doing, how broke and how unhappy. Follow button = guest view.
 */
export class PeopleDashboard {
	private host: HTMLElement;
	private card!: HTMLElement;
	private listEl!: HTMLElement;
	private castEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private open = false;
	private onFollow: (id: number) => void;

	constructor(root: HTMLElement, onFollow: (id: number) => void) {
		this.onFollow = onFollow;
		this.host = document.createElement('div');
		this.host.className = 'people-host';
		root.appendChild(this.host);
		this.mount();
	}

	get isOpen(): boolean {
		return this.open;
	}

	toggle(force?: boolean): void {
		this.open = force === undefined ? !this.open : force;
		this.card.classList.toggle('hidden', !this.open);
	}

	/** Called ~2 Hz from App while open. */
	update(rows: PersonRow[], cast: CastRow[]): void {
		if (!this.open) return;

		let spent = 0;
		let grumpy = 0;
		for (const r of rows) {
			spent += r.moneySpent;
			if (r.unhappiness >= 55) grumpy++;
		}
		this.summaryEl.textContent = `${rows.length} shoppers · €${Math.round(spent)} uitgegeven · ${grumpy} chagrijnig`;

		this.listEl.innerHTML = rows
			.map(
				(r) => `
      <div class="pd-row" data-id="${r.id}">
        <span class="pd-mood">${moodFace(r.unhappiness)}</span>
        <span class="pd-main">
          <b>${esc(r.name)}${r.isKid ? ' 🧒' : ''}${
						r.partnerName ? ` ❤️ ${esc(r.partnerName.split(' ')[0] ?? r.partnerName)}` : ''
					}</b>
          <small>${esc(r.doing)}</small>
        </span>
        <span class="pd-meta">
          <span class="pd-floor">${level(r.level).code}</span>
          <span>€${Math.round(r.moneySpent)}</span>
          <span>${Math.round(r.dist)} m</span>
        </span>
        <button type="button" class="pd-follow" data-id="${r.id}" title="Guest view">👁</button>
      </div>`,
			)
			.join('');

		this.castEl.innerHTML = cast
			.map(
				(c) => `
      <div class="pd-row pd-cast">
        <span class="pd-mood">${c.icon}</span>
        <span class="pd-main"><b>${esc(c.name)}</b><small>${esc(c.doing)}</small></span>
        <span class="pd-meta"><span class="pd-floor">${esc(c.floor)}</span></span>
      </div>`,
			)
			.join('');

		this.listEl.querySelectorAll<HTMLElement>('.pd-follow').forEach((btn) => {
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				const id = Number(btn.dataset['id']);
				this.toggle(false);
				this.onFollow(id);
			});
		});
	}

	private mount(): void {
		this.host.innerHTML = `
      <div class="people-card hidden" id="people-card">
        <header class="people-head">
          <div>
            <strong>Bewoners</strong>
            <p id="people-summary">…</p>
          </div>
          <button type="button" class="settings-close" id="people-close">✕</button>
        </header>
        <div class="people-list" id="people-list"></div>
        <div class="people-cast-label">Vaste cast</div>
        <div class="people-list" id="people-cast"></div>
        <footer class="people-foot"><b>B</b> = openen/sluiten · 👁 = meekijken</footer>
      </div>
    `;
		this.card = qs(this.host, '#people-card');
		this.listEl = qs(this.host, '#people-list');
		this.castEl = qs(this.host, '#people-cast');
		this.summaryEl = qs(this.host, '#people-summary');

		qs(this.host, '#people-close').addEventListener('click', () => {
			this.toggle(false);
		});

		// B is handled in App (so we can refresh data on open). Esc closes here.
		window.addEventListener('keydown', (e) => {
			const el = e.target as HTMLElement | null;
			if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
			if (e.code === 'Escape' && this.open) {
				e.stopPropagation();
				this.toggle(false);
			}
		});
	}
}
