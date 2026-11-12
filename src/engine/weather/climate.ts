/**
 * 지역 기후 기준선: 월 평년값 → 일별 기준선(365일).
 * 월 중앙에 마디를 둔 주기 3차 에르미트 스플라인으로 보간하되,
 * "보간한 일별 값의 월평균 = 평년값"이 되도록 마디 값을 반복 보정한다(평균 보존 보간).
 * 단순 스플라인은 한여름·한겨울 꼭짓점을 깎아 먹어서 월평균이 평년값과 어긋난다.
 */
import { PI, dexp, dpow, dsin } from '../dmath';
import { sunDay, daySinSum, type SunDay } from './astro';

export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const MONTH_START: number[] = [];
{
  let acc = 0;
  for (const d of MONTH_DAYS) {
    MONTH_START.push(acc);
    acc += d;
  }
}
/** 0–364 → 0–11 */
export const MONTH_OF_DAY: number[] = [];
for (let m = 0; m < 12; m++) for (let d = 0; d < MONTH_DAYS[m]!; d++) MONTH_OF_DAY.push(m);

export type ClimateClass = 'inland' | 'coastal' | 'highland' | 'island';
export type JangmaZone = 'central' | 'south' | 'jeju';

export interface RegionInfo {
  id: string;
  name: string;
  group: string;
  climateClass: ClimateClass;
  jangmaZone: JangmaZone;
  lat: number;
  lon: number;
  elevation: number;
  typhoonWeight: number;
}

export interface MonthlyNormals {
  tmax: number[];
  tavg: number[];
  tmin: number[];
  precip: number[];
  wetDays: number[];
  rh: number[];
  sunshine: number[];
  wind: number[];
  /** 일조시간에서 환산한 일평균 일사(MJ m⁻² d⁻¹) — EST */
  solar: number[];
}

export interface Climate {
  normals: MonthlyNormals;
  /** 이하 길이 365의 일별 기준선 */
  tavg: number[];
  /** 일최고 − 일평균 */
  up: number[];
  /** 일평균 − 일최저 */
  down: number[];
  rh: number[];
  solar: number[];
  /** 평상 강수일 확률(태풍 제외) — 마르코프 체인용 */
  wetFrac: number[];
  /** 전체 강수일 확률(태풍 포함) — 비 오는 날/맑은 날 보정 배율용 */
  wetFracAll: number[];
  /** 강수일 평균 강수량(mm) */
  wetMean: number[];
  wind: number[];
  sun: SunDay[];
  /** 일사 시간 분배용 분모 */
  sinSum: number[];
  /** 청천 일사 상한(MJ m⁻² d⁻¹) */
  rso: number[];
  /** 기온 일변화 곡선의 형상 지수 γ(일평균이 평년 평균기온과 맞도록 보정) */
  shape: number[];
}

export interface DiurnalParams {
  a: number;
  b: number;
  c: number;
}

/** Parton–Logan 곡선을 0(최저)–1(최고)로 정규화한 24시간 값. 앞뒤 날이 같은 날이라고 본 기후학적 형태. */
export function normalizedDiurnal(sun: SunDay, p: DiurnalParams): number[] {
  const rise = sun.sunrise + p.c;
  const set = sun.sunset;
  const eb = dexp(-p.b);
  const sAt = (m: number) => dsin((PI * m) / (sun.daylength + 2 * p.a));
  const sSet = sAt(set - rise);
  const z = 24 - set + rise;
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    const t = h + 0.5;
    if (t >= rise && t <= set) out.push(sAt(t - rise));
    else {
      const n = t > set ? t - set : t + 24 - set;
      out.push((sSet * (dexp((-p.b * n) / z) - eb)) / (1 - eb));
    }
  }
  return out;
}

/** mean(s^γ) = target 이 되는 γ를 이분법으로 찾는다. */
function solveShape(s: number[], target: number): number {
  let lo = 0.3;
  let hi = 4;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    let m = 0;
    for (const v of s) m += v <= 0 ? 0 : dpow(v, mid);
    if (m / s.length > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function monthlyMeans(daily: number[]): number[] {
  const out: number[] = [];
  for (let m = 0; m < 12; m++) {
    let s = 0;
    for (let d = 0; d < MONTH_DAYS[m]!; d++) s += daily[MONTH_START[m]! + d]!;
    out.push(s / MONTH_DAYS[m]!);
  }
  return out;
}

function hermiteYear(nodes: number[]): number[] {
  const x = MONTH_DAYS.map((d, m) => MONTH_START[m]! + d / 2);
  const X = (i: number) => (i < 0 ? x[i + 12]! - 365 : i > 11 ? x[i - 12]! + 365 : x[i]!);
  const Y = (i: number) => nodes[((i % 12) + 12) % 12]!;
  const slope = (i: number) => (Y(i + 1) - Y(i - 1)) / (X(i + 1) - X(i - 1));
  const out: number[] = [];
  for (let d = 0; d < 365; d++) {
    const t = d + 0.5;
    let i = -1;
    while (i < 11 && X(i + 1) <= t) i++;
    const x0 = X(i);
    const x1 = X(i + 1);
    const h = x1 - x0;
    const u = (t - x0) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    out.push((2 * u3 - 3 * u2 + 1) * Y(i) + (u3 - 2 * u2 + u) * h * slope(i) + (-2 * u3 + 3 * u2) * Y(i + 1) + (u3 - u2) * h * slope(i + 1));
  }
  return out;
}

/** 평균 보존 보간. min/max를 주면 그 범위로 자른다. */
export function interpolateMonthly(monthly: number[], min = -Infinity, max = Infinity): number[] {
  const nodes = [...monthly];
  let daily = hermiteYear(nodes);
  for (let iter = 0; iter < 12; iter++) {
    const mm = monthlyMeans(daily);
    for (let m = 0; m < 12; m++) nodes[m] = nodes[m]! + (monthly[m]! - mm[m]!);
    daily = hermiteYear(nodes);
  }
  return daily.map((v) => (v < min ? min : v > max ? max : v));
}

export interface ClimateInputs {
  tmax: number[];
  tavg: number[];
  tmin: number[];
  precip: number[];
  wetDays: number[];
  rh: number[];
  sunshine: number[];
  wind: number[];
}

export function buildClimate(region: RegionInfo, n: ClimateInputs, angA: number, angB: number, clearSky: number, diurnal: DiurnalParams, ordinary?: { precip: number[]; wetDays: number[] }): Climate {
  const sun: SunDay[] = [];
  for (let d = 0; d < 365; d++) sun.push(sunDay(region.lat, region.lon, d + 1));

  // 일조시간(SRC) → 일사(EST): Ångström–Prescott. 월의 일조율 n/N을 그 달 모든 날에 적용해 월평균 Rs를 구한다.
  const solarMonthly: number[] = [];
  for (let m = 0; m < 12; m++) {
    const nPerDay = n.sunshine[m]! / MONTH_DAYS[m]!;
    let s = 0;
    for (let d = 0; d < MONTH_DAYS[m]!; d++) {
      const sd = sun[MONTH_START[m]! + d]!;
      const ratio = nPerDay / sd.possibleSunshine;
      s += (angA + angB * (ratio > 1 ? 1 : ratio)) * sd.ra;
    }
    solarMonthly.push(s / MONTH_DAYS[m]!);
  }

  const up = n.tmax.map((v, m) => v - n.tavg[m]!);
  const down = n.tavg.map((v, m) => v - n.tmin[m]!);
  // 태풍 몫을 뺀 "평상 강수"로 기준선을 만든다(태풍 강수는 생성기가 따로 더한다).
  const oPrecip = ordinary?.precip ?? n.precip;
  const oWet = ordinary?.wetDays ?? n.wetDays;
  const wetFracM = oWet.map((v, m) => v / MONTH_DAYS[m]!);
  const wetMeanM = oPrecip.map((v, m) => v / oWet[m]!);

  const upD = interpolateMonthly(up, 0.5);
  const downD = interpolateMonthly(down, 0.5);
  const shape = sun.map((sd, d) => solveShape(normalizedDiurnal(sd, diurnal), downD[d]! / (upD[d]! + downD[d]!)));

  return {
    shape,
    normals: { ...n, solar: solarMonthly },
    tavg: interpolateMonthly(n.tavg),
    up: upD,
    down: downD,
    rh: interpolateMonthly(n.rh, 20, 98),
    solar: interpolateMonthly(solarMonthly, 0.5),
    wetFrac: interpolateMonthly(wetFracM, 0.02, 0.9),
    wetFracAll: interpolateMonthly(n.wetDays.map((v, m) => v / MONTH_DAYS[m]!), 0.02, 0.9),
    wetMean: interpolateMonthly(wetMeanM, 0.5),
    wind: interpolateMonthly(n.wind, 0.2),
    sun,
    sinSum: sun.map(daySinSum),
    rso: sun.map((s) => (clearSky + 2e-5 * region.elevation) * s.ra),
  };
}
