/**
 * Wederkerige snelheidsobstakels (ORCA) voor de lopende menigte.
 *
 * Van den Berg e.a., "Reciprocal n-body collision avoidance" (ISRR 2009): twee
 * lopers leiden allebei hetzelfde snelheidsobstakel af en nemen er allebei de
 * helft van, dus samen lossen ze de botsing precies één keer op. Dat is het
 * verschil met een duwtje per paar: de correctie volgt uit de gemeten
 * sluitingssnelheid en niet uit wie er toevallig eerst in de lus zat.
 *
 * Puur en zonder scene: getal in, getal uit, zodat de wiskunde los te testen is
 * van de sims die hem gebruiken.
 */
import { clamp, half } from '#/util/math';

/** Een lichaam in het XZ-vlak: waar het staat, hoe hard het gaat, hoe dik het is. */
export type OrcaBody = Readonly<{
	x: number;
	z: number;
	vx: number;
	vz: number;
	radius: number;
}>;

/**
 * Een toegestane halfruimte van snelheden: `v` mag als `(v − p) · n >= 0`, met
 * `n` als eenheidsvector.
 */
export type VelocityConstraint = Readonly<{
	px: number;
	pz: number;
	nx: number;
	nz: number;
}>;

/** Een as-uitgelijnde doos in het grondvlak. */
export type PlanBox = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;

/** Twee lichamen op exact dezelfde plek hebben geen richting om uit elkaar te gaan; daaronder kiest de code er zelf een. */
const DEGENERATE = 1e-6;

/** Ieder van twee lopers neemt de helft van de correctie. Een muur loopt niet mee en laat de volle correctie liggen. */
export const RECIPROCAL_SHARE = half(1);

/**
 * Het halfvlak dat `self` moet respecteren om `other` binnen `horizon` seconden
 * te missen, met `share` als het deel van de correctie dat `self` op zich neemt.
 *
 * De normaal komt van de rand van het snelheidsobstakel en niet van `u`: zodra
 * de relatieve snelheid al buiten die rand ligt wijst `u` er juist naartoe, en
 * dan zou een halfvlak op `u` een loper afremmen die al uit de weg gaat.
 *
 * `dt` telt alleen mee als de twee al in elkaar staan: dan is de horizon de
 * frametijd, want die overlap moet er nu uit en niet over een seconde.
 */
export function agentConstraint(
	self: OrcaBody,
	other: OrcaBody,
	horizon: number,
	dt: number,
	share: number,
): VelocityConstraint | null {
	const rx = other.x - self.x;
	const rz = other.z - self.z;
	const rvx = self.vx - other.vx;
	const rvz = self.vz - other.vz;
	const distSq = rx * rx + rz * rz;
	const combined = self.radius + other.radius;
	const combinedSq = combined * combined;
	const inside = distSq <= combinedSq;
	// Al in elkaar: dezelfde constructie met de frametijd als horizon.
	const invHorizon = inside ? 1 / dt : 1 / horizon;

	const wx = rvx - rx * invHorizon;
	const wz = rvz - rz * invHorizon;
	const wLengthSq = wx * wx + wz * wz;
	const alongR = wx * rx + wz * rz;
	const onCircle = inside || (alongR < 0 && alongR * alongR > combinedSq * wLengthSq);

	if (onCircle) {
		// Voorbij de mond van de kegel: de dichtstbijzijnde rand is de cirkel zelf.
		const wLength = Math.sqrt(wLengthSq);
		if (wLength < DEGENERATE) return null;
		const nx = wx / wLength;
		const nz = wz / wLength;
		const reach = combined * invHorizon - wLength;
		return { px: self.vx + nx * reach * share, pz: self.vz + nz * reach * share, nx, nz };
	}

	// Anders de dichtstbijzijnde flank van de kegel. Beide vormen hebben al lengte
	// één, want de teller meet distSq.
	const leg = Math.sqrt(distSq - combinedSq);
	const left = rx * wz - rz * wx > 0;
	const dirX = left ? (rx * leg - rz * combined) / distSq : -(rx * leg + rz * combined) / distSq;
	const dirZ = left ? (rx * combined + rz * leg) / distSq : (rx * combined - rz * leg) / distSq;
	const along = rvx * dirX + rvz * dirZ;
	const ux = dirX * along - rvx;
	const uz = dirZ * along - rvz;
	return { px: self.vx + ux * share, pz: self.vz + uz * share, nx: -dirZ, nz: dirX };
}

/**
 * Het halfvlak dat `self` van een muur weghoudt: hij mag het gat naar de doos in
 * `horizon` seconden opmaken en niet sneller, en staat hij er al in, dan moet hij
 * er deze frame uit.
 *
 * De normaal komt van het dichtstbijzijnde punt op de doos, en dat is bij een
 * vlakke wand exact de wandnormaal; bij een hoek staat hij schuiner en is de eis
 * strenger dan nodig. Een muur beweegt niet mee, dus de loper draagt de hele
 * correctie in plaats van de helft.
 */
export function staticConstraint(self: OrcaBody, box: PlanBox, horizon: number, dt: number): VelocityConstraint {
	const dx = self.x - clamp(self.x, box.minX, box.maxX);
	const dz = self.z - clamp(self.z, box.minZ, box.maxZ);
	const dist = Math.hypot(dx, dz);
	let nx = 0;
	let nz = 0;
	let gap = 0;
	if (dist >= DEGENERATE) {
		nx = dx / dist;
		nz = dz / dist;
		gap = dist - self.radius;
	} else {
		// Middelpunt in de doos: eruit langs de dichtstbijzijnde zijde, en het gat
		// is dan de weg naar die zijde plus de straal die er nog achteraan komt.
		const toMinX = self.x - box.minX;
		const toMaxX = box.maxX - self.x;
		const toMinZ = self.z - box.minZ;
		const toMaxZ = box.maxZ - self.z;
		const nearest = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
		nx = nearest === toMinX ? -1 : nearest === toMaxX ? 1 : 0;
		nz = nx === 0 ? (nearest === toMinZ ? -1 : 1) : 0;
		gap = -(nearest + self.radius);
	}
	const approach = gap < 0 ? gap / dt : gap / horizon;
	return { px: -nx * approach, pz: -nz * approach, nx, nz };
}

/**
 * De toegestane snelheid het dichtst bij de gewenste.
 *
 * Gauss-Seidel-projectie over de halfvlakken in plaats van de ORCA-LP: een
 * onoplosbare verzameling (drie kanten dicht in een gang) levert hier de minst
 * geschonden snelheid in plaats van een uitzondering, en dat geval komt in een
 * volle mall vaker voor dan het optimum een halve centimeter waard is.
 */
export function solveVelocity(
	prefVx: number,
	prefVz: number,
	maxSpeed: number,
	constraints: readonly VelocityConstraint[],
	rounds: number,
): { vx: number; vz: number } {
	let vx = prefVx;
	let vz = prefVz;
	const wanted = Math.hypot(vx, vz);
	if (wanted > maxSpeed && wanted > DEGENERATE) {
		vx = (vx / wanted) * maxSpeed;
		vz = (vz / wanted) * maxSpeed;
	}
	for (let round = 0; round < rounds; round++) {
		let worst = 0;
		for (const c of constraints) {
			const slack = (vx - c.px) * c.nx + (vz - c.pz) * c.nz;
			if (slack >= 0) continue;
			worst = Math.max(worst, -slack);
			vx -= c.nx * slack;
			vz -= c.nz * slack;
		}
		const speed = Math.hypot(vx, vz);
		if (speed > maxSpeed && speed > DEGENERATE) {
			vx = (vx / speed) * maxSpeed;
			vz = (vz / speed) * maxSpeed;
		}
		if (worst < DEGENERATE) break;
	}
	return { vx, vz };
}
