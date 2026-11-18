/**
 * 오이 생육 모듈.
 *  - 마디(잎)·과실을 하나하나 추적한다(평균 한 포기 기준). 과실 수는 암꽃 비율·퇴화가 반영된 분수다
 *    (난수를 쓰지 않으므로 "0.6개"처럼 기대값으로 계산한다 — N2·N3).
 *  - 분배: 기관별 sink strength(잠재 생장 속도)에 비례(G5). 과실 잠재 생장은 개화 후 생리일수의 Gompertz 함수
 *    (Marcelis 1994의 Richards 함수와 같은 역할).
 *  - 착과: 개화 전후의 어린 과실은 공급/수요 비(source/sink)와 온도에 따라 퇴화한다 → 착과 주기(flush)가 저절로 생긴다.
 *  - 근권 수분·양분은 Phase 4 인터페이스: 지금은 가용도 1(충분), S_nut = 1.
 */
import type { RzSupply } from '../rootzone/types';
import type { PhysFx } from '../physiology/types';
import { dexp, dpow } from '../dmath';
import type { SimEvent } from '../types';
import { interp, trap, XG, type CanopyView } from './canopy';
import { addLoss, applyDefects, applyLeafLoss, exposeFruits, hoursOf, runScheduled, type Sched } from './phys';
import type { CoreParams, CropDay, CropState, CucumberParams, CucumberVariety, Curve, Fruit, LeafNode, PlantOrder, Stress, WorkPlan, WorkTask, Yield } from './types';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 발육 온도 반응(베타 함수, 0–1). */
export function beta(t: number, tb: number, to: number, tm: number): number {
  if (t <= tb || t >= tm) return 0;
  return ((tm - t) / (tm - to)) * dpow((t - tb) / (to - tb), (to - tb) / (tm - to));
}

export function defaultPlan(v: CucumberVariety): WorkPlan {
  return { trainEvery: 3, lateralKeep: v.female < 0.7 ? 1 : 0, removeBelowNode: 6, maxFruit: 0, deleafEvery: 7, leavesKeep: 20, pinchNode: 0, harvestEvery: 1, harvestWeight: 0 };
}

export const emptyYield = (): Yield => ({ top: 0, mid: 0, cull: 0, count: 0 });
export const noStress = (): Stress => ({ photo: 1, expand: 1, fruit: 1, set: 1, water: 1, nutrient: 1, salt: 1, sinkFeedback: 1, tempSet: 1, tempFruit: 1, ssr: 1, chill: 1, heat: 1, starve: 1, training: 1, dormancy: 1, pollination: 1, rootTemp: 1, light: 1 });
export const emptyDay = (dayIndex: number): CropDay => ({ dayIndex, gross: 0, maint: 0, growthResp: 0, gLeaf: 0, gStem: 0, gRoot: 0, gFruit: 0, demand: 0, supply: 0, harvest: emptyYield(), aborted: 0, labor: 0, sPhoto: 0, sExpand: 0, sFruit: 0, sSet: 0, lai: 0, nodes: 0, fruits: 0 });

export interface CropEnv {
  hour: number;
  hod: number;
  tIn: number;
  tLeaf: number;
  ppfd: number;
  /** 온실 모델이 계산한 이 시간의 총광합성·유지호흡·호흡 부족분 (g CH2O m⁻²) */
  gross: number;
  maint: number;
  starve: number;
  daylength: number;
  /** 실내 상대습도 %, 보광등 가동률(0–1), 외부 일사 W m⁻² */
  rh: number;
  /** 양액 온도 °C */
  tSol: number;
  lamp: number;
  solar: number;
  /** 온실 면적 m² (노동 시간 환산) */
  area: number;
  /** 근권 수분 가용도(0–1) */
  water: number;
  /** 근권 공급 계수(Phase 4: 양분·염해·근권 온도) */
  rz: RzSupply;
  /** 생장조절제·생리장해 효과(Phase 5) */
  fx: PhysFx;
  /** 오늘 남은 노동 시간(h, 온실 전체). Infinity = 제한 없음 */
  laborLeft: number;
  /** 자동 일용 고용 가능 시간(h)과 1인 시간 */
  laborAuto?: { hours: number; per: number };
}

/** 근권이 없을 때(정식 직전 등) 쓰는 중립 공급 */
export const NEUTRAL_SUPPLY: RzSupply = { water: 1, nutrient: 1, photo: [1, 1, 1], expand: 1, fruit: 1, set: 1, salt: 1, brix: 1, plantN: 1, tRoot: 20, rootAct: 1, tipburn: 0 };
export type CanopySupply = Pick<RzSupply, 'water' | 'photo'>;

export function plantCucumber(order: PlantOrder, p: CucumberParams, v: CucumberVariety, env: CropEnv): CropState {
  const sd = p.seedling;
  const nodes: LeafNode[] = [];
  const cap = p.leaf.maxArea * v.leafArea * sd.leafCap;
  for (let i = 0; i < sd.leaves; i++) {
    const area = sd.leafArea < cap ? sd.leafArea : cap;
    nodes.push({ age: (sd.leaves - i) / p.leaf.rate, area, w: sd.leafW / sd.leaves, cap: area > cap ? area : cap, peak: area, lat: 0 });
  }
  const density = clamp(order.density, 0.5, 6);
  const crop: CropState = {
    cropId: 'cucumber', varietyId: order.varietyId, system: order.system, density, plan: order.plan, plantedHour: env.hour,
    alive: 1, dead: false, deathCause: '', pd: 0, pool: 0, wStem: sd.stemW, wRoot: sd.rootW, growthResp: 0,
    nodes, fruits: [], tips: [], nodeFrac: 0, mainNodes: sd.leaves, pinched: false, untrained: 0,
    stemLength: sd.leaves * p.stem.internode * 0.5, lastInternode: p.stem.internode,
    t24: env.tIn, tAvg: env.tIn, nightAvg: env.tIn, nightSum: 0, nightN: 0, dayLenAvg: env.daylength, dliAvg: p.leaf.slaDliRef, dliToday: 0, ssrAvg: 1,
    lastTrain: Math.floor(env.hour / 24), lastDeleaf: Math.floor(env.hour / 24), lastHarvest: Math.floor(env.hour / 24), firstHarvestHour: -1,
    total: emptyYield(), laborHours: { plant: (p.labor.plant * env.area) / 1000 }, abortedTotal: 0,
    cum: { gross: 0, maint: 0, used: 0, rgCO2: 0, dm: 0, dmC: 0 },
    today: emptyDay(Math.floor(env.hour / 24)), yesterday: null,
    out: { lai: 0, leaves: sd.leaves, nodes: sd.leaves, fruits: 0, flowers: 0, wLeaf: 0, wStem: 0, wRoot: 0, wFruit: 0, pool: 0, ssr: 1, etiolation: 1, stemLength: 0, sla: p.leaf.sla, femaleRate: v.female, biggestFruit: 0, stress: noStress() },
  };
  crop.out = summarize(crop, p, v, 1, p.leaf.sla, crop.out.stress);
  return crop;
}

function dmcOf(p: CucumberParams, dli: number): number {
  const d = p.fruit.dmc + p.fruit.dmcLight * (dli - p.leaf.slaDliRef);
  return d < 0.025 ? 0.025 : d;
}

function femaleRate(c: CropState, p: CucumberParams, v: CucumberVariety, fxFemale = 0): number {
  const f = v.female - p.fruit.femaleNight * (c.nightAvg - p.fruit.femaleNightRef) - p.fruit.femaleDay * (c.dayLenAvg - p.fruit.femaleDayRef);
  // 생장조절제(에테폰 +, 지베렐린 −)는 환경으로 정해진 암꽃 비율에 더해진다
  return clamp(clamp(f, p.fruit.femaleMin, 1) + fxFemale, 0, 1);
}

function summarize(c: CropState, p: CucumberParams, v: CucumberVariety, ssr: number, sla: number, stress: Stress, fxFemale = 0): CropState['out'] {
  const m = c.density * c.alive;
  let area = 0;
  let wl = 0;
  let leaves = 0;
  for (const n of c.nodes) {
    area += n.area;
    wl += n.w;
    if (n.area > 0) leaves++;
  }
  let wf = 0;
  let fruits = 0;
  let flowers = 0;
  let big = 0;
  for (const f of c.fruits) {
    wf += f.n * f.w;
    if (f.age >= 0) {
      fruits += f.n;
      if (f.w > big) big = f.w;
    } else flowers += f.n;
  }
  return {
    lai: area * m, leaves, nodes: c.mainNodes, fruits, flowers, wLeaf: wl * m, wStem: c.wStem * m, wRoot: c.wRoot * m, wFruit: wf * m, pool: c.pool, ssr,
    etiolation: c.lastInternode / p.stem.internode, stemLength: c.stemLength, sla, femaleRate: femaleRate(c, p, v, fxFemale), biggestFruit: big / dmcOf(p, c.dliAvg), stress,
  };
}

export function shifted(c: Curve, lo: number, hi: number): Curve {
  return [c[0] + lo, c[1] + lo, c[2] + hi, c[3] + hi];
}

function trainingOver(c: CropState, p: CucumberParams): number {
  return clamp((c.untrained - p.training.limit) / p.training.limit, 0, 1);
}

export function feedback(c: CropState, core: CoreParams, wLeafM2: number): number {
  if (wLeafM2 <= 0) return 1;
  const r = c.pool / wLeafM2;
  const ph = core.photo;
  const f = 1 - (1 - ph.poolFeedbackMin) * clamp((r - ph.poolFeedbackStart) / (ph.poolFeedbackFull - ph.poolFeedbackStart), 0, 1);
  // 저장 한계: 당이 한없이 쌓이지 않도록 그 위에서는 광합성이 0까지 줄어든다
  const over = ph.poolFeedbackFull * ph.poolOverflow;
  return r > over ? f * (1 - clamp((r - over) / (over * 0.5), 0, 1)) : f;
}

/** 온실 모델에 넘길 군락 요약(이 시간 동안 고정). */
export function canopyOfCucumber(c: CropState, core: CoreParams, p: CucumberParams, v: CucumberVariety, sup: CanopySupply): CanopyView | null {
  return buildCanopy(c, core, p, v.pmaxFactor, 1 - p.training.clump * trainingOver(c, p), sup, 0);
}

/** 작물 공통: 잎 목록에서 군락 요약을 만든다. kScale = 흡광계수 배수, extraW = 관부 계수로 유지호흡을 셈할 추가 건물(포기당 g). */
export function buildCanopy(c: CropState, core: CoreParams, p: Pick<CucumberParams, 'photo' | 'leaf' | 'resp'>, pmaxFactor: number, kScale: number, sup: CanopySupply, extraW: number, reserveW = 0): CanopyView | null {
  const water = sup.water;
  if (c.dead) return null;
  const m = c.density * c.alive;
  let area = 0;
  let wl = 0;
  for (const n of c.nodes) {
    area += n.area;
    wl += n.w;
  }
  const lai = area * m;
  if (lai <= 0) return null;
  let wf = 0;
  for (const f of c.fruits) wf += f.n * f.w;
  const kdf = clamp(p.photo.kDiffuse - p.photo.kLaiSlope * lai, p.photo.kMin, 2) * kScale;
  const sPhoto = trap(core.water.photo, water) * feedback(c, core, (wl + reserveW) * m);
  const pm: [number, number, number] = [0, 0, 0];
  const af: [number, number, number] = [0, 0, 0];
  // 위(젊은 잎)에서 아래로 누적 엽면적을 따라가며 가우스 깊이에 있는 잎의 엽령을 찾는다
  let cumul = 0;
  let g = 0;
  for (let i = c.nodes.length - 1; i >= 0 && g < 3; i--) {
    const n = c.nodes[i]!;
    cumul += n.area;
    while (g < 3 && cumul >= area * XG[g]!) {
      const fa = interp(p.photo.ageX, p.photo.ageY, n.age);
      const lma = n.area > 0 ? clamp(n.w / n.area * p.leaf.sla, p.leaf.sla / p.leaf.slaMax, p.leaf.sla / p.leaf.slaMin) : 1;
      // 근권 양분: 군락 깊이별(위 신엽·가운데·아래 노엽) 광합성 계수 — 이동성 원소 결핍은 아래 잎부터
      pm[g] = p.photo.pmax * pmaxFactor * fa * sPhoto * dpow(lma, p.photo.lmaExp) * sup.photo[g]!;
      af[g] = 0.5 + 0.5 * fa;
      g++;
    }
  }
  for (; g > 0 && g < 3; g++) {
    pm[g] = pm[g - 1]!;
    af[g] = af[g - 1]!;
  }
  const r = p.resp;
  return { lai, kdf, pmax: pm, alphaF: af, tempCurve: p.photo.pmaxTemp, rm25: ((wl * r.leaf + (c.wStem + extraW) * r.stem + c.wRoot * r.root + wf * r.fruit) * m) / 86400, pool: c.pool, growthResp: c.growthResp, stomatalMin: p.photo.stomatalMin, waterStress: trap(core.water.photo, water) };
}

type Work = WorkTask;

export function addLabor(c: CropState, key: string, hoursPer10a: number, area: number) {
  const h = (hoursPer10a * area) / 1000;
  c.laborHours = { ...c.laborHours, [key]: (c.laborHours[key] ?? 0) + h };
  c.today.labor += h;
}

/** 지금 수확 기준에 든 과실 무게(kg m⁻²) — 노동 시간 예상용 */
export function readyKgCu(c: CropState, p: CucumberParams, v: CucumberVariety): number {
  const target = c.plan.harvestWeight > 0 ? c.plan.harvestWeight : v.harvestWeight;
  const dmc = dmcOf(p, c.dliAvg);
  const m = c.density * c.alive;
  let kg = 0;
  for (const f of c.fruits) {
    const fw = f.w / dmc;
    if (f.age >= 0 && (fw >= target || f.age > p.fruit.staleAge)) kg += (f.n * fw * m) / 1000;
  }
  return kg;
}

function doWork(c: CropState, w: Work, p: CucumberParams, v: CucumberVariety, env: CropEnv, events: SimEvent[], frac = 1) {
  const day = Math.floor(env.hour / 24);
  const m = c.density * c.alive;
  if (w === 'train') {
    c.untrained = 0;
    c.lastTrain = day;
    // 곁순 정리: 남길 마디 수만큼 자란 곁순은 순을 지른다(0이면 보이는 곁순을 모두 딴다)
    c.tips = c.tips.filter((t) => t.age < p.lateral.delay || t.made < c.plan.lateralKeep);
    // 적화: 아랫마디 암꽃 제거
    const before = c.fruits.length;
    c.fruits = c.fruits.filter((f) => f.node === 0 || f.node > c.plan.removeBelowNode);
    addLabor(c, 'train', p.labor.train, env.area);
    if (c.fruits.length !== before) addLabor(c, 'thin', p.labor.thin, env.area);
    if (c.plan.maxFruit > 0) doWork(c, 'thin', p, v, env, events);
    if (!c.pinched && c.plan.pinchNode > 0 && c.mainNodes >= c.plan.pinchNode) doWork(c, 'pinch', p, v, env, events);
  } else if (w === 'thin') {
    // 적과: 달린 과실이 상한을 넘으면 어린 것부터 딴다
    let total = 0;
    for (const f of c.fruits) if (f.age >= 0) total += f.n;
    let excess = total - (c.plan.maxFruit > 0 ? c.plan.maxFruit : total);
    if (excess > 0.01) {
      const order = c.fruits.filter((f) => f.age >= 0).sort((a, b) => a.age - b.age);
      for (const f of order) {
        if (excess <= 0) break;
        const cut = f.n < excess ? f.n : excess;
        f.n -= cut;
        excess -= cut;
      }
      c.fruits = c.fruits.filter((f) => f.n > 0.005);
      addLabor(c, 'thin', p.labor.thin, env.area);
    }
  } else if (w === 'pinch') {
    if (!c.pinched) {
      c.pinched = true;
      addLabor(c, 'pinch', p.labor.pinch, env.area);
    }
  } else if (w === 'deleaf') {
    c.lastDeleaf = day;
    // 원줄기 잎을 아래(늙은 것)부터 따서 정해 둔 잎 수만 남긴다. 딴 자리보다 아래에 있던 곁순 잎도 함께 정리된다.
    let cut = c.nodes.filter((n) => n.lat === 0).length - c.plan.leavesKeep;
    if (cut > 0) {
      let cutAge = 0;
      const kept: LeafNode[] = [];
      for (const n of c.nodes) {
        if (n.lat === 0 && cut > 0) {
          cut--;
          cutAge = n.age;
        } else kept.push(n);
      }
      c.nodes = kept.filter((n) => n.lat === 0 || n.age < cutAge);
    }
    addLabor(c, 'deleaf', p.labor.deleaf, env.area);
  } else if (w === 'harvest') {
    c.lastHarvest = day;
    const target = c.plan.harvestWeight > 0 ? c.plan.harvestWeight : v.harvestWeight;
    const dmc = dmcOf(p, c.dliAvg);
    const got = emptyYield();
    const keep: Fruit[] = [];
    for (const f of c.fruits) {
      const fw = f.w / dmc;
      const stale = f.age > p.fruit.staleAge;
      if (f.age < 0 || (fw < target && !stale)) {
        keep.push(f);
        continue;
      }
      // 노동이 모자라면 익은 과실 가운데 frac만큼만 따고 나머지는 달아 둔다(내일 더 커지거나 늙는다)
      const nh = f.n * frac;
      if (frac < 1) keep.push({ ...f, n: f.n - nh });
      const kg = (nh * fw * m) / 1000;
      const def = f.dur > 0 ? f.def / f.dur : 0;
      const curved = clamp((v.curveSens * (def - p.fruit.curveStart)) / (p.fruit.curveFull - p.fruit.curveStart), 0, 1);
      got.count += nh * m;
      let part = { top: 0, mid: 0, cull: 0 };
      if (stale && fw < target) part.cull = kg;
      else if (fw > target * p.fruit.oversize * p.fruit.oversizeCull) part.cull = kg;
      else if (fw > target * p.fruit.oversize) {
        part = { top: 0, mid: kg * (1 - curved), cull: kg * curved };
        addLoss(c, 'cu_curved', kg * curved);
      } else {
        part = { top: kg * (1 - curved), mid: kg * curved * (1 - curved), cull: kg * curved * curved };
        addLoss(c, 'cu_curved', kg * curved);
      }
      part = applyDefects(part, f, env.fx, c);
      got.top += part.top;
      got.mid += part.mid;
      got.cull += part.cull;
    }
    c.fruits = keep;
    const kgAll = got.top + got.mid + got.cull;
    if (kgAll > 0) {
      for (const k of ['top', 'mid', 'cull', 'count'] as const) {
        c.total[k] += got[k];
        c.today.harvest[k] += got[k];
      }
      if (c.firstHarvestHour < 0) {
        c.firstHarvestHour = env.hour;
        events.push({ hour: env.hour, type: 'crop', level: 'info', code: 'firstHarvest', value: (env.hour - c.plantedHour) / 24 });
      }
    }
    addLabor(c, 'harvest', p.labor.harvestBase + p.labor.harvestPerTon * kgAll, env.area);
  }
}

export interface CropStep {
  crop: CropState;
  events: SimEvent[];
}

/** 1시간 전진. works: 이번 시각에 사용자가 직접 지시한 작업. */
export function stepCucumber(c0: CropState, core: CoreParams, p: CucumberParams, v: CucumberVariety, env: CropEnv, works: readonly Work[]): CropStep {
  const events: SimEvent[] = [];
  if (c0.dead) return { crop: c0, events };
  const c: CropState = { ...c0, nodes: c0.nodes.map((n) => ({ ...n })), fruits: c0.fruits.map((f) => ({ ...f })), tips: c0.tips.map((t) => ({ ...t })), total: { ...c0.total }, cum: { ...c0.cum }, today: { ...c0.today, harvest: { ...c0.today.harvest } } };
  const day = Math.floor(env.hour / 24);

  // ── 하루 넘김: 어제 요약을 마감하고 이동평균을 갱신한다 ──
  if (env.hod === 0 && c.today.dayIndex !== day) {
    const t = c.today;
    c.yesterday = { ...t, sPhoto: t.sPhoto / 24, sExpand: t.sExpand / 24, sFruit: t.sFruit / 24, sSet: t.sSet / 24 };
    const ssrDay = t.demand > 0 ? clamp(t.supply / t.demand, 0, 1) : 1;
    c.ssrAvg += (ssrDay - c.ssrAvg) / p.fruit.ssrLag;
    c.dliAvg += (c.dliToday - c.dliAvg) / p.leaf.acclimDays;
    c.dliToday = 0;
    c.tAvg += (c.t24 - c.tAvg) / p.leaf.acclimDays;
    const night = c.nightN > 0 ? c.nightSum / c.nightN : c.t24;
    c.nightAvg += (night - c.nightAvg) / p.fruit.femaleLag;
    c.nightSum = 0;
    c.nightN = 0;
    c.dayLenAvg += (env.daylength - c.dayLenAvg) / p.fruit.femaleLag;
    c.today = emptyDay(day);
  }
  c.t24 += (env.tIn - c.t24) / 24;
  c.dliToday += (env.ppfd * 3600) / 1e6;
  if (env.ppfd < 5) {
    c.nightSum += env.tIn;
    c.nightN++;
  }

  // ── 작업(계획 + 직접 지시) ──
  for (const w of works) doWork(c, w, p, v, env, events);
  if (env.hod === p.labor.workHour) {
    // 예정 작업: 수확 → 유인 → 적엽 순서로, 오늘 남은 노동 시간 안에서만 한다(Phase 5)
    const pl = c.plan;
    const L = p.labor;
    const list: Sched[] = [];
    if (pl.harvestEvery > 0 && day - c.lastHarvest >= pl.harvestEvery) list.push({ task: 'harvest', est: hoursOf(L.harvestBase + L.harvestPerTon * readyKgCu(c, p, v), env.area), partialBase: hoursOf(L.harvestBase, env.area), run: (fr) => doWork(c, 'harvest', p, v, env, events, fr) });
    if (pl.trainEvery > 0 && day - c.lastTrain >= pl.trainEvery) list.push({ task: 'train', est: hoursOf(L.train + (pl.removeBelowNode > 0 || pl.maxFruit > 0 ? L.thin : 0), env.area), run: () => doWork(c, 'train', p, v, env, events) });
    if (pl.deleafEvery > 0 && day - c.lastDeleaf >= pl.deleafEvery) list.push({ task: 'deleaf', est: hoursOf(L.deleaf, env.area), run: () => doWork(c, 'deleaf', p, v, env, events) });
    runScheduled(c, env.laborLeft, list, env.laborAuto);
  }

  const m = c.density * c.alive;
  const fT = beta(env.tIn, p.dev.tBase, p.dev.tOpt, p.dev.tMax);
  const dpd = fT / 24;
  c.pd += dpd;

  // ── 탄소 장부: 온실 모델이 계산한 총광합성과 유지호흡을 저장고에 반영 ──
  c.pool += env.gross - env.maint;
  if (c.pool < 0) c.pool = 0;
  c.cum.gross += env.gross;
  c.cum.maint += env.maint;
  c.today.gross += env.gross;
  c.today.maint += env.maint;

  // ── 스트레스 계수(G3): 요인별 → 과정별 곱 ──
  let wLeaf = 0;
  for (const n of c.nodes) wLeaf += n.w;
  const sWaterExpand = trap(core.water.expand, env.water);
  const sWaterFruit = trap(core.water.fruit, env.water);
  const sWaterPhoto = trap(core.water.photo, env.water);
  const fb = feedback(c, core, wLeaf * m);
  const tempSet = trap(shifted(p.fruit.setTemp, v.coldTol, v.heatTol), c.t24);
  const tempFruit = trap(shifted(p.fruit.growTemp, v.coldTol, v.heatTol), env.tIn);
  // 착과는 최근 며칠 평균과 오늘 지금까지의 공급/수요 비 가운데 낮은 쪽을 따른다(급격한 부족에는 바로 반응)
  const ssrToday = c.today.demand > 0 ? c.today.supply / c.today.demand : c.ssrAvg;
  const sSsr = trap(p.fruit.setSsr, ssrToday < c.ssrAvg ? ssrToday : c.ssrAvg);
  const over = trainingOver(c, p);
  const starve = env.maint + env.starve > 0 ? 1 - env.starve / (env.maint + env.starve) : 1;
  const stress: Stress = {
    photo: sWaterPhoto * env.rz.nutrient * fb,
    expand: sWaterExpand * env.rz.expand,
    fruit: sWaterFruit * env.rz.fruit * tempFruit,
    set: tempSet * sSsr * env.rz.set,
    water: sWaterExpand,
    nutrient: env.rz.nutrient,
    salt: env.rz.salt,
    sinkFeedback: fb,
    tempSet,
    tempFruit,
    ssr: sSsr,
    chill: 1,
    heat: 1,
    starve,
    training: 1 - over,
    dormancy: 1,
    pollination: 1,
    rootTemp: 1,
    light: 1,
  };

  // ── 새 마디 ──
  const sla = clamp(p.leaf.sla * dpow(p.leaf.slaDliRef / (c.dliAvg > 1 ? c.dliAvg : 1), p.leaf.slaLightExp) * (1 + p.leaf.slaTemp * (c.tAvg - p.leaf.slaTempRef)), p.leaf.slaMin, p.leaf.slaMax);
  if (!c.pinched) {
    const nodeBase = p.leaf.rate * dpd * (c.pd < p.seedling.shock ? p.seedling.shockFactor : 1);
    c.nodeFrac += nodeBase * env.fx.node * (1 - env.fx.arrest);
    addLoss(c, 'cu_arrest', nodeBase * env.fx.node * env.fx.arrest);
    while (c.nodeFrac >= 1) {
      c.nodeFrac -= 1;
      c.mainNodes++;
      c.untrained++;
      const len = p.stem.internode * clamp((1 + p.stem.internodeNight * (c.nightAvg - p.stem.internodeNightRef)) * dpow(p.leaf.slaDliRef / (c.dliAvg > 1 ? c.dliAvg : 1), p.stem.internodeLightExp), p.stem.internodeMin, p.stem.internodeMax) * env.fx.internode;
      c.lastInternode += (len - c.lastInternode) / 3;
      c.stemLength += len;
      c.nodes.push({ age: 0, area: 0, w: 0, cap: p.leaf.maxArea * v.leafArea, peak: 0, lat: 0 });
      c.fruits.push({ node: c.mainNodes, n: femaleRate(c, p, v, env.fx.female), age: -p.fruit.anthesisAge, w: 0, def: 0, dur: 0 });
      c.tips.push({ node: c.mainNodes, age: 0, made: 0 });
    }
  }
  // ── 곁순 ──
  if (c.tips.length) {
    const tips = [];
    const latRate = p.lateral.rate * trap(p.lateral.ssr, c.ssrAvg) * dpd;
    for (const t of c.tips) {
      t.age += dpd;
      if (t.age >= p.lateral.delay) {
        const before = Math.floor(t.made);
        t.made += latRate;
        if (Math.floor(t.made) > before) {
          c.nodes.push({ age: 0, area: 0, w: 0, cap: p.leaf.maxArea * v.leafArea * p.lateral.areaFactor, peak: 0, lat: 1 });
          if (before === 0) c.fruits.push({ node: 0, n: p.lateral.female, age: -p.fruit.anthesisAge, w: 0, def: 0, dur: 0 });
        }
        if (t.made >= p.lateral.maxNodes) continue;
      }
      tips.push(t);
    }
    c.tips = tips;
  }

  // ── 잠재 생장(sink strength) ──
  const rExp = 8 / p.leaf.expandDays;
  const leafDemand: number[] = new Array(c.nodes.length).fill(0);
  const leafDA: number[] = new Array(c.nodes.length).fill(0);
  let dLeaf = 0;
  for (let i = 0; i < c.nodes.length; i++) {
    const n = c.nodes[i]!;
    if (n.age < 2 * p.leaf.expandDays && n.area < n.cap) {
      const s = 1 / (1 + dexp(-rExp * (n.age - p.leaf.expandDays / 2)));
      const capX = n.cap * (env.fx.expand > 1 ? env.fx.expand : 1);
      let dA = n.cap * rExp * s * (1 - s) * dpd * stress.expand * env.fx.expand;
      if (n.area + dA > capX) dA = capX - n.area;
      if (dA < 0) dA = 0;
      leafDA[i] = dA;
      leafDemand[i] = dA / sla;
      dLeaf += leafDemand[i]!;
    }
  }
  const dStem = dLeaf * p.stem.ratio;
  const dRoot = (dLeaf + dStem) * p.stem.rootRatio * env.fx.root;
  const fruitDemand: number[] = new Array(c.fruits.length).fill(0);
  let dFruit = 0;
  const wMax = p.fruit.wMax * v.fruitWMax;
  for (let i = 0; i < c.fruits.length; i++) {
    const f = c.fruits[i]!;
    if (f.age >= 0 && f.n > 0) {
      const e = dexp(-p.fruit.rate * (f.age - p.fruit.mid));
      const rate = p.fruit.rate * wMax * dexp(-e) * e;
      fruitDemand[i] = f.n * rate * dpd * stress.fruit * (f.age < p.fruit.abortWindow * 3 ? env.fx.fruitGrow : 1);
      dFruit += fruitDemand[i]!;
    }
  }
  const r = p.resp;
  const need = ((dLeaf / r.cvfLeaf + dStem / r.cvfStem + dRoot / r.cvfRoot + dFruit / r.cvfFruit) * m); // g CH2O m⁻²
  const avail = c.pool * core.photo.poolUse;
  const ratio = need > 0 ? (avail < need ? avail / need : 1) : 1;
  const used = need * ratio;
  c.pool -= used;

  // ── 분배와 생장 ──
  // 당이 모자라면 잎은 얇아지면서(SLA 상한까지) 면적을 유지하려 한다
  const areaRatio = ratio * (p.leaf.slaMax / sla) < 1 ? ratio * (p.leaf.slaMax / sla) : 1;
  for (let i = 0; i < c.nodes.length; i++) {
    if (leafDemand[i]! > 0) {
      const n = c.nodes[i]!;
      n.w += leafDemand[i]! * ratio;
      n.area += leafDA[i]! * areaRatio;
      if (n.area > n.peak) n.peak = n.area;
    }
  }
  c.wStem += dStem * ratio;
  c.wRoot += dRoot * ratio;
  const curvePenalty = p.training.curve * over;
  for (let i = 0; i < c.fruits.length; i++) {
    const f = c.fruits[i]!;
    if (fruitDemand[i]! > 0) {
      f.w += (fruitDemand[i]! * ratio) / f.n;
      f.def += (1 - ratio * stress.fruit + curvePenalty) * dpd;
      f.dur += dpd;
    }
  }
  const gL = dLeaf * ratio * m;
  const gS = dStem * ratio * m;
  const gR = dRoot * ratio * m;
  const gF = dFruit * ratio * m;
  const dmC = (gL + gS + gR) * r.carbonVeg + gF * r.carbonFruit;
  const rgCO2 = ((used * core.photo.carbonCH2O - dmC) * 44) / 12; // g CO2 m⁻² (이 시간)
  c.growthResp = rgCO2 > 0 ? rgCO2 / 1000 / 3600 : 0;
  c.cum.used += used;
  c.cum.rgCO2 += rgCO2;
  c.cum.dm += gL + gS + gR + gF;
  c.cum.dmC += dmC;
  const t = c.today;
  t.growthResp += (rgCO2 * 30) / 44;
  t.gLeaf += gL;
  t.gStem += gS;
  t.gRoot += gR;
  t.gFruit += gF;
  t.demand += need;
  t.supply += used;

  // ── 발육: 엽령·과실 나이, 착과와 퇴화 ──
  // 생장조절제: CPPU는 퇴화를 줄이고(set > 0), 에테폰 약해는 낙화를 늘린다(set < 0)
  const setFx = 1 - env.fx.set;
  const abortRate = (p.fruit.abortMax * (1 - stress.set) + (setFx > 1 ? (setFx - 1) * p.fruit.abortMax : 0)) * (setFx < 1 ? setFx : 1) * dpd;
  let aborted = 0;
  for (const f of c.fruits) {
    f.age += dpd;
    if (f.age > -p.fruit.preAnthesis && f.age < p.fruit.abortWindow && abortRate > 0) {
      const cut = f.n * abortRate;
      f.n -= cut;
      aborted += cut;
    }
  }
  if (aborted > 0) {
    c.fruits = c.fruits.filter((f) => f.n > 0.005);
    c.abortedTotal += aborted * m;
    t.aborted += aborted * m;
  }
  exposeFruits(c, env.fx, dpd);
  applyLeafLoss(c, env.fx, p.leaf.expandDays, m);

  // ── 잎 노화와 장해 ──
  const dmg = p.damage;
  const chillT = dmg.chillTemp + v.coldTol;
  let loss = 0;
  if (env.tIn < chillT) loss += dmg.chillRate * (chillT - env.tIn);
  stress.chill = 1 - clamp(loss * 24, 0, 1);
  let heatLoss = 0;
  const heatT = dmg.heatTemp + v.heatTol;
  if (env.tLeaf > heatT) heatLoss = dmg.heatRate * (env.tLeaf - heatT);
  stress.heat = 1 - clamp(heatLoss * 24, 0, 1);
  loss += heatLoss;
  let frost = false;
  if (env.tIn <= dmg.frostTemp) {
    frost = true;
    loss += dmg.frostRate;
    c.alive *= 1 - dmg.frostRate;
  }
  if (loss > 1) loss = 1;
  let area = 0;
  for (const n of c.nodes) area += n.area;
  const kdf = clamp(p.photo.kDiffuse - p.photo.kLaiSlope * area * m, p.photo.kMin, 2);
  let above = 0;
  let oldest = true;
  const nodes: LeafNode[] = [];
  // 아래 잎부터 훑는다: 위에 쌓인 엽면적은 전체에서 자기와 아래를 뺀 값
  let below = 0;
  for (const n of c.nodes) {
    n.age += dpd;
    above = area - below - n.area;
    below += n.area;
    let rate = 0;
    if (n.age > p.leaf.life) rate += p.leaf.senescence;
    if (n.age > p.leaf.expandDays && dexp(-kdf * above * m) < p.leaf.shadeLight) rate += p.leaf.shadeSenescence;
    let f = 1 - rate * dpd - loss;
    // 유지호흡을 댈 당이 모자라면 가장 늙은 잎부터 소모된다
    if (oldest && n.area > 0 && starve < 1) f -= p.leaf.starveLoss * (1 - starve);
    if (n.area > 0) oldest = false;
    if (f < 1) {
      if (f < 0) f = 0;
      n.area *= f;
      n.w *= f;
    }
    if (n.age > p.leaf.expandDays && n.area < 0.05 * n.peak) continue;
    nodes.push(n);
  }
  c.nodes = nodes;

  // ── 고사 판정 ──
  let liveArea = 0;
  for (const n of c.nodes) liveArea += n.area;
  if (c.alive < 0.02 || (liveArea * m < 0.005 && c.pd > p.seedling.shock)) {
    c.dead = true;
    c.deathCause = frost || env.tIn <= dmg.frostTemp + 1 ? 'frost' : env.tIn < chillT ? 'chill' : env.tLeaf > heatT ? 'heat' : 'collapse';
    c.growthResp = 0;
    events.push({ hour: env.hour, type: 'crop', level: 'warning', code: `dead:${c.deathCause}`, value: env.tIn });
  }

  t.sPhoto += stress.photo;
  t.sExpand += stress.expand;
  t.sFruit += stress.fruit;
  t.sSet += stress.set;
  c.out = summarize(c, p, v, ratio, sla, stress, env.fx.female);
  t.lai = c.out.lai;
  t.nodes = c.mainNodes;
  t.fruits = c.out.fruits;
  return { crop: c, events };
}
