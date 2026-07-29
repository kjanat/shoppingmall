import type { EffectComposer } from 'postprocessing';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Director } from '../camera/Director';
import type { GraphNode } from '../data/graph';
import { getStore, type StoreDef, STORES } from '../data/stores';
import { Pathfinder } from '../path/Pathfinder';
import { PathMesh } from '../path/PathMesh';
import { createComposer } from '../post/Composer';
import { Atmosphere } from '../scene/Atmosphere';
import { StoreLabels } from '../scene/Labels';
import { setupLighting } from '../scene/Lighting';
import { MallBuilder } from '../scene/MallBuilder';
import { KioskOverlay } from '../ui/KioskOverlay';

export class App {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera: THREE.PerspectiveCamera;
	private controls: OrbitControls;
	private composer: EffectComposer;
	private director: Director;
	private pathfinder = new Pathfinder();
	private pathMesh = new PathMesh();
	private atmosphere = new Atmosphere();
	private mall = new MallBuilder();
	private labels: StoreLabels;
	private ui: KioskOverlay;
	private clock = new THREE.Clock();
	private currentPath: GraphNode[] = [];
	private currentStore: StoreDef | null = null;
	private confetti: THREE.Points | null = null;
	private confettiVel: Float32Array | null = null;
	private atriumOrb: THREE.Object3D | null = null;
	private youAreHere: THREE.Object3D | null = null;

	constructor(canvasParent: HTMLElement, uiRoot: HTMLElement) {
		this.renderer = new THREE.WebGLRenderer({
			antialias: true,
			powerPreference: 'high-performance',
		});
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.NoToneMapping;
		canvasParent.appendChild(this.renderer.domElement);

		this.camera = new THREE.PerspectiveCamera(
			45,
			window.innerWidth / window.innerHeight,
			0.5,
			400,
		);

		setupLighting(this.scene);
		this.scene.add(this.mall.build());
		this.labels = new StoreLabels(STORES);
		this.scene.add(this.labels.group);
		this.scene.add(this.atmosphere.group);
		this.scene.add(this.pathMesh.group);

		this.atriumOrb = this.scene.getObjectByName('atriumOrb') ?? null;
		this.youAreHere = this.scene.getObjectByName('youAreHere') ?? null;

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.minPolarAngle = 0.15;
		this.controls.maxPolarAngle = Math.PI * 0.48;
		this.controls.minDistance = 12;
		this.controls.maxDistance = 110;
		this.controls.target.set(0, 3, 0);
		// Prevent panning into the void forever
		this.controls.enablePan = true;
		this.controls.screenSpacePanning = false;
		this.controls.maxTargetRadius = 40;

		this.director = new Director(this.camera, this.controls);
		this.composer = createComposer(this.renderer, this.scene, this.camera);

		this.ui = new KioskOverlay(uiRoot, {
			onSelectStore: (s) => this.onSelectStore(s),
			onStartRoute: (s) => this.onStartRoute(s),
			onCancel: () => this.onCancel(),
			onHome: () => this.onHome(),
			onReplay: () => {
				const store = this.currentStore ?? getStore('kruidvat')!;
				this.onStartRoute(store);
			},
		});

		window.addEventListener('resize', () => this.onResize());
		window.addEventListener('keydown', (e) => {
			if (e.key === 'k' || e.key === 'K') {
				this.onStartRoute(getStore('kruidvat')!);
			}
			if (e.key === 'Escape') this.onCancel();
			if (e.key === 'h' || e.key === 'H') this.onHome();
		});

		this.director.playIntro(() => {
			this.ui.hideBoot();
			this.ui.setStatus('OVERZICHT · kies een winkel of Kruidvat');
		});

		this.animate();
	}

	private onHome(): void {
		this.pathMesh.clear();
		this.currentPath = [];
		this.clearConfetti();
		this.ui.clearSelection();
		this.ui.hideArrive();
		this.director.goHome(true, () => {
			this.ui.setStatus('OVERZICHT · hele mall in beeld');
		});
	}

	private onSelectStore(store: StoreDef): void {
		this.currentStore = store;
		const y = store.floor * 6 + 2;
		const pos = new THREE.Vector3(store.x, y, store.z);
		this.director.focusStore(pos);

		const path = this.pathfinder.findPath('kiosk', store.nodeId);
		this.currentPath = path;
		this.pathMesh.setPath(path);

		const dist = this.pathfinder.pathLength(path);
		const steps = this.buildStepLabels(path, store);
		const floors = store.floor === 0 ? 'Begane grond' : 'Via roltrap · verdieping 1';
		this.ui.showSteps(steps, dist, floors);
		this.ui.setStatus(`GEKOZEN · ${store.name.replace('\n', ' ')}`);
	}

	private onStartRoute(store: StoreDef): void {
		this.currentStore = store;
		this.ui.hideArrive();
		this.clearConfetti();

		const path = this.pathfinder.findPath('kiosk', store.nodeId);
		if (path.length < 2) {
			this.ui.setStatus('GEEN ROUTE · pad niet gevonden');
			return;
		}

		this.currentPath = path;
		this.pathMesh.setPath(path);

		const dist = this.pathfinder.pathLength(path);
		const steps = this.buildStepLabels(path, store);
		const floors = store.floor === 0 ? 'Begane grond' : 'Via roltrap · verdieping 1';
		this.ui.showSteps(steps, dist, floors);
		this.ui.showTouring(store);

		this.director.tourPath(path, () => this.onArrive(store));
	}

	private onArrive(store: StoreDef): void {
		this.ui.showArrive(store);
		this.spawnConfetti(new THREE.Vector3(store.x, store.floor * 6 + 3, store.z));
		this.controls.target.set(store.x, store.floor * 6 + 1.5, store.z);
	}

	private onCancel(): void {
		this.pathMesh.clear();
		this.currentPath = [];
		this.currentStore = null;
		this.clearConfetti();
		this.ui.clearSelection();
		this.ui.hideArrive();
		this.director.stopTour();
		this.director.goHome(true, () => {
			this.ui.setStatus('OVERZICHT · kies een winkel');
		});
	}

	private buildStepLabels(path: GraphNode[], store: StoreDef): string[] {
		const steps: string[] = ['Start bij de directory-kiosk (rood)'];
		const ids = path.map((n) => n.id);

		if (ids.includes('e0') && ids.includes('e1')) {
			steps.push('Loop naar de roltrap bij het atrium');
			steps.push('Neem de roltrap omhoog naar verdieping 1');
		}

		const landmarks = ['s_hm', 's_apple', 's_primark', 's_sephora'];
		for (const id of landmarks) {
			if (ids.includes(id) && id !== store.nodeId) {
				const s = STORES.find((x) => x.nodeId === id);
				if (s) steps.push(`Pass ${s.name.replace('\n', ' ')}`);
			}
		}

		steps.push(`Bestemming: ${store.name.replace('\n', ' ')}`);
		return steps.slice(0, 6);
	}

	private spawnConfetti(origin: THREE.Vector3): void {
		this.clearConfetti();
		const count = 160;
		const positions = new Float32Array(count * 3);
		const colors = new Float32Array(count * 3);
		this.confettiVel = new Float32Array(count * 3);
		const palette = [
			new THREE.Color(0x00a651),
			new THREE.Color(0xe30613),
			new THREE.Color(0x00ffc8),
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
			this.confettiVel[i * 3] = (Math.random() - 0.5) * 6;
			this.confettiVel[i * 3 + 1] = Math.random() * 5 + 2;
			this.confettiVel[i * 3 + 2] = (Math.random() - 0.5) * 6;
		}

		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		const mat = new THREE.PointsMaterial({
			size: 0.18,
			vertexColors: true,
			transparent: true,
			opacity: 0.95,
			depthWrite: false,
		});
		this.confetti = new THREE.Points(geo, mat);
		this.scene.add(this.confetti);
		setTimeout(() => this.clearConfetti(), 4000);
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

	private animate = (): void => {
		requestAnimationFrame(this.animate);
		const dt = Math.min(this.clock.getDelta(), 0.05);

		this.atmosphere.update(dt);
		this.pathMesh.update(dt);
		this.director.update(dt);
		this.updateConfetti(dt);

		if (this.atriumOrb) {
			this.atriumOrb.rotation.y += dt * 0.4;
		}
		if (this.youAreHere) {
			const s = 1 + Math.sin(this.clock.elapsedTime * 3) * 0.08;
			this.youAreHere.scale.setScalar(s);
		}

		this.ui.updateMinimap(
			STORES,
			this.currentPath.map((n) => ({ x: n.x, z: n.z })),
			{ x: this.camera.position.x, z: this.camera.position.z },
		);

		this.composer.render(dt);
	};
}
