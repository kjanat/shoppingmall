import type { DJPlayer } from '#/audio/DJPlayer';
import { qs } from '#/util/dom';

/**
 * Permanente mini-player, altijd in beeld: play/pauze, volgende, volume en een
 * verzoekje-knop — zodat je muziek kunt bedienen zonder terug naar de booth.
 * Het volume dat je hier zet is je basisvolume; de afstand tot Bartek schaalt
 * daar live overheen.
 */
export class DJWidget {
	private host: HTMLElement;
	private titleEl!: HTMLElement;
	private playBtn!: HTMLButtonElement;
	private player: DJPlayer;
	private onOpenBooth: () => void;

	constructor(root: HTMLElement, player: DJPlayer, onOpenBooth: () => void) {
		this.player = player;
		this.onOpenBooth = onOpenBooth;
		this.host = document.createElement('div');
		this.host.className = 'dj-widget';
		root.appendChild(this.host);
		this.mount();

		// Player meldt trackwissels / play-pauze zelf
		const prev = player.onChange;
		player.onChange = (info) => {
			prev?.(info);
			this.titleEl.textContent = info.title || 'Crates leeg — request iets';
			this.playBtn.textContent = info.playing ? '⏸' : '▶';
		};
	}

	private mount(): void {
		this.host.innerHTML = `
      <span class="dj-widget-icon">🎧</span>
      <span class="dj-widget-title" id="djw-title">DJ Bartek · stil</span>
      <button type="button" id="djw-play" title="Play / pauze">▶</button>
      <button type="button" id="djw-next" title="Volgende track">⏭</button>
      <input type="range" id="djw-vol" min="0" max="1" step="0.05" title="Volume" />
      <button type="button" id="djw-req" title="Verzoekje (opent de booth)">➕</button>
    `;
		this.titleEl = qs(this.host, '#djw-title');
		this.playBtn = qs(this.host, '#djw-play');
		const vol = qs<HTMLInputElement>(this.host, '#djw-vol');
		vol.value = '0.55';

		this.playBtn.addEventListener('click', () => {
			void this.player.toggle();
		});
		qs(this.host, '#djw-next').addEventListener('click', () => {
			this.player.next();
		});
		vol.addEventListener('input', () => {
			this.player.setVolume(Number(vol.value));
		});
		qs(this.host, '#djw-req').addEventListener('click', () => {
			this.onOpenBooth();
		});
	}
}
