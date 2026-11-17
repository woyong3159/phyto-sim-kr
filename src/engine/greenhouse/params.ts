/**
 * data/facilities.json, equipment.json, prices.json → 엔진이 쓰는 숫자 묶음.
 * 태그 형식({value, unit, range, tag, …})을 벗겨 값만 남긴다.
 */
import type { CurtainMaterial, FacilityId } from './types';

export interface FacilityParams {
  name: string;
  desc: string;
  transmissivity: number;
  uValue: number;
  coverRatio: number;
  eaveHeight: number;
  meanHeight: number;
  leakage: number;
  sideVentArea: number;
  roofVentArea: number;
  snowLimit: number;
  windLimit: number;
  snowShed: number;
  agingLoss: number;
  coverLife: number;
  buildCost: number;
}

interface Dev {
  name: string;
  installCost: number;
  life: number;
  mtbf: number;
  repairHours: number;
}

export interface GhParams {
  facilities: Record<FacilityId, FacilityParams>;
  phys: {
    doubleCoverU: number;
    doubleCoverTau: number;
    thermalMass: number;
    floorDirectFraction: number;
    massExchange: number;
    deepConductance: number;
    deepTempOffset: number;
    airExtraCapacity: number;
    canopyCapacityPerLai: number;
    innerSurfaceCoeff: number;
    radiativeCoeff: number;
    shortwaveAbsorbed: number;
    extinction: number;
    parFraction: number;
    parPhotonPerJoule: number;
    dischargeCoeff: number;
    windCoeff: number;
    boundaryResistance: number;
    boundaryResistanceFan: number;
    stomatalMin: number;
    stomatalVpd: number;
    stomatalTemp: number;
    stomatalTempOpt: number;
    stomatalCo2: number;
    dustRate: number;
    dustMax: number;
    rainWash: number;
    snowLightDepth: number;
    snowMeltOut: number;
    snowMeltIn: number;
    co2Outside: number;
    testCanopyAmax: number;
    testCanopyQuantumYield: number;
    testCanopyRespiration: number;
  };
  eq: {
    curtain: { motor: Dev; materials: Record<CurtainMaterial, { name: string; saving: number; shade: number; vapor: number; cost: number }> };
    shade: { motor: Dev; screens: Record<'s35' | 's55' | 's75', { name: string; shade: number; cost: number }> };
    vent: Dev;
    insectNet: Record<'m10' | 'm06' | 'm04', { name: string; ventFactor: number; exclusion: { aphid: number; whitefly: number; thrips: number }; cost: number }>;
    circFan: Dev & { power: number };
    fog: Dev & { rate: number; evapFraction: number; power: number };
    heater: {
      oil: Dev & { efficiency: number; blowerPower: number };
      electric: Dev & { efficiency: number };
      heatpump: Dev & { copBase: number; copSlope: number };
      geothermal: Dev & { cop: number };
    };
    cooling: { padfan: Dev & { efficiency: number; airflow: number; power: number }; heatpump: Dev & { cop: number } };
    co2: { liquid: Dev & { rate: number }; burner: Dev & { rate: number; co2PerLiter: number; waterPerLiter: number; heatFraction: number } };
    light: { led: Dev & { efficacy: number; radiantFraction: number }; hps: Dev & { efficacy: number; radiantFraction: number } };
    dehumidifier: Dev & { rate: number; energyPerKg: number; minRh: number };
    solution: { chiller: Dev & { capacity: number; cop: number }; heater: Dev & { capacity: number; efficiency: number }; capacity: number; airCoupling: number };
  };
  price: {
    taxFreeDiesel: number;
    taxFreeKerosene: number;
    diesel: number;
    kerosene: number;
    dieselHeat: number;
    keroseneHeat: number;
    elecEnergy: number;
    elecLevy: number;
    elecBasic: number;
    elecSurcharge: number;
    liquidCo2: number;
  };
  /** 심층 지온 °C (지역 연평균기온 + 보정) */
  deepTemp: number;
}

/** 태그 객체를 값으로 바꾸며 트리를 복사한다. */
export function strip(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(strip);
  const o = node as Record<string, unknown>;
  if ('tag' in o && ('value' in o || 'values' in o)) return 'values' in o ? o.values : o.value;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) out[k] = strip(o[k]);
  return out;
}

export function buildGhParams(facilities: unknown, equipment: unknown, prices: unknown, annualMeanTemp: number): GhParams {
  const f = strip(facilities) as { types: GhParams['facilities']; physics: GhParams['phys'] };
  const e = strip(equipment) as GhParams['eq'];
  const p = strip(prices) as { energy: GhParams['price'] };
  if (!f?.types || !f.physics || !e?.heater || !p?.energy) throw new Error('시설·장비·가격 데이터가 올바르지 않습니다.');
  return { facilities: f.types, phys: f.physics, eq: e, price: p.energy, deepTemp: annualMeanTemp + f.physics.deepTempOffset };
}
