import type { EffectComposer } from 'postprocessing';
import * as THREE from 'three';
import { BartekChat } from '@/audio/BartekChat';
import { DJPlayer } from '@/audio/DJPlayer';
import { fetchDjStatus, playBoothFile, speakLine } from '@/audio/ElevenVoice';
import { spatial } from '@/audio/SpatialAudio';
import { Director } from '@/camera/Director';
import type { GraphNode } from '@/data/graph';
import { type LevelId, level, levelAt, levelY } from '@/data/levels';
import { getKruidvat, getStore, type StoreDef, shopStores } from '@/data/stores';
import { Pathfinder } from '@/path/Pathfinder';
import { PathMesh } from '@/path/PathMesh';
import { CollisionWorld } from '@/physics/Collision';
import { PlayerControls } from '@/player/Controls';
import { createComposer } from '@/post/Composer';
import { LIGHT_POOL_SLOTS, LightPool } from '@/render/LightPool';
import { SceneBatcher } from '@/render/SceneBatcher';
import { AlienProbe } from '@/scene/AlienProbe';
import { Amenities } from '@/scene/Amenities';
import type { PersonRow } from '@/scene/Americans';
import { Atmosphere } from '@/scene/Atmosphere';
import { BeardCave } from '@/scene/BeardCave';
import { Catwalk } from '@/scene/Catwalk';
import { CleaningCart } from '@/scene/CleaningCart';
import { CityBirds } from '@/scene/city/CityBirds';
import { CityBuildings } from '@/scene/city/CityBuildings';
import { CityGarage } from '@/scene/city/CityGarage';
import { CityPark } from '@/scene/city/CityPark';
import { CityRoads } from '@/scene/city/CityRoads';
import { CitySky } from '@/scene/city/CitySky';
import { CityTheatre } from '@/scene/city/CityTheatre';
import { CityTraffic } from '@/scene/city/CityTraffic';
import { DiscoParty } from '@/scene/Disco';
import { BARTEK_LINES, DJBartek } from '@/scene/DJBartek';
import { DriveableCars } from '@/scene/DriveableCars';
import { Drone } from '@/scene/Drone';
import { FoodCourt } from '@/scene/FoodCourt';
import { GlassElevator } from '@/scene/GlassElevator';
import { Helicopter } from '@/scene/Helicopter';
import { Helipad } from '@/scene/Helipad';
import { setupLighting } from '@/scene/Lighting';
import { MallBuilder } from '@/scene/MallBuilder';
import { MallRat } from '@/scene/MallRat';
import { Monkey } from '@/scene/Monkey';
import { PalmForest } from '@/scene/Palms';
import { ParkingGarage } from '@/scene/ParkingGarage';
import { Penguins } from '@/scene/Penguins';
import { PoolPeople } from '@/scene/PoolPeople';
import { PrayerRoom } from '@/scene/PrayerRoom';
import { ProtestGroupies } from '@/scene/ProtestGroupies';
import { Restrooms } from '@/scene/Restrooms';
import { RoofIsland } from '@/scene/RoofIsland';
import { ScrubberBuggy } from '@/scene/ScrubberBuggy';
import { SecurityGuards } from '@/scene/SecurityGuards';
import { ShopVoice } from '@/scene/ShopVoice';
import { Spaceship } from '@/scene/Spaceship';
import { StockDisplay } from '@/scene/StockDisplay';
import { BakerThief } from '@/scene/Thief';
import { TravelAgency } from '@/scene/TravelAgency';
import { MovingWalkways } from '@/scene/Walkways';
import { DJOverlay } from '@/ui/DJOverlay';
import { DJWidget } from '@/ui/DJWidget';
import { ElevatorPanel } from '@/ui/ElevatorPanel';
import { KioskOverlay, type MapBlip } from '@/ui/KioskOverlay';
import { type CastRow, PeopleDashboard } from '@/ui/PeopleDashboard';
import { PerfOverlay } from '@/ui/PerfOverlay';
import { SettingsPanel } from '@/ui/SettingsPanel';
import { setLabelAnisotropy } from '@/util/label';
import { at, pick } from '@/util/rand';
import { cullByLevel } from '@/util/visibility';
import { loadGame, pathToPersist, saveGame } from './GamePersist';

const PLAYER_RADIUS = 0.4;
const PERSIST_EVERY = 0.75; // seconds
/** Praatafstand tot een verkoper — E praat én de E-melding luistert hiernaar. */
const TALK_RADIUS = 7;
/**
 * Dynamische resolutie: vaste treden i.p.v. een glijdende schaal, want elke
 * wissel laat composer.setSize twee HalfFloat-fullscreentargets heralloceren.
 * Onder 0.5 wordt het beeld te papperig om nog wat te winnen.
 */
const DYN_RES_STEPS = [1, 0.85, 0.75, 0.65];
/** Boven dit gemiddelde (ms/frame) zakt de schaal een trede (≈ onder 42 fps). */
const DYN_RES_SLOW_MS = 24;
/**
 * Omhoog mag pas als het gemiddelde onder gemeten-vsync × deze factor ligt. Een
 * absolute drempel (15 ms) lag onder het 60Hz-interval van 16,7 ms, waardoor een
 * kerngezond vsync-locked frame nooit als "ruim comfort" telde en de schaal na
 * één dip voorgoed laag bleef.
 */
const DYN_RES_UP_FACTOR = 1.12;
/**
 * Eén sample boven deze grens is een tabwissel of laad-hik, geen frame. Kappen
 * i.p.v. weggooien: een machine die echt 3 fps haalt (333 ms) zou anders nooit
 * een sample leveren en de regelaar zou juist dáár bevriezen.
 */
const FRAME_MS_SPIKE = 250;

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
	/** DE STAD — 8 modules buiten de muren + tropisch dakeiland met badgasten */
	private cityBuildings = new CityBuildings();
	private cityRoads = new CityRoads();
	private cityTraffic = new CityTraffic(() => this.cityRoads.lightPhase);
	private cityPark = new CityPark();
	private cityTheatre = new CityTheatre();
	private cityGarage = new CityGarage();
	private citySky = new CitySky();
	private cityBirds = new CityBirds();
	private roofIsland = new RoofIsland();
	private poolPeople = new PoolPeople();
	private amenities = new Amenities();
	/**
	 * Elke feature hieronder huurt zijn puntlichten bij de pool en wordt daarom
	 * in de constructor gebouwd, ná de pool — een veldinitialisator draait vóór
	 * de constructorbody en zou de pool nog niet hebben.
	 */
	private pool: LightPool;
	private disco: DiscoParty;
	private stock: StockDisplay;
	private spaceship: Spaceship;
	private thief: BakerThief;
	private beardCave: BeardCave;
	private protest!: ProtestGroupies;
	private travel: TravelAgency;
	private rat!: MallRat;
	private cleaner!: CleaningCart;
	private prayer: PrayerRoom;
	private penguins!: Penguins;
	private restrooms: Restrooms;
	private helipad: Helipad;
	private foodCourt: FoodCourt;
	private elevator: GlassElevator;
	private parking: ParkingGarage;
	private security!: SecurityGuards;
	private nearElevHint = false;
	private nearSecurityHint = false;
	private securityHitCd = 0;
	/** Reused for binaural listener orientation */
	private _fwd = new THREE.Vector3();
	private _up = new THREE.Vector3();
	/** Latched until you walk out of the cabin XZ */
	private elevRiding = false;
	private elevUi!: ElevatorPanel;
	private bartekChat = new BartekChat();
	private djBartek: DJBartek;
	private alienProbe: AlienProbe;
	private monkey!: Monkey;
	private catwalk = new Catwalk();
	private heli!: Helicopter;
	private drone = new Drone();
	private scrubber!: ScrubberBuggy;
	private driveCars!: DriveableCars;
	private nearDroneHint = false;
	private nearScrubberHint = false;
	private nearCarHint = false;
	/** Glijbaan-rit: 0..1 langs de curve, -1 = niet aan het glijden */
	private slideT = -1;
	/** FPS-chip + het uitklapbare prestatiepaneel */
	private perfHud!: PerfOverlay;
	/** Hergebruikt: getDrawingBufferSize schrijft in een doelvector, elk frame. */
	private readonly bufferSize = new THREE.Vector2();
	/**
	 * Pixelratio heeft één eigenaar: kwaliteitstier × dynamische schaal, samen
	 * toegepast in applyPixelRatio(). Eerder schreef de kwaliteits-handler de
	 * ratio rechtstreeks; een tweede schrijver zou daar stil mee vechten.
	 */
	/** De echte waarde komt uit bindQuality, dat synchroon in de constructor vuurt. */
	private qualityRatio = 1;
	private dynScale = 1;
	private dynResOn = true;
	private dynResIndex = 0;
	/** EMA van de ongeklemde frametijd; 0 = nog geen meting (net gereset). */
	private frameMsEma = 0;
	private dynResHold = 0;
	/** -1 = wil omhoog, 1 = wil omlaag, 0 = tevreden; richtingwissel reset de teller. */
	private dynResDir = 0;
	private dynResCooldown = 0;
	/** Kleinste geziene frame-interval ≈ de vsync-periode van dit scherm. */
	private vsyncMs = 50;
	private lastRafTs: number | null = null;
	/** Welk voertuig je bestuurt */
	private vehicle: 'drone' | 'heli' | 'scrubber' | 'car' | null = null;
	/** reused each frame for the monkey's target list */
	private simPositions: THREE.Vector3[] = [];
	private djPlayer = new DJPlayer();
	private shopVoice = new ShopVoice();
	private djUi!: DJOverlay;
	private youssefHint = false;
	private settingsUi!: SettingsPanel;
	private peopleUi!: PeopleDashboard;
	private peopleT = 0;
	private peopleRows: PersonRow[] = [];
	private player!: PlayerControls;
	private ui: KioskOverlay;
	/** Replaces deprecated THREE.Clock — call update() once per frame */
	private timer = new THREE.Timer();
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
	private nearProtestHint = false;
	private nearTravelHint = false;
	private nearPrayerHint = false;
	private bartekSpeaking = false;
	private crowdCheerCd = 0;
	private persistT = 0;
	private restoredFromSave = false;
	private sceneBatcher!: SceneBatcher;
	private readonly perfProbe = new URLSearchParams(window.location.search).has('perf-probe');
	/** Resolves once the shaders are linked and the frame loop is running. */
	readonly ready: Promise<void>;

	constructor(canvasParent: HTMLElement, uiRoot: HTMLElement) {
		// Eerst de lichtpool, dan pas iets dat licht maakt: NUM_POINT_LIGHTS ligt
		// hiermee voor de hele sessie vast en geen enkele feature bouwt nog een
		// eigen PointLight. Zie src/render/LightPool.ts.
		this.pool = new LightPool(this.scene);
		const daylight = setupLighting(this.scene, this.pool);
		// The catwalk spot is the one real light outside Lighting.ts; the old
		// scene-traverse dimmer caught it implicitly, this list is explicit.
		daylight.register(this.catwalk.spot, 0.15);
		this.disco = new DiscoParty(this.pool, daylight);
		this.stock = new StockDisplay(this.pool);
		this.spaceship = new Spaceship(this.pool);
		this.beardCave = new BeardCave(this.pool);
		this.travel = new TravelAgency(this.pool);
		this.prayer = new PrayerRoom(this.pool);
		this.restrooms = new Restrooms(this.pool);
		this.helipad = new Helipad(this.pool);
		this.foodCourt = new FoodCourt(this.pool);
		this.elevator = new GlassElevator(this.pool);
		this.parking = new ParkingGarage(this.pool);
		this.djBartek = new DJBartek(this.pool);
		this.alienProbe = new AlienProbe(this.pool);

		this.atmosphere = new Atmosphere(this.world);
		this.thief = new BakerThief(this.world, this.beardCave);
		this.rat = new MallRat(this.world);
		this.cleaner = new CleaningCart(this.world);
		this.scrubber = new ScrubberBuggy(this.world, this.pool);
		this.driveCars = new DriveableCars(this.world);
		this.protest = new ProtestGroupies(this.world);
		this.security = new SecurityGuards(this.world, this.pool);
		this.penguins = new Penguins(this.world, 12);

		this.renderer = new THREE.WebGLRenderer({
			// De composer doet al AA — canvas-MSAA erbovenop is puur dubbel werk
			antialias: false,
			powerPreference: 'high-performance',
		});
		// Geen setPixelRatio hier: bindQuality vuurt verderop in deze constructor
		// synchroon met de opgeslagen tier en is via applyPixelRatio() de enige
		// eigenaar — een tweede schrijver was precies wat daar wegmoest.
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.NoToneMapping;
		// three.js validates every program the first time it is *rendered* by reading
		// getProgramInfoLog()/getShaderInfoLog()/LINK_STATUS back from the driver. Each
		// of those is a hard CPU-GPU sync that blocks the frame until the link is done,
		// and two Chrome traces put roughly two thirds of all CPU time inside them. The
		// error text is worth the stall while developing; it is not worth shipping.
		this.renderer.debug.checkShaderErrors = !!import.meta.hot;
		// Zonder dit reset three de telling bij elke renderer.render(), en de
		// composer doet er meerdere per frame — je leest dan alleen de laatste
		// pass. Eén reset per frame in de loop geeft het frame als geheel.
		this.renderer.info.autoReset = false;
		// Before anything builds a label: name plates and signs are read at a
		// slant almost always, and this is what keeps them legible there.
		setLabelAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
		canvasParent.appendChild(this.renderer.domElement);

		// Wider FOV feels more first-person / walking through a mall
		this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.15, 200);

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
		this.scene.add(this.beardCave.group);
		this.scene.add(this.protest.group);
		this.scene.add(this.travel.group);
		this.scene.add(this.rat.group);
		this.scene.add(this.cleaner.group);
		this.scene.add(this.scrubber.group);
		this.scene.add(this.driveCars.group);
		this.scene.add(this.security.group);
		this.scene.add(this.prayer.group);
		this.scene.add(this.penguins.group);
		this.scene.add(this.restrooms.group);
		this.scene.add(this.helipad.group);
		this.scene.add(this.foodCourt.group);
		this.scene.add(this.elevator.group);

		// ── DE STAD + het dakeiland ─────────────────────────
		this.scene.add(this.cityBuildings.group);
		this.scene.add(this.cityRoads.group);
		this.scene.add(this.cityTraffic.group);
		this.scene.add(this.cityPark.group);
		this.scene.add(this.cityTheatre.group);
		this.scene.add(this.cityGarage.group);
		this.scene.add(this.citySky.group);
		this.scene.add(this.cityBirds.group);
		this.scene.add(this.roofIsland.group);
		this.scene.add(this.poolPeople.group);
		// Loopbaar dek: eiland-roofpad registreren zodat jij (en de drone) erop kunnen
		this.world.roofPads.push(this.roofIsland.roofPad);
		this.scene.add(this.parking.group);
		// City outside the mall
		this.scene.add(this.citySky.group);
		this.scene.add(this.cityRoads.group);
		this.scene.add(this.cityTraffic.group);
		this.scene.add(this.cityBuildings.group);
		this.scene.add(this.cityPark.group);
		this.scene.add(this.cityGarage.group);
		this.scene.add(this.cityTheatre.group);
		this.scene.add(this.cityBirds.group);
		// WC + gebedsruimte + cave + travel desk walls
		for (const c of [
			...this.restrooms.getColliders(),
			...this.prayer.getColliders(),
			...this.beardCave.getColliders(),
			...this.travel.getColliders(),
		]) {
			this.world.addBox(c.minX, c.maxX, c.minZ, c.maxZ, {
				minY: -0.5,
				maxY: 3.2,
				label: c.label,
			});
		}
		// Elevator shaft: full height P1→dak; climbable so player enters, sims bounce
		for (const c of this.elevator.getColliders()) {
			this.world.addBox(c.minX, c.maxX, c.minZ, c.maxZ, {
				minY: c.minY ?? -7.5,
				maxY: c.maxY ?? 16.5,
				label: c.label,
				climbable: c.climbable ?? false,
			});
		}
		this.scene.add(this.pathMesh.group);
		this.scene.add(this.djBartek.group);
		this.scene.add(this.alienProbe.group);
		this.alienProbe.bind(this.atmosphere.americans);
		// Sims ride the loopband too
		this.atmosphere.americans.setBeltProvider((x, y, z) => this.walkways.beltVelocityAt(x, y, z));

		// Luchtvloot: heli op het dak (cyclus), drone bij de fontein (instappen!)
		this.heli = new Helicopter(this.helipad.padCenter);
		this.scene.add(this.heli.group);
		this.scene.add(this.drone.group);

		// Fashion Week runway, floor 0 west (in front of Douglas)
		this.scene.add(this.catwalk.group);
		this.catwalk.setAnnounceCallback((name) => {
			this.ui.setStatus(`👗 CATWALK · ${name} komt op · Fashion Week Prairie Lakes`);
		});

		// Camera lives in the scene so the monkey can smear the lens
		this.scene.add(this.camera);
		this.monkey = new Monkey(this.world, this.camera);
		this.scene.add(this.monkey.group);
		this.monkey.setHitCallback((hit) => {
			if (hit.what === 'player') {
				this.score = Math.max(0, this.score - 8);
				this.ui.setScore(this.score, this.metSims.size);
				const yell = hit.yell ?? 'AU!!';
				this.ui.setStatus(`🐒💩 ${yell} — volle treffer in je gezicht (−8)`);
				this.spawnConfetti(new THREE.Vector3(hit.x, hit.y + 0.4, hit.z));
			} else if (hit.what === 'sim') {
				this.atmosphere.americans.nudgeAllMood(4);
				this.ui.setStatus('🐒💩 De aap raakte een shopper — publiek is niet blij');
			} else if (hit.what === 'prayer') {
				this.ui.setStatus('🐒💩 Aap gooit kak op de GEBEDSRUIMTE — je stond te ver weg');
			}
		});

		// Preserve every gameplay object, but submit compatible opaque meshes
		// through a small number of GPU batches.
		this.sceneBatcher = new SceneBatcher(this.scene);
		// De renderer draait scene.updateMatrixWorld() nog een keer bij elke
		// render — een tweede complete wandeling over ~7000 objecten, terwijl
		// sceneBatcher.update() die vlak ervoor al geforceerd heeft gedaan. Uit
		// dus: één matrixpas per frame in plaats van twee. Alles wat later aan
		// de scene wordt toegevoegd komt gewoon mee, want die ene pas forceert.
		this.scene.matrixWorldAutoUpdate = false;
		console.info('[Mall] render batching', this.sceneBatcher.stats);
		document.documentElement.dataset['batchSourceMeshes'] = String(this.sceneBatcher.stats.sourceMeshes);
		document.documentElement.dataset['batchDrawCalls'] = String(this.sceneBatcher.stats.drawCalls);

		// Hypersensitive mall cops — open fire → panic sims / graze player
		this.security.setOpenFireCallback((msg) => this.ui.setStatus(msg));
		this.security.setSimPanicCallback((origin, radius) => {
			const hit = this.atmosphere.americans.panicFromGunfire(origin, radius);
			if (hit.length > 0) {
				this.score = Math.max(0, this.score - Math.min(12, hit.length * 2));
				this.ui.setScore(this.score, this.metSims.size);
			}
		});
		this.security.setPlayerHitCallback((dmg, who) => {
			if (this.securityHitCd > 0) return;
			this.securityHitCd = 0.6;
			this.score = Math.max(0, this.score - dmg);
			this.ui.setScore(this.score, this.metSims.size);
			this.ui.setStatus(`🚔💥 ${who} schoot je — "I felt threatened" (−${dmg})`);
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
			const ownerHint = storeId === 'kruidvat' ? 'Youssef Benali' : (storeId ?? '?');
			this.ui.setStatus(`Kassa ${ownerHint} · checkout #${count} · muntjes → verkoper 💰`);
			// Every 5 checkouts → baard-dief (slow heist → cave)
			if (count > 0 && count % 5 === 0 && count !== this.thiefFiredAt) {
				this.thiefFiredAt = count;
				this.thief.trigger();
				this.ui.setStatus(`🧔 BAARD-DIEF pakt juwelen → Beard-man's Cave! (txn ${count})`);
				this.spawnConfetti(pos.clone().add(new THREE.Vector3(0, 2, 0)));
			}
		});
		this.thief.setLootCallback((pos) => {
			this.spawnConfetti(pos.clone().add(new THREE.Vector3(0, 1.5, 0)));
			this.score = Math.max(0, this.score - 15);
			this.ui.setScore(this.score, this.metSims.size);
		});
		this.thief.setHomeCallback((pos) => {
			this.beardCave.pulseLoot();
			this.spawnConfetti(pos.clone().add(new THREE.Vector3(0, 1.2, 0)));
			this.spawnConfetti(this.beardCave.lootCenter.clone().add(new THREE.Vector3(0, 0.8, 0)));
			this.ui.setStatus('💀 BAARD-DIEF dumpte de juwelen in de cave · goud glimt');
		});

		this.ui = new KioskOverlay(uiRoot, {
			onSelectStore: (s) => this.onSelectStore(s),
			onStartRoute: (s) => this.onStartRoute(s),
			onCancel: () => this.onCancel(),
			onHome: () => this.onHome(),
			onReplay: () => {
				const store = this.currentStore ?? getKruidvat();
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

		// NA KioskOverlay: die mount met `root.innerHTML = …` en veegt alles weg
		// wat eerder aan uiRoot hing. En ná wireDjBooth, zodat de widget de
		// onChange-keten van de booth netjes doorgeeft i.p.v. overschreven wordt.
		this.peopleUi = new PeopleDashboard(uiRoot, (id) => this.enterPossess(id));
		new DJWidget(uiRoot, this.djPlayer, () => this.djUi.show());

		// FPS-chip + prestatiepaneel (I): frametijdverdeling, niet alleen een gemiddelde
		this.perfHud = new PerfOverlay(uiRoot);

		// Wei Chen yells Chinese (pre-baked ElevenLabs) when you block his cart
		this.cleaner.setYellCallback((label) => {
			this.ui.setStatus(`🧹 WEI CHEN · ${label}`);
		});
		// Liftman Hans announces floors (TTS when ElevenLabs has credits)
		this.elevator.setLineCallback((text) => {
			this.ui.setStatus(`🛗 HANS · ${text}`);
		});
		// Floor picker (only after E on Hans/knoppen — frees mouse then)
		this.elevUi = new ElevatorPanel(uiRoot, (id) => {
			const ok = this.elevator.requestFloor(id);
			if (ok) {
				this.elevUi.hide();
				this.elevator.holdForPassenger(false);
				this.ui.setStatus(`🛗 Hans rijdt naar ${level(id).name.toLowerCase()}`);
			} else {
				this.ui.setStatus('🛗 Hans: je bent er al — kies een andere');
			}
		});

		// Control scheme menu (⚙ / O) — mouse, no-mouse or tank steering
		this.settingsUi = new SettingsPanel(uiRoot, (s) => {
			this.player.applySettings(s);
			this.ui.setStatus(
				s.mouseLook
					? `Besturing: muis kijken${s.lookButton === 2 ? ' (rechtsklik)' : ''}${s.turnWithKeys ? ' + A/D draaien' : ''}`
					: 'Besturing: geen muis · A/D draaien · R/F kijken',
			);
		});

		// Grafische kwaliteit (⚙): DPR + schaduwen — NA de aanmaak van settingsUi;
		// deze bind stond eerst vóór de constructie en sloopte de hele UI-mount.
		this.settingsUi.bindQuality((q) => {
			const dpr = window.devicePixelRatio;
			if (q === 'laag') {
				this.qualityRatio = 1;
				this.renderer.shadowMap.enabled = false;
			} else if (q === 'middel') {
				this.qualityRatio = Math.min(dpr, 1.25);
				this.renderer.shadowMap.enabled = true;
			} else {
				this.qualityRatio = Math.min(dpr, 1.75);
				this.renderer.shadowMap.enabled = true;
			}
			this.renderer.shadowMap.needsUpdate = true;
			// Een nieuwe tier is een nieuwe basislijn: de oude schaaltrap en meting
			// horen daar niet overheen te blijven hangen ('laag' op ×0.5 renderde
			// anders stiekem op de helft van laag).
			this.dynScale = 1;
			this.dynResIndex = 0;
			this.resetDynResMeting();
			this.applyPixelRatio();
		});
		// Dynamische resolutie (⚙): rendert tijdelijk op een lagere schaal wanneer
		// frames boven budget lopen; de canvas-CSS (100%) rekt het beeld weer op.
		this.settingsUi.bindDynRes((on) => {
			this.dynResOn = on;
			this.resetDynResMeting();
			if (!on && this.dynScale !== 1) {
				this.dynScale = 1;
				this.dynResIndex = 0;
				this.applyPixelRatio();
			}
		});
		// HRTF binaural on/off (koptelefoon)
		this.settingsUi.bindBinaural((on) => {
			spatial.setBinaural(on);
			this.ui.setStatus(
				on ? '🎧 Binaural HRTF AAN · draai je hoofd, geluid blijft in de wereld' : '🔊 Binaural UIT · equalpower stereo',
			);
		});

		window.addEventListener('resize', () => this.onResize());
		// Een tabwissel is één reusachtig rAF-interval dat geen frame is. De
		// timestamp-keten breekt hier, zodat dat gat nooit in de FPS-teller of
		// de dynamische-resolutieregelaar belandt — een groottedrempel kan een
		// tabwissel niet van een écht traag frame onderscheiden.
		document.addEventListener('visibilitychange', () => {
			this.lastRafTs = null;
		});
		window.addEventListener('keydown', (e) => {
			// DJ booth captures typing — don't steal keys
			if (this.djUi.isOpen() && e.key !== 'Escape' && e.key !== 'e' && e.key !== 'E') {
				return;
			}
			if (e.key === 'k' || e.key === 'K') {
				this.onStartRoute(getKruidvat());
			}
			if (e.key === 'Escape') {
				if (this.djUi.isOpen()) {
					this.djUi.hide();
					return;
				}
				if (this.elevUi?.isOpen) {
					this.elevUi.hide();
					return;
				}
				if (this.peopleUi.isOpen) {
					this.peopleUi.toggle(false);
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
					this.monkey.provoke() ? '🐒 De aap pakt een handvol kak… duiken!' : '🐒 De aap heeft even niks bij de hand',
				);
			}
			// E = lift Hans / knoppen · voertuigen · DJ · shopkeeper
			if (e.key === 'e' || e.key === 'E') {
				// Voertuigen eerst: uitstappen als je vliegt/rijdt
				if (this.player.flying || this.vehicle === 'scrubber' || this.vehicle === 'car') {
					this.exitVehicle();
				} else if (this.tryOpenElevatorMenu()) {
					// Hans floor picker — frees mouse without Esc
				} else if (!this.possessId && this.freeMove && this.driveCars.nearestCar(this.camera.position, 4.5)) {
					this.boardCar();
				} else if (
					!this.possessId &&
					this.freeMove &&
					this.scrubber.distanceTo(this.camera.position) < 3.5 &&
					levelAt(this.camera.position.y) === 'v0'
				) {
					this.boardScrubber();
				} else if (!this.possessId && this.freeMove && this.drone.distanceTo(this.camera.position) < 3.2) {
					this.boardDrone();
				} else if (!this.possessId && this.freeMove && this.heli.boardable && this.heli.distanceTo(this.camera.position) < 4.5) {
					this.boardHeli();
				} else if (
					this.slideT < 0 &&
					this.player.feetHeight > 17 &&
					Math.hypot(this.camera.position.x + 28.5, this.camera.position.z + 10) < 2.2
				) {
					// Bovenop de glijbaantoren: E = WHEEE
					this.startSlide();
				} else if (this.djBartek.inRange(this.camera.position)) {
					void this.openDjBooth();
				} else {
					void this.talkToShopkeeper();
				}
			}
			// B = bewoners-dashboard (shoppers + vaste cast)
			if (e.key === 'b' || e.key === 'B') {
				this.peopleUi.toggle();
				if (this.peopleUi.isOpen) {
					// Force immediate fill so you don't stare at empty for 0.5s
					this.atmosphere.americans.getPeopleSnapshot(this.camera.position, this.peopleRows);
					this.peopleUi.update(this.peopleRows, this.buildCastRows());
					this.ui.setStatus('📋 Bewoners-dashboard · B sluiten · 👁 = guest view');
				} else {
					this.ui.setStatus('Dashboard dicht');
				}
			}
		});

		// Unlock audio after first click/key
		const unlock = () => {
			this.atmosphere.americans.ensureAudio();
			spatial.ensure();
			// DJ booth → HRTF so the mix sits in world space
			this.djPlayer.enableBinauralBooth({
				x: this.djBartek.pos.x,
				y: 1.55,
				z: this.djBartek.pos.z,
			});
			this.prayer.ensureAudio();
			this.protest.ensureAudio();
			this.cleaner.ensureAudio();
			// Resume / start mall music after gesture
			void (async () => {
				const resumed = await this.djPlayer.restoreIfNeeded();
				if (!resumed && !this.djPlayer.playing) {
					const tracks = await this.djPlayer.refreshPlaylist();
					const music = tracks.filter((t) => !/intro_voice|voice/i.test(t.file));
					const first = (music.length ? music : tracks)[0];
					if (first) {
						const idx = this.djPlayer.tracks.findIndex((t) => t.file === first.file);
						await this.djPlayer.playIndex(idx >= 0 ? idx : 0);
					}
				}
				if (!this.restoredFromSave) {
					this.ui.setStatus('♪ Muziek AAN · DJ-booth + gebedsruimte Trapbar · koptelefoon = binaural');
				}
			})();
			window.removeEventListener('pointerdown', unlock);
			window.removeEventListener('keydown', unlock);
		};
		window.addEventListener('pointerdown', unlock);
		window.addEventListener('keydown', unlock);

		// Save on tab hide / unload so HMR hard-reloads keep state
		window.addEventListener('pagehide', () => this.persistNow());
		window.addEventListener('beforeunload', () => this.persistNow());
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') this.persistNow();
		});

		const saved = loadGame();
		if (saved?.freeMove) {
			// Skip intro cinematic — drop back where you were
			this.restoreGame(saved);
		} else {
			this.director.playIntro(() => {
				this.ui.hideBoot();
				this.ui.setStatus('Klik = muis vangen · WASD lopen · Shift rennen · M = kaart');
				this.ui.setScore(this.score, this.metSims.size);
				this.freeMove = true;
				this.player.enabled = true;
				this.player.syncFromCamera();
				this.persistNow();
			});
		}

		// Dev-only handle for poking at the sim from the console / smoke tests.
		// import.meta.hot is only set by the dev server's HMR graph and is
		// tree-shaken out of a build, so this never ships.
		if (import.meta.hot) {
			window.mallsim = this;
		}

		// Page Visibility: avoid huge dt spikes after tab switch
		this.timer.connect(document);
		this.ready = this.start();
	}

	/**
	 * Link the programs the opening view needs, then start the frame loop.
	 *
	 * three.js builds a material's program the first time that material is actually
	 * rendered, so without a warmup the driver links mid-frame, once per material,
	 * spread over the whole session — which is what turned walking round a corner
	 * into a stutter. compileAsync polls KHR_parallel_shader_compile rather than
	 * blocking on it, so the links run in parallel while the loader is still up.
	 *
	 * The wait is capped and every failure is swallowed: a driver that reports a
	 * program ready late may cost frames, but it must never strand the player on a
	 * spinner.
	 */
	private async start(): Promise<void> {
		const warmupBudgetMs = 8000;
		try {
			await this.warmup(performance.now() + warmupBudgetMs);
		} catch (error) {
			console.warn('[Mall] shader warmup failed, starting anyway', error);
		}
		this.animate();
	}

	/**
	 * Link the programs the mall needs, once, behind the loading screen.
	 *
	 * `NUM_POINT_LIGHTS` is substituted into the shader source and is part of the
	 * program cache key, so the number of point lights the renderer can see used
	 * to decide which program a material got — and the alien probe (one light, on
	 * a 40-90s timer) and the disco (thirteen) changed that number mid-session,
	 * relinking every material in the building. This used to compile a second
	 * time with the probe shown just to seed that variant.
	 *
	 * LightPool ended that: eight real point lights exist for the whole session
	 * and are never hidden, so there is exactly one program set and no variant
	 * left to pre-seed. One pass is the whole warmup.
	 *
	 * The budget bounds how long the loading screen can hold, and that is one
	 * promise to the player.
	 */
	private async warmup(deadline: number): Promise<void> {
		await this.compileUntil(deadline);
	}

	/** Compile the scene as it stands, giving up once `deadline` passes. */
	private async compileUntil(deadline: number): Promise<void> {
		let timer = 0;
		try {
			await Promise.race([
				this.renderer.compileAsync(this.scene, this.camera),
				new Promise<void>((resolve) => {
					timer = window.setTimeout(resolve, Math.max(0, deadline - performance.now()));
				}),
			]);
		} finally {
			window.clearTimeout(timer);
		}
	}

	/** Snapshot player + progress into sessionStorage */
	private persistNow(): void {
		if (!this.freeMove && !this.restoredFromSave) return;
		const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
		saveGame({
			x: this.camera.position.x,
			y: this.camera.position.y,
			z: this.camera.position.z,
			yaw: e.y,
			pitch: e.x,
			score: this.score,
			metSims: [...this.metSims],
			freeMove: this.freeMove,
			storeId: this.currentStore?.id ?? null,
			path: pathToPersist(this.currentPath),
			thiefFiredAt: this.thiefFiredAt,
			disco: this.disco.active === true,
		});
	}

	private restoreGame(saved: NonNullable<ReturnType<typeof loadGame>>): void {
		this.restoredFromSave = true;
		this.score = saved.score ?? 0;
		this.metSims = new Set(saved.metSims ?? []);
		this.thiefFiredAt = saved.thiefFiredAt ?? 0;
		this.freeMove = true;

		if (saved.storeId) {
			const store = getStore(saved.storeId);
			if (store) {
				this.currentStore = store;
				if (saved.path?.length) {
					this.currentPath = saved.path.map((p) => ({
						id: p.id ?? '',
						x: p.x,
						y: p.y,
						z: p.z,
					}));
					this.pathMesh.setPath(this.currentPath);
				}
			}
		}

		// Seat camera before player.sync so feet/yaw match
		this.camera.position.set(saved.x, saved.y, saved.z);
		this.camera.rotation.order = 'YXZ';
		this.camera.rotation.set(saved.pitch, saved.yaw, 0);

		this.ui.hideBoot();
		this.ui.setScore(this.score, this.metSims.size);
		this.ui.setStatus(`↻ Hervat · (${saved.x.toFixed(1)}, ${saved.y.toFixed(1)}, ${saved.z.toFixed(1)}) · ★ ${this.score}`);

		this.player.enabled = true;
		this.player.syncFromCamera();

		if (saved.disco) {
			// Toggle on if it was on (toggle flips from false → true)
			if (!this.disco.active) {
				this.disco.toggle();
				this.atmosphere.americans.setDancing(true);
			}
		}

		// Yellow route tape stays if we had a path; no need to re-enter touring mode
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
			level: this.player.level,
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

	/** The mall's fixed cast for the bewoners-dashboard. */
	private buildCastRows(): CastRow[] {
		const rows: CastRow[] = [];

		const stage = this.catwalk.nowOnStage;
		rows.push({
			icon: '👗',
			name: stage ? stage.name : 'Catwalk',
			doing: stage
				? stage.phase === 'pose'
					? this.catwalk.partyMode
						? 'poseert voor de fotografen'
						: 'poseert + Aperol-spray 🍹'
					: 'werkt de runway'
				: 'wacht op de volgende show',
			floor: 'V0 · west',
		});

		rows.push({
			icon: '🧔',
			name: 'Baard-dief',
			doing: this.thief.active ? 'JUWELEN HEIST — onderweg!' : 'ligt op de loer',
			floor: this.thief.active ? 'in de mall' : 'grot',
		});

		const monkeyFloor = level(levelAt(this.monkey.group.position.y)).code;
		rows.push({
			icon: '🐒',
			name: 'De aap',
			doing: 'zit in de atrium-palmen · J = uitdagen',
			floor: monkeyFloor,
		});

		rows.push({
			icon: '🎧',
			name: 'DJ Bartek',
			doing: this.djPlayer.playing ? 'draait — booth E = verzoekjes' : 'staat stil achter de decks',
			floor: 'trap-gat',
		});

		rows.push({
			icon: '🛸',
			name: 'UFO',
			doing: 'hangt boven de weide',
			floor: 'atrium',
		});

		rows.push({
			icon: '🚁',
			name: 'PRAIRIE 1',
			doing: this.heli.statusLine,
			floor: 'dak',
		});

		rows.push({
			icon: '🚕',
			name: 'Passagiersdrone',
			doing: this.drone.statusLine,
			floor: this.player.flying ? 'lucht' : 'V0',
		});

		rows.push({
			icon: '🧽',
			name: 'Schoonmaak buggy #88',
			doing: this.scrubber.statusLine,
			floor: 'V0 · bij fontein/noord',
		});

		rows.push({
			icon: '🚗',
			name: this.driveCars.activeName !== '—' ? this.driveCars.activeName : "Huurauto's (P1)",
			doing: this.driveCars.statusLine,
			floor: this.driveCars.ridden
				? levelAt(this.camera.position.y) === 'p1'
					? `${level('p1').code} garage`
					: 'stad'
				: 'P1 · west exit → ring',
		});

		rows.push({
			icon: '🐧',
			name: `Pinguïns (${this.penguins.count})`,
			doing: 'waddlen door de mall · noot noot',
			floor: 'V0 · atrium / food court',
		});

		for (const g of this.security.roster) {
			rows.push({
				icon: '🚔',
				name: g.name,
				doing: `${g.state} · ${g.kills}× "felt threatened"`,
				floor: g.floor,
			});
		}

		return rows;
	}

	/** E op het dak naast PRAIRIE 1: jij aan de stick. */
	private boardHeli(): void {
		this.player.releaseLook();
		this.vehicle = 'heli';
		this.player.flightProfile = 'heli';
		this.player.flying = true;
		// eerst in de cockpit gaan zitten, dán pas volgt de heli de camera
		const seat = this.heli.getSeatPosition();
		this.camera.position.copy(seat);
		this.heli.board();
		this.player.syncFromCamera();
		this.ui.setStatus('🚁 PRAIRIE 1 · Space = collective omhoog · Shift = dalen · WASD vliegen · E = uitstappen');
	}

	/** E naast de drone: instappen → fly-mode. */
	private boardDrone(): void {
		this.player.releaseLook();
		this.drone.board();
		this.vehicle = 'drone';
		this.player.flightProfile = 'drone';
		this.player.flying = true;
		// camera in het stoeltje
		this.camera.position.set(this.drone.parkPos.x, this.drone.parkPos.y + 1.1, this.drone.parkPos.z);
		this.player.syncFromCamera();
		this.ui.setStatus(
			'🛸 DRONE · Space = stijgen · Shift = dalen · WASD vliegen · door het atrium-gat de stad in · E = uitstappen',
		);
	}

	/** E naast de lege schoonmaak-buggy: instappen & racen. */
	private boardScrubber(): void {
		this.player.releaseLook();
		this.vehicle = 'scrubber';
		this.player.driving = true;
		this.player.flying = false;
		this.scrubber.board();
		const seat = this.scrubber.getSeatPosition();
		this.camera.position.copy(seat);
		this.player.setHeading(this.scrubber.heading);
		this.player.syncFromCamera();
		// syncFromCamera clears driving? no - only feet/yaw. re-set driving
		this.player.driving = true;
		this.player.setHeading(this.scrubber.heading);
		this.ui.setStatus('🧽 SCHOONMAAK BUGGY · WASD rijden · Shift = turbo · E = uitstappen · wet floor racing!');
	}

	/** E naast huurauto in P1 (of geparkeerd in de stad). */
	private boardCar(): void {
		const slot = this.driveCars.nearestCar(this.camera.position, 4.5);
		if (!slot || !this.driveCars.board(slot)) return;
		this.player.releaseLook();
		this.vehicle = 'car';
		this.player.driving = true;
		this.player.flying = false;
		const seat = this.driveCars.getSeatPosition();
		this.camera.position.copy(seat);
		this.player.setHeading(this.driveCars.heading);
		this.player.syncFromCamera();
		this.player.driving = true;
		this.player.setHeading(this.driveCars.heading);
		this.ui.setStatus(`🚗 ${this.driveCars.activeName} · WASD rijden · Shift = turbo · E = uit · west-exit → STAD`);
	}

	/** E bovenop de glijbaantoren: WHEEE — camera volgt de buis het zwembad in. */
	private startSlide(): void {
		this.slideT = 0;
		this.freeMove = false;
		this.player.enabled = false;
		this.player.releaseLook();
		this.ui.setStatus('🛝 WHEEEEE — glijmiddel werkt!');
	}

	/** Per frame tijdens de glij-rit. */
	private tickSlide(dt: number): void {
		if (this.slideT < 0) return;
		this.slideT = Math.min(1, this.slideT + dt / 1.7);
		// ease-in: hoe verder, hoe sneller (zwaartekracht + glijmiddel)
		const t = this.slideT * this.slideT * (3 - 2 * this.slideT);
		const p = this.roofIsland.slideCurve.getPointAt(t);
		const look = this.roofIsland.slideCurve.getPointAt(Math.min(1, t + 0.06));
		this.camera.position.set(p.x, p.y + 0.55, p.z);
		this.camera.up.set(0, 1, 0);
		this.camera.lookAt(look.x, look.y + 0.35, look.z);

		if (this.slideT >= 1) {
			this.slideT = -1;
			// PLONS in het diepe
			const end = this.roofIsland.slideCurve.getPointAt(1);
			this.spawnConfetti(new THREE.Vector3(end.x, end.y + 0.8, end.z));
			this.ui.setStatus('💦 PLONS! · klim de ladder op voor nog een rondje');
			this.freeMove = true;
			this.player.enabled = true;
			this.player.syncFromCamera();
		}
	}

	/** E tijdens de vlucht/rit: uitstappen. */
	private exitVehicle(): void {
		const wasHeli = this.vehicle === 'heli';
		const wasScrub = this.vehicle === 'scrubber';
		const wasCar = this.vehicle === 'car';
		this.vehicle = null;
		this.player.flying = false;
		this.player.driving = false;
		this.player.flightProfile = 'drone';
		const p = this.camera.position;

		if (wasCar) {
			const exit = this.driveCars.release();
			this.camera.position.set(exit.x, exit.y + 1.6, exit.z);
			this.player.syncFromCamera();
			this.ui.setStatus(
				`🚗 Uitgestapt · ${this.driveCars.activeName === '—' ? 'auto geparkeerd' : 'auto blijft hier'} · E om weer in te stappen`,
			);
			return;
		}

		if (wasScrub) {
			const exit = this.scrubber.release();
			const ground = this.world.groundHeightAt(exit.x, exit.z, 0.5, 2);
			this.camera.position.set(exit.x, ground + 1.6, exit.z);
			this.player.syncFromCamera();
			this.ui.setStatus('🧽 Uitgestapt — buggy blijft staan voor de volgende racer');
			return;
		}

		if (wasHeli) {
			// PRAIRIE 1 keert op de automaat terug naar het pad; jij valt eruit —
			// de zwaartekracht en groundHeightAt vangen je op
			this.heli.release();
			this.player.syncFromCamera();
			this.ui.setStatus('🚁 Uitgestapt — PRAIRIE 1 vliegt zelf terug naar het pad');
			return;
		}

		const ground =
			Math.abs(p.x) < 36.5 && Math.abs(p.z) < 24.5 ? this.world.groundHeightAt(p.x, p.z, Math.max(0, p.y - 0.55), 3) : 0;
		this.drone.parkAt(new THREE.Vector3(p.x, ground, p.z));
		// speler stapt er net naast uit
		p.x += 1.2;
		p.y = ground + 1.68;
		this.player.syncFromCamera();
		this.ui.setStatus('Uitgestapt — de drone wacht hier op je (E)');
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
		this.enterPossess(id);
	}

	/** Ride along inside a specific sim (V = nearest, dashboard = any). */
	private enterPossess(id: number): void {
		this.exitPossess();
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
		// Party aan = spuit dicht; party uit = Aperol over het publiek
		this.catwalk.partyMode = on;
		this.ui.setStatus(on ? '🕺 HARDCORE MALL SET — 150BPM · boom-bam-bam-boom · mate ya' : 'Disco uit · sims shoppen weer');
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
			delta < 0 ? `😊 Guest mood UP (−${Math.abs(delta)} ongelukkig)` : `😭 Guest mood DOWN (+${delta} ongelukkig)`,
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
			const last = lines[lines.length - 1];
			if (last?.who === 'bartek') this.djBartek.say(last.text, 5);
		};
		this.djUi.onClose = () => {
			this.bartekChat.stopListening();
			this.player.enabled = this.freeMove && this.possessId === null;
		};
		// Play track by index from list click
		// CustomEvent detail isn't in the DOM listener signature; narrow on arrival
		document.getElementById('dj-overlay')?.addEventListener('dj-play-index', (e) => {
			const idx = (e as CustomEvent<number>).detail;
			if (typeof idx === 'number') void this.djPlayer.playIndex(idx);
		});
	}

	/** E near a counter — Youssef / any named keeper speaks aloud */
	private async talkToShopkeeper(): Promise<void> {
		this.atmosphere.americans.ensureAudio();
		const owner = await this.shopVoice.talkNear(this.camera.position, TALK_RADIUS);
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
				await this.bartekSpeak('Welkom bij het trap-gat. Request een plaatje en ik draai hem live. Drama gratis erbij.');
			}
			if (!st.elevenlabs) {
				await this.bartekSpeak(BARTEK_LINES.noKey);
			}
		} else {
			await this.bartekSpeak(pick(BARTEK_LINES.idle));
		}
		// Prefer real music; resume after HMR/reload if we had a track
		const firstMusic = tracks.filter((t) => !/intro_voice|voice/i.test(t.file))[0];
		const resumed = await this.djPlayer.restoreIfNeeded();
		if (!resumed && firstMusic && !this.djPlayer.playing) {
			const idx = tracks.findIndex((t) => t.file === firstMusic.file);
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
			dist < 18 &&
			levelAt(this.camera.position.y) === 'v0' &&
			this.djBartek.dramaCd <= 0 &&
			!this.bartekSpeaking &&
			!this.djUi.isOpen()
		) {
			this.djBartek.dramaCd = 18 + Math.random() * 22;
			void this.bartekSpeak(pick(BARTEK_LINES.drama));
		}

		// First approach without opening booth: short teaser shout
		if (near && !this.nearDjHint && !this.djUi.isOpen() && !this.bartekSpeaking) {
			// nearDjHint set later in HUD loop — teaser once via dramaCd
		}
	}

	private async djRequest(query: string): Promise<void> {
		await this.bartekSpeak(`Request binnen: ${query}. Bartek downloadt met yt-dlp. Even geduld jongen.`);
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
		const pos = new THREE.Vector3(store.x, this.storeY(store), store.z);
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
		if (store.id === 'helipad') return 'Geheime trap · dak · helipad 🚁';
		if (store.id === 'secret_stairs') return 'Service trap V1 → dak';
		if (store.id === 'toilets') return 'Begane grond · west · ♂♀';
		if (store.id === 'prayer') return 'Begane grond · west · gebedsmuziek · Allahu Akbar';
		if (store.nodeId === 'spaceship') {
			return 'Loopband · roltrap · level 1 · aankomst';
		}
		if (store.level === 'roof') return 'Dak';
		return store.level === 'v0' ? 'Begane grond · loopband' : 'Via roltrap · verdieping 1';
	}

	/** Eye-height Y for camera focus / confetti */
	private storeY(store: StoreDef): number {
		return levelY(store.level) + 1.5;
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
			this.spawnConfetti(new THREE.Vector3(store.x, this.storeY(store) + 0.5, store.z));
			this.player.lookAtPoint(new THREE.Vector3(store.x, this.storeY(store), store.z));
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
		const palette = [new THREE.Color(0x00a651), new THREE.Color(0xe30613), new THREE.Color(0xf5c518), new THREE.Color(0xffffff)];

		for (let i = 0; i < count; i++) {
			positions[i * 3] = origin.x;
			positions[i * 3 + 1] = origin.y;
			positions[i * 3 + 2] = origin.z;
			const c = at(palette, i);
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
			const mat = this.confetti.material;
			if (Array.isArray(mat)) {
				for (const m of mat) m.dispose();
			} else mat.dispose();
			this.confetti = null;
			this.confettiVel = null;
		}
	}

	private updateConfetti(dt: number): void {
		if (!this.confetti || !this.confettiVel) return;
		const pos = this.confetti.geometry.getAttribute('position');
		const arr = pos.array as Float32Array;
		const vel = this.confettiVel;
		for (let i = 0; i + 2 < arr.length; i += 3) {
			arr[i] = (arr[i] ?? 0) + (vel[i] ?? 0) * dt;
			arr[i + 1] = (arr[i + 1] ?? 0) + (vel[i + 1] ?? 0) * dt;
			arr[i + 2] = (arr[i + 2] ?? 0) + (vel[i + 2] ?? 0) * dt;
			vel[i + 1] = (vel[i + 1] ?? 0) - 9 * dt;
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

	/** Eén schrijver voor de pixelratio; de composer volgt de drawing buffer. */
	private applyPixelRatio(): void {
		this.renderer.setPixelRatio(this.qualityRatio * this.dynScale);
		this.onResize();
	}

	/**
	 * Verlaag de renderschaal als frames aanhoudend boven budget lopen; verhoog
	 * hem pas na lang comfort. Asymmetrisch en met afkoeltijd, anders pendelt
	 * hij op de rand — en elke wissel kost een target-heralloc in de composer.
	 */
	private updateDynRes(frameMs: number): void {
		if (this.perfProbe || !this.dynResOn || frameMs <= 0) return;
		// Tijd loopt hier in échte seconden (gekapt op de spike-grens), niet in het
		// geklemde dt: bij 200ms-frames telde elke tik 0,05 s en duurde de
		// beloofde halve seconde reactietijd in werkelijkheid twee seconden.
		const sampleMs = Math.min(frameMs, FRAME_MS_SPIKE);
		const sampleSec = sampleMs / 1000;
		if (frameMs >= 4 && frameMs < this.vsyncMs) this.vsyncMs = frameMs;
		this.frameMsEma = this.frameMsEma === 0 ? sampleMs : this.frameMsEma * 0.9 + sampleMs * 0.1;
		if (this.dynResCooldown > 0) {
			this.dynResCooldown -= sampleSec;
			return;
		}
		const wantDown = this.frameMsEma > DYN_RES_SLOW_MS && this.dynResIndex < DYN_RES_STEPS.length - 1;
		const wantUp = this.frameMsEma < this.vsyncMs * DYN_RES_UP_FACTOR && this.dynResIndex > 0;
		const dir = wantDown ? 1 : wantUp ? -1 : 0;
		if (dir !== this.dynResDir) {
			this.dynResDir = dir;
			this.dynResHold = 0;
		}
		if (dir === 0) return;
		this.dynResHold += sampleSec;
		// Omlaag snel (0.5 s aanhoudend traag), omhoog traag (2 s ruim comfort)
		if (dir === 1 && this.dynResHold >= 0.5) this.stepDynRes(this.dynResIndex + 1);
		else if (dir === -1 && this.dynResHold >= 2) this.stepDynRes(this.dynResIndex - 1);
	}

	/** Verse meting: oude samples horen niet mee te tellen na een schaal- of standwissel. */
	private resetDynResMeting(): void {
		this.frameMsEma = 0;
		this.dynResHold = 0;
		this.dynResDir = 0;
		this.dynResCooldown = 0;
	}

	private stepDynRes(index: number): void {
		this.dynResIndex = index;
		this.dynScale = DYN_RES_STEPS[index] ?? 1;
		// Verse meting na de wissel — oude samples zouden meteen dóórstappen
		this.resetDynResMeting();
		this.dynResCooldown = 1;
		this.applyPixelRatio();
	}

	/**
	 * Walls are the controller's job now; this only stops you standing inside Brad.
	 * `climb` keeps the escalator/stairs volumes walkable.
	 */
	/**
	 * Latch onto the glass elevator once you're in the cabin near the floor.
	 * Menu is NOT auto-shown — press E while looking at Hans / knoppen.
	 * Lift stays put while you're aboard (no auto-cycle).
	 */
	private updateElevatorRide(): void {
		if (!this.freeMove || !this.player.enabled || this.possessId !== null || this.player.flying) {
			this.elevRiding = false;
			this.player.setElevatorRide(null);
			this.elevUi?.hide();
			this.elevator.holdForPassenger(false);
			return;
		}
		const inXZ = this.elevator.contains(this.camera.position.x, this.camera.position.z, 0.05);
		const cabinY = this.elevator.cabinFloorY;
		const dy = Math.abs(this.player.feetHeight - cabinY);

		if (this.elevRiding) {
			if (!inXZ) {
				// Walked out the door — free the lift for auto-cycle
				this.elevRiding = false;
				this.player.setElevatorRide(null);
				this.elevUi.hide();
				this.elevator.holdForPassenger(false);
			} else {
				this.player.setElevatorRide(cabinY);
				// Stay put until player requests a floor (or leaves)
				if (!this.elevator.isMoving) {
					this.elevator.holdForPassenger(true);
				}
				// Hide menu if we started moving; keep mouse alone unless menu open
				if (this.elevator.isMoving && this.elevUi.isOpen) {
					this.elevUi.hide();
				}
			}
			return;
		}

		// Board silently — no popup, no focus steal
		if (inXZ && dy < 1.8) {
			this.elevRiding = true;
			this.player.setElevatorRide(cabinY);
			this.elevator.holdForPassenger(true);
			this.ui.setStatus('🛗 In de lift · kijk Hans/paneel · E = kies verdieping');
		} else {
			this.player.setElevatorRide(null);
			if (this.elevUi.isOpen) this.elevUi.hide();
		}
	}

	/**
	 * Wat E bij de lift zou doen, zonder het te doen. Ook `hasEInteraction` vraagt
	 * het hier, zodat de knop-check en de actie niet uit elkaar kunnen lopen.
	 */
	private elevatorAction(): { kind: 'menu' } | { kind: 'call'; level: LevelId } | null {
		if (!this.freeMove || this.possessId !== null || this.player.flying) return null;
		const hit = this.elevator.getLookHit(this.camera, 10);
		const inCab = this.elevator.contains(this.camera.position.x, this.camera.position.z, 0.2);
		const distXZ = Math.hypot(this.camera.position.x - this.elevator.pos.x, this.camera.position.z - this.elevator.pos.z);
		const here = levelAt(this.player.feetHeight);
		// Dak has a second call pedestal ~12 m toward the helipad — wider radius
		const nearShaft = distXZ < (here === 'roof' ? 14 : 4.5);

		// Inside Hans / panel → menu
		if (hit?.kind === 'hans' || hit?.kind === 'panel' || (inCab && hit?.kind === 'call')) return { kind: 'menu' };

		// Outside call button OR proximity on landing
		if (hit?.kind === 'call' || (nearShaft && !inCab)) {
			return { kind: 'call', level: hit?.kind === 'call' ? (hit.level ?? here) : here };
		}

		return null;
	}

	/**
	 * E on elevator controls:
	 * - Outside call (look or stand next to shaft) → summon cabin to THIS floor
	 * - Inside Hans / panel → destination menu + free mouse
	 */
	private tryOpenElevatorMenu(): boolean {
		const action = this.elevatorAction();
		if (!action) return false;

		if (action.kind === 'menu') {
			if (this.elevator.isMoving) {
				this.ui.setStatus('🛗 Even wachten — lift is onderweg');
				return true;
			}
			this.player.releaseLook();
			this.elevator.holdForPassenger(true);
			this.elevUi.show(this.elevator.currentStop);
			this.ui.setStatus('🛗 Hans: kies een verdieping');
			return true;
		}

		this.elevator.callToFloor(action.level);
		this.ui.setStatus(`🛗 Hans komt naar ${level(action.level).name.toLowerCase()} — even wachten`);
		return true;
	}

	/**
	 * Doet E hier iets? Spiegelt de keten in de keydown-handler in dezelfde
	 * volgorde, dus komt daar een actie bij dan hoort hij hier ook thuis.
	 * Controls gebruikt dit om E dan niet ook de camera te laten draaien.
	 */
	private hasEInteraction(): boolean {
		const p = this.camera.position;
		if (this.player.flying || this.vehicle === 'scrubber' || this.vehicle === 'car') return true;
		if (this.elevatorAction() !== null) return true;
		const free = !this.possessId && this.freeMove;
		if (free && this.driveCars.nearestCar(p, 4.5)) return true;
		if (free && this.scrubber.distanceTo(p) < 3.5 && levelAt(p.y) === 'v0') return true;
		if (free && this.drone.distanceTo(p) < 3.2) return true;
		if (free && this.heli.boardable && this.heli.distanceTo(p) < 4.5) return true;
		if (this.slideT < 0 && this.player.feetHeight > 17 && Math.hypot(p.x + 28.5, p.z + 10) < 2.2) return true;
		if (this.djBartek.inRange(p)) return true;
		return this.keeperInTalkRange();
	}

	/** Staat er een verkoper binnen praatafstand op jouw dek? Zoals ShopVoice.talkNear kiest. */
	private keeperInTalkRange(): boolean {
		const p = this.camera.position;
		const here = levelAt(p.y);
		// shopStores() bepaalt wie een verkoper krijgt — die regel hier niet nabouwen.
		for (const s of shopStores()) {
			if (s.level !== here) continue;
			if (this.shopVoice.distanceTo(s.id, p) < TALK_RADIUS) return true;
		}
		return false;
	}

	private pushPlayerFromSims(minDist: number): void {
		const cam = this.camera.position;
		const playerFloor = levelY(levelAt(cam.y));
		const group = this.atmosphere.americans.group;
		for (const child of group.children) {
			if (!(child instanceof THREE.Object3D)) continue;
			const sy = child.position.y;
			if (Math.abs(sy - playerFloor) > 2.5) continue;
			const sep = this.world.separate(cam.x, cam.z, child.position.x, child.position.z, minDist);
			cam.x = sep.ax;
			cam.z = sep.az;
		}
		// Wei Chen scrubber is solid — don't walk through the cart
		if (levelAt(cam.y) === 'v0') {
			const sep = this.world.separate(cam.x, cam.z, this.cleaner.pos.x, this.cleaner.pos.z, PLAYER_RADIUS + this.cleaner.radius);
			cam.x = sep.ax;
			cam.z = sep.az;
		}
		// Pass airborne so we don't void-eject mid-balcony-jump
		const airborne = !this.player.isGrounded;
		const r = this.world.resolveCircle(cam.x, cam.z, this.player.feetHeight, PLAYER_RADIUS, 3, true, airborne);
		cam.x = r.x;
		cam.z = r.z;
	}

	private animate = (timestamp?: number): void => {
		if (!this.perfProbe) requestAnimationFrame(this.animate);
		// THREE.Timer: update once per frame, then query delta/elapsed (stable multi-read)
		this.timer.update(timestamp);
		const dt = Math.min(this.timer.getDelta(), 0.05);
		const elapsed = this.timer.getElapsed();
		// Ongeklemde frametijd uit de rAF-timestamps zelf: dt hierboven is op
		// 50 ms afgekapt, en een meting die daarop leunt verzadigt precies waar
		// er ingegrepen moet worden — een 62ms-frame leest dan als 50.
		const frameMs = timestamp !== undefined && this.lastRafTs !== null ? timestamp - this.lastRafTs : dt * 1000;
		if (timestamp !== undefined) this.lastRafTs = timestamp;
		this.updateDynRes(frameMs);
		// CPU-klok van dit frame. Zonder deze splitsing zegt een frametijd van
		// 43 ms niet of de GPU of de main thread hem opsoupeert, en dat bepaalt
		// volledig wat je eraan moet doen.
		const cpuStart = performance.now();

		this.atmosphere.update(dt, this.camera.position);
		this.pathMesh.update(dt);
		this.thief.update(dt);
		this.beardCave.update(dt);
		this.protest.update(dt, this.camera.position);
		this.travel.update(dt);
		this.elevator.update(dt, this.camera.position);
		// Board / stay latched on elevator BEFORE player physics so ground snap
		// doesn't yank you out mid-shaft (that was the stutter + strand bug).
		this.updateElevatorRide();

		this.rat.update(dt);
		// Player vehicles: drive first so camera sticks before other systems
		if (this.vehicle === 'car' && this.driveCars.ridden) {
			const seat = this.driveCars.update(dt, this.player.getDriveInput());
			if (seat) {
				this.camera.position.copy(seat);
				this.player.setHeading(this.driveCars.heading);
				this.player.driving = true;
			}
		} else if (this.vehicle === 'scrubber' && this.scrubber.ridden) {
			const seat = this.scrubber.update(dt, this.player.getDriveInput());
			if (seat) {
				this.camera.position.copy(seat);
				this.player.setHeading(this.scrubber.heading);
				this.player.driving = true;
			}
		} else {
			this.scrubber.update(dt);
		}
		this.cleaner.update(
			dt,
			// Don't let Wei hunt you while you're racing a vehicle
			this.vehicle === 'scrubber' || this.vehicle === 'car' ? undefined : this.camera.position,
		);
		// Binaural listener: camera position + look/up for HRTF
		{
			const cam = this.camera;
			cam.getWorldDirection(this._fwd);
			this._up.set(0, 1, 0).applyQuaternion(cam.quaternion).normalize();
			spatial.updateListener({
				x: cam.position.x,
				y: cam.position.y,
				z: cam.position.z,
				fx: this._fwd.x,
				fy: this._fwd.y,
				fz: this._fwd.z,
				ux: this._up.x,
				uy: this._up.y,
				uz: this._up.z,
			});
		}
		this.prayer.update(dt, this.camera.position);
		this.penguins.update(dt);

		// Mall security — feed every "threat" in the building
		this.securityHitCd = Math.max(0, this.securityHitCd - dt);
		{
			const threats: { x: number; y: number; z: number; kind: string; weight: number }[] = [];
			// Sims are walking bombs of suspicion
			this.simPositions.length = 0;
			for (const child of this.atmosphere.americans.group.children) {
				if (!(child instanceof THREE.Object3D)) continue;
				this.simPositions.push(child.position);
				threats.push({
					x: child.position.x,
					y: child.position.y + 1.4,
					z: child.position.z,
					kind: 'shopper',
					weight: 0.9,
				});
			}
			if (this.thief.active) {
				const tp = this.thief.group.children[0]?.position ?? this.thief.group.position;
				threats.push({
					x: tp.x,
					y: tp.y + 1.2,
					z: tp.z,
					kind: 'thief',
					weight: 2.2,
				});
			}
			threats.push({
				x: this.monkey.group.position.x,
				y: this.monkey.group.position.y + 0.8,
				z: this.monkey.group.position.z,
				kind: 'monkey',
				weight: 1.6,
			});
			threats.push({
				x: this.protest.pos.x,
				y: 1.4,
				z: this.protest.pos.z,
				kind: 'protest',
				weight: 1.3,
			});
			threats.push({
				x: this.cleaner.pos.x,
				y: this.cleaner.pos.y + 1.2,
				z: this.cleaner.pos.z,
				kind: 'cleaner',
				weight: 0.7,
			});
			this.security.update(dt, this.camera.position, threats);
		}

		// Vóór de speler-update, want E is ook actieknop: ligt er iets klaar dan mag
		// hij de camera niet meedraaien terwijl je hem indrukt.
		this.player.setInteractOnE(this.hasEInteraction());

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
			// Keep glued after physics (belt/sim push can nudge feet)
			if (this.elevRiding && !this.player.driving) {
				this.player.setElevatorRide(this.elevator.cabinFloorY);
			}
			// Lopend: loopband-drift + niet ín Brad staan. Vliegend/rijdend: skip.
			if (!this.player.flying && !this.player.driving) {
				if (this.player.isGrounded && !this.elevRiding) {
					const belt = this.walkways.beltVelocityAt(this.camera.position.x, this.player.feetHeight, this.camera.position.z);
					if (belt) this.player.nudge(belt.x * dt, belt.z * dt);
					// Roltrap net als de loopband: horizontale drift erbij, de klim volgt
					// vanzelf uit groundHeightAt. De trap heeft geen carrySpeed en doet niks.
					const tread = this.world.rampCarryAt(this.camera.position.x, this.camera.position.z, this.player.feetHeight);
					if (tread) this.player.nudge(tread.x * dt, tread.z * dt);
				}
				if (!this.elevRiding) this.pushPlayerFromSims(0.9);
			}
		} else {
			// Cinematic: the tour walks the authored path, collision must not shove it
			this.director.update(dt);
		}

		this.updateConfetti(dt);
		this.mall.update(dt);
		this.palms.update(elapsed);
		this.walkways.update(dt);
		this.amenities.update(dt, elapsed);
		this.disco.update(dt);
		this.spaceship.update(elapsed);
		this.djBartek.update(elapsed, dt, this.djPlayer.playing);
		this.alienProbe.update(dt);

		// Outdoor city systems — verkeer, stoplichten, skyline, park, theater,
		// outdoor garage, lucht, vogels, dakeiland + badgasten
		this.cityRoads.update(dt, elapsed);
		this.cityTraffic.update(dt, elapsed);
		this.cityBuildings.update(dt, elapsed);
		this.cityPark.update(dt, elapsed);
		this.cityTheatre.update(dt, elapsed);
		this.cityGarage.update(dt, elapsed);
		this.citySky.update(dt, elapsed);
		this.cityBirds.update(dt, elapsed);
		this.roofIsland.update(dt, elapsed);
		this.poolPeople.update(dt, elapsed);
		this.tickSlide(dt);

		// Feed the monkey its victim list, then let it aim
		this.simPositions.length = 0;
		for (const child of this.atmosphere.americans.group.children) {
			this.simPositions.push(child.position);
		}
		this.monkey.setSimPositions(this.simPositions);
		this.monkey.update(dt);
		this.catwalk.update(dt, elapsed);
		if (this.vehicle === 'heli') this.heli.followCamera(this.camera, dt);
		else this.heli.update(dt);
		this.drone.followCamera(this.camera, dt);

		// E-hint als je naast de geparkeerde drone staat
		const nearDrone =
			!this.player.flying && !this.player.driving && this.freeMove && this.drone.distanceTo(this.camera.position) < 3.2;
		if (nearDrone && !this.nearDroneHint) {
			this.nearDroneHint = true;
			this.ui.setStatus('🛸 Passagiersdrone — druk E om in te stappen');
		} else if (!nearDrone && this.nearDroneHint) {
			this.nearDroneHint = false;
		}

		// Empty scrubber rental
		const nearScrub =
			!this.player.flying &&
			!this.player.driving &&
			this.freeMove &&
			this.scrubber.distanceTo(this.camera.position) < 3.8 &&
			levelAt(this.camera.position.y) === 'v0';
		if (nearScrub && !this.nearScrubberHint) {
			this.nearScrubberHint = true;
			this.ui.setStatus('🧽 SCHOONMAAK BUGGY #88 — leeg · E = instappen & racen (Shift = turbo)');
		} else if (!nearScrub && this.nearScrubberHint) {
			this.nearScrubberHint = false;
		}

		// Driveable cars (P1 garage / parked outside)
		const nearCar =
			!this.player.flying && !this.player.driving && this.freeMove && !!this.driveCars.nearestCar(this.camera.position, 4.2);
		if (nearCar && !this.nearCarHint) {
			this.nearCarHint = true;
			this.ui.setStatus('🚗 HUURAUTO · E = instappen · Shift = turbo · west-exit ramp → STAD');
		} else if (!nearCar && this.nearCarHint) {
			this.nearCarHint = false;
		}

		// Bewoners-dashboard: refresh 2×/s, only while open
		this.peopleT += dt;
		if (this.peopleT > 0.5 && this.peopleUi.isOpen) {
			this.peopleT = 0;
			this.atmosphere.americans.getPeopleSnapshot(this.camera.position, this.peopleRows);
			this.peopleUi.update(this.peopleRows, this.buildCastRows());
		}
		this.shopVoice.update(dt);
		this.tickBartekDrama(dt);
		// Auto-greet Youssef when you walk into Kruidvat
		void this.shopVoice.greetIfNear('kruidvat', this.camera.position, 6.5);
		const dYoussef = this.shopVoice.distanceTo('kruidvat', this.camera.position);
		if (dYoussef < TALK_RADIUS && levelAt(this.camera.position.y) === 'v1' && !this.youssefHint) {
			this.youssefHint = true;
			this.ui.setStatus('💊 Youssef Benali (Kruidvat) · druk E om te praten');
		} else if (dYoussef > 10) {
			this.youssefHint = false;
		}

		// Sims yell at you if you walk up their ass
		const roast = this.atmosphere.americans.maybeRoastPlayer(this.camera.position, dt);
		if (roast) this.ui.setStatus(`💬 ${roast}`);

		// Meet sims nearby = score (viral "I know Brad" energy)
		this.nearHudT += dt;
		if (this.nearHudT > 0.35) {
			this.nearHudT = 0;
			// Bartek's mix zakt weg met de afstand tot de booth (kwadratisch),
			// net als de gebedsruimte-loop. Dichtbij = vol, andere kant mall = zacht.
			{
				const bd = this.camera.position.distanceTo(this.djBartek.pos);
				this.djPlayer.setDistanceGain(1 / (1 + 0.012 * bd * bd));
			}
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
			const top = near[0];
			if (top) {
				const heart = top.partnerName ? ` ❤️ ${top.partnerName.split(' ')[0] ?? top.partnerName}` : '';
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

			// Protest picket — Wir schaffen das
			const dProt = this.camera.position.distanceTo(this.protest.pos);
			if (dProt < 7 && !this.nearProtestHint) {
				this.nearProtestHint = true;
				this.ui.setStatus('📢 PROTEST STEMPELT · 28 multi-voice chants · Wir schaffen das · Mutti lead');
			} else if (dProt >= 9) {
				this.nearProtestHint = false;
			}

			// Island Hop Travel — next to juwelen cave
			const dTravel = this.camera.position.distanceTo(this.travel.pos);
			if (dTravel < 6 && !this.nearTravelHint) {
				this.nearTravelHint = true;
				this.ui.setStatus('🌴 ISLAND HOP · Epstein Island charters · flights suspended · NDA desk');
			} else if (dTravel >= 8) {
				this.nearTravelHint = false;
			}

			// Gebedsruimte — music + Allahu Akbar wall
			const dPrayer = Math.hypot(this.camera.position.x - this.prayer.pos.x, this.camera.position.z - this.prayer.pos.z);
			if (dPrayer < 12 && levelAt(this.camera.position.y) === 'v0' && !this.nearPrayerHint) {
				this.nearPrayerHint = true;
				this.ui.setStatus('🕌 GEBEDSRUIMTE · Allahu Trapbar ♪ (vol) · poses op de beat · geit');
			} else if (dPrayer >= 16) {
				this.nearPrayerHint = false;
			}

			// Security — if you're close enough to read the badge, you're already a threat
			if (!this.nearSecurityHint) {
				for (const g of this.security.roster) {
					// roster has no positions — soft global intro once per area via first open fire is enough
					void g;
				}
				// One-shot when first free-roaming near atrium
				const dAtrium = Math.hypot(this.camera.position.x, this.camera.position.z);
				if (dAtrium < 18 && this.freeMove) {
					this.nearSecurityHint = true;
					this.ui.setStatus('🚔 MALL SECURITY · hypersensitief · adem te hard = open vuur');
				}
			}

			// Glass elevator (+ dak: wide radius because call pedestals sit off-shaft)
			const dElevXZ = Math.hypot(this.camera.position.x - this.elevator.pos.x, this.camera.position.z - this.elevator.pos.z);
			const onRoofHint = this.player.level === 'roof';
			const elevHintR = onRoofHint ? 16 : 5;
			const elevHintLeave = onRoofHint ? 20 : 7;
			const inElev = this.elevator.contains(this.camera.position.x, this.camera.position.z);
			if ((dElevXZ < elevHintR || inElev) && !this.nearElevHint) {
				this.nearElevHint = true;
				this.ui.setStatus(
					inElev
						? '🛗 GLAZEN LIFT · kijk Hans · E = kies verdieping'
						: onRoofHint
							? '🟢 GROENE KNOP / gele streep · E = roep Hans naar het dak'
							: '🛗 GLAZEN LIFT · gele/blauwe knop of E naast schacht = roep lift',
				);
			} else if (dElevXZ >= elevHintLeave && !inElev) {
				this.nearElevHint = false;
			}
		}

		const eul = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
		const targetStore = this.currentStore;
		this.mapBlips.length = 0;
		for (const child of this.atmosphere.americans.group.children) {
			this.mapBlips.push({
				x: child.position.x,
				z: child.position.z,
				level: levelAt(child.position.y),
			});
		}
		this.ui.updateMap({
			x: this.camera.position.x,
			z: this.camera.position.z,
			yaw: eul.y,
			level: levelAt(this.camera.position.y),
			path: this.currentPath.map((n) => ({ x: n.x, y: n.y, z: n.z })),
			blips: this.mapBlips,
			target: targetStore
				? {
						x: targetStore.x,
						z: targetStore.z,
						level: targetStore.level,
						name: targetStore.name.replace('\n', ' '),
					}
				: null,
		});

		// Persist position + score for HMR / reload
		this.persistT += dt;
		if (this.persistT >= PERSIST_EVERY) {
			this.persistT = 0;
			this.persistNow();
		}

		// Last thing before the draw: every update() above has moved something.
		// Keyed on the camera, not on the player body: in guest view and on the
		// cinematic tour `player.update()` never runs, so `player.level` is frozen
		// on whatever deck the body was left standing on. Same deck as the minimap.
		cullByLevel(levelAt(this.camera.position.y));

		const afterLogic = performance.now();
		this.renderer.info.reset();
		this.sceneBatcher.update();
		// Ná sceneBatcher.update(): die roept scene.updateMatrixWorld(true) aan, dus
		// de matrixWorld van elk object dat een lamp volgt is hier vers.
		this.pool.update(this.camera);
		const afterBatch = performance.now();
		this.composer.render(dt);
		// Let op bij het lezen: dit is de tijd om het frame te versturen, niet om
		// het te tekenen. De driver blokkeert hier pas als hij achterloopt — dan
		// loopt juist dít getal op terwijl de GPU de echte schuldige is.
		const afterRender = performance.now();
		if (this.perfProbe) {
			const totalCalls = this.renderer.info.render.calls;
			const totalTriangles = this.renderer.info.render.triangles;
			this.renderer.shadowMap.enabled = false;
			this.renderer.info.reset();
			this.composer.render(dt);
			const mainCalls = this.renderer.info.render.calls;
			document.documentElement.dataset['frameDrawCalls'] = String(mainCalls);
			document.documentElement.dataset['shadowDrawCalls'] = String(Math.max(0, totalCalls - mainCalls));
			document.documentElement.dataset['frameTriangles'] = String(totalTriangles);
			this.renderer.shadowMap.enabled = true;
		}

		// Ná de render: de tellers van dit frame staan er nu in.
		const buffer = this.renderer.getDrawingBufferSize(this.bufferSize);
		this.perfHud.update({
			frameMs,
			drawCalls: this.renderer.info.render.calls,
			triangles: this.renderer.info.render.triangles,
			programs: this.renderer.info.programs?.length ?? 0,
			geometries: this.renderer.info.memory.geometries,
			textures: this.renderer.info.memory.textures,
			bufferWidth: buffer.width,
			bufferHeight: buffer.height,
			renderScale: this.dynScale,
			cpuMs: afterRender - cpuStart,
			logicMs: afterLogic - cpuStart,
			batchMs: afterBatch - afterLogic,
			submitMs: afterRender - afterBatch,
			lightsUsed: this.pool.slotsInUse,
			lightsTotal: LIGHT_POOL_SLOTS,
			batches: this.sceneBatcher.stats.drawCalls,
		});
	};
}
