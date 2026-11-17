import { beforeAll, describe, expect, it } from 'vitest';
import { createInitialState, createWorld, defaultRzConfig, designRecipe, ecOf, feedOf, fillTank, fingerprint, IONS, psiOf, rawAlkalinity, rawWaters, recipeVec, solveMix, speciate, stepHour, stockMix, thetaCC, waterVec, zero, type IonVec, type SubstrateSys } from '../../src/engine';
import { uptakeOf } from '../../src/engine/rootzone/plant';
import { ecTargetAt, phTargetAt } from '../../src/engine/rootzone/setup';
import { avg, CUC, low, massBalance, scenarios, up } from '../../tools/validate-rootzone';
import { config, data, world } from './helpers';

const p = world.rz;
const chem = p.chem;
const vec = (o: Partial<IonVec>): IonVec => ({ ...zero(), ...o });

describe('근권 화학 — 수식(V1)', () => {
  it('EC: WUR 예시(양이온 합 13 me/L ≈ 1.5 mS/cm), 농도에 거의 비례', () => {
    // 표준 네덜란드 오이 순환액을 13 me/L 근처로 맞춘 예
    const v = vec({ NO3: 9, K: 4.5, Ca: 2.5, Mg: 1, S: 1, P: 1, NH4: 0.5 });
    const ec1 = ecOf(v, chem);
    expect(ec1).toBeGreaterThan(1.1);
    expect(ec1).toBeLessThan(1.6);
    const v2 = vec(Object.fromEntries(IONS.map((i) => [i, v[i] * 2])) as IonVec);
    const ec2 = ecOf(v2, chem);
    expect(ec2 / ec1).toBeGreaterThan(1.8);
    expect(ec2 / ec1).toBeLessThan(2);
  });

  it('원수 프로파일: 계산 EC가 보고된 EC와 ±0.05 안, pH도 보고값', () => {
    for (const [id, w] of Object.entries(p.water.profiles)) {
      const v = waterVec(w.mgL, w.pH, chem);
      const sp = speciate(v, chem);
      expect(Math.abs(ecOf(v, chem, sp) - w.ec), id).toBeLessThan(0.05);
      expect(Math.abs(sp.pH - w.pH), id).toBeLessThan(0.05);
    }
  });

  it('pH: 산을 넣으면 내려가고, 중탄산이 있으면 완충된다', () => {
    const raw = rawWaters(p, 'buyeo').groundwater;
    const pH0 = speciate(raw, chem).pH;
    const acid = { ...raw, NO3: raw.NO3 + 2 };
    const pH1 = speciate(acid, chem).pH;
    const acid2 = { ...raw, NO3: raw.NO3 + 4.5 };
    const pH2 = speciate(acid2, chem).pH;
    expect(pH1).toBeLessThan(pH0);
    expect(pH2).toBeLessThan(pH1);
    // 중탄산을 다 중화하기 전(2 mmol)에는 조금만, 넘긴 뒤(4.5 mmol)에는 급격히 떨어진다
    expect(pH0 - pH1).toBeLessThan(1.5);
    expect(pH2).toBeLessThan(4);
    // 열린 계(근권 CO2 분압)에서는 무기탄소가 기체와 평형
    const open = speciate(raw, chem, chem.pco2Rootzone / 1e6);
    expect(open.cT).toBeGreaterThan(0);
  });

  it('원액 탱크: 칼슘과 황산·인산을 같이 녹이면 석고·인산칼슘이 가라앉고 경고가 난다', () => {
    const good = stockMix({ ca_nitrate: 30, k_nitrate: 10 }, 500, p.ferts, chem);
    expect(good.gypsum).toBe(0);
    expect(good.warnings).toHaveLength(0);
    const bad = stockMix({ ca_nitrate: 30, mg_sulfate: 10, map: 5 }, 500, p.ferts, chem);
    expect(bad.gypsum).toBeGreaterThan(0);
    expect(bad.caP).toBeGreaterThan(0);
    expect(bad.ions.Ca).toBeLessThan(good.ions.Ca);
    expect(bad.warnings.join(' ')).toMatch(/석고/);
    // 용해도를 넘기면 녹지 않은 원료가 남는다
    const over = stockMix({ k_sulfate: 120 }, 500, p.ferts, chem);
    expect(Object.keys(over.undissolved)).toContain('k_sulfate');
  });

  it('역방향 계산: 네덜란드 오이 배출식 표준액을 원수(부여 지하수) 성분까지 넣어 다량원소 ±5%로 맞춘다', () => {
    const raw = rawWaters(p, 'buyeo').groundwater;
    const r = designRecipe(p, 'pbg_cucumber_open', raw, rawAlkalinity(p, 'buyeo', 'groundwater'));
    const st = { A: fillTank(r.tanks.A, 500, p).tank, B: fillTank(r.tanks.B, 500, p).tank, acid: fillTank(r.tanks.acid, 200, p).tank };
    const nut = defaultRzConfig(p, 'cucumber', 'buyeo').nut;
    const f = feedOf(raw, {}, st, { ...nut, tanks: r.tanks }, 1, 1, 1, chem);
    const t = recipeVec(p, 'pbg_cucumber_open');
    for (const i of ['NO3', 'K', 'Ca', 'Mg', 'P'] as const) expect(Math.abs(f.ions[i] / t[i] - 1), i).toBeLessThan(0.05);
    expect(f.pH).toBeGreaterThan(5);
    expect(f.pH).toBeLessThan(6.2);
    // 혼합기: EC 2.4, pH 5.6 목표를 맞춘다
    const m = solveMix(raw, {}, st, { ...nut, tanks: r.tanks }, 2.4, chem, { A: 99, B: 99, acid: 99 });
    const g = feedOf(raw, {}, st, { ...nut, tanks: r.tanks }, m.rA, m.rB, m.ra, chem);
    expect(g.ec).toBeCloseTo(2.4, 1);
    expect(Math.abs(g.pH - nut.phTarget)).toBeLessThan(0.1);
  });

  it('배지 보수력(van Genuchten): 용기용수량 θcc, 암면은 곡선이 평평하다가 바닥 근처에서 급락, 코이어는 서서히', () => {
    const rw = p.systems.rockwool as SubstrateSys;
    const co = p.systems.coir as SubstrateSys;
    expect(thetaCC(rw)).toBeGreaterThan(0.75);
    expect(thetaCC(rw)).toBeLessThan(0.9);
    expect(psiOf(rw, thetaCC(rw))).toBeGreaterThan(-1);
    // 같은 비율로 말랐을 때 암면이 퍼텐셜을 더 늦게 잃다가(평평한 곡선) 바닥 근처에서 급락
    expect(psiOf(rw, 0.5)).toBeGreaterThan(psiOf(co, 0.5));
    expect(psiOf(rw, 0.05)).toBeLessThan(-3);
    expect(psiOf(co, 0.25)).toBeLessThan(psiOf(rw, 0.25));
  });

  it('흡수 동역학: 농도에 포화(Michaelis–Menten), 칼륨이 많으면 칼슘 흡수↓(길항), 고pH에서 철 흡수↓', () => {
    const n = p.crop.cucumber;
    const base = vec({ NO3: 12, K: 6, Ca: 3, Mg: 1, S: 1, P: 1, Fe: 0.015, B: 0.025 });
    const u1 = uptakeOf(base, 8, 0, 20, 1, 6, null, n, p);
    const u2 = uptakeOf({ ...base, NO3: 24 }, 8, 0, 20, 1, 6, null, n, p);
    expect(u2.NO3 / u1.NO3).toBeLessThan(1.1);
    const hiK = uptakeOf({ ...base, K: 15 }, 8, 0.2, 20, 1, 6, null, n, p);
    const lowK = uptakeOf(base, 8, 0.2, 20, 1, 6, null, n, p);
    expect(hiK.Ca).toBeLessThan(lowK.Ca);
    const fe6 = uptakeOf(base, 8, 0.2, 20, 1, 6, null, n, p);
    const fe78 = uptakeOf(base, 8, 0.2, 20, 1, 7.8, null, n, p);
    expect(fe78.Fe).toBeLessThan(fe6.Fe * 0.3);
    // 뿌리 활력이 낮으면 능동 흡수가 줄어든다
    const weak = uptakeOf(base, 8, 0, 20, 0.3, 6, null, n, p);
    expect(weak.K).toBeLessThan(u1.K * 0.5);
  });
});

describe('근권 — 생육 단계별 EC·pH 프로그램', () => {
  it('단계별 pH를 비우면 기본 pH, 적으면 그 날부터 바뀐다', () => {
    const cfg = defaultRzConfig(p, 'cucumber', 'buyeo');
    const nut = { ...cfg.nut, phTarget: 5.6, ecProgram: [[0, 2.0], [30, 2.4, 5.9], [60, 2.6]] as ([number, number] | [number, number, number])[] };
    expect(phTargetAt(nut, 10)).toBeCloseTo(5.6);
    expect(phTargetAt(nut, 40)).toBeCloseTo(5.9);
    expect(phTargetAt(nut, 70)).toBeCloseTo(5.9); // 세 번째 단계는 pH를 안 적었으니 앞 단계 유지
    expect(ecTargetAt(nut, 70)).toBeCloseTo(2.6);
  });
  it('와사비 담액수경 기본값: 전량 교체 없이 상시 소량 갱신(주 8%)', () => {
    const cfg = defaultRzConfig(p, 'wasabi', 'buyeo');
    expect(cfg.irr.renewDays).toBe(0);
    expect(cfg.irr.bleed).toBeCloseTo(8);
    expect(cfg.nut.phTarget).toBeCloseTo(6.0);
  });
});

describe('근권 — 결정론·물리 타당성(V2)', () => {
  it('같은 seed + 같은 조치 → 근권 상태까지 비트 단위로 같다', () => {
    const w = createWorld({ ...config, crop: { day: 1, order: { cropId: 'cucumber', varietyId: 'cheongchun', system: 'semiforcing', density: 2.2, plan: { trainEvery: 3, lateralKeep: 1, removeBelowNode: 5, maxFruit: 0, deleafEvery: 7, leavesKeep: 20, pinchNode: 0, harvestEvery: 1, harvestWeight: 0 } } } }, data);
    const run = () => {
      let s = createInitialState(w);
      for (let i = 0; i < 24 * 10; i++) s = stepHour(s, w, []);
      return fingerprint(s);
    };
    expect(run()).toBe(run());
  });
});

describe('근권 — 생리 시나리오(V3) ①–⑧', () => {
  let s: ReturnType<typeof scenarios>;
  beforeAll(() => {
    s = scenarios();
  }, 600_000);

  it('① 물만 주면 질소 결핍이 하엽부터 → 아래 잎 광합성↓ → 생장 둔화 → 정지', () => {
    const { std, water } = s.water;
    // 10–30일: 하위엽 질소가 신엽보다 먼저, 더 낮게
    expect(avg(water, 10, 30, (o) => low(o, 'NO3'))).toBeLessThan(avg(water, 10, 30, (o) => up(o, 'NO3')));
    expect(avg(water, 10, 30, (o) => low(o, 'NO3'))).toBeLessThan(avg(std, 10, 30, (o) => low(o, 'NO3')) * 0.6);
    // 첫 주 안에 아래 잎 계수가 위 잎보다 먼저 떨어진다
    const firstLow = water.rzDays.findIndex((o) => o.out.supply.photo[2] < 0.9);
    const firstTop = water.rzDays.findIndex((o) => o.out.supply.photo[0] < 0.9);
    expect(firstLow).toBeGreaterThanOrEqual(0);
    expect(firstLow).toBeLessThanOrEqual(firstTop < 0 ? 999 : firstTop);
    // 생장 둔화 → 정지
    expect(water.crop.out.lai).toBeLessThan(std.crop.out.lai * 0.2);
    expect(avg(water, 30, 60, (o) => o.out.supply.expand)).toBeLessThan(0.3);
  });

  it('② 중탄산 많은 원수 + 산 미주입 → 근권 pH↑ → 신엽 철 결핍(위 잎 광합성↓)', () => {
    const { std } = s.water;
    const r = s.bicarb.noAcid;
    expect(s.bicarb.alk).toBeGreaterThan(3);
    expect(avg(r, 10, 90, (o) => o.out.pH)).toBeGreaterThan(avg(std, 10, 90, (o) => o.out.pH) + 0.6);
    expect(avg(r, 40, 90, (o) => up(o, 'Fe'))).toBeLessThan(avg(std, 40, 90, (o) => up(o, 'Fe')) * 0.4);
    // 철은 재전류되지 않아 신엽(위)부터: 위 잎 계수 < 아래 잎 계수
    expect(avg(r, 40, 90, (o) => o.out.supply.photo[0])).toBeLessThan(avg(r, 40, 90, (o) => o.out.supply.photo[2]) - 0.3);
  });

  it('③ A탱크에 황산염·인산을 같이 → 석고·인산칼슘 침전, 칼슘 손실, 점적 막힘', () => {
    const { mixGood, mixBad, precip } = s.precip;
    expect(mixBad.gypsum).toBeGreaterThan(0);
    expect(mixBad.ions.Ca).toBeLessThan(mixGood.ions.Ca * 0.5);
    expect(precip.final.rz.clog).toBeGreaterThan(0.3);
    expect(precip.events.some((e) => e.startsWith('rootzone:clog'))).toBe(true);
    expect(avg(precip, 30, 90, (o) => low(o, 'Ca'))).toBeLessThan(avg(s.water.std, 30, 90, (o) => low(o, 'Ca')) * 0.7);
  });

  it('④ 배액률 0% 장기 → 근권 EC 축적 → 염해(G6)', () => {
    const r = s.noDrain.noDrain;
    const std = s.water.std;
    expect(r.final.rz.total.drain).toBeLessThan(r.final.rz.total.feed * 0.1);
    expect(avg(r, 40, 90, (o) => o.out.ec)).toBeGreaterThan(avg(std, 40, 90, (o) => o.out.ec) * 1.5);
    expect(avg(r, 40, 90, (o) => o.out.supply.salt)).toBeLessThan(0.8);
    expect(r.crop.total.top + r.crop.total.mid).toBeLessThan((std.crop.total.top + std.crop.total.mid) * 0.8);
  });

  it('⑤ 칼륨 과다 → 칼슘·마그네슘 흡수 감소(길항)', () => {
    const r = s.kHeavy.kHeavy;
    const std = s.water.std;
    expect(avg(r, 30, 90, (o) => o.out.ions.K)).toBeGreaterThan(avg(std, 30, 90, (o) => o.out.ions.K) * 1.3);
    expect(avg(r, 30, 90, (o) => low(o, 'Ca'))).toBeLessThan(avg(std, 30, 90, (o) => low(o, 'Ca')) * 0.9);
    expect(avg(r, 30, 90, (o) => low(o, 'Mg'))).toBeLessThan(avg(std, 30, 90, (o) => low(o, 'Mg')));
  });

  it('⑥ 여름 와사비 양액 냉각 없음 → 양액 온도↑ → 용존산소↓ → 뿌리 장해 위험', () => {
    const { wsCool, wsWarm, wsWarmNoAir } = s.wasabi;
    expect(avg(wsWarm, 40, 120, (o) => o.out.rootT)).toBeGreaterThan(avg(wsCool, 40, 120, (o) => o.out.rootT) + 4);
    expect(avg(wsWarm, 40, 120, (o) => o.out.dO)).toBeLessThan(avg(wsCool, 40, 120, (o) => o.out.dO));
    expect(avg(wsWarm, 40, 120, (o) => o.out.rootAct)).toBeLessThan(0.8);
    expect(Math.min(...wsWarmNoAir.rzDays.map((o) => o.out.dO))).toBeLessThan(4);
    expect(wsWarmNoAir.final.rz.health).toBeLessThan(wsCool.final.rz.health);
  });

  it('⑦ 질량 보존: 물·이온·식물 양분 장부 오차 < 1%, 음수 없음', () => {
    for (const r of [s.water.std, s.water.water, s.noDrain.noDrain, s.wasabi.wsCool, s.tipburn.sbStd, s.precip.precip]) {
      const m = massBalance(r.final.rz);
      expect(m.water).toBeLessThan(0.01);
      expect(m.maxIon).toBeLessThan(0.01);
      expect(m.plant).toBeLessThan(0.01);
      for (const i of IONS) expect(r.final.rz.ions[i]).toBeGreaterThanOrEqual(0);
      const pl = r.final.rz.plant;
      if (pl) for (const i of IONS) expect(pl.up[i] + pl.low[i] + pl.str[i] + pl.fr[i]).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('⑧ 고습 + 급속 생장 → 딸기 어린 잎 칼슘 공급↓, 팁번 위험 지수↑', () => {
    const { sbStd, sbHumid } = s.tipburn;
    expect(avg(sbHumid, 20, 50, (o) => o.vpd)).toBeLessThan(avg(sbStd, 20, 50, (o) => o.vpd) * 0.7);
    expect(avg(sbHumid, 20, 50, (o) => o.caRatio)).toBeLessThan(avg(sbStd, 20, 50, (o) => o.caRatio));
    expect(avg(sbHumid, 20, 50, (o) => o.out.supply.tipburn)).toBeGreaterThan(avg(sbStd, 20, 50, (o) => o.out.supply.tipburn));
    expect(avg(sbHumid, 20, 50, (o) => up(o, 'Ca'))).toBeLessThan(avg(sbStd, 20, 50, (o) => up(o, 'Ca')));
  });
});

void CUC;
