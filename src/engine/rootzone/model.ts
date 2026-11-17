/**
 * 근권 1시간 전진: 원수 → 원액 주입 → 관수(배지) 또는 보충(수경) → 배액 → 흡수 → 근권 화학(pH·침전) → 식물 양분 분배.
 * 물·이온 질량 보존을 장부(bal)에 쌓는다: 공급 = 흡수 + 배액 + 침전 + 저장 변화(검증 ⑦).
 */
import type { SimEvent, SimState, UserAction } from '../types';
import type { World } from '../world';
import { trap } from '../crop/canopy';
import { dexp, dpow } from '../dmath';
import { copy, ecOf, IONS, speciate, zero, type IonVec } from './chem';
import { allocate, cropDm, initPools, poolTotal, supplyOf, tissue, uptakeOf } from './plant';
import { ecTargetAt, feedOf, fillTank, psiOf, solveMix, thetaCC, type Feed } from './setup';
import type { HydroSys, Lab, RzBalance, RzDay, RzOut, RzSetup, RzState, RzTotal, SubstrateSys } from './types';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const TANKS = ['A', 'B', 'acid'] as const;
type TankKey = (typeof TANKS)[number];

export const emptyRzDay = (dayIndex: number): RzDay => ({ dayIndex, feed: 0, drain: 0, uptake: 0, events: 0, feedEc: 0, feedPh: 0, drainEc: 0, drainPh: 0, rootEc: 0, rootPh: 0, theta: 0, rootT: 0, o2: 0, won: 0, labor: 0, hours: 0 });
const emptyBal = (): RzBalance => ({ waterIn: 0, waterUptake: 0, waterDrain: 0, ionIn: zero(), ionUptake: zero(), ionDrain: zero(), ionPrecip: zero(), gasC: 0, nitrified: 0, plantIn: zero(), plantOut: zero() });
const emptyTotal = (): RzTotal => ({ won: 0, fert: 0, water: 0, elec: 0, lab: 0, feed: 0, drain: 0, labor: 0 });

export function doSat(p: World['rz'], T: number): number {
  const a = p.doSat;
  return a[0]! + a[1]! * T + a[2]! * T * T + a[3]! * T * T * T;
}

export function sysOf(world: World, s: RzSetup): SubstrateSys | HydroSys {
  return world.rz.systems[s.system];
}

/** 근권의 물 부피(L/m²): 배지는 용기용수량, 수경은 양액량 */
export function capacityOf(world: World, s: RzSetup): number {
  const sys = sysOf(world, s);
  return sys.kind === 'hydro' ? sys.volume : thetaCC(sys) * sys.volume;
}

const hasRecipe = (r: Record<string, number>) => Object.values(r).some((v) => v > 0);

/** 근권 온도: 수경은 양액 온도, 배지는 양액(배지) 온도와 실내 기온의 가중 평균 */
function rootTemp(world: World, state: SimState, hydro: boolean): number {
  const o = state.gh.out;
  return hydro ? o.tSolution : world.rz.substrate.tempWeight * o.tSolution + (1 - world.rz.substrate.tempWeight) * o.tIn;
}

/** 시스템을 목표 급액으로 채운다(정식 전 포수·수경 양액 교체·재배 방식 변경). */
/** area: 온실 면적 m²(원액 탱크 재고는 온실 전체 L, 급액은 L/m²) */
function fillRootzone(world: World, rz: RzState, dap: number, area: number) {
  const p = world.rz;
  const sys = sysOf(world, rz.setup);
  const W = capacityOf(world, rz.setup);
  const base = world.raw[rz.setup.water === 'rain' ? rz.setup.backup : rz.setup.water];
  const nut = rz.nut;
  // 자동 보충이면 큰 수경조도 원액을 여러 번 타서 채운다(제한 없음), 아니면 남은 원액만큼만
  const need = W * area;
  const cap = (k: TankKey, D: number) => (!hasRecipe(nut.tanks[k]) ? 0 : nut.autoRefill ? 99 : need > 0 ? (rz.stock[k].left * D) / need : 0);
  const lim = { A: cap('A', nut.dilution), B: cap('B', nut.dilution), acid: cap('acid', nut.acidDilution) };
  const m = !nut.feedOn ? { rA: 0, rB: 0, ra: 0 } : rz.setup.injector === 'mixing' ? solveMix(base, {}, rz.stock, nut, ecTargetAt(nut, dap), p.chem, lim) : { rA: Math.min(1, lim.A), rB: Math.min(1, lim.B), ra: Math.min(1, lim.acid) };
  const f = feedOf(base, {}, rz.stock, nut, m.rA, m.rB, m.ra, p.chem);
  const pco2 = (sys.kind === 'hydro' ? p.chem.pco2Tank : p.chem.pco2Rootzone) / 1e6;
  const sp = speciate(f.ions, p.chem, pco2);
  rz.W = W;
  rz.ions = copy(f.ions);
  rz.ions.HCO3 = sp.cT;
  rz.chelFe = { ...f.chelFe };
  const bal = rz.bal;
  bal.waterIn += W;
  for (const i of IONS) bal.ionIn[i] += f.ions[i] * W;
  bal.gasC += (sp.cT - f.ions.HCO3) * W;
  let won = 0;
  for (const k of TANKS) {
    const used = f.use[k] * W * area;
    const vol = nut.volume[k];
    if (used > rz.stock[k].left && nut.autoRefill && vol > 0 && hasRecipe(nut.tanks[k])) {
      const n = Math.ceil((used - rz.stock[k].left) / vol);
      const t = fillTank(nut.tanks[k], vol, p);
      won += n * t.mix.cost;
      rz.stock[k] = { ...t.tank, left: rz.stock[k].left + n * vol };
    }
    rz.stock[k].left = Math.max(0, rz.stock[k].left - used);
  }
  return { f, sp, won };
}

export function initRootzone(world: World, tRoot: number): RzState {
  const cfg = world.rzConfig;
  const fills = TANKS.map((k) => fillTank(cfg.nut.tanks[k], cfg.nut.volume[k], world.rz));
  const stock = { A: fills[0]!.tank, B: fills[1]!.tank, acid: fills[2]!.tank };
  for (const k of TANKS) if (!hasRecipe(cfg.nut.tanks[k])) stock[k].left = 0;
  const fert = fills.reduce((a, f, i) => a + (hasRecipe(cfg.nut.tanks[TANKS[i]!]) ? f.mix.cost : 0), 0);
  const sys = sysOf(world, cfg.setup);
  const rz: RzState = {
    setup: cfg.setup,
    irr: cfg.irr,
    nut: cfg.nut,
    W: 0,
    ions: zero(),
    chelFe: {},
    drainTank: 0,
    drainIons: zero(),
    rain: cfg.setup.water === 'rain' ? cfg.setup.rainTank * 0.5 : 0,
    stock,
    solarAcc: 0,
    lastShot: -99,
    doseScale: 1,
    dO: sys.kind === 'hydro' ? doSat(world.rz, tRoot) : 0,
    health: 1,
    clog: 0,
    lastRenew: 0,
    labs: [],
    plant: null,
    bal: emptyBal(),
    today: { ...emptyRzDay(0), won: fert },
    yesterday: null,
    total: { ...emptyTotal(), won: fert, fert },
    out: null as unknown as RzOut,
  };
  const { f, sp, won } = fillRootzone(world, rz, 0, world.config.setup.area);
  rz.today.won += won;
  rz.total.won += won;
  rz.total.fert += won;
  rz.out = outOf(world, rz, sp.pH, ecOf(rz.ions, world.rz.chem, sp), f, tRoot, 1, 1, zero(), null);
  return rz;
}

function outOf(world: World, rz: RzState, pH: number, ec: number, feed: Feed | null, tRoot: number, o2: number, rootAct: number, uptake: IonVec, state: SimState | null): RzOut {
  const sys = sysOf(world, rz.setup);
  let theta = 0;
  let psi = 0;
  let afp = 0;
  let water = 1;
  if (sys.kind === 'substrate') {
    theta = rz.W / sys.volume;
    psi = psiOf(sys, theta);
    afp = sys.thetaS - theta;
    water = trap(world.rz.substrate.psiCurve, psi);
  } else water = rz.W > 0.05 * sys.volume ? 1 : rz.W / (0.05 * sys.volume);
  water *= 1 - world.rz.root.waterWeight * (1 - rootAct);
  const c = state?.crop;
  const n = c ? world.rz.crop[c.cropId] : null;
  const supply = n ? supplyOf(rz.plant, n, world.rz, ec, water, tRoot, rootAct) : { water, nutrient: 1, photo: [1, 1, 1] as [number, number, number], expand: 1, fruit: 1, set: 1, salt: 1, brix: 1, plantN: 1, tRoot, rootAct, tipburn: 0 };
  const t = rz.today;
  return {
    ions: rz.ions,
    ec,
    pH,
    theta,
    psi,
    afp,
    dO: rz.dO,
    rootT: tRoot,
    o2,
    rootAct,
    health: rz.health,
    feedEc: feed?.ec ?? 0,
    feedPh: feed?.pH ?? 0,
    feedIons: feed?.ions ?? rz.out?.feedIons ?? zero(),
    drainEc: t.drain > 0 ? t.drainEc / t.drain : 0,
    drainPh: t.drain > 0 ? t.drainPh / t.drain : 0,
    supply,
    tissue: rz.plant && n ? tissue(rz.plant, n, world.rz) : {},
    uptake,
    clog: rz.clog,
  };
}

export interface RzStep {
  rz: RzState;
  events: SimEvent[];
}

function cloneRz(r0: RzState): RzState {
  const pl = r0.plant;
  return {
    ...r0,
    ions: copy(r0.ions),
    chelFe: { ...r0.chelFe },
    drainIons: copy(r0.drainIons),
    stock: { A: { ...r0.stock.A }, B: { ...r0.stock.B }, acid: { ...r0.stock.acid } },
    labs: r0.labs.map((l) => ({ ...l })),
    plant: pl ? { ...pl, dm: { ...pl.dm }, up: copy(pl.up), low: copy(pl.low), str: copy(pl.str), fr: copy(pl.fr), prevG: { ...pl.prevG } } : null,
    bal: { ...r0.bal, ionIn: copy(r0.bal.ionIn), ionUptake: copy(r0.bal.ionUptake), ionDrain: copy(r0.bal.ionDrain), ionPrecip: copy(r0.bal.ionPrecip), plantIn: copy(r0.bal.plantIn), plantOut: copy(r0.bal.plantOut) },
    today: { ...r0.today },
    total: { ...r0.total },
  };
}

/** 근권 물을 모두 버린다(수경 교체·재배 방식 변경). */
function dumpAll(rz: RzState) {
  for (const i of IONS) rz.bal.ionDrain[i] += rz.ions[i] * rz.W;
  rz.bal.waterDrain += rz.W;
  rz.W = 0;
  rz.ions = zero();
  rz.chelFe = {};
}

/** 근권에 저장된 물·이온(질량 보존 검사용): 근권 + 배액 탱크 */
export function storage(rz: RzState): { water: number; ions: IonVec } {
  const ions = zero();
  for (const i of IONS) ions[i] = rz.ions[i] * rz.W + rz.drainIons[i] * rz.drainTank;
  return { water: rz.W + rz.drainTank, ions };
}

/** 근권 용액에 급액 L(L/m²)을 섞는다. */
function mixInto(rz: RzState, ions: IonVec, chel: Record<string, number>, L: number) {
  if (L <= 0) return;
  const W = rz.W + L;
  for (const i of IONS) rz.ions[i] = (rz.ions[i] * rz.W + ions[i] * L) / W;
  const keys = new Set([...Object.keys(rz.chelFe), ...Object.keys(chel)]);
  for (const k of keys) rz.chelFe[k] = ((rz.chelFe[k] ?? 0) * rz.W + (chel[k] ?? 0) * L) / W;
  rz.W = W;
}

export function stepRootzone(state: SimState, world: World, actions: readonly UserAction[]): RzStep {
  const p = world.rz;
  const chem = p.chem;
  const r0 = state.rz;
  const rz = cloneRz(r0);
  const events: SimEvent[] = [];
  const hour = state.hour;
  const hod = hour % 24;
  const day = Math.floor(hour / 24);
  const bal = rz.bal;
  const crop = state.crop;
  const area = state.gh.setup.area;
  const elecPrice = (world.gh.price.elecEnergy + world.gh.price.elecLevy) * world.gh.price.elecSurcharge;
  const living = !!crop && !crop.dead && !(crop.ws?.harvested ?? false);
  const dap = crop ? (hour - crop.plantedHour) / 24 : 0;
  const cost = (kind: 'fert' | 'water' | 'elec' | 'lab', won: number) => {
    rz.today.won += won;
    rz.total.won += won;
    rz.total[kind] += won;
  };
  const labor = (h: number) => {
    rz.today.labor += h;
    rz.total.labor += h;
  };

  // ── 하루 넘김: 어제 배액률로 1회 관수량 자동 보정 ──
  let newDay = false;
  if (hod === 0 && rz.today.dayIndex !== day) {
    newDay = true;
    const t = rz.today;
    rz.yesterday = t;
    const s0 = sysOf(world, rz.setup);
    if (rz.irr.autoDrain && s0.kind === 'substrate' && t.feed > 0) {
      const dr = (100 * t.drain) / t.feed;
      const step = p.irrigation.autoDrainStep;
      rz.doseScale = clamp(rz.doseScale * (1 + step * clamp((rz.irr.drainTarget - dr) / 10, -1.5, 1.5)), 0.2, 3);
    }
    rz.today = emptyRzDay(day);
  }
  const td = rz.today;

  // ── 조치 ──
  const refill = (k: TankKey) => {
    if (!hasRecipe(rz.nut.tanks[k])) {
      rz.stock[k] = { ...rz.stock[k], left: 0, recipeKey: '' };
      return;
    }
    const f = fillTank(rz.nut.tanks[k], rz.nut.volume[k], p);
    rz.stock[k] = f.tank;
    cost('fert', f.mix.cost);
    labor(p.tanks.mixLabor);
  };
  let refillRootzone = false;
  for (const a of actions) {
    if (a.type === 'rz/setup') {
      const s = a.payload as RzSetup;
      if (s.system !== rz.setup.system) {
        // 재배 방식(배지·수경) 교체는 작물이 없을 때만: 근권을 비우고 새 시스템을 급액으로 채운다
        if (living) rz.setup = { ...s, system: rz.setup.system };
        else {
          dumpAll(rz);
          rz.setup = s;
          rz.health = 1;
          refillRootzone = true;
        }
      } else rz.setup = s;
    } else if (a.type === 'rz/config') {
      // 작물 기본값 일괄 적용(근권 구성·관수·양액)
      const c = a.payload as { setup: RzSetup; irr: RzState['irr']; nut: RzState['nut'] };
      if (!living || c.setup.system === rz.setup.system) {
        if (c.setup.system !== rz.setup.system) {
          dumpAll(rz);
          rz.health = 1;
          refillRootzone = true;
        }
        rz.setup = c.setup;
      }
      rz.irr = c.irr;
      rz.nut = c.nut;
      rz.doseScale = 1;
      TANKS.forEach(refill);
    } else if (a.type === 'rz/irrigation') {
      rz.irr = a.payload as RzState['irr'];
      rz.doseScale = 1;
    } else if (a.type === 'rz/nutrition') rz.nut = a.payload as RzState['nut'];
    else if (a.type === 'rz/refill') {
      const k = (a.payload as { tank: TankKey | 'all' }).tank;
      if (k === 'all') TANKS.forEach(refill);
      else refill(k);
    } else if (a.type === 'rz/flush') {
      rz.clog *= p.clog.flushKeep;
      labor((p.clog.flushLabor * area) / 1000);
      events.push({ hour, type: 'rootzone', level: 'info', code: 'flushed', value: rz.clog });
    } else if (a.type === 'rz/renew') {
      dumpAll(rz);
      rz.lastRenew = day;
      refillRootzone = true;
    } else if (a.type === 'rz/dumpDrain') {
      for (const i of IONS) bal.ionDrain[i] += rz.drainIons[i] * rz.drainTank;
      bal.waterDrain += rz.drainTank;
      rz.drainTank = 0;
      rz.drainIons = zero();
    } else if (a.type === 'rz/lab') {
      const kind = (a.payload as { kind: Lab['kind'] }).kind;
      cost('lab', kind === 'tissue' ? p.lab.tissue : kind === 'water' ? p.lab.water : p.lab.solution);
      rz.labs = [...rz.labs.slice(-11), sample(world, rz, kind, hour)];
    }
  }
  for (const l of rz.labs) if (l.ready === hour) events.push({ hour, type: 'rootzone', level: 'info', code: `lab:${l.kind}`, value: l.ordered });

  const sys = sysOf(world, rz.setup);
  const hydro = sys.kind === 'hydro';
  const capW = capacityOf(world, rz.setup);
  const pco2 = (hydro ? chem.pco2Tank : chem.pco2Rootzone) / 1e6;
  const tRoot = rootTemp(world, state, hydro);

  // ── 원액 탱크: 비면 자동 보충(설정 시) ──
  for (const k of TANKS) if (hasRecipe(rz.nut.tanks[k]) && rz.stock[k].left <= 1e-6 && rz.nut.autoRefill) refill(k);

  // ── 수경 양액 정기 교체 ──
  if (hydro && rz.irr.renewDays > 0 && living && hod === 9 && day - rz.lastRenew >= rz.irr.renewDays) {
    dumpAll(rz);
    rz.lastRenew = day;
    refillRootzone = true;
  }
  if (refillRootzone) {
    const { f, won } = fillRootzone(world, rz, dap, area);
    cost('fert', won);
    const L = capW;
    const src = rz.setup.water === 'rain' ? rz.setup.backup : rz.setup.water;
    cost('water', waterCost(world, src, L * (1 - f.use.A - f.use.B - f.use.acid), area, elecPrice));
    labor(p.tanks.renewLabor * (area / 1000));
  }

  // ── 빗물 탱크 ──
  if (rz.setup.water === 'rain') rz.rain = Math.min(rz.setup.rainTank, rz.rain + state.weather.now.precip * p.water.cost.rainCollect);

  // ── 물 흡수(증산, L/m²)와 뿌리 ──
  let U = living ? state.gh.out.transpiration / 1000 : 0;
  // 능동 흡수에 쓰이는 뿌리량: 뿌리가 잎에 비해 아주 많아도(와사비 근경·묵은 뿌리) 흡수 능력은 지상부가 뒷받침하는 만큼만
  const RM = living && crop ? Math.min(crop.out.wRoot, p.root.activeRootShoot * crop.out.wLeaf) : 0;
  const nCrop = crop ? p.crop[crop.cropId] : null;

  // ── 산소 → 뿌리 활력 ──
  let o2 = 1;
  if (hydro) {
    const hs = sys as HydroSys;
    const kla = rz.setup.aeration ? hs.klaAerated : hs.kla;
    const sat = doSat(p, tRoot);
    const R = ((living && crop ? crop.out.wRoot : 0) * p.hydro.rootO2 * dpow(p.hydro.rootO2Q10, (tRoot - 20) / 10)) / (rz.W > 1 ? rz.W : 1); // mg L⁻¹ h⁻¹
    const eq = Math.max(0, sat - R / kla);
    rz.dO = eq + (rz.dO - eq) * dexp(-kla);
    if (rz.dO < 0) rz.dO = 0;
    o2 = trap(p.hydro.doTarget, rz.dO);
  } else {
    const ss = sys as SubstrateSys;
    const afp = ss.thetaS - rz.W / ss.volume;
    const need = 1 + p.substrate.afpTemp * (tRoot - p.substrate.afpTempRef);
    o2 = trap(p.substrate.afp, afp / (need > 0.3 ? need : 0.3));
  }
  const fT = nCrop?.rootTemp ? trap(nCrop.rootTemp, tRoot) : 1;
  if (living) {
    rz.health -= p.root.healthLoss * (1 - o2) * rz.health;
    rz.health += p.root.healthGain * o2 * fT * (1 - rz.health);
    if (r0.health >= 0.5 && rz.health < 0.5) events.push({ hour, type: 'rootzone', level: 'warning', code: 'root', value: rz.health });
  }
  const rootAct = fT * o2 * rz.health;

  // ── 흡수(구간별) ──
  let uptakeTotal = zero();
  let waterTaken = 0;
  const doUptake = (L: number, rootShare: number) => {
    if (!living || !nCrop) return;
    const floor = hydro ? 0 : (sys as SubstrateSys).thetaR * (sys as SubstrateSys).volume;
    const avail = Math.max(0, rz.W - floor);
    const take = L < avail * 0.95 ? L : avail * 0.95;
    const spNow = speciate(rz.ions, chem, pco2);
    const u = uptakeOf(rz.ions, rz.W, take, RM * rootShare, rootAct, spNow.pH, rz.plant, nCrop, p);
    const nW = rz.W - take;
    const fe0 = rz.ions.Fe;
    for (const i of IONS) {
      const amt = rz.ions[i] * rz.W - u[i];
      rz.ions[i] = nW > 1e-9 ? Math.max(0, amt) / nW : 0;
    }
    // 킬레이트철은 전체 철과 같은 비율로 흡수된다
    const kFe = fe0 > 0 ? rz.ions.Fe / fe0 : 0;
    for (const k of Object.keys(rz.chelFe)) rz.chelFe[k] = rz.chelFe[k]! * kFe;
    rz.W = nW;
    waterTaken += take;
    for (const i of IONS) uptakeTotal[i] += u[i];
  };

  // ── 급액: 원수(+회수 배액) + 원액 + 산 ──
  const ecT = ecTargetAt(rz.nut, dap);
  // 원액 재고(온실 전체 L)로 이번 급액(L/m² × 면적)에 넣을 수 있는 최대 배율
  const lim = (k: TankKey, vol: number, D: number) => (vol > 0 && hasRecipe(rz.nut.tanks[k]) ? (rz.stock[k].left * D) / (vol * area) : 0);
  const src = rz.setup.water === 'rain' ? rz.setup.backup : rz.setup.water;
  /** 급액 L을 만들 원수 조성(회수 배액·빗물 비율 포함). 실제 물·이온 장부는 account()에서. */
  const baseFor = (L: number) => {
    const rr = rz.setup.drain === 'closed' && !hydro && rz.drainTank > 0 && L > 0 ? Math.min(rz.irr.reuse, rz.drainTank / L) : 0;
    const rf = rz.setup.water === 'rain' && L > 0 ? Math.min(1, rz.rain / (L * (1 - rr))) : 0;
    const fresh = zero();
    for (const i of IONS) fresh[i] = world.raw.rain[i] * rf + world.raw[src][i] * (1 - rf);
    const vec = zero();
    for (const i of IONS) vec[i] = fresh[i] * (1 - rr) + rz.drainIons[i] * rr;
    return { vec, fresh, rr, rf };
  };
  const account = (f: Feed, L: number, b: ReturnType<typeof baseFor>) => {
    const uSum = f.use.A + f.use.B + f.use.acid;
    const Lb = L * (1 - uSum);
    const reuse = Lb * b.rr;
    const freshL = Lb - reuse;
    const rainL = freshL * b.rf;
    // 시스템 입력: 새 원수와 원액·산(회수 배액은 내부 순환)
    bal.waterIn += freshL + L * uSum;
    for (const i of IONS) bal.ionIn[i] += b.fresh[i] * freshL;
    for (const k of TANKS) {
      const used = f.use[k] * L;
      for (const i of IONS) bal.ionIn[i] += rz.stock[k].ions[i] * used;
      rz.stock[k].left = Math.max(0, rz.stock[k].left - used * area);
      rz.clog += rz.stock[k].precip * used * p.clog.stockSuspended * p.clog.perMol;
    }
    rz.drainTank = Math.max(0, rz.drainTank - reuse);
    rz.rain = Math.max(0, rz.rain - rainL);
    cost('water', waterCost(world, src, freshL - rainL, area, elecPrice));
    if (reuse > 0 && rz.setup.disinfect !== 'none') cost('elec', ((reuse * area) / 1000) * (rz.setup.disinfect === 'uv' ? p.equipment.uvPower : p.equipment.heatPower) * elecPrice);
    // 원수의 비킬레이트 철 → 점적 라인 철 침전
    rz.clog += (p.clog.rawFe * world.raw[src].Fe * 55.85 * (freshL - rainL)) / 1000;
    td.feed += L;
    rz.total.feed += L;
    td.feedEc += f.ec * L;
    td.feedPh += f.pH * L;
  };
  const solve = (b: ReturnType<typeof baseFor>, L: number, mixWith?: Parameters<typeof solveMix>[7]) => {
    const l = { A: lim('A', L, rz.nut.dilution), B: lim('B', L, rz.nut.dilution), acid: lim('acid', L, rz.nut.acidDilution) };
    const m = !rz.nut.feedOn ? { rA: 0, rB: 0, ra: 0 } : rz.setup.injector === 'mixing' ? solveMix(b.vec, {}, rz.stock, rz.nut, ecT, chem, l, mixWith) : { rA: Math.min(1, l.A), rB: Math.min(1, l.B), ra: Math.min(1, l.acid) };
    return feedOf(b.vec, {}, rz.stock, rz.nut, m.rA, m.rB, m.ra, chem);
  };

  let feed: Feed | null = null;
  let drainL = 0;
  let shots = 0;
  const drainOut = zero();
  let drainOutL = 0;

  if (hydro) {
    // 수경: 증산만큼 보충. 혼합기는 보충 뒤의 양액 전체가 목표 EC·pH가 되도록 원액·산 양을 정한다.
    if (U > rz.W * 0.9) U = rz.W * 0.9;
    const need = capW - (rz.W - U);
    if (living && need > 1e-9) {
      const b = baseFor(need);
      // 흡수 전 근사: 지금 양액에서 물만 U만큼 빠진 상태와 섞는다
      const after = rz.W - U;
      const conc = zero();
      for (const i of IONS) conc[i] = after > 1e-9 ? (rz.ions[i] * rz.W) / after : 0;
      const f = solve(b, need, { ions: conc, vol: after, addVol: need, pco2 });
      account(f, need, b);
      feed = f;
      mixInto(rz, f.ions, f.chelFe, need);
    }
    doUptake(U, 1);
  } else if (living) {
    const ss = sys as SubstrateSys;
    const doseL = (rz.irr.dose / 1000) * (crop?.density ?? 0) * rz.doseScale * (1 - p.clog.flowLoss * clamp(rz.clog, 0, 1));
    shots = shotsThisHour(rz, state, hod, ss, p.irrigation.maxEventsPerHour);
    let f: Feed | null = null;
    if (shots > 0 && doseL > 0) {
      const tot = doseL * shots;
      const b = baseFor(tot);
      f = solve(b, tot);
      account(f, tot, b);
      feed = f;
      // 급액 pH가 인산칼슘 침전 한계를 넘으면 점적 라인에 침전
      if (f.pH > chem.caPFeed) rz.clog += (p.clog.caP * f.ions.Ca * f.ions.P * tot * (f.pH - chem.caPFeed)) / 1000;
      rz.lastShot = hour;
    }
    for (let k = 0; k <= shots; k++) {
      doUptake(U / (shots + 1), 1 / (shots + 1));
      if (k === shots || !f || doseL <= 0) continue;
      // 선택류(bypass): 일부는 배지 용액과 섞이지 않고 바로 빠진다
      const by = doseL * ss.bypass;
      mixInto(rz, f.ions, f.chelFe, doseL - by);
      // 용기용수량을 넘는 물은 배지 용액 조성으로 빠진다
      const exc = Math.max(0, rz.W - capW);
      rz.W -= exc;
      const dL = by + exc;
      if (dL <= 0) continue;
      const dv = zero();
      for (const i of IONS) dv[i] = (f.ions[i] * by + rz.ions[i] * exc) / dL;
      drainL += dL;
      const sp = speciate(dv, chem);
      td.drainEc += ecOf(dv, chem, sp) * dL;
      td.drainPh += sp.pH * dL;
      if (rz.setup.drain === 'closed') {
        const room = Math.max(0, p.tanks.drainVolume - rz.drainTank);
        const keep = dL < room ? dL : room;
        const tot = rz.drainTank + keep;
        if (tot > 0) for (const i of IONS) rz.drainIons[i] = (rz.drainIons[i] * rz.drainTank + dv[i] * keep) / tot;
        rz.drainTank = tot;
        for (const i of IONS) drainOut[i] += dv[i] * (dL - keep);
        drainOutL += dL - keep;
      } else {
        for (const i of IONS) drainOut[i] += dv[i] * dL;
        drainOutL += dL;
      }
    }
  }

  // ── 질산화: NH4⁺ → NO3⁻ (산성화) ──
  if (rz.W > 1e-9 && rz.ions.NH4 > 0) {
    const nit = rz.ions.NH4 * clamp(sys.nitrify * dpow(2, (tRoot - 20) / 10), 0, 1);
    rz.ions.NH4 -= nit;
    rz.ions.NO3 += nit;
    bal.nitrified += nit * rz.W;
  }

  // ── 근권 화학: 열린 계 탄산 평형, 킬레이트철 분해·철 침전, 인산칼슘 침전 ──
  let sp = speciate(rz.ions, chem, pco2);
  bal.gasC += (sp.cT - rz.ions.HCO3) * rz.W;
  rz.ions.HCO3 = sp.cT;
  if (rz.W > 1e-9) {
    const ch = p.chelate;
    const precip = zero();
    let chelTot = 0;
    for (const k of Object.keys(rz.chelFe)) {
      const curve = (ch as unknown as Record<string, [number, number, number, number] | undefined>)[k];
      const v = rz.chelFe[k]!;
      const lost = curve ? v * ch.decay * (1 - trap(curve, sp.pH)) : 0;
      rz.chelFe[k] = v - lost;
      chelTot += v - lost;
      precip.Fe += lost;
    }
    // 킬레이트되지 않은 철(원수 철·분해된 킬레이트)은 pH가 높을수록 빨리 수산화철로 가라앉는다
    const free = Math.max(0, rz.ions.Fe - chelTot - precip.Fe);
    precip.Fe += free * ch.freeRate * (1 - trap(ch.free, sp.pH));
    if (sp.pH > chem.caPFeed) {
      const x = Math.min(rz.ions.Ca, rz.ions.P) * clamp(chem.caPRate * (sp.pH - chem.caPFeed), 0, 0.5);
      precip.Ca += x;
      precip.P += x;
    }
    let any = false;
    for (const i of IONS) {
      if (precip[i] <= 0) continue;
      const c = Math.min(precip[i], rz.ions[i]);
      rz.ions[i] -= c;
      bal.ionPrecip[i] += c * rz.W;
      any = true;
    }
    if (any) {
      const c0 = sp.cT;
      sp = speciate(rz.ions, chem, pco2);
      bal.gasC += (sp.cT - c0) * rz.W;
      rz.ions.HCO3 = sp.cT;
    }
  }
  const ec = rz.W > 1e-9 ? ecOf(rz.ions, chem, sp) : 0;

  // ── 식물 양분 ──
  if (crop && nCrop && living) {
    const key = `${crop.cropId}:${crop.plantedHour}`;
    const d = cropDm(crop, world.crops[crop.cropId].leaf.expandDays, p.plant.youngAge);
    if (!rz.plant || rz.plant.cropKey !== key) {
      if (rz.plant) addTo(bal.plantOut, poolTotal(rz.plant));
      rz.plant = initPools(key, d, nCrop, p);
      addTo(bal.plantIn, poolTotal(rz.plant));
    }
    // 근압: 뿌리 활력과 근권 삼투압(EC)에 따라 줄어든다
    const rpF = rootAct * clamp(1 - ec / p.plant.rootPressureEC, 0, 1);
    addTo(bal.plantOut, allocate(rz.plant, d, uptakeTotal, nCrop, p, state.gh.out.vpd, newDay, rpF));
  } else if (rz.plant) {
    addTo(bal.plantOut, poolTotal(rz.plant));
    rz.plant = null;
  }

  // ── 장부·일 집계 ──
  addTo(bal.ionUptake, uptakeTotal);
  addTo(bal.ionDrain, drainOut);
  bal.waterUptake += waterTaken;
  bal.waterDrain += drainOutL;
  td.drain += drainL;
  td.uptake += waterTaken;
  td.events += shots;
  td.rootEc += ec;
  td.rootPh += sp.pH;
  td.theta += hydro ? 0 : rz.W / (sys as SubstrateSys).volume;
  td.rootT += tRoot;
  td.o2 += hydro ? rz.dO : o2;
  td.hours += 1;
  if (hydro && rz.setup.aeration && living) cost('elec', ((p.equipment.aeration * area) / 1000) * elecPrice);
  rz.total.drain += drainL;

  // ── 사건 ──
  for (const th of [0.3, 0.6]) if (r0.clog < th && rz.clog >= th) events.push({ hour, type: 'rootzone', level: th > 0.5 ? 'warning' : 'advisory', code: 'clog', value: rz.clog });
  for (const k of TANKS) if (r0.stock[k].left > 1e-6 && rz.stock[k].left <= 1e-6 && hasRecipe(rz.nut.tanks[k])) events.push({ hour, type: 'stock', level: 'warning', code: `tank:${k}`, value: 0 });
  if (!hydro && living && r0.out.psi > -30 && rz.W > 0) {
    const psiNow = psiOf(sys as SubstrateSys, rz.W / (sys as SubstrateSys).volume);
    if (psiNow <= -30) events.push({ hour, type: 'rootzone', level: 'warning', code: 'dry', value: psiNow });
  }

  rz.out = outOf(world, rz, sp.pH, ec, feed, tRoot, o2, rootAct, uptakeTotal, state);
  return { rz, events };
}

function addTo(a: IonVec, b: IonVec) {
  for (const i of IONS) a[i] += b[i];
}

/** 원수 비용: 상수는 수도요금, 지하수는 양수 전력, 빗물은 0(L/m² 기준). */
function waterCost(world: World, src: 'groundwater' | 'tap', L: number, area: number, elecPrice: number): number {
  const m3 = (L * area) / 1000;
  const c = world.rz.water.cost;
  return src === 'tap' ? m3 * c.tap : m3 * c.groundwaterPump * elecPrice;
}

function shotsThisHour(rz: RzState, state: SimState, hod: number, ss: SubstrateSys, maxPerHour: number): number {
  const irr = rz.irr;
  const inWindow = hod >= irr.start && hod < irr.end;
  const gapMax = irr.minGap > 0 ? Math.max(1, Math.floor(60 / irr.minGap)) : maxPerHour;
  const cap = maxPerHour < gapMax ? maxPerHour : gapMax;
  let n = 0;
  if (irr.mode === 'solar') {
    if (inWindow) {
      rz.solarAcc += (state.weather.now.solarW * 3600) / 1e4;
      const J = irr.solarJ > 1 ? irr.solarJ : 1;
      n = Math.floor(rz.solarAcc / J);
      if (irr.startShot && hod === irr.start) n += 1;
      // 상한에 걸려 못 준 몫은 다음 시간으로 넘긴다
      const given = (n < cap ? n : cap) - (irr.startShot && hod === irr.start ? 1 : 0);
      rz.solarAcc -= Math.max(0, given) * J;
    } else rz.solarAcc = 0;
  } else if (irr.mode === 'timer') {
    if (irr.timerCount > 0 && irr.end > irr.start) {
      const span = irr.end - irr.start;
      for (let k = 0; k < irr.timerCount; k++) {
        const t = irr.start + ((k + 0.5) * span) / irr.timerCount;
        if (t >= hod && t < hod + 1) n++;
      }
    }
  } else if (irr.mode === 'sensor') {
    if (inWindow) {
      const theta = rz.W / ss.volume;
      if (theta * 100 < irr.sensorTheta) {
        const doseL = Math.max(1e-6, (irr.dose / 1000) * (state.crop?.density ?? 1) * rz.doseScale);
        n = Math.ceil(((irr.sensorTheta / 100 - theta) * ss.volume) / doseL);
        if (n < 1) n = 1;
      }
    }
  }
  return n < cap ? n : cap;
}

/** 분석 의뢰: 채취 시점의 실제 값을 담아 두고 지연 시간 뒤 공개한다. */
function sample(world: World, rz: RzState, kind: Lab['kind'], hour: number): Lab {
  const lab: Lab = { kind, ordered: hour, ready: hour + world.rz.lab.delay };
  if (kind === 'tissue') lab.tissue = rz.out.tissue;
  else {
    const v = kind === 'feed' ? rz.out.feedIons : kind === 'water' ? world.raw[rz.setup.water] : rz.ions;
    const sp = speciate(v, world.rz.chem);
    lab.ions = copy(v);
    lab.ec = ecOf(v, world.rz.chem, sp);
    lab.pH = kind === 'drain' ? rz.out.pH : sp.pH;
  }
  return lab;
}
