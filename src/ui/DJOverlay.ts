import type { Track } from '../audio/DJPlayer';

/**
 * Request desk UI for DJ Bartek.
 */
export class DJOverlay {
	private root: HTMLElement;
	private input: HTMLInputElement;
	private list: HTMLElement;
	private status: HTMLElement;
	private now: HTMLElement;
	private chat: HTMLElement;
	private visible = false;

	onRequest: ((query: string) => void) | null = null;
	onPlay: (() => void) | null = null;
	onPause: (() => void) | null = null;
	onNext: (() => void) | null = null;
	onClose: (() => void) | null = null;
	onProbe: (() => void) | null = null;
	onGreet: (() => void) | null = null;
	onMicStart: (() => void) | null = null;
	onMicEnd: (() => void) | null = null;
	onRat: (() => void) | null = null;

	constructor(parent: HTMLElement) {
		this.root = document.createElement('div');
		this.root.id = 'dj-overlay';
		this.root.className = 'dj-overlay hidden';
		this.root.innerHTML = `
      <div class="dj-panel" role="dialog" aria-label="DJ Bartek booth">
        <header class="dj-head">
          <div>
            <div class="dj-badge">LIVE · TRAP-GAT</div>
            <h2>DJ BARTEK</h2>
            <p class="dj-sub">Bartek, Bartek, Bartek — request een plaatje (yt-dlp)</p>
          </div>
          <button type="button" class="dj-x" id="dj-close" title="Sluiten">×</button>
        </header>

        <div class="dj-now" id="dj-now">Nog niks op de decks…</div>
        <div class="dj-status" id="dj-status">Loop naar Bartek · E openen</div>

        <div class="dj-request-row">
          <input id="dj-query" type="search" placeholder="Request: bijv. Bartek deep house…" autocomplete="off" />
          <button type="button" class="dj-btn primary" id="dj-go">Request</button>
        </div>

        <div class="dj-mic-block">
          <button type="button" class="dj-btn mic" id="dj-mic">🎙️ Houd in · praat met Bartek</button>
          <div class="dj-chat" id="dj-chat"></div>
        </div>

        <div class="dj-actions">
          <button type="button" class="dj-btn" id="dj-greet">🎤 Hallo Bartek</button>
          <button type="button" class="dj-btn" id="dj-play">▶ Play</button>
          <button type="button" class="dj-btn" id="dj-pause">⏸ Pause</button>
          <button type="button" class="dj-btn" id="dj-next">⏭ Next</button>
          <button type="button" class="dj-btn probe" id="dj-probe">👽 Probe Americans</button>
          <button type="button" class="dj-btn" id="dj-rat">🐀 Roep rat</button>
        </div>

        <div class="dj-list-label">In de crates</div>
        <ul class="dj-list" id="dj-list"></ul>
      </div>
    `;
		parent.appendChild(this.root);
		this.input = this.root.querySelector('#dj-query')!;
		this.list = this.root.querySelector('#dj-list')!;
		this.status = this.root.querySelector('#dj-status')!;
		this.now = this.root.querySelector('#dj-now')!;
		this.chat = this.root.querySelector('#dj-chat')!;

		this.root.querySelector('#dj-close')!.addEventListener('click', () => this.hide());
		this.root.querySelector('#dj-go')!.addEventListener('click', () => this.submit());
		this.root.querySelector('#dj-play')!.addEventListener('click', () => this.onPlay?.());
		this.root.querySelector('#dj-pause')!.addEventListener('click', () => this.onPause?.());
		this.root.querySelector('#dj-next')!.addEventListener('click', () => this.onNext?.());
		this.root.querySelector('#dj-probe')!.addEventListener('click', () => this.onProbe?.());
		this.root.querySelector('#dj-greet')!.addEventListener('click', () => this.onGreet?.());
		this.root.querySelector('#dj-rat')!.addEventListener('click', () => this.onRat?.());
		const mic = this.root.querySelector('#dj-mic') as HTMLButtonElement;
		mic.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			mic.classList.add('hot');
			this.onMicStart?.();
		});
		const endMic = () => {
			mic.classList.remove('hot');
			this.onMicEnd?.();
		};
		mic.addEventListener('pointerup', endMic);
		mic.addEventListener('pointerleave', endMic);
		mic.addEventListener('pointercancel', endMic);
		this.input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.submit();
			}
			// Don't leak keys to player controls
			e.stopPropagation();
		});
		this.root.addEventListener('keydown', (e) => e.stopPropagation());
		this.root.addEventListener('click', (e) => {
			if (e.target === this.root) this.hide();
		});
	}

	isOpen(): boolean {
		return this.visible;
	}

	show(): void {
		this.visible = true;
		this.root.classList.remove('hidden');
		setTimeout(() => this.input.focus(), 50);
	}

	hide(): void {
		this.visible = false;
		this.root.classList.add('hidden');
		this.onClose?.();
	}

	setStatus(text: string): void {
		this.status.textContent = text;
	}

	setChat(lines: { who: 'you' | 'bartek'; text: string }[], status?: string): void {
		this.chat.innerHTML = lines
			.map(
				(l) =>
					`<div class="dj-chat-line ${l.who}"><b>${l.who === 'you' ? 'Jij' : 'Bartek'}:</b> ${
						escapeHtml(l.text)
					}</div>`,
			)
			.join('');
		this.chat.scrollTop = this.chat.scrollHeight;
		if (status) this.setStatus(status);
	}

	setNowPlaying(title: string, playing: boolean): void {
		this.now.textContent = playing ? `♪ LIVE · ${title}` : title ? `⏸ ${title}` : 'Nog niks op de decks…';
	}

	setTracks(tracks: Track[]): void {
		if (!tracks.length) {
			this.list.innerHTML = '<li class="dj-empty">Crates leeg — request iets, yt-dlp haalt het op.</li>';
			return;
		}
		this.list.innerHTML = tracks
			.map(
				(t, i) => `<li data-i="${i}"><button type="button" class="dj-track">${escapeHtml(t.title)}</button></li>`,
			)
			.join('');
		this.list.querySelectorAll('.dj-track').forEach((btn, i) => {
			btn.addEventListener('click', () => {
				// parent App will play by index via onPlay after set — use custom event
				this.root.dispatchEvent(new CustomEvent('dj-play-index', { detail: i }));
			});
		});
	}

	private submit(): void {
		const q = this.input.value.trim();
		if (!q) {
			this.setStatus('Typ een plaatje, jongen.');
			return;
		}
		this.setStatus(`Bartek downloadt “${q}” via yt-dlp…`);
		this.onRequest?.(q);
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
