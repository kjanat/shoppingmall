/**
 * Client: ask OpenRouter (via /api/sim/chat) for a 2-line mall dialogue.
 */

export type SimPersona = {
	name: string;
	mood: string;
	lifeLine: string;
	targetShop: string;
	unhappiness: number;
	partnerName?: string | null;
	isKid?: boolean;
	isBrad?: boolean;
	isMiss?: boolean;
};

export type ChatExchange = { a: string; b: string };

let inflight = 0;
const MAX_INFLIGHT = 1;

/** Local fallback if OpenRouter is down — meaner when unhappy */
export function localBanter(a: SimPersona, b: SimPersona): ChatExchange {
	const an = a.name.split(' ')[0];
	const bn = b.name.split(' ')[0];
	const mean = a.unhappiness >= 55 || b.unhappiness >= 55;
	const roastA = [
		`Yo ${bn}, kijk uit met die trage kont.`,
		`Bro ${bn}, jij loopt als een karretje zonder wielen.`,
		a.isBrad ? 'Vitamines eerst. Jij ruikt naar food court.' : `${bn}, die outfit is een misdaad.`,
		a.isMiss ? 'Back off, basic. Sash zone.' : `Unhappy ${Math.round(a.unhappiness)}%. Jij helpt niet.`,
		`Koop iets of schuif op, ${bn}.`,
		`Lost in the mall? Typisch ${bn}.`,
	];
	const chillA = [
		`Yo ${bn}, jij ook naar ${a.targetShop.split(' ')[0]}?`,
		`Voeten op, man. ${Math.round(a.unhappiness)}% done.`,
		a.isBrad ? 'Kruidvat-run. Meekomen?' : `Sale vibes. Jij?`,
		a.isMiss ? 'Pageant energy. Compliment accepted.' : a.lifeLine.slice(0, 40),
	];
	const roastB = [
		`Hou je bek, ${an}. Jij bent erger.`,
		`Lol. Kijk in de spiegel, thicc king.`,
		b.isMiss ? 'Je sash is lelijker dan je attitude.' : `Tenminste ik weet waar ik heen ga.`,
		`Roast me later. Nu shoppen, loser.`,
		`${an}… jij botst met alles. Inclusief smaak.`,
		b.isBrad ? 'Drink je vitamine water ergens anders.' : `Oké drama queen, tot de kassa.`,
	];
	const chillB = [
		`Same energy, ${an}. ${b.targetShop} next.`,
		`Haha, bijna botsing. Chill.`,
		b.isKid ? 'IJSJE!' : `Unhappy ${Math.round(b.unhappiness)}. Help.`,
		b.isBrad ? 'Vitamines. Always.' : `Tot bij de loopband.`,
	];
	const poolA = mean ? roastA : chillA;
	const poolB = mean ? roastB : chillB;
	if (a.isKid) {
		return {
			a: ['Mag ik ijs?', 'Mama zei nee…', 'Ik wil NIET lopen!'][Math.floor(Math.random() * 3)],
			b: b.isKid
				? 'Ik ook! Race!'
				: ['Later, kiddo.', 'Geen ijs. Loop.', 'Okee okee, rustig.'][Math.floor(Math.random() * 3)],
		};
	}
	return {
		a: poolA[Math.floor(Math.random() * poolA.length)].slice(0, 48),
		b: poolB[Math.floor(Math.random() * poolB.length)].slice(0, 48),
	};
}

export async function fetchSimChat(
	a: SimPersona,
	b: SimPersona,
	context?: string,
): Promise<ChatExchange> {
	if (inflight >= MAX_INFLIGHT) return localBanter(a, b);
	inflight++;
	try {
		const res = await fetch('/api/sim/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ a, b, context }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			console.warn('[SimChat]', (err as { error?: string }).error ?? res.status);
			return localBanter(a, b);
		}
		const data = (await res.json()) as { ok?: boolean; a?: string; b?: string };
		if (data.a && data.b) return { a: data.a.slice(0, 52), b: data.b.slice(0, 52) };
		return localBanter(a, b);
	} catch (e) {
		console.warn('[SimChat] network', e);
		return localBanter(a, b);
	} finally {
		inflight--;
	}
}
