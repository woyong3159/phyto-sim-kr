/**
 * 와사비(고추냉이) 생육 모듈. 냉량성·음지성 다년생으로 근경(rhizome)을 12–24개월 키운다.
 *  - 발육·광합성 적온이 낮고(최적 16°C 안팎), 28°C에서 생육이 멈추며 그 위에서는 잎이 상한다.
 *  - 강광 장해: 낮 최고 PPFD의 이동평균이 높으면 광합성 능력이 줄어든다(차광이 필요한 이유).
 *  - 근권 온도: 수경은 양액 온도, 배지 재배는 양액과 기온의 가중 평균. 뿌리 활력이 생장과 광합성을 함께 제한한다.
 *  - 분배: 잎·엽병과 뿌리가 먼저, 근경 비대 속도는 포기 나이에 따라 서서히 커진다. 분얼과 꽃대(추대)가 경합한다.
 *  - 생산물: 근경(상품 40 g 이상), 잎·엽병, 꽃대. 매운맛(시니그린) 지수는 정성 지표다.
 */
import { dexp, dpow } from '../dmath';
import type { SimEvent } from '../types';
import { trap, type CanopyView } from './canopy';
import { addLabor, beta, buildCanopy, clamp, emptyDay, emptyYield, feedback, noStress, type CanopySupply, type CropEnv } from './cucumber';
import type { CoreParams, CropState, LeafNode, PlantOrder, Stress, WasabiParams, WasabiVariety, WorkPlan, WorkTask, WsState } from './types';

export function defaultPlanWs(): WorkPlan {
  return { trainEvery: 0, lateralKeep: 0, removeBelowNode: 0, maxFruit: 0, deleafEvery: 30, leavesKeep: 9, pinchNode: 0, harvestEvery: 0, harvestWeight: 0, runnerEvery: 60, stalkEvery: 10 };
}

/** 평균 w, 변이계수 cv인 포기 집단에서 무게가 x 이상인 비율(로지스틱 근사). */
function shareAbove(w: number, x: number, cv: number): number {
  if (w <= 0) return 0;
  return 1 / (1 + dexp((-1.7 * (w - x)) / (cv * w)));
}

export function pungencyIndex(c: CropState, p: WasabiParams, v: WasabiVariety): number {
  const ws = c.ws!;
  const age = 1 - dexp(-c.pd / p.pungency.age);
  const cool = 1 - p.pungency.tempShare * (1 - trap(p.pungency.temp, c.tAvg));
  return v.pungency * age * cool * (ws.boltLeft > 0 ? 1 - p.bolting.pungencyLoss : 1);
}

export function plantWasabi(order: PlantOrder, p: WasabiParams, v: WasabiVariety, env: CropEnv): CropState {
  const sd = p.seedling;
  const nodes: LeafNode[] = [];
  const cap = p.leaf.maxArea * v.leafArea * sd.leafCap;
  for (let i = 0; i < sd.leaves; i++) {
    const area = sd.leafArea < cap ? sd.leafArea : cap;
    nodes.push({ age: (sd.leaves - i) / p.leaf.rate / 2, area, w: sd.leafW / sd.leaves, cap: area > cap ? area : cap, peak: area, lat: 0 });
  }
  const day = Math.floor(env.hour / 24);
  const ws: WsState = { vern: 0, boltLeft: 0, stalkW: 0, bolts: 0, offshoots: 0, offshootW: 0, peakToday: 0, peakAvg: 200, rootT: env.rz.tRoot, heatLoad: 0, lastOffshoot: day, lastStalk: day, leafYield: 0, stalkYield: 0, harvested: false, pungency: 0 };
  const crop: CropState = {
    cropId: 'wasabi', varietyId: order.varietyId, system: order.system, density: clamp(order.density, 2, 16), plan: order.plan, plantedHour: env.hour,
    alive: 1, dead: false, deathCause: '', pd: 0, pool: 0, wStem: sd.stemW, wRoot: sd.rootW, growthResp: 0,
    nodes, fruits: [], tips: [], nodeFrac: 0, mainNodes: sd.leaves, pinched: false, untrained: 0, stemLength: 0, lastInternode: 1,
    t24: env.tIn, tAvg: env.tIn, nightAvg: env.tIn, nightSum: 0, nightN: 0, dayLenAvg: env.daylength, dliAvg: p.leaf.slaDliRef, dliToday: 0, ssrAvg: 1,
    lastTrain: day, lastDeleaf: day, lastHarvest: day, firstHarvestHour: -1,
    total: emptyYield(), laborHours: { plant: (p.labor.plant * env.area) / 1000 }, abortedTotal: 0, cum: { gross: 0, maint: 0, used: 0, rgCO2: 0, dm: 0, dmC: 0 },
    today: emptyDay(day), yesterday: null,
    out: { lai: 0, leaves: sd.leaves, nodes: sd.leaves, fruits: 0, flowers: 0, wLeaf: 0, wStem: 0, wRoot: 0, wFruit: 0, pool: 0, ssr: 1, etiolation: 1, stemLength: 0, sla: p.leaf.sla, femaleRate: 1, biggestFruit: 0, stress: noStress() },
    ws,
  };
  crop.out = summarize(crop, p, v, 1, p.leaf.sla, crop.out.stress);
  return crop;
}

function summarize(c: CropState, p: WasabiParams, v: WasabiVariety, ssr: number, sla: number, stress: Stress): CropState['out'] {
  const m = c.density * c.alive;
  const ws = c.ws!;
  let area = 0;
  let wl = 0;
  let leaves = 0;
  for (const n of c.nodes) {
    area += n.area;
    wl += n.w;
    if (n.area > 0) leaves++;
  }
  const fresh = c.wStem / p.rhizome.dmc;
  return {
    lai: area * m, leaves, nodes: c.mainNodes, fruits: 0, flowers: 0, wLeaf: wl * m, wStem: c.wStem * m, wRoot: c.wRoot * m, wFruit: (ws.stalkW + ws.offshootW) * m, pool: c.pool, ssr, etiolation: 1, stemLength: 0, sla, femaleRate: 1, biggestFruit: fresh, stress,
    ws: { rhizomeFresh: fresh, pungency: ws.harvested ? ws.pungency : pungencyIndex(c, p, v), rootT: ws.rootT, vern: ws.vern, bolting: ws.boltLeft > 0, offshoots: ws.offshoots, marketShare: shareAbove(fresh, p.rhizome.market, p.rhizome.cv), peakPpfd: ws.peakAvg },
  };
}

function rootFactor(c: CropState, p: WasabiParams): number {
  return trap(p.root.temp, c.ws!.rootT);
}

export function canopyOfWasabi(c: CropState, core: CoreParams, p: WasabiParams, v: WasabiVariety, sup: CanopySupply): CanopyView | null {
  if (!c.ws || c.ws.harvested) return null;
  // 강광 장해와 뿌리 활력 저하는 잎의 광합성 능력을 낮춘다
  const f = trap(p.light.inhibit, c.ws.peakAvg) * (1 - p.root.photoShare * (1 - rootFactor(c, p)));
  return buildCanopy(c, core, p, v.pmaxFactor * f, 1, sup, c.ws.stalkW + c.ws.offshootW, c.wStem + c.wRoot);
}

function doWork(c: CropState, w: WorkTask, p: WasabiParams, v: WasabiVariety, env: CropEnv, events: SimEvent[]) {
  const day = Math.floor(env.hour / 24);
  const m = c.density * c.alive;
  const ws = c.ws!;
  if (w === 'deleaf') {
    // 잎·엽병 수확: 바깥(늙은) 잎부터 따서 정해 둔 수만 남긴다. 수명이 지나 누렇게 된 잎은 상품이 아니다.
    c.lastDeleaf = day;
    let cut = c.nodes.length - c.plan.leavesKeep;
    let kg = 0;
    if (cut > 0) {
      c.nodes = c.nodes.filter((n) => {
        if (cut-- <= 0) return true;
        if (n.age < p.leaf.life) kg += (n.w / p.leaf.dmc) * m / 1000;
        return false;
      });
    }
    ws.leafYield += kg;
    addLabor(c, 'deleaf', p.labor.deleaf, env.area);
  } else if (w === 'runner') {
    ws.lastOffshoot = day;
    if (ws.offshoots > 0.05) {
      ws.offshoots = 0;
      ws.offshootW = 0;
      addLabor(c, 'runner', p.labor.runner, env.area);
    }
  } else if (w === 'thin') {
    ws.lastStalk = day;
    if (ws.stalkW > 0) {
      ws.stalkYield += ((ws.stalkW / p.bolting.dmc) * m) / 1000;
      ws.stalkW = 0;
      addLabor(c, 'thin', p.labor.thin, env.area);
    }
  } else if (w === 'harvest' && !ws.harvested) {
    // 근경 수확(굴취): 포기 사이 무게 변이를 반영해 등급을 나눈다
    const fresh = c.wStem / p.rhizome.dmc;
    const kg = (fresh * m) / 1000;
    const market = shareAbove(fresh, p.rhizome.market, p.rhizome.cv);
    const premium = shareAbove(fresh, p.rhizome.premium, p.rhizome.cv);
    const got = { top: kg * premium, mid: kg * (market - premium), cull: kg * (1 - market), count: m };
    for (const k of ['top', 'mid', 'cull', 'count'] as const) {
      c.total[k] += got[k];
      c.today.harvest[k] += got[k];
    }
    ws.pungency = pungencyIndex(c, p, v);
    ws.harvested = true;
    c.firstHarvestHour = env.hour;
    c.growthResp = 0;
    addLabor(c, 'harvest', p.labor.harvestBase + p.labor.harvestPerTon * kg, env.area);
    events.push({ hour: env.hour, type: 'crop', level: 'info', code: 'firstHarvest', value: (env.hour - c.plantedHour) / 24 });
  }
}

export function stepWasabi(c0: CropState, core: CoreParams, p: WasabiParams, v: WasabiVariety, env: CropEnv, works: readonly WorkTask[]): { crop: CropState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  if (c0.dead || !c0.ws || c0.ws.harvested) return { crop: c0, events };
  const c: CropState = { ...c0, nodes: c0.nodes.map((n) => ({ ...n })), total: { ...c0.total }, cum: { ...c0.cum }, today: { ...c0.today, harvest: { ...c0.today.harvest } }, ws: { ...c0.ws } };
  const ws = c.ws!;
  const day = Math.floor(env.hour / 24);

  // ── 하루 넘김 ──
  if (env.hod === 0 && c.today.dayIndex !== day) {
    const t = c.today;
    c.yesterday = { ...t, sPhoto: t.sPhoto / 24, sExpand: t.sExpand / 24, sFruit: t.sFruit / 24, sSet: t.sSet / 24 };
    const ssrDay = t.demand > 0 ? clamp(t.supply / t.demand, 0, 1) : 1;
    c.ssrAvg += (ssrDay - c.ssrAvg) / p.leaf.acclimDays;
    c.dliAvg += (c.dliToday - c.dliAvg) / p.leaf.acclimDays;
    c.dliToday = 0;
    c.tAvg += (c.t24 - c.tAvg) / p.leaf.acclimDays;
    ws.peakAvg += (ws.peakToday - ws.peakAvg) / p.light.days;
    ws.peakToday = 0;
    // 춘화와 추대
    const b = p.bolting;
    if (ws.boltLeft <= 0) {
      if (c.t24 < b.vernTemp) ws.vern += 1;
      if (ws.vern >= b.vernDays + v.boltDays && c.t24 >= b.startTemp) {
        ws.boltLeft = b.duration;
        ws.vern = 0;
        ws.bolts++;
      }
    }
    // 분얼
    if (c.pd > p.rhizome.half && ws.offshoots < p.offshoot.max) ws.offshoots += p.offshoot.rate * v.offshoot * beta(c.t24, p.dev.tBase, p.dev.tOpt, p.dev.tMax);
    c.today = emptyDay(day);
  }
  c.t24 += (env.tIn - c.t24) / 24;
  c.dliToday += (env.ppfd * 3600) / 1e6;
  if (env.ppfd > ws.peakToday) ws.peakToday = env.ppfd;
  // 근권 온도는 근권 모델(수경: 양액 온도, 배지: 양액·기온 가중)이 계산한다
  const rootNow = env.rz.tRoot;
  ws.rootT += (rootNow - ws.rootT) / 24;

  // ── 작업 ──
  for (const w of works) doWork(c, w, p, v, env, events);
  if (ws.harvested) {
    c.out = summarize(c, p, v, 1, c.out.sla, c.out.stress);
    return { crop: c, events };
  }
  if (env.hod === p.labor.workHour) {
    const pl = c.plan;
    if (pl.deleafEvery > 0 && day - c.lastDeleaf >= pl.deleafEvery) doWork(c, 'deleaf', p, v, env, events);
    if ((pl.runnerEvery ?? 0) > 0 && day - ws.lastOffshoot >= pl.runnerEvery!) doWork(c, 'runner', p, v, env, events);
    if ((pl.stalkEvery ?? 0) > 0 && day - ws.lastStalk >= pl.stalkEvery!) doWork(c, 'thin', p, v, env, events);
  }

  const m = c.density * c.alive;
  const fT = beta(env.tIn, p.dev.tBase, p.dev.tOpt, p.dev.tMax + v.heatTol);
  const dpd = fT / 24;
  c.pd += dpd;

  c.pool += env.gross - env.maint;
  if (c.pool < 0) c.pool = 0;
  c.cum.gross += env.gross;
  c.cum.maint += env.maint;
  c.today.gross += env.gross;
  c.today.maint += env.maint;

  // ── 스트레스 ──
  let wLeaf = 0;
  for (const n of c.nodes) wLeaf += n.w;
  const sWaterExpand = trap(core.water.expand, env.water);
  const fb = feedback(c, core, (wLeaf + c.wStem + c.wRoot) * m);
  const fRoot = rootFactor(c, p);
  const fLight = trap(p.light.inhibit, ws.peakAvg);
  const starve = env.maint + env.starve > 0 ? 1 - env.starve / (env.maint + env.starve) : 1;
  const stress: Stress = {
    photo: trap(core.water.photo, env.water) * env.rz.nutrient * fb * fLight * (1 - p.root.photoShare * (1 - fRoot)),
    expand: sWaterExpand * env.rz.expand * fRoot,
    fruit: trap(core.water.fruit, env.water) * env.rz.fruit * fRoot,
    set: 1, water: sWaterExpand, nutrient: env.rz.nutrient, salt: env.rz.salt, sinkFeedback: fb, tempSet: 1, tempFruit: fT, ssr: 1, chill: 1, heat: 1, starve, training: 1, dormancy: 1, pollination: 1,
    rootTemp: fRoot, light: fLight,
  };

  // ── 새 잎 ──
  const sla = clamp(p.leaf.sla * dpow(p.leaf.slaDliRef / (c.dliAvg > 0.5 ? c.dliAvg : 0.5), p.leaf.slaLightExp) * (1 + p.leaf.slaTemp * (c.tAvg - p.leaf.slaTempRef)), p.leaf.slaMin, p.leaf.slaMax);
  c.nodeFrac += p.leaf.rate * dpd * (c.pd < p.seedling.shock ? p.seedling.shockFactor : 1) * fRoot;
  while (c.nodeFrac >= 1) {
    c.nodeFrac -= 1;
    c.mainNodes++;
    c.nodes.push({ age: 0, area: 0, w: 0, cap: p.leaf.maxArea * v.leafArea, peak: 0, lat: 0 });
  }

  // ── 잠재 생장(sink strength): 잎·엽병, 뿌리, 근경, 분얼, 꽃대 ──
  const rExp = 8 / p.leaf.expandDays;
  const leafDemand: number[] = new Array(c.nodes.length).fill(0);
  const leafDA: number[] = new Array(c.nodes.length).fill(0);
  let dLeaf = 0;
  for (let i = 0; i < c.nodes.length; i++) {
    const n = c.nodes[i]!;
    if (n.age < 2 * p.leaf.expandDays && n.area < n.cap) {
      const s = 1 / (1 + dexp(-rExp * (n.age - p.leaf.expandDays / 2)));
      let dA = n.cap * rExp * s * (1 - s) * dpd * stress.expand;
      if (n.area + dA > n.cap) dA = n.cap - n.area;
      leafDA[i] = dA;
      leafDemand[i] = dA / sla;
      dLeaf += leafDemand[i]!;
    }
  }
  const dRoot = dLeaf * p.rhizome.rootRatio;
  // 근경·분얼·꽃대는 잎과 뿌리를 키우고 남는 당으로 자란다(저장기관은 우선순위가 낮다): 최근 공급/수요 비에 비례해 수요를 줄인다
  const low = clamp(c.ssrAvg, 0, 1);
  const dRhiz = p.rhizome.rate * v.rhizome * (c.pd / (c.pd + p.rhizome.half)) * dpd * stress.fruit * low;
  const dOff = ws.offshoots * p.offshoot.grow * dpd * stress.expand * low;
  const bolting = ws.boltLeft > 0;
  const dStalk = bolting ? p.bolting.sink * dpd * stress.expand * low : 0;
  if (bolting) ws.boltLeft -= dpd;
  const r = p.resp;
  const need = (dLeaf / r.cvfLeaf + (dRhiz + dOff) / r.cvfStem + dRoot / r.cvfRoot + dStalk / r.cvfFruit) * m;
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
  c.wStem += dRhiz * ratio;
  c.wRoot += dRoot * ratio;
  ws.offshootW += dOff * ratio;
  ws.stalkW += dStalk * ratio;
  const gL = dLeaf * ratio * m;
  const gS = (dRhiz + dOff) * ratio * m;
  const gR = dRoot * ratio * m;
  const gF = dStalk * ratio * m;
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

  // ── 잎 노화와 장해(와사비는 엽온이 아니라 실내기온 기준) ──
  const dmg = p.damage;
  let loss = 0;
  if (env.tIn < dmg.chillTemp) loss += dmg.chillRate * (dmg.chillTemp - env.tIn);
  stress.chill = 1 - clamp(loss * 24, 0, 1);
  // 강광 장해가 이어지면 잎이 탄다
  loss += p.light.scorch * (1 - fLight);
  const heatT = dmg.heatTemp + v.heatTol;
  const heatLoss = env.tIn > heatT ? dmg.heatRate * (env.tIn - heatT) : 0;
  stress.heat = 1 - clamp(heatLoss * 24, 0, 1);
  ws.heatLoad = ws.heatLoad * (1 - 1 / 720) + heatLoss;
  loss += heatLoss;
  let frost = false;
  if (env.tIn <= dmg.frostTemp) {
    frost = true;
    loss += dmg.frostRate;
    c.alive *= 1 - dmg.frostRate;
  }
  // 고온 근권: 뿌리·근경이 상해 포기가 죽어 나간다
  const rot = ws.rootT > dmg.rotTemp ? dmg.rotRate * (ws.rootT - dmg.rotTemp) : 0;
  if (rot > 0) c.alive *= 1 - rot;
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
  if (c.alive < 0.02 || (liveArea * m < 0.002 && c.pd > p.seedling.shock)) {
    c.dead = true;
    c.deathCause = frost ? 'frost' : rot > 0 ? 'rot' : ws.heatLoad > 0.01 ? 'heat' : env.tIn < dmg.chillTemp ? 'chill' : 'collapse';
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
  t.fruits = c.out.ws!.rhizomeFresh;
  return { crop: c, events };
}
