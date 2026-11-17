// Phase 4 검증(V2·V3) 실행기: RUN=rootzone npx vite-node tools/validate-rootzone.ts → docs/VALIDATION_PHASE4.md
import { writeFileSync } from 'node:fs';
import { createWorld, defaultRzConfig, defaultSettings, defaultSetup, rawAlkalinity, rawWaters, stockMix, storage, IONS, type RzState } from '../src/engine';
import { data } from './validate-greenhouse';
import { runCrop, summary, type CropRun } from './validate-crop';

const world0 = createWorld({ seed: 's', startDate: '2026-02-01', regionId: 'buyeo', setup: defaultSetup(), settings: defaultSettings() }, data);
export const P = world0.rz;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');

/** 근권 일 기록에서 구간 평균 */
export function avg(r: CropRun, from: number, to: number, pick: (o: CropRun['rzDays'][number]) => number): number {
  return mean(r.rzDays.filter((d) => d.day >= from && d.day < to).map(pick));
}
const up = (o: CropRun['rzDays'][number], i: string) => (o.out.tissue as Record<string, [number, number]>)[i]?.[0] ?? NaN;
const low = (o: CropRun['rzDays'][number], i: string) => (o.out.tissue as Record<string, [number, number]>)[i]?.[1] ?? NaN;
export { up, low };

export const CUC = { startDate: '2026-02-01', days: 90 };
export const SB = { startDate: '2026-09-01', days: 150, plantDay: 14, order: { varietyId: 'seolhyang' } };
/** 고습 + 급속 생장: 32°C까지 환기 억제, 제습 없음, 15°C부터 포그, 야간 14°C·주간 18°C 난방 */
export const HUMID = { ventTemp: 32, rhMax: 100, fogTemp: 15, fogRhMax: 99, heatNight: 14, heatPreDawn: 14, heatDay: 18 };
export const WS = { startDate: '2026-05-01', days: 120, plantDay: 3, order: { varietyId: 'daruma' } };

/** 질량 보존(검증 ⑦): 물·이온별 상대 오차와 식물 양분 장부 오차 */
export function massBalance(rz: RzState) {
  const b = rz.bal;
  const st = storage(rz);
  const water = Math.abs(b.waterIn - b.waterUptake - b.waterDrain - st.water) / b.waterIn;
  const ions: Record<string, number> = {};
  for (const i of IONS) {
    if (b.ionIn[i] <= 1e-9) continue;
    const gas = i === 'HCO3' ? b.gasC : 0;
    const nit = i === 'NO3' ? b.nitrified : i === 'NH4' ? -b.nitrified : 0;
    const inflow = b.ionIn[i] + Math.max(0, gas) + Math.max(0, nit);
    ions[i] = Math.abs(b.ionIn[i] + gas + nit - b.ionUptake[i] - b.ionDrain[i] - b.ionPrecip[i] - st.ions[i]) / inflow;
  }
  // 식물: 정식 때 들여온 양 + 흡수 = 나간 양 + 지금 식물 안
  let plant = 0;
  if (rz.plant) {
    const pt = { ...rz.plant };
    for (const i of ['P', 'K', 'Ca', 'Mg'] as const) {
      const inside = pt.up[i] + pt.low[i] + pt.str[i] + pt.fr[i];
      const e = Math.abs(b.plantIn[i] + b.ionUptake[i] - b.plantOut[i] - inside) / (b.plantIn[i] + b.ionUptake[i]);
      if (e > plant) plant = e;
    }
    const nIn = b.plantIn.NO3 + b.ionUptake.NO3 + b.ionUptake.NH4;
    const nIns = pt.up.NO3 + pt.low.NO3 + pt.str.NO3 + pt.fr.NO3;
    plant = Math.max(plant, Math.abs(nIn - b.plantOut.NO3 - nIns) / nIn);
  }
  return { water, ions, maxIon: Math.max(...Object.values(ions)), plant };
}

export function scenarios() {
  const out: Record<string, unknown> = {};
  // ① 물만 주기
  const std = runCrop(CUC);
  const water = runCrop({ ...CUC, rz: { nut: { feedOn: false } } });
  out.water = { std, water };
  // ② 중탄산 높은 원수 + 산 미주입
  const raw = rawWaters(P, 'buyeo').groundwater;
  const noAcid = runCrop({ ...CUC, rz: { nut: { tanks: { ...defaultRzConfig(P, 'cucumber', 'buyeo').nut.tanks, acid: {} } } } });
  out.bicarb = { raw, alk: rawAlkalinity(P, 'buyeo', 'groundwater'), noAcid };
  // ③ A탱크에 질산칼슘 + 황산마그네슘
  const d = defaultRzConfig(P, 'cucumber', 'buyeo').nut.tanks;
  // 흔한 실수: 칼슘 탱크(A)에 황산칼륨(또는 황산마그네슘)과 인산일암모늄을 같이 녹인다
  const badA: Record<string, number> = { ...d.A, mg_sulfate: 8, k_sulfate: d.B.k_sulfate ?? 0, map: d.B.map ?? 0 };
  const badB: Record<string, number> = { ...d.B };
  delete badB.k_sulfate;
  delete badB.map;
  const mixGood = stockMix(d.A, 500, P.ferts, P.chem);
  const mixBad = stockMix(badA, 500, P.ferts, P.chem);
  const precip = runCrop({ ...CUC, rz: { nut: { tanks: { A: badA, B: badB, acid: d.acid } } } });
  out.precip = { mixGood, mixBad, precip };
  // ④ 배액률 0%(센서 관수: 용기용수량 아래에서만 조금씩)
  const noDrain = runCrop({ ...CUC, rz: { irr: { mode: 'sensor', sensorTheta: 70, dose: 40, autoDrain: false, minGap: 10 } } });
  out.noDrain = { noDrain };
  // ⑤ 칼륨 과다 처방
  const kHeavy = runCrop({ ...CUC, rz: { nut: { tanks: { A: d.A, B: { ...d.B, k_sulfate: (d.B.k_sulfate ?? 0) + 40 }, acid: d.acid } } } });
  out.kHeavy = { kHeavy };
  // ⑥ 여름 와사비: 양액 냉각 없음
  const wsCool = runCrop({ ...WS });
  const wsWarm = runCrop({ ...WS, setup: { solutionChiller: false } });
  const wsWarmNoAir = runCrop({ ...WS, setup: { solutionChiller: false }, rz: { setup: { aeration: false } } });
  out.wasabi = { wsCool, wsWarm, wsWarmNoAir };
  // ⑧ 딸기 팁번: 고습(환기 억제·포그) + 급속 생장(따뜻하게)
  const sbStd = runCrop(SB);
  const sbHumid = runCrop({ ...SB, setup: { fog: true }, settings: HUMID });
  out.tipburn = { sbStd, sbHumid };
  return out as {
    water: { std: CropRun; water: CropRun };
    bicarb: { raw: typeof raw; alk: number; noAcid: CropRun };
    precip: { mixGood: ReturnType<typeof stockMix>; mixBad: ReturnType<typeof stockMix>; precip: CropRun };
    noDrain: { noDrain: CropRun };
    kHeavy: { kHeavy: CropRun };
    wasabi: { wsCool: CropRun; wsWarm: CropRun; wsWarmNoAir: CropRun };
    tipburn: { sbStd: CropRun; sbHumid: CropRun };
  };
}

function report() {
  const s = scenarios();
  const L: string[] = [];
  const std = s.water.std;
  const lines = (name: string, r: CropRun, a: number, b: number) =>
    `| ${name} | ${f(avg(r, a, b, (o) => o.out.ec))} | ${f(avg(r, a, b, (o) => o.out.pH))} | ${f(avg(r, a, b, (o) => up(o, 'NO3')))} / ${f(avg(r, a, b, (o) => low(o, 'NO3')))} | ${f(avg(r, a, b, (o) => up(o, 'Fe')), 0)} | ${f(avg(r, a, b, (o) => up(o, 'Ca')))} / ${f(avg(r, a, b, (o) => low(o, 'Ca')))} | ${f(avg(r, a, b, (o) => up(o, 'Mg')))} / ${f(avg(r, a, b, (o) => low(o, 'Mg')))} | ${f(avg(r, a, b, (o) => o.out.supply.photo[0]))} / ${f(avg(r, a, b, (o) => o.out.supply.photo[2]))} | ${f(avg(r, a, b, (o) => o.out.supply.expand))} | ${f(avg(r, a, b, (o) => o.out.supply.salt))} | ${f(r.crop.out.lai)} | ${Math.round(summary(r).yield10a)} |`;
  const head = '| 조건 | 근권 EC | 근권 pH | 잎 N % 신엽/하위엽 | 신엽 Fe mg/kg | Ca % 신엽/하위엽 | Mg % 신엽/하위엽 | 광합성 계수 위/아래 | 엽 확장 계수 | 염해 계수 | 최종 LAI | 상품 수량 kg/10a |\n|---|---|---|---|---|---|---|---|---|---|---|---|';
  L.push('# Phase 4 검증 — 근권·양액·관수', '', '`RUN=rootzone npx vite-node tools/validate-rootzone.ts`가 만든 문서다. 지역 부여(지하수: 중탄산 많은 충적층 유형), 연동 비닐하우스 1,000 m². 오이 청춘 2월 1일 시작·2월 4일 정식 90일, 암면·배출식·일사비례 관수·네덜란드 배출식 표준액(EC 2.0→2.4, pH 5.6). 표의 값은 정식 후 표시 구간의 매일 14시 평균.', '');
  // ①
  L.push('## ① 물만 주기 → 질소 결핍이 하엽부터, 생장 둔화 → 정지', '', head);
  for (const [a, b] of [[10, 30], [30, 60], [60, 90]] as const) {
    L.push(lines(`표준 ${a}–${b}일`, std, a, b), lines(`물만 ${a}–${b}일`, s.water.water, a, b));
  }
  L.push('', '- 물만 주면 하위엽 질소가 먼저 떨어지고(재전류), 아래 잎 광합성 계수 → 엽 확장 계수 순서로 내려간다. 원수의 칼슘·마그네슘·황산은 들어오므로 그 원소는 버틴다.', '');
  // ②
  L.push('## ② 중탄산이 많은 원수 + 산 미주입 → 근권 pH↑ → 신엽 철 결핍', '', `부여 지하수 알칼리도 ${f(s.bicarb.alk)} mmol/L(HCO₃⁻ ${f(s.bicarb.alk * 61, 0)} mg/L).`, '', head);
  for (const [a, b] of [[10, 40], [40, 90]] as const) L.push(lines(`표준 ${a}–${b}일`, std, a, b), lines(`산 미주입 ${a}–${b}일`, s.bicarb.noAcid, a, b));
  L.push('');
  // ③
  const g = s.precip.mixGood;
  const bd = s.precip.mixBad;
  L.push('## ③ A탱크에 질산칼슘 + 황산염(황산마그네슘 8 kg·황산칼륨)·인산일암모늄 → 침전·성분 손실·점적 막힘', '', '| 원액 A(500 L) | 석고 침전 mol | 인산칼슘 침전 mol | 남은 Ca mmol/L(원액) | 남은 S mmol/L(원액) | 경고 |', '|---|---|---|---|---|---|');
  L.push(`| 표준(A: 질산칼슘·질산칼륨·킬레이트철) | ${f(g.gypsum, 1)} | ${f(g.caP, 1)} | ${f(g.ions.Ca, 0)} | ${f(g.ions.S, 0)} | ${g.warnings.join(' / ') || '없음'} |`);
  L.push(`| A에 황산염·인산 같이 | ${f(bd.gypsum, 1)} | ${f(bd.caP, 1)} | ${f(bd.ions.Ca, 0)} | ${f(bd.ions.S, 0)} | ${bd.warnings.join(' / ') || '없음'} |`);
  L.push('', `작기 90일 뒤 점적 막힘 지수: 표준 ${f(std.final.rz.clog, 3)}, 잘못 섞음 ${f(s.precip.precip.final.rz.clog, 3)} (0.3 주의, 0.6 경고 사건).`, '', head, lines('표준 30–90일', std, 30, 90), lines('잘못 섞음 30–90일', s.precip.precip, 30, 90), '');
  // ④
  L.push('## ④ 배액률 0% 장기 → 근권 EC↑ → 염해', '', `급액 ${f(s.noDrain.noDrain.final.rz.total.feed, 0)} L/m², 배액 ${f(s.noDrain.noDrain.final.rz.total.drain, 1)} L/m² (표준: 급액 ${f(std.final.rz.total.feed, 0)}, 배액 ${f(std.final.rz.total.drain, 0)}).`, '', head);
  for (const [a, b] of [[10, 40], [40, 90]] as const) L.push(lines(`표준 ${a}–${b}일`, std, a, b), lines(`배액 0% ${a}–${b}일`, s.noDrain.noDrain, a, b));
  L.push('');
  // ⑤
  L.push('## ⑤ 칼륨 과다 처방(B탱크 황산칼륨 +40 kg) → 길항으로 칼슘·마그네슘 흡수 감소', '', head, lines('표준 30–90일', std, 30, 90), lines('칼륨 과다 30–90일', s.kHeavy.kHeavy, 30, 90), '');
  // ⑥
  const wl = (name: string, r: CropRun) => `| ${name} | ${f(avg(r, 40, 120, (o) => o.out.rootT), 1)} | ${f(avg(r, 40, 120, (o) => o.out.dO), 1)} | ${f(Math.min(...r.rzDays.map((o) => o.out.dO)), 1)} | ${f(avg(r, 40, 120, (o) => o.out.rootAct))} | ${f(r.final.rz.health)} | ${f(r.crop.out.ws?.rhizomeFresh ?? 0, 1)} | ${r.crop.dead ? r.crop.deathCause : '–'} |`;
  L.push('## ⑥ 여름 와사비, 양액 냉각 없음 → 양액 온도↑ → 용존산소↓ → 뿌리 장해', '', '5월 1일 정식, 담액수경(DFT, 100 L/m²) 120일.', '', '| 조건 | 양액 온도 °C | 용존산소 평균 mg/L | 최저 | 뿌리 활력 | 뿌리 건강도 | 근경 g/주 | 고사 |', '|---|---|---|---|---|---|---|---|');
  L.push(wl('냉각기(12–17°C) + 에어펌프', s.wasabi.wsCool), wl('냉각 없음 + 에어펌프', s.wasabi.wsWarm), wl('냉각 없음, 에어펌프 없음', s.wasabi.wsWarmNoAir), '');
  // ⑦
  L.push('## ⑦ 질량 보존: 공급 = 흡수 + 배액 + 침전 + 저장(오차 < 1%)', '', '| 시나리오 | 물 | 이온 최대 오차 | 식물 양분 장부 |', '|---|---|---|---|');
  for (const [name, r] of [['오이 표준', std], ['물만', s.water.water], ['배액 0%', s.noDrain.noDrain], ['와사비 DFT', s.wasabi.wsCool], ['딸기 코이어', s.tipburn.sbStd]] as const) {
    const m = massBalance(r.final.rz);
    L.push(`| ${name} | ${(m.water * 100).toExponential(1)}% | ${(m.maxIon * 100).toExponential(1)}% | ${(m.plant * 100).toExponential(1)}% |`);
  }
  L.push('');
  // ⑧
  const tb = (name: string, r: CropRun) => `| ${name} | ${f(avg(r, 20, 50, (o) => o.vpd))} | ${f(avg(r, 20, 50, (o) => o.caRatio))} | ${f(avg(r, 20, 50, (o) => o.out.supply.tipburn))} | ${f(avg(r, 50, 90, (o) => o.out.supply.tipburn))} | ${f(avg(r, 20, 50, (o) => up(o, 'Ca')))} | ${f(mean(r.days.slice(20, 50).map((d) => d.gLeaf)))} |`;
  L.push('## ⑧ 고습 + 급속 생장 → 딸기 팁번 위험 지수↑', '', '9월 15일 정식 설향, 코이어. 위험 지수 = 1 − (어린 잎으로 간 칼슘 ÷ 필요량)의 이동평균 × 작물 민감도.', '', '| 조건 | 14시 VPD kPa(20–50일) | 어린 잎 칼슘 공급/필요(20–50일) | 팁번 위험 지수 20–50일(10월) | 50–90일(11–12월) | 신엽 Ca % | 잎 생장 g/m²/일 |', '|---|---|---|---|---|---|---|');
  L.push(tb('표준', s.tipburn.sbStd), tb('고습(환기 32°C·포그) + 따뜻하게', s.tipburn.sbHumid), '', '- 고습이면 어린 잎의 상대 증산이 줄어 칼슘이 생장을 따라가지 못한다. 표준 관리도 11–12월(증산↓, 생장 지속)에 위험이 커진다 — 촉성 딸기 겨울 팁번과 같은 방향.', '');
  // V4 재판정: 근권이 들어간 표준 관리
  const dig = (days: number) => [{ hour: (days - 2) * 24 + 9, seq: 0, type: 'crop/work', payload: { task: 'harvest' } }];
  const v4 = [
    ['오이 반촉성(2/1 시작, 150일)', runCrop({ startDate: '2026-02-01', days: 150 }), 9988, '농산물소득자료집 반촉성 오이(Phase 3a)', 14852],
    ['딸기 촉성 설향(9/1 시작, 265일)', runCrop({ startDate: '2026-09-01', days: 265, plantDay: 19, order: { varietyId: 'seolhyang' } }), 3534, '2017년산 소득조사 촉성 딸기(Phase 3b)', 6160],
    ['와사비 DFT(9/1 시작, 560일)', runCrop({ startDate: '2026-09-01', days: 560, plantDay: 19, order: { varietyId: 'daruma' }, actions: dig(560) }), 690, '국내 물재배 시험 성적(Phase 3c)', 644],
  ] as const;
  L.push('## V4 재판정 — 근권이 들어간 표준 관리', '', '| 작물·작형 | 상품 수량 kg/10a | Phase 3(양분 충분) | 기준 | 차이 | 판정(±25%) | 비료비 원/10a | 물값 원/10a | 급액 L/m² | 배액 L/m² |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const [name, r, bench, src, p3] of v4) {
    const y = summary(r).yield10a;
    const t = r.final.rz.total;
    const area = r.final.gh.setup.area;
    const per10a = (w: number) => Math.round((w * 1000) / area).toLocaleString('ko-KR');
    L.push(`| ${name} | ${Math.round(y).toLocaleString('ko-KR')} | ${p3.toLocaleString('ko-KR')} | ${bench.toLocaleString('ko-KR')} (${src}) | ${y >= bench ? '+' : ''}${Math.round((100 * (y - bench)) / bench)}% | ${Math.abs(y - bench) / bench <= 0.25 ? '범위 안' : '범위 밖'} | ${per10a(t.fert)} | ${per10a(t.water)} | ${f(t.feed, 0)} | ${f(t.drain, 0)} |`);
  }
  L.push('', '- 근권 제약(배지 EC 축적, 어린 잎 칼슘·붕소, 겨울 근권 저온)이 들어가 Phase 3의 잠재 수량보다 줄었다. 병해충(Phase 6)·생리장해(Phase 5)가 들어가면 더 줄어드는 방향이다.', '');
  writeFileSync(new URL('../docs/VALIDATION_PHASE4.md', import.meta.url), L.join('\n'));
  console.log(L.join('\n'));
}

if (process.env.RUN === 'rootzone') report();
