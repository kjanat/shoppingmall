import type { EffectComposer } from 'postprocessing';
import * as THREE from 'three';
import { BartekChat } from '../audio/BartekChat';
import { DJPlayer } from '../audio/DJPlayer';
import { fetchDjStatus, playBoothFile, speakLine } from '../audio/ElevenVoice';
import { spatial } from '../audio/SpatialAudio';
import { Director } from '../camera/Director';
import type { GraphNode } from '../data/graph';
import { getStore, type StoreDef } from '../data/stores';
import { Pathfinder } from '../path/Pathfinder';
import { PathMesh } from '../path/PathMesh';
import { CollisionWorld } from '../physics/Collision';
import { PlayerControls } from '../player/Controls';
import { createComposer } from '../post/Composer';
import { AlienProbe } from '../scene/AlienProbe';
import { Amenities } from '../scene/Amenities';
import { Atmosphere } from '../scene/Atmosphere';
import { DiscoParty } from '../scene/Disco';
import { BARTEK_LINES, DJBartek } from '../scene/DJBartek';
import { setupLighting } from '../scene/Lighting';
import { MallBuilder } from '../scene/MallBuilder';
import { MallRat } from '../scene/MallRat';
import { Monkey } from '../scene/Monkey';
import { PalmForest } from '../scene/Palms';
import { PrayerRoom } from '../scene/PrayerRoom';
import { Restrooms } from '../scene/Restrooms';
import { ShopVoice } from '../scene/ShopVoice';
import { Spaceship } from '../scene/Spaceship';
import { StockDisplay } from '../scene/StockDisplay';
import { BakerThief } from '../scene/Thief';
import { MovingWalkways } from '../scene/Walkways';
import { DJOverlay } from '../ui/DJOverlay';
import { KioskOverlay, type MapBlip } from '../ui/KioskOverlay';
import { SettingsPanel } from '../ui/SettingsPanel';

const PLAYER_RADIUS = 0.4;

export class App {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera: THREE.PerspectiveCamera;
	private composer: EffectComposer;
	private director: Director;
	private pathfinder = new Pathfinder();
	private pathMesh = new PathMesh();
	private world = new CollisionWorld();
	private atmosphere: Atmosphere;
	private mall = new MallBuilder();
	private palms = new PalmForest();
	private walkways = new MovingWalkways();
	private amenities = new Amenities();
	private disco = new DiscoParty();
	private stock = new StockDisplay();
	private spaceship = new Spaceship();
	private thief: BakerThief;
	private rat!: MallRat;
	private prayer = new PrayerRoom();
	private restrooms = new Restrooms();
	private bartekChat = new BartekChat();
	private djBartek = new DJBartek();
	private alienProbe = new AlienProbe();
	private monkey!: Monkey;
	/** reused each frame for the monkey's target list */
	private simPositions: THREE.Vector3[] = [];
	private djPlayer = new DJPlayer();
	private shopVoice = new ShopVoice();
	private djUi!: DJOverlay;
	private youssefHint = false;
	private settingsUi!: SettingsPanel;
	private player!: PlayerControls;
	private ui: KioskOverlay;
	private clock = new THREE.Clock();
	private currentPath: GraphNode[] = [];
	private currentStore: StoreDef | null = null;
	private confetti: THREE.Points | null = null;
	private confettiVel: Float32Array | null = null;
	private score = 0;
	private metSims = new Set<number>();
	private nearHudT = 0;
	/** reused every frame so the minimap doesn't allocate 20 objects per tick */
	private mapBlips: MapBlip[] = [];
	private unlockedAt = -1e4;
	/** free walk after intro; disabled during cinematic tour */
	private freeMove = false;
	/** RCT-style: ride along as a guest */
	private possessId: number | null = null;
	private thiefFiredAt = 0;
	private nearDjHint = false;
	private bartekSpeaking = false;
	private crowdCheerCd = 0;

	constructor(canvasParent: HTMLElement, uiRoot: HTMLElement) {
		this.atmosphere = new Atmosphere(this.world);
		this.thief = new BakerThief(this.world);
		this.rat = new MallRat(this.world);

		this.renderer = new THREE.WebGLRenderer({
			antialias: true,
			powerPreference: 'high-performance',
		});
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.NoToneMapping;
		canvasParent.appendChild(this.renderer.domElement);

		// Wider FOV feels more first-person / walking through a mall
		this.camera = new THREE.PerspectiveCamera(
			70,
			window.innerWidth / window.innerHeight,
			0.15,
			200,
		);

		setupLighting(this.scene);
		this.disco.bindScene(this.scene);
		this.scene.add(this.mall.build());
		// Wire Youssef + all keepers for speech bubbles + ElevenLabs
		this.shopVoice.bindFromMall(this.mall.group);
		this.scene.add(this.palms.group);
		this.scene.add(this.walkways.group);
		this.scene.add(this.amenities.group);
		this.scene.add(this.disco.group);
		this.scene.add(this.stock.group);
		this.scene.add(this.spaceship.group);
		this.scene.add(this.atmosphere.group);
		this.scene.add(this.thief.group);
		this.scene.add(this.rat.group);
		this.scene.add(this.prayer.group);
		this.scene.add(this.restrooms.group);
		// WC walls block walking
		for (const c of this.restrooms.getColliders()) {
			this.world.addBox(c.minX, c.maxX, c.minZ, c.maxZ, {
				minY: -0.5,
				maxY: 3.2,
				label: c.label,
			});
		}
		this.scene.add(this.pathMesh.group);
		this.scene.add(this.djBartek.group);
		this.scene.add(this.alienProbe.group);
		this.alienProbe.bind(this.atmosphere.americans);

		// Camera lives in the scene so the monkey can smear the lens
		this.scene.add(this.camera);
		this.monkey = new Monkey(this.world, this.camera);
		this.scene.add(this.monkey.group);
		this.monkey.setHitCallback((hit) => {
			if (hit.what === 'player') {
				this.score = Math.max(0, this.score - 8);
				this.ui.setScore(this.score, this.metSims.size);
				this.ui.setStatus('🐒💩 VOLLE TREFFER — de aap gooide kak in je gezicht (−8)');
				this.spawnConfetti(new THREE.Vector3(hit.x, hit.y + 0.4, hit.z));
			} else if (hit.what === 'sim') {
				// The whole crowd notices
				this.atmosphere.americans.nudgeAllMood(4);
				this.ui.setStatus('🐒💩 De aap raakte een shopper — publiek is niet blij');
			}
		});

		this.director = new Director(this.camera);
		this.composer = createComposer(this.renderer, this.scene, this.camera);
		this.player = new PlayerControls(this.camera, this.renderer.domElement, this.world);
		this.player.enabled = false;
		this.player.onLockChange = (locked) => {
			this.ui.setLocked(locked);
			if (locked) {
				this.ui.setStatus('Muis gevangen · WASD lopen · Shift rennen · Esc = los');
			} else {
				this.unlockedAt = performance.now();
				this.ui.setStatus('Muis los · klik het beeld om weer te kijken');
			}
		};

		this.atmosphere.americans.setTransactionCallback((count, pos, storeId) => {
			this.score += 2;
			this.ui.setScore(this.score, this.metSims.size);
			// Money goes to SHOPKEEPER register — not the void
			if (storeId) {
				this.stock.flashSale(storeId);
				// Owner SPEAKS (Youssef especially) — not silent text on a guest
				void this.shopVoice.onCheckout(storeId);
			}
			const ownerHint = storeId === 'kruidvat' ? 'Youssef Benali' : storeId ?? '?';
			this.ui.setStatus(
				`Kassa ${ownerHint} · checkout #${count} · muntjes → verkoper 💰`,
			);
			// Every 5 checkouts → baard-dief (slow heist)
			if (count > 0 && count % 5 === 0 && count !== this.thiefFiredAt) {
				this.thiefFiredAt = count;
				this.thief.trigger();
				this.ui.setStatus(`🧔 BAARD-DIEF (langzaam) pakt juwelen! (txn ${count})`);
				this.spawnConfetti(pos.clone().add(new THREE.Vector3(0, 2, 0)));
			}
		});
		this.thief.setLootCallback((pos) => {
			this.spawnConfetti(pos.clone().add(new THREE.Vector3(0, 1.5, 0)));
			this.score = Math.max(0, this.score - 15);
			this.ui.setScore(this.score, this.metSims.size);
		});

		this.ui = new KioskOverlay(uiRoot, {
			onSelectStore: (s) => this.onSelectStore(s),
			onStartRoute: (s) => this.onStartRoute(s),
			onCancel: () => this.onCancel(),
			onHome: () => this.onHome(),
			onReplay: () => {
				const store = this.currentStore ?? getStore('kruidvat')!;
				this.onStartRoute(store);
			},
			onPossess: () => this.togglePossess(),
			onDisco: () => this.toggleDisco(),
			onGiveMoney: () => this.giveMoney(),
			onSummonThief: () => {
				this.thief.trigger();
				this.ui.setStatus('🧔 BAARD-DIEF is los (traag) — kijk goed!');
			},
			onMood: (delta) => this.nudgeGuestMood(delta),
		});

		this.djUi = new DJOverlay(uiRoot);
		this.wireDjBooth();

		// Control scheme menu (⚙ / O) — mouse, no-mouse or tank steering
		this.settingsUi = new SettingsPanel(uiRoot, (s) => {
			this.player.applySettings(s);
			this.ui.setStatus(
				s.mouseLook
					? `Besturing: muis kijken${s.lookButton === 2 ? ' (rechtsklik)' : ''}${
						s.turnWithKeys ? ' + A/D draaien' : ''
					}`
					: 'Besturing: geen muis · A/D draaien · R/F kijken',
			);
		});

		window.addEventListener('resize', () => this.onResize());
		window.addEventListener('keydown', (e) => {
			// DJ booth captures typing — don't steal keys
			if (this.djUi.isOpen() && e.key !== 'Escape' && e.key !== 'e' && e.key !== 'E') {
				return;
			}
			if (e.key === 'k' || e.key === 'K') {
				this.onStartRoute(getStore('kruidvat')!);
			}
			if (e.key === 'Escape') {
				if (this.djUi.isOpen()) {
					this.djUi.hide();
					return;
				}
				// Esc while the mouse is captured just frees the mouse — it must not
				// also cancel your route and teleport you back to the kiosk.
				const justUnlocked = performance.now() - this.unlockedAt < 400;
				if (this.player.locked || justUnlocked) {
					this.player.releaseLook();
				} else if (this.possessId !== null) {
					this.togglePossess(false);
				} else {
					this.onCancel();
				}
			}
			if (e.key === 'h' || e.key === 'H') this.onHome();
			if (e.key === 'v' || e.key === 'V') this.togglePossess();
			if (e.key === 'p' || e.key === 'P') this.toggleDisco();
			if (e.key === 'g' || e.key === 'G') this.giveMoney();
			if (e.key === 't' || e.key === 'T') {
				this.thief.trigger();
				this.ui.setStatus('🧔 BAARD-DIEF (T) — juwelen heist!');
			}
			// J = provoke the atrium monkey
			if (e.key === 'j' || e.key === 'J') {
				this.ui.setStatus(
					this.monkey.provoke()
						? '🐒 De aap pakt een handvol kak… duiken!'
						: '🐒 De aap heeft even niks bij de hand',
				);
			}
			// E = talk to DJ Bartek OR nearest shopkeeper (Youssef!)
			if (e.key === 'e' || e.key === 'E') {
				if (this.djBartek.inRange(this.camera.position)) {
					void this.openDjBooth();
				} else {
					void this.talkToShopkeeper();
				}
			}
			if (e.key === 'b' || e.key === 'B') {
				// Jump cue to Bartek
				this.ui.setStatus('→ DJ Bartek bij de west-trap (−20, −6)');
			}
		});

		// Unlock audio after first click/key
		const unlock = () => {
			this.atmosphere.americans.ensureAudio();
			spatial.ensure();
			this.prayer.ensureAudio();
			// Resume DJ track after HMR / refresh (needs a user gesture for autoplay)
			void this.djPlayer.restoreIfNeeded().then((ok) => {
				if (ok) this.ui.setStatus('♪ Muziek hervat (persist na reload)');
			});
			window.removeEventListener('pointerdown', unlock);
			window.removeEventListener('keydown', unlock);
		};
		window.addEventListener('pointerdown', unlock);
		window.addEventListener('keydown', unlock);

		this.director.playIntro(() => {
			this.ui.hideBoot();
			this.ui.setStatus('Klik = muis vangen · WASD lopen · Shift rennen · M = kaart');
			this.ui.setScore(this.score, this.metSims.size);
			// Hand control to player
			this.freeMove = true;
			this.player.enabled = true;
			this.player.syncFromCamera();
		});

		// Dev-only handle for poking at the sim from the console / smoke tests
		if (import.meta.env.DEV) {
			(window as unknown as { mallsim: App }).mallsim = this;
		}

		this.animate();
	}

	/** Dev helper: drop the player somewhere and re-seat the controller. */
	teleport(x: number, y: number, z: number, yaw = 0): void {
		this.camera.position.set(x, y, z);
		this.camera.rotation.order = 'YXZ';
		this.camera.rotation.set(0, yaw, 0);
		this.player.syncFromCamera();
	}

	get debugState() {
		return {
			x: this.camera.position.x,
			y: this.camera.position.y,
			z: this.camera.position.z,
			yaw: this.player.heading,
			floor: this.player.floor,
			freeMove: this.freeMove,
		};
	}

	private onHome(): void {
		this.exitPossess();
		this.pathMesh.clear();
		this.currentPath = [];
		this.clearConfetti();
		this.ui.clearSelection();
		this.ui.hideArrive();
		this.freeMove = false;
		this.player.enabled = false;
		this.director.goHome(true, () => {
			this.ui.setStatus('WASD lopen · V = word een gast (RCT mode)');
			this.freeMove = true;
			this.player.enabled = true;
			this.player.syncFromCamera();
		});
	}

	private togglePossess(force?: boolean): void {
		const want = force === undefined ? this.possessId === null : force;
		if (!want) {
			this.exitPossess();
			return;
		}
		const id = this.atmosphere.americans.getNearestSimId(this.camera.position);
		if (id === null) {
			this.ui.setStatus('Geen sim dichtbij — loop dichterbij en druk V');
			return;
		}
		this.possessId = id;
		this.atmosphere.americans.setSimVisible(id, false);
		this.freeMove = false;
		this.player.enabled = false; // Snap camera into the head immediately (no lerp-from-ass start)
		const eye = this.atmosphere.americans.getSimEye(id);
		if (eye) {
			this.camera.position.copy(eye.pos);
			this.camera.rotation.order = 'YXZ';
			this.camera.rotation.set(0, eye.yaw, 0);
		}
		const f = this.atmosphere.americans.roster.find((r) => r.id === id);
		this.ui.setStatus(`GUEST VIEW · uit de ogen van ${f?.name ?? 'sim'} · Esc/V = stop`);
		this.ui.setPossessing(true, f?.name ?? 'Gast');
	}

	private exitPossess(): void {
		if (this.possessId !== null) {
			this.atmosphere.americans.setSimVisible(this.possessId, true);
			this.possessId = null;
		}
		this.ui.setPossessing(false);
		this.freeMove = true;
		this.player.enabled = true;
		this.player.syncFromCamera();
		this.ui.setStatus('WASD lopen · V guest · P disco · G geld · T dief');
	}

	private toggleDisco(): void {
		const on = this.disco.toggle();
		this.atmosphere.americans.setDancing(on);
		this.atmosphere.americans.ensureAudio();
		this.ui.setStatus(
			on
				? '🕺 HARDCORE MALL SET — 150BPM · boom-bam-bam-boom · mate ya'
				: 'Disco uit · sims shoppen weer',
		);
	}

	private giveMoney(): void {
		const got = this.atmosphere.americans.giveMoneyNear(this.camera.position, 25);
		if (!got) {
			this.ui.setStatus('Niemand dichtbij — loop dichter bij een sim');
			return;
		}
		this.score += 5;
		this.ui.setScore(this.score, this.metSims.size);
		// Tip also hits nearest store register if they have a target shop
		if (got.targetShopId) this.stock.flashSale(got.targetShopId);
		this.ui.setStatus(`💰 €25 naar ${got.name} · kassa knippert bij ${got.targetShop}`);
	}

	/** RCT-style: you control guest happiness as the mall viewer */
	private nudgeGuestMood(delta: number): void {
		this.atmosphere.americans.nudgeAllMood(delta);
		this.ui.setStatus(
			delta < 0
				? `😊 Guest mood UP (−${Math.abs(delta)} ongelukkig)`
				: `😭 Guest mood DOWN (+${delta} ongelukkig)`,
		);
	}

	private wireDjBooth(): void {
		this.djPlayer.onChange = (info) => {
			this.djUi.setNowPlaying(info.title, info.playing);
		};
		this.djUi.onRequest = (q) => void this.djRequest(q);
		this.djUi.onPlay = () => void this.djPlayer.play();
		this.djUi.onPause = () => this.djPlayer.pause();
		this.djUi.onNext = () => this.djPlayer.next();
		this.djUi.onProbe = () => {
			this.alienProbe.trigger();
			void this.bartekSpeak(BARTEK_LINES.probe);
			this.djUi.setStatus('👽 Aliens scannen de dikke Amerikanen…');
			this.ui.setStatus('👽 PROBE WAVE — dikke gasten in de beam');
			this.atmosphere.americans.cheerNear(this.djBartek.pos, 20);
		};
		this.djUi.onGreet = () => void this.bartekSpeak(BARTEK_LINES.greet);
		this.djUi.onRat = () => {
			this.rat.trigger();
			this.ui.setStatus('🐀 Mall-rat is los — kijk bij de loopbanden');
			void this.bartekSpeak('Die rat is VIP hier. Trap-gat mascotte!');
		};
		this.djUi.onMicStart = () => {
			spatial.ensure();
			this.atmosphere.americans.ensureAudio();
			this.bartekChat.startListening();
		};
		this.djUi.onMicEnd = () => this.bartekChat.stopListening();
		this.bartekChat.onUpdate = (lines, status) => {
			this.djUi.setChat(lines, status);
			if (lines.length) {
				const last = lines[lines.length - 1];
				if (last.who === 'bartek') this.djBartek.say(last.text, 5);
			}
		};
		this.djUi.onClose = () => {
			this.bartekChat.stopListening();
			this.player.enabled = this.freeMove && this.possessId === null;
		};
		// Play track by index from list click
		(
			document.getElementById('dj-overlay') as HTMLElement | null
		)?.addEventListener(
			'dj-play-index',
			((e: CustomEvent<number>) => {
				void this.djPlayer.playIndex(e.detail);
			}) as EventListener,
		);
	}

	/** E near a counter — Youssef / any named keeper speaks aloud */
	private async talkToShopkeeper(): Promise<void> {
		this.atmosphere.americans.ensureAudio();
		const owner = await this.shopVoice.talkNear(this.camera.position, 7);
		if (!owner) {
			this.ui.setStatus('Geen verkoper dichtbij — loop naar een OPEN winkel (E)');
			return;
		}
		this.ui.setStatus(`💬 ${owner.name} (${owner.title}): praat…`);
		this.score += 2;
		this.ui.setScore(this.score, this.metSims.size);
	}

	private async openDjBooth(): Promise<void> {
		this.player.releaseLook?.();
		this.player.enabled = false;
		this.djUi.show();
		const tracks = await this.djPlayer.refreshPlaylist();
		// Music crates only — skip short voice intros in the list UI if named
		this.djUi.setTracks(tracks.filter((t) => !/intro_voice|voice/i.test(t.file)));
		const st = await fetchDjStatus();
		this.djUi.setStatus(
			st.elevenlabs
				? `ElevenLabs ON · ${tracks.length} files · live drama mode`
				: `Browser-stem · ${tracks.length} files · zet ELEVENLABS_API_KEY`,
		);
		if (!this.djBartek.greetingDone) {
			this.djBartek.greetingDone = true;
			// Pre-baked intro first (instant), then full ElevenLabs greets
			this.djBartek.say(BARTEK_LINES.greet, 6);
			const baked = await playBoothFile('bartek_intro_voice.mp3');
			if (baked.source === 'silent' || (baked.durationMs ?? 0) < 500) {
				await this.bartekSpeak(BARTEK_LINES.greet);
			} else {
				this.djUi.setStatus('🎤 Bartek intro (ElevenLabs) — BARTEK BARTEK');
				// Full longer line after baked clip
				await this.bartekSpeak(
					'Welkom bij het trap-gat. Request een plaatje en ik draai hem live. Drama gratis erbij.',
				);
			}
			if (!st.elevenlabs) {
				await this.bartekSpeak(BARTEK_LINES.noKey);
			}
		} else {
			const line = BARTEK_LINES.idle[Math.floor(Math.random() * BARTEK_LINES.idle.length)];
			await this.bartekSpeak(line);
		}
		// Prefer real music; resume after HMR/reload if we had a track
		const music = tracks.filter((t) => !/intro_voice|voice/i.test(t.file));
		const resumed = await this.djPlayer.restoreIfNeeded();
		if (!resumed && music.length && !this.djPlayer.playing) {
			const idx = tracks.findIndex((t) => t.file === music[0].file);
			if (idx >= 0) void this.djPlayer.playIndex(idx);
		}
		// Crowd reacts to the booth opening
		this.atmosphere.americans.cheerNear(this.djBartek.pos, 14);
	}

	private async bartekSpeak(text: string): Promise<void> {
		if (this.bartekSpeaking) return;
		this.bartekSpeaking = true;
		this.atmosphere.americans.ensureAudio();
		spatial.ensure();
		this.djBartek.say(text, Math.min(8, 2.5 + text.length * 0.04));
		// Charlie voice — energetic DJ (not flat Adam)
		const r = await speakLine(text, {
			voiceId: 'IKne3meq5aSn9XLyUdCD',
			lang: 'nl',
			volume: 0.95,
			allowBrowser: false,
		});
		if (r.source === 'elevenlabs') {
			this.djUi.setStatus('🎤 Bartek (ElevenLabs) praat…');
			this.ui.setStatus(`🎤 DJ Bartek: ${text.slice(0, 60)}…`);
		} else {
			this.djUi.setStatus(`🎤 ElevenLabs faalde: ${r.error ?? 'silent'} — niet browser-TTS`);
			this.ui.setStatus(`🎤 TTS error: ${r.error ?? 'silent'}`);
		}
		const wait = Math.min(14000, r.durationMs ?? text.length * 55);
		await new Promise((res) => setTimeout(res, Math.max(800, wait * 0.85)));
		this.bartekSpeaking = false;
	}

	/** Ambient mall drama: Bartek monologues + crowd squeaks */
	private tickBartekDrama(dt: number): void {
		this.crowdCheerCd -= dt;
		const near = this.djBartek.inRange(this.camera.position);
		const music = this.djPlayer.playing;

		// When music is on, crowd near the trap occasionally cheers
		if (music && this.crowdCheerCd <= 0) {
			this.crowdCheerCd = 9 + Math.random() * 12;
			this.atmosphere.americans.cheerNear(this.djBartek.pos, 16);
		}

		// Bartek ambient drama (even if booth UI closed) when player is in the wing
		const dx = this.camera.position.x - this.djBartek.pos.x;
		const dz = this.camera.position.z - this.djBartek.pos.z;
		const dist = Math.hypot(dx, dz);
		if (
			dist < 18
			&& this.camera.position.y < 4
			&& this.djBartek.dramaCd <= 0
			&& !this.bartekSpeaking
			&& !this.djUi.isOpen()
		) {
			this.djBartek.dramaCd = 18 + Math.random() * 22;
			const line = BARTEK_LINES.drama[Math.floor(Math.random() * BARTEK_LINES.drama.length)];
			void this.bartekSpeak(line);
		}

		// First approach without opening booth: short teaser shout
		if (near && !this.nearDjHint && !this.djUi.isOpen() && !this.bartekSpeaking) {
			// nearDjHint set later in HUD loop — teaser once via dramaCd
		}
	}

	private async djRequest(query: string): Promise<void> {
		await this.bartekSpeak(
			`Request binnen: ${query}. Bartek downloadt met yt-dlp. Even geduld jongen.`,
		);
		const res = await this.djPlayer.requestSong(query);
		const tracks = await this.djPlayer.refreshPlaylist();
		this.djUi.setTracks(tracks.filter((t) => !/intro_voice|voice/i.test(t.file)));
		if (res.ok) {
			await this.bartekSpeak(BARTEK_LINES.requestOk(query));
			this.djUi.setStatus(res.message);
			this.score += 3;
			this.ui.setScore(this.score, this.metSims.size);
			this.atmosphere.americans.cheerNear(this.djBartek.pos, 18);
			// Brief dance flash for the crowd
			this.atmosphere.americans.setDancing(true);
			window.setTimeout(() => this.atmosphere.americans.setDancing(false), 12000);
		} else {
			await this.bartekSpeak(BARTEK_LINES.requestFail);
			this.djUi.setStatus(res.message);
		}
	}

	private onSelectStore(store: StoreDef): void {
		this.currentStore = store;
		const y = store.floor * 6 + 1.5;
		const pos = new THREE.Vector3(store.x, y, store.z);
		this.director.focusStore(pos);

		const path = this.pathfinder.findPath('kiosk', store.nodeId);
		this.currentPath = path;
		this.pathMesh.setPath(path);

		const dist = this.pathfinder.pathLength(path);
		const steps = this.buildStepLabels(path, store);
		const floors = this.floorLabel(store);
		this.ui.showSteps(steps, dist, floors);
		this.ui.setStatus(`Geselecteerd · ${store.name.replace('\n', ' ')}`);
	}

	private onStartRoute(store: StoreDef): void {
		this.exitPossess();
		this.currentStore = store;
		this.ui.hideArrive();
		this.clearConfetti();
		// Cinematic walk — get the settings card out of the shot
		this.settingsUi.toggle(false);

		const path = this.pathfinder.findPath('kiosk', store.nodeId);
		if (path.length < 2) {
			this.ui.setStatus('Geen route gevonden');
			return;
		}

		this.currentPath = path;
		this.pathMesh.setPath(path);

		const dist = this.pathfinder.pathLength(path);
		const steps = this.buildStepLabels(path, store);
		this.ui.showSteps(steps, dist, this.floorLabel(store));
		this.ui.showTouring(store);

		this.score += 10;
		this.ui.setScore(this.score, this.metSims.size);
		// Cinematic auto-walk — disable free move during tour
		this.freeMove = false;
		this.player.enabled = false;
		this.director.tourPath(path, () => this.onArrive(store));
	}

	private floorLabel(store: StoreDef): string {
		if (store.nodeId === 'spaceship') {
			return 'Loopband · roltrap · level 1 · aankomst';
		}
		return store.floor === 0 ? 'Begane grond · loopband' : 'Via roltrap · verdieping 1';
	}

	private onArrive(store: StoreDef): void {
		const underShip = store.nodeId === 'spaceship' || store.id === 'kruidvat';
		this.score += underShip ? 100 : 50;
		this.ui.setScore(this.score, this.metSims.size);
		// Back to free walk, facing whatever you came for
		this.freeMove = true;
		this.player.enabled = true;
		this.player.syncFromCamera();

		if (underShip) {
			const stand = this.spaceship.getUnderStandPoint();
			this.ui.showArrive(store);
			this.spawnConfetti(stand.clone().add(new THREE.Vector3(0, 1.5, 0)));
			this.player.lookAtPoint(this.spaceship.getShipLookPoint());
			this.ui.setStatus(`+100 · Kruidvat · Youssef praat · score ${this.score}`);
			// Youssef finally speaks when the route lands
			this.atmosphere.americans.ensureAudio();
			void this.shopVoice.speak(
				'kruidvat',
				'Marhaba! Je bent er. Welkom bij Kruidvat — ik ben Youssef Benali. Vitamines? Shampoo voor mama? Yallah, de kassa is open.',
				{ force: true, minGapMs: 0 },
			);
		} else {
			this.ui.showArrive(store);
			this.spawnConfetti(new THREE.Vector3(store.x, store.floor * 6 + 2, store.z));
			this.player.lookAtPoint(
				new THREE.Vector3(store.x, store.floor * 6 + 1.5, store.z),
			);
			this.ui.setStatus(`+50 · ${store.name.replace('\n', ' ')} OPEN · score ${this.score}`);
			// Any named owner greets on arrival
			void this.shopVoice.speak(store.id, undefined, { force: true, minGapMs: 0 });
		}
	}

	private onCancel(): void {
		this.exitPossess();
		this.pathMesh.clear();
		this.currentPath = [];
		this.currentStore = null;
		this.clearConfetti();
		this.ui.clearSelection();
		this.ui.hideArrive();
		this.director.stopTour();
		this.freeMove = false;
		this.player.enabled = false;
		this.director.goHome(true, () => {
			this.ui.setStatus('WASD lopen · V = guest view');
			this.freeMove = true;
			this.player.enabled = true;
			this.player.syncFromCamera();
		});
	}

	private buildStepLabels(path: GraphNode[], store: StoreDef): string[] {
		const steps: string[] = ['Start bij de kiosk'];
		const ids = path.map((n) => n.id);

		if (ids.includes('e0') && ids.includes('e1')) {
			steps.push('Neem de loopband richting de roltrap');
			steps.push('Roltrap omhoog naar verdieping 1');
		} else {
			steps.push('Volg de gele lijn / loopband');
		}

		if (ids.includes('s_rituals')) {
			steps.push('Je komt langs Rituals (voor je moeder)');
		}

		if (store.nodeId === 'spaceship' || ids.includes('spaceship')) {
			steps.push('Kruidvat is aan je rechterhand');
			steps.push('Einde van de route bij de winkel');
		} else {
			steps.push(`Aankomst: ${store.name.replace('\n', ' ')}`);
		}
		return steps.slice(0, 6);
	}

	private spawnConfetti(origin: THREE.Vector3): void {
		this.clearConfetti();
		const count = 100;
		const positions = new Float32Array(count * 3);
		const colors = new Float32Array(count * 3);
		this.confettiVel = new Float32Array(count * 3);
		const palette = [
			new THREE.Color(0x00a651),
			new THREE.Color(0xe30613),
			new THREE.Color(0xf5c518),
			new THREE.Color(0xffffff),
		];

		for (let i = 0; i < count; i++) {
			positions[i * 3] = origin.x;
			positions[i * 3 + 1] = origin.y;
			positions[i * 3 + 2] = origin.z;
			const c = palette[i % palette.length];
			colors[i * 3] = c.r;
			colors[i * 3 + 1] = c.g;
			colors[i * 3 + 2] = c.b;
			this.confettiVel[i * 3] = (Math.random() - 0.5) * 4;
			this.confettiVel[i * 3 + 1] = Math.random() * 3 + 1;
			this.confettiVel[i * 3 + 2] = (Math.random() - 0.5) * 4;
		}

		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		const mat = new THREE.PointsMaterial({
			size: 0.12,
			vertexColors: true,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
		});
		this.confetti = new THREE.Points(geo, mat);
		this.scene.add(this.confetti);
		setTimeout(() => this.clearConfetti(), 3500);
	}

	private clearConfetti(): void {
		if (this.confetti) {
			this.scene.remove(this.confetti);
			this.confetti.geometry.dispose();
			(this.confetti.material as THREE.Material).dispose();
			this.confetti = null;
			this.confettiVel = null;
		}
	}

	private updateConfetti(dt: number): void {
		if (!this.confetti || !this.confettiVel) return;
		const pos = this.confetti.geometry.attributes.position as THREE.BufferAttribute;
		const arr = pos.array as Float32Array;
		for (let i = 0; i < arr.length; i += 3) {
			arr[i] += this.confettiVel[i] * dt;
			arr[i + 1] += this.confettiVel[i + 1] * dt;
			arr[i + 2] += this.confettiVel[i + 2] * dt;
			this.confettiVel[i + 1] -= 9 * dt;
		}
		pos.needsUpdate = true;
	}

	private onResize(): void {
		const w = window.innerWidth;
		const h = window.innerHeight;
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(w, h);
		this.composer.setSize(w, h);
	}

	/**
	 * Walls are the controller's job now; this only stops you standing inside Brad.
	 * `climb` keeps the escalator/stairs volumes walkable.
	 */
	private pushPlayerFromSims(minDist: number): void {
		const cam = this.camera.position;
		const playerFloor = cam.y < 4 ? 0 : 6;
		const group = this.atmosphere.americans.group;
		for (const child of group.children) {
			if (!(child instanceof THREE.Object3D)) continue;
			const sy = child.position.y;
			if (Math.abs(sy - playerFloor) > 2.5) continue;
			const sep = this.world.separate(
				cam.x,
				cam.z,
				child.position.x,
				child.position.z,
				minDist,
			);
			cam.x = sep.ax;
			cam.z = sep.az;
		}
		const r = this.world.resolveCircle(cam.x, cam.z, cam.y, PLAYER_RADIUS, 3, true);
		cam.x = r.x;
		cam.z = r.z;
	}

	private animate = (): void => {
		requestAnimationFrame(this.animate);
		const dt = Math.min(this.clock.getDelta(), 0.05);

		this.atmosphere.update(dt);
		this.pathMesh.update(dt);
		this.thief.update(dt);
		this.rat.update(dt);
		// Quadratic spatial listener follows camera
		spatial.updateListener(
			this.camera.position.x,
			this.camera.position.y,
			this.camera.position.z,
		);
		this.prayer.update(dt, this.camera.position);

		if (this.possessId !== null) {
			const eye = this.atmosphere.americans.getSimEye(this.possessId);
			if (eye) {
				// Stick to eye sockets — hard follow, not float behind the butt
				this.camera.position.copy(eye.pos);
				this.camera.rotation.order = 'YXZ';
				// Shortest-path yaw lerp so we never spin through the floor
				let dy = eye.yaw - this.camera.rotation.y;
				while (dy > Math.PI) dy -= Math.PI * 2;
				while (dy < -Math.PI) dy += Math.PI * 2;
				this.camera.rotation.y += dy * Math.min(1, dt * 10);
				this.camera.rotation.x = THREE.MathUtils.lerp(this.camera.rotation.x, -0.05, 0.15);
				this.camera.rotation.z = 0;
			}
		} else if (this.freeMove && this.player.enabled) {
			this.player.update(dt);
			// Soft separate from nearby sims so you don't stand inside Brad
			this.pushPlayerFromSims(0.9);
		} else {
			// Cinematic: the tour walks the authored path, collision must not shove it
			this.director.update(dt);
		}

		this.updateConfetti(dt);
		this.palms.update(this.clock.elapsedTime);
		this.walkways.update(dt);
		this.amenities.update(dt, this.clock.elapsedTime);
		this.disco.update(dt);
		this.spaceship.update(this.clock.elapsedTime);
		this.djBartek.update(this.clock.elapsedTime, dt, this.djPlayer.playing);
		this.alienProbe.update(dt);

		// Feed the monkey its victim list, then let it aim
		this.simPositions.length = 0;
		for (const child of this.atmosphere.americans.group.children) {
			this.simPositions.push(child.position as THREE.Vector3);
		}
		this.monkey.setSimPositions(this.simPositions);
		this.monkey.update(dt);
		this.shopVoice.update(dt);
		this.tickBartekDrama(dt);
		// Auto-greet Youssef when you walk into Kruidvat
		void this.shopVoice.greetIfNear('kruidvat', this.camera.position, 6.5);
		const dYoussef = this.shopVoice.distanceTo('kruidvat', this.camera.position);
		if (dYoussef < 7 && this.camera.position.y > 4 && !this.youssefHint) {
			this.youssefHint = true;
			this.ui.setStatus('💊 Youssef Benali (Kruidvat) · druk E om te praten');
		} else if (dYoussef > 10) {
			this.youssefHint = false;
		}

		// Meet sims nearby = score (viral "I know Brad" energy)
		this.nearHudT += dt;
		if (this.nearHudT > 0.35) {
			this.nearHudT = 0;
			const near = this.atmosphere.americans.getSimsNear(this.camera.position, 5.5);
			let gained = false;
			for (const sim of near) {
				if (!this.metSims.has(sim.id)) {
					this.metSims.add(sim.id);
					this.score += 5;
					gained = true;
				}
			}
			if (gained) this.ui.setScore(this.score, this.metSims.size);
			if (near.length > 0) {
				const top = near[0];
				const heart = top.partnerName ? ` ❤️ ${top.partnerName.split(' ')[0]}` : '';
				const why = top.lifeLine ? ` · ${top.lifeLine}` : '';
				this.ui.setNearbySim(
					`${top.name}${heart} → ${top.targetShop} · €${top.moneySpent} · ☹ ${Math.round(top.unhappiness)}%${why}`,
				);
			} else {
				this.ui.setNearbySim(null);
			}

			// DJ Bartek proximity hint
			const atDj = this.djBartek.inRange(this.camera.position);
			if (atDj && !this.nearDjHint && !this.djUi.isOpen()) {
				this.nearDjHint = true;
				this.ui.setStatus('🎧 DJ BARTEK · druk E · request plaatjes · Bartek Bartek');
			} else if (!atDj) {
				this.nearDjHint = false;
			}
		}

		const eul = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
		const floor: 0 | 1 = this.camera.position.y > 3.5 ? 1 : 0;
		const targetStore = this.currentStore;
		this.mapBlips.length = 0;
		for (const child of this.atmosphere.americans.group.children) {
			this.mapBlips.push({
				x: child.position.x,
				z: child.position.z,
				floor: child.position.y > 3.5 ? 1 : 0,
			});
		}
		this.ui.updateMap({
			x: this.camera.position.x,
			z: this.camera.position.z,
			yaw: eul.y,
			floor,
			path: this.currentPath.map((n) => ({ x: n.x, y: n.y, z: n.z })),
			blips: this.mapBlips,
			target: targetStore
				? {
					x: targetStore.x,
					z: targetStore.z,
					floor: targetStore.floor,
					name: targetStore.name.replace('\n', ' '),
				}
				: null,
		});

		this.composer.render(dt);
	};
}
