/**
 * Phase 5 — labor 모듈: 하루 노동 가능 시간(자가 + 고용 × 숙련도)과 실제 사용, 밀린 작업, 인건비.
 * 작물 모듈은 예정 작업을 할 때 오늘 남은 시간(state.labor.left)만큼만 한다(crop/phys.ts runScheduled).
 * 사용자가 직접 지시한 작업은 시간이 모자라도 하며, 넘친 만큼은 초과 근무(over)로 기록한다.
 */
import { strip } from '../greenhouse/params';
import type { EngineModule, SimState } from '../types';
import type { World } from '../world';
import type { LaborParams, LaborSettings, LaborState } from './types';

export * from './types';

export function buildLaborParams(raw: unknown): LaborParams {
  return strip(raw) as LaborParams;
}

export function defaultLabor(p: LaborParams): LaborSettings {
  return { owners: p.owners, ownerHours: p.ownerHours, workers: 0, workerHours: p.workerHours, wage: p.wage, skill: 'normal', autoHire: p.autoHire };
}

export function capacityOfLabor(p: LaborParams, s: LaborSettings): number {
  return s.owners * s.ownerHours + s.workers * s.workerHours * (p.skill[s.skill] ?? 1);
}

const cropHours = (s: SimState) => {
  let h = 0;
  if (s.crop) for (const v of Object.values(s.crop.laborHours)) h += v;
  return h;
};

export function initLabor(world: World, state: Pick<SimState, 'crop' | 'rz'>): LaborState {
  const set = world.config.labor ?? defaultLabor(world.labor);
  const cap = capacityOfLabor(world.labor, set);
  return { set, day: 0, cap, used: 0, left: cap, over: 0, lateSince: {}, cum: { used: 0, over: 0, hired: 0, wage: 0, days: 0 }, hist: [], seen: { crop: cropHours(state as SimState), rz: state.rz?.total.labor ?? 0 } };
}

export const laborModule: EngineModule = {
  id: 'labor',
  title: '작업(적엽·적과·유인·스카우팅 등)과 노동 시간',
  plannedPhase: 5,
  implemented: true,
  step(state, { world, actions }): SimState {
    const p = world.labor;
    let L: LaborState = state.labor ?? initLabor(world, state);
    L = { ...L, cum: { ...L.cum } };
    for (const a of actions) {
      if (a.type !== 'labor/set') continue;
      const set = { ...L.set, ...(a.payload as Partial<LaborSettings>) };
      const cap = capacityOfLabor(p, set);
      // 오늘 처음 고용한 인원은 오늘 일당을 낸다
      const add = set.workers - L.set.workers;
      if (add > 0) {
        L.cum.wage += add * set.wage;
        L.cum.hired += add * set.workerHours;
      }
      L = { ...L, set, cap, left: cap - L.used > 0 ? cap - L.used : 0 };
    }
    const day = Math.floor(state.hour / 24);
    // ── 새 날: 어제 기록, 일당 지급, 시간 초기화 ──
    if (day !== L.day) {
      const c = state.crop;
      const late = c?.deferred ?? [];
      const lateSince = { ...L.lateSince };
      for (const k of Object.keys(lateSince) as (keyof typeof lateSince)[]) if (!late.includes(k)) delete lateSince[k];
      for (const k of late) if (lateSince[k] === undefined) lateSince[k] = L.day;
      const hired = c && c.hired && c.hiredDay === L.day ? c.hired : 0;
      const hist = [...L.hist, { d: L.day, cap: L.cap, used: L.used, over: L.over, late: [...late], hf: c?.harvestFrac ?? 1, hired }];
      // 어제 자동으로 부른 일용 인력 일당
      L.cum.wage += hired * L.set.wage;
      L.cum.hired += hired * L.set.workerHours;
      L.cum.days = (L.cum.days ?? 0) + hired;
      // 오늘 고정 고용 인력 일당
      L.cum.wage += L.set.workers * L.set.wage;
      L.cum.hired += L.set.workers * L.set.workerHours;
      L = { ...L, day, used: 0, over: 0, cap: capacityOfLabor(p, L.set), lateSince, hist: hist.length > 60 ? hist.slice(hist.length - 60) : hist };
      L.left = L.cap;
    }
    // ── 이번 시간 사용량: 작물 작업 + 근권 작업 + 살포·스카우팅 ──
    const ch = cropHours(state);
    const rh = state.rz?.total.labor ?? 0;
    const dc = ch >= L.seen.crop ? ch - L.seen.crop : ch;
    const dr = rh >= L.seen.rz ? rh - L.seen.rz : rh;
    const used = dc + dr + (state.phys?.hoursNow ?? 0);
    if (used > 0 || ch !== L.seen.crop || rh !== L.seen.rz) {
      const u = L.used + used;
      // 오늘 자동으로 부른 일용 인력 시간은 가용 시간에 더한다
      const c = state.crop;
      const hiredCap = c && c.hired && c.hiredDay === day ? c.hired * L.set.workerHours * (p.skill[L.set.skill] ?? 1) : 0;
      const cap = capacityOfLabor(p, L.set) + hiredCap;
      L = { ...L, cap, used: u, left: cap - u > 0 ? cap - u : 0, over: u > cap ? u - cap : 0, seen: { crop: ch, rz: rh } };
      L.cum.used += used;
    }
    return { ...state, labor: L };
  },
};
