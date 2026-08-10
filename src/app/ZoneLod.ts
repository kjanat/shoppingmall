/**
 * Simulatie-LOD op zichtbaarheid in plaats van op afstand.
 *
 * Een dek dat je niet kunt zien hoeft niet zestig keer per seconde bijgewerkt te
 * worden, maar het moet wel dóórlopen: de dief die onderweg is, de badgasten op
 * het dak en de bewakers een verdieping hoger horen er nog te zijn als je de hoek
 * om komt. Dus geen frames overslaan maar in grotere stappen rekenen — de tijd die
 * een systeem krijgt is elke seconde dezelfde, alleen in minder porties.
 *
 * Op zichtbaarheid en niet op afstand, want afstand geeft een klik op de drempel:
 * wie door de hoofdingang stapt zou anders een halve mall in één tik zien
 * inhalen. Zones wisselen precies daar waar je het toch al niet ziet gebeuren.
 */

/** Eén tik per kwartseconde (4 Hz) voor alles in een zone die de speler niet ziet. */
export const UNSEEN_TICK_SECONDS = 0.25;

/**
 * De klok van één systeem.
 *
 * `step` geeft de tijd terug die het systeem nu moet verwerken, of null zolang de
 * grove stap nog aan het vollopen is. Wat er in de wachttijd verstreek gaat mee in
 * de volgende stap, dus er raakt geen tijd zoek en niets loopt achter.
 */
export class CoarseTicker {
	private carry = 0;

	step(dt: number, seen: boolean): number | null {
		this.carry += dt;
		if (!seen && this.carry < UNSEEN_TICK_SECONDS) return null;
		const owed = this.carry;
		this.carry = 0;
		return owed;
	}
}
