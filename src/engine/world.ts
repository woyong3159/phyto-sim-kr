/**
 * World: 한 작기 동안 변하지 않는 "세계 설정" — 지역 기후 기준선과 생성기 파라미터.
 * /data/*.json의 내용을 인자로 받아 만든다(엔진은 파일을 직접 읽지 않는다, N5·N6).
 * 같은 설정 + 같은 데이터면 언제나 같은 World가 나오므로 세이브에는 넣지 않고 매번 다시 만든다.
 */
import { dexp, dlog } from './dmath';
import type { SimConfig } from './types';
import { buildGhParams, type GhParams } from './greenhouse/params';
import { buildClimate, type Climate, type ClimateClass, type JangmaZone, type RegionInfo } from './weather/climate';

interface P {
  value: number;
}
interface PV {
  values: number[];
}

/** data/regions.json, climate.json, events.json 의 params 부분. */
export interface EngineData {
  regions: {
    stations: {
      id: string;
      name: string;
      group: string;
      climateClass: string;
      jangmaZone: string;
      lat: P;
      lon: P;
      elevation: P;
      typhoonWeight: P;
    }[];
  };
  climate: {
    normals: Record<string, Record<'TMAX' | 'TAVG' | 'TMIN' | 'PRCP' | 'PDAY' | 'RH' | 'SUN' | 'WIND', PV>>;
    generator: Record<string, unknown>;
  };
  events: { weather: Record<string, unknown> };
  facilities: unknown;
  equipment: unknown;
  prices: unknown;
}

export interface GenParams {
  tempSd: number[];
  arFastPhi: number;
  arSlowPhi: number;
  slowShare: number;
  wetPersistence: number;
  wetPersistenceJangma: number;
  precipShape: number;
  /** Γ(1 + 1/shape): Weibull 평균 보정 */
  precipGamma: number;
  wetDtrFactor: number;
  dtrNoiseSd: number;
  wetTempOffset: number[];
  wetRhOffset: number;
  rhNoiseSd: number;
  wetSolarFactor: number;
  solarNoise: number;
  windDiurnalAmp: number;
  plA: number;
  plB: number;
  plC: number;
  snowRatio: number;
  snowTempFull: number;
  snowTempNone: number;
}

export interface EventParams {
  heatAdvisory: number;
  heatWarning: number;
  coldAdvisory: number;
  coldWarning: number;
  snowAdvisory: number;
  snowWarning: number;
  heavyRain: number;
  jangmaStart: number;
  jangmaEnd: number;
  jangmaSd: number;
  typhoonMonthly: number[];
  typhoonRainMean: number;
  typhoonWindFactor: number;
  typhoonGustFactor: number;
  hailAnnualDays: number;
  hailMonthlyWeight: number[];
}

export interface World {
  config: SimConfig;
  region: RegionInfo;
  clim: Climate;
  gen: GenParams;
  ev: EventParams;
  gh: GhParams;
}

const num = (o: Record<string, unknown>, k: string): number => {
  const p = o[k] as P | undefined;
  if (!p || typeof p.value !== 'number') throw new Error(`파라미터 누락: ${k}`);
  return p.value;
};
const arr = (o: Record<string, unknown>, k: string): number[] => {
  const p = o[k] as PV | undefined;
  if (!p || !Array.isArray(p.values) || p.values.length !== 12) throw new Error(`월별 파라미터 누락: ${k}`);
  return p.values;
};
const sub = (o: Record<string, unknown>, k: string, key: string): number => num(o[k] as Record<string, unknown>, key);

/** Γ(x), x ∈ (1, 4] — Lanczos 근사 대신 점화식 + 급수 없이 쓸 수 있는 Stirling 보정식(결정론적 사칙연산만). */
function gamma(x: number, exp: (v: number) => number, log: (v: number) => number): number {
  // Γ(x) = Γ(x+6) / (x(x+1)…(x+5)), Γ(z) ≈ √(2π/z)·(z/e)^z·(1 + 1/12z + 1/288z² − 139/51840z³)
  const z = x + 6;
  const stirling = Math.sqrt(6.283185307179586 / z) * exp(z * (log(z) - 1)) * (1 + 1 / (12 * z) + 1 / (288 * z * z) - 139 / (51840 * z * z * z));
  return stirling / (x * (x + 1) * (x + 2) * (x + 3) * (x + 4) * (x + 5));
}


export function listRegions(data: EngineData): RegionInfo[] {
  return data.regions.stations.map((s) => ({
    id: s.id,
    name: s.name,
    group: s.group,
    climateClass: s.climateClass as ClimateClass,
    jangmaZone: s.jangmaZone as JangmaZone,
    lat: s.lat.value,
    lon: s.lon.value,
    elevation: s.elevation.value,
    typhoonWeight: s.typhoonWeight.value,
  }));
}

export function createWorld(config: SimConfig, data: EngineData): World {
  const region = listRegions(data).find((r) => r.id === config.regionId);
  if (!region) throw new Error(`알 수 없는 지역: ${config.regionId}`);
  const nm = data.climate.normals[region.id];
  if (!nm) throw new Error(`기후 평년값 없음: ${region.id}`);
  const g = data.climate.generator;
  const e = data.events.weather;
  const cls = region.climateClass;

  const classFactor = sub(g, 'tempSdClassFactor', cls);
  const shape = num(g, 'precipWeibullShape');

  // 평년 강수에는 태풍 비가 이미 들어 있다. 생성기가 태풍을 따로 만들므로 그 기대 몫을 평상 강수에서 뺀다.
  const tyMonthly = arr(e, 'typhoonMonthlyCount');
  const tyRain = num(e, 'typhoonRainMeanMm') * (0.5 + region.typhoonWeight);
  const ordPrecip: number[] = [];
  const ordWet: number[] = [];
  for (let m = 0; m < 12; m++) {
    const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]!;
    const pi = nm.PDAY.values[m]! / days;
    const mu = nm.PRCP.values[m]! / nm.PDAY.values[m]!;
    const nTy = tyMonthly[m]! * region.typhoonWeight;
    // 첫날: 평소 기대 강수(π·μ) 대신 태풍 강수 / 둘째 날: 비가 확정(평소보다 (1−π)·μ 더)
    const extraRain = nTy * (tyRain - pi * mu + (1 - pi) * mu);
    const extraWet = nTy * 2 * (1 - pi);
    ordPrecip.push(Math.max(nm.PRCP.values[m]! - extraRain, nm.PRCP.values[m]! * 0.5));
    ordWet.push(Math.max(nm.PDAY.values[m]! - extraWet, nm.PDAY.values[m]! * 0.5));
  }

  const clim = buildClimate(
    region,
    { tmax: nm.TMAX.values, tavg: nm.TAVG.values, tmin: nm.TMIN.values, precip: nm.PRCP.values, wetDays: nm.PDAY.values, rh: nm.RH.values, sunshine: nm.SUN.values, wind: nm.WIND.values },
    num(g, 'angstromA'),
    num(g, 'angstromB'),
    num(g, 'clearSkyFraction'),
    { a: num(g, 'partonLoganA'), b: num(g, 'partonLoganB'), c: num(g, 'partonLoganC') },
    { precip: ordPrecip, wetDays: ordWet },
  );

  const annualMean = nm.TAVG.values.reduce((a, v, m) => a + v * [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]!, 0) / 365;

  return {
    config,
    region,
    clim,
    gh: buildGhParams(data.facilities, data.equipment, data.prices, annualMean),
    gen: {
      tempSd: arr(g, 'tempSdMonthly').map((v) => v * classFactor),
      arFastPhi: num(g, 'arFastPhi'),
      arSlowPhi: num(g, 'arSlowPhi'),
      slowShare: num(g, 'slowVarianceShare'),
      wetPersistence: num(g, 'wetPersistence'),
      wetPersistenceJangma: num(g, 'wetPersistenceJangma'),
      precipShape: shape,
      precipGamma: gamma(1 + 1 / shape, dexp, dlog),
      wetDtrFactor: num(g, 'wetDtrFactor'),
      dtrNoiseSd: num(g, 'dtrNoiseSd'),
      wetTempOffset: arr(g, 'wetTempOffsetMonthly'),
      wetRhOffset: num(g, 'wetRhOffset'),
      rhNoiseSd: num(g, 'rhNoiseSd'),
      wetSolarFactor: num(g, 'wetSolarFactor'),
      solarNoise: num(g, 'solarNoise'),
      windDiurnalAmp: num(g, 'windDiurnalAmp'),
      plA: num(g, 'partonLoganA'),
      plB: num(g, 'partonLoganB'),
      plC: num(g, 'partonLoganC'),
      snowRatio: num(g, 'snowRatio'),
      snowTempFull: num(g, 'snowTempFull'),
      snowTempNone: num(g, 'snowTempNone'),
    },
    ev: {
      heatAdvisory: num(e, 'heatwaveAdvisoryTmax'),
      heatWarning: num(e, 'heatwaveWarningTmax'),
      coldAdvisory: num(e, 'coldwaveAdvisoryTmin'),
      coldWarning: num(e, 'coldwaveWarningTmin'),
      snowAdvisory: num(e, 'heavySnowAdvisoryCm'),
      snowWarning: num(e, 'heavySnowWarningCm'),
      heavyRain: num(e, 'heavyRainDailyMm'),
      jangmaStart: sub(e, 'jangmaStartDoy', region.jangmaZone),
      jangmaEnd: sub(e, 'jangmaEndDoy', region.jangmaZone),
      jangmaSd: num(e, 'jangmaDateSd'),
      typhoonMonthly: tyMonthly,
      typhoonRainMean: num(e, 'typhoonRainMeanMm'),
      typhoonWindFactor: num(e, 'typhoonWindFactor'),
      typhoonGustFactor: num(e, 'typhoonGustFactor'),
      hailAnnualDays: sub(e, 'hailAnnualDays', cls),
      hailMonthlyWeight: arr(e, 'hailMonthlyWeight'),
    },
  };
}
