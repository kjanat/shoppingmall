import * as THREE from 'three';

/**
 * DJ Bartek — booth at the west stair gap (st0).
 * Walk up, E to talk, request plaatjes.
 */
export class DJBartek {
	readonly group = new THREE.Group();
	/** Interaction radius center */
	readonly pos = new THREE.Vector3(-20.5, 0, -6);
	readonly interactR = 4.2;
	private materials: THREE.Material[] = [];
	private bobParts: THREE.Object3D[] = [];
	private decks: THREE.Group;
	private glow: THREE.PointLight;
	private nameSprite: THREE.Sprite;
	private speechSprite: THREE.Sprite;
	private speechTex: THREE.CanvasTexture;
	private speechCtx: CanvasRenderingContext2D;
	private speechLife = 0;
	greetingDone = false;
	/** drama beat timer (seconds) */
	dramaCd = 8;

	constructor() {
		this.group.name = 'djBartek';
		this.group.position.copy(this.pos);

		this.buildBooth();
		this.buildBartek();
		this.decks = this.buildDecks();
		this.group.add(this.decks);

		this.glow = new THREE.PointLight(0xff00aa, 4, 10, 2);
		this.glow.position.set(0, 2.2, 0.4);
		this.group.add(this.glow);

		this.nameSprite = this.makeNamePlate();
		this.group.add(this.nameSprite);

		const sc = document.createElement('canvas');
		sc.width = 420;
		sc.height = 110;
		this.speechCtx = sc.getContext('2d')!;
		this.speechTex = new THREE.CanvasTexture(sc);
		this.speechTex.colorSpace = THREE.SRGBColorSpace;
		this.speechSprite = new THREE.Sprite(
			this.track(
				new THREE.SpriteMaterial({
					map: this.speechTex,
					transparent: true,
					depthTest: false,
					visible: false,
				}),
			),
		);
		this.speechSprite.scale.set(3.2, 0.85, 1);
		this.speechSprite.position.set(0, 3.55, 0.3);
		this.speechSprite.visible = false;
		this.group.add(this.speechSprite);
	}

	/** Show floating speech bubble above Bartek while he talks */
	say(text: string, life = 4.5): void {
		const ctx = this.speechCtx;
		const w = 420;
		const h = 110;
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = 'rgba(255,255,255,0.96)';
		roundRect(ctx, 6, 6, w - 12, h - 12, 16);
		ctx.fill();
		ctx.strokeStyle = '#ec4899';
		ctx.lineWidth = 3;
		roundRect(ctx, 6, 6, w - 12, h - 12, 16);
		ctx.stroke();
		ctx.fillStyle = '#0f172a';
		ctx.font = '600 18px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		// wrap-ish: two lines max
		const words = text.split(' ');
		let line1 = '';
		let line2 = '';
		for (const word of words) {
			const test = (line1 ? line1 + ' ' : '') + word;
			if (ctx.measureText(test).width < w - 40 && !line2) line1 = test;
			else line2 = (line2 ? line2 + ' ' : '') + word;
		}
		if (line2) {
			ctx.fillText(line1.slice(0, 42), w / 2, h / 2 - 14);
			ctx.fillText(line2.slice(0, 42), w / 2, h / 2 + 16);
		} else {
			ctx.fillText(line1.slice(0, 48), w / 2, h / 2);
		}
		this.speechTex.needsUpdate = true;
		this.speechSprite.visible = true;
		(this.speechSprite.material as THREE.SpriteMaterial).visible = true;
		this.speechLife = life;
	}

	/** Player close enough to open the booth UI */
	inRange(worldPos: THREE.Vector3): boolean {
		const dx = worldPos.x - this.pos.x;
		const dz = worldPos.z - this.pos.z;
		return Math.hypot(dx, dz) < this.interactR && worldPos.y < 3.5;
	}

	update(t: number, dt: number, musicOn: boolean): void {
		// Bob to imaginary beat
		const pulse = musicOn ? 1 : 0.35;
		for (const p of this.bobParts) {
			p.position.y = (p.userData.baseY as number)
				+ Math.sin(t * (musicOn ? 8 : 2) + p.userData.phase) * 0.04 * pulse;
		}
		this.decks.rotation.y = Math.sin(t * 0.5) * 0.05;
		this.glow.intensity = 3 + Math.sin(t * (musicOn ? 10 : 2)) * 1.5 * pulse;
		this.nameSprite.material.rotation = Math.sin(t * 1.5) * 0.02;

		if (this.speechLife > 0) {
			this.speechLife -= dt;
			if (this.speechLife <= 0) {
				this.speechSprite.visible = false;
				(this.speechSprite.material as THREE.SpriteMaterial).visible = false;
			}
		}
		this.dramaCd -= dt;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildBooth(): void {
		// Stage platform at stair gap
		const floor = new THREE.Mesh(
			new THREE.BoxGeometry(4.2, 0.18, 3.2),
			this.track(new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.7 })),
		);
		floor.position.set(0, 0.09, 0);
		this.group.add(floor);

		// Neon strip
		const neon = new THREE.Mesh(
			new THREE.BoxGeometry(4.0, 0.06, 0.12),
			this.track(new THREE.MeshBasicMaterial({ color: 0xff00aa })),
		);
		neon.position.set(0, 0.22, 1.5);
		this.group.add(neon);

		// DJ desk
		const desk = new THREE.Mesh(
			new THREE.BoxGeometry(2.4, 0.9, 0.7),
			this.track(new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.4, roughness: 0.45 })),
		);
		desk.position.set(0, 0.55, 0.35);
		this.group.add(desk);

		// Speakers flanking — "gat voor de trap" energy
		for (const sx of [-1.7, 1.7]) {
			const sp = new THREE.Mesh(
				new THREE.BoxGeometry(0.55, 1.1, 0.45),
				this.track(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 })),
			);
			sp.position.set(sx, 0.7, -0.2);
			this.group.add(sp);
			const cone = new THREE.Mesh(
				new THREE.CircleGeometry(0.18, 16),
				this.track(new THREE.MeshBasicMaterial({ color: 0x22d3ee })),
			);
			cone.position.set(sx, 0.85, 0.04);
			this.group.add(cone);
		}

		// Back banner
		const banner = this.makeCanvasPlane(
			['DJ BARTEK', 'BARTEK BARTEK', 'REQUESTS · E'],
			1.8,
			0.7,
			'#0f172a',
			'#f472b6',
		);
		banner.position.set(0, 2.35, -0.9);
		this.group.add(banner);
	}

	private buildDecks(): THREE.Group {
		const g = new THREE.Group();
		g.position.set(0, 1.05, 0.35);
		for (const dx of [-0.45, 0.45]) {
			const deck = new THREE.Mesh(
				new THREE.CylinderGeometry(0.28, 0.28, 0.06, 24),
				this.track(new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.3 })),
			);
			deck.position.set(dx, 0, 0);
			const disc = new THREE.Mesh(
				new THREE.CylinderGeometry(0.22, 0.22, 0.02, 24),
				this.track(new THREE.MeshBasicMaterial({ color: 0xa855f7 })),
			);
			disc.position.set(dx, 0.04, 0);
			disc.userData.baseY = 0.04;
			disc.userData.phase = dx;
			this.bobParts.push(disc);
			g.add(deck, disc);
		}
		// Mixer
		const mix = new THREE.Mesh(
			new THREE.BoxGeometry(0.35, 0.08, 0.4),
			this.track(new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5, roughness: 0.4 })),
		);
		mix.position.set(0, 0.02, 0);
		g.add(mix);
		return g;
	}

	private buildBartek(): void {
		const body = new THREE.Group();
		body.position.set(0, 0, -0.15);

		const skin = this.track(new THREE.MeshStandardMaterial({ color: 0xe8b896, roughness: 0.85 }));
		const shirt = this.track(new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.7 }));
		const pants = this.track(new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.9 }));

		const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.55, 4, 8), pants);
		legs.position.y = 0.55;
		body.add(legs);

		const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.45, 4, 8), shirt);
		torso.position.y = 1.25;
		torso.userData.baseY = 1.25;
		torso.userData.phase = 0.3;
		this.bobParts.push(torso);
		body.add(torso);

		const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), skin);
		head.position.y = 1.78;
		head.userData.baseY = 1.78;
		head.userData.phase = 1.1;
		this.bobParts.push(head);
		body.add(head);

		// Headphones
		const band = new THREE.Mesh(
			new THREE.TorusGeometry(0.2, 0.03, 8, 16, Math.PI),
			this.track(new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6, roughness: 0.4 })),
		);
		band.rotation.z = Math.PI;
		band.position.set(0, 1.92, 0);
		body.add(band);
		for (const sx of [-0.2, 0.2]) {
			const cup = new THREE.Mesh(
				new THREE.SphereGeometry(0.08, 10, 10),
				this.track(new THREE.MeshStandardMaterial({ color: 0xec4899, metalness: 0.5, roughness: 0.4 })),
			);
			cup.position.set(sx, 1.78, 0);
			body.add(cup);
		}

		// Eyes
		const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: 0x111111 }));
		const eL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMat);
		const eR = eL.clone();
		eL.position.set(-0.07, 1.82, 0.18);
		eR.position.set(0.07, 1.82, 0.18);
		body.add(eL, eR);

		// Cap
		const cap = new THREE.Mesh(
			new THREE.SphereGeometry(0.24, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
			this.track(new THREE.MeshStandardMaterial({ color: 0x0f172a })),
		);
		cap.position.set(0, 1.9, 0);
		body.add(cap);
		const brim = new THREE.Mesh(
			new THREE.BoxGeometry(0.28, 0.03, 0.2),
			this.track(new THREE.MeshStandardMaterial({ color: 0x0f172a })),
		);
		brim.position.set(0, 1.82, 0.18);
		body.add(brim);

		// Mic arm
		const mic = new THREE.Mesh(
			new THREE.SphereGeometry(0.05, 8, 8),
			this.track(new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 })),
		);
		mic.position.set(0.35, 1.55, 0.35);
		body.add(mic);

		this.group.add(body);
	}

	private makeNamePlate(): THREE.Sprite {
		const c = document.createElement('canvas');
		c.width = 320;
		c.height = 96;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = 'rgba(15,23,42,0.92)';
		ctx.fillRect(0, 0, 320, 96);
		ctx.fillStyle = '#f472b6';
		ctx.font = 'bold 28px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('DJ BARTEK', 160, 40);
		ctx.fillStyle = '#e2e8f0';
		ctx.font = '16px system-ui,sans-serif';
		ctx.fillText('Trap-gat · druk E · requests', 160, 70);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sp = new THREE.Sprite(
			this.track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })),
		);
		sp.scale.set(2.4, 0.72, 1);
		sp.position.set(0, 2.9, 0.2);
		return sp;
	}

	private makeCanvasPlane(
		lines: string[],
		w: number,
		h: number,
		bg: string,
		fg: string,
	): THREE.Mesh {
		const c = document.createElement('canvas');
		c.width = 512;
		c.height = 256;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 512, 256);
		ctx.fillStyle = fg;
		ctx.textAlign = 'center';
		ctx.font = 'bold 48px system-ui,sans-serif';
		lines.forEach((line, i) => {
			ctx.font = i === 0 ? 'bold 56px system-ui' : '28px system-ui';
			ctx.fillText(line, 256, 70 + i * 55);
		});
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		return new THREE.Mesh(
			new THREE.PlaneGeometry(w, h),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
	}
}

export const BARTEK_LINES = {
	greet:
		'Wow, hoe gaat het met je jongen? Ik ben DJ Bartek, Bartek, Bartek! Welkom bij het trap-gat. Request een plaatje en ik draai hem live.',
	requestOk: (song: string) =>
		`Bartek, Bartek! Goede keuze. Ik download ${song} en gooi hem op de decks. Yallah, dansen!`,
	requestFail: 'Ai jongen, yt-dlp hapert. Probeer een andere titel. Bartek blijft staan bij de trap.',
	noKey:
		'ElevenLabs key mist nog, dus ik praat via browser-stem. Zet ELEVENLABS_API_KEY in je .env — Bartek wil écht klinken.',
	probe:
		'Yo kijk omhoog! Aliens proberen de Amerikanen! Bartek blijft draaien terwijl de UFO ze scant. Drama, jongen, pure mall-drama!',
	/** Ambient drama he shouts into the mall */
	drama: [
		'Brad, leg die vitamines neer en DANS, jij thicc legende!',
		'Iemand request Kruidvat-core? Nee? Dan draait Bartek wat hij wil!',
		'West-trap is van MIJ. Roltrap mag de rest hebben. Bartek, Bartek!',
		'Miss Dakota, jij bent een vibe, maar mijn drop is zwaarder dan je sash.',
		'Aliens boven de foodcourt? Ik mix harder dan hun beam!',
		'Youssef bij Kruidvat, stuur me vitamines, de set is lang!',
		'Prairie Lakes, handen omhoog of de baard-dief pakt je headphones!',
		'Liefde in de aisles, drama op de trap — welkom bij Bartek Live!',
	],
	idle: [
		'Bartek, Bartek, Bartek op de trap!',
		'Request me een plaatje jongen.',
		'Dit is live, geen bubbels — echte muziek.',
		'Prairie Lakes, Bartek in the building.',
		'Ik hoor jullie niet. LUIDER. Bartek wil drama!',
	],
	crowdReact: [
		'BARTEK! BARTEK!',
		'Squeak… drop… squeak!',
		'Komunicare: banger detected',
		'Thicc and thriving!',
	],
};

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}
