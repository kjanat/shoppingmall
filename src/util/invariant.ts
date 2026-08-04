/** Makes discriminated-union switches fail typechecking when a new variant is left unhandled. */
export function unreachable(value: never, context: string): never {
	throw new Error(`${context}: ${String(value)}`);
}
