/**
 * 작물 모듈 공용: 생장조절제·생리장해 효과 적용(잎 소실, 과실 노출, 수확 등급 하락)과 노동 한도 안에서의 예정 작업.
 * 효과의 크기는 physiology 모듈이 계산해 env.fx로 넘긴다. 여기서는 그 효과를 작물의 기관에 그대로 적용하고,
 * 실제로 생긴 피해량을 c.physLoss에 기록한다(원장: 원인 → 위험 → 발생 → 피해량).
 */
import { dexp } from '../dmath';
import type { PhysFx } from '../physiology/types';
import type { CropState, Fruit, LeafNode, WorkTask } from './types';

export function addLoss(c: CropState, key: string, v: number) {
  if (v <= 0) return;
  c.physLoss = { ...(c.physLoss ?? {}), [key]: (c.physLoss?.[key] ?? 0) + v };
}

/** 잎 소실: 대상 잎(전개 중 / 위 1/3 / 아래 1/3 / 전체)의 면적·건물을 시간당 비율만큼 줄인다. m = 포기 m⁻². */
export function applyLeafLoss(c: CropState, fx: PhysFx, expandDays: number, m: number) {
  if (!fx.leaf.length || !c.nodes.length) return;
  const n = c.nodes.length;
  const third = Math.max(1, Math.round(n / 3));
  for (const l of fx.leaf) {
    if (l.rate <= 0) continue;
    const r = l.rate > 1 ? 1 : l.rate;
    let lost = 0;
    for (let i = 0; i < n; i++) {
      const node: LeafNode = c.nodes[i]!;
      const hit = l.target === 'all' || (l.target === 'young' && node.age < expandDays * 1.5) || (l.target === 'upper' && i >= n - third) || (l.target === 'old' && i < third);
      if (!hit || node.area <= 0) continue;
      lost += node.area * r;
      node.area *= 1 - r;
      node.w *= 1 - r;
    }
    addLoss(c, l.key, lost * m);
  }
}

/** 과실 노출: 창(개화 후 생리일) 안에 있는 꽃·과실에 키별 노출을 쌓는다. */
export function exposeFruits(c: CropState, fx: PhysFx, dpd: number) {
  const keys = Object.keys(fx.fruitRisk);
  if (!keys.length || dpd <= 0) return;
  for (const f of c.fruits) {
    for (const k of keys) {
      const r = fx.fruitRisk[k]!;
      if (r.rate <= 0 || f.age < r.a0 || f.age > r.a1) continue;
      f.dis = { ...(f.dis ?? {}), [k]: (f.dis?.[k] ?? 0) + r.rate * dpd };
    }
  }
}

/** 수확 등급 하락: 과실 하나의 노출로 증상 비율(1 − e^−노출)을 구해 상품 → 중품/비상품으로 옮기고 키별 kg를 기록한다. */
export function applyDefects(part: { top: number; mid: number; cull: number }, f: Fruit, fx: PhysFx, c: CropState) {
  if (!f.dis) return part;
  let keepC = 1;
  let keepM = 1;
  const pk: [string, number, 'mid' | 'cull'][] = [];
  for (const [k, e] of Object.entries(f.dis)) {
    const g = fx.grades[k];
    if (!g || e <= 0) continue;
    const p = 1 - dexp(-e);
    pk.push([k, p, g]);
    if (g === 'cull') keepC *= 1 - p;
    else keepM *= 1 - p;
  }
  if (!pk.length) return part;
  const pc = 1 - keepC;
  const pm = 1 - keepM;
  const toCull = (part.top + part.mid) * pc;
  const toMid = part.top * (1 - pc) * pm;
  const out = { top: part.top * (1 - pc) * (1 - pm), mid: part.mid * (1 - pc) + toMid, cull: part.cull + toCull };
  // 피해 kg를 원인별 비율로 나눠 기록한다
  let sc = 0;
  let sm = 0;
  for (const [, p, g] of pk) if (g === 'cull') sc += p; else sm += p;
  for (const [k, p, g] of pk) addLoss(c, k, g === 'cull' ? (sc > 0 ? (toCull * p) / sc : 0) : sm > 0 ? (toMid * p) / sm : 0);
  return out;
}

export interface Sched {
  task: WorkTask;
  /** 예상 작업 시간(h, 온실 전체) */
  est: number;
  run: (frac: number) => void;
  /** 일부만 할 수 있는 작업(수확): 고정 시간 */
  partialBase?: number;
}

/**
 * 노동 한도 안에서 예정 작업을 우선순위대로 한다. 모자라면 미루고(밀린 작업), 수확은 할 수 있는 만큼만 한다.
 * 미룬 작업은 마지막 작업일이 갱신되지 않으므로 다음 날 다시 예정에 오른다.
 */
export function runScheduled(c: CropState, left0: number, list: Sched[], auto?: { hours: number; per: number }) {
  const deferred: WorkTask[] = [];
  // 자동 일용 고용: 오늘 할 일이 남은 시간을 넘으면 일용 인력을 최대 인원까지 부른다(하루 단위로 고용)
  const autoH = auto && auto.hours > 0 ? auto.hours : 0;
  let left = left0 + autoH;
  let partial = 1;
  for (const s of list) {
    const before = c.today.labor;
    if (s.est <= left + 1e-9) s.run(1);
    else if (s.partialBase !== undefined && left > s.partialBase + 1e-6 && s.est > s.partialBase) {
      partial = (left - s.partialBase) / (s.est - s.partialBase);
      s.run(partial);
      deferred.push(s.task);
    } else {
      deferred.push(s.task);
      continue;
    }
    left -= c.today.labor - before;
    if (left < 0) left = 0;
  }
  c.deferred = deferred;
  c.harvestFrac = partial;
  const extra = left0 + autoH - left - left0;
  c.hired = autoH > 0 && extra > 1e-6 && auto ? Math.ceil(extra / auto.per - 1e-9) : 0;
  c.hiredDay = c.today.dayIndex;
}

export const hoursOf = (h10a: number, area: number) => (h10a * area) / 1000;
