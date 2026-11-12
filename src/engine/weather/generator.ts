/**
 * 기상 생성기(Weather Generator).
 *
 * 일 단위 생성 → 시간 단위 분해의 2단계다.
 *  [일] 기준선(평년값 스플라인) + 확률 성분
 *    · 일평균기온 편차: ε_t = φ·ε_{t−1} + σ·z (AR(1)). 빠른 성분(종관 3–5일)과 느린 성분(2–4주 정체)의 합.
 *    · 강수 발생: 2상태 마르코프 체인. 강수일 비율 π는 평년값, 연속성 r = P(wet|wet) − P(wet|dry).
 *    · 비 오는 날: 일사↓ 습도↑ 일교차↓, 여름엔 서늘·겨울엔 덜 추움.
 *      맑은 날은 반대 방향으로 자동 보정해서 "월평균 = 평년값"이 유지된다.
 *    · 극한: 장마(연속성 강화), 태풍(확률 발생), 눈(기온으로 판정), 우박(확률 발생).
 *      폭염·한파는 따로 "발생시키지" 않고 생성된 기온 계열에서 기준 충족 여부를 판정한다.
 *  [시간] 기온: Parton & Logan(1981) — 낮은 사인 곡선, 밤은 지수 감쇠
 *         일사: 태양고도 사인값 비례 분배 / 습도: 하루 동안 수증기압(이슬점) 보존
 *
 * 난수는 'weather' 흐름에서 하루에 정확히 12개를 고정 순서로 뽑는다(분기와 무관).
 * 그래야 어떤 날 비가 오든 안 오든 그다음 날들의 난수 배열이 바뀌지 않는다.
 */
import { PI, dcos, dexp, dlog, dpow, dsin } from '../dmath';
import { nextFloat } from '../rng';
import { calendarAt } from '../time';
import type { DayWx, HourWx, RngState, SimEvent, WeatherGenState, WeatherState } from '../types';
import type { World } from '../world';
import { hourSinSum, sinElevation } from './astro';
import { MONTH_DAYS } from './climate';

const DRAWS_PER_DAY = 12;
const SPINUP_DAYS = 45;
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function draw(rng: RngState, n: number): [number[], RngState] {
  const out: number[] = [];
  let s = rng;
  for (let i = 0; i < n; i++) {
    const [v, next] = nextFloat(s);
    out.push(v);
    s = next;
  }
  return [out, s];
}

/** Box–Muller: 균등 난수 2개 → 표준정규 난수 2개. */
function normals(u1: number, u2: number): [number, number] {
  const r = Math.sqrt(-2 * dlog(u1 > 1e-12 ? u1 : 1e-12));
  return [r * dcos(2 * PI * u2), r * dsin(2 * PI * u2)];
}

/** 포화수증기압(kPa) — FAO-56 식 11(Tetens). */
export function satVp(t: number): number {
  return 0.6108 * dexp((17.27 * t) / (t + 237.3));
}

interface GenResult {
  day: DayWx;
  gen: WeatherGenState;
  weatherRng: RngState;
  eventsRng: RngState;
}

/** dayIndex 날의 일 기상을 만든다. */
export function generateDay(world: World, genIn: WeatherGenState, weatherRng: RngState, eventsRngIn: RngState, dayIndex: number): GenResult {
  const { clim, gen: g, ev, region } = world;
  const cal = calendarAt(world.config, dayIndex * 24);
  const month = cal.month - 1;
  const di = MONTH_START[month]! + (cal.day > MONTH_DAYS[month]! ? MONTH_DAYS[month]! : cal.day) - 1;
  const [u, rngOut] = draw(weatherRng, DRAWS_PER_DAY);
  const gen: WeatherGenState = { ...genIn };

  // 해가 바뀌면 그 해의 장마 시작·종료일을 정한다('events' 흐름).
  let eventsRng = eventsRngIn;
  if (gen.jangmaYear !== cal.year) {
    const [ue, r2] = draw(eventsRng, 2);
    eventsRng = r2;
    const [z1, z2] = normals(ue[0]!, ue[1]!);
    const start = Math.round(ev.jangmaStart + ev.jangmaSd * z1) - 1;
    const end = Math.round(ev.jangmaEnd + ev.jangmaSd * z2) - 1;
    gen.jangmaYear = cal.year;
    gen.jangmaStart = start;
    gen.jangmaEnd = end < start + 10 ? start + 10 : end;
  }
  const jangma = di >= gen.jangmaStart && di <= gen.jangmaEnd;

  const [zf, zs] = normals(u[0]!, u[1]!);
  const [zd, zr] = normals(u[2]!, u[3]!);

  // ── 기온 편차 AR(1) ──
  const sd = g.tempSd[month]!;
  const sdFast = sd * Math.sqrt(1 - g.slowShare);
  const sdSlow = sd * Math.sqrt(g.slowShare);
  gen.epsFast = g.arFastPhi * gen.epsFast + sdFast * Math.sqrt(1 - g.arFastPhi * g.arFastPhi) * zf;
  gen.epsSlow = g.arSlowPhi * gen.epsSlow + sdSlow * Math.sqrt(1 - g.arSlowPhi * g.arSlowPhi) * zs;

  // ── 태풍 ──
  let typhoon = false;
  let typhoonFirst = false;
  if (gen.typhoonLeft > 0) {
    typhoon = true;
    gen.typhoonLeft -= 1;
  } else if (u[8]! < (ev.typhoonMonthly[month]! * region.typhoonWeight) / MONTH_DAYS[month]!) {
    typhoon = true;
    typhoonFirst = true;
    gen.typhoonLeft = 1;
  }

  // ── 강수 발생(마르코프) ──
  const pi = clim.wetFrac[di]!;
  const r = jangma ? g.wetPersistenceJangma : g.wetPersistence;
  const pWet = gen.wetPrev ? r + pi * (1 - r) : pi * (1 - r);
  const wet = typhoon || u[4]! < pWet;
  gen.wetPrev = wet;

  // ── 강수량(Weibull) ──
  let precip = 0;
  if (wet) {
    const mean = clim.wetMean[di]! - 0.1;
    precip = 0.1 + ((mean > 0.1 ? mean : 0.1) * dpow(-dlog(u[5]! > 1e-12 ? u[5]! : 1e-12), 1 / g.precipShape)) / g.precipGamma;
    if (typhoonFirst) {
      // Weibull(k=1.5): Γ(1 + 1/1.5) = 0.9027
      const tr = (ev.typhoonRainMean * (0.5 + region.typhoonWeight) * dpow(-dlog(u[11]! > 1e-12 ? u[11]! : 1e-12), 1 / 1.5)) / 0.9027;
      if (tr > precip) precip = tr;
    }
  }

  // 맑은 날 보정 배율: 월평균이 평년값으로 유지되게 한다(태풍일까지 포함한 전체 강수일 확률 기준).
  const piA = clim.wetFracAll[di]!;
  const dryShare = 1 - piA;

  // ── 기온 ──
  const off = g.wetTempOffset[month]!;
  const tavg = clim.tavg[di]! + gen.epsFast + gen.epsSlow + (wet ? off : (-off * piA) / dryShare);
  const dtrBase = wet ? g.wetDtrFactor : (1 - piA * g.wetDtrFactor) / dryShare;
  const dtrF = dtrBase * clamp(1 + g.dtrNoiseSd * zd, 0.5, 1.5);
  const tmax = tavg + clim.up[di]! * dtrF;
  const tmin = tavg - clim.down[di]! * dtrF;

  // ── 습도 ──
  const rh = clamp(clim.rh[di]! + (wet ? g.wetRhOffset : (-g.wetRhOffset * piA) / dryShare) + g.rhNoiseSd * zr, 15, 99);

  // ── 일사 ──
  const base = clim.solar[di]!;
  const rso = clim.rso[di]!;
  const dryMax = (0.92 * rso) / base;
  const ksNeeded = (1 - dryMax * dryShare) / piA;
  const ks = clamp(ksNeeded > g.wetSolarFactor ? ksNeeded : g.wetSolarFactor, 0.05, 1);
  const dryF = (1 - piA * ks) / dryShare;
  const sf = wet ? ks : dryF;
  const headroom = rso / (base * sf) - 1;
  const amp = clamp(headroom < g.solarNoise ? headroom : g.solarNoise, 0, g.solarNoise);
  let solar = base * sf * (1 + amp * (2 * u[6]! - 1));
  // 태풍일은 '비 오는 날' 배율만 적용한다(추가 감광을 넣으면 7–9월 월평균 일사가 평년값보다 2–4% 낮아진다).
  solar = clamp(solar, 0.03 * clim.sun[di]!.ra, rso);

  // ── 바람(Rayleigh, 평균 1) ──
  let wind = (clim.wind[di]! * Math.sqrt(-dlog(u[7]! > 1e-12 ? u[7]! : 1e-12))) / 0.886227;
  let gust = wind * 1.8;
  if (typhoon) {
    const f = ev.typhoonWindFactor * (0.5 + region.typhoonWeight) * (typhoonFirst ? 1 : 0.6);
    wind = (wind > clim.wind[di]! ? wind : clim.wind[di]!) * (f > 1 ? f : 1);
    gust = wind * ev.typhoonGustFactor;
  }

  // ── 눈 ──
  const snowFrac = clamp((g.snowTempNone - tavg) / (g.snowTempNone - g.snowTempFull), 0, 1);
  const snowCm = precip * snowFrac * g.snowRatio;

  // ── 우박 ──
  const hail = u[9]! < (ev.hailAnnualDays * ev.hailMonthlyWeight[month]!) / MONTH_DAYS[month]!;

  // ── 비 오는 시간대 ──
  const rainHours = wet ? clamp(Math.round(2 + precip / 3), 1, 24) : 0;
  const rainStart = wet ? Math.floor(u[10]! * (24 - rainHours + 1)) : 0;

  return {
    day: { dayIndex, year: cal.year, month, day: cal.day, di, tavg, tmax, tmin, rh, ea: 0, solar, precip, wind, gust, snowCm, wet, typhoon, hail, jangma, rainStart, rainHours },
    gen,
    weatherRng: rngOut,
    eventsRng,
  };
}

/**
 * Parton & Logan(1981) 낮 구간: 일출 후 m시간의 기온.
 * 원식의 사인 항에 형상 지수 γ를 씌웠다(CAL). 원식 그대로는 낮이 긴 여름에 일평균이 평년 평균기온보다
 * 0.5–0.7°C 높게 나온다. γ는 최고·최저기온은 그대로 두고 곡선의 "배부름"만 조절해 일평균을 맞춘다.
 */
function dayTemp(world: World, d: DayWx, m: number): number {
  const sun = world.clim.sun[d.di]!;
  const s = dsin((PI * m) / (sun.daylength + 2 * world.gen.plA));
  return d.tmin + (d.tmax - d.tmin) * (s <= 0 ? 0 : dpow(s, world.clim.shape[d.di]!));
}

/** hourOfDay 시각부터 1시간의 기온(시간 중앙값). */
export function hourTemp(world: World, w: Pick<WeatherState, 'prev' | 'cur' | 'next'>, hourOfDay: number): number {
  const { clim, gen: g } = world;
  const d = w.cur;
  const sun = clim.sun[d.di]!;
  const t = hourOfDay + 0.5;
  const rise = sun.sunrise + g.plC;
  const set = sun.sunset;
  const eb = dexp(-g.plB);
  const gamma = clim.shape[d.di]!;
  // 원식은 밤이 끝나도 최저기온에 닿지 않는다. 일출 무렵 정확히 최저기온이 되도록 감쇠항을 정규화했다.
  const night = (tSet: number, tMinNext: number, n: number, z: number) => {
    const e = (dexp((-g.plB * n) / z) - eb) / (1 - eb);
    return tMinNext + (tSet - tMinNext) * (e <= 0 ? 0 : dpow(e, gamma));
  };
  if (t >= rise && t <= set) return dayTemp(world, d, t - rise);
  if (t > set) {
    const nextSun = clim.sun[w.next.di]!;
    const z = 24 - set + (nextSun.sunrise + g.plC);
    return night(dayTemp(world, d, set - rise), w.next.tmin, t - set, z);
  }
  const prevSun = clim.sun[w.prev.di]!;
  const pSet = prevSun.sunset;
  const pRise = prevSun.sunrise + g.plC;
  const z = 24 - pSet + rise;
  return night(dayTemp(world, w.prev, pSet - pRise), d.tmin, t + 24 - pSet, z);
}

/**
 * 오늘의 수증기압을 정한다: 하루 동안 수증기압(이슬점)이 일정하다고 보고,
 * 24시간 상대습도의 평균이 생성된 일평균 습도와 같아지는 값을 찾는다(포화 시 100%로 잘리는 것까지 반영).
 */
export function withVaporPressure<T extends Pick<WeatherState, 'prev' | 'cur' | 'next'>>(world: World, w: T): T {
  const inv: number[] = [];
  for (let h = 0; h < 24; h++) inv.push(1 / satVp(hourTemp(world, w, h)));
  let ea = w.cur.rh / 100 / (inv.reduce((a, b) => a + b, 0) / 24);
  for (let iter = 0; iter < 8; iter++) {
    let m = 0;
    for (const v of inv) m += ea * v > 1 ? 1 : ea * v;
    ea *= w.cur.rh / 100 / (m / 24);
  }
  return { ...w, cur: { ...w.cur, ea } };
}

/** hourOfDay 시각부터 1시간의 외기(시간 중앙값 기준). */
export function hourWx(world: World, w: Pick<WeatherState, 'prev' | 'cur' | 'next'>, hourOfDay: number): HourWx {
  const { clim, gen: g } = world;
  const d = w.cur;
  const sun = clim.sun[d.di]!;
  const t = hourOfDay + 0.5;
  const temp = hourTemp(world, w, hourOfDay);

  // 일사: 태양고도 사인 분배
  const frac = hourSinSum(sun, hourOfDay) / clim.sinSum[d.di]!;
  const solarMJ = d.solar * frac;

  // 습도: 하루 동안 수증기압(이슬점) 보존
  const raining = d.wet && hourOfDay >= d.rainStart && hourOfDay < d.rainStart + d.rainHours;
  const rh = clamp((100 * d.ea) / satVp(temp), 5, 100);

  // 바람: 오후 2시 무렵 최대
  const wind = d.wind * (1 + g.windDiurnalAmp * dcos((PI / 12) * (t - 14)));

  return {
    temp,
    rh,
    solarMJ,
    solarW: (solarMJ * 1e6) / 3600,
    wind: wind > 0 ? wind : 0,
    precip: raining ? d.precip / d.rainHours : 0,
    sinElev: sinElevation(sun, t),
  };
}

/** 새 날(cur)이 시작될 때 특보성 사건을 판정한다. */
export function detectDayEvents(world: World, w: WeatherState, hour: number): { events: SimEvent[]; streaks: Pick<WeatherState, 'heatStreak' | 'heatWarnStreak' | 'coldStreak' | 'coldWarnStreak'> } {
  const { ev } = world;
  const d = w.cur;
  const events: SimEvent[] = [];
  const heatStreak = d.tmax >= ev.heatAdvisory ? w.heatStreak + 1 : 0;
  const heatWarnStreak = d.tmax >= ev.heatWarning ? w.heatWarnStreak + 1 : 0;
  const coldStreak = d.tmin <= ev.coldAdvisory ? w.coldStreak + 1 : 0;
  const coldWarnStreak = d.tmin <= ev.coldWarning ? w.coldWarnStreak + 1 : 0;

  if (heatWarnStreak === 2) events.push({ hour, type: 'heatwave', level: 'warning', code: 'warning', value: d.tmax });
  else if (heatStreak === 2) events.push({ hour, type: 'heatwave', level: 'advisory', code: 'advisory', value: d.tmax });
  if (coldWarnStreak === 2) events.push({ hour, type: 'coldwave', level: 'warning', code: 'warning', value: d.tmin });
  else if (coldStreak === 2) events.push({ hour, type: 'coldwave', level: 'advisory', code: 'advisory', value: d.tmin });

  if (d.jangma && !w.prev.jangma) events.push({ hour, type: 'jangma', level: 'info', code: 'start', value: 0 });
  if (!d.jangma && w.prev.jangma) events.push({ hour, type: 'jangma', level: 'info', code: 'end', value: 0 });
  if (d.typhoon && !w.prev.typhoon) events.push({ hour, type: 'typhoon', level: 'warning', code: 'approach', value: d.gust });
  else if (d.precip >= ev.heavyRain) events.push({ hour, type: 'heavyRain', level: 'advisory', code: 'advisory', value: d.precip });
  if (d.snowCm >= ev.snowWarning) events.push({ hour, type: 'heavySnow', level: 'warning', code: 'warning', value: d.snowCm });
  else if (d.snowCm >= ev.snowAdvisory) events.push({ hour, type: 'heavySnow', level: 'advisory', code: 'advisory', value: d.snowCm });
  if (d.hail) events.push({ hour, type: 'hail', level: 'advisory', code: 'hail', value: 0 });

  return { events, streaks: { heatStreak, heatWarnStreak, coldStreak, coldWarnStreak } };
}

/** 작기 시작 시점의 기상 상태. 시작일 45일 전부터 미리 돌려(spin-up) 편차·강수 상태를 자연스럽게 만든다. */
export function initWeather(world: World, weatherRng: RngState, eventsRng: RngState): { weather: WeatherState; weatherRng: RngState; eventsRng: RngState; events: SimEvent[] } {
  let gen: WeatherGenState = { epsFast: 0, epsSlow: 0, wetPrev: false, typhoonLeft: 0, jangmaYear: -1, jangmaStart: 0, jangmaEnd: 0 };
  let wr = weatherRng;
  let er = eventsRng;
  const days: DayWx[] = [];
  for (let i = -SPINUP_DAYS; i <= 1; i++) {
    const r = generateDay(world, gen, wr, er, i);
    gen = r.gen;
    wr = r.weatherRng;
    er = r.eventsRng;
    days.push(r.day);
  }
  const n = days.length;
  const base = withVaporPressure(world, { gen, prev: days[n - 3]!, cur: days[n - 2]!, next: days[n - 1]! });
  let w: WeatherState = { ...base, now: hourWx(world, base, 0), heatStreak: 0, heatWarnStreak: 0, coldStreak: 0, coldWarnStreak: 0 };
  // 시작 전날까지의 연속 일수를 반영한다(시작일에 이미 폭염 3일째일 수 있다).
  let heat = 0;
  let heatW = 0;
  let cold = 0;
  let coldW = 0;
  for (let i = 0; i < n - 2; i++) {
    const d = days[i]!;
    heat = d.tmax >= world.ev.heatAdvisory ? heat + 1 : 0;
    heatW = d.tmax >= world.ev.heatWarning ? heatW + 1 : 0;
    cold = d.tmin <= world.ev.coldAdvisory ? cold + 1 : 0;
    coldW = d.tmin <= world.ev.coldWarning ? coldW + 1 : 0;
  }
  w = { ...w, heatStreak: heat, heatWarnStreak: heatW, coldStreak: cold, coldWarnStreak: coldW };
  const det = detectDayEvents(world, w, 0);
  return { weather: { ...w, ...det.streaks }, weatherRng: wr, eventsRng: er, events: det.events };
}
