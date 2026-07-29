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
import { setupLighting } from '../scene/Lighting';
import { MallBuilder } from '../scene/MallBuilder';
import { PalmForest } from '../scene/Palms';
import { Spaceship } from '../scene/Spaceship';
import { MovingWalkways } from '../scene/Walkways';
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
  private palms = new PalmForest();
  private walkways = new MovingWalkways();
  private spaceship = new Spaceship();
  private ui: KioskOverlay;
  private clock = new THREE.Clock();
  private currentPath: GraphNode[] = [];
  private currentStore: StoreDef | null = null;
  private confetti: THREE.Points | null = null;
  private confettiVel: Float32Array | null = null;
  private score = 0;
  private metSims = new Set<number>();
  private nearHudT = 0;

  constructor(canvasParent: HTMLElement, uiRoot: HTMLElement) {
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
    this.scene.add(this.mall.build());
    this.scene.add(this.palms.group);
    this.scene.add(this.walkways.group);
    this.scene.add(this.spaceship.group);
    // NO floating labels — storefront signs only (architect-approved)
    this.scene.add(this.atmosphere.group);
    this.scene.add(this.pathMesh.group);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.45, 2);
    this.controls.enablePan = false;

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
      this.ui.setStatus('GAME ON · kies een winkel of loop de mall');
      this.ui.setScore(this.score, this.metSims.size);
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
      this.ui.setStatus('Bij de kiosk · kies een winkel in de lijst');
    });
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
    this.currentStore = store;
    this.ui.hideArrive();
    this.clearConfetti();

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
    if (underShip) {
      const stand = this.spaceship.getUnderStandPoint();
      this.ui.showArrive(store);
      this.spawnConfetti(stand.clone().add(new THREE.Vector3(0, 1.5, 0)));
      this.controls.target.copy(this.spaceship.getShipLookPoint());
      this.ui.setStatus(`+100 · Kruidvat clear · score ${this.score}`);
    } else {
      this.ui.showArrive(store);
      this.spawnConfetti(new THREE.Vector3(store.x, store.floor * 6 + 2, store.z));
      this.controls.target.set(store.x, store.floor * 6 + 1.5, store.z);
      this.ui.setStatus(`+50 · ${store.name.replace('\n', ' ')} · score ${this.score}`);
    }
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
      this.ui.setStatus('Bij de kiosk · kies een winkel in de lijst');
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

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    this.atmosphere.update(dt);
    this.pathMesh.update(dt);
    this.director.update(dt);
    this.updateConfetti(dt);
    this.palms.update(this.clock.elapsedTime);
    this.walkways.update(dt);
    this.spaceship.update(this.clock.elapsedTime);

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
        this.ui.setNearbySim(
          `${top.name} · ${top.mood} · “${top.goal}” · thicc ${Math.round(top.thicc * 100)}%`,
        );
      } else {
        this.ui.setNearbySim(null);
      }
    }

    this.ui.updateMinimap(
      STORES,
      this.currentPath.map((n) => ({ x: n.x, z: n.z })),
      { x: this.camera.position.x, z: this.camera.position.z },
    );

    this.composer.render(dt);
  };
}
