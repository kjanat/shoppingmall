/**
 * Live stream / playlist player for DJ Bartek's booth.
 */

export type Track = { file: string; title: string; url: string; bytes: number };

export class DJPlayer {
	private audio = new Audio();
	private playlist: Track[] = [];
	private index = 0;
	playing = false;
	nowPlaying = '';
	onChange: ((info: { title: string; playing: boolean; index: number }) => void) | null = null;

	constructor() {
		this.audio.volume = 0.55;
		this.audio.addEventListener('ended', () => this.next());
		this.audio.addEventListener('error', () => {
			// skip bad file
			if (this.playlist.length > 1) this.next();
		});
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

	async playIndex(i: number): Promise<void> {
		if (!this.playlist.length) await this.refreshPlaylist();
		if (!this.playlist.length) return;
		this.index = ((i % this.playlist.length) + this.playlist.length) % this.playlist.length;
		const t = this.playlist[this.index];
		// Vite serves public/ at root; base may be ./
		this.audio.src = `/dj-music/${encodeURIComponent(t.file)}`;
		this.nowPlaying = t.title;
		this.playing = true;
		try {
			await this.audio.play();
		} catch {
			// autoplay policy — will play after gesture
		}
		this.emit();
	}

	async play(): Promise<void> {
		if (!this.playlist.length) await this.refreshPlaylist();
		if (!this.playlist.length) return;
		if (this.audio.src && !this.audio.ended) {
			await this.audio.play();
			this.playing = true;
			this.emit();
			return;
		}
		await this.playIndex(this.index);
	}

	pause(): void {
		this.audio.pause();
		this.playing = false;
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
	}

	/** Request a song via yt-dlp backend, then queue it */
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
				tracks?: Track[];
				error?: string;
				log?: string;
			};
			if (data.tracks) this.playlist = data.tracks;
			if (data.ok && data.file) {
				const idx = this.playlist.findIndex((t) => t.file === data.file);
				if (idx >= 0) await this.playIndex(idx);
				return { ok: true, message: `Draait: ${data.file}`, file: data.file };
			}
			return {
				ok: false,
				message: data.error ?? data.log?.slice(0, 120) ?? 'Download mislukt',
			};
		} catch (e) {
			return { ok: false, message: String(e) };
		}
	}

	private emit(): void {
		this.onChange?.({
			title: this.nowPlaying,
			playing: this.playing,
			index: this.index,
		});
	}
}
