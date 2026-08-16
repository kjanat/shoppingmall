import { feature } from 'bun:bundle';
import type { EffectComposer } from 'postprocessing';
import {
	BufferAttribute,
	BufferGeometry,
	Color,
	Euler,
	Mesh,
	NoToneMapping,
	Object3D,
	PCFShadowMap,
	PerspectiveCamera,
	Points,
	PointsMaterial,
	Raycaster,
	Scene,
	SRGBColorSpace,
	Timer,
	Vector2,
	Vector3,
	WebGLRenderer,
} from 'three';
import { BartekChat } from '#/audio/BartekChat';
import { BOOTH_FALLOFF_K, DJPlayer } from '#/audio/DJPlayer';
import { fetchDjStatus, playBoothFile, speakLine } from '#/audio/ElevenVoice';
import { spatial } from '#/audio/SpatialAudio';
import { Director } from '#/camera/Director';
import type { GraphNode } from '#/data/graph';
import { MALL_SHELL, WORLD_VIEW_DISTANCE } from '#/data/layout';
import type { LevelId } from '#/data/levels';
import { level, levelAt, levelY } from '#/data/levels';
import { SIGHT_BLOCKING_TAG } from '#/data/spatial';
import type { StoreDef } from '#/data/stores';
import { getKruidvat, getStore, shopStores } from '#/data/stores';
import { ELEVATOR_ENTITY, PARKED_MOTORCYCLE_SPOTS } from '#/data/world';
import type { ZoneId } from '#/data/zones';
import { deckAt, zoneAt, zoneBit } from '#/data/zones';
import { Pathfinder } from '#/path/Pathfinder';
import { PathMesh } from '#/path/PathMesh';
import { CabinCarrier } from '#/physics/Carrier';
import type { RoomCollider } from '#/physics/Collision';
import { CollisionWorld } from '#/physics/Collision';
import { PlayerControls } from '#/player/Controls';
import { EYE, PLAYER_RADIUS } from '#/player/constants';
import { createComposer } from '#/post/Composer';
import { GpuTimer } from '#/render/GpuTimer';
import { lampCount, zoneCullOn } from '#/render/graphicsPrefs';
import { LightPool } from '#/render/LightPool';
import { SceneBatcher } from '#/render/SceneBatcher';
import { ownerName } from '#/render/sceneOwner';
import type { ZoneOwnerTally } from '#/render/ZoneCuller';
import { ZoneCuller } from '#/render/ZoneCuller';
import { ZoneVisibility } from '#/render/ZoneVisibility';
import { AlienProbe } from '#/scene/AlienProbe';
import { Amenities } from '#/scene/Amenities';
import type { PersonRow } from '#/scene/Americans';
import { Atmosphere } from '#/scene/Atmosphere';
import { BeardCave } from '#/scene/BeardCave';
import { Catwalk } from '#/scene/Catwalk';
import { CleaningCart } from '#/scene/CleaningCart';
import { ColosseumFighters } from '#/scene/ColosseumFighters';
import { Barriers } from '#/scene/city/Barriers';
import { CityBirds } from '#/scene/city/CityBirds';
import { CityBuildings } from '#/scene/city/CityBuildings';
import { CityColosseum } from '#/scene/city/CityColosseum';
import { CityFavela } from '#/scene/city/CityFavela';
import { CityGarage } from '#/scene/city/CityGarage';
import { CityPark } from '#/scene/city/CityPark';
import { CityPlaza } from '#/scene/city/CityPlaza';
import { CityRioMountain } from '#/scene/city/CityRioMountain';
import { CityRoads } from '#/scene/city/CityRoads';
import { CitySky } from '#/scene/city/CitySky';
import { CityTheatre } from '#/scene/city/CityTheatre';
import type { RoadObstacle } from '#/scene/city/CityTraffic';
import { CityTraffic } from '#/scene/city/CityTraffic';
import { ColosseumTransport } from '#/scene/city/ColosseumTransport';
import { CITY_TRAFFIC_ZONES } from '#/scene/city/cityPlan';
import { FurryCon } from '#/scene/con/FurryCon';
import { DiscoParty } from '#/scene/Disco';
import { BARTEK_LINES, DJBartek } from '#/scene/DJBartek';
import { DriveableCars } from '#/scene/DriveableCars';
import { Drone } from '#/scene/Drone';
import { Entrance } from '#/scene/Entrance';
import { FoodCourt } from '#/scene/FoodCourt';
import { GlassElevator } from '#/scene/GlassElevator';
import { Helicopter } from '#/scene/Helicopter';
import { Helipad } from '#/scene/Helipad';
import { setupLighting } from '#/scene/Lighting';
import { MallBuilder } from '#/scene/MallBuilder';
import { MallFacade } from '#/scene/MallFacade';
import { MallRat } from '#/scene/MallRat';
import { Monkey } from '#/scene/Monkey';
import { Motorcycles } from '#/scene/Motorcycles';
import { PalmForest } from '#/scene/Palms';
import { ParkingGarage } from '#/scene/ParkingGarage';
import { Penguins } from '#/scene/Penguins';
import { PoolPeople } from '#/scene/PoolPeople';
import { PrayerRoom } from '#/scene/PrayerRoom';
import { ProtestGroupies } from '#/scene/ProtestGroupies';
import { Restrooms } from '#/scene/Restrooms';
import { RoofIsland } from '#/scene/RoofIsland';
import { ScrubberBuggy } from '#/scene/ScrubberBuggy';
import { SecurityGuards } from '#/scene/SecurityGuards';
import { ShopVoice } from '#/scene/ShopVoice';
import { Spaceship } from '#/scene/Spaceship';
import { StockDisplay } from '#/scene/StockDisplay';
import { BakerThief } from '#/scene/Thief';
import { TravelAgency } from '#/scene/TravelAgency';
import { MovingWalkways } from '#/scene/Walkways';
import { DJOverlay } from '#/ui/DJOverlay';
import { DJWidget } from '#/ui/DJWidget';
import { ElevatorPanel } from '#/ui/ElevatorPanel';
import type { MapBlip } from '#/ui/KioskOverlay';
import { KioskOverlay } from '#/ui/KioskOverlay';
import type { CastRow } from '#/ui/PeopleDashboard';
import { PeopleDashboard } from '#/ui/PeopleDashboard';
import type { PerfOverlay } from '#/ui/PerfOverlay';
import { SettingsPanel } from '#/ui/SettingsPanel';
import { setLabelAnisotropy } from '#/util/label';
import { easeFactor, half, lerp, shortestAngle } from '#/util/math';
import { at, jitter, pick } from '#/util/rand';
import { cullByLevel } from '#/util/visibility';
import type { PersistedRide } from './GamePersist';
import { loadGame, pathToPersist, saveGame } from './GamePersist';
import { CoarseTicker } from './ZoneLod';

const PERSIST_EVERY = 0.75; // seconds
/** Praatafstand tot een verkoper — E praat én de E-melding luistert hiernaar. */
const TALK_RADIUS = 7;
/**
 * Dynamische resolutie: vaste treden i.p.v. een glijdende schaal, want elke
 * wissel laat composer.setSize twee HalfFloat-fullscreentargets heralloceren.
 * Onder 0.5 wordt het beeld te papperig om nog wat te winnen.
 */
const DYN_RES_FULL = 1;
const DYN_RES_HIGH = 0.85;
const DYN_RES_MEDIUM = 0.75;
const DYN_RES_LOW = 0.65;
const DYN_RES_STEPS = [DYN_RES_FULL, DYN_RES_HIGH, DYN_RES_MEDIUM, DYN_RES_LOW];
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
/** Onder deze frametijd (ms) is een sample te snel om als vsync-schatting te tellen. */
const DYN_RES_VSYNC_FLOOR_MS = 4;
/** EMA-gewichten van de frametijd: hoeveel het gemiddelde onthoudt tegen het verse sample. */
const DYN_RES_EMA_OLD = 0.9;
const DYN_RES_EMA_NEW = 0.1;
/** Zo lang aanhoudend traag zakt de schaal een trede, en (langer) ruim comfort voor hij weer omhoog mag (s). */
const DYN_RES_HOLD_DOWN_S = 0.5;
const DYN_RES_HOLD_UP_S = 2;
/** Afkoeltijd na een schaalwissel voor de regelaar opnieuw mag ingrijpen (s). */
const DYN_RES_COOLDOWN_S = 1;
/** Valversnelling van de confetti (m/s²); lichter dan de speler zodat het dwarrelt. */
const CONFETTI_GRAVITY = 9;
const MUSIC_FILE_PATTERN = /intro_voice|voice/i;
const CAMERA_CONFIG = { fovDegrees: 70, nearPlane: 0.15 };
const QUALITY_PIXEL_RATIO = { medium: 1.25, high: 1.75 };
const COLLIDER_DEFAULTS = { roomMinY: -0.5, roomMaxY: 3.2, shaftMinY: -7.5, shaftMaxY: 16.5 };
const ELEVATOR_RANGE = { carrierMargin: 0.05, cabinMargin: 0.2, boardHeight: 1.8, roofCall: 14, landingCall: 4.5 };
const ELEVATOR_SCRUBBER = { margin: 0.05, floorTolerance: 0.6 };
const INTERACTION_RANGE = { car: 4.5, scrubber: 3.5, drone: 3.2, helicopter: 4.5, parkedScrubber: 3.8, parkedCar: 4.2 };
const PLAYER_TIMING = { unlockGraceMs: 400, frameDtMaxSeconds: 0.05, millisecondsPerSecond: 1000 };
const PLAYER_SEPARATION = { floorTolerance: 2.5, collisionIterations: 3, simDistance: 0.9 };
const DRONE_POSITION = { seatHeight: 1.1, groundProbeOffset: 0.55, groundProbeRange: 3, exitOffset: 1.2 };
const SECURITY_POLICY = {
	maxPanicPenalty: 12,
	penaltyPerTarget: 2,
	hitCooldownSeconds: 0.6,
	introRadius: 18,
};
const MONKEY_HIT = { scorePenalty: 8, confettiHeight: 0.4, moodPenalty: 4 };
const THIEF_EVENT = { transactionInterval: 5, lootHeight: 1.5, scorePenalty: 15, homeHeight: 1.2, caveHeight: 0.8 };
const CHECKOUT_SCORE = 2;
const PENGUIN_COUNT = 12;
const CATWALK_LIGHT_DIM = 0.15;
const MONEY_GIFT = { amount: 25, score: 5 };
const DJ_AUDIO = {
	probeCheerRadius: 20,
	chatBubbleSeconds: 5,
	introBubbleSeconds: 6,
	minimumBakedIntroMs: 500,
	boothCheerRadius: 14,
	maxBubbleSeconds: 8,
	baseBubbleSeconds: 2.5,
	secondsPerCharacter: 0.04,
	maxSpeechWaitMs: 14_000,
	fallbackMsPerCharacter: 55,
	minimumSpeechWaitMs: 800,
	speechWaitFactor: 0.85,
	cheerCooldownBase: 9,
	cheerCooldownJitter: 12,
	ambientCheerRadius: 16,
	dramaRange: 18,
	dramaCooldownBase: 18,
	dramaCooldownJitter: 22,
	requestScore: 3,
	requestCheerRadius: 18,
	danceFlashMs: 12_000,
};
const BARTEK_VOICE_ID = ['IKne3meq5a', 'Sn9XLyUdCD'].join('');
const ROUTE_REWARD = { featured: 100, standard: 50 };
const ROUTE_VISUAL = { storeEyeHeight: 1.5, featuredConfettiHeight: 1.5, standardConfettiHeight: 0.5, maxSteps: 6 };
const CONFETTI = {
	count: 100,
	itemSize: 3,
	spread: 4,
	verticalSpread: 3,
	pointSize: 0.12,
	opacity: 0.9,
	lifetimeMs: 3500,
};
const CONFETTI_GREEN = 0x00a651;
const CONFETTI_RED = 0xe30613;
const CONFETTI_YELLOW = 0xf5c518;
const CONFETTI_WHITE = 0xffffff;
const CONFETTI_PALETTE = [
	new Color(CONFETTI_GREEN),
	new Color(CONFETTI_RED),
	new Color(CONFETTI_YELLOW),
	new Color(CONFETTI_WHITE),
];
const BATCH_DYNAMIC_SOURCES_KEY = ['batchDynamic', 'Sources'].join('');
const CAMERA_FOLLOW = { possessedPitch: -0.05, possessedPitchLerp: 0.15 };
const THREAT_PROFILE = {
	shopperHeight: 1.4,
	shopperWeight: 0.9,
	thiefHeight: 1.2,
	thiefWeight: 2.2,
	monkeyHeight: 0.8,
	monkeyWeight: 1.6,
	protestHeight: 1.4,
	protestWeight: 1.3,
	cleanerHeight: 1.2,
	cleanerWeight: 0.7,
};
const HUD_TIMING = { peopleRefreshSeconds: 0.5, proximityRefreshSeconds: 0.35 };
const PROXIMITY_RANGE = {
	youssefGreeting: 6.5,
	youssefLeave: 10,
	sims: 5.5,
	conEnter: 40,
	conLeave: 55,
	protestEnter: 7,
	protestLeave: 9,
	travelEnter: 6,
	travelLeave: 8,
	prayerEnter: 12,
	prayerLeave: 16,
};
const ELEVATOR_HINT_RANGE = { roofEnter: 16, floorEnter: 5, roofLeave: 20, floorLeave: 7 };

/** Widen literal-typed mutable flags at component boundaries. */
function mutableFlag(value: boolean): boolean {
	return value;
}

function observeAsync(task: Promise<unknown>, operation: string): void {
	task.catch((error: unknown) => console.warn(`[Mall] ${operation} failed`, error));
}

/** Wat E bij de lift doet: het paneel in de cabine, of de oproepknop op een overloop. */
type ElevatorAction = { kind: 'menu' } | { kind: 'call'; level: LevelId };

interface PerfPose {
	x: number;
	y: number;
	z: number;
	lookX: number;
	lookY: number;
	lookZ: number;
}
interface PerfCpuFrame {
	logicMs: number;
	batchMs: number;
	submitMs: number;
	triangles: number;
}
interface PerfRayHit {
	owner: string;
	name: string;
	geometry: string;
	material: string;
	distance: number;
	x: number;
	y: number;
	z: number;
}
interface PerfZoneCull {
	zone: ZoneId;
	enabled: boolean;
	cones: number;
	batches: number;
	batchesHidden: number;
	occupants: number;
	occupantsHidden: number;
	keptInOwnZone: number;
	keptThroughCone: number;
	owners: readonly ZoneOwnerTally[];
}
interface FrameTiming {
	dt: number;
	elapsed: number;
	frameMs: number;
	cpuStart: number;
}
interface RenderTiming {
	afterLogic: number;
	afterBatch: number;
	afterRender: number;
}

function createDjWidget(uiRoot: HTMLElement, player: DJPlayer, onOpen: () => void): DJWidget {
	return new DJWidget(uiRoot, player, onOpen);
}

export class App {
	private readonly renderer: WebGLRenderer;
	private readonly scene = new Scene();
	private readonly camera: PerspectiveCamera;
	private readonly composer: EffectComposer;
	private readonly director: Director;
	private readonly pathfinder = new Pathfinder();
	private readonly pathMesh = new PathMesh();
	private readonly world = new CollisionWorld();
	private readonly mall = new MallBuilder();
	private readonly mallFacade = new MallFacade();
	private readonly palms = new PalmForest();
	private readonly walkways = new MovingWalkways();
	/** DE STAD — 8 modules buiten de muren + tropisch dakeiland met badgasten */
	private readonly cityBuildings = new CityBuildings();
	private readonly cityRoads = new CityRoads();
	/**
	 * De slagbomen van de stad. Ze staan vóór alles wat erlangs wil, want ieder
	 * voertuig meldt zich bij deze ene lijst en de bomen beslissen zelf wie erdoor mag.
	 */
	private readonly barriers = new Barriers(this.world);
	private readonly cityTraffic = new CityTraffic(() => this.cityRoads.lightPhase, this.barriers);
	private readonly cityPark = new CityPark();
	private readonly cityRio = new CityRioMountain();
	private readonly cityFavela = new CityFavela();
	private readonly cityColosseum = new CityColosseum(this.world);
	private readonly colosseumFighters = new ColosseumFighters();
	private readonly colosseumTransport = new ColosseumTransport();
	private readonly chariotSeat = new Vector3();
	private readonly chariotExit = new Vector3();
	private readonly cityPlaza = new CityPlaza();
	private readonly cityGarage = new CityGarage();
	private readonly citySky = new CitySky();
	private readonly cityBirds = new CityBirds();
	private readonly roofIsland = new RoofIsland();
	private readonly poolPeople = new PoolPeople();
	private readonly amenities = new Amenities();
	/**
	 * Elke feature hieronder huurt zijn puntlichten bij de pool en wordt daarom
	 * in de constructor gebouwd, ná de pool. Een veldinitialisator draait vóór
	 * de constructorbody en zou de pool nog niet hebben.
	 */
	private readonly pool = new LightPool(this.scene, lampCount());
	private readonly daylight = setupLighting(this.scene, this.pool);
	private readonly disco = new DiscoParty(this.pool, this.daylight);
	private readonly stock = new StockDisplay(this.pool);
	private readonly spaceship = new Spaceship(this.pool);
	private readonly beardCave = new BeardCave(this.pool);
	private readonly atmosphere = new Atmosphere(this.world);
	private readonly thief = new BakerThief(this.world, this.beardCave);
	private readonly protest = new ProtestGroupies(this.world);
	private readonly travel = new TravelAgency(this.pool);
	private readonly rat = new MallRat(this.world);
	private readonly cleaner = new CleaningCart(this.world);
	private readonly prayer = new PrayerRoom(this.pool);
	private readonly penguins = new Penguins(this.world, PENGUIN_COUNT);
	private readonly restrooms = new Restrooms(this.pool);
	private readonly helipad = new Helipad(this.pool, this.world);
	private readonly foodCourt = new FoodCourt(this.pool);
	private readonly elevator = new GlassElevator(this.pool);
	private readonly entrance = new Entrance(this.pool);
	private readonly carrier = new CabinCarrier(
		ELEVATOR_ENTITY,
		() => this.elevator.cabinFloorY,
		(x, z) => this.elevator.contains(x, z, ELEVATOR_RANGE.carrierMargin),
	);
	private readonly parking = new ParkingGarage(this.pool);
	private readonly security = new SecurityGuards(this.world, this.pool);
	/** Het theater heeft zaallicht. */
	private readonly cityTheatre = new CityTheatre(this.pool);
	private readonly furryCon = new FurryCon(this.pool, this.world);
	private nearElevHint = mutableFlag(false);
	private nearSecurityHint = mutableFlag(false);
	private securityHitCd = 0;
	/** Reused for binaural listener orientation */
	private readonly _fwd = new Vector3();
	private readonly _up = new Vector3();
	/** Werkplek voor de zonevraag van een LOD-klok; hij loopt elk frame over tientallen lichamen. */
	private readonly _zoneSpot = new Vector3();
	/** Latched until you walk out of the cabin XZ */
	private elevRiding = mutableFlag(false);
	private readonly elevUi: ElevatorPanel;
	private readonly bartekChat = new BartekChat();
	private readonly djBartek = new DJBartek(this.pool);
	private readonly alienProbe = new AlienProbe(this.pool);
	private readonly monkey: Monkey;
	private readonly catwalk = new Catwalk();
	private readonly heli = new Helicopter(this.helipad.padCenter, this.world);
	private readonly drone = new Drone();
	private readonly scrubber = new ScrubberBuggy(this.world, this.pool, this.barriers);
	private readonly driveCars = new DriveableCars(this.world, this.barriers);
	private readonly motorcycles = new Motorcycles(PARKED_MOTORCYCLE_SPOTS, 'motorcycles_p1');
	private nearDroneHint = mutableFlag(false);
	private nearScrubberHint = mutableFlag(false);
	private nearCarHint = mutableFlag(false);
	private nearChariotHint = mutableFlag(false);
	/** Glijbaan-rit: meters langs de bocht, -1 = niet aan het glijden */
	private slideDistance = -1;
	private readonly slideSeat = new Vector3();
	private readonly slideLook = new Vector3();
	/** FPS-chip + het uitklapbare prestatiepaneel */
	private perfHud: PerfOverlay | null = null;
	/** Alleen aanwezig als het paneel meekomt: het is puur meetgereedschap. */
	private readonly gpuTimer: GpuTimer | null = null;
	/** Populated only through the pre-document profiling probe. */
	private perfPose: PerfPose | null = null;
	/** Freeze simulation time while the external probe compares render configurations. */
	private perfFrozen = mutableFlag(false);
	private perfFrozenElapsed = 0;
	private readonly perfCpuFrame: PerfCpuFrame = { logicMs: 0, batchMs: 0, submitMs: 0, triangles: 0 };
	private readonly raycaster = new Raycaster();
	/** Hergebruikt voor de HUD-pose, zodat het paneel geen vector per tick alloceert. */
	private readonly hudDirection = new Vector3();
	/** Hergebruikt: getDrawingBufferSize schrijft in een doelvector, elk frame. */
	private readonly bufferSize = new Vector2();
	/**
	 * Pixelratio heeft één eigenaar: kwaliteitstier × dynamische schaal, samen
	 * toegepast in applyPixelRatio(). Eerder schreef de kwaliteits-handler de
	 * ratio rechtstreeks; een tweede schrijver zou daar stil mee vechten.
	 */
	/** De echte waarde komt uit bindQuality, dat synchroon in de constructor vuurt. */
	private qualityRatio = 1;
	private dynScale = 1;
	private dynResOn = mutableFlag(true);
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
	private vehicle: 'drone' | 'heli' | 'scrubber' | 'car' | 'chariot' | null = null;
	/** Laatste parkeerstand; blijft na uitstappen bewaard voor een HMR-herbouw. */
	private lastParkedVehicle: PersistedRide | null = null;
	/** reused each frame for the monkey's target list */
	private readonly simPositions: Vector3[] = [];
	private readonly djPlayer = new DJPlayer();
	private readonly shopVoice = new ShopVoice();
	private readonly djUi: DJOverlay;
	private youssefHint = mutableFlag(false);
	private readonly settingsUi: SettingsPanel;
	private readonly peopleUi: PeopleDashboard;
	private peopleT = 0;
	private readonly peopleRows: PersonRow[] = [];
	private readonly player: PlayerControls;
	private readonly ui: KioskOverlay;
	/** Replaces deprecated Clock — call update() once per frame */
	private readonly timer = new Timer();
	private currentPath: GraphNode[] = [];
	private currentStore: StoreDef | null = null;
	private confetti: Points | null = null;
	private confettiVel: Float32Array | null = null;
	private score = 0;
	private metSims = new Set<number>();
	private nearHudT = 0;
	/** reused every frame so the minimap doesn't allocate 20 objects per tick */
	private readonly mapBlips: MapBlip[] = [];
	private unlockedAt = -1e4;
	/** free walk after intro; disabled during cinematic tour */
	private freeMove = mutableFlag(false);
	/** RCT-style: ride along as a guest */
	private possessId: number | null = null;
	private thiefFiredAt = 0;
	private nearDjHint = mutableFlag(false);
	private nearProtestHint = mutableFlag(false);
	private nearTravelHint = mutableFlag(false);
	private nearConHint = mutableFlag(false);
	private nearFavelaGangHint = mutableFlag(false);
	private lastConHint: string | null = null;
	private nearPrayerHint = mutableFlag(false);
	private bartekSpeaking = mutableFlag(false);
	private crowdCheerCd = 0;
	private persistT = 0;
	private restoredFromSave = mutableFlag(false);
	private readonly sceneBatcher: SceneBatcher;
	/**
	 * Zone- en portaalculling. Zonder deze stond je op de stoep en werd het hele
	 * interieur getekend, beschaduwd én gesimuleerd terwijl er een gevel voor stond.
	 */
	private readonly zoneCuller = new ZoneCuller();
	/** Dezelfde cull voor alles wat de batcher niet overnam. */
	private readonly zoneVisibility: ZoneVisibility;
	/** Uit te zetten, zodat er een A-B-A op één build tegenaan gelegd kan worden. */
	private zoneCullOn = zoneCullOn();
	/** De zone waar de camera in staat, één keer per frame bepaald. */
	private zone: ZoneId = 'stad';
	/**
	 * Grove klokken voor wat in een onzichtbare zone staat. Eén per systeem, want ze
	 * lopen in verschillende zones vol en mogen elkaars achterstand niet erven.
	 */
	private readonly lod = {
		sims: new CoarseTicker(),
		security: new CoarseTicker(),
		protest: new CoarseTicker(),
		penguins: new CoarseTicker(),
		rat: new CoarseTicker(),
		thief: new CoarseTicker(),
		cleaner: new CoarseTicker(),
		monkey: new CoarseTicker(),
		catwalk: new CoarseTicker(),
		roof: new CoarseTicker(),
		city: new CoarseTicker(),
		theatre: new CoarseTicker(),
		con: new CoarseTicker(),
	};
	/** Resolves once the shaders are linked and the frame loop is running. */
	readonly ready: Promise<void>;

	constructor(canvasParent: HTMLElement, uiRoot: HTMLElement) {
		this.daylight.register(this.catwalk.spot, CATWALK_LIGHT_DIM);
		this.colosseumFighters.bindColosseum(this.cityColosseum);
		this.registerCarrier();
		this.renderer = this.createRenderer(canvasParent);
		this.camera = this.createCamera();
		this.monkey = new Monkey(this.world, this.camera);
		this.addSceneObjects();
		this.addWorldColliders();
		this.bindWorldActors();
		const dynamicRoots = [...this.dynamicMallRoots(), ...this.dynamicCityRoots()];
		this.sceneBatcher = new SceneBatcher(this.scene, dynamicRoots);
		this.zoneVisibility = new ZoneVisibility(this.scene, dynamicRoots);
		this.configureBatching();
		this.bindSecurityCallbacks();
		this.director = new Director(this.camera);
		this.composer = createComposer(this.renderer, this.scene, this.camera);
		this.player = new PlayerControls(this.camera, this.renderer.domElement, this.world);
		this.player.enabled = false;
		this.bindPlayerCallbacks();
		this.bindCommerceCallbacks();
		this.ui = this.createKioskUi(uiRoot);
		this.djUi = new DJOverlay(uiRoot);
		this.wireDjBooth();
		this.peopleUi = new PeopleDashboard(uiRoot, (id) => this.enterPossess(id));
		createDjWidget(uiRoot, this.djPlayer, () => this.djUi.show());
		this.gpuTimer = this.setupPerfTools(uiRoot);
		this.bindUiCallbacks();
		this.elevUi = this.createElevatorPanel(uiRoot);
		this.settingsUi = this.createSettingsPanel(uiRoot);
		this.bindSettings();
		this.bindGlobalEvents();
		this.bindAudioUnlock();
		this.bindPersistence();
		this.restoreSessionOrStartIntro();
		if (import.meta.hot) Reflect.set(globalThis, 'mallsim', this);
		this.timer.connect(document);
		this.ready = this.start();
	}

	private registerCarrier(): void {
		this.carrier.register({
			id: 'scrubber-buggy',
			receiver: this.scrubber.receiver,
			position: () => this.scrubber.pos,
			setFloor: (y) => this.scrubber.setFloorOverride(y),
		});
	}

	private createRenderer(canvasParent: HTMLElement): WebGLRenderer {
		const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
		renderer.setSize(globalThis.innerWidth, globalThis.innerHeight);
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = PCFShadowMap;
		renderer.outputColorSpace = SRGBColorSpace;
		renderer.toneMapping = NoToneMapping;
		// Driver log reads are blocking CPU-GPU syncs, useful during development only.
		renderer.debug.checkShaderErrors = !!import.meta.hot;
		renderer.info.autoReset = false;
		setLabelAnisotropy(renderer.capabilities.getMaxAnisotropy());
		canvasParent.appendChild(renderer.domElement);
		return renderer;
	}

	private createCamera(): PerspectiveCamera {
		return new PerspectiveCamera(
			CAMERA_CONFIG.fovDegrees,
			globalThis.innerWidth / globalThis.innerHeight,
			CAMERA_CONFIG.nearPlane,
			WORLD_VIEW_DISTANCE,
		);
	}

	private addSceneObjects(): void {
		this.disco.bindScene(this.scene);
		this.scene.add(this.mall.build());
		this.shopVoice.bindFromMall(this.mall.group);
		this.shopVoice.bindWorld(this.world);
		this.addMallSceneObjects();
		this.addCitySceneObjects();
	}

	private addMallSceneObjects(): void {
		this.scene.add(
			this.palms.group,
			this.walkways.group,
			this.amenities.group,
			this.disco.group,
			this.stock.group,
			this.spaceship.group,
			this.atmosphere.group,
			this.thief.group,
			this.beardCave.group,
			this.protest.group,
			this.travel.group,
			this.rat.group,
			this.cleaner.group,
			this.scrubber.group,
			this.driveCars.group,
			this.motorcycles.group,
			this.security.group,
			this.prayer.group,
			this.penguins.group,
			this.restrooms.group,
			this.helipad.group,
			this.foodCourt.group,
			this.elevator.group,
			this.entrance.group,
			this.mallFacade.group,
		);
	}

	private addCitySceneObjects(): void {
		this.scene.add(
			this.cityBuildings.group,
			this.cityRoads.group,
			this.cityPlaza.group,
			this.cityTraffic.group,
			this.barriers.group,
			this.cityPark.group,
			this.cityRio.group,
			this.cityFavela.group,
			this.cityColosseum.group,
			this.colosseumFighters.group,
			this.colosseumTransport.group,
			this.cityTheatre.group,
			this.furryCon.group,
			this.cityGarage.group,
			this.citySky.group,
			this.cityBirds.group,
			this.roofIsland.group,
			this.poolPeople.group,
			this.parking.group,
			this.citySky.group,
			this.cityRoads.group,
			this.cityTraffic.group,
			this.cityBuildings.group,
			this.cityPark.group,
			this.cityGarage.group,
			this.cityTheatre.group,
			this.cityBirds.group,
		);
		this.world.roofPads.push(this.roofIsland.roofPad);
	}

	private addWorldColliders(): void {
		const roomColliders: RoomCollider[] = [
			...this.restrooms.getColliders(),
			...this.prayer.getColliders(),
			...this.beardCave.getColliders(),
			...this.travel.getColliders(),
		];
		for (const collider of roomColliders) {
			this.world.addBox(collider.minX, collider.maxX, collider.minZ, collider.maxZ, {
				minY: collider.minY ?? COLLIDER_DEFAULTS.roomMinY,
				maxY: collider.maxY ?? COLLIDER_DEFAULTS.roomMaxY,
				label: collider.label,
				tags: collider.blocksSight === false ? [] : [SIGHT_BLOCKING_TAG],
			});
		}
		for (const collider of this.elevator.getColliders()) {
			this.world.addBox(collider.minX, collider.maxX, collider.minZ, collider.maxZ, {
				minY: collider.minY ?? COLLIDER_DEFAULTS.shaftMinY,
				maxY: collider.maxY ?? COLLIDER_DEFAULTS.shaftMaxY,
				label: collider.label,
				climbable: collider.climbable,
			});
		}
	}

	private bindWorldActors(): void {
		this.scene.add(this.pathMesh.group, this.djBartek.group, this.alienProbe.group, this.heli.group, this.drone.group);
		this.scene.add(this.catwalk.group, this.camera, this.monkey.group);
		this.alienProbe.bind(this.atmosphere.americans);
		this.atmosphere.americans.setBeltProvider((x, y, z) => this.walkways.beltVelocityAt(x, y, z));
		this.cityTraffic.setObstacleProvider(() => this.walkerOnRoad());
		this.cityTraffic.setHitHandler((vx, vz, vy) => {
			this.player.launch(vx, vz, vy);
			this.ui.setStatus('🚗💥 AANGEREDEN — de ringweg is geen zebrapad');
		});
		this.catwalk.setAnnounceCallback((name) => {
			this.ui.setStatus(`👗 CATWALK · ${name} komt op · Fashion Week Prairie Lakes`);
		});
		this.monkey.setHitCallback((hit) => this.handleMonkeyHit(hit));
	}

	private handleMonkeyHit(hit: { what: string; yell?: string; x: number; y: number; z: number }): void {
		if (hit.what === 'player') {
			this.score = Math.max(0, this.score - MONKEY_HIT.scorePenalty);
			this.ui.setScore(this.score, this.metSims.size);
			this.ui.setStatus(`🐒💩 ${hit.yell ?? 'AU!!'} — volle treffer in je gezicht (−8)`);
			this.spawnConfetti(new Vector3(hit.x, hit.y + MONKEY_HIT.confettiHeight, hit.z));
		} else if (hit.what === 'sim') {
			this.atmosphere.americans.nudgeAllMood(MONKEY_HIT.moodPenalty);
			this.ui.setStatus('🐒💩 De aap raakte een shopper — publiek is niet blij');
		} else if (hit.what === 'prayer') this.ui.setStatus('🐒💩 Aap gooit kak op de GEBEDSRUIMTE — je stond te ver weg');
	}

	private dynamicMallRoots(): Object3D[] {
		return [
			...this.mall.dynamicRoots,
			this.palms.group,
			this.walkways.group,
			this.amenities.group,
			this.disco.group,
			this.stock.group,
			this.spaceship.group,
			this.atmosphere.group,
			this.thief.group,
			this.beardCave.group,
			this.protest.group,
			this.travel.group,
			this.rat.group,
			this.cleaner.group,
			this.scrubber.group,
			this.driveCars.group,
			this.security.group,
			this.prayer.group,
			this.penguins.group,
			this.elevator.group,
			this.entrance.group,
			this.helipad.group,
		];
	}

	private dynamicCityRoots(): Object3D[] {
		return [
			this.cityBuildings.group,
			this.cityRoads.group,
			this.cityTraffic.group,
			this.barriers.group,
			this.cityPark.group,
			this.cityRio.group,
			this.cityFavela.group,
			this.cityTheatre.group,
			this.furryCon.group,
			this.cityGarage.group,
			this.citySky.group,
			this.cityBirds.group,
			this.roofIsland.group,
			this.poolPeople.group,
			this.pathMesh.group,
			this.djBartek.group,
			this.alienProbe.group,
			this.heli.group,
			this.drone.group,
			this.catwalk.group,
			this.monkey.group,
		];
	}

	private configureBatching(): void {
		for (const owner of this.sceneBatcher.stats.owners) this.zoneCuller.declareOwner(owner.name, owner.sources, owner.casters);
		for (const owner of this.zoneVisibility.stats.owners) {
			this.zoneCuller.declareOwner(owner.name, owner.occupants, owner.casters);
		}
		this.scene.matrixWorldAutoUpdate = false;
		console.info('[Mall] render batching', this.sceneBatcher.stats);
		document.documentElement.dataset['batchSourceMeshes'] = String(this.sceneBatcher.stats.sourceMeshes);
		document.documentElement.dataset['batchDrawCalls'] = String(this.sceneBatcher.stats.drawCalls);
		document.documentElement.dataset['batchMode'] = this.sceneBatcher.stats.mode;
		document.documentElement.dataset[BATCH_DYNAMIC_SOURCES_KEY] = String(this.sceneBatcher.stats.dynamicSources);
		document.documentElement.dataset['batchLargestRadius'] = this.sceneBatcher.stats.largestRadius.toFixed(1);
	}

	private bindSecurityCallbacks(): void {
		this.security.setOpenFireCallback((message) => this.ui.setStatus(message));
		this.security.setSimPanicCallback((origin, radius) => {
			const hit = this.atmosphere.americans.panicFromGunfire(origin, radius);
			if (hit.length === 0) return;
			this.score = Math.max(
				0,
				this.score - Math.min(SECURITY_POLICY.maxPanicPenalty, hit.length * SECURITY_POLICY.penaltyPerTarget),
			);
			this.ui.setScore(this.score, this.metSims.size);
		});
		this.security.setPlayerHitCallback((damage, attacker) => {
			if (this.securityHitCd > 0) return;
			this.securityHitCd = SECURITY_POLICY.hitCooldownSeconds;
			this.score = Math.max(0, this.score - damage);
			this.ui.setScore(this.score, this.metSims.size);
			this.ui.setStatus(`🚔💥 ${attacker} schoot je — "I felt threatened" (−${damage})`);
		});
	}

	private bindPlayerCallbacks(): void {
		this.player.onLockChange = (locked) => {
			this.ui.setLocked(locked);
			if (locked) this.ui.setStatus('Muis gevangen · WASD lopen · Shift rennen · Esc = los');
			else {
				this.unlockedAt = performance.now();
				this.ui.setStatus('Muis los · klik het beeld om weer te kijken');
			}
		};
	}

	private bindCommerceCallbacks(): void {
		this.atmosphere.americans.setTransactionCallback((count, position, storeId) => {
			this.score += CHECKOUT_SCORE;
			this.ui.setScore(this.score, this.metSims.size);
			if (storeId) {
				this.stock.flashSale(storeId);
				observeAsync(this.shopVoice.onCheckout(storeId), 'checkout announcement');
			}
			const owner = storeId === 'kruidvat' ? 'Youssef Benali' : (storeId ?? '?');
			this.ui.setStatus(`Kassa ${owner} · checkout #${count} · muntjes → verkoper 💰`);
			if (count > 0 && count % THIEF_EVENT.transactionInterval === 0 && count !== this.thiefFiredAt) {
				this.thiefFiredAt = count;
				this.thief.trigger();
				this.ui.setStatus(`🧔 BAARD-DIEF pakt juwelen → Beard-man's Cave! (txn ${count})`);
				this.spawnConfetti(position.clone().add(new Vector3(0, 2, 0)));
			}
		});
		this.bindThiefCallbacks();
	}

	private bindThiefCallbacks(): void {
		this.thief.setLootCallback((position) => {
			this.spawnConfetti(position.clone().add(new Vector3(0, THIEF_EVENT.lootHeight, 0)));
			this.score = Math.max(0, this.score - THIEF_EVENT.scorePenalty);
			this.ui.setScore(this.score, this.metSims.size);
		});
		this.thief.setHomeCallback((position) => {
			this.beardCave.pulseLoot();
			this.spawnConfetti(position.clone().add(new Vector3(0, THIEF_EVENT.homeHeight, 0)));
			this.spawnConfetti(this.beardCave.lootCenter.clone().add(new Vector3(0, THIEF_EVENT.caveHeight, 0)));
			this.ui.setStatus('💀 BAARD-DIEF dumpte de juwelen in de cave · goud glimt');
		});
	}

	private createKioskUi(uiRoot: HTMLElement): KioskOverlay {
		return new KioskOverlay(uiRoot, {
			onSelectStore: (store) => this.onSelectStore(store),
			onStartRoute: (store) => this.onStartRoute(store),
			onCancel: () => this.onCancel(),
			onHome: () => this.onHome(),
			onReplay: () => this.onStartRoute(this.currentStore ?? getKruidvat()),
			onPossess: () => this.togglePossess(),
			onDisco: () => this.toggleDisco(),
			onGiveMoney: () => this.giveMoney(),
			onSummonThief: () => {
				this.thief.trigger();
				this.ui.setStatus('🧔 BAARD-DIEF is los (traag) — kijk goed!');
			},
			onMood: (delta) => this.nudgeGuestMood(delta),
		});
	}

	private setupPerfTools(uiRoot: HTMLElement): GpuTimer | null {
		const externalProbe = Reflect.get(globalThis, '__mallPerfProbeActive') === true;
		if (externalProbe) this.bindExternalPerfControl();
		if (feature('NO_PERF_HUD') || externalProbe) return null;
		const context = this.renderer.getContext();
		const webgl2 = context instanceof WebGL2RenderingContext ? context : null;
		observeAsync(
			import('#/ui/PerfOverlay').then(({ PerfOverlay: PerfOverlayClass }) => {
				this.perfHud = new PerfOverlayClass(uiRoot, webgl2);
			}),
			'performance overlay import',
		);
		return webgl2 ? new GpuTimer(webgl2) : null;
	}

	private bindExternalPerfControl(): void {
		Reflect.set(globalThis, '__mallPerfControl', {
			setPose: (...values: unknown[]): boolean => this.setPerfPose(values),
			clearPose: (): void => {
				this.perfPose = null;
			},
			setFrozen: (frozen: unknown): boolean => this.setPerfFrozen(frozen),
			readRaycast: (ndcX: unknown, ndcY: unknown, limit: unknown): PerfRayHit[] => this.readPerfRaycast(ndcX, ndcY, limit),
			readBatchOwners: () => this.sceneBatcher.stats.owners,
			readCpuFrame: (): PerfCpuFrame => this.perfCpuFrame,
			readZoneCull: (): PerfZoneCull => this.readPerfZoneCull(),
		});
	}

	private setPerfPose(values: readonly unknown[]): boolean {
		const [x, y, z, lookX, lookY, lookZ] = values;
		if (
			typeof x !== 'number' ||
			typeof y !== 'number' ||
			typeof z !== 'number' ||
			typeof lookX !== 'number' ||
			typeof lookY !== 'number' ||
			typeof lookZ !== 'number' ||
			!values.every((value) => typeof value === 'number' && Number.isFinite(value))
		)
			return false;
		this.perfPose = { x, y, z, lookX, lookY, lookZ };
		return true;
	}

	private setPerfFrozen(frozen: unknown): boolean {
		if (typeof frozen !== 'boolean') return false;
		if (frozen && !this.perfFrozen) this.perfFrozenElapsed = this.timer.getElapsed();
		this.perfFrozen = frozen;
		return true;
	}

	private readPerfRaycast(ndcX: unknown, ndcY: unknown, limit: unknown): PerfRayHit[] {
		if (typeof ndcX !== 'number' || typeof ndcY !== 'number') return [];
		const wanted = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : 1;
		this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), this.camera);
		const seen = new Set<string>();
		return this.raycaster
			.intersectObjects(this.scene.children, true)
			.filter((hit) => {
				if (seen.has(hit.object.uuid) || !this.objectIsVisible(hit.object)) return false;
				seen.add(hit.object.uuid);
				return true;
			})
			.slice(0, wanted)
			.map((hit) => ({
				owner: ownerName(hit.object),
				name: hit.object.name,
				geometry: hit.object instanceof Mesh ? hit.object.geometry.type : hit.object.type,
				material: hit.object instanceof Mesh && !Array.isArray(hit.object.material) ? hit.object.material.type : '(meerdere)',
				distance: hit.distance,
				x: hit.point.x,
				y: hit.point.y,
				z: hit.point.z,
			}));
	}

	private objectIsVisible(object: Object3D): boolean {
		for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
		return true;
	}

	private readPerfZoneCull(): PerfZoneCull {
		return {
			zone: this.zoneCuller.stats.zone,
			enabled: this.zoneCullOn,
			cones: this.zoneCuller.stats.cones,
			batches: this.sceneBatcher.stats.batchedMeshes,
			batchesHidden: this.zoneCuller.stats.hidden - this.zoneVisibility.stats.hidden,
			occupants: this.zoneVisibility.stats.occupants,
			occupantsHidden: this.zoneVisibility.stats.hidden,
			keptInOwnZone: this.zoneCuller.stats.keptInOwnZone,
			keptThroughCone: this.zoneCuller.stats.keptThroughCone,
			owners: this.zoneCuller.stats.owners,
		};
	}

	private bindUiCallbacks(): void {
		this.cleaner.setYellCallback((label) => this.ui.setStatus(`🧹 WEI CHEN · ${label}`));
		this.elevator.setLineCallback((text) => this.ui.setStatus(`🛗 HANS · ${text}`));
	}

	private createElevatorPanel(uiRoot: HTMLElement): ElevatorPanel {
		return new ElevatorPanel(uiRoot, (id) => {
			if (this.elevator.requestFloor(id)) {
				this.elevUi.hide();
				this.elevator.holdForPassenger(false);
				this.ui.setStatus(`🛗 Hans rijdt naar ${level(id).name.toLowerCase()}`);
			} else this.ui.setStatus('🛗 Hans: je bent er al — kies een andere');
		});
	}

	private createSettingsPanel(uiRoot: HTMLElement): SettingsPanel {
		return new SettingsPanel(uiRoot, (settings) => {
			this.player.applySettings(settings);
			this.ui.setStatus(
				settings.mouseLook
					? `Besturing: muis kijken${settings.lookButton === 2 ? ' (rechtsklik)' : ''}${settings.turnWithKeys ? ' + A/D draaien' : ''}`
					: 'Besturing: geen muis · A/D draaien · R/F kijken',
			);
		});
	}

	private bindSettings(): void {
		this.settingsUi.bindQuality((quality) => this.applyQuality(quality));
		this.settingsUi.bindDynRes((on) => {
			this.dynResOn = on;
			this.resetDynResMeting();
			if (!on && this.dynScale !== 1) {
				this.dynScale = 1;
				this.dynResIndex = 0;
				this.applyPixelRatio();
			}
		});
		this.settingsUi.bindZoneCull((on) => {
			this.zoneCullOn = on;
			if (!on) {
				this.sceneBatcher.showAllZones();
				this.zoneVisibility.showAll();
			}
		});
		this.settingsUi.bindFill((scale) => this.daylight.setFill(scale));
		this.settingsUi.bindBinaural((on) => {
			spatial.setBinaural(on);
			this.ui.setStatus(
				on ? '🎧 Binaural HRTF AAN · draai je hoofd, geluid blijft in de wereld' : '🔊 Binaural UIT · equalpower stereo',
			);
		});
	}

	private applyQuality(quality: 'laag' | 'middel' | 'hoog'): void {
		const dpr = globalThis.devicePixelRatio;
		this.qualityRatio =
			quality === 'laag' ? 1 : Math.min(dpr, quality === 'middel' ? QUALITY_PIXEL_RATIO.medium : QUALITY_PIXEL_RATIO.high);
		this.renderer.shadowMap.enabled = quality !== 'laag';
		this.renderer.shadowMap.needsUpdate = true;
		this.dynScale = 1;
		this.dynResIndex = 0;
		this.resetDynResMeting();
		this.applyPixelRatio();
	}

	private bindGlobalEvents(): void {
		globalThis.addEventListener('resize', () => this.onResize());
		document.addEventListener('visibilitychange', () => {
			this.lastRafTs = null;
		});
		globalThis.addEventListener('keydown', (event) => this.handleKeyEvent(event));
	}

	private bindAudioUnlock(): void {
		const unlock = (): void => {
			this.unlockAudio();
			globalThis.removeEventListener('pointerdown', unlock);
			globalThis.removeEventListener('keydown', unlock);
		};
		globalThis.addEventListener('pointerdown', unlock);
		globalThis.addEventListener('keydown', unlock);
	}

	private unlockAudio(): void {
		this.atmosphere.americans.ensureAudio();
		spatial.ensure();
		this.djPlayer.enableBinauralBooth({ x: this.djBartek.pos.x, y: 1.55, z: this.djBartek.pos.z });
		this.prayer.ensureAudio();
		this.protest.ensureAudio();
		this.cleaner.ensureAudio();
		this.furryCon.unlockAudio();
		observeAsync(this.restoreAudioAfterGesture(), 'audio restoration');
	}

	private async restoreAudioAfterGesture(): Promise<void> {
		const resumed = await this.djPlayer.restoreIfNeeded();
		if (!(resumed || this.djPlayer.playing)) {
			const tracks = await this.djPlayer.refreshPlaylist();
			const music = tracks.filter((track) => !MUSIC_FILE_PATTERN.test(track.file));
			const first = (music.length > 0 ? music : tracks)[0];
			if (first) {
				const index = this.djPlayer.tracks.findIndex((track) => track.file === first.file);
				await this.djPlayer.playIndex(index >= 0 ? index : 0);
			}
		}
		if (!this.restoredFromSave) this.ui.setStatus('♪ Muziek AAN · DJ-booth + gebedsruimte Trapbar · koptelefoon = binaural');
	}

	private bindPersistence(): void {
		globalThis.addEventListener('pagehide', () => this.persistNow());
		globalThis.addEventListener('beforeunload', () => this.persistNow());
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') this.persistNow();
		});
	}

	private restoreSessionOrStartIntro(): void {
		const saved = loadGame();
		if (saved?.freeMove) {
			this.restoreGame(saved);
			return;
		}
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

	private handleKeyEvent(event: Event): void {
		if (!(event instanceof KeyboardEvent)) return;
		const key = event.key.toLowerCase();
		if (this.djUi.isOpen() && key !== 'escape' && key !== 'e') return;
		switch (key) {
			case 'k':
				this.onStartRoute(getKruidvat());
				break;
			case 'escape':
				this.handleEscape();
				break;
			case 'f':
				this.toggleConFilm();
				break;
			case 'h':
				this.onHome();
				break;
			case 'v':
				this.togglePossess();
				break;
			case 'p':
				this.toggleDisco();
				break;
			case 'g':
				this.giveMoney();
				break;
			case 't':
				this.thief.trigger();
				this.ui.setStatus('🧔 BAARD-DIEF (T) — juwelen heist!');
				break;
			case 'j':
				this.ui.setStatus(
					this.monkey.provoke() ? '🐒 De aap pakt een handvol kak… duiken!' : '🐒 De aap heeft even niks bij de hand',
				);
				break;
			case 'e':
				this.handleInteraction();
				break;
			case 'b':
				this.togglePeopleDashboard();
				break;
			default:
				break;
		}
	}

	private handleEscape(): void {
		if (this.furryCon.tryLeaveScene()) this.ui.setStatus('Left con activity');
		else if (this.djUi.isOpen()) this.djUi.hide();
		else if (this.elevUi.isOpen) this.elevUi.hide();
		else if (this.peopleUi.isOpen) this.peopleUi.toggle(false);
		else if (mutableFlag(this.player.locked) || performance.now() - this.unlockedAt < PLAYER_TIMING.unlockGraceMs) {
			this.player.releaseLook();
		} else if (this.possessId === null) this.onCancel();
		else this.togglePossess(false);
	}

	private toggleConFilm(): void {
		if (this.furryCon.toggleFilm(this.camera.position)) this.ui.setStatus('Studio film mode');
	}

	private handleInteraction(): void {
		if (this.tryWorldInteraction()) return;
		const lift = this.elevatorAction();
		const panelWins = lift?.kind === 'menu' && !this.elevUi.isOpen;
		if (!panelWins && (mutableFlag(this.player.flying) || this.vehicle === 'scrubber' || this.vehicle === 'car')) {
			this.exitVehicle();
			return;
		}
		if (!panelWins && this.vehicle === 'chariot') {
			this.exitChariot();
			return;
		}
		if (this.tryOpenElevatorMenu(lift) || this.tryBoardNearbyVehicle()) return;
		if (this.djBartek.inRange(this.camera.position)) observeAsync(this.openDjBooth(), 'opening DJ booth');
		else observeAsync(this.talkToShopkeeper(), 'shopkeeper conversation');
	}

	private tryWorldInteraction(): boolean {
		const interaction = this.furryCon.tryInteract(this.camera.position) ?? this.cityFavela.tryInteract(this.camera.position);
		if (!interaction) return false;
		if (interaction.scoreDelta !== 0) {
			this.score = Math.max(0, this.score + interaction.scoreDelta);
			this.ui.setScore(this.score, this.metSims.size);
		}
		this.ui.setStatus(interaction.status);
		return true;
	}

	private tryBoardNearbyVehicle(): boolean {
		if (this.possessId || !this.freeMove) return false;
		const position = this.camera.position;
		if (this.driveCars.nearestCar(position, INTERACTION_RANGE.car)) this.boardCar();
		else if (this.scrubber.distanceTo(position) < INTERACTION_RANGE.scrubber && levelAt(position.y) === 'v0')
			this.boardScrubber();
		else if (this.drone.distanceTo(position) < INTERACTION_RANGE.drone) this.boardDrone();
		else if (this.heli.boardable && this.heli.distanceTo(position) < INTERACTION_RANGE.helicopter) this.boardHeli();
		else if (this.colosseumTransport.isBoardable(position)) this.boardChariot();
		else return false;
		return true;
	}

	private togglePeopleDashboard(): void {
		this.peopleUi.toggle();
		if (!this.peopleUi.isOpen) {
			this.ui.setStatus('Dashboard dicht');
			return;
		}
		this.atmosphere.americans.getPeopleSnapshot(this.camera.position, this.peopleRows);
		this.peopleUi.update(this.peopleRows, this.buildCastRows());
		this.ui.setStatus('📋 Bewoners-dashboard · B sluiten · 👁 = guest view');
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
	 * to decide which program a material got, and the alien probe (one light, on
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
		const hidden: Object3D[] = [];
		this.scene.traverse((object) => {
			if (!object.visible) {
				hidden.push(object);
				object.visible = true;
			}
		});
		try {
			await this.compileUntil(deadline);
			this.primeProgramInterfaces();
		} finally {
			for (const object of hidden) object.visible = false;
		}

		// compileAsync covers scene materials. The composer owns its own fullscreen
		// programs, so submit one real frame while the loading screen still covers it.
		this.camera.updateWorldMatrix(true, false);
		this.sceneBatcher.update();
		this.pool.update(this.camera);
		this.composer.render(0);
		this.primeProgramInterfaces();
		document.documentElement.dataset['warmupPrograms'] = String(this.renderer.info.programs?.length ?? 0);
	}

	/**
	 * compileAsync waits for linking, but WebGLProgram's uniform table remains
	 * lazy. Asking for it here moves ACTIVE_UNIFORMS and ACTIVE_ATTRIBUTES driver
	 * synchronization behind the loader instead of the first crowded frame.
	 */
	private primeProgramInterfaces(): void {
		for (const program of this.renderer.info.programs ?? []) program.getUniforms();
	}

	/** Compile the scene as it stands, giving up once `deadline` passes. */
	private async compileUntil(deadline: number): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.renderer.compileAsync(this.scene, this.camera),
				new Promise<void>((resolve) => {
					timer = globalThis.setTimeout(resolve, Math.max(0, deadline - performance.now()));
				}),
			]);
		} finally {
			if (timer !== undefined) globalThis.clearTimeout(timer);
		}
	}

	/** Snapshot player + progress into sessionStorage */
	private persistNow(): void {
		if (!(this.freeMove || this.restoredFromSave)) return;
		const e = new Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
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
			ride: this.rideSnapshot(),
			parkedVehicle: this.lastParkedVehicle,
		});
	}

	/**
	 * De rit die loopt, klaar om na een herbouw teruggezet te worden.
	 *
	 * Een edit tijdens het rijden bouwt de wereld opnieuw op; zonder dit stond je
	 * daarna te voet naast een auto die je zojuist bestuurde, met de instapstand
	 * nog op het exemplaar dat weg was.
	 */
	private rideSnapshot(): PersistedRide | null {
		const car = this.vehicle === 'car' ? this.driveCars.ride : null;
		if (car) return { ...car, kind: 'car' };
		const scrubber = this.vehicle === 'scrubber' ? this.scrubber.ride : null;
		return scrubber === null ? null : { ...scrubber, kind: 'scrubber' };
	}

	/** Weer instappen in wat er reed toen de pagina omviel. */
	private resumeRide(ride: PersistedRide): void {
		const terug = ride.kind === 'car' ? this.driveCars.resume(ride) : this.scrubber.resume(ride);
		if (!terug) return;
		this.vehicle = ride.kind;
		this.player.releaseLook();
		this.player.flying = false;
		this.player.driving = true;
		const seat = ride.kind === 'car' ? this.driveCars.getSeatPosition() : this.scrubber.getSeatPosition();
		this.camera.position.copy(seat);
		this.player.setHeading(ride.yaw);
		this.player.syncFromCamera();
		this.player.driving = true;
		this.player.setHeading(ride.yaw);
	}

	/** Herstel alleen de transform van een uitgestapt voertuig; de speler blijft lopen. */
	private restoreParkedVehicle(parked: PersistedRide): void {
		const restored = parked.kind === 'car' ? this.driveCars.restoreParked(parked) : this.scrubber.restoreParked(parked);
		if (restored) this.lastParkedVehicle = { ...parked, speed: 0 };
	}

	private restoreGame(saved: NonNullable<ReturnType<typeof loadGame>>): void {
		this.restoredFromSave = true;
		this.score = saved.score;
		this.metSims = new Set(saved.metSims);
		this.thiefFiredAt = saved.thiefFiredAt;
		this.freeMove = true;

		if (saved.storeId) {
			const store = getStore(saved.storeId);
			if (store) {
				this.currentStore = store;
				if (saved.path.length > 0) {
					this.currentPath = saved.path.map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z }));
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
		// De opgeslagen stand is die van de vorige wereld, en een rit die niet terugkomt
		// laat je in het voertuig staan waar je op zat. Klem is klem: elke stap wordt dan
		// teruggeduwd, wat de rit-soort ook was.
		this.player.unstick();
		if (saved.parkedVehicle) this.restoreParkedVehicle(saved.parkedVehicle);

		// Ná syncFromCamera: die zet de speler op de grond onder de camera, en dat is
		// precies wat een zittende bestuurder niet is.
		if (saved.ride) this.resumeRide(saved.ride);

		// Toggle on if it was on (toggle flips from false → true)
		if (saved.disco && !mutableFlag(this.disco.active)) {
			this.disco.toggle();
			this.atmosphere.americans.setDancing(true);
		}

		// Yellow route tape stays if we had a path; no need to re-enter touring mode
	}

	/** Dev helper: drop the player somewhere and re-seat the controller. */
	teleport(x: number, y: number, z: number, yaw = 0): void {
		this.camera.position.set(x, y, z);
		this.camera.rotation.order = 'YXZ';
		this.camera.rotation.set(0, yaw, 0);
		this.player.syncFromCamera();
		this.player.unstick();
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
		return [...this.buildCharacterRows(), ...this.buildVehicleRows(), ...this.buildSecurityRows()];
	}

	private catwalkStatus(): string {
		const stage = this.catwalk.nowOnStage;
		if (!stage) return 'wacht op de volgende show';
		if (stage.phase !== 'pose') return 'werkt de runway';
		return mutableFlag(this.catwalk.partyMode) ? 'poseert voor de fotografen' : 'poseert + Aperol-spray 🍹';
	}

	private buildCharacterRows(): CastRow[] {
		const stage = this.catwalk.nowOnStage;
		return [
			{
				icon: '👗',
				name: stage ? stage.name : 'Catwalk',
				doing: this.catwalkStatus(),
				floor: 'V0 · west',
			},
			{
				icon: '🧔',
				name: 'Baard-dief',
				doing: mutableFlag(this.thief.active) ? 'JUWELEN HEIST — onderweg!' : 'ligt op de loer',
				floor: mutableFlag(this.thief.active) ? 'in de mall' : 'grot',
			},
			{
				icon: '🐒',
				name: 'De aap',
				doing: 'zit in de atrium-palmen · J = uitdagen',
				floor: level(levelAt(this.monkey.group.position.y)).code,
			},
			{
				icon: '🎧',
				name: 'DJ Bartek',
				doing: this.djPlayer.playing ? 'draait — booth E = verzoekjes' : 'staat stil achter de decks',
				floor: 'trap-gat',
			},
		];
	}

	private buildVehicleRows(): CastRow[] {
		return [
			{
				icon: '🛸',
				name: 'UFO',
				doing: 'hangt boven de weide',
				floor: 'atrium',
			},
			{
				icon: '🚁',
				name: 'PRAIRIE 1',
				doing: this.heli.statusLine,
				floor: 'dak',
			},
			{
				icon: '🚕',
				name: 'Passagiersdrone',
				doing: this.drone.statusLine,
				floor: mutableFlag(this.player.flying) ? 'lucht' : 'V0',
			},
			{
				icon: '🧽',
				name: 'Schoonmaak buggy #88',
				doing: this.scrubber.statusLine,
				floor: 'V0 · bij fontein/noord',
			},
			{
				icon: this.driveCars.activeKind === 'motorcycle' ? '🏍️' : '🚗',
				name: this.driveCars.activeName === '—' ? 'Huurvoertuigen (P1)' : this.driveCars.activeName,
				doing: this.driveCars.statusLine,
				floor: mutableFlag(this.driveCars.ridden)
					? levelAt(this.camera.position.y) === 'p1'
						? `${level('p1').code} garage`
						: 'stad'
					: 'P1 · west exit → ring',
			},
			{
				icon: '🐧',
				name: `Pinguïns (${this.penguins.count})`,
				doing: 'waddlen door de mall · noot noot',
				floor: 'V0 · atrium / food court',
			},
		];
	}

	private buildSecurityRows(): CastRow[] {
		return this.security.roster.map((guard) => ({
			icon: '🚔',
			name: guard.name,
			doing: `${guard.state} · ${guard.kills}× "felt threatened"`,
			floor: guard.floor,
		}));
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
		this.camera.position.set(this.drone.parkPos.x, this.drone.parkPos.y + DRONE_POSITION.seatHeight, this.drone.parkPos.z);
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
		const slot = this.driveCars.nearestCar(this.camera.position, INTERACTION_RANGE.car);
		if (!(slot && this.driveCars.board(slot))) return;
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
		const icoon = this.driveCars.activeKind === 'motorcycle' ? '🏍️' : '🚗';
		this.ui.setStatus(`${icoon} ${this.driveCars.activeName} · WASD rijden · Shift = turbo · E = uit · west-exit → STAD`);
	}

	private boardChariot(): void {
		if (!this.colosseumTransport.board(this.camera.position)) return;
		this.player.releaseLook();
		this.vehicle = 'chariot';
		this.player.driving = true;
		this.player.flying = false;
		this.colosseumTransport.seatPosition(this.chariotSeat);
		this.camera.position.copy(this.chariotSeat);
		this.player.syncFromCamera();
		this.player.driving = true;
		const destination = this.colosseumTransport.destination === 'mall' ? 'de mall' : 'het Colosseum';
		this.ui.setStatus(`🏛️ COLOSSEUM EXPRESS · taxi naar ${destination} · uitstappen bij aankomst met E`);
	}

	private exitChariot(): void {
		const exit = this.colosseumTransport.release(this.chariotExit);
		if (!exit) {
			this.ui.setStatus('🏛️ COLOSSEUM EXPRESS · uitstappen kan bij de volgende halte');
			return;
		}
		this.vehicle = null;
		this.player.driving = false;
		this.camera.position.set(exit.x, exit.y + EYE, exit.z);
		this.player.syncFromCamera();
		const stop = this.colosseumTransport.currentStop === 'mall' ? 'Mall Entrance' : 'Mega Colosseum';
		this.ui.setStatus(`🏛️ ${stop} · uitgestapt · E bij de chariot voor de terugrit`);
	}

	/** Wie in de mond van de buis stapt gaat mee: WHEEE — de bocht in, het bad uit. */
	private startSlide(): void {
		this.slideDistance = 0;
		this.freeMove = false;
		this.player.enabled = false;
		this.player.releaseLook();
		this.ui.setStatus('🛝 WHEEEEE — glijmiddel werkt!');
	}

	/** Per frame tijdens de glij-rit: de buis draagt je op zijn eigen vaart. */
	private tickSlide(dt: number): void {
		if (this.slideDistance < 0) return;
		const ride = this.roofIsland.ride;
		this.slideDistance += ride.speed * dt;
		ride.seatAt(this.slideDistance, this.slideSeat);
		ride.aheadOf(this.slideDistance, this.slideLook);
		this.camera.position.copy(this.slideSeat);
		this.camera.up.set(0, 1, 0);
		this.camera.lookAt(this.slideLook);

		if (this.slideDistance >= ride.length) {
			this.slideDistance = -1;
			// PLONS in het diepe
			ride.seatAt(ride.length, this.slideSeat);
			this.spawnConfetti(this.slideSeat);
			this.ui.setStatus('💦 PLONS! · klim de ladder op voor nog een rondje');
			this.freeMove = true;
			this.player.enabled = true;
			this.player.syncFromCamera();
		}
	}

	/** E tijdens de vlucht/rit: uitstappen. */
	private exitVehicle(): void {
		const vehicle = this.vehicle;
		this.vehicle = null;
		this.player.flying = false;
		this.player.driving = false;
		this.player.flightProfile = 'drone';
		if (vehicle === 'car') this.exitCar();
		else if (vehicle === 'scrubber') this.exitScrubber();
		else if (vehicle === 'heli') {
			const released = this.heli.release();
			this.player.syncFromCamera();
			this.ui.setStatus(
				released === 'parked-here'
					? '🚁 Uitgestapt — PRAIRIE 1 blijft hier geparkeerd'
					: '🚁 Uitgestapt — PRAIRIE 1 vliegt zelf terug naar het pad',
			);
		} else this.exitDrone();
	}

	private exitCar(): void {
		const parked = this.driveCars.ride;
		const exit = this.driveCars.release();
		if (parked) this.lastParkedVehicle = { ...parked, kind: 'car', speed: 0 };
		this.camera.position.set(exit.x, exit.y + EYE, exit.z);
		this.player.syncFromCamera();
		this.ui.setStatus(
			`🚗 Uitgestapt · ${this.driveCars.activeName === '—' ? 'voertuig geparkeerd' : 'voertuig blijft hier'} · E om weer in te stappen`,
		);
	}

	private exitScrubber(): void {
		// Query from the vehicle height so leaving inside the elevator cannot snap to V0.
		const parked = this.scrubber.ride;
		const exit = this.scrubber.release();
		if (parked) this.lastParkedVehicle = { ...parked, kind: 'scrubber', speed: 0 };
		this.camera.position.set(exit.x, exit.y + EYE, exit.z);
		this.player.syncFromCamera();
		this.ui.setStatus('🧽 Uitgestapt — buggy blijft staan voor de volgende racer');
	}

	private exitDrone(): void {
		const p = this.camera.position;
		const ground =
			Math.abs(p.x) < half(MALL_SHELL.width) && Math.abs(p.z) < half(MALL_SHELL.depth)
				? this.world.groundHeightAt(
						p.x,
						p.z,
						Math.max(0, p.y - DRONE_POSITION.groundProbeOffset),
						DRONE_POSITION.groundProbeRange,
					)
				: 0;
		this.drone.parkAt(new Vector3(p.x, ground, p.z));
		// speler stapt er net naast uit
		p.x += DRONE_POSITION.exitOffset;
		p.y = ground + EYE;
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
		const got = this.atmosphere.americans.giveMoneyNear(this.camera.position, MONEY_GIFT.amount);
		if (!got) {
			this.ui.setStatus('Niemand dichtbij — loop dichter bij een sim');
			return;
		}
		this.score += MONEY_GIFT.score;
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
		this.djUi.onRequest = (query) => observeAsync(this.djRequest(query), 'DJ request');
		this.djUi.onPlay = () => observeAsync(this.djPlayer.play(), 'DJ playback');
		this.djUi.onPause = () => this.djPlayer.pause();
		this.djUi.onNext = () => this.djPlayer.next();
		this.djUi.onProbe = () => {
			this.alienProbe.trigger();
			observeAsync(this.bartekSpeak(BARTEK_LINES.probe), 'alien probe announcement');
			this.djUi.setStatus('👽 Aliens scannen de dikke Amerikanen…');
			this.ui.setStatus('👽 PROBE WAVE — dikke gasten in de beam');
			this.atmosphere.americans.cheerNear(this.djBartek.pos, DJ_AUDIO.probeCheerRadius);
		};
		this.djUi.onGreet = () => observeAsync(this.bartekSpeak(BARTEK_LINES.greet), 'DJ greeting');
		this.djUi.onRat = () => {
			this.rat.trigger();
			this.ui.setStatus('🐀 Mall-rat is los — kijk bij de loopbanden');
			observeAsync(this.bartekSpeak('Die rat is VIP hier. Trap-gat mascotte!'), 'rat announcement');
		};
		this.djUi.onMicStart = () => {
			spatial.ensure();
			this.atmosphere.americans.ensureAudio();
			this.bartekChat.startListening();
		};
		this.djUi.onMicEnd = () => this.bartekChat.stopListening();
		this.bartekChat.onUpdate = (lines, status) => {
			this.djUi.setChat(lines, status);
			const last = lines.at(-1);
			if (last?.who === 'bartek') this.djBartek.say(last.text, DJ_AUDIO.chatBubbleSeconds);
		};
		this.djUi.onClose = () => {
			this.bartekChat.stopListening();
			this.player.enabled = this.freeMove && this.possessId === null;
		};
		// Play track by index from list click
		// CustomEvent detail isn't in the DOM listener signature; narrow on arrival
		document.getElementById('dj-overlay')?.addEventListener('dj-play-index', (e) => {
			if (!('detail' in e)) return;
			const index = e.detail;
			if (typeof index === 'number') observeAsync(this.djPlayer.playIndex(index), 'DJ track selection');
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
		this.player.releaseLook();
		this.player.enabled = false;
		this.djUi.show();
		const tracks = await this.djPlayer.refreshPlaylist();
		// Music library only: skip short voice intros in the list UI if named
		this.djUi.setTracks(tracks.filter((track) => !MUSIC_FILE_PATTERN.test(track.file)));
		const st = await fetchDjStatus();
		this.djUi.setStatus(
			st.elevenlabs
				? `ElevenLabs ON · ${tracks.length} files · live drama mode`
				: `Browser-stem · ${tracks.length} files · zet ELEVENLABS_API_KEY`,
		);
		if (mutableFlag(this.djBartek.greetingDone)) {
			await this.bartekSpeak(pick(BARTEK_LINES.idle));
		} else {
			this.djBartek.greetingDone = true;
			// Pre-baked intro first (instant), then full ElevenLabs greets
			this.djBartek.say(BARTEK_LINES.greet, DJ_AUDIO.introBubbleSeconds);
			const baked = await playBoothFile('bartek_intro_voice.mp3');
			if (baked.source === 'silent' || (baked.durationMs ?? 0) < DJ_AUDIO.minimumBakedIntroMs) {
				await this.bartekSpeak(BARTEK_LINES.greet);
			} else {
				this.djUi.setStatus('🎤 Bartek intro (ElevenLabs) — BARTEK BARTEK');
				// Full longer line after baked clip
				await this.bartekSpeak('Welkom bij het trap-gat. Request een plaatje en ik draai hem live. Drama gratis erbij.');
			}
			if (!st.elevenlabs) {
				await this.bartekSpeak(BARTEK_LINES.noKey);
			}
		}
		// Prefer real music; resume after HMR/reload if we had a track
		const firstMusic = tracks.find((track) => !MUSIC_FILE_PATTERN.test(track.file));
		const resumed = await this.djPlayer.restoreIfNeeded();
		if (!resumed && firstMusic && !this.djPlayer.playing) {
			const idx = tracks.findIndex((t) => t.file === firstMusic.file);
			if (idx >= 0) observeAsync(this.djPlayer.playIndex(idx), 'restored DJ playback');
		}
		// Crowd reacts to the booth opening
		this.atmosphere.americans.cheerNear(this.djBartek.pos, DJ_AUDIO.boothCheerRadius);
	}

	private async bartekSpeak(text: string): Promise<void> {
		if (this.bartekSpeaking) return;
		this.bartekSpeaking = true;
		this.atmosphere.americans.ensureAudio();
		spatial.ensure();
		this.djBartek.say(
			text,
			Math.min(DJ_AUDIO.maxBubbleSeconds, DJ_AUDIO.baseBubbleSeconds + text.length * DJ_AUDIO.secondsPerCharacter),
		);
		// Charlie voice — energetic DJ (not flat Adam)
		const r = await speakLine(text, {
			voiceId: BARTEK_VOICE_ID,
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
		const wait = Math.min(DJ_AUDIO.maxSpeechWaitMs, r.durationMs ?? text.length * DJ_AUDIO.fallbackMsPerCharacter);
		await new Promise((res) => setTimeout(res, Math.max(DJ_AUDIO.minimumSpeechWaitMs, wait * DJ_AUDIO.speechWaitFactor)));
		this.bartekSpeaking = false;
	}

	/** Ambient mall drama: Bartek monologues + crowd squeaks */
	private tickBartekDrama(dt: number): void {
		this.crowdCheerCd -= dt;
		const near = this.djBartek.inRange(this.camera.position);
		const music = this.djPlayer.playing;

		// When music is on, crowd near the trap occasionally cheers
		if (music && this.crowdCheerCd <= 0) {
			this.crowdCheerCd = DJ_AUDIO.cheerCooldownBase + Math.random() * DJ_AUDIO.cheerCooldownJitter;
			this.atmosphere.americans.cheerNear(this.djBartek.pos, DJ_AUDIO.ambientCheerRadius);
		}

		// Bartek ambient drama (even if booth UI closed) when player is in the wing
		const dx = this.camera.position.x - this.djBartek.pos.x;
		const dz = this.camera.position.z - this.djBartek.pos.z;
		const dist = Math.hypot(dx, dz);
		if (
			dist < DJ_AUDIO.dramaRange &&
			levelAt(this.camera.position.y) === 'v0' &&
			this.djBartek.dramaCd <= 0 &&
			!this.bartekSpeaking &&
			!this.djUi.isOpen()
		) {
			this.djBartek.dramaCd = DJ_AUDIO.dramaCooldownBase + Math.random() * DJ_AUDIO.dramaCooldownJitter;
			observeAsync(this.bartekSpeak(pick(BARTEK_LINES.drama)), 'ambient DJ monologue');
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
		this.djUi.setTracks(tracks.filter((track) => !MUSIC_FILE_PATTERN.test(track.file)));
		if (res.ok) {
			await this.bartekSpeak(BARTEK_LINES.requestOk(query));
			this.djUi.setStatus(res.message);
			this.score += DJ_AUDIO.requestScore;
			this.ui.setScore(this.score, this.metSims.size);
			this.atmosphere.americans.cheerNear(this.djBartek.pos, DJ_AUDIO.requestCheerRadius);
			// Brief dance flash for the crowd
			this.atmosphere.americans.setDancing(true);
			globalThis.setTimeout(() => this.atmosphere.americans.setDancing(false), DJ_AUDIO.danceFlashMs);
		} else {
			await this.bartekSpeak(BARTEK_LINES.requestFail);
			this.djUi.setStatus(res.message);
		}
	}

	private onSelectStore(store: StoreDef): void {
		this.currentStore = store;
		const pos = new Vector3(store.x, this.storeY(store), store.z);
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
		return levelY(store.level) + ROUTE_VISUAL.storeEyeHeight;
	}

	private onArrive(store: StoreDef): void {
		const underShip = store.nodeId === 'spaceship' || store.id === 'kruidvat';
		this.score += underShip ? ROUTE_REWARD.featured : ROUTE_REWARD.standard;
		this.ui.setScore(this.score, this.metSims.size);
		// Back to free walk, facing whatever you came for
		this.freeMove = true;
		this.player.enabled = true;
		this.player.syncFromCamera();

		if (underShip) {
			const stand = this.spaceship.getUnderStandPoint();
			this.ui.showArrive(store);
			this.spawnConfetti(stand.clone().add(new Vector3(0, ROUTE_VISUAL.featuredConfettiHeight, 0)));
			this.player.lookAtPoint(this.spaceship.getShipLookPoint());
			this.ui.setStatus(`+100 · Kruidvat · Youssef praat · score ${this.score}`);
			// Youssef finally speaks when the route lands
			this.atmosphere.americans.ensureAudio();
			observeAsync(
				this.shopVoice.speak(
					'kruidvat',
					'Marhaba! Je bent er. Welkom bij Kruidvat — ik ben Youssef Benali. Vitamines? Shampoo voor mama? Yallah, de kassa is open.',
					{ force: true, minGapMs: 0 },
				),
				'Kruidvat arrival greeting',
			);
		} else {
			this.ui.showArrive(store);
			this.spawnConfetti(new Vector3(store.x, this.storeY(store) + ROUTE_VISUAL.standardConfettiHeight, store.z));
			this.player.lookAtPoint(new Vector3(store.x, this.storeY(store), store.z));
			this.ui.setStatus(`+50 · ${store.name.replace('\n', ' ')} OPEN · score ${this.score}`);
			// Any named owner greets on arrival
			observeAsync(this.shopVoice.speak(store.id, undefined, { force: true, minGapMs: 0 }), 'store arrival greeting');
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
		return steps.slice(0, ROUTE_VISUAL.maxSteps);
	}

	private spawnConfetti(origin: Vector3): void {
		this.clearConfetti();
		const positions = new Float32Array(CONFETTI.count * CONFETTI.itemSize);
		const colors = new Float32Array(CONFETTI.count * CONFETTI.itemSize);
		this.confettiVel = new Float32Array(CONFETTI.count * CONFETTI.itemSize);

		for (let i = 0; i < CONFETTI.count; i++) {
			const offset = i * CONFETTI.itemSize;
			positions[offset] = origin.x;
			positions[offset + 1] = origin.y;
			positions[offset + 2] = origin.z;
			const c = at(CONFETTI_PALETTE, i);
			colors[offset] = c.r;
			colors[offset + 1] = c.g;
			colors[offset + 2] = c.b;
			this.confettiVel[offset] = jitter(CONFETTI.spread);
			this.confettiVel[offset + 1] = Math.random() * CONFETTI.verticalSpread + 1;
			this.confettiVel[offset + 2] = jitter(CONFETTI.spread);
		}

		const geo = new BufferGeometry();
		geo.setAttribute('position', new BufferAttribute(positions, CONFETTI.itemSize));
		geo.setAttribute('color', new BufferAttribute(colors, CONFETTI.itemSize));
		const mat = new PointsMaterial({
			size: CONFETTI.pointSize,
			vertexColors: true,
			transparent: true,
			opacity: CONFETTI.opacity,
			depthWrite: false,
		});
		this.confetti = new Points(geo, mat);
		this.scene.add(this.confetti);
		setTimeout(() => this.clearConfetti(), CONFETTI.lifetimeMs);
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
		if (!(this.confetti && this.confettiVel)) return;
		const pos = this.confetti.geometry.getAttribute('position');
		const arr = pos.array;
		const vel = this.confettiVel;
		for (let i = 0; i + 2 < arr.length; i += CONFETTI.itemSize) {
			arr[i] = (arr[i] ?? 0) + (vel[i] ?? 0) * dt;
			arr[i + 1] = (arr[i + 1] ?? 0) + (vel[i + 1] ?? 0) * dt;
			arr[i + 2] = (arr[i + 2] ?? 0) + (vel[i + 2] ?? 0) * dt;
			vel[i + 1] = (vel[i + 1] ?? 0) - CONFETTI_GRAVITY * dt;
		}
		pos.needsUpdate = true;
	}

	private onResize(): void {
		const w = globalThis.innerWidth;
		const h = globalThis.innerHeight;
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
	 * hij op de rand, en elke wissel kost een target-heralloc in de composer.
	 */
	private updateDynRes(frameMs: number): void {
		if (!this.dynResOn || frameMs <= 0) return;
		// Tijd loopt hier in échte seconden (gekapt op de spike-grens), niet in het
		// geklemde dt: bij 200ms-frames telde elke tik 0,05 s en duurde de
		// beloofde halve seconde reactietijd in werkelijkheid twee seconden.
		const sampleMs = Math.min(frameMs, FRAME_MS_SPIKE);
		const sampleSec = sampleMs / PLAYER_TIMING.millisecondsPerSecond;
		if (frameMs >= DYN_RES_VSYNC_FLOOR_MS && frameMs < this.vsyncMs) this.vsyncMs = frameMs;
		this.frameMsEma = this.frameMsEma === 0 ? sampleMs : this.frameMsEma * DYN_RES_EMA_OLD + sampleMs * DYN_RES_EMA_NEW;
		if (this.dynResCooldown > 0) {
			this.dynResCooldown -= sampleSec;
			return;
		}
		const dir = this.dynResDirection();
		if (dir !== this.dynResDir) {
			this.dynResDir = dir;
			this.dynResHold = 0;
		}
		if (dir === 0) return;
		this.dynResHold += sampleSec;
		// Omlaag snel (0.5 s aanhoudend traag), omhoog traag (2 s ruim comfort)
		if (dir === 1 && this.dynResHold >= DYN_RES_HOLD_DOWN_S) this.stepDynRes(this.dynResIndex + 1);
		else if (dir === -1 && this.dynResHold >= DYN_RES_HOLD_UP_S) this.stepDynRes(this.dynResIndex - 1);
	}

	private dynResDirection(): -1 | 0 | 1 {
		if (this.frameMsEma > DYN_RES_SLOW_MS && this.dynResIndex < DYN_RES_STEPS.length - 1) return 1;
		if (this.frameMsEma < this.vsyncMs * DYN_RES_UP_FACTOR && this.dynResIndex > 0) return -1;
		return 0;
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
		// Verse meting na de wissel, want oude samples stappen meteen dóór
		this.resetDynResMeting();
		this.dynResCooldown = DYN_RES_COOLDOWN_S;
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
		if (!(this.freeMove && this.player.enabled) || this.possessId !== null || mutableFlag(this.player.flying)) {
			this.leaveElevatorRide();
			return;
		}
		const inXz = this.elevator.contains(this.camera.position.x, this.camera.position.z, ELEVATOR_RANGE.carrierMargin);
		const cabinY = this.elevator.cabinFloorY;
		const dy = Math.abs(this.player.feetHeight - cabinY);

		if (this.elevRiding) {
			this.continueElevatorRide(inXz, cabinY);
			return;
		}

		// Board silently — no popup, no focus steal
		if (inXz && dy < ELEVATOR_RANGE.boardHeight) {
			this.elevRiding = true;
			this.player.setElevatorRide(cabinY);
			this.elevator.holdForPassenger(true);
			this.ui.setStatus('🛗 In de lift · kijk Hans/paneel · E = kies verdieping');
		} else {
			this.player.setElevatorRide(null);
			if (this.elevUi.isOpen) this.elevUi.hide();
		}
	}

	private continueElevatorRide(inCabin: boolean, cabinY: number): void {
		if (!inCabin) {
			this.leaveElevatorRide();
			return;
		}
		this.player.setElevatorRide(cabinY);
		if (!this.elevator.isMoving) this.elevator.holdForPassenger(true);
		if (this.elevator.isMoving && this.elevUi.isOpen) this.elevUi.hide();
	}

	private leaveElevatorRide(): void {
		this.elevRiding = false;
		this.player.setElevatorRide(null);
		this.elevUi.hide();
		this.elevator.holdForPassenger(false);
	}

	/**
	 * Wat E bij de lift zou doen, zonder het te doen. Ook `hasEInteraction` vraagt
	 * het hier, zodat de knop-check en de actie niet uit elkaar kunnen lopen.
	 */
	private elevatorAction(): ElevatorAction | null {
		if (!this.freeMove || this.possessId !== null || mutableFlag(this.player.flying)) return null;
		const hit = this.elevator.getLookHit(this.camera, 10);
		const inCab = this.elevator.contains(this.camera.position.x, this.camera.position.z, ELEVATOR_RANGE.cabinMargin);
		const distanceXz = Math.hypot(this.camera.position.x - this.elevator.pos.x, this.camera.position.z - this.elevator.pos.z);
		const here = levelAt(this.player.feetHeight);
		// Dak has a second call pedestal ~12 m toward the helipad — wider radius
		const nearShaft = distanceXz < (here === 'roof' ? ELEVATOR_RANGE.roofCall : ELEVATOR_RANGE.landingCall);

		// Op de schoonmaakkar in de cabine ligt de blik vast aan de rijkoers, dus Hans of
		// het paneel aankijken lukt niet altijd; dan viel E door naar uitstappen en leek
		// het menu onbereikbaar. Binnen de cabine op de kar is E het verdiepingenmenu, net
		// als te voet. De kar zit op de cabinevloer (CabinCarrier), dus dat is het teken.
		if (
			this.vehicle === 'scrubber' &&
			this.elevator.contains(this.scrubber.pos.x, this.scrubber.pos.z, ELEVATOR_SCRUBBER.margin) &&
			Math.abs(this.scrubber.pos.y - this.elevator.cabinFloorY) < ELEVATOR_SCRUBBER.floorTolerance
		) {
			return { kind: 'menu' };
		}

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
	private tryOpenElevatorMenu(action: ElevatorAction | null): boolean {
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
	private hasInteractionOnE(): boolean {
		const p = this.camera.position;
		if (this.furryCon.canInteract(p) || this.furryCon.onLot(p)) return true;
		if (this.cityFavela.inGangRange(p)) return true;
		if (this.elevatorAction() !== null || this.canExitCurrentVehicle()) return true;
		return this.canBoardVehicleAt(p) || this.djBartek.inRange(p) || this.keeperInTalkRange();
	}

	private canExitCurrentVehicle(): boolean {
		return mutableFlag(this.player.flying) || this.vehicle === 'scrubber' || this.vehicle === 'car' || this.vehicle === 'chariot';
	}

	private canBoardVehicleAt(p: Vector3): boolean {
		const free = !this.possessId && this.freeMove;
		if (!free) return false;
		return Boolean(
			this.driveCars.nearestCar(p, INTERACTION_RANGE.car) ||
				(this.scrubber.distanceTo(p) < INTERACTION_RANGE.scrubber && levelAt(p.y) === 'v0') ||
				this.drone.distanceTo(p) < INTERACTION_RANGE.drone ||
				(this.heli.boardable && this.heli.distanceTo(p) < INTERACTION_RANGE.helicopter) ||
				this.colosseumTransport.isBoardable(p),
		);
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

	/**
	 * De speler zoals het ringwegverkeer hem ziet: alleen te voet. In een auto,
	 * in de drone of in een sim is hij geen voetganger en remt er niemand voor.
	 */
	private walkerOnRoad(): RoadObstacle | null {
		if (!(this.freeMove && this.player.enabled)) return null;
		if (this.possessId !== null || mutableFlag(this.player.flying) || mutableFlag(this.player.driving)) return null;
		return { x: this.camera.position.x, y: this.player.feetHeight, z: this.camera.position.z };
	}

	private pushPlayerFromSims(minDist: number): void {
		const cam = this.camera.position;
		const playerFloor = levelY(levelAt(cam.y));
		const group = this.atmosphere.americans.group;
		for (const child of group.children) {
			if (!(child instanceof Object3D)) continue;
			const sy = child.position.y;
			if (Math.abs(sy - playerFloor) > PLAYER_SEPARATION.floorTolerance) continue;
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
		const r = this.world.resolveCircle(
			cam.x,
			cam.z,
			this.player.feetHeight,
			PLAYER_RADIUS,
			PLAYER_SEPARATION.collisionIterations,
			true,
			airborne,
			this.player.unclamped,
		);
		cam.x = r.x;
		cam.z = r.z;
	}

	/**
	 * De camera afmaken en de zonekegels erop zetten.
	 *
	 * Twee keer per frame: aan het begin bepaalt hij wat er gesimuleerd moet worden,
	 * vlak voor de tekening wat er getekend moet worden. De camera verzet zich
	 * daartussen, en een cull op de stand van vorig frame laat geometrie een frame
	 * te laat opkomen.
	 */
	private refreshZoneView(): void {
		this.camera.updateWorldMatrix(true, false);
		this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
		this.zone = zoneAt(this.camera.position.x, this.camera.position.y, this.camera.position.z);
		this.zoneCuller.update(this.camera, this.zone);
	}

	/** Is er iets van een van deze zones in beeld? Elke LOD-klok hangt hieraan. */
	private seesZones(mask: number): boolean {
		return !this.zoneCullOn || this.zoneCuller.seesAnyOf(mask);
	}

	/**
	 * Ziet de speler de plek waar dit systeem staat?
	 *
	 * Uit de actoren zelf en niet uit een opgeschreven zone. Elke tik-klok had zijn
	 * dek een tweede keer opgeschreven bij zijn aanroep, en niets hield die twee
	 * tegen elkaar: Wei die de roltrap op loopt en een auto die de geul in rijdt
	 * bleven op het dek hangen waar ze niet meer stonden, en dan tikt een systeem
	 * dat je vlak voor je neus ziet op vier hertz.
	 */
	private seesWhere(...spots: readonly Vector3[]): boolean {
		const zones = new Set<ZoneId>();
		for (const spot of spots) zones.add(zoneAt(spot.x, spot.y, spot.z));
		let mask = 0;
		for (const zone of zones) mask += zoneBit(zone);
		return this.seesZones(mask);
	}

	/** Hetzelfde, voor een cast die uit losse lichamen bestaat. */
	private seesCast(...roots: readonly Object3D[]): boolean {
		const zones = new Set<ZoneId>();
		for (const root of roots) {
			for (const member of root.children) {
				member.getWorldPosition(this._zoneSpot);
				zones.add(zoneAt(this._zoneSpot.x, this._zoneSpot.y, this._zoneSpot.z));
			}
			if (root.children.length === 0) {
				root.getWorldPosition(this._zoneSpot);
				zones.add(zoneAt(this._zoneSpot.x, this._zoneSpot.y, this._zoneSpot.z));
			}
		}
		let mask = 0;
		for (const zone of zones) mask += zoneBit(zone);
		return this.seesZones(mask);
	}

	private beginFrame(timestamp?: number): FrameTiming {
		this.timer.update(timestamp);
		const measuredDt = Math.min(this.timer.getDelta(), PLAYER_TIMING.frameDtMaxSeconds);
		const measuredElapsed = this.timer.getElapsed();
		const dt = this.perfFrozen ? 0 : measuredDt;
		const elapsed = this.perfFrozen ? this.perfFrozenElapsed : measuredElapsed;
		const frameMs =
			timestamp !== undefined && this.lastRafTs !== null
				? timestamp - this.lastRafTs
				: measuredDt * PLAYER_TIMING.millisecondsPerSecond;
		if (timestamp !== undefined) this.lastRafTs = timestamp;
		this.updateDynRes(frameMs);
		return { dt, elapsed, frameMs, cpuStart: performance.now() };
	}

	private updateIndoorSystems(dt: number): void {
		this.refreshZoneView();
		const simsDt = this.lod.sims.step(dt, this.seesCast(this.atmosphere.americans.group));
		if (simsDt !== null) this.atmosphere.update(simsDt, this.camera.position);
		this.pathMesh.update(dt);
		const thiefDt = this.lod.thief.step(dt, this.seesWhere(this.thief.group.position));
		if (thiefDt !== null) this.thief.update(thiefDt);
		this.beardCave.update(dt);
		const protestDt = this.lod.protest.step(dt, this.seesWhere(this.protest.pos));
		if (protestDt !== null) this.protest.update(protestDt, this.camera.position);
		this.travel.update(dt);
		this.elevator.update(dt, this.camera.position);
		this.updateElevatorRide();
		const ratDt = this.lod.rat.step(dt, this.seesWhere(this.rat.group.position));
		if (ratDt !== null) this.rat.update(ratDt);
		this.barriers.update(dt);
	}

	private updatePlayerVehicles(dt: number): void {
		if (this.vehicle === 'car' && mutableFlag(this.driveCars.ridden)) {
			const seat = this.driveCars.update(dt, this.player.getDriveInput());
			if (seat) {
				this.camera.position.copy(seat);
				this.player.setHeading(this.driveCars.heading);
				this.player.driving = true;
			}
		}
		this.carrier.update();
		if (this.vehicle === 'scrubber' && this.scrubber.ridden) {
			const seat = this.scrubber.update(dt, this.player.getDriveInput());
			if (seat) {
				this.camera.position.copy(seat);
				this.player.setHeading(this.scrubber.heading);
				this.player.driving = true;
			}
		} else this.scrubber.update(dt);
		const cleanerDt = this.lod.cleaner.step(dt, this.seesWhere(this.cleaner.pos));
		if (cleanerDt !== null) this.cleaner.update(cleanerDt, mutableFlag(this.player.driving) ? undefined : this.camera.position);
	}

	private updateAudioSystems(dt: number): void {
		const camera = this.camera;
		camera.getWorldDirection(this._fwd);
		this._up.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
		spatial.updateListener({
			x: camera.position.x,
			y: camera.position.y,
			z: camera.position.z,
			fx: this._fwd.x,
			fy: this._fwd.y,
			fz: this._fwd.z,
			ux: this._up.x,
			uy: this._up.y,
			uz: this._up.z,
		});
		this.prayer.update(dt, camera.position);
		const penguinDt = this.lod.penguins.step(dt, this.seesCast(this.penguins.group));
		if (penguinDt !== null) this.penguins.update(penguinDt);
	}

	private updateSecurity(dt: number): void {
		this.securityHitCd = Math.max(0, this.securityHitCd - dt);
		const threats = this.securityThreats();
		const securityDt = this.lod.security.step(dt, this.seesCast(this.security.group));
		if (securityDt !== null) this.security.update(securityDt, this.camera.position, threats);
	}

	private securityThreats(): { x: number; y: number; z: number; kind: string; weight: number }[] {
		const threats: { x: number; y: number; z: number; kind: string; weight: number }[] = [];
		this.simPositions.length = 0;
		for (const child of this.atmosphere.americans.group.children) {
			if (!(child instanceof Object3D)) continue;
			this.simPositions.push(child.position);
			threats.push({
				x: child.position.x,
				y: child.position.y + THREAT_PROFILE.shopperHeight,
				z: child.position.z,
				kind: 'shopper',
				weight: THREAT_PROFILE.shopperWeight,
			});
		}
		if (mutableFlag(this.thief.active)) {
			const position = this.thief.group.children[0]?.position ?? this.thief.group.position;
			threats.push({
				x: position.x,
				y: position.y + THREAT_PROFILE.thiefHeight,
				z: position.z,
				kind: 'thief',
				weight: THREAT_PROFILE.thiefWeight,
			});
		}
		threats.push(
			{
				x: this.monkey.group.position.x,
				y: this.monkey.group.position.y + THREAT_PROFILE.monkeyHeight,
				z: this.monkey.group.position.z,
				kind: 'monkey',
				weight: THREAT_PROFILE.monkeyWeight,
			},
			{
				x: this.protest.pos.x,
				y: THREAT_PROFILE.protestHeight,
				z: this.protest.pos.z,
				kind: 'protest',
				weight: THREAT_PROFILE.protestWeight,
			},
			{
				x: this.cleaner.pos.x,
				y: this.cleaner.pos.y + THREAT_PROFILE.cleanerHeight,
				z: this.cleaner.pos.z,
				kind: 'cleaner',
				weight: THREAT_PROFILE.cleanerWeight,
			},
		);
		return threats;
	}

	private updatePlayerCamera(dt: number): void {
		this.player.setInteractOnE(this.hasInteractionOnE());
		if (this.possessId !== null) {
			this.updatePossessedCamera(dt);
			return;
		}
		if (this.freeMove && this.player.enabled) {
			this.updateFreePlayer(dt);
			return;
		}
		this.director.update(dt);
	}

	private updatePossessedCamera(dt: number): void {
		if (this.possessId === null) return;
		const eye = this.atmosphere.americans.getSimEye(this.possessId);
		if (!eye) return;
		this.camera.position.copy(eye.pos);
		this.camera.rotation.order = 'YXZ';
		const yawDelta = shortestAngle(this.camera.rotation.y, eye.yaw);
		this.camera.rotation.y += yawDelta * easeFactor(10, dt);
		this.camera.rotation.x = lerp(this.camera.rotation.x, CAMERA_FOLLOW.possessedPitch, CAMERA_FOLLOW.possessedPitchLerp);
		this.camera.rotation.z = 0;
	}

	private updateFreePlayer(dt: number): void {
		if (this.furryCon.ageModalOpen && mutableFlag(this.player.locked)) this.player.releaseLook();
		if (this.furryCon.filming) {
			this.camera.position.copy(this.furryCon.filmCam.position);
			this.camera.quaternion.copy(this.furryCon.filmCam.quaternion);
		} else {
			this.player.update(dt);
			const joinAt = this.furryCon.joinAnchor;
			if (joinAt) {
				this.camera.position.x = joinAt.x;
				this.camera.position.z = joinAt.z;
			}
		}
		if (this.elevRiding && !mutableFlag(this.player.driving)) {
			const passenger = this.elevator.resolvePassenger(this.camera.position.x, this.camera.position.z, PLAYER_RADIUS);
			this.camera.position.x = passenger.x;
			this.camera.position.z = passenger.z;
			this.player.setElevatorRide(this.elevator.cabinFloorY);
		}
		this.applyGroundTransport(dt);
	}

	private applyGroundTransport(dt: number): void {
		if (
			this.furryCon.filming ||
			this.furryCon.joinAnchor ||
			mutableFlag(this.player.flying) ||
			mutableFlag(this.player.driving)
		) {
			return;
		}
		if (this.player.isGrounded && !this.elevRiding) {
			const belt = this.walkways.beltVelocityAt(this.camera.position.x, this.player.feetHeight, this.camera.position.z);
			if (belt) this.player.nudge(belt.x * dt, belt.z * dt);
			const tread = this.world.rampCarryAt(this.camera.position.x, this.camera.position.z, this.player.feetHeight);
			if (tread) this.player.nudge(tread.x * dt, tread.z * dt);
			if (this.roofIsland.ride.accepts(this.camera.position.x, this.player.feetHeight, this.camera.position.z)) this.startSlide();
		}
		if (!this.elevRiding) this.pushPlayerFromSims(PLAYER_SEPARATION.simDistance);
	}

	private updateMallSystems(dt: number, elapsed: number): void {
		this.updateConfetti(dt);
		this.mall.update(dt);
		this.palms.update(elapsed);
		this.walkways.update(dt);
		this.amenities.update(dt, elapsed);
		this.disco.update(dt);
		this.spaceship.update(elapsed);
		this.djBartek.update(elapsed, dt, this.djPlayer.playing);
		this.alienProbe.update(dt);
	}

	private updateCitySystems(dt: number, elapsed: number): void {
		const cityDt = this.lod.city.step(dt, this.seesZones(CITY_TRAFFIC_ZONES));
		this.updateCityScene(cityDt, elapsed);
		this.updateChariot(dt, cityDt);
		const theatreDt = this.lod.theatre.step(dt, this.seesWhere(this.cityTheatre.marquee, this.cityTheatre.house));
		if (theatreDt !== null) this.cityTheatre.update(theatreDt, elapsed, this.camera.position);
		this.updateConvention(dt, elapsed);
		this.updateRoofSystems(dt, elapsed);
	}

	private updateCityScene(cityDt: number | null, elapsed: number): void {
		if (cityDt === null) return;
		this.cityRoads.update(cityDt, elapsed);
		this.cityTraffic.update(cityDt, elapsed);
		this.cityBuildings.update(cityDt, elapsed);
		this.cityPark.update(cityDt, elapsed);
		this.cityRio.update(elapsed);
		this.cityFavela.update(cityDt, elapsed, this.camera.position);
		this.cityColosseum.update(cityDt, elapsed);
		this.colosseumFighters.update(cityDt, elapsed);
		this.citySky.update(cityDt, elapsed);
		this.cityBirds.update(cityDt, elapsed);
	}

	private updateChariot(dt: number, cityDt: number | null): void {
		const chariotDt = this.colosseumTransport.ridden ? dt : cityDt;
		if (chariotDt !== null) this.colosseumTransport.update(chariotDt);
		if (this.vehicle !== 'chariot' || !this.colosseumTransport.ridden) return;
		this.colosseumTransport.seatPosition(this.chariotSeat);
		this.camera.position.copy(this.chariotSeat);
		this.player.driving = true;
	}

	private updateConvention(dt: number, elapsed: number): void {
		const seen =
			this.furryCon.onLot(this.camera.position) ||
			this.seesWhere(this.furryCon.plazaSpot, this.furryCon.dealersSpot, this.furryCon.stageSpot);
		const conDt = this.lod.con.step(dt, seen);
		if (conDt === null) return;
		this.furryCon.update(conDt, elapsed, this.camera.position);
		const tick = this.furryCon.consumeScoreEvent();
		if (tick) {
			if (tick.scoreDelta !== 0) {
				this.score = Math.max(0, this.score + tick.scoreDelta);
				this.ui.setScore(this.score, this.metSims.size);
			}
			this.ui.setStatus(tick.status);
			return;
		}
		const hint = this.furryCon.activityHint(this.camera.position);
		if (hint && hint !== this.lastConHint) {
			this.lastConHint = hint;
			this.ui.setStatus(hint);
		} else if (!hint) this.lastConHint = null;
	}

	private updateRoofSystems(dt: number, elapsed: number): void {
		const roofDt = this.lod.roof.step(dt, this.seesWhere(this.roofIsland.group.position, this.poolPeople.group.position));
		if (roofDt !== null) {
			this.roofIsland.update(roofDt, elapsed);
			this.poolPeople.update(roofDt, elapsed);
		}
		this.tickSlide(dt);
	}

	private updateMonkeyAndEntrances(dt: number, elapsed: number): void {
		this.simPositions.length = 0;
		for (const child of this.atmosphere.americans.group.children) this.simPositions.push(child.position);
		this.monkey.setSimPositions(this.simPositions);
		const monkeyDt = this.lod.monkey.step(dt, this.seesWhere(this.monkey.group.position));
		if (monkeyDt !== null) this.monkey.update(monkeyDt);
		const catwalkDt = this.lod.catwalk.step(dt, this.seesWhere(this.catwalk.group.position));
		if (catwalkDt !== null) this.catwalk.update(catwalkDt, elapsed);
		this.entrance.update(dt, this.camera.position);
		this.helipad.update(dt, this.camera.position);
		if (this.vehicle === 'heli') this.heli.followCamera(this.camera, dt);
		else this.heli.update(dt);
		this.drone.followCamera(this.camera, dt);
	}

	private updateVehicleHints(): void {
		this.updateDroneHint();
		this.updateScrubberHint();
		this.updateCarHint();
		this.updateChariotHint();
	}

	private updateDroneHint(): void {
		const near =
			!(mutableFlag(this.player.flying) || mutableFlag(this.player.driving)) &&
			this.freeMove &&
			this.drone.distanceTo(this.camera.position) < INTERACTION_RANGE.drone;
		if (near && !this.nearDroneHint) {
			this.nearDroneHint = true;
			this.ui.setStatus('🛸 Passagiersdrone — druk E om in te stappen');
		} else if (!near && this.nearDroneHint) this.nearDroneHint = false;
	}

	private updateScrubberHint(): void {
		const near =
			!(mutableFlag(this.player.flying) || mutableFlag(this.player.driving)) &&
			this.freeMove &&
			this.scrubber.distanceTo(this.camera.position) < INTERACTION_RANGE.parkedScrubber &&
			levelAt(this.camera.position.y) === 'v0';
		if (near && !this.nearScrubberHint) {
			this.nearScrubberHint = true;
			this.ui.setStatus('🧽 SCHOONMAAK BUGGY #88 — leeg · E = instappen & racen (Shift = turbo)');
		} else if (!near && this.nearScrubberHint) this.nearScrubberHint = false;
	}

	private updateCarHint(): void {
		const near =
			!(mutableFlag(this.player.flying) || mutableFlag(this.player.driving)) &&
			this.freeMove &&
			Boolean(this.driveCars.nearestCar(this.camera.position, INTERACTION_RANGE.parkedCar));
		if (near && !this.nearCarHint) {
			this.nearCarHint = true;
			this.ui.setStatus('🚗 HUURAUTO · E = instappen · Shift = turbo · west-exit ramp → STAD');
		} else if (!near && this.nearCarHint) this.nearCarHint = false;
	}

	private updateChariotHint(): void {
		const near =
			!(mutableFlag(this.player.flying) || mutableFlag(this.player.driving)) &&
			this.freeMove &&
			this.colosseumTransport.isBoardable(this.camera.position);
		if (near && !this.nearChariotHint) {
			this.nearChariotHint = true;
			const destination = this.colosseumTransport.destination === 'mall' ? 'Mall Entrance' : 'Mega Colosseum';
			this.ui.setStatus(`🏛️ COLOSSEUM EXPRESS · E = taxi naar ${destination}`);
		} else if (!near && this.nearChariotHint) this.nearChariotHint = false;
	}

	private updatePeopleSystems(dt: number): void {
		this.peopleT += dt;
		if (this.peopleT > HUD_TIMING.peopleRefreshSeconds && this.peopleUi.isOpen) {
			this.peopleT = 0;
			this.atmosphere.americans.getPeopleSnapshot(this.camera.position, this.peopleRows);
			this.peopleUi.update(this.peopleRows, this.buildCastRows());
		}
		this.shopVoice.update(dt);
		this.tickBartekDrama(dt);
		observeAsync(
			this.shopVoice.greetIfNear('kruidvat', this.camera.position, PROXIMITY_RANGE.youssefGreeting),
			'automatic Kruidvat greeting',
		);
		const distance = this.shopVoice.distanceTo('kruidvat', this.camera.position);
		if (distance < TALK_RADIUS && levelAt(this.camera.position.y) === 'v1' && !this.youssefHint) {
			this.youssefHint = true;
			this.ui.setStatus('💊 Youssef Benali (Kruidvat) · druk E om te praten');
		} else if (distance > PROXIMITY_RANGE.youssefLeave) this.youssefHint = false;
		const roast = this.atmosphere.americans.maybeRoastPlayer(this.camera.position, dt);
		if (roast) this.ui.setStatus(`💬 ${roast}`);
	}

	private updateProximityHud(dt: number): void {
		this.nearHudT += dt;
		if (this.nearHudT <= HUD_TIMING.proximityRefreshSeconds) return;
		this.nearHudT = 0;
		const boothDistance = this.camera.position.distanceTo(this.djBartek.pos);
		this.djPlayer.setDistanceGain(1 / (1 + BOOTH_FALLOFF_K * boothDistance * boothDistance));
		this.updateNearbySimHud();
		this.updateLocationHints();
		this.updateSecurityHint();
		this.updateElevatorHint();
	}

	private updateNearbySimHud(): void {
		const near = this.atmosphere.americans.getSimsNear(this.camera.position, PROXIMITY_RANGE.sims);
		let gained = false;
		for (const sim of near) {
			if (this.metSims.has(sim.id)) continue;
			this.metSims.add(sim.id);
			this.score += MONEY_GIFT.score;
			gained = true;
		}
		if (gained) this.ui.setScore(this.score, this.metSims.size);
		const top = near[0];
		if (!top) {
			this.ui.setNearbySim(null);
			return;
		}
		const heart = top.partnerName ? ` ❤️ ${top.partnerName.split(' ')[0] ?? top.partnerName}` : '';
		const why = top.lifeLine ? ` · ${top.lifeLine}` : '';
		this.ui.setNearbySim(
			`${top.name}${heart} → ${top.targetShop} · €${top.moneySpent} · ☹ ${Math.round(top.unhappiness)}%${why}`,
		);
	}

	private updateLocationHints(): void {
		const atDj = this.djBartek.inRange(this.camera.position);
		if (atDj && !this.nearDjHint && !this.djUi.isOpen()) {
			this.nearDjHint = true;
			this.ui.setStatus('🎧 DJ BARTEK · druk E · request plaatjes · Bartek Bartek');
		} else if (!atDj) this.nearDjHint = false;
		this.updateConAndFavelaHints();
		this.updateProtestAndTravelHints();
		this.updatePrayerHint();
	}

	private updateConAndFavelaHints(): void {
		const conventionDistance = this.camera.position.distanceTo(this.furryCon.plazaSpot);
		if (conventionDistance < PROXIMITY_RANGE.conEnter && !this.nearConHint) {
			this.nearConHint = true;
			this.ui.setStatus('🐾 PRAIRIE FUR CON · pink glows = E · badge desk at doors first · dealers/stage/hotel/food');
		} else if (conventionDistance >= PROXIMITY_RANGE.conLeave) this.nearConHint = false;
		if (this.cityFavela.inGangRange(this.camera.position) && !this.nearFavelaGangHint) {
			this.nearFavelaGangHint = true;
			this.ui.setStatus('🔫 FAVELA · bendes + twinks met slop · E = praten / pedágio / share the bowl');
		} else if (!this.cityFavela.inGangRange(this.camera.position)) this.nearFavelaGangHint = false;
	}

	private updateProtestAndTravelHints(): void {
		const protestDistance = this.camera.position.distanceTo(this.protest.pos);
		if (protestDistance < PROXIMITY_RANGE.protestEnter && !this.nearProtestHint) {
			this.nearProtestHint = true;
			this.ui.setStatus('📢 PROTEST STEMPELT · 28 multi-voice chants · Wir schaffen das · Mutti lead');
		} else if (protestDistance >= PROXIMITY_RANGE.protestLeave) this.nearProtestHint = false;
		const travelDistance = this.camera.position.distanceTo(this.travel.pos);
		if (travelDistance < PROXIMITY_RANGE.travelEnter && !this.nearTravelHint) {
			this.nearTravelHint = true;
			this.ui.setStatus('🌴 ISLAND HOP · Epstein Island charters · flights suspended · NDA desk');
		} else if (travelDistance >= PROXIMITY_RANGE.travelLeave) this.nearTravelHint = false;
	}

	private updatePrayerHint(): void {
		const distance = Math.hypot(this.camera.position.x - this.prayer.pos.x, this.camera.position.z - this.prayer.pos.z);
		if (distance < PROXIMITY_RANGE.prayerEnter && levelAt(this.camera.position.y) === 'v0' && !this.nearPrayerHint) {
			this.nearPrayerHint = true;
			this.ui.setStatus('🕌 GEBEDSRUIMTE · Allahu Trapbar ♪ (vol) · poses op de beat · geit');
		} else if (distance >= PROXIMITY_RANGE.prayerLeave) this.nearPrayerHint = false;
	}

	private updateSecurityHint(): void {
		if (this.nearSecurityHint || this.security.roster.length === 0) return;
		const atriumDistance = Math.hypot(this.camera.position.x, this.camera.position.z);
		if (atriumDistance < SECURITY_POLICY.introRadius && this.freeMove) {
			this.nearSecurityHint = true;
			this.ui.setStatus('🚔 MALL SECURITY · hypersensitief · adem te hard = open vuur');
		}
	}

	private updateElevatorHint(): void {
		const distance = Math.hypot(this.camera.position.x - this.elevator.pos.x, this.camera.position.z - this.elevator.pos.z);
		const onRoof = this.player.level === 'roof';
		const enterRange = onRoof ? ELEVATOR_HINT_RANGE.roofEnter : ELEVATOR_HINT_RANGE.floorEnter;
		const leaveRange = onRoof ? ELEVATOR_HINT_RANGE.roofLeave : ELEVATOR_HINT_RANGE.floorLeave;
		const inside = this.elevator.contains(this.camera.position.x, this.camera.position.z);
		if ((distance < enterRange || inside) && !this.nearElevHint) {
			this.nearElevHint = true;
			this.ui.setStatus(
				inside
					? '🛗 GLAZEN LIFT · kijk Hans · E = kies verdieping'
					: onRoof
						? '🟢 GROENE KNOP / gele streep · E = roep Hans naar het dak'
						: '🛗 GLAZEN LIFT · gele/blauwe knop of E naast schacht = roep lift',
			);
		} else if (distance >= leaveRange && !inside) this.nearElevHint = false;
	}

	private updateMap(): void {
		const euler = new Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
		const activeRide = this.vehicle === 'car' ? this.driveCars.ride : this.vehicle === 'scrubber' ? this.scrubber.ride : null;
		const mapY = activeRide?.y ?? this.player.feetHeight;
		this.mapBlips.length = 0;
		for (const child of this.atmosphere.americans.group.children) {
			this.mapBlips.push({ x: child.position.x, z: child.position.z, level: levelAt(child.position.y) });
		}
		const targetStore = this.currentStore;
		this.ui.updateMap({
			x: this.camera.position.x,
			y: mapY,
			z: this.camera.position.z,
			yaw: euler.y,
			level: deckAt(this.camera.position.x, this.camera.position.y, this.camera.position.z),
			path: this.currentPath.map((node) => ({ x: node.x, y: node.y, z: node.z })),
			blips: this.mapBlips,
			target: targetStore
				? { x: targetStore.x, z: targetStore.z, level: targetStore.level, name: targetStore.name.replace('\n', ' ') }
				: null,
		});
	}

	private finishLogic(dt: number): void {
		this.persistT += dt;
		if (this.persistT >= PERSIST_EVERY) {
			this.persistT = 0;
			this.persistNow();
		}
		if (this.perfPose) {
			this.camera.position.set(this.perfPose.x, this.perfPose.y, this.perfPose.z);
			this.camera.lookAt(this.perfPose.lookX, this.perfPose.lookY, this.perfPose.lookZ);
		}
		cullByLevel(levelAt(this.camera.position.y));
	}

	private renderFrame(dt: number, cpuStart: number): RenderTiming {
		const afterLogic = performance.now();
		this.renderer.info.reset();
		this.refreshZoneView();
		this.sceneBatcher.update();
		if (this.zoneCullOn) {
			this.sceneBatcher.applyZoneVisibility(this.zoneCuller);
			this.zoneVisibility.apply(this.zoneCuller);
		}
		this.pool.update(this.camera);
		const afterBatch = performance.now();
		this.gpuTimer?.begin();
		this.composer.render(dt);
		this.gpuTimer?.end();
		const afterRender = performance.now();
		this.perfCpuFrame.logicMs = afterLogic - cpuStart;
		this.perfCpuFrame.batchMs = afterBatch - afterLogic;
		this.perfCpuFrame.submitMs = afterRender - afterBatch;
		this.perfCpuFrame.triangles = this.renderer.info.render.triangles;
		return { afterLogic, afterBatch, afterRender };
	}

	private updatePerfHud(frame: FrameTiming, render: RenderTiming): void {
		if (feature('NO_PERF_HUD')) return;
		const buffer = this.renderer.getDrawingBufferSize(this.bufferSize);
		const direction = this.camera.getWorldDirection(this.hudDirection);
		const feetY =
			mutableFlag(this.player.driving) || mutableFlag(this.player.flying) ? this.camera.position.y - EYE : this.player.feetHeight;
		this.perfHud?.update({
			eyeX: this.camera.position.x,
			eyeY: this.camera.position.y,
			eyeZ: this.camera.position.z,
			feetY,
			dirX: direction.x,
			dirY: direction.y,
			dirZ: direction.z,
			frameMs: frame.frameMs,
			drawCalls: this.renderer.info.render.calls,
			triangles: this.renderer.info.render.triangles,
			programs: this.renderer.info.programs?.length ?? 0,
			geometries: this.renderer.info.memory.geometries,
			textures: this.renderer.info.memory.textures,
			bufferWidth: buffer.width,
			bufferHeight: buffer.height,
			renderScale: this.dynScale,
			cpuMs: render.afterRender - frame.cpuStart,
			gpuMs: this.gpuTimer?.ms ?? 0,
			gpuSupported: this.gpuTimer?.supported ?? false,
			logicMs: render.afterLogic - frame.cpuStart,
			batchMs: render.afterBatch - render.afterLogic,
			submitMs: render.afterRender - render.afterBatch,
			lightsUsed: this.pool.slotsInUse,
			lightsTotal: this.pool.slots,
			batches: this.sceneBatcher.stats.drawCalls,
		});
	}

	private readonly animate = (timestamp?: number): void => {
		requestAnimationFrame(this.animate);
		const frame = this.beginFrame(timestamp);
		const { dt, elapsed } = frame;
		this.updateIndoorSystems(dt);
		this.updatePlayerVehicles(dt);
		this.updateAudioSystems(dt);
		this.updateSecurity(dt);

		this.updatePlayerCamera(dt);
		this.updateMallSystems(dt, elapsed);
		this.updateCitySystems(dt, elapsed);
		this.updateMonkeyAndEntrances(dt, elapsed);
		this.updateVehicleHints();
		this.updatePeopleSystems(dt);

		this.updateProximityHud(dt);
		this.updateMap();
		this.finishLogic(dt);
		const render = this.renderFrame(dt, frame.cpuStart);
		this.updatePerfHud(frame, render);
	};
}
