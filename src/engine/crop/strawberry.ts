/**
 * 딸기 생육 모듈(일계성, 촉성·반촉성).
 *  - 화아분화: 일평균기온·일장(전조 포함)·체내 질소의 함수로 매일 진행한다. 15°C 이하는 일장 무관, 20°C 이상은 단일 필수, 26°C 이상은 정지.
 *    정식 전 육묘장에서의 진행은 그 지역 평년 기온·일장으로 계산한다(야냉 단일처리 묘는 분화 완료 상태).
 *  - 화방: 분화하면 차수별(1·2·3·4번화) 꽃 무리가 생기고, 잎 몇 장 뒤 다음 화방의 분화가 다시 진행된다.
 *  - 수분: 벌 활동(온도·광·봉군 세력) × 꽃가루 활력(온도·습도)을 개화 후 며칠 동안 적산 → 수정률 → 과실 크기와 기형과.
 *  - 휴면: 단일·저온에서 깊어지고(왜화), 전조·고온·저온 요구량 충족으로 풀린다.
 *  - 품질: 과실 건물률(→ 당도)이 비대기의 동화산물 수급·기온·광에 따라 달라진다.
 *  - 근권 수분·양분·EC는 Phase 4 인터페이스. 체내 질소 수준은 작업 계획의 임시 입력(nLevel)이다.
 */
import { dexp, dlog, dpow } from '../dmath';
import type { SimEvent } from '../types';
import { trap, type CanopyView } from './canopy';
import { addLoss, applyDefects, applyLeafLoss, exposeFruits, hoursOf, runScheduled, type Sched } from './phys';
import { addLabor, beta, buildCanopy, clamp, emptyDay, emptyYield, feedback, noStress, shifted, type CanopySupply, type CropEnv } from './cucumber';
import type { CoreParams, CropState, Curve, Fruit, LeafNode, PlantOrder, SbState, Stress, StrawberryParams, StrawberryVariety, WorkPlan, WorkTask } from './types';

export function defaultPlanSb(): WorkPlan {
  return { trainEvery: 0, lateralKeep: 0, removeBelowNode: 0, maxFruit: 0, deleafEvery: 14, leavesKeep: 9, pinchNode: 0, harvestEvery: 2, harvestWeight: 0, runnerEvery: 7, flowersKeep: 7, bees: 'honey', beesEvery: 0, nLevel: 1, crownsKeep: 2 };
}

/** 화아분화의 하루 진행량(0–1 가운데). t: 일평균기온, photoperiod: 전조 포함 일장(h), n: 체내 질소 수준. */
export function inductionRate(p: StrawberryParams, v: StrawberryVariety, t: number, photoperiod: number, n: number): number {
  const ind = p.induction;
  const fT = trap(shifted(ind.temp, 0, v.inductionTemp), t);
  const crit = ind.critical + v.critical;
  const fSd = clamp((crit + ind.criticalBand - photoperiod) / ind.criticalBand, 0, 1);
  const w = clamp((t - ind.freeTemp) / (ind.sdTemp - ind.freeTemp), 0, 1);
  const fP = 1 - w * (1 - fSd);
  const fN = clamp(1 + ind.nSens * (1 - n), 0.2, 1.6);
  return (fT * fP * fN) / ind.days;
}

export interface Nursery {
  /** 정식일 직전 날들의 평년 일평균기온(°C)과 일장(h), 오래된 날부터 */
  temp: number[];
  daylength: number[];
}

function pushTruss(c: CropState, p: StrawberryParams, v: StrawberryVariety, done: number) {
  const sb = c.sb!;
  // 화방이 분화할 때마다 곁관부가 늘어난다(남길 관부 수까지). 관부마다 화방이 하나씩 나온다.
  if (sb.trusses > 0) sb.crowns = clamp(sb.crowns + p.crown.branch, 1, c.plan.crownsKeep ?? 2);
  sb.trusses++;
  sb.leavesAtInduction = c.mainNodes;
  sb.induction = 0;
  let left = v.flowers;
  for (let r = 0; r < p.fruit.rankCount.length && left > 0; r++) {
    const n = p.fruit.rankCount[r]! < left ? p.fruit.rankCount[r]! : left;
    left -= n;
    c.fruits.push({ node: sb.trusses, n: n * sb.crowns, age: -(p.induction.anthesisAge + r * p.induction.rankGap) + done, w: 0, def: 0, dur: 0, rank: r, poll: 0, tSum: 0 });
  }
}

export function plantStrawberry(order: PlantOrder, p: StrawberryParams, v: StrawberryVariety, env: CropEnv, nursery: Nursery): CropState {
  const sd = p.seedling;
  const nodes: LeafNode[] = [];
  const cap = p.leaf.maxArea * v.leafArea * sd.leafCap;
  for (let i = 0; i < sd.leaves; i++) {
    const area = sd.leafArea < cap ? sd.leafArea : cap;
    nodes.push({ age: (sd.leaves - i) / p.leaf.rate / 2, area, w: sd.leafW / sd.leaves, cap: area > cap ? area : cap, peak: area, lat: 0 });
  }
  const day = Math.floor(env.hour / 24);
  const seedling = order.seedling ?? 'buy';
  const sb: SbState = {
    seedling, chill: 0, dorm: 0, induction: 0, trusses: 0, leavesAtInduction: sd.leaves, crowns: 1, photoperiod: env.daylength, lampNight: 0, runners: 0, runnerW: 0,
    beeStrength: order.plan.bees && order.plan.bees !== 'none' ? 1 : 0, beeDay: day, beeAct: 0, beeHours: 0, lastRunner: day, firstFlowerHour: -1, anthracnoseRisk: seedling === 'own' ? sd.ownRisk : sd.buyRisk,
  };
  const crop: CropState = {
    cropId: 'strawberry', varietyId: order.varietyId, system: order.system, density: clamp(order.density, 2, 14), plan: order.plan, plantedHour: env.hour,
    alive: 1, dead: false, deathCause: '', pd: 0, pool: 0, wStem: sd.stemW, wRoot: sd.rootW, growthResp: 0,
    nodes, fruits: [], tips: [], nodeFrac: 0, mainNodes: sd.leaves, pinched: false, untrained: 0, stemLength: 0, lastInternode: 1,
    t24: env.tIn, tAvg: env.tIn, nightAvg: env.tIn, nightSum: 0, nightN: 0, dayLenAvg: env.daylength, dliAvg: p.leaf.slaDliRef, dliToday: 0, ssrAvg: 1,
    lastTrain: day, lastDeleaf: day, lastHarvest: day, firstHarvestHour: -1,
    total: emptyYield(), laborHours: { plant: (p.labor.plant * env.area) / 1000 }, abortedTotal: 0, cum: { gross: 0, maint: 0, used: 0, rgCO2: 0, dm: 0, dmC: 0 },
    today: emptyDay(day), yesterday: null,
    out: { lai: 0, leaves: sd.leaves, nodes: sd.leaves, fruits: 0, flowers: 0, wLeaf: 0, wStem: 0, wRoot: 0, wFruit: 0, pool: 0, ssr: 1, etiolation: 1, stemLength: 0, sla: p.leaf.sla, femaleRate: 1, biggestFruit: 0, stress: noStress() },
    sb, quality: { kg: 0, brix: 0, acid: 0, firm: 0, weight: 0, count: 0, malformed: 0 },
  };
  // 육묘장에서의 화아분화: 야냉 단일처리 묘는 분화 완료, 그 밖에는 평년 기온·일장으로 진행량을 계산한다
  let prog = order.nightChill ? 1 : 0;
  let done = 0;
  const nN = seedling === 'buy' ? p.induction.nurseryN : (order.plan.nLevel ?? 1);
  for (let i = 0; i < nursery.temp.length; i++) {
    const t = nursery.temp[i]! + p.induction.nurseryOffset;
    if (prog < 1) prog += inductionRate(p, v, t, nursery.daylength[i]!, nN);
    else if (!order.nightChill) done += beta(t, p.dev.tBase, p.dev.tOpt, p.dev.tMax);
  }
  if (prog >= 1) pushTruss(crop, p, v, done < sd.inducedMax ? done : sd.inducedMax);
  else sb.induction = prog;
  crop.out = summarize(crop, p, v, 1, p.leaf.sla, crop.out.stress);
  return crop;
}

/** 과실 건물률. q: 근권 양분 품질 계수(과실 K·근권 EC, Phase 4)의 이동평균 */
function dmcOf(p: StrawberryParams, v: StrawberryVariety, f: Fruit, dli: number, q = 1): number {
  const fr = p.fruit;
  const sr = f.dur > 0 ? 1 - f.def / f.dur : fr.ssrRef;
  const tMean = f.dur > 0 ? (f.tSum ?? 0) / f.dur : fr.dmcTempRef;
  const light = (fr.dmcLight * dlog((dli > 0.5 ? dli : 0.5) / p.leaf.slaDliRef)) / 0.6931;
  return clamp(v.dmc * q * (1 + fr.dmcSsr * (sr - fr.ssrRef)) * (1 - fr.dmcTemp * (tMean - fr.dmcTempRef)) * (1 + light), fr.dmcMin, fr.dmcMax);
}

function summarize(c: CropState, p: StrawberryParams, v: StrawberryVariety, ssr: number, sla: number, stress: Stress): CropState['out'] {
  const m = c.density * c.alive;
  const sb = c.sb!;
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
  let next = -999;
  for (const f of c.fruits) {
    wf += f.n * f.w;
    if (f.age >= 0) {
      fruits += f.n;
      const fw = f.w / dmcOf(p, v, f, c.dliAvg, c.sb?.nutQ ?? 1);
      if (fw > big) big = fw;
    } else {
      flowers += f.n;
      if (f.age > next) next = f.age;
    }
  }
  return {
    lai: area * m, leaves, nodes: c.mainNodes, fruits, flowers, wLeaf: wl * m, wStem: c.wStem * m, wRoot: c.wRoot * m, wFruit: wf * m, pool: c.pool, ssr, etiolation: 1, stemLength: 0, sla, femaleRate: 1, biggestFruit: big, stress,
    sb: { crowns: sb.crowns, trusses: sb.trusses, induction: sb.induction, dormancy: sb.dorm, chill: sb.chill, photoperiod: sb.photoperiod, runners: sb.runners, beeStrength: sb.beeStrength, beeActivity: sb.beeHours > 0 ? sb.beeAct / sb.beeHours : 0, nextAnthesis: next, firstFlowerDay: sb.firstFlowerHour < 0 ? -1 : (sb.firstFlowerHour - c.plantedHour) / 24 },
  };
}

export function canopyOfStrawberry(c: CropState, core: CoreParams, p: StrawberryParams, v: StrawberryVariety, sup: CanopySupply): CanopyView | null {
  return buildCanopy(c, core, p, v.pmaxFactor, 1, sup, c.sb ? c.sb.runnerW : 0, c.wStem + c.wRoot);
}

/** 지금 익은 과실 무게(kg m⁻²) — 노동 시간 예상용 */
export function readyKgSb(c: CropState, p: StrawberryParams, v: StrawberryVariety): number {
  const m = c.density * c.alive;
  let kg = 0;
  for (const f of c.fruits) {
    const s = pickShare(f, p);
    if (s > 0) kg += (f.n * s * (f.w / dmcOf(p, v, f, c.dliAvg, c.sb?.nutQ ?? 1)) * m) / 1000;
  }
  return kg;
}

/** 숙기 분산: 코호트 가운데 지금까지 익은 비율(원래 개수 기준) */
function ripeOf(f: Fruit, p: StrawberryParams): number {
  const sp = p.fruit.ripenSpread;
  if (sp <= 0) return f.age >= p.fruit.maturity ? 1 : 0;
  return clamp((f.age - (p.fruit.maturity - sp / 2)) / sp, 0, 1);
}
/** 지금 딸 수 있는(익었는데 아직 안 딴) 비율 — 현재 남은 개수 기준 */
function pickShare(f: Fruit, p: StrawberryParams): number {
  const pk = f.picked ?? 0;
  const r = ripeOf(f, p);
  return r > pk + 1e-9 ? (r - pk) / (1 - pk) : 0;
}

function doWork(c: CropState, w: WorkTask, p: StrawberryParams, v: StrawberryVariety, env: CropEnv, events: SimEvent[], frac = 1) {
  const day = Math.floor(env.hour / 24);
  const m = c.density * c.alive;
  const sb = c.sb!;
  if (w === 'deleaf') {
    c.lastDeleaf = day;
    let cut = c.nodes.length - Math.round(c.plan.leavesKeep * sb.crowns);
    if (cut > 0) c.nodes = c.nodes.filter(() => cut-- <= 0);
    addLabor(c, 'deleaf', p.labor.deleaf, env.area);
  } else if (w === 'runner') {
    sb.lastRunner = day;
    if (sb.runners > 0) {
      sb.runners = 0;
      sb.runnerW = 0;
      addLabor(c, 'runner', p.labor.runner, env.area);
    }
  } else if (w === 'bees') {
    if (c.plan.bees && c.plan.bees !== 'none') {
      sb.beeStrength = 1;
      sb.beeDay = day;
      c.laborHours = { ...c.laborHours, bees: (c.laborHours.bees ?? 0) + p.labor.bees };
      c.today.labor += p.labor.bees;
    }
  } else if (w === 'thin') {
    // 적화: 화방마다 아직 피지 않은 꽃을 높은 차수부터 솎아 정해 둔 수만 남긴다
    const keepN = (c.plan.flowersKeep ?? 0) * sb.crowns;
    if (keepN > 0) {
      const byTruss = new Map<number, number>();
      let changed = false;
      for (const f of [...c.fruits].sort((a, b) => a.node - b.node || (a.rank ?? 0) - (b.rank ?? 0))) {
        const have = byTruss.get(f.node) ?? 0;
        const room = keepN - have;
        if (f.age < 0 && f.n > room) {
          f.n = room > 0 ? room : 0;
          changed = true;
        }
        byTruss.set(f.node, have + f.n);
      }
      if (changed) {
        c.fruits = c.fruits.filter((f) => f.n > 0.005);
        addLabor(c, 'thin', p.labor.thin, env.area);
      }
    }
  } else if (w === 'harvest') {
    c.lastHarvest = day;
    const fr = p.fruit;
    const got = emptyYield();
    const q = c.quality!;
    const keep: Fruit[] = [];
    for (const f of c.fruits) {
      const share = pickShare(f, p);
      if (share <= 0) {
        keep.push(f);
        continue;
      }
      const dmc = dmcOf(p, v, f, c.dliAvg, c.sb?.nutQ ?? 1);
      const fw = f.w / dmc;
      // 숙기 분산: 익은 몫만 딴다. 노동이 모자라면 그 가운데 frac만큼만 — 남은 익은 과실은 늙어서 과숙(비상품)으로 간다
      const pk = f.picked ?? 0;
      const ripe = ripeOf(f, p);
      const nh = f.n * share * frac;
      const pk2 = pk + (ripe - pk) * frac;
      if (f.n - nh > 0.005 && pk2 < 0.999) keep.push({ ...f, n: f.n - nh, picked: pk2 });
      const kgAll = (nh * fw * m) / 1000;
      // 익은 지 유통 기한(shelf)을 넘긴 몫 = 과숙
      const sp = fr.ripenSpread;
      const overAll = sp > 0 ? clamp((f.age - fr.shelf - (fr.maturity - sp / 2)) / sp, 0, 1) : f.age > fr.maturity + fr.shelf ? 1 : 0;
      const overShare = ripe > pk ? clamp((overAll - pk) / (ripe - pk), 0, 1) : 0;
      got.cull += kgAll * overShare;
      if (overShare > 0) addLoss(c, 'overripe', kgAll * overShare);
      const kg = kgAll * (1 - overShare);
      const fert = 1 - dexp(-(f.poll ?? 0));
      const bad = 1 - fert; // 기형과 비율(수분 불량)
      got.count += nh * m;
      if (fw < fr.midWeight) got.cull += kg;
      else {
        const good = kg * (1 - bad);
        let part: { top: number; mid: number; cull: number };
        if (fw >= fr.topWeight) part = { top: good, mid: kg * bad * (1 - bad), cull: kg * bad * bad };
        else part = { top: 0, mid: good, cull: kg * bad };
        addLoss(c, 'sb_malform', kg * bad);
        const before = part.top + part.mid;
        part = applyDefects(part, f, env.fx, c);
        got.top += part.top;
        got.mid += part.mid;
        got.cull += part.cull;
        // 품질 통계는 상품·중품으로 남은 과실만
        const keepShare = before > 0 ? (part.top + part.mid) / before : 1;
        const tMean = f.dur > 0 ? (f.tSum ?? 0) / f.dur : fr.dmcTempRef;
        const g = good * keepShare;
        q.kg += g;
        q.brix += g * (fr.brixSlope * dmc * 100 + fr.brixOffset);
        q.acid += g * v.acid * (1 + fr.acidTemp * (fr.dmcTempRef - tMean));
        q.firm += g * v.firmness * clamp(1 - fr.firmTemp * (tMean - fr.dmcTempRef), 0.4, 1.4);
        q.weight += g * fw;
      }
      q.count += nh * m;
      q.malformed += nh * m * (1 - (1 - bad) * dexp(-((f.dis?.sb_malform ?? 0) + (f.dis?.sb_malform_pgr ?? 0))));
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
    addLabor(c, 'harvest', (kgAll > 0 ? p.labor.harvestBase : 0) + p.labor.harvestPerTon * kgAll, env.area);
  }
}

const down = (c: Curve, x: number) => trap(c, x);

export function stepStrawberry(c0: CropState, core: CoreParams, p: StrawberryParams, v: StrawberryVariety, env: CropEnv, works: readonly WorkTask[]): { crop: CropState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  if (c0.dead || !c0.sb) return { crop: c0, events };
  const c: CropState = { ...c0, nodes: c0.nodes.map((n) => ({ ...n })), fruits: c0.fruits.map((f) => ({ ...f })), total: { ...c0.total }, cum: { ...c0.cum }, today: { ...c0.today, harvest: { ...c0.today.harvest } }, sb: { ...c0.sb }, quality: { ...c0.quality! } };
  const sb = c.sb!;
  const day = Math.floor(env.hour / 24);
  // 체내 질소 수준: 정식 뒤에는 근권 양분 모델의 신엽 질소(적정 대비)를 쓴다
  const nLevel = clamp(env.rz.plantN, 0.3, 1.6);
  sb.nutQ = (sb.nutQ ?? 1) + (env.rz.brix - (sb.nutQ ?? 1)) / (24 * 7);

  // ── 하루 넘김: 이동평균, 화아분화, 휴면, 런너, 봉군 세력 ──
  if (env.hod === 0 && c.today.dayIndex !== day) {
    const t = c.today;
    c.yesterday = { ...t, sPhoto: t.sPhoto / 24, sExpand: t.sExpand / 24, sFruit: t.sFruit / 24, sSet: t.sSet / 24 };
    const ssrDay = t.demand > 0 ? clamp(t.supply / t.demand, 0, 1) : 1;
    c.ssrAvg += (ssrDay - c.ssrAvg) / p.fruit.ssrLag;
    c.dliAvg += (c.dliToday - c.dliAvg) / p.leaf.acclimDays;
    c.dliToday = 0;
    c.tAvg += (c.t24 - c.tAvg) / p.leaf.acclimDays;
    const photo = env.daylength + sb.lampNight;
    sb.photoperiod += ((photo > 24 ? 24 : photo) - sb.photoperiod) / 3;
    sb.lampNight = 0;
    // 화아분화: 직전 화방 뒤로 잎이 정해진 수만큼 나온 뒤에야 다음 분화가 진행된다
    sb.induction += inductionRate(p, v, c.t24, sb.photoperiod, nLevel);
    if (sb.induction > 1) sb.induction = 1;
    if (sb.induction >= 1 && (sb.trusses === 0 || c.mainNodes - sb.leavesAtInduction >= p.crown.leavesBetween * sb.crowns)) pushTruss(c, p, v, 0);
    // 휴면
    const d = p.dormancy;
    // 지베렐린: 휴면을 직접 덜어 낸다(휴면 타파)
    if (env.fx.dorm > 0) sb.dorm -= (env.fx.dorm > 1 ? 1 : env.fx.dorm) * sb.dorm;
    const induce = down(d.photo, sb.photoperiod) * down(d.temp, c.t24);
    if (sb.chill >= v.chillReq && v.chillReq > 0) sb.dorm -= d.chillRelease * sb.dorm;
    else sb.dorm += d.rateIn * v.dormancy * induce * (1 - sb.dorm) - d.rateOut * (1 - induce) * sb.dorm;
    sb.dorm = clamp(sb.dorm, 0, 1);
    // 런너: 장일·고온에서 발생, 휴면 중에는 나오지 않는다
    sb.runners += p.runner.rate * trap(p.runner.photo, sb.photoperiod) * trap(p.runner.temp, c.t24) * (1 - sb.dorm) * env.fx.runner;
    // 봉군
    const bee = c.plan.bees && c.plan.bees !== 'none' ? p.bees[c.plan.bees] : null;
    if (bee) sb.beeStrength *= 1 - bee.decay;
    else sb.beeStrength = 0;
    sb.beeAct = 0;
    sb.beeHours = 0;
    c.today = emptyDay(day);
  }
  c.t24 += (env.tIn - c.t24) / 24;
  c.dliToday += (env.ppfd * 3600) / 1e6;
  if (env.solar <= 0) sb.lampNight += env.lamp;
  if (env.tIn < p.dormancy.chillTemp && env.tIn > -2) sb.chill += 1;

  // ── 작업 ──
  for (const w of works) doWork(c, w, p, v, env, events);
  if (env.hod === p.labor.workHour) {
    // 예정 작업: 수확 → 적엽 → 런너 → 적화 → 벌통 순서로, 오늘 남은 노동 시간 안에서만 한다(Phase 5)
    const pl = c.plan;
    const L = p.labor;
    const A = env.area;
    const list: Sched[] = [];
    if (pl.harvestEvery > 0 && day - c.lastHarvest >= pl.harvestEvery) {
      const kg = readyKgSb(c, p, v);
      list.push({ task: 'harvest', est: hoursOf((kg > 0 ? L.harvestBase : 0) + L.harvestPerTon * kg, A), partialBase: hoursOf(kg > 0 ? L.harvestBase : 0, A), run: (fr) => doWork(c, 'harvest', p, v, env, events, fr) });
    }
    if (pl.deleafEvery > 0 && day - c.lastDeleaf >= pl.deleafEvery) list.push({ task: 'deleaf', est: hoursOf(L.deleaf, A), run: () => doWork(c, 'deleaf', p, v, env, events) });
    if ((pl.runnerEvery ?? 0) > 0 && day - sb.lastRunner >= pl.runnerEvery!) list.push({ task: 'runner', est: sb.runners > 0 ? hoursOf(L.runner, A) : 0, run: () => doWork(c, 'runner', p, v, env, events) });
    if ((pl.flowersKeep ?? 0) > 0) list.push({ task: 'thin', est: hoursOf(L.thin, A) * 0.2, run: () => doWork(c, 'thin', p, v, env, events) });
    if ((pl.beesEvery ?? 0) > 0 && day - sb.beeDay >= pl.beesEvery!) list.push({ task: 'bees', est: L.bees, run: () => doWork(c, 'bees', p, v, env, events) });
    runScheduled(c, env.laborLeft, list, env.laborAuto);
  }

  const m = c.density * c.alive;
  const fT = beta(env.tIn, p.dev.tBase, p.dev.tOpt, p.dev.tMax);
  const dpd = fT / 24;
  c.pd += dpd;

  c.pool += env.gross - env.maint;
  if (c.pool < 0) c.pool = 0;
  c.cum.gross += env.gross;
  c.cum.maint += env.maint;
  c.today.gross += env.gross;
  c.today.maint += env.maint;

  // ── 수분 조건(이 시간): 벌 활동 × 꽃가루 활력 ──
  const beeP = c.plan.bees && c.plan.bees !== 'none' ? p.bees[c.plan.bees] : null;
  const daylight = env.ppfd > 5;
  const act = beeP && daylight ? trap(beeP.temp, env.tIn) * trap(beeP.light, env.ppfd) * sb.beeStrength : 0;
  const viab = trap(shifted(p.bees.pollenTemp, v.pollenCold, 0), env.tIn) * trap(p.bees.pollenRhCurve, env.rh);
  const pollStep = daylight ? (act * (beeP ? beeP.rate : 0) + p.bees.self) * viab : 0;
  if (daylight) {
    sb.beeAct += act * viab;
    sb.beeHours++;
  }

  // ── 스트레스 ──
  let wLeaf = 0;
  for (const n of c.nodes) wLeaf += n.w;
  const sWaterExpand = trap(core.water.expand, env.water);
  // 딸기는 관부와 뿌리에 전분을 저장하므로 저장 여력을 잎 + 관부 + 뿌리 건물 기준으로 본다
  const fb = feedback(c, core, (wLeaf + c.wStem + c.wRoot) * m);
  const tempFruit = trap(shifted(p.fruit.growTemp, v.coldTol, v.heatTol), env.tIn);
  const ssrToday = c.today.demand > 0 ? c.today.supply / c.today.demand : c.ssrAvg;
  const sSsr = trap(p.fruit.setSsr, ssrToday < c.ssrAvg ? ssrToday : c.ssrAvg);
  const starve = env.maint + env.starve > 0 ? 1 - env.starve / (env.maint + env.starve) : 1;
  const dormF = 1 - p.dormancy.dwarf * sb.dorm;
  const stress: Stress = {
    photo: trap(core.water.photo, env.water) * env.rz.nutrient * fb,
    expand: sWaterExpand * env.rz.expand * dormF,
    fruit: trap(core.water.fruit, env.water) * env.rz.fruit * tempFruit,
    set: sSsr * env.rz.set,
    water: sWaterExpand, nutrient: env.rz.nutrient, salt: env.rz.salt, sinkFeedback: fb, tempSet: 1, tempFruit, ssr: sSsr, chill: 1, heat: 1, starve, training: 1,
    dormancy: dormF, rootTemp: 1, light: 1,
    pollination: sb.beeHours > 0 ? clamp(sb.beeAct / sb.beeHours, 0, 1) : 0,
  };

  // ── 새 잎 ──
  const sla = clamp(p.leaf.sla * dpow(p.leaf.slaDliRef / (c.dliAvg > 1 ? c.dliAvg : 1), p.leaf.slaLightExp) * (1 + p.leaf.slaTemp * (c.tAvg - p.leaf.slaTempRef)), p.leaf.slaMin, p.leaf.slaMax);
  c.nodeFrac += p.leaf.rate * sb.crowns * dpd * (c.pd < p.seedling.shock ? p.seedling.shockFactor : 1) * (1 - p.dormancy.slow * sb.dorm) * env.fx.node;
  while (c.nodeFrac >= 1) {
    c.nodeFrac -= 1;
    c.mainNodes++;
    c.nodes.push({ age: 0, area: 0, w: 0, cap: p.leaf.maxArea * v.leafArea * dormF, peak: 0, lat: 0 });
  }

  // ── 잠재 생장 ──
  const rExp = 8 / p.leaf.expandDays;
  const leafDemand: number[] = new Array(c.nodes.length).fill(0);
  const leafDA: number[] = new Array(c.nodes.length).fill(0);
  let dLeaf = 0;
  for (let i = 0; i < c.nodes.length; i++) {
    const n = c.nodes[i]!;
    if (n.age < 2 * p.leaf.expandDays && n.area < n.cap) {
      const s = 1 / (1 + dexp(-rExp * (n.age - p.leaf.expandDays / 2)));
      const capX = n.cap * (env.fx.expand > 1 ? env.fx.expand : 1);
      let dA = n.cap * rExp * s * (1 - s) * dpd * sWaterExpand * env.rz.expand * env.fx.expand;
      if (n.area + dA > capX) dA = capX - n.area;
      if (dA < 0) dA = 0;
      leafDA[i] = dA;
      leafDemand[i] = dA / sla;
      dLeaf += leafDemand[i]!;
    }
  }
  const dCrown = dLeaf * p.crown.ratio;
  const dRoot = (dLeaf + dCrown) * p.crown.rootRatio * env.fx.root;
  const dRunner = sb.runners * p.runner.grow * dpd * stress.expand;
  const fr = p.fruit;
  const kF = 8 / fr.maturity;
  const fruitDemand: number[] = new Array(c.fruits.length).fill(0);
  let dFruit = 0;
  for (let i = 0; i < c.fruits.length; i++) {
    const f = c.fruits[i]!;
    if (f.age >= 0 && f.n > 0 && f.age < fr.maturity + fr.ripenSpread / 2) {
      const fert = 1 - dexp(-(f.poll ?? 0));
      const wp = v.fruitW * fr.rankFactor[f.rank ?? 0]! * (fr.pollSinkMin + (1 - fr.pollSinkMin) * fert);
      const s = 1 / (1 + dexp(-kF * (f.age - fr.maturity / 2)));
      fruitDemand[i] = f.n * wp * kF * s * (1 - s) * dpd * stress.fruit;
      dFruit += fruitDemand[i]!;
    }
  }
  const r = p.resp;
  const need = (dLeaf / r.cvfLeaf + (dCrown + dRunner) / r.cvfStem + dRoot / r.cvfRoot + dFruit / r.cvfFruit) * m;
  const avail = c.pool * core.photo.poolUse;
  const ratio = need > 0 ? (avail < need ? avail / need : 1) : 1;
  const used = need * ratio;
  c.pool -= used;

  const areaRatio = ratio * (p.leaf.slaMax / sla) < 1 ? ratio * (p.leaf.slaMax / sla) : 1;
  for (let i = 0; i < c.nodes.length; i++) {
    if (leafDemand[i]! > 0) {
      const n = c.nodes[i]!;
      n.w += leafDemand[i]! * ratio;
      n.area += leafDA[i]! * areaRatio;
      if (n.area > n.peak) n.peak = n.area;
    }
  }
  c.wStem += dCrown * ratio;
  c.wRoot += dRoot * ratio;
  sb.runnerW += dRunner * ratio;
  for (let i = 0; i < c.fruits.length; i++) {
    const f = c.fruits[i]!;
    if (fruitDemand[i]! > 0) {
      f.w += (fruitDemand[i]! * ratio) / f.n;
      f.def += (1 - ratio * stress.fruit) * dpd;
      f.dur += dpd;
      f.tSum = (f.tSum ?? 0) + env.tIn * dpd;
    }
  }
  const gL = dLeaf * ratio * m;
  const gS = (dCrown + dRunner) * ratio * m;
  const gR = dRoot * ratio * m;
  const gF = dFruit * ratio * m;
  const dmC = (gL + gS + gR) * r.carbonVeg + gF * r.carbonFruit;
  const rgCO2 = ((used * core.photo.carbonCH2O - dmC) * 44) / 12;
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

  // ── 꽃·과실 발육: 수분 적산, 고차 과실 퇴화, 꽃 동해 ──
  const setFx = 1 - env.fx.set;
  const abortRate = (fr.abortMax * (1 - stress.set) + (setFx > 1 ? (setFx - 1) * fr.abortMax : 0)) * (setFx < 1 ? setFx : 1) * dpd;
  const frostCut = env.tIn < fr.flowerFrost ? fr.flowerFrostRate : 0;
  let aborted = 0;
  for (const f of c.fruits) {
    if (f.age < 0 && f.age + dpd >= 0 && sb.firstFlowerHour < 0) sb.firstFlowerHour = env.hour;
    f.age += dpd;
    if (f.age >= 0 && f.age < fr.receptive) f.poll = (f.poll ?? 0) + pollStep;
    let cut = 0;
    if ((f.rank ?? 0) >= 2 && f.age > 0 && f.age < fr.abortWindow) cut += abortRate;
    if (frostCut > 0 && f.age > -3 && f.age < fr.abortWindow) cut += frostCut;
    if (cut > 0) {
      const lost = f.n * (cut > 1 ? 1 : cut);
      f.n -= lost;
      aborted += lost;
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
  const heatT = dmg.heatTemp + v.heatTol;
  const heatLoss = env.tLeaf > heatT ? dmg.heatRate * (env.tLeaf - heatT) : 0;
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
  let below = 0;
  let oldest = true;
  const nodes: LeafNode[] = [];
  for (const n of c.nodes) {
    n.age += dpd;
    const above = area - below - n.area;
    below += n.area;
    let rate = 0;
    if (n.age > p.leaf.life) rate += p.leaf.senescence;
    if (n.age > p.leaf.expandDays && dexp(-kdf * above * m) < p.leaf.shadeLight) rate += p.leaf.shadeSenescence;
    let f = 1 - rate * dpd - loss;
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

  let liveArea = 0;
  for (const n of c.nodes) liveArea += n.area;
  if (c.alive < 0.02 || (liveArea * m < 0.003 && c.pd > p.seedling.shock)) {
    c.dead = true;
    c.deathCause = frost ? 'frost' : env.tLeaf > heatT ? 'heat' : env.tIn < chillT ? 'chill' : 'collapse';
    c.growthResp = 0;
    events.push({ hour: env.hour, type: 'crop', level: 'warning', code: `dead:${c.deathCause}`, value: env.tIn });
  }

  t.sPhoto += stress.photo;
  t.sExpand += stress.expand;
  t.sFruit += stress.fruit;
  t.sSet += stress.set;
  c.out = summarize(c, p, v, ratio, sla, stress);
  t.lai = c.out.lai;
  t.nodes = c.mainNodes;
  t.fruits = c.out.fruits;
  return { crop: c, events };
}
