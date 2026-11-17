/**
 * 온실 미기상(single-zone) + 제어기. 1시간을 10분 서브스텝 6개로 나눠 계산한다.
 *
 * 상태: 실내 기온 T, 수증기압 e, CO2 농도 C, 축열체(바닥·토양 표층) 온도 Tm, 양액 온도.
 *
 * [에너지] 공기 절점
 *   Ca·dT/dt = Q_난방 + Q_보광(대류) + H_군락 + (복사 손실 환원) + 기타 발열 − λE_포그 − Q_냉방
 *              − [U·A·(1−η_커튼) + ρcp·(G_환기 + G_틈새)]·(T − T_out) − ρcp·G_팬·(T − T_패드) − hm·(T − Tm)
 *   일사는 군락(가로챈 몫)과 바닥(나머지)이 흡수한다. 군락은 받은 복사를 증산 잠열(λE)과 현열(H)로 나눈다.
 *   헌법 식(G: Phase 2)의 −λ·E_crop 항은 H_군락 = Rn − λE 안에 들어 있다.
 *   헌법 식에 없는 축열체 절점을 더했다: 낮에 데워진 바닥이 밤에 열을 내놓지 않으면
 *   무가온 온실의 야간 기온이 외기와 같아져 버린다.
 *
 * [수치 해법] 공기 절점은 시간 상수가 몇 분이라 10분 스텝의 단순 적분은 발산한다.
 *   서브스텝 안에서 계수를 고정하면 선형 미분방정식이므로 지수 해(정확해)를 쓴다.
 *   이때 각 열 흐름을 "스텝 평균 기온"으로 적분하면 에너지 수지가 반올림 오차 수준으로 닫힌다.
 *
 * [제어] 히스테리시스(온풍기 on/off)와 비례 제어(창 개도, 히트펌프). 창은 한 스텝에 25%p까지만 움직인다.
 *   설정값에 못 미치는지는 "용량이 모자라서 그런 것"이 계산에서 그대로 드러난다.
 */
import { dexp, dpow } from '../dmath';
import { nextFloat } from '../rng';
import type { RngState, SimEvent, SimState } from '../types';
import type { World } from '../world';
import { absHumidity, dewPoint, satSlope, satVp, vpFromAbs, wetBulb } from './psychro';
import { DEVICES, emptyDay, emptyHour, type DeviceId, type GhDay, type GhState } from './types';

const RHO_CP = 1207; // 공기 체적열용량 J m⁻³ K⁻¹
const LAMBDA = 2.45e6; // 증발 잠열 J kg⁻¹
const GAMMA = 0.066; // 건습계 상수 kPa K⁻¹
const SUB = 6;
const DT = 600;
const CO2_KG_PER_PPM = 1.83e-6; // 20°C에서 1 ppm = 1.83 mg m⁻³
const KG_PER_UMOL_CO2 = 44e-9;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 시각 t가 [start, end) 안인지(자정 넘김 지원). */
function inWindow(t: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

export function curtainSaving(world: World, gh: GhState): number {
  const n = gh.setup.curtainLayers;
  if (n === 0) return 0;
  const s = world.gh.eq.curtain.materials[gh.setup.curtainMaterial].saving;
  const r = s / (1 - s);
  // 겹마다 열저항이 직렬로 더해진다: 1겹이면 정확히 s
  return (n * r) / (1 + n * r);
}

/** 설치된 전기 부하 합계(kW) — 기본요금 계약전력으로 쓴다. */
export function contractKw(world: World, gh: GhState): number {
  const s = gh.setup;
  const eq = world.gh.eq;
  let w = 0;
  if (s.heater === 'electric') w += s.heaterCapacity / eq.heater.electric.efficiency;
  if (s.heater === 'heatpump') w += s.heaterCapacity / 2.5;
  if (s.heater === 'geothermal') w += s.heaterCapacity / eq.heater.geothermal.cop;
  if (s.heater === 'oil') w += s.heaterCapacity * eq.heater.oil.blowerPower;
  if (s.cooling === 'padfan') w += eq.cooling.padfan.power;
  if (s.cooling === 'heatpump') w += s.coolingCapacity / eq.cooling.heatpump.cop;
  if (s.light !== 'none') w += s.lightPpfd / eq.light[s.light].efficacy;
  if (s.circFan) w += eq.circFan.power;
  if (s.fog) w += eq.fog.power;
  if (s.dehumidifier) w += (eq.dehumidifier.rate / 1000) * eq.dehumidifier.energyPerKg * 1000;
  if (s.solutionChiller) w += eq.solution.chiller.capacity / eq.solution.chiller.cop;
  if (s.solutionHeater) w += eq.solution.heater.capacity / eq.solution.heater.efficiency;
  return (w * s.area) / 1000;
}

function finalizeDay(d: GhDay, hours: number): GhDay {
  const n = hours > 0 ? hours : 1;
  return { ...d, tMean: d.tMean / n, rhMean: d.rhMean / n };
}

export function initGreenhouse(world: World, tOut: number, rhOut: number): GhState {
  const setup = world.config.setup;
  const failures = {} as Record<DeviceId, number>;
  for (const d of DEVICES) failures[d] = 0;
  const vp = (rhOut / 100) * satVp(tOut);
  return {
    setup,
    settings: world.config.settings,
    tIn: tOut,
    vp,
    co2: world.gh.phys.co2Outside,
    tMass: (tOut + world.gh.deepTemp) / 2,
    tSolution: tOut,
    ventPos: 0,
    curtainPos: 0,
    shadePos: 0,
    heaterOn: false,
    dust: 0,
    roofSnow: 0,
    breached: false,
    destroyed: false,
    failures,
    pendingLatent: 0,
    out: { ...emptyHour(), tIn: tOut, rhIn: rhOut, co2: world.gh.phys.co2Outside, tLeaf: tOut, tSurface: tOut, tMass: tOut, tSolution: tOut, dewPoint: dewPoint(vp), vpd: satVp(tOut) - vp },
    today: emptyDay(0),
    yesterday: null,
    total: { fuelL: 0, kWh: 0, co2Kg: 0, won: 0 },
  };
}

export interface GhStepResult {
  gh: GhState;
  events: SimEvent[];
  failureRng: RngState;
}

/** state.hour 시각부터 1시간을 계산한다. 외기는 state.weather.now. */
export function stepGreenhouse(state: SimState, world: World): GhStepResult {
  const g0 = state.gh;
  const wx = state.weather.now;
  const day = state.weather.cur;
  const hour = state.hour;
  const hod = hour % 24;
  const ph = world.gh.phys;
  const eq = world.gh.eq;
  const price = world.gh.price;
  const s = g0.setup;
  const c = g0.settings;
  const fac = world.gh.facilities[s.facility];
  const events: SimEvent[] = [];
  const [uFail, failureRng] = nextFloat(state.rng.failure);

  // ── 하루 넘김 ──
  let today = g0.today;
  let yesterday = g0.yesterday;
  let dust = g0.dust;
  let total = g0.total;
  if (hod === 0 && hour > 0) {
    yesterday = finalizeDay(today, 24);
    today = emptyDay(hour / 24);
    dust = Math.min(ph.dustMax, dust + ph.dustRate);
    if (state.weather.prev.precip >= 10) dust *= 1 - ph.rainWash;
  }
  // 기본요금(계약전력)은 하루치씩 나눠 쌓는다
  let basicWon = 0;
  if (hod === 0 && !g0.destroyed) basicWon = (contractKw(world, g0) * price.elecBasic * price.elecSurcharge) / 30;

  // ── 수리 완료 ──
  const failures = { ...g0.failures };
  for (const d of DEVICES) if (failures[d] > 0 && failures[d] <= hour) failures[d] = 0;
  const ok = (d: DeviceId) => failures[d] === 0;

  const tOut = wx.temp;
  const eOut = (wx.rh / 100) * satVp(tOut);
  const sun = world.clim.sun[day.di]!;

  // ── 지붕 적설, 강풍 ──
  const saving = curtainSaving(world, g0);
  let roofSnow = g0.roofSnow;
  let breached = g0.breached;
  let destroyed = g0.destroyed;
  if (!destroyed) {
    if (wx.precip > 0 && day.snowCm > 0 && day.rainHours > 0) roofSnow += day.snowCm / day.rainHours;
    const melt = ph.snowMeltOut * Math.max(tOut, 0) + ph.snowMeltIn * Math.max(g0.tIn, 0) * (1 - saving * g0.curtainPos);
    roofSnow = Math.max(0, roofSnow - melt - roofSnow * fac.snowShed * 0.05);
    if (roofSnow > fac.snowLimit) {
      destroyed = true;
      events.push({ hour, type: 'structure', level: 'warning', code: 'collapse', value: roofSnow });
    }
    const gustNow = day.wind > 0.05 ? (wx.wind * day.gust) / day.wind : day.gust;
    if (!breached && !destroyed && gustNow > fac.windLimit) {
      breached = true;
      events.push({ hour, type: 'structure', level: 'warning', code: 'breach', value: gustNow });
    }
  }

  if (destroyed) {
    // 무너진 시설: 실내 = 외기. 장비는 모두 멈춘다.
    const out = { ...emptyHour(), tIn: tOut, rhIn: wx.rh, vpd: satVp(tOut) - eOut, co2: ph.co2Outside, ppfd: wx.solarW * ph.parFraction * ph.parPhotonPerJoule, tLeaf: tOut, dewPoint: dewPoint(eOut), tSurface: tOut, tMass: tOut, tSolution: tOut, roofSnow: 0, transmissivity: 1 };
    const t2 = { ...today, tMin: Math.min(today.tMin, tOut), tMax: Math.max(today.tMax, tOut), tMean: today.tMean + tOut, rhMean: today.rhMean + wx.rh, dli: today.dli + (out.ppfd * 3600) / 1e6 };
    return { gh: { ...g0, tIn: tOut, vp: eOut, co2: ph.co2Outside, tMass: tOut, tSolution: tOut, roofSnow: 0, breached, destroyed, failures, dust, out, today: t2, yesterday, total, pendingLatent: 0 }, events, failureRng };
  }

  // ── 고정 계수 ──
  const h = fac.meanHeight;
  const lai = s.testLai;
  const fc = lai > 0 ? 1 - dexp(-ph.extinction * lai) : 0;
  const Ca = RHO_CP * h + (ph.airExtraCapacity + ph.canopyCapacityPerLai * lai) * 1000;
  const Cm = ph.thermalMass * 1000;
  const dbl = s.coverLayers === 2;
  const uCover = fac.uValue * (dbl ? ph.doubleCoverU : 1);
  const tau = fac.transmissivity * (dbl ? ph.doubleCoverTau : 1) * Math.max(0, 1 - fac.agingLoss * s.coverAge) * (1 - dust) * dexp(-roofSnow / ph.snowLightDepth);
  const curtainMat = eq.curtain.materials[s.curtainMaterial];
  const curtainVapor = s.curtainLayers > 0 ? dpow(curtainMat.vapor, s.curtainLayers) : 1;
  const shadeFrac = s.shade === 'none' ? 0 : eq.shade.screens[s.shade].shade;
  const netFactor = s.insectNet === 'none' ? 1 : eq.insectNet[s.insectNet].ventFactor;
  const ventArea = (s.sideVent ? fac.sideVentArea : 0) + (s.roofVent ? fac.roofVentArea : 0);
  const stackH = s.sideVent && s.roofVent && fac.sideVentArea > 0 && fac.roofVentArea > 0 ? fac.meanHeight * 0.5 : 1;
  const gInf = ((fac.leakage * h) / 3600) * (0.5 + 0.125 * wx.wind) + (breached ? (20 * h) / 3600 : 0);
  const rb = s.circFan && ok('circFan') ? ph.boundaryResistanceFan : ph.boundaryResistance;
  const fuelHeat = (s.fuel === 'taxFreeDiesel' || s.fuel === 'diesel' ? price.dieselHeat : price.keroseneHeat) * 1e6;
  const lightDev = s.light === 'none' ? null : eq.light[s.light];
  const isRaining = wx.precip > 0;
  const gustLike = wx.wind * 1.6;

  // ── 상태 ──
  let T = g0.tIn;
  let vp = g0.vp;
  let C = g0.co2;
  let Tm = g0.tMass;
  let Tsol = g0.tSolution;
  let ventPos = g0.ventPos;
  let curtainPos = g0.curtainPos;
  let shadePos = g0.shadePos;
  let heaterOn = g0.heaterOn;
  let pendingLatent = g0.pendingLatent;
  let dli = today.dli;

  const store0 = Ca * T + Cm * Tm;
  const w0 = absHumidity(vp, T) * h;
  const c0 = C * CO2_KG_PER_PPM * h;
  const acc = { t: 0, rh: 0, vpd: 0, co2: 0, ppfd: 0, tLeaf: 0, tSurf: 0, ach: 0, vent: 0, curtain: 0, shade: 0, heat: 0, cool: 0, fog: 0, dehum: 0, dose: 0, light: 0, heatW: 0, E: 0, cond: 0, wet: 0, deficit: 0, fuelJ: 0, elecJ: 0, co2Kg: 0, burnerL: 0, eIn: 0, eOut: 0, wIn: 0, wOut: 0, cIn: 0, cOut: 0 };
  const ran: Partial<Record<DeviceId, boolean>> = {};

  for (let k = 0; k < SUB; k++) {
    const t = hod + (k + 0.5) / SUB;
    const isDay = t >= sun.sunrise && t <= sun.sunset;
    const es = satVp(T);
    const rh = clamp((100 * vp) / es, 0, 100);

    // ════ 제어기 ════
    // 난방 설정온도: 시간대 프로그램 > 일출 전 > 주간/야간
    let heatSet = isDay ? c.heatDay : c.heatNight;
    if (t >= sun.sunrise - c.preDawnHours && t < sun.sunrise) heatSet = c.heatPreDawn;
    for (const b of c.blocks) if (inWindow(t, b.start, b.end)) heatSet = b.heat;

    // 보온커튼
    if (s.curtainLayers > 0 && ok('curtain')) {
      const nightSpan = t >= sun.sunset + c.curtainCloseOffset || t < sun.sunrise + c.curtainOpenOffset;
      curtainPos = nightSpan && tOut < c.curtainOutTemp ? 1 : 0;
    } else if (s.curtainLayers === 0) curtainPos = 0;

    // 차광막(히스테리시스 50 W/m²)
    if (s.shade !== 'none' && ok('shade')) {
      if (wx.solarW > c.shadeOnW) shadePos = 1;
      else if (wx.solarW < c.shadeOnW - 50) shadePos = 0;
    } else if (s.shade === 'none') shadePos = 0;

    // 냉방
    let padOn = false;
    let coolFrac = 0;
    if (s.cooling !== 'none' && ok('cooling')) {
      if (s.cooling === 'padfan') padOn = T > c.coolTemp;
      else coolFrac = clamp((T - c.coolTemp) / 2, 0, 1);
    }

    // 창: 온도 비례 + 습도 환기, 단계 개도, 이동 속도 제한, 강풍·강우 닫힘
    if (ventArea > 0 && ok('vent')) {
      const tempDemand = clamp((T - c.ventTemp) / (c.ventBand > 0.1 ? c.ventBand : 0.1), 0, 1) * (c.ventMax / 100);
      const useVentForHumidity = c.humidityPriority === 'vent' || !s.dehumidifier || !ok('dehumidifier');
      const humDemand = useVentForHumidity && rh > c.rhMax ? clamp((rh - c.rhMax) / 5, 0, 1) * (c.humidityVentMax / 100) : 0;
      let target = tempDemand > humDemand ? tempDemand : humDemand;
      const step = clamp(c.ventStep, 1, 100) / 100;
      target = Math.round(target / step) * step;
      if (target > 1) target = 1;
      if (gustLike > c.closeWind || (c.closeOnRain && isRaining) || padOn) target = 0;
      ventPos = ventPos + clamp(target - ventPos, -0.25, 0.25);
    } else if (ventArea === 0) ventPos = 0;

    // 난방은 다른 열원이 정해진 뒤 아래 "공기 절점"에서 결정한다(온풍기는 스텝 도중에 꺼질 수 있다)
    let heatFrac = 0;
    let qHeat = 0;

    // 포그
    const fogOn = s.fog && ok('fog') && rh < c.fogRhMax && (rh < c.rhMin || T > c.fogTemp);
    // 제습기
    const dehumOn = s.dehumidifier && ok('dehumidifier') && rh > c.rhMax && (c.humidityPriority === 'dehumidifier' || ventArea === 0);
    // 보광
    let lampOn = false;
    if (lightDev && ok('light') && c.lightMode !== 'off') {
      const inTime = c.lightMode === 'window' ? inWindow(t, c.lightStart, c.lightEnd) : t > sun.sunset && t < sun.sunrise + c.photoperiod;
      lampOn = inTime && wx.solarW < c.lightOffAboveW && (c.lightTargetDli <= 0 || dli < c.lightTargetDli);
    }

    // ════ 광 ════
    const iIn = wx.solarW * tau * (1 - shadeFrac * shadePos) * (1 - curtainMat.shade * curtainPos);
    const lampPpfd = lampOn ? s.lightPpfd : 0;
    const pLamp = lampOn && lightDev ? s.lightPpfd / lightDev.efficacy : 0;
    const lampRad = lampOn && lightDev ? pLamp * lightDev.radiantFraction : 0;
    const ppfd = iIn * ph.parFraction * ph.parPhotonPerJoule + lampPpfd;
    const aSw = ph.shortwaveAbsorbed * iIn;

    // ════ 피복면 온도와 외피 열손실 ════
    // 열저항 직렬: 실내 공기 —(안쪽 면 hi)— [닫힌 커튼] — 피복 안쪽 면 —(피복 + 바깥 면)— 외기
    // 피복면 열수지: 실내에서 오는 현열 + 결로 잠열 = 바깥으로 나가는 열.
    // 결로가 생기면 잠열이 피복을 데워서 면 온도가 오르고, 그만큼 결로와 현열 손실이 스스로 줄어든다.
    const uEff = uCover * (1 - saving * curtainPos);
    const hi = ph.innerSurfaceCoeff;
    const uC = uCover < 0.95 * hi ? uCover : 0.95 * hi;
    const hOut = 1 / (1 / uC - 1 / hi);
    const hIn = 1 / (1 / hi + (1 / uEff - 1 / uCover));
    const vaporToCover = (hi / RHO_CP) * (1 - (1 - curtainVapor) * curtainPos);
    const chiNow = absHumidity(vp, T);
    let sLo = T < tOut ? T : tOut;
    let sHi = T < tOut ? tOut : T;
    for (let i = 0; i < 18; i++) {
      const mid = (sLo + sHi) / 2;
      const excess = chiNow - absHumidity(satVp(mid), mid);
      const bal = hIn * (T - mid) + (excess > 0 ? LAMBDA * vaporToCover * excess : 0) - hOut * (mid - tOut);
      if (bal > 0) sLo = mid;
      else sHi = mid;
    }
    const tCover = (sLo + sHi) / 2;
    const qCov = hIn * (T - tCover);
    // 잎과 바닥이 "바라보는" 가장 안쪽 면(커튼이 닫혀 있으면 커튼)의 온도
    const tSurf = T - qCov / hi;
    const dT = T - tOut;
    const kCov = (dT > 0.05 || dT < -0.05 ? qCov / dT : uEff) * fac.coverRatio;

    // ════ 군락: 증산(Penman–Monteith)과 엽온 ════
    let lE = 0;
    let Hc = 0;
    let Lc = 0;
    let tLeaf = T;
    const vpd = es - vp > 0 ? es - vp : 0;
    if (lai > 0) {
      const aC = fc * (aSw + lampRad);
      Lc = Math.max(0, fc * ph.radiativeCoeff * (T - tSurf));
      const is = aC / (2 * lai);
      // 온도 항은 적온보다 더울 때만 적용한다(고온 기공 폐쇄). 저온 쪽까지 적용하면 겨울밤 증산이 사라져 실내가 비현실적으로 건조해진다.
      const dTs = T > ph.stomatalTempOpt ? T - ph.stomatalTempOpt : 0;
      const cs = (C > 1100 ? 1100 : C) - 200;
      const rs = ((ph.stomatalMin * (is + 4.3)) / (is + 0.54)) * (1 + ph.stomatalTemp * dTs * dTs) * (1 + ph.stomatalCo2 * cs * cs) * (1 + ph.stomatalVpd * vpd * vpd);
      const ra = rb / (2 * lai);
      const rc = rs / lai;
      const slope = satSlope(T);
      const rn = aC - Lc;
      lE = (slope * rn + (RHO_CP * vpd) / ra) / (slope + GAMMA * (1 + rc / ra));
      if (lE < 0) lE = 0;
      Hc = rn - lE;
      tLeaf = T + (Hc * ra) / RHO_CP;
    }
    let Lm = Math.max(0, (1 - fc) * ph.radiativeCoeff * (Tm - tSurf));
    // 복사로 피복에 넘어간 열은 U값에 이미 들어 있는 외피 손실의 일부다(이중 계산 방지).
    const envLoss = kCov * Math.max(T - tOut, 0);
    if (Lc + Lm > 0.7 * envLoss) {
      const f = Lc + Lm > 0 ? (0.7 * envLoss) / (Lc + Lm) : 0;
      if (lai > 0) {
        // 군락 복사 손실이 줄면 그만큼 현열이 늘어난다(증산은 그대로 둔다)
        Hc += Lc * (1 - f);
        tLeaf = T + (Hc * (rb / (2 * lai))) / RHO_CP;
      }
      Lc *= f;
      Lm *= f;
    }

    // ════ 환기량 (m³ m⁻² s⁻¹) ════
    const aOpen = ventArea * ventPos;
    const gWind = ph.dischargeCoeff * netFactor * (aOpen / 2) * Math.sqrt(ph.windCoeff) * wx.wind;
    const gStack = ph.dischargeCoeff * netFactor * (aOpen / 2) * Math.sqrt((2 * 9.81 * stackH * Math.abs(T - tOut)) / (T + 273.15));
    const gVent = Math.sqrt(gWind * gWind + gStack * gStack) + gInf;
    const gFan = padOn ? eq.cooling.padfan.airflow : 0;
    let tPad = tOut;
    let ePad = eOut;
    if (padOn) {
      const tw = wetBulb(tOut, eOut);
      tPad = tOut - eq.cooling.padfan.efficiency * (tOut - tw);
      ePad = eOut + eq.cooling.padfan.efficiency * (satVp(tw) - eOut);
    }

    // ════ 기타 발열·흡열 ════
    const eFog = fogOn ? (eq.fog.rate / 3.6e6) * eq.fog.evapFraction : 0; // kg m⁻² s⁻¹
    const dehum = dehumOn ? (eq.dehumidifier.rate / 3.6e6) * clamp((rh - eq.dehumidifier.minRh) / 20, 0, 1) : 0;
    const pDehum = dehum * eq.dehumidifier.energyPerKg * 3.6e6;
    const qCool = coolFrac * s.coolingCapacity;
    const pFan = s.circFan && ok('circFan') ? eq.circFan.power : 0;

    // ════ CO2 공급량 결정 ════
    const gAll = gVent + gFan;
    let uptake = 0; // kg m⁻² s⁻¹ (순흡수, 음수면 방출)
    if (lai > 0) {
      const fC = clamp((2 * (C - 50)) / (C + 300), 0, 2.2);
      const fT = clamp(1 - ((tLeaf - 25) / 18) * ((tLeaf - 25) / 18), 0, 1);
      const pMax = (ph.testCanopyAmax * fC * fT * fc) / ph.extinction;
      const gross = pMax > 0 ? pMax * (1 - dexp((-ph.testCanopyQuantumYield * ppfd * fc) / pMax)) : 0;
      const resp = ph.testCanopyRespiration * lai * dpow(2, (T - 25) / 10);
      uptake = (gross - resp) * KG_PER_UMOL_CO2;
    }
    let dose = 0;
    let burnerLps = 0;
    if (s.co2 !== 'none' && ok('co2') && inWindow(t, c.co2Start, c.co2End) && ventPos * 100 <= c.co2VentMax && C < c.co2Target) {
      const cap = eq.co2[s.co2].rate / 3.6e6;
      const need = (h * CO2_KG_PER_PPM * (c.co2Target - C)) / DT + gAll * CO2_KG_PER_PPM * (c.co2Target - ph.co2Outside) + (uptake > 0 ? uptake : 0);
      dose = clamp(need, 0, cap);
      if (s.co2 === 'burner') burnerLps = dose / eq.co2.burner.co2PerLiter;
    }
    const qBurner = burnerLps * price.keroseneHeat * 1e6 * eq.co2.burner.heatFraction;
    const wBurner = burnerLps * eq.co2.burner.waterPerLiter;

    // ════ 공기 절점: 지수 해 ════
    const floorSw = (1 - fc) * (aSw + lampRad);
    const latentBack = pendingLatent / DT;
    pendingLatent = 0;
    const srcBase = (pLamp - lampRad) + Hc + Lc + Lm + ph.floorDirectFraction * floorSw + LAMBDA * dehum + pDehum + qBurner + pFan + latentBack - LAMBDA * eFog - qCool;
    const kOut = kCov + RHO_CP * gVent;
    const kPad = RHO_CP * gFan;
    const kM = ph.massExchange;
    const kTot = kOut + kPad + kM;
    const x = (kTot * DT) / Ca;
    const decay = dexp(-x);
    const drive = kOut * tOut + kPad * tPad + kM * Tm;
    const endTemp = (q: number) => {
      const eqT = (srcBase + q + drive) / kTot;
      return eqT + (T - eqT) * decay;
    };
    if (s.heater !== 'none' && ok('heater')) {
      if (s.heater === 'heatpump' || s.heater === 'geothermal') {
        heatFrac = clamp((heatSet + 0.5 - T) / 1.5, 0, 1);
        heaterOn = heatFrac > 0;
      } else {
        if (T < heatSet - 0.5) heaterOn = true;
        else if (T > heatSet + 0.5) heaterOn = false;
        if (heaterOn) {
          // 온도조절기는 상한(설정 + 0.5°C)에 닿는 순간 버너를 끈다. 10분 스텝 안에서 그 시점까지만 가동한 것으로 본다.
          const full = endTemp(s.heaterCapacity);
          const none = endTemp(0);
          if (full > heatSet + 0.5) {
            heatFrac = full > none ? clamp((heatSet + 0.5 - none) / (full - none), 0, 1) : 0;
            heaterOn = false;
          } else heatFrac = 1;
        }
      }
    } else heaterOn = false;
    qHeat = heatFrac * s.heaterCapacity;
    const src = srcBase + qHeat;
    const tEq = (src + drive) / kTot;
    const tNew = tEq + (T - tEq) * decay;
    const tBar = tEq + ((T - tEq) * (1 - decay)) / x;

    // ════ 축열체 ════
    const qDeep = ph.deepConductance * (Tm - world.gh.deepTemp);
    const tmNew = Tm + (DT / Cm) * ((1 - ph.floorDirectFraction) * floorSw - Lm - kM * (Tm - tBar) - qDeep);

    // ════ 에너지 장부 (J m⁻²) ════
    acc.eIn += DT * (aSw + pLamp + qHeat + LAMBDA * dehum + pDehum + qBurner + pFan + latentBack);
    acc.eOut += DT * (lE + LAMBDA * eFog + qCool + kOut * (tBar - tOut) + kPad * (tBar - tPad) + qDeep);

    // ════ 수분 수지 (수증기 밀도 kg m⁻³, 지수 해) ════
    const chi = chiNow;
    const chiOut = absHumidity(eOut, tOut);
    const chiPad = absHumidity(ePad, tPad);
    const chiSurf = absHumidity(satVp(tCover), tCover);
    const condensing = chi > chiSurf;
    const gCond = condensing ? vaporToCover * fac.coverRatio : 0;
    const wSrc = lE / LAMBDA + eFog + wBurner - dehum;
    const kW = gVent + gFan + gCond;
    let chiNew: number;
    let chiBar: number;
    if (kW > 1e-9) {
      const chiEq = (wSrc + gVent * chiOut + gFan * chiPad + gCond * chiSurf) / kW;
      const xw = (kW * DT) / h;
      const dw = dexp(-xw);
      chiNew = chiEq + (chi - chiEq) * dw;
      chiBar = chiEq + ((chi - chiEq) * (1 - dw)) / xw;
    } else {
      chiNew = chi + (wSrc * DT) / h;
      chiBar = (chi + chiNew) / 2;
    }
    acc.wIn += DT * (lE / LAMBDA + eFog + wBurner);
    acc.wOut += DT * (dehum + gVent * (chiBar - chiOut) + gFan * (chiBar - chiPad) + gCond * (chiBar - chiSurf));
    const chiMax = absHumidity(satVp(tNew), tNew);
    let fogOut = false;
    if (chiNew > chiMax) {
      // 포화를 넘는 수증기는 물방울로 맺히고, 그 잠열은 다음 스텝에 공기로 돌아온다
      pendingLatent = LAMBDA * (chiNew - chiMax) * h;
      acc.wOut += (chiNew - chiMax) * h;
      chiNew = chiMax;
      fogOut = true;
    }
    const vpNew = vpFromAbs(chiNew, tNew);

    // ════ CO2 수지 (지수 해, 작물 흡수는 스텝 시작 농도 기준) ════
    const cSrc = (dose - uptake) / CO2_KG_PER_PPM; // ppm·m s⁻¹
    let cNew: number;
    let cBar: number;
    if (gAll > 1e-9) {
      const cEq = ph.co2Outside + cSrc / gAll;
      const xc = (gAll * DT) / h;
      const dc = dexp(-xc);
      cNew = cEq + (C - cEq) * dc;
      cBar = cEq + ((C - cEq) * (1 - dc)) / xc;
    } else {
      cNew = C + (cSrc * DT) / h;
      cBar = (C + cNew) / 2;
    }
    acc.cIn += DT * (dose + (uptake < 0 ? -uptake : 0));
    acc.cOut += DT * ((uptake > 0 ? uptake : 0) + gAll * CO2_KG_PER_PPM * (cBar - ph.co2Outside));

    // ════ 양액 온도 ════
    const sol = eq.solution;
    const chillOn = s.solutionChiller && ok('solutionChiller') && Tsol > c.solutionMax;
    const solHeatOn = s.solutionHeater && ok('solutionHeater') && Tsol < c.solutionMin;
    const cSol = sol.capacity * 1000;
    const qSol = (chillOn ? -sol.chiller.capacity : 0) + (solHeatOn ? sol.heater.capacity : 0);
    Tsol = Tsol + (DT / cSol) * ((cSol * (tBar - Tsol)) / (sol.airCoupling * 3600) + qSol);

    // ════ 소비 ════
    let fuelW = 0;
    let elecW = pLamp + pDehum + pFan + (fogOn ? eq.fog.power : 0) + (padOn ? eq.cooling.padfan.power : 0);
    if (qHeat > 0) {
      if (s.heater === 'oil') {
        fuelW += qHeat / eq.heater.oil.efficiency;
        elecW += qHeat * eq.heater.oil.blowerPower;
      } else if (s.heater === 'electric') elecW += qHeat / eq.heater.electric.efficiency;
      else if (s.heater === 'heatpump') elecW += qHeat / clamp(eq.heater.heatpump.copBase + eq.heater.heatpump.copSlope * (tOut + 10), 1.6, 4);
      else if (s.heater === 'geothermal') elecW += qHeat / eq.heater.geothermal.cop;
    }
    if (qCool > 0) elecW += qCool / eq.cooling.heatpump.cop;
    if (chillOn) elecW += sol.chiller.capacity / sol.chiller.cop;
    if (solHeatOn) elecW += sol.heater.capacity / sol.heater.efficiency;
    acc.fuelJ += fuelW * DT;
    acc.elecJ += elecW * DT;
    acc.co2Kg += s.co2 === 'liquid' ? dose * DT : 0;
    acc.burnerL += burnerLps * DT;

    // ════ 기록 ════
    const esNew = satVp(tNew);
    const rhNew = clamp((100 * vpNew) / esNew, 0, 100);
    const td = dewPoint(vpNew);
    const deficit = s.heater !== 'none' && (heatFrac >= 0.999 || !ok('heater')) && tNew < heatSet - 1;
    acc.t += tBar;
    acc.rh += rhNew;
    acc.vpd += esNew - vpNew > 0 ? esNew - vpNew : 0;
    acc.co2 += cNew;
    acc.ppfd += ppfd;
    acc.tLeaf += tLeaf;
    acc.tSurf += tCover;
    acc.ach += (gAll * 3600) / h;
    acc.vent += ventPos;
    acc.curtain += curtainPos;
    acc.shade += shadePos;
    acc.heat += heatFrac;
    acc.cool += padOn ? 1 : coolFrac;
    acc.fog += fogOn ? 1 : 0;
    acc.dehum += dehumOn ? 1 : 0;
    acc.dose += dose;
    acc.light += lampOn ? 1 : 0;
    acc.heatW += qHeat;
    acc.E += lE / LAMBDA;
    acc.cond += condensing || fogOut ? 1 : 0;
    acc.wet += lai > 0 && (tLeaf <= td || fogOut) ? 1 : 0;
    acc.deficit += deficit ? 1 : 0;
    dli += (ppfd * DT) / 1e6;

    if (ventPos > 0) ran.vent = true;
    if (curtainPos > 0) ran.curtain = true;
    if (shadePos > 0) ran.shade = true;
    if (pFan > 0) ran.circFan = true;
    if (fogOn) ran.fog = true;
    if (qHeat > 0) ran.heater = true;
    if (padOn || qCool > 0) ran.cooling = true;
    if (dose > 0) ran.co2 = true;
    if (lampOn) ran.light = true;
    if (dehumOn) ran.dehumidifier = true;
    if (chillOn) ran.solutionChiller = true;
    if (solHeatOn) ran.solutionHeater = true;

    T = tNew;
    vp = vpNew;
    C = cNew;
    Tm = tmNew;
  }

  // ── 고장(낮은 확률): 이번 시간에 가동한 장치들 가운데 하나가 고장 날 수 있다 ──
  const mtbf: Record<DeviceId, number> = {
    vent: eq.vent.mtbf,
    curtain: eq.curtain.motor.mtbf,
    shade: eq.shade.motor.mtbf,
    circFan: eq.circFan.mtbf,
    fog: eq.fog.mtbf,
    heater: s.heater === 'none' ? 1e9 : eq.heater[s.heater].mtbf,
    cooling: s.cooling === 'none' ? 1e9 : eq.cooling[s.cooling].mtbf,
    co2: s.co2 === 'none' ? 1e9 : eq.co2[s.co2].mtbf,
    light: s.light === 'none' ? 1e9 : eq.light[s.light].mtbf,
    dehumidifier: eq.dehumidifier.mtbf,
    solutionChiller: eq.solution.chiller.mtbf,
    solutionHeater: eq.solution.heater.mtbf,
  };
  let cum = 0;
  for (const d of DEVICES) {
    if (!ran[d] || failures[d] !== 0) continue;
    cum += 1 / mtbf[d];
    if (uFail < cum) {
      failures[d] = -1;
      events.push({ hour, type: 'equipment', level: 'warning', code: d, value: 0 });
      break;
    }
  }

  // ── 시간 요약과 비용 ──
  const n = SUB;
  const area = s.area;
  const fuelL = (acc.fuelJ / fuelHeat) * area + acc.burnerL * area;
  const kWh = (acc.elecJ * area) / 3.6e6;
  const co2Kg = acc.co2Kg * area;
  const heaterFuelL = (acc.fuelJ / fuelHeat) * area;
  const won = heaterFuelL * price[s.fuel] + acc.burnerL * area * price.taxFreeKerosene + kWh * (price.elecEnergy + price.elecLevy) * price.elecSurcharge + co2Kg * price.liquidCo2 + basicWon;
  const out = {
    tIn: acc.t / n,
    rhIn: acc.rh / n,
    vpd: acc.vpd / n,
    co2: acc.co2 / n,
    ppfd: acc.ppfd / n,
    tLeaf: acc.tLeaf / n,
    dewPoint: dewPoint(vp),
    tSurface: acc.tSurf / n,
    tMass: Tm,
    tSolution: Tsol,
    ach: acc.ach / n,
    vent: acc.vent / n,
    curtain: acc.curtain / n,
    shade: acc.shade / n,
    heat: acc.heat / n,
    cool: acc.cool / n,
    fog: acc.fog / n,
    dehum: acc.dehum / n,
    co2Dose: (acc.dose / n) * 3.6e6,
    light: acc.light / n,
    heatW: acc.heatW / n,
    transpiration: (acc.E / n) * 3.6e6,
    condensation: acc.cond / n,
    leafWet: acc.wet / n,
    heatDeficit: acc.deficit / n,
    roofSnow,
    transmissivity: tau,
    fuelL,
    kWh,
    co2Kg,
    won,
    eIn: acc.eIn,
    eOut: acc.eOut,
    eStore: Ca * T + Cm * Tm - store0,
    wIn: acc.wIn,
    wOut: acc.wOut,
    wStore: absHumidity(vp, T) * h - w0,
    cIn: acc.cIn,
    cOut: acc.cOut,
    cStore: C * CO2_KG_PER_PPM * h - c0,
  };
  const t2: GhDay = {
    ...today,
    tMin: Math.min(today.tMin, out.tIn),
    tMax: Math.max(today.tMax, out.tIn),
    tMean: today.tMean + out.tIn,
    rhMean: today.rhMean + out.rhIn,
    dli,
    condensationH: today.condensationH + out.condensation,
    leafWetH: today.leafWetH + out.leafWet,
    heatDeficitH: today.heatDeficitH + out.heatDeficit,
    fuelL: today.fuelL + fuelL,
    kWh: today.kWh + kWh,
    co2Kg: today.co2Kg + co2Kg,
    won: today.won + won,
  };
  total = { fuelL: total.fuelL + fuelL, kWh: total.kWh + kWh, co2Kg: total.co2Kg + co2Kg, won: total.won + won };

  return {
    gh: { ...g0, tIn: T, vp, co2: C, tMass: Tm, tSolution: Tsol, ventPos, curtainPos, shadePos, heaterOn, dust, roofSnow, breached, destroyed, failures, pendingLatent, out, today: t2, yesterday, total },
    events,
    failureRng,
  };
}
