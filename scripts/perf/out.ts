export const trimToColumns = (string: string, width = process.stdout.columns) => string.slice(0, width);
