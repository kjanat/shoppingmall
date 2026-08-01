/**
 * Live playlist player — survives Vite HMR + hard refresh via sessionStorage.
 * When binaural is enabled, the element is routed through SpatialAudio HRTF
 * at the booth position (headphones: DJ is "over there").
 */

import { type SpatialElement, spatial } from './SpatialAudio';

export type Track = {
	file: string;
	title: string;
	url: string;
	bytes: number;
	/** From yt-dlp's info.json sidecar — absent for hand-dropped files. */
	artist?: string;
	seconds?: number;
	videoId?: string;
	sourceUrl?: string;
};

/** 263 → "4:23" */
function clock(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}

const PERSIST_KEY = 'mallsim.dj.v1';

type PersistState = {
	file: string;
	title: string;
	index: number;
	time: number;
	playing: boolean;
	volume: number;
};

function loadPersist(): PersistState | null {
	try {
		const raw = sessionStorage.getItem(PERSIST_KEY);
		if (!raw) return null;
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function savePersist(s: PersistState): void {
	try {
		sessionStorage.setItem(PERSIST_KEY, JSON.stringify(s));
	} catch {
		/* private mode */
	}
}

export class DJPlayer {
	private audio = new Audio();
	private playlist: Track[] = [];
	private index = 0;
	playing = false;
	nowPlaying = '';
	onChange: ((info: { title: string; playing: boolean; index: number }) => void) | null = null;
	private persistTimer: number | null = null;
	private restored = false;
	/** Consecutive load failures — breaks the error→next→error spiral */
	private failStreak = 0;
	/** Binaural booth bus (null until first user gesture attaches it) */
	private spatialEl: SpatialElement | null = null;

	constructor() {
		this.audio.volume = 0.55;
		this.audio.preload = 'auto';
		this.audio.addEventListener('ended', () => {
			this.failStreak = 0;
			this.next();
		});
		// Skip a dud track, but never spin the whole crate: a broken source
		// fires error → next → error… faster than the ear can follow.
		this.audio.addEventListener('error', () => {
			if (this.playlist.length > 1 && ++this.failStreak < 3) this.next();
			else this.playing = false;
		});
		this.audio.addEventListener('playing', () => {
			this.failStreak = 0;
		});
		// Keep position fresh for HMR / reload
		this.audio.addEventListener('timeupdate', () => this.checkpoint());
		this.audio.addEventListener('pause', () => this.checkpoint());
		this.audio.addEventListener('play', () => this.checkpoint());
	}

	/**
	 * Route the deck through HRTF at the booth. Call after a user gesture
	 * so AudioContext is running. Safe to call multiple times.
	 */
	enableBinauralBooth(pos: { x: number; y: number; z: number }): void {
		spatial.ensure();
		this.spatialEl = spatial.attachElementAt(this.audio, pos, {
			volume: this.baseVolume,
			k: 0.012,
			maxDistance: 55,
			refDistance: 3.5,
		});
		// Element level fixed; SpatialElement owns loudness
		this.audio.volume = 1;
		this.applyVolume();
	}

	/** Move the virtual booth (if Bartek ever relocates) */
	setBoothPosition(x: number, y: number, z: number): void {
		this.spatialEl?.setPosition(x, y, z);
	}

	/** Call once after first user gesture + playlist load */
	async restoreIfNeeded(): Promise<boolean> {
		if (this.restored) return false;
		this.restored = true;
		const p = loadPersist();
		if (!p?.file) return false;
		await this.refreshPlaylist();
		// Skip voice intros
		const music = this.playlist.filter((t) => !/intro_voice|voice/i.test(t.file));
		const list = music.length ? music : this.playlist;
		let idx = list.findIndex((t) => t.file === p.file);
		if (idx < 0) idx = 0;
		const stored = list[idx];
		if (!stored) return false;
		// Map back to full playlist index
		const fullIdx = this.playlist.findIndex((t) => t.file === stored.file);
		this.setVolume(Math.max(0.05, Math.min(1, p.volume ?? 0.55)));
		await this.playIndex(fullIdx >= 0 ? fullIdx : 0, p.time ?? 0, p.playing !== false);
		return true;
	}

	async refreshPlaylist(): Promise<Track[]> {
		try {
			const r = await fetch('/api/dj/playlist');
			const data = (await r.json()) as { tracks: Track[] };
			this.playlist = data.tracks ?? [];
			return this.playlist;
		} catch {
			this.playlist = [];
			return [];
		}
	}

	get tracks(): Track[] {
		return this.playlist;
	}

	async playIndex(i: number, seekTo = 0, autoplay = true): Promise<void> {
		if (!this.playlist.length) await this.refreshPlaylist();
		if (!this.playlist.length) return;
		this.index = ((i % this.playlist.length) + this.playlist.length) % this.playlist.length;
		const t = this.playlist[this.index];
		if (!t) return;
		// The URL the API handed us — it streams live from public/dj-music and
		// speaks Range, so tracks added after startup play and seek fine.
		this.audio.src = t.url || `/dj-music/${encodeURIComponent(t.file)}`;
		// Sidecar metadata when the crate has it: "Uploader — Title · 4:23"
		this.nowPlaying = [t.artist ? `${t.artist} — ${t.title}` : t.title, t.seconds ? ` · ${clock(t.seconds)}` : ''].join('');
		this.playing = autoplay;
		const onMeta = () => {
			if (seekTo > 0 && Number.isFinite(this.audio.duration)) {
				this.audio.currentTime = Math.min(seekTo, Math.max(0, this.audio.duration - 0.5));
			}
			this.audio.removeEventListener('loadedmetadata', onMeta);
		};
		this.audio.addEventListener('loadedmetadata', onMeta);
		if (autoplay) {
			try {
				await this.audio.play();
			} catch {
				this.playing = false;
			}
		}
		this.checkpoint();
		this.emit();
	}

	async play(): Promise<void> {
		if (!this.playlist.length) await this.refreshPlaylist();
		if (!this.playlist.length) return;
		if (this.audio.src && !this.audio.ended) {
			try {
				await this.audio.play();
				this.playing = true;
			} catch {
				/* */
			}
			this.checkpoint();
			this.emit();
			return;
		}
		await this.playIndex(this.index);
	}

	pause(): void {
		this.audio.pause();
		this.playing = false;
		this.checkpoint();
		this.emit();
	}

	toggle(): void {
		if (this.playing) this.pause();
		else void this.play();
	}

	next(): void {
		void this.playIndex(this.index + 1);
	}

	prev(): void {
		void this.playIndex(this.index - 1);
	}

	/** Door de gebruiker gekozen volume — afstand schaalt hier bovenop. */
	private baseVolume = 0.55;
	private distanceGain = 1;

	setVolume(v: number): void {
		this.baseVolume = Math.max(0, Math.min(1, v));
		this.applyVolume();
		this.checkpoint();
	}

	/**
	 * Afstands-falloff vanaf de DJ-booth.
	 * With binaural booth: SpatialElement.apply() already does quadratic
	 * falloff from listener pose — this only multiplies the fader slightly
	 * so UI distance still feels right if pose updates lag a frame.
	 */
	setDistanceGain(g: number): void {
		this.distanceGain = Math.max(0.02, Math.min(1, g));
		this.applyVolume();
	}

	private applyVolume(): void {
		if (this.spatialEl) {
			// HRTF path: base × mild distance on the WebAudio gain
			this.spatialEl.setBaseVolume(this.baseVolume * this.distanceGain);
			this.audio.volume = 1;
		} else {
			this.audio.volume = Math.max(0, Math.min(1, this.baseVolume * this.distanceGain));
		}
	}

	async requestSong(query: string): Promise<{ ok: boolean; message: string; file?: string }> {
		try {
			const r = await fetch('/api/dj/request', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query }),
			});
			const data = (await r.json()) as {
				ok: boolean;
				file?: string;
				title?: string;
				videoId?: string;
				tracks?: Track[];
				error?: string;
				log?: string;
			};
			if (data.tracks) this.playlist = data.tracks;
			if (data.ok && data.file) {
				const idx = this.playlist.findIndex((t) => t.file === data.file);
				if (idx >= 0) await this.playIndex(idx);
				const label = data.title ?? data.file;
				return {
					ok: true,
					message: `♪ ${label}${data.videoId ? ` · yt:${data.videoId}` : ''}`,
					file: data.file,
				};
			}
			// Surface yt-dlp / API log tail so booth status is useful
			const tail = (data.log ?? '').split('\n').filter(Boolean).slice(-3).join(' · ');
			return {
				ok: false,
				message: tail || data.error || 'Download mislukt',
			};
		} catch (e) {
			return { ok: false, message: String(e) };
		}
	}

	private checkpoint(): void {
		const file = this.playlist[this.index]?.file;
		if (!file) return;
		// throttle writes
		if (this.persistTimer !== null) return;
		this.persistTimer = window.setTimeout(() => {
			this.persistTimer = null;
			const f = this.playlist[this.index]?.file;
			if (!f) return;
			savePersist({
				file: f,
				title: this.nowPlaying,
				index: this.index,
				time: this.audio.currentTime || 0,
				playing: this.playing && !this.audio.paused,
				// baseVolume, niet audio.volume: anders slaat een checkpoint ver van
				// de booth het weggezakte afstandsvolume op als jouw voorkeur
				volume: this.baseVolume,
			});
		}, 400);
	}

	private emit(): void {
		this.onChange?.({
			title: this.nowPlaying,
			playing: this.playing,
			index: this.index,
		});
	}
}
