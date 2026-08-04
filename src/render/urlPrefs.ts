/**
 * Ephemeral graphics overrides for reproducible client-side measurements.
 * Query values win for this page load but never overwrite the visitor's saved
 * preferences. That keeps a shared profiling URL from permanently changing the
 * game for whoever opens it.
 */
export function urlPref(name: string): string | null {
	try {
		return new URLSearchParams(location.search).get(name);
	} catch {
		return null;
	}
}

export function booleanUrlPref(name: string): boolean | undefined {
	const value = urlPref(name)?.toLowerCase();
	if (value === '1' || value === 'true' || value === 'on') return true;
	if (value === '0' || value === 'false' || value === 'off') return false;
	return undefined;
}

/**
 * Once a visitor changes an overridden setting in the panel, their choice must
 * survive the reload used by shader-baked settings. Otherwise the URL would
 * silently win again and make the control look broken.
 */
export function clearUrlPref(name: string): void {
	try {
		const url = new URL(location.href);
		if (!url.searchParams.has(name)) return;
		url.searchParams.delete(name);
		history.replaceState(history.state, '', url.toString());
	} catch {
		// A restricted browsing context can keep the override until navigation.
	}
}
