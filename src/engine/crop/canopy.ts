/**
 * 군락 광합성(헌법 G1·G2).
 * - 잎: 비직각쌍곡선. Pmax = f(엽온, CO2, 엽령, 품종, 되먹임), 초기기울기 = f(CO2, 엽온: 광호흡).
 * - 기공: Ci/Ca = 1 − (1 − Γ* ÷ Ca)(a + b·VPD) (GECROS형) → 건조하면 Ci가 떨어져 광합성이 준다.
 * - 군락: Goudriaan 3점 가우스 적분(깊이) × 양지엽(sunlit)·음지엽(shaded) 구분, 양지엽은 잎 각도에 대해 다시 3점 적분.
 *   직달광·산란광을 따로 감쇠시킨다(SUCROS ASSIM 루틴과 같은 구조).
 */
import { dexp } from '../dmath';
import type { CoreParams, Curve } from './types';

/** 가우스 3점 적분의 위치와 가중치(Goudriaan 1986) */
export const XG = [0.1127, 0.5, 0.8873] as const;
export const WG = [0.2778, 0.4444, 0.2778] as const;

export function trap(c: Curve, x: number): number {
  if (x <= c[0] || x >= c[3]) return 0;
  if (x < c[1]) return (x - c[0]) / (c[1] - c[0]);
  if (x <= c[2]) return 1;
  return (c[3] - x) / (c[3] - c[2]);
}

export function interp(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]!) return ys[0]!;
  for (let i = 1; i < n; i++) if (x <= xs[i]!) return ys[i - 1]! + ((ys[i]! - ys[i - 1]!) * (x - xs[i - 1]!)) / (xs[i]! - xs[i - 1]!);
  return ys[n - 1]!;
}

/** 대기 투과율로 산란광 비율을 추정한다(Spitters et al. 1986, 시간 단위 관계식). */
export function diffuseFraction(solarW: number, sinB: number): number {
  if (sinB <= 0.02 || solarW <= 0) return 1;
  const atm = solarW / (1361 * sinB);
  const r = 0.847 - 1.61 * sinB + 1.04 * sinB * sinB;
  const k = (1.47 - r) / 1.66;
  if (atm <= 0.22) return 1;
  if (atm <= 0.35) return 1 - 6.4 * (atm - 0.22) * (atm - 0.22);
  if (atm <= k) return 1.47 - 1.66 * atm;
  return r;
}

/** 작물 모듈이 한 시간에 한 번 만들어 온실 모델에 넘기는 군락 요약. */
export interface CanopyView {
  lai: number;
  /** 산란광 흡광계수 */
  kdf: number;
  /** 가우스 3개 깊이(위→아래)의 잎 Pmax(25°C·기준 CO2, μmol m⁻² s⁻¹)와 양자수율 배수 */
  pmax: [number, number, number];
  alphaF: [number, number, number];
  tempCurve: Curve;
  /** 유지호흡(25°C) g CH2O m⁻² s⁻¹ */
  rm25: number;
  /** 저장고 g CH2O m⁻² */
  pool: number;
  /** 지난 시간 생장호흡 CO2 kg m⁻² s⁻¹ */
  growthResp: number;
  /** 기공저항 최솟값 s m⁻¹, 수분 스트레스(기공) 배수 */
  stomatalMin: number;
  waterStress: number;
}

export interface LeafEnv {
  /** Ci 기반 Pmax 배수, 초기기울기(mol CO2 / mol 흡수 광자) */
  fPmax: number;
  alpha: number;
}

/** 엽온·CO2·VPD에서 잎 광합성 계수를 구한다. */
export function leafEnv(core: CoreParams['photo'], tempCurve: Curve, tLeaf: number, co2: number, vpd: number): LeafEnv {
  let gamma = core.gammaStar25 + core.gammaStarSlope * (tLeaf - 25);
  if (gamma < 5) gamma = 5;
  const ciOf = (ca: number, g: number, d: number) => {
    let f = core.ciA + core.ciB * d;
    if (f > 0.8) f = 0.8;
    return ca * (1 - (1 - g / ca) * f);
  };
  const ci = ciOf(co2 > gamma + 1 ? co2 : gamma + 1, gamma, vpd);
  const ciRef = ciOf(core.co2Ref, core.gammaStar25, 1);
  const ref = (ciRef - core.gammaStar25) / (ciRef + core.co2HalfSat);
  const fC = (ci - gamma) / (ci + core.co2HalfSat) / ref;
  const fPmax = (fC > 0 ? fC : 0) * trap(tempCurve, tLeaf);
  const a = (core.quantumMax * (ci - gamma)) / (ci + 2 * gamma);
  return { fPmax, alpha: a > 0 ? a : 0 };
}

function leafPhoto(pmax: number, alpha: number, theta: number, i: number): number {
  if (pmax <= 0 || i <= 0) return 0;
  const s = alpha * i + pmax;
  const d = s * s - 4 * theta * alpha * i * pmax;
  return (s - Math.sqrt(d > 0 ? d : 0)) / (2 * theta);
}

export interface CanopyPhoto {
  /** 군락 총광합성 μmol CO2 m⁻²(바닥) s⁻¹ */
  gross: number;
  /** 군락이 흡수한 PAR 비율 */
  absorbed: number;
}

/**
 * 군락 총광합성. parDir·parDif: 군락 위의 직달·산란 PPFD(μmol m⁻² s⁻¹), sinB: 태양고도 사인.
 */
export function canopyPhoto(v: CanopyView, core: CoreParams['photo'], env: LeafEnv, parDir: number, parDif: number, sinB: number): CanopyPhoto {
  if (v.lai <= 0 || parDir + parDif <= 0) return { gross: 0, absorbed: 0 };
  const scv = core.scatter;
  const sq = Math.sqrt(1 - scv);
  const refh = (1 - sq) / (1 + sq);
  let dir = parDir;
  let dif = parDif;
  let sb = sinB;
  if (sb < 0.05) {
    // 해가 지평선 가까이 있으면 직달 성분을 산란광으로 취급한다(경로가 너무 길어 수식이 발산)
    dif += dir;
    dir = 0;
    sb = 0.05;
  }
  const refs = (refh * 2) / (1 + 1.6 * sb);
  const kdf = v.kdf;
  const clust = kdf / (0.8 * sq);
  const kbl = (0.5 / sb) * clust;
  const kdrt = kbl * sq;
  let gross = 0;
  for (let i = 0; i < 3; i++) {
    const lc = v.lai * XG[i]!;
    const eDf = dexp(-kdf * lc);
    const parLdf = (1 - refh) * dif * kdf * eDf;
    let parLsh = parLdf;
    let fsl = 0;
    let parLpp = 0;
    if (dir > 0) {
      const eBl = dexp(-kbl * lc);
      const parLt = (1 - refs) * dir * kdrt * dexp(-kdrt * lc);
      const parLdr = (1 - scv) * dir * kbl * eBl;
      parLsh += parLt - parLdr > 0 ? parLt - parLdr : 0;
      fsl = clust * eBl;
      if (fsl > 1) fsl = 1;
      parLpp = (dir * (1 - scv)) / sb;
    }
    const pm = v.pmax[i]! * env.fPmax;
    const al = env.alpha * v.alphaF[i]!;
    const aSh = leafPhoto(pm, al, core.theta, parLsh);
    let aSl = 0;
    if (fsl > 0) for (let j = 0; j < 3; j++) aSl += leafPhoto(pm, al, core.theta, parLsh + parLpp * XG[j]!) * WG[j]!;
    gross += (fsl * aSl + (1 - fsl) * aSh) * WG[i]!;
  }
  gross *= v.lai;
  const eAll = dexp(-kdf * v.lai);
  return { gross, absorbed: (1 - refh) * (1 - eAll) };
}
