import { beforeAll, describe, expect, it } from 'vitest';
import { capacityOfLabor, createInitialState, fingerprint, stepHour, type SimState, type UserAction } from '../../src/engine';
import { at, avgOf, CU5, ETH_DAYS, GA_DAY, harvestIn, hoursOverIn, LAB, malShare, maxI, runP, scenarios, SEMI, SHORT, tbIdx, win, type Scen } from '../../tools/validate-physiology';
import { worldOf } from './helpers';

describe('생장조절제 — 체내 활성·등록·PLS(V1)', () => {
  const w = worldOf({ startDate: '2026-02-01', crop: { day: 0, order: { cropId: 'cucumber', varietyId: 'cheongchun', system: 'semiforcing', density: 2, plan: { trainEvery: 3, lateralKeep: 0, removeBelowNode: 5, maxFruit: 0, deleafEvery: 7, leavesKeep: 18, pinchNode: 0, harvestEvery: 1, harvestWeight: 0 } } } });
  const run = (acts: UserAction[], hours: number) => {
    let s: SimState = createInitialState(w);
    const ev: string[] = [];
    for (let i = 0; i < hours; i++) {
      s = stepHour(s, w, acts.filter((a) => a.hour === s.hour));
      for (const e of s.events) ev.push(`${e.type}:${e.code}`);
    }
    return { s, ev };
  };
  it('체내 활성은 반감기대로 줄어든다(GA₃ 반감기 3일)', () => {
    const { s } = run([{ hour: 10, seq: 0, type: 'phys/pgr', payload: { id: 'ga3', ppm: 10, method: 'foliar' } }], 11 + 72);
    expect(s.phys.pgr.ga3!.plant).toBeCloseTo(5, 1);
  });
  it('오이에 에테폰(미등록) → PLS 위험 사건, 지베렐린(제품 적용작물에 오이) → 사건 없음', () => {
    const a = run([{ hour: 10, seq: 0, type: 'phys/pgr', payload: { id: 'ethephon', ppm: 150, method: 'foliar' } }], 12);
    expect(a.ev).toContain('physiology:pls:ethephon');
    expect(a.s.phys.pls.events).toBe(1);
    const b = run([{ hour: 10, seq: 0, type: 'phys/pgr', payload: { id: 'ga3', ppm: 10, method: 'foliar' } }], 12);
    expect(b.ev.filter((e) => e.startsWith('physiology:pls'))).toEqual([]);
  });
  it('약해 문턱을 넘으면 약해 사건과 효과(생장 억제)가 생긴다', () => {
    const { s, ev } = run([{ hour: 10, seq: 0, type: 'phys/pgr', payload: { id: 'ethephon', ppm: 800, method: 'foliar' } }], 14);
    expect(ev).toContain('physiology:tox:ethephon');
    expect(s.phys.fx.node).toBeLessThan(0.8);
    expect(s.phys.fx.female).toBeGreaterThan(0.2);
  });
  it('노동 가용 시간 = 자가 인원 × 시간 + 고용 × 시간 × 숙련도', () => {
    expect(capacityOfLabor(w.labor, { owners: 2, ownerHours: 8, workers: 1, workerHours: 8, wage: 1, skill: 'novice', autoHire: 0 })).toBeCloseTo(16 + 8 * w.labor.skill.novice);
  });
  it('결정론: 생장조절제·노동 조치가 있어도 같은 입력 → 같은 상태', () => {
    const acts: UserAction[] = [{ hour: 10, seq: 0, type: 'phys/pgr', payload: { id: 'ethephon', ppm: 300, method: 'foliar' } }, { hour: 30, seq: 0, type: 'labor/set', payload: { owners: 1, ownerHours: 3 } }, { hour: 40, seq: 0, type: 'phys/scout', payload: null }];
    expect(fingerprint(run(acts, 24 * 6).s)).toBe(fingerprint(run(acts, 24 * 6).s));
  });
});

describe('Phase 5 시나리오(V3)', () => {
  let s: Scen;
  beforeAll(() => {
    s = scenarios();
  }, 600_000);

  it('① GA 적정: 휴면이 덜어지고 약해 없음 / 과농도: 약해 → 기형과↑, 상품 수량↓', () => {
    const a = GA_DAY;
    expect(avgOf(s.gaOk, a, a + 30, (x) => x.dorm)).toBeLessThan(avgOf(s.gaCtl, a, a + 30, (x) => x.dorm));
    expect(avgOf(s.gaOk, a + 7, a + 30, (x) => x.lai)).toBeGreaterThan(avgOf(s.gaCtl, a + 7, a + 30, (x) => x.lai));
    expect(Math.max(0, ...win(s.gaOk, a, a + 30).map((x) => x.tox.ga3 ?? 0))).toBe(0);
    expect(Math.max(0, ...win(s.gaOver, a, a + 30).map((x) => x.tox.ga3 ?? 0))).toBeGreaterThan(0.5);
    expect(malShare(s.gaOver, a, SEMI.days)).toBeGreaterThan(malShare(s.gaOk, a, SEMI.days) + 0.05);
    const yOk = at(s.gaOk, SEMI.days).top + at(s.gaOk, SEMI.days).mid;
    const yOver = at(s.gaOver, SEMI.days).top + at(s.gaOver, SEMI.days).mid;
    expect(yOver).toBeLessThan(yOk * 0.95);
  });

  it('② 에테폰 → 오이 암꽃 비율↑(문헌 방향), 과농도는 생장 억제', () => {
    const fem = (r: Scen['ethCtl']) => avgOf(r, ETH_DAYS[0]!, 35, (x) => x.female);
    expect(fem(s.ethOk)).toBeGreaterThan(fem(s.ethCtl) + 0.02);
    expect(fem(s.ethOver)).toBeGreaterThan(fem(s.ethOk));
    expect(at(s.ethOver, 35).lai).toBeLessThan(at(s.ethCtl, 35).lai);
    expect(at(s.ethOver, 35).internode).toBeLessThan(at(s.ethCtl, 35).internode);
    expect(s.ethOk.run.final.phys.pls.events).toBe(ETH_DAYS.length);
    expect(CU5.order.varietyId).toBe('gyeousari');
  });

  it('③ 고습·저증산 + 생장 촉진 → 칼슘 부족 지수↑, 팁번 발생 조건 시간↑, 발생', () => {
    expect(tbIdx(s.tbHumid, 50, 100)).toBeGreaterThan(tbIdx(s.tbStd, 50, 100) * 1.2);
    expect(hoursOverIn(s.tbHumid, 'sb_tipburn', 50, 100)).toBeGreaterThan(hoursOverIn(s.tbStd, 'sb_tipburn', 50, 100));
    expect(maxI(s.tbHumid, 'sb_tipburn')).toBeGreaterThan(maxI(s.tbStd, 'sb_tipburn'));
    expect(maxI(s.tbHumid, 'sb_tipburn')).toBeGreaterThan(0.1);
  });

  it('④ 노동 부족 2주 → 작업 밀림·부분 수확 → 상품률↓', () => {
    const [a, b] = SHORT as [number, number];
    expect(win(s.labShort, a, b).filter((x) => x.deferred.length).length).toBeGreaterThanOrEqual(7);
    expect(win(s.labShort, a, b).filter((x) => x.hf < 1).length).toBeGreaterThan(0);
    expect(win(s.labCtl, a, b).filter((x) => x.deferred.length).length).toBe(0);
    const c = harvestIn(s.labCtl, a, b + 4);
    const d = harvestIn(s.labShort, a, b + 4);
    expect(d.topShare).toBeLessThan(c.topShare - 0.2);
    expect(LAB.days).toBeGreaterThan(b);
  });

  it('V2: 발생률·위험 지수는 범위 안(0–1, 음수 없음), 원장은 하루 단위로 쌓인다', () => {
    for (const r of [s.gaOver, s.ethOver, s.tbHumid, s.labShort]) {
      for (const x of r.rec) for (const v of Object.values(x.dis)) {
        expect(v.I).toBeGreaterThanOrEqual(0);
        expect(v.I).toBeLessThanOrEqual(1);
        expect(v.R).toBeGreaterThanOrEqual(0);
        expect(v.loss).toBeGreaterThanOrEqual(0);
      }
      const log = r.run.final.phys.log;
      expect(log.every((e) => e.hours >= 0 && e.hours <= 24 && e.loss >= -1e-12)).toBe(true);
    }
  });

  it('노동 장부: 자동 일용 고용은 부른 날만 일당을 낸다', () => {
    const L = s.tbStd.run.final.labor;
    expect(L.cum.wage).toBeCloseTo((L.cum.days ?? 0) * L.set.wage, 0);
  });
});

describe('스카우팅(현실 모드)', () => {
  it('보이지 않는 장해(쓴맛과)는 순찰해도 0, 보이는 장해는 발생률이 기준 이상일 때만', () => {
    const r = runP({ ...LAB, days: 40, actions: [{ hour: 39 * 24, seq: 0, type: 'phys/scout', payload: null }] });
    const ph = r.run.final.phys;
    expect(ph.scout).not.toBeNull();
    expect(ph.scout!.obs.cu_bitter!.I).toBe(0);
    for (const [k, o] of Object.entries(ph.scout!.obs)) if (o.I > 0) expect(ph.dis[k]!.I).toBeGreaterThanOrEqual(0.02);
    expect(r.run.final.labor.cum.used).toBeGreaterThan(0);
  });
});
