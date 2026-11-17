import { describe, expect, it } from 'vitest';
import { createInitialState, fingerprint, listRegions, stepHour, sunDay, type SimState } from '../../src/engine';
import { dacos, dasin, datan, dcos, dexp, dlog, dpow, dsin, dtan } from '../../src/engine/dmath';
import { interpolateMonthly, MONTH_DAYS } from '../../src/engine/weather/climate';
import { data, world, worldOf } from './helpers';
import { runRegion } from '../../tools/validate-weather';

const close = (a: number, b: number, rel = 1e-12) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

describe('dmath — 기기와 무관한 수학 함수(V1)', () => {
  it('exp, log, pow가 표준 함수와 1e-12 이내로 일치', () => {
    for (const x of [-700, -50.5, -3, -1, -1e-9, 0, 1e-9, 0.5, 1, 2.5, 10, 50.123, 300, 700]) expect(close(dexp(x), Math.exp(x)), `exp(${x})`).toBe(true);
    for (const x of [1e-300, 1e-9, 0.001, 0.5, 0.9999, 1, 1.0001, 2, Math.E, 10, 12345.678, 1e9, 1e300]) expect(close(dlog(x), Math.log(x)), `log(${x})`).toBe(true);
    for (const [a, b] of [[2, 10], [0.5, 0.75], [10, -3], [1.2345, 6.789], [100, 0.5]] as const) expect(close(dpow(a, b), Math.pow(a, b), 1e-11), `pow(${a},${b})`).toBe(true);
    expect(dexp(0)).toBe(1);
    expect(dlog(1)).toBe(0);
  });

  it('sin, cos, tan, asin, acos, atan이 표준 함수와 1e-12 이내로 일치', () => {
    for (let i = -400; i <= 400; i++) {
      const x = i * 0.137;
      expect(Math.abs(dsin(x) - Math.sin(x)), `sin(${x})`).toBeLessThan(1e-12);
      expect(Math.abs(dcos(x) - Math.cos(x)), `cos(${x})`).toBeLessThan(1e-12);
    }
    for (const x of [-1.2, -0.3, 0, 0.7, 1.4]) expect(close(dtan(x), Math.tan(x), 1e-11)).toBe(true);
    for (let i = -100; i <= 100; i++) {
      const x = i / 100;
      expect(Math.abs(dasin(x) - Math.asin(x)), `asin(${x})`).toBeLessThan(1e-10);
      expect(Math.abs(dacos(x) - Math.acos(x)), `acos(${x})`).toBeLessThan(1e-10);
    }
    for (const x of [-1e6, -30, -2, -1, -0.5, -0.1, 0, 0.1, 0.4142, 0.5, 1, 2, 30, 1e6]) expect(Math.abs(datan(x) - Math.atan(x)), `atan(${x})`).toBeLessThan(1e-12);
  });
});

describe('천문 계산(V1)', () => {
  it('서울의 일장: 하지 약 14.8시간, 동지 약 9.6시간, 춘분 약 12.1시간', () => {
    expect(sunDay(37.57, 126.97, 172).daylength).toBeGreaterThan(14.6);
    expect(sunDay(37.57, 126.97, 172).daylength).toBeLessThan(14.9);
    expect(sunDay(37.57, 126.97, 355).daylength).toBeGreaterThan(9.5);
    expect(sunDay(37.57, 126.97, 355).daylength).toBeLessThan(9.7);
    expect(sunDay(37.57, 126.97, 80).daylength).toBeGreaterThan(12.0);
    expect(sunDay(37.57, 126.97, 80).daylength).toBeLessThan(12.3);
  });

  it('한국은 표준 자오선(135°E)보다 서쪽이라 남중이 12시 15분–12시 50분 사이', () => {
    for (const doy of [1, 45, 100, 172, 250, 305, 355]) {
      const noon = sunDay(37.57, 126.97, doy).noon;
      expect(noon).toBeGreaterThan(12.25);
      expect(noon).toBeLessThan(12.85);
    }
  });

  it('남쪽일수록 겨울 낮이 길고 여름 낮이 짧다(서귀포 vs 철원)', () => {
    expect(sunDay(33.25, 126.57, 355).daylength).toBeGreaterThan(sunDay(38.15, 127.3, 355).daylength);
    expect(sunDay(33.25, 126.57, 172).daylength).toBeLessThan(sunDay(38.15, 127.3, 172).daylength);
  });

  it('대기권 밖 일사 Ra: 서울 하지 약 41, 동지 약 16 MJ/m²/d', () => {
    expect(sunDay(37.57, 126.97, 172).ra).toBeGreaterThan(40);
    expect(sunDay(37.57, 126.97, 172).ra).toBeLessThan(42.5);
    expect(sunDay(37.57, 126.97, 355).ra).toBeGreaterThan(15);
    expect(sunDay(37.57, 126.97, 355).ra).toBeLessThan(17.5);
  });
});

describe('기후 기준선(V1)', () => {
  it('평균 보존 보간: 일별 기준선의 월평균이 평년값과 0.02 이내', () => {
    const monthly = [-1.5, 0.7, 5.7, 11.8, 17.6, 22.1, 25.3, 25.7, 20.7, 13.8, 6.9, 0.4];
    const daily = interpolateMonthly(monthly);
    expect(daily.length).toBe(365);
    let k = 0;
    for (let m = 0; m < 12; m++) {
      let s = 0;
      for (let d = 0; d < MONTH_DAYS[m]!; d++) s += daily[k++]!;
      expect(Math.abs(s / MONTH_DAYS[m]! - monthly[m]!)).toBeLessThan(0.02);
    }
    // 연말–연초가 매끄럽게 이어진다
    expect(Math.abs(daily[364]! - daily[0]!)).toBeLessThan(0.3);
  });

  it('지점 29곳: 수도권·강원 영서·영동·고랭지·충청·호남·영남·제주를 모두 포함', () => {
    const regions = listRegions(data);
    expect(regions.length).toBeGreaterThanOrEqual(25);
    expect(regions.length).toBeLessThanOrEqual(30);
    const groups = new Set(regions.map((r) => r.group));
    for (const g of ['수도권', '강원 영서', '강원 영동', '강원 고랭지', '충청', '호남', '영남', '제주']) expect(groups.has(g), g).toBe(true);
    expect(regions.some((r) => r.climateClass === 'coastal')).toBe(true);
    for (const r of regions) expect(() => worldOf({ regionId: r.id })).not.toThrow();
  });

  it('일조시간에서 환산한 일사가 상식 범위: 부여 5월 18–23, 12월 6–10 MJ/m²/d', () => {
    const n = world.clim.normals.solar;
    expect(n[4]).toBeGreaterThan(18);
    expect(n[4]).toBeLessThan(23);
    expect(n[11]).toBeGreaterThan(6);
    expect(n[11]).toBeLessThan(10);
  });
});

describe('기상 생성기 — 물리 타당성(V2)', () => {
  const w = worldOf({ startDate: '2026-01-01', seed: 'v2-check' });
  let s: SimState = createInitialState(w);
  const days: { solarH: number; precipH: number; tMaxH: number; tMinH: number; rhMean: number; d: SimState['weather']['cur'] }[] = [];
  let acc = { solarH: 0, precipH: 0, tMaxH: -99, tMinH: 99, rhSum: 0 };
  let bad = 0;
  for (let h = 0; h < 3 * 365 * 24; h++) {
    const now = s.weather.now;
    if (!(now.rh >= 0 && now.rh <= 100) || now.solarMJ < 0 || now.precip < 0 || now.wind < 0 || !Number.isFinite(now.temp)) bad++;
    acc.solarH += now.solarMJ;
    acc.precipH += now.precip;
    acc.tMaxH = Math.max(acc.tMaxH, now.temp);
    acc.tMinH = Math.min(acc.tMinH, now.temp);
    acc.rhSum += now.rh;
    if (s.hour % 24 === 23) {
      days.push({ solarH: acc.solarH, precipH: acc.precipH, tMaxH: acc.tMaxH, tMinH: acc.tMinH, rhMean: acc.rhSum / 24, d: s.weather.cur });
      acc = { solarH: 0, precipH: 0, tMaxH: -99, tMinH: 99, rhSum: 0 };
    }
    s = stepHour(s, w, []);
  }

  it('음수·범위 이탈 없음: 습도 0–100%, 일사·강수·풍속 ≥ 0', () => {
    expect(bad).toBe(0);
  });

  it('보존: 시간별 일사의 합 = 일적산 일사, 시간별 강수의 합 = 일강수량 (오차 < 1%)', () => {
    for (const x of days) {
      expect(Math.abs(x.solarH - x.d.solar) / x.d.solar).toBeLessThan(0.01);
      expect(Math.abs(x.precipH - x.d.precip)).toBeLessThan(0.01 * Math.max(1, x.d.precip));
    }
  });

  it('시간별 기온이 그날 최고·최저 사이에 있고(전날·다음 날 영향 허용 폭 내), 최고기온에 거의 닿는다', () => {
    let reach = 0;
    for (const x of days) {
      expect(x.tMaxH).toBeLessThanOrEqual(x.d.tmax + 1e-9);
      if (x.d.tmax - x.tMaxH < 0.5) reach++;
    }
    expect(reach / days.length).toBeGreaterThan(0.95);
  });

  it('일사는 청천 상한을 넘지 않고, 밤에는 0', () => {
    for (const x of days) expect(x.d.solar).toBeLessThanOrEqual(w.clim.rso[x.d.di]! + 1e-9);
    let s2 = createInitialState(w);
    for (let h = 0; h < 48; h++) {
      const hod = s2.hour % 24;
      if (hod <= 4 || hod >= 21) expect(s2.weather.now.solarMJ).toBe(0);
      s2 = stepHour(s2, w, []);
    }
  });

  it('하루 평균 습도가 생성된 일평균 습도와 일치(이슬점 보존 가정 아래)', () => {
    for (const x of days) expect(Math.abs(x.rhMean - x.d.rh)).toBeLessThan(1.5);
  });

  it('비 오는 날은 맑은 날보다 일사가 적고 습도가 높고 일교차가 작다', () => {
    const july = days.filter((x) => x.d.month === 6);
    const mean = (a: typeof july, f: (x: (typeof july)[number]) => number) => a.reduce((p, x) => p + f(x), 0) / a.length;
    const wet = july.filter((x) => x.d.wet);
    const dry = july.filter((x) => !x.d.wet);
    expect(mean(wet, (x) => x.d.solar)).toBeLessThan(0.7 * mean(dry, (x) => x.d.solar));
    expect(mean(wet, (x) => x.d.rh)).toBeGreaterThan(mean(dry, (x) => x.d.rh) + 5);
    expect(mean(wet, (x) => x.d.tmax - x.d.tmin)).toBeLessThan(mean(dry, (x) => x.d.tmax - x.d.tmin));
  });
});

describe('기상 생성기 — 시나리오(V3)', () => {
  const buyeo = runRegion('buyeo', 'validate-buyeo');
  const n = world.clim.normals;

  it('① 부여 30년: 월평균 기온이 평년값 ±0.5°C, 월 일사량 ±5%', () => {
    for (let m = 0; m < 12; m++) {
      expect(Math.abs(buyeo.tavgHourly[m]! - n.tavg[m]!), `${m + 1}월 기온`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(buyeo.solar[m]! / n.solar[m]! - 1), `${m + 1}월 일사`).toBeLessThanOrEqual(0.05);
    }
  });

  it('①-b 치우침 없음: 300년이면 기온 ±0.25°C, 일사 ±2.5% 안으로 수렴', () => {
    const long = runRegion('buyeo', 'long-buyeo', 300);
    for (let m = 0; m < 12; m++) {
      expect(Math.abs(long.tavgHourly[m]! - n.tavg[m]!), `${m + 1}월 기온`).toBeLessThanOrEqual(0.25);
      expect(Math.abs(long.solar[m]! / n.solar[m]! - 1), `${m + 1}월 일사`).toBeLessThanOrEqual(0.025);
      expect(Math.abs(long.tmax[m]! - n.tmax[m]!), `${m + 1}월 최고`).toBeLessThanOrEqual(0.3);
      expect(Math.abs(long.tmin[m]! - n.tmin[m]!), `${m + 1}월 최저`).toBeLessThanOrEqual(0.3);
    }
    const p = long.precip.reduce((a, b) => a + b, 0) / n.precip.reduce((a, b) => a + b, 0);
    expect(Math.abs(p - 1)).toBeLessThan(0.05);
  });

  it('② 대관령 겨울 vs 제주 겨울: 1월 최저기온 차 12°C 이상, 대관령만 한파·대설', () => {
    const hi = runRegion('daegwallyeong', 'validate-daegwallyeong');
    const jeju = runRegion('seogwipo', 'validate-seogwipo');
    expect(jeju.tmin[0]! - hi.tmin[0]!).toBeGreaterThan(12);
    expect(hi.tmin[0]).toBeLessThan(-10);
    expect(jeju.tmin[0]).toBeGreaterThan(2);
    expect(hi.coldDays).toBeGreaterThan(15);
    expect(jeju.coldDays).toBe(0);
    expect(hi.snowDays5).toBeGreaterThan(5);
    expect(jeju.snowDays5).toBeLessThan(1);
    // 겨울 일사는 위도가 낮은 서귀포가 조금 많지만 큰 차이는 아니다(둘 다 겨울에 맑은 날이 많다)
    expect(Math.abs(jeju.solar[0]! - hi.solar[0]!)).toBeLessThan(3);
  });

  it('③ 장마철: 비가 더 길게 이어지고(연속일수 1.4배 이상), 7월 일사가 5월의 92% 이하', () => {
    expect(buyeo.meanWetRunJangma).toBeGreaterThan(1.4 * buyeo.meanWetRunOther);
    expect(buyeo.maxWetRunJangma).toBeGreaterThanOrEqual(7);
    expect(buyeo.solar[6]! / buyeo.solar[4]!).toBeLessThan(0.92);
    expect(buyeo.events['jangma:start']).toBeCloseTo(1, 1);
  });

  it('④ 같은 seed → 완전히 같은 결과, 다른 seed → 다른 날씨', () => {
    const run = (seed: string) => {
      const w = worldOf({ seed });
      let s = createInitialState(w);
      for (let i = 0; i < 400 * 24; i++) s = stepHour(s, w, []);
      return fingerprint(s);
    };
    expect(run('same')).toBe(run('same'));
    expect(run('same')).not.toBe(run('other'));
  });

  it('고정 기준값: 생성기 구현이 바뀌면(옛 세이브 재생 결과가 달라지면) 반드시 드러난다', () => {
    const w = worldOf({ seed: 'golden', startDate: '2026-07-01', regionId: 'daegu' });
    let s = createInitialState(w);
    for (let i = 0; i < 30 * 24 + 14; i++) s = stepHour(s, w, []);
    expect(fingerprint(s)).toMatchInlineSnapshot(`"8b7f60bcb1ce5650"`);
    expect({ t: s.weather.now.temp, rh: s.weather.now.rh, sol: s.weather.now.solarW }).toMatchInlineSnapshot(`
      {
        "rh": 42.25653170596644,
        "sol": 723.3506291787453,
        "t": 37.78987448227315,
      }
    `);
  });

  it('극한 기상이 지역 특성대로: 대구는 폭염이 잦고 대관령은 거의 없다, 태풍은 제주 > 서울', () => {
    const daegu = runRegion('daegu', 'validate-daegu');
    const hi = runRegion('daegwallyeong', 'validate-daegwallyeong');
    const seoul = runRegion('seoul', 'validate-seoul');
    const jeju = runRegion('jeju', 'validate-jeju');
    expect(daegu.heatDays).toBeGreaterThan(15);
    expect(hi.heatDays).toBeLessThan(2);
    expect(jeju.typhoonDays).toBeGreaterThan(2 * seoul.typhoonDays);
  });
});
