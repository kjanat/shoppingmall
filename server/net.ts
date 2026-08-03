import { env } from 'bun';

/**
 * Afzenderherkenning voor endpoints die iets extra's prijsgeven.
 *
 * Achter een reverse proxy is de peer de proxy, niet de bezoeker. Het echte
 * adres staat dan in `X-Forwarded-For`, en die header telt alleen mee als de
 * peer zelf niet publiek is: anders zet een bezoeker hem gewoon zelf.
 */

/** IPv4 als 32-bits getal, of null als het er geen is. */
function v4(ip: string): number | null {
	const plain = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
	const parts = plain.split('.');
	if (parts.length !== 4) return null;
	let n = 0;
	for (const part of parts) {
		const byte = Number(part);
		if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
		n = n * 256 + byte;
	}
	return n;
}

function isPrivate(ip: string): boolean {
	if (ip === '::1' || ip === 'localhost') return true;
	const n = v4(ip);
	if (n === null) return ip.startsWith('fc') || ip.startsWith('fd');
	return n >>> 24 === 10 || n >>> 24 === 127 || n >>> 20 === 0xac1 || n >>> 16 === 0xc0a8 || n >>> 16 === 0xa9fe;
}

/**
 * Adres van de bezoeker.
 *
 * Staat er een CDN voor, dan is de laatste hop de edge en niet de afzender.
 * `CF-Connecting-IP` wordt door dat CDN altijd zelf overschreven, dus die gaat
 * voor. Anders de laatste entry en niet de eerste: een proxy plakt de afzender
 * achteraan, dus alles daarvóór kan de bezoeker zelf hebben meegestuurd.
 */
export function clientIp(req: Request, peer: string): string {
	if (!isPrivate(peer)) return peer;
	const cdn = req.headers.get('cf-connecting-ip')?.trim();
	if (cdn) return cdn;
	const hops = req.headers.get('x-forwarded-for')?.split(',') ?? [];
	return hops[hops.length - 1]?.trim() || peer;
}

/**
 * Vergelijkbare vorm van een adres. IPv6 op /64: het hostdeel roteert door
 * privacy-extensies, dus het volledige adres verschilt per verbinding.
 */
function key(ip: string): string {
	if (v4(ip) !== null) return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
	const hextets = ip.split(':');
	return hextets.length > 4 ? hextets.slice(0, 4).join(':').toLowerCase() : ip.toLowerCase();
}

/**
 * Uitgaande adressen van deze host, beide families. Uit PUBLIC_IP (komma's
 * toegestaan), anders één keer opgevraagd. Lukt dat niet, dan blijft de set
 * leeg en valt de vergelijking dicht.
 */
const configured = (env['PUBLIC_IP'] ?? '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
let outward: Set<string> | null = configured.length ? new Set(configured.map(key)) : null;
let asking: Promise<Set<string>> | null = null;

async function outwardIps(): Promise<Set<string>> {
	if (outward) return outward;
	asking ??= (async () => {
		const found = new Set<string>();
		await Promise.all(
			['https://api4.ipify.org', 'https://api6.ipify.org'].map(async (url) => {
				try {
					const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
					if (res.ok) {
						const ip = (await res.text()).trim();
						if (ip) found.add(key(ip));
					}
				} catch {
					// Dicht laten.
				}
			}),
		);
		outward = found;
		return found;
	})();
	return asking;
}

/**
 * Van het eigen net, of achter hetzelfde uitgaande adres.
 *
 * In een container zegt `networkInterfaces()` niets over het net van de host,
 * dus die vergelijking kan hier niet. Een niet-routeerbaar adres kan alleen van
 * binnen komen: de proxy vult dit veld zelf in en de bezoeker kan er niet meer
 * bij, want alleen de laatste entry telt.
 */
export async function isOurs(ip: string): Promise<boolean> {
	if (isPrivate(ip)) return true;
	return (await outwardIps()).has(key(ip));
}
