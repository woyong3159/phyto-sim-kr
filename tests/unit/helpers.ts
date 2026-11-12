import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorld, type EngineData, type SimConfig } from '../../src/engine';

const load = (f: string) => JSON.parse(readFileSync(join(__dirname, `../../data/${f}.json`), 'utf8')).params;
export const data: EngineData = { regions: load('regions'), climate: load('climate'), events: load('events') };
export const config: SimConfig = { seed: 'test-seed-1', startDate: '2026-09-01', regionId: 'buyeo' };
export const world = createWorld(config, data);
export const worldOf = (patch: Partial<SimConfig>) => createWorld({ ...config, ...patch }, data);
