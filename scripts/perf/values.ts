/** Parse values returned from the page at the untyped process boundary. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readNumber(source: Record<string, unknown>, key: string, fallback = 0): number {
	const value = source[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function readString(source: Record<string, unknown>, key: string, fallback = ''): string {
	const value = source[key];
	return typeof value === 'string' ? value : fallback;
}

export function readBoolean(source: Record<string, unknown>, key: string): boolean {
	return source[key] === true;
}

export function readArray(source: Record<string, unknown>, key: string): unknown[] {
	const value = source[key];
	return Array.isArray(value) ? value : [];
}
