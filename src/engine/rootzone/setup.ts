/**
 * 근권 파라미터 조립, 작물별 기본 구성, 원수 성분, 목표 배양액 → 원료 배합(역방향 계산), 급액 조성(정방향 계산).
 */
import { strip } from '../greenhouse/params';
import type { CropId, Curve } from '../crop/types';
import { ecOf, IONS, ionsPerKg, MICRO, nnls, speciate, stockMix, waterVec, zero, type ChemParams, type FertLib, type Ion, type IonVec, type StockResult } from './chem';
import type { CropNutrition, IrrSettings, NutSettings, RzParams, RzSetup, RzSystem, StockTank } from './types';

export function buildRzParams(rootzone: unknown, fertilizers: unknown, water: unknown, crops: unknown): RzParams {
  const rz = strip(rootzone) as Record<string, unknown> & { chemistry: Record<string, unknown> };
  const fz = strip(fertilizers) as { fertilizers: FertLib; recipes: RzParams['recipes'] };
  const ws = strip(water) as RzParams['water'];
  const cr = strip(crops) as { nutrition: Record<string, unknown>; wasabi: { root: { temp: Curve } } };
  const nut = cr.nutrition as Record<string, Record<string, unknown>> & { salinity: { toECe: number }; defaults: RzParams['defaults'] };
  const chem = { ...(rz.chemistry as object) } as ChemParams;
  const crop = {} as RzParams['crop'];
  for (const id of ['cucumber', 'strawberry', 'wasabi'] as const) {
    const n = nut[id] as Record<string, unknown>;
    const leaf: Partial<Record<Ion, [number, number, number, number]>> = {};
    const fruit: Partial<Record<Ion, number>> = {};
    for (const i of IONS) {
      const k = i === 'NO3' ? 'N' : i;
      const l = (n.leaf as Record<string, unknown>)[k];
      if (Array.isArray(l)) leaf[i] = l as [number, number, number, number];
      const f = (n.fruit as Record<string, unknown>)[k];
      if (typeof f === 'number') fruit[i] = f;
    }
    const rt = n.rootTemp;
    crop[id] = {
      leaf,
      fruit,
      salt: n.salt as CropNutrition['salt'],
      rootTemp: Array.isArray(rt) ? (rt as Curve) : id === 'wasabi' ? cr.wasabi.root.temp : null,
      tipburn: n.tipburn as number,
      brixK: n.brixK as number | undefined,
      brixEC: n.brixEC as number | undefined,
      brixECRef: n.brixECRef as number | undefined,
    };
  }
  const defaults = { ...nut.defaults } as RzParams['defaults'];
  delete (defaults as Record<string, unknown>).note;
  return {
    systems: rz.systems as RzParams['systems'],
    substrate: rz.substrate as RzParams['substrate'],
    hydro: rz.hydro as RzParams['hydro'],
    doSat: rz.doSat as number[],
    chem,
    chelate: rz.chelate as RzParams['chelate'],
    uptake: rz.uptake as RzParams['uptake'],
    antagonism: rz.antagonism as RzParams['antagonism'],
    pHAvail: rz.pHAvail as RzParams['pHAvail'],
    mnLowPH: rz.mnLowPH as number,
    root: rz.root as RzParams['root'],
    plant: rz.plant as RzParams['plant'],
    irrigation: rz.irrigation as RzParams['irrigation'],
    tanks: rz.tanks as RzParams['tanks'],
    clog: rz.clog as RzParams['clog'],
    equipment: rz.equipment as RzParams['equipment'],
    lab: rz.lab as RzParams['lab'],
    ferts: fz.fertilizers,
    recipes: fz.recipes,
    water: ws,
    crop,
    toECe: nut.salinity.toECe,
    defaults,
  };
}

/** 그 지역 원수(지하수·상수·빗물)의 이온 벡터. */
export function rawWaters(p: RzParams, regionId: string): Record<'groundwater' | 'tap' | 'rain', IonVec> {
  const prof = p.water.profiles;
  const gwKey = p.water.regions[regionId] ?? 'gw_avg';
  const gw = prof[gwKey] ?? prof.gw_avg!;
  return { groundwater: waterVec(gw.mgL, gw.pH, p.chem), tap: waterVec(prof.tap!.mgL, prof.tap!.pH, p.chem), rain: waterVec(prof.rain!.mgL, prof.rain!.pH, p.chem) };
}
export function groundwaterProfile(p: RzParams, regionId: string): string {
  return p.water.regions[regionId] ?? 'gw_avg';
}

/** 역방향 계산에 기본으로 쓰는 원료 묶음(질산암모늄은 규제 원료라 기본에서 뺀다). */
export const DEFAULT_FERTS = ['ca_nitrate', 'k_nitrate', 'mkp', 'map', 'k_sulfate', 'mg_sulfate', 'mg_nitrate', 'fe_dtpa', 'mn_sulfate', 'zn_sulfate', 'boric_acid', 'cu_sulfate', 'na_molybdate', 'hno3'];

/** 목표 배양액(다량 mmol/L, 미량 μmol/L)을 이온 벡터(mmol/L)로. */
export function recipeVec(p: RzParams, key: string): IonVec {
  const r = p.recipes[key];
  const v = zero();
  if (!r) return v;
  for (const [i, x] of Object.entries(r.mmol)) v[i as Ion] = (MICRO as readonly string[]).includes(i) ? (x as number) / 1000 : (x as number);
  return v;
}

/**
 * 역방향 계산: 원수를 뺀 목표 이온을 맞추는 원료 g/L(급액 기준)을 비음수 최소제곱으로 구하고, 탱크별 kg으로 나눈다.
 * 중탄산은 0.5 mmol/L만 남기도록 산으로 중화한다(관행).
 */
export function designRecipe(p: RzParams, key: string, raw: IonVec, rawAlk: number, opts: { ferts?: string[]; dilution?: number; acidDilution?: number; volume?: { A: number; B: number; acid: number } } = {}): { tanks: NutSettings['tanks']; gPerL: Record<string, number>; residual: number } {
  const ferts = (opts.ferts ?? DEFAULT_FERTS).filter((f) => p.ferts[f]);
  const D = opts.dilution ?? 100;
  const Da = opts.acidDilution ?? 200;
  const vol = opts.volume ?? { A: p.tanks.stockVolume, B: p.tanks.stockVolume, acid: p.tanks.acidVolume };
  const target = recipeVec(p, key);
  const rows: Ion[] = ['NO3', 'NH4', 'P', 'K', 'Ca', 'Mg', 'S', 'Fe', 'Mn', 'Zn', 'B', 'Cu', 'Mo'];
  const A: number[][] = [];
  const b: number[] = [];
  for (const i of rows) {
    const t = target[i] - raw[i];
    const w = 1 / ((target[i] > 0 ? target[i] : 0.05) * (i === 'S' ? 3 : 1));
    A.push(ferts.map((f) => (ionsPerKg(f, p.ferts).ions[i] / 1000) * 1000 * w)); // g/L당 mmol/L = mol/kg
    b.push((t > 0 ? t : 0) * w);
  }
  // 산 행: 원수 알칼리도 − 0.5 mmol/L 만큼의 H+를 넣는다
  const acidNeed = rawAlk - 0.5 > 0 ? rawAlk - 0.5 : 0;
  const hOf = (f: string) => {
    const fp = p.ferts[f]!;
    if (fp.kind !== 'acid') return 0;
    return (ionsPerKg(f, p.ferts).ions.NO3 + ionsPerKg(f, p.ferts).ions.P + 2 * ionsPerKg(f, p.ferts).ions.S) / 1000;
  };
  const wA = 1 / (acidNeed > 0.2 ? acidNeed : 0.2);
  A.push(ferts.map((f) => hOf(f) * 1000 * wA * 2));
  b.push(acidNeed * wA * 2);
  const x = nnls(A, b);
  let residual = 0;
  A.forEach((row, r) => {
    const e = row.reduce((s, a, j) => s + a * x[j]!, 0) - b[r]!;
    residual += e * e;
  });
  const tanks: NutSettings['tanks'] = { A: {}, B: {}, acid: {} };
  const gPerL: Record<string, number> = {};
  ferts.forEach((f, j) => {
    const g = x[j]!;
    if (g < 1e-6) return;
    gPerL[f] = g;
    const t = p.ferts[f]!.tank;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    if (t === 'acid') tanks.acid[f] = r3((g * Da * vol.acid) / 1000);
    else if (t === 'A') tanks.A[f] = r3((g * D * vol.A) / 1000);
    else if (t === 'B') tanks.B[f] = r3((g * D * vol.B) / 1000);
    else {
      tanks.A[f] = r3((g * D * vol.A) / 2000);
      tanks.B[f] = r3((g * D * vol.B) / 2000);
    }
  });
  return { tanks, gPerL, residual };
}

export function rawAlkalinity(p: RzParams, regionId: string, source: 'groundwater' | 'tap' | 'rain'): number {
  const prof = source === 'groundwater' ? p.water.profiles[groundwaterProfile(p, regionId)] : p.water.profiles[source];
  return (prof?.mgL.HCO3 ?? 0) / 61.02;
}

export interface RzConfig {
  setup: RzSetup;
  irr: IrrSettings;
  nut: NutSettings;
}

/** 작물별 기본 근권 구성(시설·관수·양액). */
export function defaultRzConfig(p: RzParams, cropId: CropId, regionId: string): RzConfig {
  const d = p.defaults[cropId];
  const setup: RzSetup = { system: d.system, drain: d.drain, disinfect: d.drain === 'closed' ? 'uv' : 'none', aeration: d.system === 'dft', water: 'groundwater', backup: 'groundwater', rainTank: p.tanks.rainVolume, injector: 'mixing', meter: true };
  const irr: IrrSettings = { mode: d.irrigation.mode, solarJ: d.irrigation.solarJ, timerCount: 8, sensorTheta: 0, dose: d.irrigation.dose, start: d.irrigation.start, end: d.irrigation.end, minGap: d.irrigation.minGap, startShot: true, drainTarget: d.irrigation.drainTarget, autoDrain: true, reuse: 0.5, renewDays: d.system === 'dft' || d.system === 'nft' ? 30 : 0 };
  const sys = p.systems[d.system];
  if (sys.kind === 'substrate') irr.sensorTheta = Math.round(thetaCC(sys) * 100 * 0.85);
  const raw = rawWaters(p, regionId).groundwater;
  const rec = designRecipe(p, d.recipe, raw, rawAlkalinity(p, regionId, 'groundwater'));
  const nut: NutSettings = { tanks: rec.tanks, volume: { A: p.tanks.stockVolume, B: p.tanks.stockVolume, acid: p.tanks.acidVolume }, dilution: 100, acidDilution: 200, ecProgram: d.ec.map(([a, b]) => [a, b] as [number, number]), phTarget: d.ph, feedOn: true, autoRefill: true };
  return { setup, irr, nut };
}

// ───────── 배지 수분 특성(van Genuchten) ─────────
type Sub = { thetaS: number; thetaR: number; alpha: number; n: number; height: number };
/** 매트릭 수두 h(cm, 양수)에서의 체적 수분율 */
export function thetaAt(s: Sub, hcm: number): number {
  const m = 1 - 1 / s.n;
  const x = s.alpha * (hcm > 0 ? hcm : 0);
  return s.thetaR + (s.thetaS - s.thetaR) / pw(1 + pw(x, s.n), m);
}
/** 체적 수분율 → 매트릭 퍼텐셜 kPa(음수) */
export function psiOf(s: Sub, theta: number): number {
  const m = 1 - 1 / s.n;
  const se = (theta - s.thetaR) / (s.thetaS - s.thetaR);
  if (se >= 1) return 0;
  if (se <= 1e-4) return -1000;
  const hcm = pw(pw(se, -1 / m) - 1, 1 / s.n) / s.alpha;
  return -hcm * 0.0981;
}
/** 용기용수량: 배지 높이 가운데의 수두(h/2)와 평형인 평균 수분 */
export function thetaCC(s: Sub): number {
  // 높이에 걸쳐 평균(5점)
  let t = 0;
  for (let k = 0; k < 5; k++) t += thetaAt(s, (s.height * (k + 0.5)) / 5);
  return t / 5;
}
import { dpow } from '../dmath';
const pw = (a: number, b: number) => (a <= 0 ? 0 : dpow(a, b));

// ───────── 원액 탱크와 급액 ─────────

export function recipeKey(r: Record<string, number>): string {
  return Object.entries(r)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}:${v}`)
    .sort()
    .join(',');
}

export function fillTank(recipe: Record<string, number>, volume: number, p: RzParams): { tank: StockTank; mix: StockResult } {
  const mix = stockMix(recipe, volume, p.ferts, p.chem);
  return { tank: { left: volume, ions: mix.ions, chelFe: mix.chelFe, precip: mix.gypsum + mix.caP, recipeKey: recipeKey(recipe) }, mix };
}

export interface Feed {
  ions: IonVec;
  chelFe: Record<string, number>;
  ec: number;
  pH: number;
  /** 급액 1 L에 든 원액 L(탱크별) */
  use: { A: number; B: number; acid: number };
}

/** 원수 + 원액(배율 r) + 산(배율 a)을 섞은 급액 1 L. */
export function feedOf(base: IonVec, baseChel: Record<string, number>, stock: { A: StockTank; B: StockTank; acid: StockTank }, nut: NutSettings, rA: number, rB: number, ra: number, chem: ChemParams): Feed {
  const uA = rA / nut.dilution;
  const uB = rB / nut.dilution;
  const ua = ra / nut.acidDilution;
  const w = 1 - uA - uB - ua;
  const ions = zero();
  for (const i of IONS) ions[i] = base[i] * w + stock.A.ions[i] * uA + stock.B.ions[i] * uB + stock.acid.ions[i] * ua;
  const chelFe: Record<string, number> = {};
  for (const [k, v] of Object.entries(baseChel)) chelFe[k] = (chelFe[k] ?? 0) + v * w;
  for (const [t, u] of [[stock.A, uA], [stock.B, uB], [stock.acid, ua]] as const) for (const [k, v] of Object.entries(t.chelFe)) chelFe[k] = (chelFe[k] ?? 0) + v * u;
  const sp = speciate(ions, chem);
  return { ions, chelFe, ec: ecOf(ions, chem, sp), pH: sp.pH, use: { A: uA, B: uB, acid: ua } };
}

/** 혼합기: EC·pH 목표에 맞춰 원액·산 배율을 찾는다. target 대상은 급액(배지) 또는 섞은 뒤의 양액(수경, mixWith). */
export function solveMix(base: IonVec, baseChel: Record<string, number>, stock: { A: StockTank; B: StockTank; acid: StockTank }, nut: NutSettings, ecTarget: number, chem: ChemParams, limit: { A: number; B: number; acid: number }, mixWith?: { ions: IonVec; vol: number; addVol: number; pco2: number }): { rA: number; rB: number; ra: number } {
  const evalAt = (r: number, a: number) => {
    const rA = r < limit.A ? r : limit.A;
    const rB = r < limit.B ? r : limit.B;
    const ra = a < limit.acid ? a : limit.acid;
    const f = feedOf(base, baseChel, stock, nut, rA, rB, ra, chem);
    if (!mixWith) return { ec: f.ec, pH: f.pH, rA, rB, ra };
    const v = zero();
    const tot = mixWith.vol + mixWith.addVol;
    for (const i of IONS) v[i] = (mixWith.ions[i] * mixWith.vol + f.ions[i] * mixWith.addVol) / tot;
    const sp = speciate(v, chem, mixWith.pco2);
    return { ec: ecOf(v, chem, sp), pH: sp.pH, rA, rB, ra };
  };
  const rMax = mixWith ? 400 : 4;
  const aMax = mixWith ? 400 : 6;
  /** 단조 함수 g(x)=0의 근을 [0, xMax]에서 찾는다(Illinois 할선법, 끝에서 부호가 같으면 가까운 끝). */
  const root = (g: (x: number) => number, xMax: number, tol: number) => {
    let lo = 0;
    let hi = xMax;
    let glo = g(lo);
    if (glo === 0) return 0;
    let ghi = g(hi);
    if (glo * ghi > 0) return Math.abs(glo) <= Math.abs(ghi) ? 0 : xMax;
    let x = 0;
    let side = 0;
    for (let it = 0; it < 30; it++) {
      x = (lo * ghi - hi * glo) / (ghi - glo);
      if (!(x > lo && x < hi)) x = (lo + hi) / 2;
      const gx = g(x);
      if (Math.abs(gx) < tol) return x;
      if (gx * glo > 0) {
        lo = x;
        glo = gx;
        if (side === 1) ghi /= 2;
        side = 1;
      } else {
        hi = x;
        ghi = gx;
        if (side === -1) glo /= 2;
        side = -1;
      }
    }
    return x;
  };
  const solveR = (a: number) => root((r) => evalAt(r, a).ec - ecTarget, rMax, 0.002);
  const solveA = (r: number) => root((a) => evalAt(r, a).pH - nut.phTarget, aMax, 0.005);
  let r = solveR(0);
  let a = solveA(r);
  r = solveR(a);
  a = solveA(r);
  const e = evalAt(r, a);
  return { rA: e.rA, rB: e.rB, ra: e.ra };
}

export function ecTargetAt(nut: NutSettings, dap: number): number {
  let ec = nut.ecProgram[0]?.[1] ?? 1.5;
  for (const [d, v] of nut.ecProgram) if (dap >= d) ec = v;
  return ec;
}

export function isHydro(p: RzParams, s: RzSystem): boolean {
  return p.systems[s].kind === 'hydro';
}
