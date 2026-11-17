/**
 * 식물체 양분: 신엽(up)·하위엽(low)·줄기·뿌리(str)·수확기관(fr) 4구획의 원소량(mmol/m²).
 *  - 흡수 = 질량류(σ × 증산 × 농도) + 능동 흡수(Michaelis–Menten × 뿌리 활력 × pH 가급도 × 길항 × 체내 조절).
 *  - 분배: 이동성 몫은 새 조직의 요구량대로(부족하면 하위엽에서 재전류 → 하엽부터 결핍),
 *          비이동성 몫은 증산 몫대로(신엽·과실은 증산이 적어 칼슘이 덜 간다 → 팁번).
 *  - 원소 'NO3' 칸은 식물 안에서 전체 질소(N)를 뜻한다(NH4 칸은 쓰지 않는다).
 */
import type { CropState } from '../crop/types';
import { IONS, zero, type Ion, type IonVec } from './chem';
import type { CropNutrition, PlantPools, RzParams, RzSupply } from './types';
import { trap } from '../crop/canopy';
import { dpow } from '../dmath';

/** 식물 조직 농도 환산용 원소 질량(N은 질소 원자). */
export const ELEM: IonVec = { NO3: 14.007, NH4: 14.007, P: 30.97, K: 39.1, Ca: 40.08, Mg: 24.31, S: 32.06, Na: 22.99, Cl: 35.45, HCO3: 12.01, Fe: 55.85, Mn: 54.94, Zn: 65.38, B: 10.81, Cu: 63.55, Mo: 95.95 };
const MACRO_PCT: readonly Ion[] = ['NO3', 'P', 'K', 'Ca', 'Mg', 'S', 'Na', 'Cl'];
export const PLANT_IONS: readonly Ion[] = ['NO3', 'P', 'K', 'Ca', 'Mg', 'S', 'Na', 'Cl', 'Fe', 'Mn', 'Zn', 'B', 'Cu', 'Mo'];

/** mmol/g → 표시 단위(다량 %, 미량 mg/kg) */
export function toDisplay(i: Ion, mmolPerG: number): number {
  return (MACRO_PCT as readonly string[]).includes(i) ? (mmolPerG * ELEM[i]) / 10 : mmolPerG * ELEM[i] * 1000;
}
export function fromDisplay(i: Ion, v: number): number {
  return (MACRO_PCT as readonly string[]).includes(i) ? (v * 10) / ELEM[i] : v / (ELEM[i] * 1000);
}

/** 표준 엽분석 시료(성엽) 적정 농도(mmol/g) = 적정 범위 가운데 */
export function optUp(n: CropNutrition, i: Ion): number {
  const l = n.leaf[i];
  if (!l || l[1] < 0) return 0;
  return fromDisplay(i, (l[1] + l[2]) / 2);
}
/** 어린 잎(신엽 구획) 정상 농도 = 성엽 × young(칼슘·붕소·망간은 어린 잎에서 낮다) */
export function optYoung(n: CropNutrition, p: RzParams, i: Ion): number {
  return optUp(n, i) * (p.uptake[i]?.young ?? 1);
}
export function optFruit(n: CropNutrition, i: Ion): number {
  const f = n.fruit[i];
  return f === undefined ? 0 : fromDisplay(i, f);
}

export interface CropDm {
  up: number;
  low: number;
  str: number;
  fr: number;
  /** 신엽 엽면적 비율 */
  upArea: number;
  /** 그날 생장 누적(g/m²) */
  g: { day: number; leaf: number; stem: number; root: number; fruit: number };
}

/** 작물 상태에서 구획 건물을 읽는다. */
export function cropDm(c: CropState, expandDays: number, youngAge: number): CropDm {
  const m = c.density * c.alive;
  let up = 0;
  let low = 0;
  let aUp = 0;
  let aAll = 0;
  for (const n of c.nodes) {
    if (n.age < expandDays * youngAge) {
      up += n.w;
      aUp += n.area;
    } else low += n.w;
    aAll += n.area;
  }
  let fr = 0;
  for (const f of c.fruits) fr += f.n * f.w;
  let str = c.wStem + c.wRoot;
  if (c.cropId === 'strawberry' && c.sb) str += c.sb.runnerW;
  if (c.cropId === 'wasabi' && c.ws) {
    fr = c.wStem + c.ws.stalkW + c.ws.offshootW;
    str = c.wRoot;
  }
  const t = c.today;
  const g =
    c.cropId === 'wasabi'
      ? { day: t.dayIndex, leaf: t.gLeaf, stem: t.gRoot, root: 0, fruit: t.gStem + t.gFruit }
      : { day: t.dayIndex, leaf: t.gLeaf, stem: t.gStem, root: t.gRoot, fruit: t.gFruit };
  return { up: up * m, low: low * m, str: str * m, fr: fr * m, upArea: aAll > 0 ? aUp / aAll : 1, g };
}

export function initPools(key: string, d: CropDm, n: CropNutrition, p: RzParams): PlantPools {
  const up = zero();
  const low = zero();
  const str = zero();
  const fr = zero();
  for (const i of PLANT_IONS) {
    const o = optUp(n, i);
    up[i] = d.up * optYoung(n, p, i);
    low[i] = d.low * o;
    str[i] = d.str * o * (p.uptake[i]?.stem ?? p.plant.strFactor);
    fr[i] = d.fr * optFruit(n, i);
  }
  return { cropKey: key, dm: { up: d.up, low: d.low, str: d.str, fr: d.fr }, up, low, str, fr, prevG: { ...d.g }, caUp: 0, caNeed: 0, caRatio: 1, tipburn: 0 };
}

export function poolTotal(pl: PlantPools): IonVec {
  const t = zero();
  for (const i of IONS) t[i] = pl.up[i] + pl.low[i] + pl.str[i] + pl.fr[i];
  return t;
}

const conc = (amt: number, dm: number, fallback: number) => (dm > 1e-6 ? amt / dm : fallback);

/**
 * 한 시간 분배. uptake: 원소별 흡수 mmol/m². vpd: kPa. 돌려주는 값: 식물 밖으로 나간 양(수확·낙엽).
 */
/** rpF: 근압 계수(0–1, 근권 EC가 높거나 뿌리 활력이 낮으면 줄어든다) */
export function allocate(pl: PlantPools, d: CropDm, uptake: IonVec, n: CropNutrition, p: RzParams, vpd: number, newDay: boolean, rpF = 1): IonVec {
  const out = zero();
  const pp = p.plant;
  // 이번 시간 생장
  const same = d.g.day === pl.prevG.day;
  const gLeaf = Math.max(0, d.g.leaf - (same ? pl.prevG.leaf : 0));
  const gStr = Math.max(0, d.g.stem + d.g.root - (same ? pl.prevG.stem + pl.prevG.root : 0));
  const gFr = Math.max(0, d.g.fruit - (same ? pl.prevG.fruit : 0));
  pl.prevG = { ...d.g };
  const dm0 = pl.dm;
  const remob = zero();
  // 신엽 → 하위엽 이행(엽령), 각 구획의 손실(낙엽·적엽·수확·퇴화)
  const age = Math.max(0, dm0.up + gLeaf - d.up);
  const rLow = Math.max(0, dm0.low + age - d.low);
  const rFr = Math.max(0, dm0.fr + gFr - d.fr);
  const rStr = Math.max(0, dm0.str + gStr - d.str);
  for (const i of PLANT_IONS) {
    const mob = p.uptake[i]?.mobility ?? 0;
    const upBase = dm0.up + gLeaf;
    const mv = upBase > 1e-9 ? pl.up[i] * Math.min(1, age / upBase) : 0;
    pl.up[i] -= mv;
    pl.low[i] += mv;
    const lowBase = dm0.low + age;
    const lostLow = lowBase > 1e-9 ? pl.low[i] * Math.min(1, rLow / lowBase) : 0;
    pl.low[i] -= lostLow;
    // 지는 잎에서 미리 회수한 이동성 원소는 이번 시간의 체관 공급에 더한다
    const back = lostLow * pp.senescRemob * mob;
    remob[i] += back;
    out[i] += lostLow - back;
    const frBase = dm0.fr + gFr;
    const lostFr = frBase > 1e-9 ? pl.fr[i] * Math.min(1, rFr / frBase) : 0;
    pl.fr[i] -= lostFr;
    out[i] += lostFr;
    const strBase = dm0.str + gStr;
    const lostStr = strBase > 1e-9 ? pl.str[i] * Math.min(1, rStr / strBase) : 0;
    pl.str[i] -= lostStr;
    out[i] += lostStr;
  }
  // 물관(증산류) 몫의 분배 가중: 어린 잎·과실은 면적당 증산이 작다(습하면 더 작다 → 팁번)
  const fy = vpd / (vpd + pp.youngTransp);
  const leafDm = d.up + d.low;
  // 물관 몫 가운데 rp는 밤의 근압 흐름: 증산과 무관하게 자라는 조직(생장 요구량)으로 간다
  const rp = pp.rootPressure * rpF;
  const wUp = d.upArea * fy;
  const wLow = leafDm > 0 ? 1 - d.upArea : 0;
  const wFr = leafDm + d.fr > 0 ? (pp.fruitTransp * d.fr) / (leafDm + d.fr) : 0;
  const tot4 = d.up + d.low + d.str + d.fr;
  const wStr = tot4 > 0 ? (0.1 * d.str) / tot4 : 1;
  const wSum = wUp + wLow + wFr + wStr > 0 ? wUp + wLow + wFr + wStr : 1;
  if (newDay) {
    const ratio = pl.caNeed > 1e-9 ? pl.caUp / pl.caNeed : 1;
    pl.caRatio = ratio;
    const idx = 1 - (ratio < 1 ? ratio : 1);
    pl.tipburn += (idx - pl.tipburn) / Math.max(1, pp.tipburnDays);
    pl.caUp = 0;
    pl.caNeed = 0;
  }
  for (const i of PLANT_IONS) {
    const U0 = uptake[i] + (i === 'NO3' ? uptake.NH4 : 0);
    const k = p.uptake[i];
    const mob = k?.mobility ?? 0;
    const xy = k?.xylem ?? 0;
    const dUp = gLeaf * optYoung(n, p, i);
    const dFr = gFr * optFruit(n, i);
    const dStr = gStr * optUp(n, i) * (k?.stem ?? pp.strFactor);
    const D = dUp + dFr + dStr;
    // 체관·능동 몫: 생장 요구량대로. 모자라면 하위엽에서 재전류(이동성만큼) → 이동성 원소는 하엽부터 결핍.
    let mU = U0 * (1 - xy);
    let rU = remob[i];
    if (D > 0) {
      // 먼저 지는 잎에서 회수한 양, 다음 새로 흡수한 양으로 요구량을 채운다
      let give = rU < D ? rU : D;
      rU -= give;
      const fromU = mU < D - give ? mU : D - give;
      give += fromU;
      mU -= fromU;
      if (give < D && mob > 0) {
        const lowMin = d.low * Math.max(0, fromDisplay(i, n.leaf[i]?.[0] ?? 0));
        const avail = Math.max(0, pl.low[i] - lowMin) * pp.remob * mob;
        const need = D - give;
        const rem = avail < need ? avail : need;
        pl.low[i] -= rem;
        give += rem;
      }
      pl.up[i] += (give * dUp) / D;
      pl.fr[i] += (give * dFr) / D;
      pl.str[i] += (give * dStr) / D;
    }
    // 회수했지만 쓰이지 않은 몫은 줄기·관부·뿌리에 저장
    if (rU > 0) pl.str[i] += rU;
    // 남는 몫(사치 흡수)은 잎에 저장, 잎이 없으면 줄기·뿌리에
    if (mU > 0) {
      if (leafDm > 0) {
        pl.up[i] += (mU * d.up) / leafDm;
        pl.low[i] += (mU * d.low) / leafDm;
      } else pl.str[i] += mU;
    }
    // 물관 몫: (1 − rp)는 증산 비율대로, rp는 생장 요구량 비율대로(요구가 없으면 증산 비율)
    const xU = U0 * xy;
    const xT = D > 0 ? xU * (1 - rp) : xU;
    const xR = xU - xT;
    pl.up[i] += (xT * wUp) / wSum + (D > 0 ? (xR * dUp) / D : 0);
    pl.low[i] += (xT * wLow) / wSum;
    pl.fr[i] += (xT * wFr) / wSum + (D > 0 ? (xR * dFr) / D : 0);
    pl.str[i] += (xT * wStr) / wSum + (D > 0 ? (xR * dStr) / D : 0);
    if (i === 'Ca') {
      pl.caUp += (xT * wUp) / wSum + (D > 0 ? (xR * dUp) / D : 0);
      pl.caNeed += dUp;
    }
  }
  pl.dm = { up: d.up, low: d.low, str: d.str, fr: d.fr };
  return out;
}

/** 구획 농도(표시 단위) */
export function tissue(pl: PlantPools, n: CropNutrition, p: RzParams): Partial<Record<Ion, [number, number]>> {
  const t: Partial<Record<Ion, [number, number]>> = {};
  // 구획 건물이 아주 작으면(잎을 거의 다 딴 직후) 농도가 튀므로 잎 전체 평균을 쓴다
  const lw = pl.dm.up + pl.dm.low;
  const tinyUp = pl.dm.up < 0.05 * lw;
  const tinyLow = pl.dm.low < 0.05 * lw;
  for (const i of PLANT_IONS) {
    const all = lw > 1e-9 ? (pl.up[i] + pl.low[i]) / lw : optUp(n, i);
    const cu = tinyUp ? all : conc(pl.up[i], pl.dm.up, optYoung(n, p, i));
    const cl = tinyLow ? all : conc(pl.low[i], pl.dm.low, optUp(n, i));
    t[i] = [toDisplay(i, cu), toDisplay(i, cl)];
  }
  return t;
}

/** 결핍 계수(0–1): 심한 결핍 농도에서 0, 적정 하한에서 1. y: 어린 잎 보정 배수 */
function fDef(fl: number, n: CropNutrition, i: Ion, v: number, y = 1): number {
  const l = n.leaf[i];
  if (!l || l[1] < 0) return 1;
  const x = (v - l[0] * y) / ((l[1] - l[0]) * y);
  // 심한 결핍 농도에서도 과정이 완전히 멈추지는 않는다(바닥값 plant.defFloor)
  return x <= 0 ? fl : x >= 1 ? 1 : fl + (1 - fl) * x;
}
/** 과잉·독성 계수: 독성 농도부터 줄어 독성의 2배에서 0.2 */
function fTox(n: CropNutrition, i: Ion, v: number): number {
  const l = n.leaf[i];
  if (!l || l[3] >= 99) return 1;
  const x = (v - l[3]) / l[3];
  return x <= 0 ? 1 : 1 - 0.8 * (x >= 1 ? 1 : x);
}

const pw = (a: number, b: number) => (a <= 0 ? 0 : a >= 1 ? 1 : dpow(a, b));

/** 작물에 넘길 양분 계수와 염해(G6). ecRoot: 근권 용액 EC. */
export function supplyOf(pl: PlantPools | null, n: CropNutrition, p: RzParams, ecRoot: number, water: number, tRoot: number, rootAct: number): RzSupply {
  const salt = 1 - (n.salt.b / 100) * Math.max(0, ecRoot * p.toECe - n.salt.a);
  const sSalt = salt < 0 ? 0 : salt;
  if (!pl) return { water, nutrient: 1, photo: [1, 1, 1], expand: sSalt, fruit: sSalt, set: 1, salt: sSalt, brix: 1, plantN: 1, tRoot, rootAct, tipburn: 0 };
  const t = tissue(pl, n, p);
  const fl = p.plant.defFloor;
  const up = (i: Ion) => t[i]![0];
  const Y = (i: Ion) => p.uptake[i]?.young ?? 1;
  const lo = (i: Ion) => t[i]![1];
  const top = pw(fDef(fl, n, 'NO3', up('NO3'), Y('NO3')), 1) * pw(fDef(fl, n, 'Mg', up('Mg'), Y('Mg')), 0.7) * pw(fDef(fl, n, 'Fe', up('Fe'), Y('Fe')), 0.8) * pw(fDef(fl, n, 'Mn', up('Mn'), Y('Mn')), 0.5) * pw(fDef(fl, n, 'K', up('K'), Y('K')), 0.4) * pw(fDef(fl, n, 'S', up('S'), Y('S')), 0.5) * pw(fDef(fl, n, 'Zn', up('Zn'), Y('Zn')), 0.3) * pw(fDef(fl, n, 'Cu', up('Cu'), Y('Cu')), 0.3);
  const tox = fTox(n, 'Mn', lo('Mn')) * fTox(n, 'B', lo('B')) * fTox(n, 'Na', lo('Na')) * fTox(n, 'Cl', lo('Cl')) * fTox(n, 'Zn', lo('Zn')) * fTox(n, 'Cu', lo('Cu'));
  const bottom = pw(fDef(fl, n, 'NO3', lo('NO3')), 1) * pw(fDef(fl, n, 'Mg', lo('Mg')), 0.8) * pw(fDef(fl, n, 'K', lo('K')), 0.6) * tox;
  const mid = Math.sqrt(top * bottom);
  const expandN = pw(fDef(fl, n, 'NO3', up('NO3'), Y('NO3')), 1) * pw(fDef(fl, n, 'P', up('P'), Y('P')), 1) * pw(fDef(fl, n, 'K', up('K'), Y('K')), 0.5) * pw(fDef(fl, n, 'Ca', up('Ca'), Y('Ca')), 0.5) * pw(fDef(fl, n, 'B', up('B'), Y('B')), 0.5) * pw(fDef(fl, n, 'Zn', up('Zn'), Y('Zn')), 0.5) * pw(fDef(fl, n, 'S', up('S'), Y('S')), 0.5) * pw(fDef(fl, n, 'Fe', up('Fe'), Y('Fe')), 0.3);
  const expand = expandN * sSalt;
  const fruit = pw(fDef(fl, n, 'NO3', up('NO3'), Y('NO3')), 0.5) * pw(fDef(fl, n, 'P', up('P'), Y('P')), 0.5) * pw(fDef(fl, n, 'K', up('K'), Y('K')), 1) * sSalt;
  const set = pw(fDef(fl, n, 'P', up('P'), Y('P')), 0.5) * pw(fDef(fl, n, 'B', up('B'), Y('B')), 0.5) * pw(fDef(fl, n, 'NO3', up('NO3'), Y('NO3')), 0.3);
  const oN = optUp(n, 'NO3');
  const plantN = oN > 0 ? fromDisplay('NO3', up('NO3')) / oN : 1;
  let brix = 1;
  if (n.brixK !== undefined) {
    const oK = optFruit(n, 'K');
    const kRel = oK > 0 && pl.dm.fr > 1e-6 ? pl.fr.K / pl.dm.fr / oK : 1;
    brix = (1 - n.brixK * Math.max(0, 1 - kRel)) * (1 + (n.brixEC ?? 0) * (ecRoot - (n.brixECRef ?? 1)));
  }
  const pAvg = (top * tox + mid + bottom) / 3;
  return { water, nutrient: pAvg < expandN ? pAvg : expandN, photo: [top * tox, mid, bottom], expand, fruit, set, salt: sSalt, brix, plantN, tRoot, rootAct, tipburn: pl.tipburn * n.tipburn };
}

/** 이온 흡수(한 시간, mmol/m²). conc: 근권 mmol/L, W: 근권 물 L/m², U: 물 흡수 L/m², RM: 뿌리 건물 g/m². */
export function uptakeOf(conc: IonVec, W: number, U: number, RM: number, rootAct: number, pH: number, pl: PlantPools | null, n: CropNutrition, p: RzParams): IonVec {
  const u = zero();
  for (const i of IONS) {
    const k = p.uptake[i];
    if (!k || conc[i] <= 0) continue;
    const C = conc[i];
    let km = k.km;
    const ant = p.antagonism[i];
    if (ant) for (const [j, ki] of Object.entries(ant)) km *= 1 + conc[j as Ion] / (ki as number);
    let avail = 1;
    const curve = p.pHAvail[i];
    if (curve) avail = trap(curve, pH);
    if (i === 'Mn' && pH < 5.5) avail *= 1 + ((p.mnLowPH - 1) * Math.min(1, 5.5 - pH)) / 1;
    // 체내 조절: 신엽 농도가 적정보다 높으면 능동 흡수를 줄이고, 낮으면 늘린다
    let reg = 1;
    const el: Ion = i === 'NH4' ? 'NO3' : i;
    const o = optUp(n, el);
    if (pl && o > 0) {
      // 체내 상태 = 잎 전체(신엽+하위엽) 평균 농도 ÷ 적정
      const lw = pl.dm.up + pl.dm.low;
      const rel = (lw > 1e-6 ? (pl.up[el] + pl.low[el]) / lw : o) / o;
      // 적정의 1.1배까지는 최대 속도, 그 위로는 regulation 배수에서 0이 되도록 줄인다(사치 흡수 허용 폭).
      const R = p.root.regulation;
      // 암모늄은 체내 질소가 많아도 흡수가 1/4 아래로는 줄지 않는다(암모늄 우선 흡수)
      if (i === 'NH4') reg = rel > 1.1 ? Math.max(0.25, (R - rel) / (R - 1.1)) : 1;
      else if (rel > 1.1) reg = Math.max(0, (R - rel) / (R - 1.1));
      else if (rel < 1) reg = 1 + p.root.upRegulation * (1 - rel);
    }
    const active = k.imax * RM * rootAct * avail * reg * (C / (km + C));
    // 질량류: 물관 운반 원소(칼슘·붕소·나트륨·염소)는 조절되지 않고, 능동 적재 원소(N·P·K 등)는 체내 조절을 함께 받는다
    const xy = k.xylem ?? 0;
    const regMass = xy + (1 - xy) * (reg < 1 ? reg : 1);
    const mass = k.sigma * U * C * (i === 'Ca' || i === 'Mg' ? avail : 1) * regMass;
    let tot = active + mass;
    const cap = 0.9 * W * C;
    if (tot > cap) tot = cap;
    u[i] = tot;
  }
  // 전기적 중성: 뿌리가 H⁺·OH⁻(HCO₃⁻) 방출과 유기산 대사로 메울 수 있는 양·음이온 흡수 차이에는 한계가 있다.
  //  - 양이온 초과는 암모늄 동화가 내는 H⁺만큼(+작은 여유)만 허용 → 넘으면 양이온 흡수를 줄인다.
  //  - 음이온 초과(질산 영양의 OH⁻ 방출)는 chargeImbalance 비율까지 허용 → 넘으면 음이온 흡수를 줄인다.
  const f = p.root.chargeImbalance;
  const cat = u.K + u.Na + u.NH4 + 2 * (u.Ca + u.Mg + u.Mn + u.Zn + u.Cu);
  const an = u.NO3 + u.Cl + 2 * u.S + u.P + 2 * u.Mo;
  const catMax = an * (1 + p.root.cationSlack) + u.NH4;
  if (cat > catMax + 1e-12) {
    const k = catMax / cat;
    for (const i of ['K', 'Na', 'NH4', 'Ca', 'Mg', 'Mn', 'Zn', 'Cu'] as const) u[i] *= k;
  } else if (an > cat * (1 + f) + 1e-12) {
    const k = (cat * (1 + f)) / an;
    for (const i of ['NO3', 'Cl', 'S', 'P', 'Mo'] as const) u[i] *= k;
  }
  return u;
}
