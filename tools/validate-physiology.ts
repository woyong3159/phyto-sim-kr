// Phase 5 검증(V3) 실행기: RUN=physiology npx vite-node tools/validate-physiology.ts → docs/VALIDATION_PHASE5.md
import { writeFileSync } from 'node:fs';
import { defaultSettings, type SimState, type UserAction } from '../src/engine';
import { runCrop, STRAWBERRY_SETTINGS, type CropRun } from './validate-crop';

export interface DayRec {
  d: number;
  dorm: number;
  lai: number;
  runners: number;
  female: number;
  nodes: number;
  internode: number;
  height: number;
  top: number;
  mid: number;
  cull: number;
  malformed: number;
  count: number;
  tox: Record<string, number>;
  dis: Record<string, { I: number; R: number; loss: number }>;
  used: number;
  cap: number;
  hf: number;
  deferred: string[];
}

export interface PhysRun {
  run: CropRun;
  rec: DayRec[];
}

function rec(s: SimState): DayRec | null {
  const c = s.crop;
  if (!c) return null;
  const dis: DayRec['dis'] = {};
  for (const [k, v] of Object.entries(s.phys.dis)) dis[k] = { I: v.I, R: v.R, loss: v.loss };
  return {
    d: Math.floor(s.hour / 24),
    dorm: c.sb?.dorm ?? 0,
    lai: c.out.lai,
    runners: c.sb?.runners ?? 0,
    female: c.out.femaleRate,
    nodes: c.mainNodes,
    internode: c.mainNodes ? (c.out.stemLength * 100) / c.mainNodes : 0,
    height: c.out.stemLength,
    top: c.total.top,
    mid: c.total.mid,
    cull: c.total.cull,
    malformed: c.quality?.malformed ?? 0,
    count: c.quality?.count ?? 0,
    tox: { ...s.phys.tox },
    dis,
    used: s.labor.used,
    cap: s.labor.cap,
    hf: c.harvestFrac ?? 1,
    deferred: [...(c.deferred ?? [])],
  };
}

export function runP(opts: Parameters<typeof runCrop>[0]): PhysRun {
  const out: DayRec[] = [];
  const run = runCrop({ ...opts, probe: (s) => { if (s.hour % 24 !== 0) return; const r = rec(s); if (r) out.push(r); } });
  return { run, rec: out };
}

const pgr = (day: number, id: string, ppm: number, method = 'foliar'): UserAction => ({ hour: day * 24 + 10, seq: 0, type: 'phys/pgr', payload: { id, ppm, method } });
const labor = (day: number, payload: object): UserAction => ({ hour: day * 24 + 1, seq: 0, type: 'labor/set', payload });

export const SB5 = { startDate: '2026-09-01', days: 160, plantDay: 19, order: { varietyId: 'seolhyang' } };
/** 반촉성 설향: 10월 15일 정식, 무가온(휴면 진입) → 1월 4일 가온 시작(Phase 3b 작형 검증과 같다). GA는 휴면이 깊어지는 12월 초(라벨: 보온 피복 후 약 1주) */
export const HEAT_DAY = 95;
export const GA_DAY = 60;
export const SEMI = { startDate: '2026-10-01', days: 200, plantDay: 14, order: { varietyId: 'seolhyang', system: 'semiforcing' }, setup: { heater: 'oil' as const }, settings: { heatNight: 0, heatPreDawn: 0, heatDay: 0 } };
const heatOn: UserAction = { hour: HEAT_DAY * 24, seq: 0, type: 'gh/control', payload: { ...defaultSettings(), ...STRAWBERRY_SETTINGS } };
export const CU5 = { startDate: '2026-02-01', days: 60, plantDay: 3, order: { varietyId: 'gyeousari' } };
/** 고습(환기 억제·제습 안 함·포그) + 급속 생장(CO2 900 ppm, LED 보광 16시간 일장) */
export const HUMID_FAST = { setup: { fog: true, co2: 'liquid' as const, light: 'led' as const, lightPpfd: 60 }, settings: { ventTemp: 30, rhMax: 100, fogTemp: 5, fogRhMax: 99, co2Target: 900, lightMode: 'extend' as const, photoperiod: 16 } };
export const ETH_DAYS = [5, 12];
export const LAB = { startDate: '2026-02-01', days: 110, plantDay: 3 };
export const SHORT = [60, 74];

export function scenarios() {
  // ① 지베렐린: 대조 / 적정(라벨 10 ppm, 피복 후 보온기) / 과농도(100 ppm, 개화기 두 번)
  const gaCtl = runP({ ...SEMI, actions: [heatOn] });
  const gaOk = runP({ ...SEMI, actions: [heatOn, pgr(GA_DAY, 'ga3', 10)] });
  const gaOver = runP({ ...SEMI, actions: [heatOn, ...[0, 7, 14, 21].map((k) => pgr(GA_DAY + k, 'ga3', 100))] });
  // ② 에테폰: 대조 / 150 ppm(1·3엽기 관행 범위) / 600 ppm(과농도)
  const ethCtl = runP(CU5);
  const ethOk = runP({ ...CU5, actions: ETH_DAYS.map((d) => pgr(d, 'ethephon', 150)) });
  const ethOver = runP({ ...CU5, actions: ETH_DAYS.map((d) => pgr(d, 'ethephon', 600)) });
  // ③ 팁번: 표준 / 고습·저증산 + 따뜻하게(급속 생장)
  const tbStd = runP({ ...SB5, days: 120 });
  const tbHumid = runP({ ...SB5, days: 120, ...HUMID_FAST });
  // ④ 노동 부족 2주: 수확 최성기에 자가 1명 × 2시간, 일용 안 부름 → 이후 원래대로
  const labCtl = runP(LAB);
  const labShort = runP({ ...LAB, actions: [labor(SHORT[0]!, { owners: 1, ownerHours: 6, workers: 0, autoHire: 0 }), labor(SHORT[1]!, { owners: 2, ownerHours: 8, autoHire: 2 })] });
  return { gaCtl, gaOk, gaOver, ethCtl, ethOk, ethOver, tbStd, tbHumid, labCtl, labShort };
}
export type Scen = ReturnType<typeof scenarios>;

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const win = (r: PhysRun, a: number, b: number) => r.rec.filter((x) => x.d >= a && x.d < b);
export const avgOf = (r: PhysRun, a: number, b: number, f: (x: DayRec) => number) => mean(win(r, a, b).map(f));
export const at = (r: PhysRun, d: number) => r.rec.find((x) => x.d === d) ?? r.rec[r.rec.length - 1]!;
/** 구간 수확: 상품·중품·비상품(kg m⁻²)과 상품률 */
export function harvestIn(r: PhysRun, a: number, b: number) {
  const x = at(r, a);
  const y = at(r, b);
  const top = y.top - x.top;
  const mid = y.mid - x.mid;
  const cull = y.cull - x.cull;
  const all = top + mid + cull;
  return { top, mid, cull, all, topShare: all > 0 ? top / all : NaN, marketShare: all > 0 ? (top + mid) / all : NaN };
}
export const malShare = (r: PhysRun, a: number, b: number) => {
  const x = at(r, a);
  const y = at(r, b);
  return y.count - x.count > 0 ? (y.malformed - x.malformed) / (y.count - x.count) : NaN;
};
export const maxI = (r: PhysRun, k: string) => Math.max(0, ...r.rec.map((x) => x.dis[k]?.I ?? 0));
export const hoursOver = (r: PhysRun, k: string) => r.run.final.phys.log.filter((e) => e.k === k).reduce((a, e) => a + e.hours, 0);
export const hoursOverIn = (r: PhysRun, k: string, a: number, b: number) => r.run.final.phys.log.filter((e) => e.k === k && e.d >= a && e.d < b).reduce((s, e) => s + e.hours, 0);
export const tbIdx = (r: PhysRun, a: number, b: number) => mean(r.run.rzDays.filter((d) => d.day >= a && d.day < b).map((d) => d.tipburn));

const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');
const p = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '–');
const kg = (v: number) => (v * 1000).toFixed(0);

export function report(s: Scen): string {
  const L: string[] = ['# Phase 5 검증 결과 (V3 생리 시나리오)', '', `생성: tools/validate-physiology.ts (RUN=physiology). 부여(buyeo), 결정론 seed 고정.`, ''];
  const g = (name: string, r: PhysRun) => {
    const a = GA_DAY;
    return `| ${name} | ${f(avgOf(r, a, a + 30, (x) => x.dorm))} | ${f(avgOf(r, a + 7, a + 30, (x) => x.lai))} | ${f(at(r, a + 30).runners - at(r, a).runners)} | ${f(Math.max(0, ...win(r, a, a + 30).map((x) => x.tox.ga3 ?? 0)))} | ${p(malShare(r, a, SEMI.days))} | ${kg(at(r, SEMI.days).top + at(r, SEMI.days).mid)} |`;
  };
  L.push('## ① 지베렐린(GA₃) 적정 vs 과농도 — 딸기 설향 반촉성', '', `작형: 10월 15일 정식, 무가온(휴면 진입), 정식 후 ${HEAT_DAY - SEMI.plantDay}일(1월 초)에 가온 시작. 처리: 정식 후 ${GA_DAY - SEMI.plantDay}일(12월 초, 휴면이 깊어지는 때) 경엽 살포. 적정 = 라벨 상한 10 ppm 1회, 과농도 = 100 ppm 4회(7일 간격).`, '',
    '| 처리 | 휴면 정도(처리 후 30일 평균) | LAI(처리 7–30일) | 런너 발생(30일) | 약해 최대 | 기형과율(처리 뒤 수확) | 상품+중품 kg/10a |', '|---|---|---|---|---|---|---|',
    g('대조', s.gaCtl), g('적정 10 ppm', s.gaOk), g('과농도 100 ppm × 4', s.gaOver), '',
    '- 적정 농도(라벨 10 ppm): 휴면 정도가 덜어지고 잎이 조금 커진다(엽병 신장) — 라벨 용도 "생장 촉진·휴면 타파"와 같은 방향. 약해 없음, 기형과·수량 차이 거의 없음.',
    '- 과농도(100 ppm 반복): 휴면은 더 덜어지고 잎이 더 웃자라지만, 체내 활성이 약해 문턱(25 ppm 환산)을 넘어 그동안 핀 꽃이 기형과·무른 과실이 되어 상품 수량이 준다 — 고농도·개화기 처리 시 기형과·과신장이라는 시험 보고와 같은 방향.', '');
  const e = (name: string, r: PhysRun) => `| ${name} | ${p(avgOf(r, ETH_DAYS[0]!, 35, (x) => x.female))} | ${f(at(r, 35).nodes, 1)} | ${f(at(r, 35).lai)} | ${f(at(r, 35).internode, 1)} | ${f(Math.max(0, ...r.rec.map((x) => x.tox.ethephon ?? 0)))} | ${kg(at(r, CU5.days).top + at(r, CU5.days).mid)} |`;
  L.push('## ② 에테폰 → 오이 암꽃 착생', '', `품종: 겨우살이청장(청장계, 암꽃 비율이 낮은 계통 — 에테폰을 주로 쓰는 쪽). 처리: 정식 후 ${ETH_DAYS.map((d) => d - CU5.plantDay).join('·')}일(본엽 1·3매 전후), 경엽 살포.`, '',
    '| 처리 | 암꽃 비율(처리~35일) | 원줄기 마디(35일) | LAI(35일) | 평균 절간 cm | 약해 최대 | 상품+중품 kg/10a(60일) |', '|---|---|---|---|---|---|---|',
    e('대조', s.ethCtl), e('150 ppm', s.ethOk), e('600 ppm(과농도)', s.ethOver), '',
    '- 에테폰은 암꽃 비율을 올린다 — 100–200 ppm 처리로 암꽃이 는다는 지도 기사(농민신문 1999), ethephon 250 ppm 처리로 성발현이 암꽃 쪽으로 바뀐 시험(Ku & Kim 1985)과 같은 방향.',
    '- 과농도(600 ppm)는 암꽃을 더 늘리지만 약해 문턱(250 ppm)을 넘어 마디 생성·잎 확장·절간 신장이 눌린다(생장 억제). 60일까지 수량은 암꽃 증가와 상쇄되지만 초세가 약해진다.',
    '- 오이는 에테폰 미등록 작물이라 처리할 때마다 PLS 위험 사건이 기록되고, 잔류가 0.01 mg/kg을 넘는 동안의 수확량이 "부적합 위험 수확량"으로 쌓인다.', '');
  const t = (name: string, r: PhysRun) => `| ${name} | ${f(tbIdx(r, 50, 100), 3)} | ${f(Math.max(...win(r, 50, 100).map((x) => x.dis.sb_tipburn?.R ?? 0)))} | ${hoursOverIn(r, 'sb_tipburn', 50, 100)} | ${f(maxI(r, 'sb_tipburn'))} | ${f(r.run.final.phys.dis.sb_tipburn?.loss ? r.run.final.phys.dis.sb_tipburn.loss * 10000 : 0, 0)} |`;
  L.push('## ③ 고습·저증산 + 급속 생장 → 딸기 팁번', '', '딸기 설향 촉성(9월 20일 정식). 고습·저증산 = 환기 30°C·제습 안 함·포그, 생장 촉진 = CO2 900 ppm + LED 보광 16시간 일장. 구간: 정식 후 31–81일(10월 말–12월).', '', '| 관리 | 칼슘 부족 지수 평균 | R 최대 | R>1 시간 | 발생률 최대(작기) | 잃은 잎 cm²/m² |', '|---|---|---|---|---|---|', t('표준', s.tbStd), t('고습·저증산 + 급속 생장', s.tbHumid), '',
    '- 원인 사슬: 고습 → 증산↓(어린 잎 몫은 더 줄어듦) + 생장 촉진 → 칼슘 요구↑ → 어린 잎 칼슘 공급/요구↓(Phase 4 근권·식물 양분 모델) → 팁번 위험 지수 R↑ → 발생 조건 시간·발생률↑.',
    '- 표준 관리도 한겨울(밀폐·저증산)에는 발생한다 — 촉성 딸기 겨울 팁번 관찰과 같은 방향. 잃은 잎 면적은 생장 촉진 처리 쪽 잎이 작아(LAI가 낮음) 절대량이 작게 나왔다.',
    '- 모델의 한계: 밤 습도가 높으면 근압으로 어린 잎에 칼슘이 간다는 효과는 근압 몫을 고정 비율로만 두어 약하게 반영된다(KNOWN_LIMITS P3).', '');
  const [a, b] = SHORT as [number, number];
  const l = (name: string, r: PhysRun) => {
    const h = harvestIn(r, a, b + 4);
    const late = win(r, a, b).filter((x) => x.deferred.length).length;
    const part = win(r, a, b).filter((x) => x.hf < 1).length;
    return `| ${name} | ${late} | ${part} | ${kg(h.all)} | ${p(h.topShare)} | ${p(h.marketShare)} | ${kg(harvestIn(r, b + 4, LAB.days).top)} |`;
  };
  L.push('## ④ 노동 부족 2주 → 수확 지연 → 상품률', '', `정식 후 ${a - LAB.plantDay}–${b - LAB.plantDay}일(수확 최성기)에 자가 노동 1명 × 6시간(평소 2명 × 8시간), 일용 고용 없음. 이후 원래대로.`, '',
    '| 관리 | 작업 미룬 날 | 부분 수확한 날 | 구간 수확 kg/10a | 상품(특) 비율 | 상품+중품 비율 | 회복 뒤 상품 kg/10a |', '|---|---|---|---|---|---|---|',
    l('대조', s.labCtl), l('노동 부족', s.labShort), '',
    '- 다 못 딴 오이는 다음 날까지 달려 있으며 더 커진다(과대과 → 중품·비상품). 유인·적엽도 밀려 곡과가 늘어난다. 결과는 수확 노동 시간 공식과 과실 비대 모델에서 나온 것이며, 등급 하락을 따로 정해 두지 않았다.', '');
  return L.join('\n');
}

if (process.env.RUN === 'physiology') {
  const s = scenarios();
  writeFileSync('docs/VALIDATION_PHASE5.md', report(s) + '\n');
  console.log(report(s));
}
