/**
 * Phase 5 — physiology 모듈: 생장조절제(PGR) 체내 활성·효과·약해·잔류, 생리장해 위험 지수·발생·피해 원장.
 *
 * 순서: crop 다음에 돈다. 이번 시간의 환경·작물 상태로 위험 지수 R을 계산하고, 다음 한 시간 동안 작물이 적용할
 * 효과(fx)를 만든다(한 시간 지연). 피해의 실제 크기는 작물 모듈이 기관에 적용한 뒤 c.physLoss로 돌려준다.
 *
 *   PGR:  처리 → 체내 활성 A(반감기로 감소) → Hill 곡선 E = Emax·Aʰ/(EC50ʰ+Aʰ) → 엔진 변수(절간·암꽃·휴면·런너·착과·발근·추대)
 *         A가 약해 문턱을 넘으면 약해 T = (A−문턱)/(문턱·slope) → 기형·과번무·생장 정지 등
 *   장해: 원인 변수 → 위험 지수 R(원인별 기여의 합, R ≥ 1이면 발생 조건) → 발생률 I(기대값) → 피해(잎 면적, 등급 하락 kg, 마디)
 */
import { dexp, dpow } from '../dmath';
import { strip } from '../greenhouse/params';
import type { EngineModule, SimEvent, SimState } from '../types';
import type { World } from '../world';
import type { CropId, CropState } from '../crop/types';
import { tissue } from '../rootzone/plant';
import { NEUTRAL_FX, type DisorderDef, type DisorderParams, type DisState, type FxTarget, type PgrMethod, type PgrParams, type PhysFx, type PhysParams, type PhysState } from './types';

export * from './types';

export function buildPhysParams(pgr: unknown, disorders: unknown): PhysParams {
  return { pgr: strip(pgr) as PgrParams, dis: strip(disorders) as DisorderParams };
}

export function initPhys(): PhysState {
  return { pgr: {}, apps: [], dis: {}, arrest: 0, log: [], scout: null, pls: { kgRisk: 0, events: 0, residue: 0 }, hoursNow: 0, won: 0, hours: 0, fx: NEUTRAL_FX, tox: {}, prev: { kg: 0, day: 0, loss: {}, crop: '' }, plsDay: -1 };
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const pos = (x: number) => (x > 0 ? x : 0);
const hill = (a: number, ec50: number, h: number) => (a <= 0 ? 0 : dpow(a, h) / (dpow(ec50, h) + dpow(a, h)));

export function disordersOf(world: World, crop: CropId): Record<string, DisorderDef> {
  return world.phys.dis[crop];
}

/** 생장조절제 처리 1회의 비용·노동·등록 여부(화면 미리보기에도 쓴다). */
export function pgrQuote(world: World, crop: CropId, id: string, ppm: number, method: PgrMethod, area: number) {
  const pr = world.phys.pgr.products[id];
  const m = world.phys.pgr.methods[method];
  if (!pr || !m) return null;
  const g = (ppm * m.volume * area) / 1000;
  const reg = pr.reg[crop];
  return { won: g * pr.price, hours: (m.labor * area) / 1000, grams: g, registered: reg?.status === 'registered', overLabel: !!(reg?.dose && ppm > reg.dose.max * 1.0001), reg };
}

interface RiskIn {
  c: CropState;
  s: SimState;
  w: World;
}

type Drv = Record<string, [number, number]>;

/** 작물별 위험 지수: 원인 변수 값과 R 기여. */
function risk(k: string, d: DisorderDef, x: RiskIn): Drv {
  const { c, s, w } = x;
  const o = s.gh.out;
  const sup = s.rz?.out?.supply;
  const tip = s.rz?.plant?.tipburn ?? 0;
  const salt = sup?.salt ?? 1;
  const water = sup?.water ?? 1;
  const plantN = sup?.plantN ?? 1;
  const th = d.th;
  const st = c.out.stress;
  switch (k) {
    case 'cu_mg': {
      // 아래 잎 Mg 농도(%)가 엽분석 적정 하한 → 결핍 농도로 내려갈수록 R이 0 → 1로 오른다
      const pl = s.rz?.plant;
      const n = w.rz.crop[c.cropId];
      const l = n?.leaf.Mg;
      if (!pl || !n || !l || l[1] <= l[0]) return {};
      const v = tissue(pl, n, w.rz).Mg?.[1] ?? l[1];
      return { '아래 잎 Mg(%)': [v, pos(l[1] - v) / (l[1] - l[0])] };
    }
    case 'sb_tipburn':
      return { '어린 잎 칼슘 부족 지수': [tip, tip / th.idx!] };
    case 'sb_malform': {
      const fl = c.fruits.some((f) => f.age > -3 && f.age < 3);
      const poll = st.pollination;
      return { '수분 조건(벌·꽃가루)': [poll, fl && o.ppfd > 5 ? pos(1 - poll) / (1 - th.poll!) : 0], '꽃 기온(°C)': [o.tIn, o.tIn < th.cold! && fl ? 1 + (th.cold! - o.tIn) / 3 : 0] };
    }
    case 'sb_color':
      return { '일평균 기온(°C)': [c.t24, pos(th.t! - c.t24) / 3], '일적산광(mol m⁻² d⁻¹)': [c.dliAvg, pos(th.dli! - c.dliAvg) / (th.dli! / 2)], '체내 질소(적정 대비)': [plantN, pos(plantN - th.n!) / 0.25] };
    case 'sb_soft':
      return { '일평균 기온(°C)': [c.t24, pos(c.t24 - th.t!) / 4], '칼슘 부족 지수': [tip, tip / th.ca!], '상대습도(%)': [o.rhIn, pos(o.rhIn - th.rh!) / 8] };
    case 'sb_frost': {
      const fr = w.crops.strawberry.fruit.flowerFrost;
      const fl = c.fruits.some((f) => f.age > -3 && f.age < 2);
      return { '꽃 기온(°C)': [o.tIn, fl && o.tIn < fr + th.margin! ? 1 + (fr + th.margin! - o.tIn) / th.margin! : 0] };
    }
    case 'sb_salt':
      return { '염류 수량 감소': [1 - salt, (1 - salt) / th.salt!] };
    case 'cu_curved': {
      let a = 0;
      let n = 0;
      for (const f of c.fruits) if (f.age > 0 && f.dur > 0) {
        a += f.n * (f.def / f.dur);
        n += f.n;
      }
      const def = n > 0 ? a / n : 0;
      return { '비대기 동화산물 부족도': [def, def / th.def!] };
    }
    case 'cu_arrest':
      return {
        '야간 평균 기온(°C)': [c.nightAvg, pos(th.night! - c.nightAvg) / 3],
        '동화산물 공급/수요': [c.ssrAvg, pos(th.ssr! - c.ssrAvg) / 0.25],
        '근권 염류 수량 감소': [1 - salt, (1 - salt) / th.salt!],
        '뿌리 활력': [sup?.rootAct ?? 1, pos(1 - (sup?.rootAct ?? 1)) / th.root!],
      };
    case 'cu_scorch':
      return { '엽온(°C)': [o.tLeaf, o.ppfd > th.ppfd! ? pos(o.tLeaf - th.tleaf!) / 5 : 0] };
    case 'cu_drop':
      return { '착과 스트레스': [1 - st.set, (1 - st.set) / th.set!] };
    case 'cu_bitter':
      return { '수분 스트레스': [1 - water, (1 - water) / th.water!], '기온(°C)': [o.tIn, pos(o.tIn - th.t!) / 4], '체내 질소(적정 대비)': [plantN, pos(plantN - th.n!) / 0.3] };
    case 'ws_scorch':
      return { '강광 억제': [1 - st.light, (1 - st.light) / th.light!] };
    case 'ws_rot': {
      const rot = w.crops.wasabi.damage.rotTemp;
      const rt = c.ws?.rootT ?? o.tSolution;
      const dO = s.rz?.dO ?? 8;
      return { '근권 온도(°C)': [rt, pos(rt - (rot - th.t!)) / 2], '용존산소(mg/L)': [dO, pos(th.o2! - dO) / 2] };
    }
    case 'ws_bolt': {
      const ws = c.ws!;
      const need = w.crops.wasabi.bolting.vernDays + (w.crops.varieties.wasabi[c.varietyId]?.boltDays ?? 0);
      return { '춘화 진행(일)': [ws.vern, ws.boltLeft > 0 ? 2 : ws.vern / (need > 0 ? need : 1)] };
    }
    case 'ws_tipburn':
      return { '어린 잎 칼슘 부족 지수': [tip, tip / th.idx!], '염류 수량 감소': [1 - salt, (1 - salt) / th.salt!] };
    case 'ws_heat':
      return { '고온 스트레스': [1 - st.heat, (1 - st.heat) / th.s!] };
    case 'ws_cold':
      return { '저온 스트레스': [1 - st.chill, (1 - st.chill) / th.s!] };
  }
  return {};
}

const emptyDis = (): DisState => ({ R: 0, rMax: 0, hoursOver: 0, I: 0, sev: 0, loss: 0, onset: -1, drv: {}, drvDay: {} });

const FRUIT_KEY: Partial<Record<FxTarget, Record<CropId, string>>> = {
  malform: { strawberry: 'sb_malform', cucumber: 'pgr_malform', wasabi: '' },
  soft: { strawberry: 'sb_soft', cucumber: '', wasabi: '' },
  bitter: { strawberry: '', cucumber: 'cu_bitter', wasabi: '' },
  curved: { strawberry: '', cucumber: 'pgr_curved', wasabi: '' },
};

/** 생장조절제 효과를 fx에 더한다. 약해(tox)는 활성이 문턱을 넘은 만큼. */
function pgrFx(ph: PhysState, P: PgrParams, crop: CropId, fx: PhysFx, tox: Record<string, number>) {
  for (const [id, a] of Object.entries(ph.pgr)) {
    const pr = P.products[id];
    if (!pr || (a.plant < 1e-4 && a.flower < 1e-4)) continue;
    const list: [FxTarget, 'plant' | 'flower', number][] = [];
    for (const e of pr.effects[crop] ?? []) list.push([e.target, e.comp, e.emax * hill(e.comp === 'flower' ? a.flower : a.plant, e.ec50, e.hill)]);
    const tx = pr.tox[crop];
    if (tx) {
      const amax = a.plant > a.flower ? a.plant : a.flower;
      const T = clamp((amax - tx.thr) / (tx.thr * tx.slope), 0, 1);
      tox[id] = T;
      if (T > 0) for (const [t, v] of Object.entries(tx.effects)) list.push([t as FxTarget, 'plant', (v ?? 0) * T]);
    }
    for (const [t, , E] of list) {
      if (E === 0) continue;
      switch (t) {
        case 'expand': fx.expand *= 1 + E; break;
        case 'internode': fx.internode *= 1 + E; break;
        case 'female': fx.female += E; break;
        case 'node': fx.node *= 1 + E; break;
        case 'dorm': fx.dorm += E; break;
        case 'runner': fx.runner *= 1 + E; break;
        case 'set': fx.set += E; break;
        case 'fruitGrow': fx.fruitGrow *= 1 + E; break;
        case 'root': fx.root *= 1 + E; break;
        case 'bolt': fx.bolt += E; break;
        case 'senesce': if (E > 0) fx.leaf.push({ key: `pgr_${id}`, target: 'all', rate: E / 24 }); break;
        default: {
          // 약해 노출은 장해별 "_pgr" 키로 따로 쌓는다(창: 꽃·어린 과실, 개화 전후 −5~+3 생리일)
          const base = FRUIT_KEY[t]?.[crop];
          if (base && E > 0) {
            const key = base.startsWith('pgr_') ? base : `${base}_pgr`;
            const r = fx.fruitRisk[key];
            fx.fruitRisk[key] = { rate: (r?.rate ?? 0) + E, a0: -5, a1: 3 };
            fx.grades[key] = base === 'pgr_curved' ? 'mid' : 'cull';
          }
        }
      }
    }
  }
  fx.expand = clamp(fx.expand, 0.2, 2);
  fx.internode = clamp(fx.internode, 0.3, 2);
  fx.node = clamp(fx.node, 0, 1.5);
  fx.runner = clamp(fx.runner, 0, 4);
  fx.set = clamp(fx.set, -1, 0.95);
  fx.female = clamp(fx.female, -1, 1);
  fx.fruitGrow = clamp(fx.fruitGrow, 0.5, 1.5);
  fx.root = clamp(fx.root, 0.2, 2);
  fx.dorm = clamp(fx.dorm, 0, 1);
}

function cropKeyOf(c: CropState | null): string {
  return c ? `${c.cropId}:${c.plantedHour}` : '';
}

export function stepPhysiology(state: SimState, world: World, actions: readonly { type: string; payload: unknown }[]): { phys: PhysState; events: SimEvent[] } {
  const P = world.phys;
  const events: SimEvent[] = [];
  const c = state.crop;
  const hour = state.hour;
  const day = Math.floor(hour / 24);
  const area = state.gh.setup.area;
  let ph: PhysState = { ...(state.phys ?? initPhys()), hoursNow: 0 };
  ph.pgr = { ...ph.pgr };

  // 새 작기면 장해 상태를 비운다
  const ck = cropKeyOf(c);
  if (ck !== ph.prev.crop) {
    ph = { ...ph, dis: {}, arrest: 0, pgr: {}, scout: null, prev: { kg: c ? c.total.top + c.total.mid : 0, day, loss: {}, crop: ck } };
  }

  // ── 조치 ──
  for (const a of actions) {
    if (a.type === 'phys/pgr' && c && !c.dead) {
      const { id, ppm, method } = a.payload as { id: string; ppm: number; method: PgrMethod };
      const pr = P.pgr.products[id];
      const m = P.pgr.methods[method];
      if (!pr || !m || !(ppm > 0)) continue;
      const q = pgrQuote(world, c.cropId, id, ppm, method, area)!;
      const cur = ph.pgr[id] ?? { plant: 0, flower: 0, residue: 0, last: hour, count: 0 };
      ph.pgr[id] = { plant: cur.plant + ppm * m.plant, flower: cur.flower + ppm * m.flower, residue: cur.residue + pr.residue.dep * ppm * (m.flower > m.plant ? m.flower : m.plant), last: hour, count: cur.count + 1 };
      ph.apps = [...ph.apps, { hour, id, ppm, method, registered: q.registered, won: q.won, hours: q.hours }].slice(-200);
      ph.won += q.won;
      ph.hours += q.hours;
      ph.hoursNow += q.hours;
      if (!q.registered) {
        ph.pls = { ...ph.pls, events: ph.pls.events + 1 };
        events.push({ hour, type: 'physiology', level: 'warning', code: `pls:${id}`, value: ppm });
      } else if (q.overLabel) events.push({ hour, type: 'physiology', level: 'warning', code: `label:${id}`, value: ppm });
    } else if (a.type === 'phys/scout' && c && !c.dead) {
      const h = (P.dis.scoutLabor * area) / 1000;
      ph.hours += h;
      ph.hoursNow += h;
      const obs: Record<string, { I: number; sev: number }> = {};
      for (const [k, d] of Object.entries(P.dis[c.cropId])) {
        const st = ph.dis[k];
        const seen = st && d.visible && st.I >= P.dis.detect;
        obs[k] = seen ? { I: Math.round(st.I * 100) / 100, sev: Math.round(st.sev * 100) / 100 } : { I: 0, sev: 0 };
      }
      ph.scout = { hour, obs };
    }
  }

  // ── PGR 활성·잔류 감소 ──
  for (const [id, a] of Object.entries(ph.pgr)) {
    const pr = P.pgr.products[id];
    if (!pr) continue;
    const k = dexp(-Math.LN2 / (pr.halfLife * 24));
    const kr = dexp(-Math.LN2 / (pr.residue.halfLife * 24));
    ph.pgr[id] = { ...a, plant: a.plant * k, flower: a.flower * k, residue: a.residue * kr };
  }

  if (!c || c.dead) {
    ph.fx = NEUTRAL_FX;
    return { phys: ph, events };
  }

  // ── 하루 마감: 원장 기록 ──
  const loss = c.physLoss ?? {};
  const defs = P.dis[c.cropId];
  ph.dis = { ...ph.dis };
  if (day !== ph.prev.day) {
    const log = [...ph.log];
    for (const k of Object.keys(defs)) {
      const st = ph.dis[k];
      if (!st) continue;
      const dl = (loss[k] ?? 0) + (loss[`${k}_pgr`] ?? 0) - (ph.prev.loss[k] ?? 0) - (ph.prev.loss[`${k}_pgr`] ?? 0);
      if (st.hoursOver > 0 || dl > 1e-9) log.push({ d: ph.prev.day, k, drv: st.drvDay, rMax: st.rMax, hours: st.hoursOver, I: st.I, loss: dl });
      ph.dis[k] = { ...st, rMax: 0, hoursOver: 0, drvDay: {} };
    }
    ph.log = log.length > 1500 ? log.slice(log.length - 1500) : log;
    ph.prev = { ...ph.prev, day, loss: { ...loss } };
  }

  // ── 생리장해 ──
  const fx: PhysFx = { ...NEUTRAL_FX, leaf: [], fruitRisk: {}, rhizome: {}, grades: {} };
  const x: RiskIn = { c, s: state, w: world };
  const mat = c.cropId === 'strawberry' ? world.crops.strawberry.fruit.maturity : 1;
  for (const [k, d] of Object.entries(defs)) {
    const drv = risk(k, d, x);
    let R = 0;
    for (const v of Object.values(drv)) R += v[1];
    const prev = ph.dis[k] ?? emptyDis();
    const st: DisState = { ...prev, R, drv, rMax: R > prev.rMax ? R : prev.rMax };
    const ex = R > 1 ? (R - 1 > 3 ? 3 : R - 1) : 0;
    if (R > 1) {
      st.hoursOver = prev.hoursOver + 1;
      const dd = { ...prev.drvDay };
      for (const [n, v] of Object.entries(drv)) if (v[1] > 0) dd[n] = (dd[n] ?? 0) + v[1];
      st.drvDay = dd;
      st.sev = prev.sev + ((ex / 2 > 1 ? 1 : ex / 2) - prev.sev) / 24;
    }
    if (d.mode === 'fruit') {
      if (ex > 0 && d.window) {
        const a0 = d.rel ? d.window[0] * mat : d.window[0];
        const a1 = d.rel ? d.window[1] * mat : d.window[1];
        // 기형과(딸기): 수분 불량은 수확 때 따로 계산하므로 꽃 저온 기여만 노출로 쓴다
        const exF = k === 'sb_malform' ? pos((drv['꽃 기온(°C)']?.[1] ?? 0) - 1) : ex;
        if (exF > 0) fx.fruitRisk[k] = { rate: d.loss * exF, a0, a1 };
      }
      if (d.grade) fx.grades[k] = d.grade;
      let a = 0;
      let n = 0;
      const a0 = d.window ? (d.rel ? d.window[0] * mat : d.window[0]) : -99;
      for (const f of c.fruits) if (f.age >= a0 && (k !== 'sb_malform' || f.age > 0)) {
        // 딸기 기형과: 수분 불량(e^−수분 지수)과 저온·약해 노출을 함께 본다
        const e = (f.dis?.[k] ?? 0) + (f.dis?.[`${k}_pgr`] ?? 0);
        const good = k === 'sb_malform' ? (1 - dexp(-(f.poll ?? 0))) * dexp(-e) : dexp(-e);
        a += f.n * (1 - good);
        n += f.n;
      }
      st.I = n > 0 ? a / n : prev.I * 0.99;
      if (fx.grades[`${k}_pgr`] === undefined && d.grade) fx.grades[`${k}_pgr`] = d.grade;
    } else if (d.mode === 'rhizome') {
      if (ex > 0) fx.rhizome[k] = d.loss * ex;
      if (d.grade) fx.grades[k] = d.grade;
      st.I = 1 - dexp(-(c.rhz?.[k] ?? 0));
    } else if (k === 'ws_bolt') {
      st.I = c.ws && (c.ws.bolts > 0 || c.ws.boltLeft > 0) ? 1 : 0;
    } else {
      st.I = R > 1 ? prev.I + (d.on / 24) * ex * (1 - prev.I) : prev.I - (d.off / 24) * prev.I;
      if (d.mode === 'leaf' && ex > 0 && d.target) fx.leaf.push({ key: k, target: d.target, rate: (d.loss * ex) / 24 });
      if (d.mode === 'apex') {
        ph.arrest = st.I;
        fx.arrest = d.loss * st.I;
      }
    }
    if (d.mode === 'record' && c.cropId === 'cucumber' && k === 'cu_curved') fx.grades[k] = 'mid';
    st.loss = (loss[k] ?? 0) + (loss[`${k}_pgr`] ?? 0);
    if (st.onset < 0 && st.I >= P.dis.detect) {
      st.onset = hour;
      events.push({ hour, type: 'physiology', level: 'advisory', code: `dis:${k}`, value: st.I });
    }
    ph.dis[k] = st;
  }

  // ── 생장조절제 효과 ──
  const tox: Record<string, number> = {};
  pgrFx(ph, P.pgr, c.cropId, fx, tox);
  for (const [id, T] of Object.entries(tox)) {
    const was = state.phys?.tox?.[id] ?? 0;
    if (T > 0.05 && was <= 0.05) events.push({ hour, type: 'physiology', level: 'warning', code: `tox:${id}`, value: T });
  }
  ph.tox = tox;
  ph.fx = fx;

  // ── PLS: 미등록 약제 잔류가 일률기준(0.01 mg/kg)을 넘는 동안 수확한 양 ──
  const kgNow = c.total.top + c.total.mid;
  const dKg = kgNow - ph.prev.kg;
  let res = 0;
  for (const [id, a] of Object.entries(ph.pgr)) if (P.pgr.products[id]?.reg[c.cropId]?.status !== 'registered' && a.residue > res) res = a.residue;
  if (dKg > 0 && res > P.pgr.pls.mrl) {
    ph.pls = { ...ph.pls, kgRisk: ph.pls.kgRisk + dKg };
    if (ph.plsDay !== day) {
      ph.plsDay = day;
      events.push({ hour, type: 'physiology', level: 'warning', code: 'pls:residue', value: res });
    }
  }
  ph.pls = { ...ph.pls, residue: res };
  ph.prev = { ...ph.prev, kg: kgNow };
  return { phys: ph, events };
}

export const physiologyModule: EngineModule = {
  id: 'physiology',
  title: '생리장해, 생장조절제(PGR)',
  plannedPhase: 5,
  implemented: true,
  step(state, { world, actions }): SimState {
    const r = stepPhysiology(state, world, actions);
    return { ...state, phys: r.phys, events: r.events.length ? [...state.events, ...r.events] : state.events };
  },
};
