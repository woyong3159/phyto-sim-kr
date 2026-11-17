/**
 * 양액 화학: 이온 벡터, EC(몰전도도 + 이온세기 보정), pH(전하 수지 + 탄산·인산·암모늄 평형), 원액 탱크의 침전.
 * 모든 농도는 mmol/L. 'P'는 전체 인산, 'HCO3'는 전체 무기탄소(C_T), 'NH4'는 전체 암모니아성 질소로 다룬다(종 분포는 pH로 계산).
 * 순수 함수만 있다(엔진·화면이 함께 쓴다). 결정론을 위해 Math.log/exp 대신 dmath를 쓴다.
 */
import { dexp, dlog } from '../dmath';

export const IONS = ['NO3', 'NH4', 'P', 'K', 'Ca', 'Mg', 'S', 'Na', 'Cl', 'HCO3', 'Fe', 'Mn', 'Zn', 'B', 'Cu', 'Mo'] as const;
export type Ion = (typeof IONS)[number];
export type IonVec = Record<Ion, number>;
export const MICRO: readonly Ion[] = ['Fe', 'Mn', 'Zn', 'B', 'Cu', 'Mo'];
/** 원소(또는 이온) 1 mol의 질량 g — 화면의 mg/L·% 환산과 원수 성분(mg/L) 변환에 쓴다. NO3는 질산 이온, HCO3는 중탄산 이온 질량. */
export const MOLAR: IonVec = { NO3: 62.0, NH4: 18.04, P: 30.97, K: 39.1, Ca: 40.08, Mg: 24.31, S: 32.06, Na: 22.99, Cl: 35.45, HCO3: 61.02, Fe: 55.85, Mn: 54.94, Zn: 65.38, B: 10.81, Cu: 63.55, Mo: 95.95 };
/** 강전해질로 다루는 이온의 전하(약산·약염기 계열 NH4, P, HCO3는 0으로 두고 따로 계산). 킬레이트철·붕산은 0. */
export const CHARGE: IonVec = { NO3: -1, NH4: 0, P: 0, K: 1, Ca: 2, Mg: 2, S: -2, Na: 1, Cl: -1, HCO3: 0, Fe: 0, Mn: 2, Zn: 2, B: 0, Cu: 2, Mo: -2 };

export const zero = (): IonVec => ({ NO3: 0, NH4: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0, Na: 0, Cl: 0, HCO3: 0, Fe: 0, Mn: 0, Zn: 0, B: 0, Cu: 0, Mo: 0 });
export const copy = (v: IonVec): IonVec => ({ ...v });
export function addScaled(a: IonVec, b: IonVec, k: number): IonVec {
  const o = { ...a };
  for (const i of IONS) o[i] += b[i] * k;
  return o;
}
/** 부피 가중 혼합: (Va·a + Vb·b)/(Va+Vb) */
export function mixVec(a: IonVec, va: number, b: IonVec, vb: number): IonVec {
  const v = va + vb;
  if (v <= 0) return zero();
  const o = zero();
  for (const i of IONS) o[i] = (a[i] * va + b[i] * vb) / v;
  return o;
}

export interface ChemParams {
  lambda: Record<string, number>;
  ecShrink: number;
  pKa: { carb1: number; carb2: number; phos1: number; phos2: number; phos3: number; nh4: number; water: number; kH: number };
  pco2Rootzone: number;
  pco2Tank: number;
  kspGypsum: number;
  kspCaP: number;
  caPFeed: number;
  caPRate: number;
}

const LN10 = 2.302585092994046;
const p10 = (pk: number) => dexp(-pk * LN10);
/** 평형 상수는 파라미터마다 한 번만 계산해 둔다. */
const KCACHE = new WeakMap<ChemParams, number[]>();
function constants(c: ChemParams): number[] {
  let k = KCACHE.get(c);
  if (!k) {
    const q = c.pKa;
    k = [p10(q.carb1), p10(q.carb2), p10(q.phos1), p10(q.phos2), p10(q.phos3), p10(q.nh4), p10(q.water)];
    KCACHE.set(c, k);
  }
  return k;
}

export interface Species {
  pH: number;
  h: number;
  /** mol/L */
  hco3: number;
  co3: number;
  h2co3: number;
  h2po4: number;
  hpo4: number;
  po4: number;
  nh4: number;
  oh: number;
  /** 열린 계에서 평형 후의 전체 무기탄소(mmol/L) */
  cT: number;
}

/**
 * 전하 수지로 pH를 푼다.
 * pco2Atm > 0이면 열린 계(용액이 그 CO2 분압과 평형: 무기탄소 총량이 달라진다), 아니면 닫힌 계(무기탄소 총량 보존).
 */
export function speciate(v: IonVec, c: ChemParams, pco2Atm = 0): Species {
  const k = c.pKa;
  const [K1, K2, P1, P2, P3, KN, KW] = constants(c) as [number, number, number, number, number, number, number];
  let strong = 0;
  for (const i of IONS) strong += CHARGE[i] * v[i];
  strong /= 1000;
  const nT = v.NH4 / 1000;
  const pT = v.P / 1000;
  const cT = v.HCO3 / 1000;
  const h2co3Open = pco2Atm > 0 ? k.kH * pco2Atm : 0;
  const parts = (h: number) => {
    const nh4 = (nT * h) / (h + KN);
    const dp = h * h * h + P1 * h * h + P1 * P2 * h + P1 * P2 * P3;
    const h2po4 = (pT * P1 * h * h) / dp;
    const hpo4 = (pT * P1 * P2 * h) / dp;
    const po4 = (pT * P1 * P2 * P3) / dp;
    let hco3: number;
    let co3: number;
    let h2co3: number;
    if (pco2Atm > 0) {
      h2co3 = h2co3Open;
      hco3 = (K1 * h2co3) / h;
      co3 = (K2 * hco3) / h;
    } else {
      const dc = h * h + K1 * h + K1 * K2;
      h2co3 = (cT * h * h) / dc;
      hco3 = (cT * K1 * h) / dc;
      co3 = (cT * K1 * K2) / dc;
    }
    const oh = KW / h;
    return { nh4, h2po4, hpo4, po4, hco3, co3, h2co3, oh };
  };
  const bal = (pH: number) => {
    const h = p10(pH);
    const s = parts(h);
    return h + strong + s.nh4 - s.oh - s.hco3 - 2 * s.co3 - s.h2po4 - 2 * s.hpo4 - 3 * s.po4;
  };
  // pH가 오르면 bal은 줄어든다(단조) → 구간을 유지하는 할선법(Illinois). 결정론적 사칙연산만 쓴다.
  let lo = 0.5;
  let hi = 13.5;
  let flo = bal(lo);
  let fhi = bal(hi);
  let pH = 7;
  let side = 0;
  for (let it = 0; it < 80; it++) {
    pH = (lo * fhi - hi * flo) / (fhi - flo);
    if (!(pH > lo && pH < hi)) pH = (lo + hi) / 2;
    const fm = bal(pH);
    if (fm > 0) {
      lo = pH;
      flo = fm;
      if (side === 1) fhi /= 2;
      side = 1;
    } else {
      hi = pH;
      fhi = fm;
      if (side === -1) flo /= 2;
      side = -1;
    }
    if (hi - lo < 1e-7 || fm === 0) break;
  }
  const h = p10(pH);
  const s = parts(h);
  return { pH, h, ...s, cT: (s.h2co3 + s.hco3 + s.co3) * 1000 };
}

/** EC(dS/m = mS/cm). 종 분포까지 반영한 무한 희석 전도도 × (1 − k√I). */
export function ecOf(v: IonVec, c: ChemParams, sp?: Species): number {
  const s = sp ?? speciate(v, c);
  const L = c.lambda;
  let sum = 0;
  let ion = 0;
  const add = (mmol: number, lam: number, z: number) => {
    sum += mmol * lam;
    ion += mmol * z * z;
  };
  for (const i of ['NO3', 'K', 'Ca', 'Mg', 'S', 'Na', 'Cl', 'Mn', 'Zn', 'Cu', 'Mo'] as const) add(v[i], L[i] ?? 0, Math.abs(CHARGE[i]));
  add(s.nh4 * 1000, L.NH4!, 1);
  add(s.h2po4 * 1000, L.P!, 1);
  add(s.hpo4 * 1000, L.HPO4!, 2);
  add(s.hco3 * 1000, L.HCO3!, 1);
  add(s.co3 * 1000, L.CO3!, 2);
  add(s.h * 1000, L.H!, 1);
  add(s.oh * 1000, L.OH!, 1);
  const I = ion / 2 / 1000;
  const f = 1 - c.ecShrink * Math.sqrt(I);
  return (sum / 1000) * (f > 0.4 ? f : 0.4);
}

// ───────── 비료 ─────────

export interface FertParam {
  name: string;
  formula: string;
  kind: 'salt' | 'acid' | 'base' | 'blend';
  mw: number;
  ions: Partial<Record<Ion, number>>;
  solubility: number;
  price: number;
  liquid?: { purity: number; density: number };
  chelate?: 'EDTA' | 'DTPA' | 'EDDHA';
  blend?: Record<string, number>;
  tank: 'A' | 'B' | 'AB' | 'acid';
  note: string;
}
export type FertLib = Record<string, FertParam>;

/** 원료 1 kg이 내놓는 이온(mol). 혼합 복합비료는 구성 단비로 펼친다. 킬레이트 철의 종류별 몫도 함께 돌려준다. */
export function ionsPerKg(id: string, lib: FertLib): { ions: IonVec; chelFe: Record<string, number> } {
  const f = lib[id];
  const out = zero();
  const chelFe: Record<string, number> = {};
  if (!f) return { ions: out, chelFe };
  if (f.blend) {
    for (const [sub, frac] of Object.entries(f.blend)) {
      const r = ionsPerKg(sub, lib);
      for (const i of IONS) out[i] += r.ions[i] * frac;
      for (const [k, v] of Object.entries(r.chelFe)) chelFe[k] = (chelFe[k] ?? 0) + v * frac;
    }
    return { ions: out, chelFe };
  }
  const mol = (1000 * (f.liquid ? f.liquid.purity : 1)) / f.mw;
  for (const [i, n] of Object.entries(f.ions)) out[i as Ion] += mol * (n as number);
  if (f.chelate) chelFe[f.chelate] = mol * (f.ions.Fe ?? 0);
  return { ions: out, chelFe };
}

export interface StockResult {
  /** 녹아 있는 이온 mmol/L(원액) */
  ions: IonVec;
  /** 킬레이트 종류별 철 mmol/L(원액) */
  chelFe: Record<string, number>;
  /** 원액 1 L에 가라앉은 침전물 mol: 석고, 인산칼슘, 녹지 않은 원료(원료별 g/L) */
  gypsum: number;
  caP: number;
  undissolved: Record<string, number>;
  /** 탱크 한 번 타는 데 든 비용 원 */
  cost: number;
  warnings: string[];
}

/** 원액 탱크 조성. recipe: 원료 kg(탱크 한 번 분량), volume: L. */
export function stockMix(recipe: Record<string, number>, volume: number, lib: FertLib, c: ChemParams): StockResult {
  const ions = zero();
  const chelFe: Record<string, number> = {};
  const undissolved: Record<string, number> = {};
  const warnings: string[] = [];
  let cost = 0;
  for (const [id, kg] of Object.entries(recipe)) {
    const f = lib[id];
    if (!f || !(kg > 0)) continue;
    cost += kg * f.price;
    const gL = (kg * 1000) / volume;
    let frac = 1;
    if (gL > f.solubility) {
      frac = f.solubility / gL;
      undissolved[id] = gL - f.solubility;
      warnings.push(`${f.name}: 원액 농도 ${gL.toFixed(0)} g/L가 용해도 ${f.solubility.toFixed(0)} g/L를 넘어 일부가 녹지 않는다`);
    }
    const r = ionsPerKg(id, lib);
    for (const i of IONS) ions[i] += (r.ions[i] * kg * frac * 1000) / volume; // mol → mmol/L
    for (const [k, v] of Object.entries(r.chelFe)) chelFe[k] = (chelFe[k] ?? 0) + (v * kg * frac * 1000) / volume;
  }
  // 침전: 석고(CaSO4) 다음 인산칼슘(CaHPO4). 유효 용해도곱(mol²/L²)으로 푼다.
  const solve = (a: number, b: number, ksp: number) => {
    // (a − x)(b − x) = ksp, 0 ≤ x ≤ min(a, b)
    if (a * b <= ksp) return 0;
    const s = a + b;
    const d = s * s - 4 * (a * b - ksp);
    return (s - Math.sqrt(d > 0 ? d : 0)) / 2;
  };
  const gy = solve(ions.Ca / 1000, ions.S / 1000, c.kspGypsum) * 1000;
  ions.Ca -= gy;
  ions.S -= gy;
  const cp = solve(ions.Ca / 1000, ions.P / 1000, c.kspCaP) * 1000;
  ions.Ca -= cp;
  ions.P -= cp;
  if (gy > 0.01) warnings.push(`칼슘과 황산이 같은 탱크에 있어 석고가 ${((gy * 172.2) / 1000).toFixed(1)} g/L 가라앉는다`);
  if (cp > 0.01) warnings.push(`칼슘과 인산이 같은 탱크에 있어 인산칼슘이 ${((cp * 136.1) / 1000).toFixed(1)} g/L 가라앉는다`);
  return { ions, chelFe, gypsum: gy / 1000, caP: cp / 1000, undissolved, cost, warnings };
}

/** 원수 성분(mg/L, pH)을 이온 벡터로. 원수의 전하 불균형은 Na(양이온 부족) 또는 Cl(음이온 부족)로 메워 표기 pH가 재현되게 한다. */
export function waterVec(mgL: Partial<Record<Ion, number>>, pH: number, c: ChemParams): IonVec {
  const v = zero();
  for (const [i, mg] of Object.entries(mgL)) v[i as Ion] = (mg as number) / MOLAR[i as Ion];
  // 보고된 HCO3는 알칼리도(중탄산 이온) → 그 pH의 전체 무기탄소로 바꾼다
  const h = p10(pH);
  const K1 = p10(c.pKa.carb1);
  const K2 = p10(c.pKa.carb2);
  const hco3 = v.HCO3 / 1000;
  v.HCO3 = hco3 * (1 + h / K1 + K2 / h) * 1000;
  // 전하 보정
  const s = speciateAt(v, c, pH);
  if (s > 0) v.Cl += s * 1000;
  else v.Na += -s * 1000;
  return v;
}

/** 주어진 pH에서 전하 수지의 잔차(mol/L, 양수 = 양전하 과다). */
function speciateAt(v: IonVec, c: ChemParams, pH: number): number {
  const k = c.pKa;
  const h = p10(pH);
  const K1 = p10(k.carb1);
  const K2 = p10(k.carb2);
  const P1 = p10(k.phos1);
  const P2 = p10(k.phos2);
  const P3 = p10(k.phos3);
  const KN = p10(k.nh4);
  let strong = 0;
  for (const i of IONS) strong += CHARGE[i] * v[i];
  strong /= 1000;
  const nh4 = ((v.NH4 / 1000) * h) / (h + KN);
  const dp = h * h * h + P1 * h * h + P1 * P2 * h + P1 * P2 * P3;
  const pT = v.P / 1000;
  const an = (pT * (P1 * h * h + 2 * P1 * P2 * h + 3 * P1 * P2 * P3)) / dp;
  const dc = h * h + K1 * h + K1 * K2;
  const cT = v.HCO3 / 1000;
  const cn = (cT * (K1 * h + 2 * K1 * K2)) / dc;
  return h + strong + nh4 - p10(k.water) / h - an - cn;
}

/** 로그 함수(디버그·표시용): mmol/L → mg/L */
export const mgL = (i: Ion, mmol: number) => mmol * MOLAR[i];
export const log10 = (x: number) => dlog(x) / dlog(10);

// ───────── 역방향 계산(목표 배양액 → 원료 배합) ─────────

/** 비음수 최소제곱(Lawson–Hanson). A: m×n(행 = 조건, 열 = 원료), b: m. */
export function nnls(A: number[][], b: number[], maxIter = 200): number[] {
  const m = A.length;
  void m;
  const n = A[0]?.length ?? 0;
  const x = new Array<number>(n).fill(0);
  const P = new Array<boolean>(n).fill(false);
  const grad = () => {
    const r = b.map((bi, i) => bi - A[i]!.reduce((s, a, j) => s + a * x[j]!, 0));
    return Array.from({ length: n }, (_, j) => A.reduce((s, row, i) => s + row[j]! * r[i]!, 0));
  };
  const lsq = (idx: number[]) => {
    // 정규방정식 (AᵀA) z = Aᵀb 를 부분 피벗 가우스 소거로 푼다
    const k = idx.length;
    const M = Array.from({ length: k }, (_, a) => Array.from({ length: k + 1 }, (_, c) => (c < k ? A.reduce((s, row) => s + row[idx[a]!]! * row[idx[c]!]!, 0) : A.reduce((s, row, i) => s + row[idx[a]!]! * b[i]!, 0))));
    for (let c = 0; c < k; c++) M[c]![c]! += 1e-12;
    for (let c = 0; c < k; c++) {
      let piv = c;
      for (let r = c + 1; r < k; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
      [M[c], M[piv]] = [M[piv]!, M[c]!];
      const d = M[c]![c]!;
      if (Math.abs(d) < 1e-18) continue;
      for (let r = 0; r < k; r++) {
        if (r === c) continue;
        const f = M[r]![c]! / d;
        for (let cc = c; cc <= k; cc++) M[r]![cc]! -= f * M[c]![cc]!;
      }
    }
    return M.map((row, c) => (Math.abs(row[c]!) < 1e-18 ? 0 : row[k]! / row[c]!));
  };
  for (let it = 0; it < maxIter; it++) {
    const w = grad();
    let jmax = -1;
    let wmax = 1e-10;
    for (let j = 0; j < n; j++) if (!P[j] && w[j]! > wmax) {
      wmax = w[j]!;
      jmax = j;
    }
    if (jmax < 0) break;
    P[jmax] = true;
    for (let inner = 0; inner < 50; inner++) {
      const idx = P.map((p, j) => (p ? j : -1)).filter((j) => j >= 0);
      const z = lsq(idx);
      if (z.every((v) => v > 0)) {
        for (let j = 0; j < n; j++) x[j] = 0;
        idx.forEach((j, a) => (x[j] = z[a]!));
        break;
      }
      let alpha = 1;
      idx.forEach((j, a) => {
        if (z[a]! <= 0) {
          const t = x[j]! / (x[j]! - z[a]!);
          if (t < alpha) alpha = t;
        }
      });
      idx.forEach((j, a) => (x[j] = x[j]! + alpha * (z[a]! - x[j]!)));
      for (const j of idx) if (x[j]! <= 1e-12) {
        P[j] = false;
        x[j] = 0;
      }
    }
  }
  return x;
}
