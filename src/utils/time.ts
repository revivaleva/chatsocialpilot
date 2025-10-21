export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function nowIso() { return new Date().toISOString(); }
export function minutes(n: number) { return n * 60 * 1000; }


