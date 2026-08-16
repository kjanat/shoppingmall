/**
 * Live playlist player — survives Vite HMR + hard refresh via sessionStorage.
 * When binaural is enabled, the element is routed through SpatialAudio HRTF
 * at the booth position (headphones: DJ is "over there").
 */

import { clamp, clamp01 } from '#/util/math';
import type { SpatialElement } from './SpatialAudio';
import { spatial } from './SpatialAudio';

interface Track {
	file: string;
	title: string;
	url: string;
	bytes: number;
	/** From the DJ library database; absent for hand-dropped files. */
	artist?: string;
	seconds?: number;
	videoId?: string;
	sourceUrl?: string;
}
/** 263 → "4:23" */
function clock(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}

const PERSIST_KEY = 'mallsim.dj.v1';
const RE_VOICE_INTRO = /intro_voice|voice/i;
const DEFAULT_VOLUME = 0.55;
const MAX_FAIL_STREAK = 3;
const MIN_PERSISTED_VOLUME = 0.05;
const SEEK_END_GUARD_SECONDS = 0.5;
const MIN_DISTANCE_GAIN = 0.02;
const REQUEST_LOG_LINES = 3;
const PERSIST_DELAY_MS = 400;

/** Kwadratische afstands-falloff van de DJ-booth: 1/(1+k·d²). Het audio-pad en de fader-compensatie in App delen hem, zodat ze dezelfde vorm volgen. */
const BOOTH_FALLOFF_K = 0.012;

interface PersistState {
	file: string;
	title: string;
	index: number;
	time: number;
	playing: boolean;
	volume: number;
}

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

// biome-ignore lint/style/useNamingConvention: leave me alone
class DJPlayer {
	private readonly audio = new Audio();
	private playlist: Track[] = [];
	private index = 0;
	playing: boolean;
	nowPlaying = '';
	onChange: ((info: { title: string; playing: boolean; index: number }) => void) | null = null;
	private persistTimer: ReturnType<typeof setTimeout> | null = null;
	private restored: boolean;
	/** Consecutive load failures — breaks the error→next→error spiral */
	private failStreak = 0;
	/** Binaural booth bus (null until first user gesture attaches it) */
	private spatialEl: SpatialElement | null = null;

	constructor() {
		this.playing = false;
		this.restored = false;
		this.audio.volume = DEFAULT_VOLUME;
		this.audio.preload = 'auto';
		this.audio.addEventListener('ended', () => {
			this.failStreak = 0;
			this.next();
		});
		// Skip a dud track, but never spin the whole library: a broken source
		// fires error → next → error… faster than the ear can follow.
		this.audio.addEventListener('error', () => {
			if (this.playlist.length > 1 && ++this.failStreak < MAX_FAIL_STREAK) this.next();
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
			k: BOOTH_FALLOFF_K,
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
		const music = this.playlist.filter((t) => !RE_VOICE_INTRO.test(t.file));
		const list = music.length > 0 ? music : this.playlist;
		let idx = list.findIndex((t) => t.file === p.file);
		if (idx < 0) idx = 0;
		const stored = list[idx];
		if (!stored) return false;
		// Map back to full playlist index
		const fullIdx = this.playlist.findIndex((t) => t.file === stored.file);
		this.setVolume(clamp(p.volume, MIN_PERSISTED_VOLUME, 1));
		await this.playIndex(fullIdx >= 0 ? fullIdx : 0, p.time, p.playing !== false);
		return true;
	}

	async refreshPlaylist(): Promise<Track[]> {
		try {
			const r = await fetch('/api/dj/playlist');
			const data = (await r.json()) as { tracks: Track[] };
			this.playlist = data.tracks;
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
		if (this.playlist.length === 0) await this.refreshPlaylist();
		if (this.playlist.length === 0) return;
		this.index = ((i % this.playlist.length) + this.playlist.length) % this.playlist.length;
		const t = this.playlist[this.index];
		if (!t) return;
		// The API streams private audio with Range support, so tracks added after
		// startup play and seek without exposing the storage directory.
		this.audio.src = t.url || `/api/dj/file/${encodeURIComponent(t.file)}`;
		// Download metadata when the library has it: "Uploader — Title · 4:23"
		this.nowPlaying = [t.artist ? `${t.artist} — ${t.title}` : t.title, t.seconds ? ` · ${clock(t.seconds)}` : ''].join('');
		this.playing = autoplay;
		const onMeta = () => {
			if (seekTo > 0 && Number.isFinite(this.audio.duration)) {
				const maxSeekTime = Math.max(0, this.audio.duration - SEEK_END_GUARD_SECONDS);
				this.audio.currentTime = Math.min(seekTo, maxSeekTime);
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
		if (this.playlist.length === 0) await this.refreshPlaylist();
		if (this.playlist.length === 0) return;
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
		else this.play().catch(() => undefined);
	}

	next(): void {
		this.playIndex(this.index + 1).catch(() => undefined);
	}

	prev(): void {
		this.playIndex(this.index - 1).catch(() => undefined);
	}

	/** Door de gebruiker gekozen volume — afstand schaalt hier bovenop. */
	private baseVolume = DEFAULT_VOLUME;
	private distanceGain = 1;

	setVolume(v: number): void {
		this.baseVolume = clamp01(v);
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
		this.distanceGain = clamp(g, MIN_DISTANCE_GAIN, 1);
		this.applyVolume();
	}

	private applyVolume(): void {
		if (this.spatialEl) {
			// HRTF path: base × mild distance on the WebAudio gain
			this.spatialEl.setBaseVolume(this.baseVolume * this.distanceGain);
			this.audio.volume = 1;
		} else {
			this.audio.volume = clamp01(this.baseVolume * this.distanceGain);
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
			const tail = (data.log ?? '').split('\n').filter(Boolean).slice(-REQUEST_LOG_LINES).join(' · ');
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
		this.persistTimer = globalThis.setTimeout(() => {
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
		}, PERSIST_DELAY_MS);
	}

	private emit(): void {
		this.onChange?.({
			title: this.nowPlaying,
			playing: this.playing,
			index: this.index,
		});
	}
}

export type { Track };
export { BOOTH_FALLOFF_K, DJPlayer };
