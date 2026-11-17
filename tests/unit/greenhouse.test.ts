import { describe, expect, it } from 'vitest';
import { createInitialState, defaultSettings, defaultSetup, fingerprint, stepHour, type SimState, type UserAction } from '../../src/engine';
import { absHumidity, dewPoint, satVp, wetBulb } from '../../src/engine/greenhouse/psychro';
import { curtainSaving, stepGreenhouse } from '../../src/engine/greenhouse/model';
import { run, scenario1, scenario2, scenario3, scenario4, scenario5, scenario6 } from '../../tools/validate-greenhouse';
import { worldOf } from './helpers';

describe('습공기 계산(V1)', () => {
  it('포화수증기압: 0°C 0.611, 20°C 2.34, 30°C 4.24 kPa', () => {
    expect(satVp(0)).toBeCloseTo(0.611, 3);
    expect(satVp(20)).toBeCloseTo(2.338, 2);
    expect(satVp(30)).toBeCloseTo(4.243, 2);
  });
  it('이슬점은 포화수증기압의 역함수', () => {
    for (const t of [-10, 0, 7.5, 15, 25, 35]) expect(dewPoint(satVp(t))).toBeCloseTo(t, 6);
    // 20°C, 상대습도 50% → 이슬점 약 9.3°C
    expect(dewPoint(0.5 * satVp(20))).toBeCloseTo(9.3, 0);
  });
  it('습구온도: 포화면 건구와 같고, 30°C·40%면 약 20°C', () => {
    expect(wetBulb(25, satVp(25))).toBeCloseTo(25, 3);
    const tw = wetBulb(30, 0.4 * satVp(30));
    expect(tw).toBeGreaterThan(19.5);
    expect(tw).toBeLessThan(21);
  });
  it('절대습도: 20°C 포화 약 17.3 g/m³', () => {
    expect(absHumidity(satVp(20), 20) * 1000).toBeCloseTo(17.3, 0);
  });
  it('보온커튼: 1겹은 자재 보온율 그대로, 겹이 늘수록 커지되 효과는 줄어든다(열저항 직렬)', () => {
    const w = worldOf({});
    const gh = (layers: 0 | 1 | 2 | 3) => ({ ...createInitialState(w).gh, setup: { ...defaultSetup(), curtainLayers: layers, curtainMaterial: 'aluminum' as const } });
    const s = [0, 1, 2, 3].map((n) => curtainSaving(w, gh(n as 0 | 1 | 2 | 3)));
    expect(s[0]).toBe(0);
    expect(s[1]).toBeCloseTo(0.4, 6);
    expect(s[2]! - s[1]!).toBeLessThan(s[1]! - s[0]!);
    expect(s[3]! - s[2]!).toBeLessThan(s[2]! - s[1]!);
    expect(s[3]).toBeLessThan(0.75);
  });
});

describe('온실 모델 — 물리 타당성(V2)', () => {
  const r = run({ regionId: 'daegu', startDate: '2026-05-01', days: 60, setup: { fog: true, co2: 'liquid', dehumidifier: true, light: 'led', cooling: 'padfan' }, settings: { lightMode: 'window', lightStart: 4, lightEnd: 8, co2VentMax: 100 } });

  it('범위: 습도 0–100%, CO2·광·환기량 ≥ 0, 값이 모두 유한', () => {
    for (const h of r.hours) {
      const g = h.gh;
      expect(g.rhIn).toBeGreaterThanOrEqual(0);
      expect(g.rhIn).toBeLessThanOrEqual(100);
      expect(g.co2).toBeGreaterThan(40);
      expect(g.ppfd).toBeGreaterThanOrEqual(0);
      expect(g.ach).toBeGreaterThanOrEqual(0);
      expect(g.vpd).toBeGreaterThanOrEqual(0);
      for (const v of Object.values(g)) expect(Number.isFinite(v)).toBe(true);
      expect(g.dewPoint).toBeLessThanOrEqual(g.tIn + 4);
    }
  });

  it('질량 보존: 물 수지와 CO2 수지 오차 < 1% (60일, 포그·제습·패드·시비 모두 가동)', () => {
    let wIn = 0, wOut = 0, wStore = 0, cIn = 0, cOut = 0, cStore = 0;
    for (const h of r.hours) {
      wIn += h.gh.wIn; wOut += h.gh.wOut; wStore += h.gh.wStore;
      cIn += h.gh.cIn; cOut += h.gh.cOut; cStore += h.gh.cStore;
    }
    expect(wIn).toBeGreaterThan(50);
    expect(Math.abs(wIn - wOut - wStore) / wIn).toBeLessThan(0.01);
    expect(Math.abs(cIn - cOut - cStore) / Math.max(cIn, cOut)).toBeLessThan(0.01);
  });

  it('실내 광은 외부 광보다 적고(보광 없는 낮), 투과율이 0–1', () => {
    const noLamp = run({ startDate: '2026-04-01', days: 5 });
    for (const h of noLamp.hours) {
      expect(h.gh.transmissivity).toBeGreaterThan(0);
      expect(h.gh.transmissivity).toBeLessThan(1);
      expect(h.gh.ppfd).toBeLessThanOrEqual(h.out.solarW * 0.47 * 4.57 + 1e-6);
    }
  });

  it('밤에 잎은 공기보다 차고(복사 냉각), 낮에 증산이 훨씬 많다', () => {
    const rr = run({ startDate: '2026-04-10', days: 10, setup: { heater: 'none' } });
    const night = rr.hours.filter((h) => h.hod <= 3);
    const noon = rr.hours.filter((h) => h.hod >= 11 && h.hod <= 14);
    const m = (a: typeof night, f: (h: (typeof night)[number]) => number) => a.reduce((p, h) => p + f(h), 0) / a.length;
    expect(m(night, (h) => h.gh.tLeaf - h.gh.tIn)).toBeLessThan(0);
    expect(m(noon, (h) => h.gh.transpiration)).toBeGreaterThan(5 * m(night, (h) => h.gh.transpiration));
    // 한낮 증산: 맑은 봄날 군락(LAI 2) 100–400 g m⁻² h⁻¹ 수준
    expect(m(noon, (h) => h.gh.transpiration)).toBeGreaterThan(60);
    expect(m(noon, (h) => h.gh.transpiration)).toBeLessThan(450);
  });
});

describe('제어와 장비', () => {
  it('난방: 설정온도 근처(±1°C)로 유지되고, 설정을 올리면 용량만큼만 천천히 따라간다(지연)', () => {
    const base = { regionId: 'buyeo', startDate: '2026-01-10', days: 5, seed: 'ctl' };
    const hold = run({ ...base, setup: { heater: 'oil', heaterCapacity: 300 }, settings: { heatDay: 15, heatNight: 15, heatPreDawn: 15 } });
    const night = hold.hours.filter((h) => h.hod >= 22 || h.hod < 5).map((h) => h.gh.tIn);
    const mean = night.reduce((a, b) => a + b, 0) / night.length;
    expect(mean).toBeGreaterThan(14.3);
    expect(mean).toBeLessThan(15.6);
    expect(Math.max(...night)).toBeLessThan(16.2);

    // 새벽 2시에 설정을 12 → 22°C로 올린다. 용량이 작으면(120 W/m²) 첫 한 시간에 다 못 올린다.
    const step = (cap: number) => {
      const r = run({ ...base, days: 2, setup: { heater: 'oil', heaterCapacity: cap }, settings: { heatDay: 12, heatNight: 12, heatPreDawn: 12 }, actions: [{ hour: 26, seq: 0, type: 'gh/control', payload: { ...defaultSettings(), heatDay: 22, heatNight: 22, heatPreDawn: 22 } }] });
      return r.hours.slice(26, 32).map((h) => h.gh.tIn);
    };
    const small = step(120);
    const big = step(400);
    expect(small[0]).toBeLessThan(big[0]!);
    expect(small[0]).toBeLessThan(20);
    expect(big[2]).toBeGreaterThan(20.5);
    expect(Math.max(...big)).toBeLessThan(23.2);
  });

  it('환기: 비례대와 개폐 속도 제한 때문에 맑은 날 실내가 환기 개시 온도를 넘어선다(오버슈트)', () => {
    const r = run({ regionId: 'daegu', startDate: '2026-05-01', days: 10, seed: 'ctl', setup: { heater: 'none', shade: 'none' }, settings: { ventTemp: 25, ventBand: 5 } });
    const max = Math.max(...r.hours.map((h) => h.gh.tIn));
    expect(max).toBeGreaterThan(26);
    expect(max).toBeLessThan(40);
    expect(Math.max(...r.hours.map((h) => h.gh.vent))).toBeGreaterThan(0.5);
  });

  it('설정값 변경·세척·수리 조치가 그 시각부터 반영된다', () => {
    const w = worldOf({ startDate: '2026-01-10', setup: { ...defaultSetup(), heater: 'oil' } });
    const actions: UserAction[] = [{ hour: 30, seq: 0, type: 'gh/control', payload: { ...defaultSettings(), heatNight: 20, heatDay: 20, heatPreDawn: 20 } }];
    let s = createInitialState(w);
    const temps: number[] = [];
    for (let i = 0; i < 48; i++) {
      s = stepHour(s, w, actions.filter((a) => a.hour === s.hour));
      temps.push(s.gh.out.tIn);
    }
    expect(Math.max(...temps.slice(24, 30))).toBeLessThan(16.5);
    expect(temps.slice(34, 48).reduce((a, b) => a + b, 0) / 14).toBeGreaterThan(17.5);
    expect(s.gh.settings.heatNight).toBe(20);

    const dirty = { ...s, gh: { ...s.gh, dust: 0.1 } };
    expect(stepHour(dirty, w, [{ hour: dirty.hour, seq: 0, type: 'gh/clean', payload: null }]).gh.dust).toBeLessThan(0.001);
  });

  it('고장 난 난방기는 열을 내지 못하고, 수리를 맡기면 정해진 시간 뒤 복구된다', () => {
    const w = worldOf({ startDate: '2026-01-10', setup: { ...defaultSetup(), heater: 'oil' } });
    let s = createInitialState(w);
    for (let i = 0; i < 3; i++) s = stepHour(s, w, []);
    s = { ...s, gh: { ...s.gh, failures: { ...s.gh.failures, heater: -1 } } };
    for (let i = 0; i < 4; i++) s = stepHour(s, w, []);
    expect(s.gh.out.heatW).toBe(0);
    expect(s.gh.failures.heater).toBe(-1);
    const repairAt = s.hour;
    s = stepHour(s, w, [{ hour: s.hour, seq: 0, type: 'gh/repair', payload: { device: 'heater' } }]);
    expect(s.gh.failures.heater).toBe(repairAt + w.gh.eq.heater.oil.repairHours);
    for (let i = 0; i < w.gh.eq.heater.oil.repairHours + 3; i++) s = stepHour(s, w, []);
    expect(s.gh.failures.heater).toBe(0);
    expect(s.gh.today.fuelL + (s.gh.yesterday?.fuelL ?? 0)).toBeGreaterThan(0);
  });

  it('지붕 적설이 한계를 넘으면 붕괴, 순간풍속이 한계를 넘으면 피복 파손 — 사건이 기록되고 되돌려지지 않는다', () => {
    const w = worldOf({ startDate: '2026-01-10' });
    const s0 = createInitialState(w);
    const limit = w.gh.facilities.multi_pe.snowLimit;
    const snowed: SimState = { ...s0, gh: { ...s0.gh, roofSnow: limit + 5 } };
    const r1 = stepGreenhouse(snowed, w);
    expect(r1.gh.destroyed).toBe(true);
    expect(r1.events.some((e) => e.type === 'structure' && e.code === 'collapse')).toBe(true);
    // 무너진 뒤에는 실내 = 외기, 비용 0
    const after = stepGreenhouse({ ...snowed, gh: r1.gh, hour: 1 }, w);
    expect(after.gh.out.tIn).toBe(snowed.weather.now.temp);
    expect(after.gh.out.won).toBe(0);

    const windy: SimState = { ...s0, weather: { ...s0.weather, cur: { ...s0.weather.cur, gust: 45, wind: 10 }, now: { ...s0.weather.now, wind: 10 } } };
    const r2 = stepGreenhouse(windy, w);
    expect(r2.gh.breached).toBe(true);
    expect(r2.events.some((e) => e.code === 'breach')).toBe(true);
  });

  it('난방하는 온실은 지붕 눈이 덜 쌓인다', () => {
    const base = { regionId: 'daegwallyeong', startDate: '2026-01-05', days: 10, seed: 'e2e-cold' };
    const cold = run({ ...base, setup: { facility: 'venlo', heater: 'none' } });
    const warm = run({ ...base, setup: { facility: 'venlo', heater: 'oil', heaterCapacity: 300 }, settings: { heatNight: 15, heatDay: 15, heatPreDawn: 15, curtainOutTemp: -99 } });
    const peak = (r: typeof cold) => Math.max(...r.hours.map((h) => h.gh.roofSnow));
    expect(peak(cold)).toBeGreaterThan(3);
    expect(peak(warm)).toBeLessThan(peak(cold));
  });

  it('방충망이 촘촘할수록 환기량이 줄고 한낮 실내가 더 덥다', () => {
    const base = { regionId: 'daegu', startDate: '2026-07-20', days: 7, setup: { heater: 'none' as const, shade: 'none' as const } };
    const m = (net: 'none' | 'm04') => {
      const rr = run({ ...base, setup: { ...base.setup, insectNet: net } });
      const noon = rr.hours.filter((h) => h.hod >= 12 && h.hod <= 15);
      return { ach: noon.reduce((a, h) => a + h.gh.ach, 0) / noon.length, t: noon.reduce((a, h) => a + h.gh.tIn, 0) / noon.length };
    };
    const open = m('none');
    const fine = m('m04');
    expect(fine.ach).toBeLessThan(0.7 * open.ach);
    expect(fine.t).toBeGreaterThan(open.t + 0.5);
  });

  it('전기·연료·CO2 비용이 쌓이고, 무가온·무장비 온실은 기본요금 수준만 든다', () => {
    const heated = run({ startDate: '2026-01-10', days: 3, setup: { heater: 'oil' } });
    const bare = run({ startDate: '2026-01-10', days: 3, setup: { heater: 'none', circFan: false, shade: 'none', curtainLayers: 0 } });
    expect(heated.final.gh.total.fuelL).toBeGreaterThan(100);
    expect(heated.final.gh.total.won).toBeGreaterThan(heated.final.gh.total.fuelL * 1000);
    expect(bare.final.gh.total.won).toBe(0);
    expect(bare.final.gh.total.fuelL).toBe(0);
  });
});

describe('온실 모델 — 시나리오(V3)', () => {
  it('① 한겨울 무가온: 커튼 없으면 외기보다 1–6°C 높고, 다겹 2겹이면 그보다 2.5°C 이상 더 높다', () => {
    const s = scenario1('multi_pe');
    expect(s.in0 - s.outMin).toBeGreaterThan(1);
    expect(s.in0 - s.outMin).toBeLessThan(6);
    expect(s.in1).toBeGreaterThan(s.in0 + 1.5);
    expect(s.in2).toBeGreaterThan(s.in1);
    expect(s.in2 - s.in0).toBeGreaterThan(2.5);
    expect(s.in2 - s.outMin).toBeLessThan(12);
  });

  it('② 한여름 맑은 날 밀폐·무차광: 40°C 이상(60–70°C대까지). 환기 + 차광이면 10°C 이상 낮고 외기 +4°C 이내', () => {
    const s = scenario2();
    expect(s.sealedMax).toBeGreaterThanOrEqual(40);
    expect(s.sealedMax).toBeLessThan(75);
    expect(s.emptyMax).toBeGreaterThanOrEqual(40);
    expect(s.emptyMax).toBeLessThan(75);
    expect(s.ventedMax).toBeLessThan(s.sealedMax - 10);
    expect(s.ventedMax).toBeLessThan(s.outMax + 4);
  });

  it('③ CO2: 창을 닫으면 목표 근처, 창 50%면 농도 상승은 1/4 이하인데 사용량은 2배 이상', () => {
    const s = scenario3();
    expect(s.noDose.ppm).toBeLessThan(300);
    expect(s.closed.ppm).toBeGreaterThan(650);
    expect(s.open.ppm - 425).toBeLessThan(0.25 * (s.closed.ppm - 425));
    expect(s.open.kgPerDay).toBeGreaterThan(2 * s.closed.kgPerDay);
    expect(s.cut.kgPerDay).toBe(0);
  });

  it('④ 새벽 난방 + 외기 저온: 찬 피복면 결로와 엽면 습윤 시간이 기록된다. 무가온이면 더 습하다', () => {
    const s = scenario4();
    expect(s.condPreDawn).toBeGreaterThan(0.5);
    expect(s.surfBelowDew).toBeGreaterThan(0);
    expect(s.condHoursPerDay).toBeGreaterThan(6);
    expect(s.unheated.rhNight).toBeGreaterThan(s.rhPreDawn + 5);
    // 엽면 습윤(엽온 < 이슬점)도 두 경우 모두 기록된다
    expect(s.leafWetHoursPerDay).toBeGreaterThan(0.3);
    expect(s.unheated.leafWetHoursPerDay).toBeGreaterThan(0.3);
    expect(s.leafWetHoursPerDay).toBeLessThan(14);
  });

  it('⑤ 난방 용량 부족: 계속 돌려도 설정온도에 못 미치고 미달 시간이 기록된다', () => {
    const s = scenario5();
    expect(s.small.duty).toBeGreaterThan(0.9);
    expect(s.small.nightMean).toBeLessThan(15 - 4);
    expect(s.small.deficitH).toBeGreaterThan(15);
    expect(s.big.nightMean).toBeGreaterThan(13.5);
    expect(s.big.deficitH).toBeLessThan(4);
    expect(s.big.fuelPerDay).toBeGreaterThan(s.small.fuelPerDay);
  });

  it('⑥ 에너지 수지 오차 < 1% (네 가지 조건 모두)', () => {
    for (const c of scenario6()) {
      expect(c.errorPct, c.name).toBeLessThan(1);
      expect(c.worstHourPct, c.name).toBeLessThan(1);
    }
  });

  it('결정론: 온실 포함 60일을 두 번 돌려 같은 지문, 스냅샷에서 이어도 같은 지문', () => {
    const w = worldOf({ seed: 'gh-det', startDate: '2026-02-01', setup: { ...defaultSetup(), heater: 'oil', co2: 'liquid' } });
    const go = (s: SimState, n: number) => {
      for (let i = 0; i < n; i++) s = stepHour(s, w, []);
      return s;
    };
    const a = go(createInitialState(w), 60 * 24);
    const b = go(JSON.parse(JSON.stringify(go(createInitialState(w), 20 * 24))), 40 * 24);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});
