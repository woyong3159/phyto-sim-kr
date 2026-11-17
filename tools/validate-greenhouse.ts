// Phase 2 검증(V3) 실행기: RUN=greenhouse npx vite-node tools/validate-greenhouse.ts → docs/VALIDATION_PHASE2.md
import { readFileSync, writeFileSync } from 'node:fs';
import { createInitialState, createWorld, defaultSettings, defaultSetup, stepHour, type ControlSettings, type EngineData, type GhHour, type GhSetup, type HourWx, type SimConfig, type SimState, type UserAction } from '../src/engine';

const load = (f: string) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8')).params;
export const data: EngineData = { regions: load('regions'), climate: load('climate'), events: load('events'), facilities: load('facilities'), equipment: load('equipment'), prices: load('prices'), crops: load('crops'), varieties: load('varieties') };

export interface Run {
  hours: { hour: number; hod: number; out: HourWx; gh: GhHour; month: number; day: number }[];
  final: SimState;
  events: string[];
}

export function run(opts: { regionId?: string; startDate: string; seed?: string; days: number; setup?: Partial<GhSetup>; settings?: Partial<ControlSettings>; actions?: UserAction[]; autoRepair?: boolean }): Run {
  const config: SimConfig = {
    seed: opts.seed ?? 'gh-validate',
    startDate: opts.startDate,
    regionId: opts.regionId ?? 'buyeo',
    setup: { ...defaultSetup(opts.setup?.facility ?? 'multi_pe'), testLai: 2, ...opts.setup },
    settings: { ...defaultSettings(), ...opts.settings },
  };
  const world = createWorld(config, data);
  let s = createInitialState(world);
  const hours: Run['hours'] = [];
  const events: string[] = [];
  const acts = opts.actions ?? [];
  const repairs: UserAction[] = [];
  for (let i = 0; i < opts.days * 24; i++) {
    const wx = s.weather.now;
    const d = s.weather.cur;
    const h = s.hour;
    s = stepHour(s, world, [...acts.filter((a) => a.hour === h), ...repairs.filter((a) => a.hour === h)]);
    hours.push({ hour: h, hod: h % 24, out: wx, gh: s.gh.out, month: d.month + 1, day: d.day });
    for (const e of s.events) {
      events.push(`${e.type}:${e.code}@${e.hour}`);
      // 고장은 다음 시각에 바로 수리를 맡긴다(관리자가 붙어 있는 농장 가정)
      if (e.type === 'equipment' && opts.autoRepair !== false) repairs.push({ hour: s.hour, seq: 0, type: 'gh/repair', payload: { device: e.code } });
    }
  }
  return { hours, final: s, events };
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const dailyMin = (r: Run, f: (h: Run['hours'][number]) => number) => {
  const out: number[] = [];
  for (let d = 0; d * 24 < r.hours.length; d++) out.push(Math.min(...r.hours.slice(d * 24, d * 24 + 24).map(f)));
  return out;
};
const dailyMax = (r: Run, f: (h: Run['hours'][number]) => number) => {
  const out: number[] = [];
  for (let d = 0; d * 24 < r.hours.length; d++) out.push(Math.max(...r.hours.slice(d * 24, d * 24 + 24).map(f)));
  return out;
};

const NO_HEAT: Partial<GhSetup> = { heater: 'none' };
const CLOSED: Partial<ControlSettings> = { ventTemp: 99, rhMax: 100, humidityVentMax: 0 };

/** ① 한겨울 야간 무가온: 커튼 0겹 vs 1겹 vs 2겹 */
export function scenario1(facility: GhSetup['facility'] = 'multi_pe') {
  const base = { startDate: '2026-01-01', days: 31, seed: 'gh-v1' };
  const mk = (layers: 0 | 1 | 2 | 3) => run({ ...base, setup: { facility, ...NO_HEAT, coverLayers: 1, curtainLayers: layers, curtainMaterial: 'multilayer' } });
  const r0 = mk(0), r1 = mk(1), r2 = mk(2);
  const outMin = dailyMin(r0, (h) => h.out.temp);
  return {
    outMin: mean(outMin),
    in0: mean(dailyMin(r0, (h) => h.gh.tIn)),
    in1: mean(dailyMin(r1, (h) => h.gh.tIn)),
    in2: mean(dailyMin(r2, (h) => h.gh.tIn)),
    coldest: { out: Math.min(...outMin), in0: Math.min(...dailyMin(r0, (h) => h.gh.tIn)), in2: Math.min(...dailyMin(r2, (h) => h.gh.tIn)) },
  };
}

/** ② 한여름 맑은 날 차광·환기 없음 */
export function scenario2() {
  const base = { regionId: 'daegu', startDate: '2026-07-25', days: 14, seed: 'gh-v2' };
  const sealed = run({ ...base, setup: { ...NO_HEAT, shade: 'none', sideVent: false, roofVent: false, curtainLayers: 0 } });
  const vented = run({ ...base, setup: { ...NO_HEAT, shade: 's55' } });
  const empty = run({ ...base, setup: { ...NO_HEAT, shade: 'none', sideVent: false, roofVent: false, curtainLayers: 0, testLai: 0 } });
  const clear = (r: Run) => dailyMax(r, (h) => h.out.solarW);
  const idx = clear(sealed).map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0])[0]![1];
  const dayMax = (r: Run, f: (h: Run['hours'][number]) => number) => dailyMax(r, f)[idx]!;
  return {
    outMax: dayMax(sealed, (h) => h.out.temp),
    solarMax: dayMax(sealed, (h) => h.out.solarW),
    sealedMax: dayMax(sealed, (h) => h.gh.tIn),
    emptyMax: dayMax(empty, (h) => h.gh.tIn),
    ventedMax: dayMax(vented, (h) => h.gh.tIn),
    sealedDaysOver40: dailyMax(sealed, (h) => h.gh.tIn).filter((v) => v >= 40).length,
    days: 14,
  };
}

/** ③ CO2 시비: 창 닫힘 vs 창 50% 고정 개방 */
export function scenario3() {
  const base = { startDate: '2026-03-10', days: 7, seed: 'gh-v3' };
  const co2: Partial<GhSetup> = { co2: 'liquid', heater: 'oil' };
  const closed = run({ ...base, setup: co2, settings: { ...CLOSED, co2Target: 800, co2VentMax: 100 } });
  // 환기 개시 온도를 아주 낮추고 최대 개도를 50%로 묶어 "항상 50% 개방"을 만든다
  const open = run({ ...base, setup: { ...co2, heater: 'none' }, settings: { ventTemp: -50, ventBand: 0.1, ventMax: 50, closeOnRain: false, closeWind: 99, co2Target: 800, co2VentMax: 100 } });
  const cut = run({ ...base, setup: { ...co2, heater: 'none' }, settings: { ventTemp: -50, ventBand: 0.1, ventMax: 50, closeOnRain: false, closeWind: 99, co2Target: 800, co2VentMax: 10 } });
  const none = run({ ...base, setup: { heater: 'oil' }, settings: CLOSED });
  const dayHours = (r: Run) => r.hours.filter((h) => h.hod >= 9 && h.hod < 15);
  const m = (r: Run) => ({ ppm: mean(dayHours(r).map((h) => h.gh.co2)), kgPerDay: r.final.gh.total.co2Kg / 7, vent: mean(dayHours(r).map((h) => h.gh.vent)), ach: mean(dayHours(r).map((h) => h.gh.ach)) });
  return { closed: m(closed), open: m(open), cut: m(cut), noDose: m(none) };
}

/** ④ 새벽 난방 직후 외기 저온 → 결로 */
export function scenario4() {
  const base = { startDate: '2026-02-01', days: 14, seed: 'gh-v4' };
  const heated = run({ ...base, setup: { heater: 'oil', heaterCapacity: 250 }, settings: { heatNight: 10, heatPreDawn: 16, preDawnHours: 3 } });
  const preDawn = heated.hours.filter((h) => h.hod >= 4 && h.hod < 9);
  const midday = heated.hours.filter((h) => h.hod >= 11 && h.hod < 15);
  const y = heated.final.gh;
  const cold = run({ ...base, setup: { heater: 'none' } });
  return {
    condPreDawn: mean(preDawn.map((h) => h.gh.condensation)),
    condMidday: mean(midday.map((h) => h.gh.condensation)),
    condHoursPerDay: heated.hours.reduce((a, h) => a + h.gh.condensation, 0) / 14,
    leafWetHoursPerDay: heated.hours.reduce((a, h) => a + h.gh.leafWet, 0) / 14,
    surfBelowDew: mean(preDawn.map((h) => h.gh.dewPoint - h.gh.tSurface)),
    rhPreDawn: mean(preDawn.map((h) => h.gh.rhIn)),
    fuelPerDay: y.total.fuelL / 14,
    unheated: { condHoursPerDay: cold.hours.reduce((a, h) => a + h.gh.condensation, 0) / 14, leafWetHoursPerDay: cold.hours.reduce((a, h) => a + h.gh.leafWet, 0) / 14, rhNight: mean(cold.hours.filter((h) => h.hod < 6).map((h) => h.gh.rhIn)) },
  };
}

/** ⑤ 장비 용량 부족 */
export function scenario5() {
  const base = { regionId: 'cheorwon', startDate: '2026-01-05', days: 14, seed: 'gh-v5', settings: { heatDay: 18, heatNight: 15, heatPreDawn: 15 } };
  const small = run({ ...base, setup: { heater: 'oil', heaterCapacity: 60, curtainLayers: 1, curtainMaterial: 'nonwoven' } });
  const big = run({ ...base, setup: { heater: 'oil', heaterCapacity: 350, curtainLayers: 1, curtainMaterial: 'nonwoven' } });
  const night = (r: Run) => r.hours.filter((h) => h.hod >= 22 || h.hod < 6);
  const m = (r: Run) => ({ nightMean: mean(night(r).map((h) => h.gh.tIn)), nightMin: Math.min(...night(r).map((h) => h.gh.tIn)), deficitH: r.hours.reduce((a, h) => a + h.gh.heatDeficit, 0) / 14, duty: mean(night(r).map((h) => h.gh.heat)), fuelPerDay: r.final.gh.total.fuelL / 14 });
  return { small: m(small), big: m(big), outNightMean: mean(night(small).map((h) => h.out.temp)) };
}

/** ⑥ 에너지 수지 오차 */
export function scenario6() {
  const cases: [string, Parameters<typeof run>[0]][] = [
    ['겨울 난방(부여 1월)', { startDate: '2026-01-01', days: 31, setup: { heater: 'oil' } }],
    ['여름 환기·포그·패드(대구 8월)', { regionId: 'daegu', startDate: '2026-08-01', days: 31, setup: { heater: 'none', fog: true, cooling: 'padfan' } }],
    ['보광·CO2·제습·히트펌프(대관령 11월)', { regionId: 'daegwallyeong', startDate: '2026-11-01', days: 30, setup: { facility: 'venlo', heater: 'heatpump', light: 'hps', co2: 'burner', dehumidifier: true }, settings: { lightMode: 'window', lightStart: 4, lightEnd: 20 } }],
    ['빈 온실 무가온(제주 4월)', { regionId: 'jeju', startDate: '2026-04-01', days: 30, setup: { heater: 'none', testLai: 0, facility: 'single_pe' } }],
  ];
  return cases.map(([name, o]) => {
    const r = run(o);
    let eIn = 0, eOut = 0, eStore = 0, worst = 0;
    for (const h of r.hours) {
      eIn += h.gh.eIn;
      eOut += h.gh.eOut;
      eStore += h.gh.eStore;
      const res = Math.abs(h.gh.eIn - h.gh.eOut - h.gh.eStore) / Math.max(Math.abs(h.gh.eIn) + Math.abs(h.gh.eOut), 1);
      if (res > worst) worst = res;
    }
    return { name, eInMJ: eIn / 1e6, eOutMJ: eOut / 1e6, storeMJ: eStore / 1e6, errorPct: (Math.abs(eIn - eOut - eStore) / Math.max(Math.abs(eIn), 1)) * 100, worstHourPct: worst * 100 };
  });
}

if (process.env.RUN === 'greenhouse') {
  const f1 = (v: number) => v.toFixed(1);
  const L: string[] = ['# Phase 2 검증 결과 (V3)', '', '이 파일은 `npx vite-node tools/validate-greenhouse.ts`가 자동으로 만든다. 날씨는 Phase 1 기상 생성기가 만든 것이고, 비교 대상끼리는 같은 seed(같은 날씨)를 쓴다.', '시험용 군락 LAI 2.0, 면적 1,000 m² 기준.', ''];

  L.push('## ① 한겨울 야간 무가온: 보온커튼 겹수별 실내 최저기온 (부여 1월, 31일 평균, 피복 1중)', '', '| 시설 | 외기 일최저 평균 | 커튼 없음 | 다겹 1겹 | 다겹 2겹 | 가장 추운 밤(외기 / 0겹 / 2겹) |', '|---|---|---|---|---|---|');
  for (const fac of ['single_pe', 'multi_pe', 'multi_po', 'venlo'] as const) {
    const s = scenario1(fac);
    L.push(`| ${{ single_pe: '단동 비닐', multi_pe: '연동 비닐', multi_po: '연동 PO', venlo: '벤로 유리' }[fac]} | ${f1(s.outMin)}°C | ${f1(s.in0)}°C (+${f1(s.in0 - s.outMin)}) | ${f1(s.in1)}°C (+${f1(s.in1 - s.outMin)}) | ${f1(s.in2)}°C (+${f1(s.in2 - s.outMin)}) | ${f1(s.coldest.out)} / ${f1(s.coldest.in0)} / ${f1(s.coldest.in2)}°C |`);
  }

  const s2 = scenario2();
  L.push('', '## ② 한여름 맑은 날, 차광·환기 없음 (대구 7월 말–8월 초, 가장 맑은 날)', '', `- 외기 최고 ${f1(s2.outMax)}°C, 최대 일사 ${s2.solarMax.toFixed(0)} W/m²`, `- 밀폐·무차광, 군락 있음(LAI 2): 실내 최고 **${f1(s2.sealedMax)}°C**`, `- 밀폐·무차광, 빈 온실(증산 없음): 실내 최고 **${f1(s2.emptyMax)}°C**`, `- 창 자동 + 차광 55%: 실내 최고 ${f1(s2.ventedMax)}°C`, `- 밀폐 상태로 14일 중 실내 40°C 이상인 날: ${s2.sealedDaysOver40}일`);

  const s3 = scenario3();
  L.push('', '## ③ CO2 시비와 환기 (부여 3월, 7일, 목표 800 ppm, 액화탄산 최대 10 g/m²/h)', '', '| 조건 | 낮(9–15시) 평균 농도 | 환기 횟수 | CO2 사용량 | 비용(500원/kg) |', '|---|---|---|---|---|');
  const row = (name: string, m: { ppm: number; kgPerDay: number; ach: number }) => `| ${name} | ${m.ppm.toFixed(0)} ppm | ${f1(m.ach)} 회/h | ${f1(m.kgPerDay)} kg/일 | ${(m.kgPerDay * 500).toFixed(0)}원/일 |`;
  L.push(row('시비 없음, 창 닫힘', s3.noDose), row('시비, 창 닫힘', s3.closed), row('시비, 창 50% 개방', s3.open), row('시비, 창 50% 개방 + "개도 10% 넘으면 중단"', s3.cut));

  const s4 = scenario4();
  L.push('', '## ④ 새벽 난방(일출 전 10→16°C)과 결로 (부여 2월, 14일)', '', `- 피복면 결로: 하루 평균 ${f1(s4.condHoursPerDay)}시간. 새벽(4–9시)에는 그 시간대의 ${(s4.condPreDawn * 100).toFixed(0)}%, 한낮(11–15시)에는 ${(s4.condMidday * 100).toFixed(0)}%`, `- 새벽 평균: 이슬점 − 피복면 온도 = ${f1(s4.surfBelowDew)}°C(양수면 결로), 실내 습도 ${s4.rhPreDawn.toFixed(0)}%`, `- 엽면 습윤: 하루 평균 ${f1(s4.leafWetHoursPerDay)}시간`, `- 난방유 ${f1(s4.fuelPerDay)} L/일 (1,000 m²)`, `- 비교: 같은 기간 무가온이면 결로 ${f1(s4.unheated.condHoursPerDay)}시간/일, 엽면 습윤 ${f1(s4.unheated.leafWetHoursPerDay)}시간/일, 밤(0–6시) 습도 ${s4.unheated.rhNight.toFixed(0)}%`);

  const s5 = scenario5();
  L.push('', '## ⑤ 장비 용량 부족 (철원 1월, 14일, 야간 설정 15°C, 부직포 1겹)', '', `외기 야간 평균 ${f1(s5.outNightMean)}°C`, '', '| 난방 용량 | 야간 실내 평균 | 야간 실내 최저 | 설정온도 미달 시간 | 야간 가동률 | 난방유 |', '|---|---|---|---|---|---|');
  L.push(`| 60 W/m² | ${f1(s5.small.nightMean)}°C | ${f1(s5.small.nightMin)}°C | ${f1(s5.small.deficitH)} h/일 | ${(s5.small.duty * 100).toFixed(0)}% | ${f1(s5.small.fuelPerDay)} L/일 |`, `| 350 W/m² | ${f1(s5.big.nightMean)}°C | ${f1(s5.big.nightMin)}°C | ${f1(s5.big.deficitH)} h/일 | ${(s5.big.duty * 100).toFixed(0)}% | ${f1(s5.big.fuelPerDay)} L/일 |`);

  L.push('', '## ⑥ 에너지 수지 오차 (기준 < 1%)', '', '| 시나리오 | 들어온 열 MJ/m² | 나간 열 MJ/m² | 저장 변화 MJ/m² | 기간 오차 | 시간별 최대 오차 |', '|---|---|---|---|---|---|');
  for (const c of scenario6()) L.push(`| ${c.name} | ${f1(c.eInMJ)} | ${f1(c.eOutMJ)} | ${c.storeMJ.toFixed(2)} | ${c.errorPct.toExponential(1)}% | ${c.worstHourPct.toExponential(1)}% |`);
  L.push('');
  writeFileSync(new URL('../docs/VALIDATION_PHASE2.md', import.meta.url), L.join('\n') + '\n');
  console.log(L.join('\n'));
}
