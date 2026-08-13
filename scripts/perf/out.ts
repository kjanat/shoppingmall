import { stdout } from 'node:process';

export const trimToColumns = (string: string, width = stdout.columns) => string.slice(0, width);
