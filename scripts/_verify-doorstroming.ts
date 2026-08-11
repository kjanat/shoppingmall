#!/usr/bin/env bun
/** Scratch: meet de sim-stap en kijk wie er vastloopt. Wordt weer weggegooid. */
import { CollisionWorld } from '#/physics/Collision';
import { stubDocument } from './stub-dom.ts';

stubDocument();
const { Americans } = await import('#/scene/Americans');
const THREE = await import('three');

const AANTAL = Number(process.env['SIMS'] ?? 48);
const SECONDEN = Number(process.env['SECONDEN'] ?? 240);
const DT = 1 / 60;

const wereld = new CollisionWorld();
const menigte = new Americans(wereld, AANTAL);
const kijker = new THREE.Vector3(0, 0.15, 0);

type Volg = {
	naam: string;
	doel: string;
	aankomsten: number;
	x: number;
	z: number;
	stilstand: number;
	langsteStilstand: number;
	langsteX: number;
	langsteZ: number;
	afgelegd: number;
	eersteAankomst: number;
};

const volg = new Map<number, Volg>();
const rijen = menigte.getPeopleSnapshot(kijker);
for (const r of rijen) {
	const f = menigte.roster.find((x) => x.id === r.id);
	volg.set(r.id, {
		naam: r.name,
		doel: f?.targetShopId ?? '',
		aankomsten: 0,
		x: r.x,
		z: r.z,
		stilstand: 0,
		langsteStilstand: 0,
		langsteX: r.x,
		langsteZ: r.z,
		afgelegd: 0,
		eersteAankomst: -1,
	});
}

// Stilstandvenster: hoeveel meter een gast binnen hoeveel seconden moet halen.
const VENSTER = 25;
const METERS = 2;

let tijd = 0;
let kosten = 0;
let frames = 0;
const uit: typeof rijen = [];
while (tijd < SECONDEN) {
	const t0 = performance.now();
	menigte.update(DT);
	kosten += performance.now() - t0;
	frames++;
	tijd += DT;

	menigte.getPeopleSnapshot(kijker, uit);
	for (const r of uit) {
		const v = volg.get(r.id);
		if (!v) continue;
		const f = menigte.roster.find((x) => x.id === r.id);
		v.afgelegd += Math.hypot(r.x - v.x, r.z - v.z);
		v.x = r.x;
		v.z = r.z;
		if (f && f.targetShopId !== v.doel) {
			v.doel = f.targetShopId;
			v.aankomsten++;
			if (v.eersteAankomst < 0) v.eersteAankomst = tijd;
		}
		if (Math.hypot(r.x - v.langsteX, r.z - v.langsteZ) >= METERS) {
			v.langsteX = r.x;
			v.langsteZ = r.z;
			v.stilstand = 0;
		} else {
			v.stilstand += DT;
			v.langsteStilstand = Math.max(v.langsteStilstand, v.stilstand);
		}
	}
}

console.log(`sims ${AANTAL} · ${frames} frames · ${SECONDEN}s gesimuleerd`);
console.log(`sim-stap: ${(kosten / frames).toFixed(3)} ms/frame gemiddeld, ${kosten.toFixed(0)} ms totaal`);
console.log(`venster: minder dan ${METERS} m in ${VENSTER} s telt als vastgelopen`);
for (const [id, v] of [...volg.entries()].sort((a, b) => b[1].langsteStilstand - a[1].langsteStilstand)) {
	const vlag = v.langsteStilstand > VENSTER || v.aankomsten === 0 ? '✗' : ' ';
	console.log(
		`${vlag} #${id} ${v.naam.padEnd(18)} aankomsten ${String(v.aankomsten).padStart(2)} · eerste op ${v.eersteAankomst.toFixed(0).padStart(3)}s · langste stilstand ${v.langsteStilstand.toFixed(1).padStart(5)}s · afgelegd ${v.afgelegd.toFixed(0)}m · nu (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`,
	);
}
