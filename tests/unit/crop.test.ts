import { describe, expect, it } from 'vitest';
import { beta, canopyPhoto, createInitialState, cropCanopy, defaultOrder, defaultSettings, diffuseFraction, fingerprint, inductionRate, leafEnv, replay, stepHour, trap, type CanopyView, type UserAction } from '../../src/engine';
import { runCrop, STRAWBERRY_SETTINGS, summary } from '../../tools/validate-crop';
import { config, data, world, worldOf } from './helpers';

const core = world.crops.core;
const cu = world.crops.cucumber;
const view = (lai: number, pm = cu.photo.pmax): CanopyView => ({ lai, kdf: 0.75, pmax: [pm, pm, pm], alphaF: [1, 1, 1], tempCurve: cu.photo.pmaxTemp, rm25: 0, pool: 0, growthResp: 0, stomatalMin: 82, waterStress: 1 });
const env = (co2 = 400, t = 25, vpd = 1) => leafEnv(core.photo, cu.photo.pmaxTemp, t, co2, vpd);

describe('작물 코어 — 수식(V1)', () => {
  it('사다리꼴 반응곡선과 베타 함수', () => {
    expect(trap([0, 10, 20, 30], -1)).toBe(0);
    expect(trap([0, 10, 20, 30], 5)).toBeCloseTo(0.5);
    expect(trap([0, 10, 20, 30], 15)).toBe(1);
    expect(trap([0, 10, 20, 30], 25)).toBeCloseTo(0.5);
    const d = cu.dev;
    expect(beta(d.tBase, d.tBase, d.tOpt, d.tMax)).toBe(0);
    expect(beta(d.tOpt, d.tBase, d.tOpt, d.tMax)).toBeCloseTo(1, 6);
    expect(beta(d.tMax, d.tBase, d.tOpt, d.tMax)).toBe(0);
    expect(beta(20, d.tBase, d.tOpt, d.tMax)).toBeGreaterThan(beta(15, d.tBase, d.tOpt, d.tMax));
    for (let t = 0; t <= 45; t++) expect(beta(t, d.tBase, d.tOpt, d.tMax)).toBeLessThanOrEqual(1.0000001);
  });

  it('산란광 비율: 흐린 날 1, 맑은 날 0.2–0.4', () => {
    expect(diffuseFraction(100, 0.8)).toBe(1);
    const clear = diffuseFraction(850, 0.85);
    expect(clear).toBeGreaterThan(0.15);
    expect(clear).toBeLessThan(0.45);
    expect(diffuseFraction(0, -0.2)).toBe(1);
  });

  it('잎 광합성: 광포화점이 1000 μmol 부근(국내 오이 측정: 1000 이상)', () => {
    // 얇은 군락(LAI 0.01)에 산란광만 주면 잎 한 장의 반응과 같다
    const leaf = (i: number) => canopyPhoto(view(0.01), core.photo, env(), 0, i, 1).gross / 0.01;
    const sat = leaf(3000);
    expect(leaf(1000) / sat).toBeGreaterThan(0.8);
    expect(leaf(400) / sat).toBeLessThan(0.75);
    expect(leaf(200)).toBeGreaterThan(leaf(100));
  });

  it('CO2 800 vs 400 ppm: 잎 Pmax +25–60%, 약광 효율도 증가', () => {
    const a = env(400);
    const b = env(800);
    expect(b.fPmax / a.fPmax).toBeGreaterThan(1.25);
    expect(b.fPmax / a.fPmax).toBeLessThan(1.6);
    expect(b.alpha).toBeGreaterThan(a.alpha);
    expect(a.fPmax).toBeCloseTo(1, 1);
  });

  it('건조한 공기(VPD↑)와 고온에서 광합성이 준다', () => {
    expect(env(400, 25, 3).fPmax).toBeLessThan(env(400, 25, 1).fPmax);
    expect(env(400, 38, 1).fPmax).toBeLessThan(env(400, 28, 1).fPmax);
    expect(env(400, 38, 1).alpha).toBeLessThan(env(400, 25, 1).alpha);
  });

  it('군락 광합성: LAI가 늘면 증가하되 포화, 같은 광량이면 산란광이 직달광보다 효율적', () => {
    const g = (lai: number, dir: number, dif: number) => canopyPhoto(view(lai), core.photo, env(), dir, dif, 0.8).gross;
    const g1 = g(1, 700, 300);
    const g3 = g(3, 700, 300);
    const g6 = g(6, 700, 300);
    expect(g3).toBeGreaterThan(g1);
    expect(g6 - g3).toBeLessThan(g3 - g1);
    expect(g(3, 0, 1000)).toBeGreaterThan(g(3, 1000, 0));
    // 맑은 날 한낮 LAI 3 군락의 총광합성은 30–50 μmol m⁻² s⁻¹ 범위(온실 오이·토마토 군락 측정 범위)
    expect(g3).toBeGreaterThan(25);
    expect(g3).toBeLessThan(50);
    expect(canopyPhoto(view(3), core.photo, env(), 0, 0, 0.5).gross).toBe(0);
  });

  it('수분 스트레스 민감도 순서: 엽 확장 → 과실 비대 → 광합성', () => {
    for (const w of [0.85, 0.7, 0.55, 0.4]) {
      const e = trap(core.water.expand, w);
      const f = trap(core.water.fruit, w);
      const p = trap(core.water.photo, w);
      expect(e).toBeLessThanOrEqual(f);
      expect(f).toBeLessThanOrEqual(p);
    }
    expect(trap(core.water.expand, 1)).toBe(1);
  });
});

const cropWorld = (patch = {}) => worldOf({ startDate: '2026-03-01', setup: { ...config.setup, testLai: 0 }, settings: { ...config.settings, heatDay: 18, heatNight: 14, ventTemp: 28 }, crop: { day: 1, order: defaultOrder(world.crops) }, ...patch });

describe('작물 — 물리 타당성(V2)', () => {
  it('탄소 수지: 총광합성 − 유지호흡 = 저장고 변화 + 생장에 쓴 당, 쓴 당의 탄소 = 건물 탄소 + 생장호흡 탄소', () => {
    const w = cropWorld();
    let s = createInitialState(w);
    let co2Err = 0;
    for (let i = 0; i < 70 * 24; i++) {
      s = stepHour(s, w, []);
      const o = s.gh.out;
      co2Err = Math.max(co2Err, Math.abs(o.cIn - o.cOut - o.cStore) / Math.max(o.cIn, o.cOut, 1e-6));
      if (s.crop) {
        expect(s.crop.pool).toBeGreaterThanOrEqual(0);
        expect(s.crop.out.lai).toBeGreaterThanOrEqual(0);
        expect(s.crop.out.lai).toBeLessThan(8);
        for (const f of s.crop.fruits) expect(f.n).toBeGreaterThan(0);
      }
    }
    const c = s.crop!;
    expect(c.cum.gross).toBeGreaterThan(100);
    expect(Math.abs(c.cum.gross - c.cum.maint - c.cum.used - c.pool) / c.cum.gross).toBeLessThan(0.01);
    expect(Math.abs(c.cum.used * 0.4 - c.cum.dmC - (c.cum.rgCO2 * 12) / 44) / (c.cum.used * 0.4)).toBeLessThan(1e-9);
    // 온실 공기의 CO2 수지도 작물이 있는 상태에서 닫힌다
    expect(co2Err).toBeLessThan(0.01);
  });

  it('결정론: 같은 seed + 같은 조치 → 같은 결과, 작업 계획 변경은 결과를 바꾼다', () => {
    const w = cropWorld();
    const plan = { ...defaultOrder(world.crops).plan, deleafEvery: 0 };
    const acts: UserAction[] = [{ hour: 30 * 24, seq: 0, type: 'crop/plan', payload: plan }, { hour: 40 * 24 + 5, seq: 0, type: 'crop/work', payload: { task: 'harvest' } }];
    const a = replay(w, acts, 50 * 24);
    const b = replay(w, acts, 50 * 24);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(replay(w, [], 50 * 24))).not.toBe(fingerprint(a));
    expect(a.crop!.plan.deleafEvery).toBe(0);
  });

  it('작물이 없으면 군락도 없다(빈 온실), 정식하면 군락이 생긴다', () => {
    const w = cropWorld({ crop: null });
    let s = createInitialState(w);
    for (let i = 0; i < 30; i++) s = stepHour(s, w, []);
    expect(s.crop).toBeNull();
    expect(cropCanopy(s, w)).toBeNull();
    expect(s.gh.out.transpiration).toBe(0);
    s = stepHour(s, w, [{ hour: s.hour, seq: 0, type: 'crop/plant', payload: defaultOrder(w.crops, 'ipchu') }]);
    expect(s.crop!.varietyId).toBe('ipchu');
    expect(cropCanopy(s, w)!.lai).toBeGreaterThan(0.05);
    s = stepHour(s, w, [{ hour: s.hour, seq: 0, type: 'crop/remove', payload: null }]);
    expect(s.crop).toBeNull();
  });

  it('실패 허용(N4): 한겨울 무가온이면 오이는 얼어 죽는다', () => {
    const r = runCrop({ startDate: '2026-01-05', days: 20, regionId: 'cheorwon', setup: { heater: 'none', curtainLayers: 0, coverLayers: 1 } });
    expect(r.crop.dead).toBe(true);
    expect(['frost', 'chill', 'collapse']).toContain(r.crop.deathCause);
    expect(r.events.some((e) => e.startsWith('crop:dead'))).toBe(true);
  });
});

describe('오이 — 생리 시나리오(V3)', () => {
  const b = { startDate: '2026-02-01', days: 150 };
  const std = summary(runCrop(b));

  it('① 표준 관리(반촉성): 수량·첫 수확·과실 분배가 타당한 범위', () => {
    const bench = cu.systems.semiforcing!.benchYield;
    // 무병·양수분 무제한 조건의 잠재 수량이므로 조사 평균보다 낮을 수는 없다(상한 비교는 V4 문서 참조)
    expect(std.yield10a).toBeGreaterThan(bench * 0.75);
    expect(std.yield10a).toBeLessThan(22000);
    expect(std.firstHarvestDay).toBeGreaterThan(30);
    expect(std.firstHarvestDay).toBeLessThan(60);
    // Marcelis: 과실 분배율은 40–90% 사이에서 주기 변동, 평균 60% 안팎
    expect(std.fruitShare).toBeGreaterThan(0.45);
    expect(std.fruitShare).toBeLessThan(0.75);
    expect(std.laiMean).toBeGreaterThan(1.5);
    expect(std.laiMean).toBeLessThan(3.5);
    expect(std.dead).toBe('');
  });

  it('② 전 기간 50% 차광 → 수량 감소(20% 이상), 도장, 유과 퇴화 증가', () => {
    const sh = summary(runCrop({ ...b, setup: { shade: 's55' }, settings: { shadeOnW: 0 } }));
    expect(sh.yield10a).toBeLessThan(std.yield10a * 0.8);
    expect(sh.etiolation).toBeGreaterThan(std.etiolation);
    expect(sh.gross).toBeLessThan(std.gross * 0.75);
  });

  it('③ 야간 고온 + 약광 → 도장(절간 신장)과 유과 퇴화 증가', () => {
    const base = summary(runCrop({ ...b, setup: { shade: 's55' }, settings: { shadeOnW: 0 } }));
    const hot = summary(runCrop({ ...b, setup: { shade: 's55' }, settings: { shadeOnW: 0, heatNight: 21, heatPreDawn: 21, heatDay: 21 } }));
    expect(hot.etiolation).toBeGreaterThan(std.etiolation * 1.1);
    expect(hot.aborted / (hot.aborted + hot.count)).toBeGreaterThan(std.aborted / (std.aborted + std.count));
    expect(hot.aborted / (hot.aborted + hot.count)).toBeGreaterThan(base.aborted / (base.aborted + base.count));
  });

  it('⑥ CO2 800 vs 400 ppm: 군락 총광합성 +15–50% (문헌: 순광합성 최대 +50%)', () => {
    const g = (co2: number) => canopyPhoto(view(2.5), core.photo, env(co2), 500, 300, 0.7).gross;
    const gain = g(800) / g(400) - 1;
    expect(gain).toBeGreaterThan(0.15);
    expect(gain).toBeLessThan(0.5);
    // 실제 온실: 환기로 농도가 희석되므로 수량 증가는 그보다 작지만 양(+)이어야 한다
    const en = summary(runCrop({ ...b, setup: { co2: 'liquid' }, settings: { co2Target: 800, co2VentMax: 100, co2Start: 6, co2End: 18 } }));
    expect(en.gross).toBeGreaterThan(std.gross * 1.02);
    expect(en.yield10a).toBeGreaterThan(std.yield10a);
  });

  it('⑦ 재식밀도 증가 → 주당 수량 감소, 면적당 수량 포화', () => {
    const d15 = summary(runCrop({ ...b, order: { density: 1.5 } }));
    const d30 = summary(runCrop({ ...b, order: { density: 3 } }));
    const d40 = summary(runCrop({ ...b, order: { density: 4 } }));
    expect(d15.yield10a / 1.5).toBeGreaterThan(std.yield10a / 2.2);
    expect(std.yield10a / 2.2).toBeGreaterThan(d30.yield10a / 3);
    expect(d30.yield10a / 3).toBeGreaterThan(d40.yield10a / 4);
    expect(d30.yield10a).toBeGreaterThan(std.yield10a);
    expect(d40.yield10a / d30.yield10a).toBeLessThan(1.08);
  });

  it('⑧ 적엽 전혀 안 함 → LAI 과다, 잎 면적당 순동화 저하(총 순동화는 포화)', () => {
    const d = { ...b, order: { density: 3.5 } };
    const cut = summary(runCrop(d));
    const none = summary(runCrop({ ...d, plan: { deleafEvery: 0 } }));
    expect(none.laiMean).toBeGreaterThan(cut.laiMean * 1.4);
    expect(none.laiMean).toBeGreaterThan(4.5);
    expect(none.net / none.laiMean).toBeLessThan((cut.net / cut.laiMean) * 0.8);
    // LAI가 65% 늘어도 순동화는 15%도 늘지 않는다(포화)
    expect(none.net / cut.net).toBeLessThan(1.15);
    expect(none.maint).toBeGreaterThan(cut.maint * 1.15);
  });

  it('작업 방치: 유인·곁순 정리를 안 하면 잎만 무성하고 과실 분배가 무너진다', () => {
    const wild = summary(runCrop({ ...b, plan: { trainEvery: 0 } }));
    expect(wild.laiMax).toBeGreaterThan(std.laiMax * 1.5);
    expect(wild.fruitShare).toBeLessThan(std.fruitShare * 0.6);
    expect(wild.yield10a).toBeLessThan(std.yield10a * 0.6);
  });

  it('수확 주기: 3일에 한 번 따면 과대과가 늘어 상품 비율이 떨어진다', () => {
    const slow = summary(runCrop({ ...b, plan: { harvestEvery: 3 } }));
    expect(slow.top10a / slow.yield10a).toBeLessThan((std.top10a / std.yield10a) * 0.8);
    const never = summary(runCrop({ ...b, plan: { harvestEvery: 0 } }));
    expect(never.yield10a).toBe(0);
    expect(never.aborted).toBeGreaterThan(std.aborted * 1.5);
  });

  it('품종: 취청형은 과실이 크고 개수가 적다, 작형: 억제는 첫 수확이 빠르다', () => {
    const g = summary(runCrop({ ...b, order: { varietyId: 'gyeousari' } }));
    expect(g.count).toBeLessThan(std.count);
    expect(g.yield10a / g.count).toBeGreaterThan(std.yield10a / std.count);
    const ret = summary(runCrop({ startDate: '2026-08-20', days: 100 }));
    expect(ret.firstHarvestDay).toBeLessThan(std.firstHarvestDay - 8);
  });
});

describe('데이터', () => {
  it('작물·품종 데이터가 엔진에 읽힌다', () => {
    expect(Object.keys(world.crops.varieties.cucumber).length).toBe(4);
    expect(data.crops).toBeTruthy();
    for (const v of Object.values(world.crops.varieties.cucumber)) expect(v.harvestWeight).toBeGreaterThan(100);
  });
});

describe('세이브 호환', () => {
  it('v3(Phase 2) 세이브를 v4로 옮기면 정식 계획이 비어 있고 시험용 군락이 사라진다', async () => {
    const { migrateSave, SAVE_SCHEMA_VERSION } = await import('../../src/storage/schema');
    const old = { schemaVersion: 3, id: 'a', name: 'n', createdAt: 0, updatedAt: 0, config: { seed: 's', startDate: '2026-01-01', regionId: 'buyeo', setup: { ...config.setup, testLai: 2 }, settings: config.settings }, actions: [], hour: 240, observationMode: 'god', prefs: { autoPause: {} } };
    const m = migrateSave(old);
    expect(m.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(m.config.crop).toBeNull();
    expect(m.config.setup.testLai).toBe(0);
    expect(m.hour).toBe(240);
    // 옛 조치 로그에 시험용 군락이 남아 있어도 되살아나지 않는다
    const w = worldOf({ ...m.config });
    let s = createInitialState(w);
    s = stepHour(s, w, [{ hour: 0, seq: 0, type: 'gh/setup', payload: { ...config.setup, testLai: 2 } }]);
    expect(s.gh.setup.testLai).toBe(0);
  });
});

describe('딸기 — 수식과 시나리오(V1·V3)', () => {
  const sp = world.crops.strawberry;
  const sv = world.crops.varieties.strawberry.seolhyang!;
  const q = (r: ReturnType<typeof runCrop>) => {
    const x = r.crop.quality!;
    return { brix: x.brix / x.kg, weight: x.weight / x.kg, firm: x.firm / x.kg, malformed: x.malformed / x.count };
  };

  it('화아분화 속도: 26°C 이상 정지, 15°C 이하는 일장 무관, 20°C 이상은 단일 필요, 저질소 촉진', () => {
    expect(inductionRate(sp, sv, 28, 10, 1)).toBe(0);
    expect(inductionRate(sp, sv, 12, 16, 1)).toBeCloseTo(inductionRate(sp, sv, 12, 10, 1), 10);
    expect(inductionRate(sp, sv, 21, 16, 1)).toBe(0);
    expect(inductionRate(sp, sv, 21, 11, 1)).toBeGreaterThan(0.04);
    expect(inductionRate(sp, sv, 18, 15.5, 1)).toBeLessThan(inductionRate(sp, sv, 18, 12, 1));
    expect(inductionRate(sp, sv, 18, 12, 0.6)).toBeGreaterThan(inductionRate(sp, sv, 18, 12, 1));
    expect(inductionRate(sp, sv, 18, 12, 1.4)).toBeLessThan(inductionRate(sp, sv, 18, 12, 1));
    // 완전 유도 조건이면 약 20일(야냉 처리 기간)
    expect(1 / inductionRate(sp, sv, 14, 8, 1)).toBeCloseTo(20, 0);
  });

  const b = { startDate: '2026-09-01', days: 265, plantDay: 19, order: { varietyId: 'seolhyang' } };
  const stdRun = runCrop(b);
  const std = summary(stdRun);

  it('① 표준 관리(촉성 설향): 첫 수확 11월 하순–12월, 수량·당도·과중이 타당한 범위, 탄소 수지 닫힘', () => {
    expect(std.dead).toBe('');
    expect(std.firstHarvestDay).toBeGreaterThan(60);
    expect(std.firstHarvestDay).toBeLessThan(100);
    expect(std.yield10a).toBeGreaterThan(sp.systems.forcing!.benchYield * 0.75);
    expect(std.yield10a).toBeLessThan(9000);
    const x = q(stdRun);
    expect(x.brix).toBeGreaterThan(9.5);
    expect(x.brix).toBeLessThan(12.5);
    expect(x.weight).toBeGreaterThan(13);
    expect(x.weight).toBeLessThan(28);
    expect(stdRun.crop.sb!.trusses).toBeGreaterThanOrEqual(4);
    const c = stdRun.crop.cum;
    expect(Math.abs(c.gross - c.maint - c.used - stdRun.crop.pool) / c.gross).toBeLessThan(0.01);
  });

  it('② 전 기간 차광 → 수량 감소, 당도 저하', () => {
    const r = runCrop({ ...b, setup: { shade: 's55' }, settings: { shadeOnW: 0 } });
    expect(summary(r).yield10a).toBeLessThan(std.yield10a * 0.75);
    expect(q(r).brix).toBeLessThan(q(stdRun).brix - 0.5);
  });

  it('④ 화아분화기 고온·고질소 → 출뢰(개화) 지연, 저질소·야냉 묘는 빠르다', () => {
    const e = { startDate: '2026-08-25', days: 120, plantDay: 7, order: { varietyId: 'seolhyang', seedling: 'own' as const } };
    const flower = (o: Parameters<typeof runCrop>[0]) => {
      const d = runCrop(o).crop.out.sb!.firstFlowerDay;
      return d < 0 ? 999 : d;
    };
    const n10 = flower(e);
    const n14 = flower({ ...e, plan: { nLevel: 1.4 } });
    const n06 = flower({ ...e, plan: { nLevel: 0.6 } });
    const hot = flower({ ...e, plan: { nLevel: 1.4 }, settings: { heatNight: 25, heatPreDawn: 25, heatDay: 25, ventTemp: 28 } });
    const chilled = flower({ ...e, order: { ...e.order, nightChill: true } });
    expect(n06).toBeLessThan(n10 - 2);
    expect(n14).toBeGreaterThan(n10 + 2);
    expect(hot).toBeGreaterThan(n14 + 5);
    expect(chilled).toBeLessThan(n06);
  });

  it('⑨ 수정벌 없음 → 기형과 급증, 상품 급감 / 뒤영벌은 저온·약광에서도 일한다', () => {
    const none = runCrop({ ...b, plan: { bees: 'none' } });
    const bumble = runCrop({ ...b, plan: { bees: 'bumble', beesEvery: 45 } });
    expect(q(none).malformed).toBeGreaterThan(0.5);
    expect(q(none).malformed).toBeGreaterThan(q(stdRun).malformed * 3);
    expect(summary(none).top10a).toBeLessThan(std.top10a * 0.3);
    expect(q(bumble).malformed).toBeLessThan(q(stdRun).malformed);
  });

  it('전조(11월 중순부터 14시간) → 휴면(왜화) 억제, 9월부터 켜면 화아분화가 밀린다', () => {
    const led = { setup: { light: 'led' as const, lightPpfd: 20 }, settings: { lightMode: 'extend' as const, photoperiod: 14 } };
    const off = runCrop({ ...b, days: 150 });
    // 9월부터 16시간 전조를 켜 두면 가을(평균 15°C 이상)의 화아분화가 억제되어 작기 전체 꽃 수가 준다
    const fromSep = summary(runCrop({ ...b, setup: led.setup, settings: { ...led.settings, photoperiod: 16 } }));
    const base = { ...defaultSettings(), ...STRAWBERRY_SETTINGS };
    const fromNov = runCrop({ ...b, days: 150, setup: led.setup, settings: { lightMode: 'off' }, actions: [{ hour: 75 * 24, seq: 0, type: 'gh/control', payload: { ...base, ...led.settings } }] });
    expect(off.crop.sb!.dorm).toBeGreaterThan(0.3);
    expect(fromNov.crop.sb!.dorm).toBeLessThan(off.crop.sb!.dorm * 0.5);
    expect(fromNov.crop.out.lai).toBeGreaterThan(off.crop.out.lai);
    expect(fromSep.count).toBeLessThan(std.count * 0.85);
  });

  it('재식밀도: 고밀도에서 주당 수량 감소·면적당 포화 / 품종: 죽향은 달고 킹스베리는 크다', () => {
    const d6 = summary(runCrop({ ...b, order: { varietyId: 'seolhyang', density: 6 } }));
    const d12 = summary(runCrop({ ...b, order: { varietyId: 'seolhyang', density: 12 } }));
    // 딸기는 겨울철 sink 제한으로 계산되어 저밀도의 주당 수량 보상이 거의 없다(KNOWN_LIMITS S3). 고밀도 쪽 포화만 확인한다.
    expect(d6.yield10a).toBeLessThan(std.yield10a);
    expect(std.yield10a / 8.5).toBeGreaterThan(d12.yield10a / 12);
    expect(d12.yield10a / std.yield10a).toBeLessThan(1.15);
    const juk = q(runCrop({ ...b, order: { varietyId: 'jukhyang' } }));
    const king = q(runCrop({ ...b, order: { varietyId: 'kingsberry' } }));
    expect(juk.brix).toBeGreaterThan(q(stdRun).brix + 1);
    expect(king.weight).toBeGreaterThan(q(stdRun).weight * 1.4);
    expect(Object.keys(world.crops.varieties.strawberry).length).toBe(5);
  });

  it('실패 허용: 한겨울 무가온·무보온 철원에서는 꽃이 얼고 수량이 크게 준다', () => {
    const cold = runCrop({ ...b, regionId: 'cheorwon', setup: { heater: 'none', curtainLayers: 0, coverLayers: 1 } });
    expect(summary(cold).yield10a).toBeLessThan(std.yield10a * 0.6);
  });
});
