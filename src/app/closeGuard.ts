/**
 * Ctrl+W is hurken en vooruit, en in de browser sluit het je tabblad.
 *
 * Een pagina kan die sneltoets niet annuleren; alleen `beforeunload` zet er een
 * bevestiging voor. Chrome levert de keydown wel af voordat hij sluit, dus die
 * arm scheidt een verongelukte loopstap van een herlaadactie: zonder dat
 * onderscheid vraagt elke HMR-reload om bevestiging.
 */

/** Hoe lang na de sneltoets een unload nog aan die toets wordt toegeschreven (ms). */
const CLOSE_ARM_MS = 1000;

function closesTab(e: KeyboardEvent): boolean {
	if (e.code === 'KeyW') return e.ctrlKey || e.metaKey;
	return e.code === 'F4' && e.ctrlKey;
}

export function guardAccidentalClose(): void {
	let armedAt = Number.NEGATIVE_INFINITY;

	window.addEventListener(
		'keydown',
		(e) => {
			if (closesTab(e)) armedAt = performance.now();
		},
		// Capture, want een spelscherm dat de toets zelf afhandelt mag hem hier niet weghouden.
		{ capture: true },
	);

	window.addEventListener('beforeunload', (e) => {
		if (performance.now() - armedAt > CLOSE_ARM_MS) return;
		e.preventDefault();
		// Safari en oudere Chrome kijken hier nog naar in plaats van naar preventDefault.
		e.returnValue = '';
	});
}
