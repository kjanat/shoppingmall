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

/** Onder deze correctielengte ligt de snelheid al op de rand en verandert het halfvlak niets. */
const NEGLIGIBLE = 1e-9;

/** Ieder van twee lopers neemt de helft van de correctie. Een muur loopt niet mee en laat de volle correctie liggen. */
export const RECIPROCAL_SHARE = half(1);

function constraintFrom(vx: number, vz: number, ux: number, uz: number, share: number): VelocityConstraint | null {
	const length = Math.hypot(ux, uz);
	if (length < NEGLIGIBLE) return null;
	return { px: vx + ux * share, pz: vz + uz * share, nx: ux / length, nz: uz / length };
}

/**
 * Het halfvlak dat `self` moet respecteren om `other` binnen `horizon` seconden
 * te missen, met `share` als het deel van de correctie dat `self` op zich neemt.
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

	if (distSq > combinedSq) {
		const invHorizon = 1 / horizon;
		// Van de rand van de afgeknotte kegel naar de relatieve snelheid.
		const wx = rvx - rx * invHorizon;
		const wz = rvz - rz * invHorizon;
		const wLengthSq = wx * wx + wz * wz;
		const alongR = wx * rx + wz * rz;

		if (alongR < 0 && alongR * alongR > combinedSq * wLengthSq) {
			// Voorbij de mond van de kegel: projecteer op de cirkel.
			const wLength = Math.sqrt(wLengthSq);
			if (wLength < DEGENERATE) return null;
			const reach = combined * invHorizon - wLength;
			return constraintFrom(self.vx, self.vz, (wx / wLength) * reach, (wz / wLength) * reach, share);
		}

		// Anders op de dichtstbijzijnde flank. Beide vormen zijn al van lengte één,
		// want de teller meet distSq.
		const leg = Math.sqrt(distSq - combinedSq);
		const left = rx * wz - rz * wx > 0;
		const dirX = left ? (rx * leg - rz * combined) / distSq : -(rx * leg + rz * combined) / distSq;
		const dirZ = left ? (rx * combined + rz * leg) / distSq : (rx * combined - rz * leg) / distSq;
		const along = rvx * dirX + rvz * dirZ;
		return constraintFrom(self.vx, self.vz, dirX * along - rvx, dirZ * along - rvz, share);
	}

	// Al in elkaar: dezelfde constructie met de frametijd als horizon.
	const invStep = 1 / dt;
	const wx = rvx - rx * invStep;
	const wz = rvz - rz * invStep;
	const wLength = Math.hypot(wx, wz);
	if (wLength >= DEGENERATE) {
		const reach = combined * invStep - wLength;
		return constraintFrom(self.vx, self.vz, (wx / wLength) * reach, (wz / wLength) * reach, share);
	}
	// Op elkaar én even snel: zonder eigen richting is er geen normaal, dus langs
	// de verbindingslijn uit elkaar, en anders langs +x.
	const dist = Math.sqrt(distSq);
	const awayX = dist > DEGENERATE ? -rx / dist : 1;
	const awayZ = dist > DEGENERATE ? -rz / dist : 0;
	return constraintFrom(self.vx, self.vz, awayX * combined * invStep, awayZ * combined * invStep, share);
}

/**
 * Het halfvlak dat `self` van een muur weghoudt: hij mag het gat naar de doos
 * in `horizon` seconden opmaken en niet sneller.
 *
 * De normaal komt van het dichtstbijzijnde punt op de doos, en dat is bij een
 * vlakke wand exact de wandnormaal; bij een hoek staat hij schuiner en is de eis
 * strenger dan nodig. Een muur beweegt niet mee, dus de loper draagt de hele
 * correctie in plaats van de helft.
 */
export function staticConstraint(self: OrcaBody, box: PlanBox, horizon: number, dt: number): VelocityConstraint | null {
	let dx = self.x - clamp(self.x, box.minX, box.maxX);
	let dz = self.z - clamp(self.z, box.minZ, box.maxZ);
	let dist = Math.hypot(dx, dz);
	if (dist < DEGENERATE) {
		// Middelpunt in de doos: er uit langs de dichtstbijzijnde zijde.
		const toMinX = self.x - box.minX;
		const toMaxX = box.maxX - self.x;
		const toMinZ = self.z - box.minZ;
		const toMaxZ = box.maxZ - self.z;
		const nearest = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
		dx = nearest === toMinX ? -1 : nearest === toMaxX ? 1 : 0;
		dz = dx === 0 ? (nearest === toMinZ ? -1 : 1) : 0;
		dist = 1;
	}
	const nx = dx / dist;
	const nz = dz / dist;
	const gap = dist - self.radius;
	const approach = gap < 0 ? gap / dt : gap / horizon;
	return { px: nx * approach, pz: nz * approach, nx, nz };
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
		if (worst < NEGLIGIBLE) break;
	}
	return { vx, vz };
}
