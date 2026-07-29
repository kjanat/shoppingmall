/**
 * Live playlist player — survives Vite HMR + hard refresh via sessionStorage.
 */

export type Track = { file: string; title: string; url: string; bytes: number };

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
		return JSON.parse(raw) as PersistState;
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

	constructor() {
		this.audio.volume = 0.55;
		this.audio.preload = 'auto';
		this.audio.addEventListener('ended', () => this.next());
		this.audio.addEventListener('error', () => {
			if (this.playlist.length > 1) this.next();
		});
		// Keep position fresh for HMR / reload
		this.audio.addEventListener('timeupdate', () => this.checkpoint());
		this.audio.addEventListener('pause', () => this.checkpoint());
		this.audio.addEventListener('play', () => this.checkpoint());
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
		if (!list.length) return false;
		// Map back to full playlist index
		const fullIdx = this.playlist.findIndex((t) => t.file === list[idx].file);
		this.audio.volume = Math.max(0.05, Math.min(1, p.volume ?? 0.55));
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
		this.audio.src = `/dj-music/${encodeURIComponent(t.file)}`;
		this.nowPlaying = t.title;
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

	setVolume(v: number): void {
		this.audio.volume = Math.max(0, Math.min(1, v));
		this.checkpoint();
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
				volume: this.audio.volume,
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
