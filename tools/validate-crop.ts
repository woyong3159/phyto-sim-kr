// Phase 3a 검증(V3·V4) 실행기: RUN=crop npx vite-node tools/validate-crop.ts → docs/VALIDATION_PHASE3A.md
import { writeFileSync } from 'node:fs';
import { createInitialState, createWorld, defaultOrder, defaultSettings, defaultSetup, stepHour, type ControlSettings, type CropDay, type CropState, type GhSetup, type PlantOrder, type SimConfig, type SimState, type UserAction, type WorkPlan } from '../src/engine';
import { data } from './validate-greenhouse';

export interface CropRun {
  days: (CropDay & { dli: number; tMean: number; co2Day: number })[];
  final: SimState;
  crop: CropState;
  events: string[];
  /** 주간 평균 CO2, 총 연료 */
  fuelL: number;
}

/** 오이 표준 관리: 주간 난방 18°C, 야간 14°C, 28°C부터 환기 */
export const CUCUMBER_SETTINGS: Partial<ControlSettings> = { heatDay: 18, heatNight: 14, heatPreDawn: 15, ventTemp: 28, ventBand: 4, shadeOnW: 900, rhMax: 90 };

export function runCrop(opts: { regionId?: string; startDate: string; seed?: string; days: number; plantDay?: number; setup?: Partial<GhSetup>; settings?: Partial<ControlSettings>; order?: Partial<PlantOrder>; plan?: Partial<WorkPlan>; actions?: UserAction[] }): CropRun {
  const world0 = createWorld({ seed: 's', startDate: opts.startDate, regionId: opts.regionId ?? 'buyeo', setup: defaultSetup(), settings: defaultSettings() }, data);
  const base = defaultOrder(world0.crops, opts.order?.varietyId ?? 'cheongchun', opts.order?.system ?? 'semiforcing');
  const order: PlantOrder = { ...base, ...opts.order, plan: { ...base.plan, ...opts.plan } };
  const config: SimConfig = {
    seed: opts.seed ?? 'crop-validate',
    startDate: opts.startDate,
    regionId: opts.regionId ?? 'buyeo',
    setup: { ...defaultSetup(opts.setup?.facility ?? 'multi_pe'), ...opts.setup },
    settings: { ...defaultSettings(), ...CUCUMBER_SETTINGS, ...opts.settings },
    crop: { day: opts.plantDay ?? 3, order },
  };
  const world = createWorld(config, data);
  let s = createInitialState(world);
  const days: CropRun['days'] = [];
  const events: string[] = [];
  const repairs: UserAction[] = [];
  const acts = opts.actions ?? [];
  let co2Sum = 0;
  let co2N = 0;
  for (let i = 0; i < opts.days * 24; i++) {
    const h = s.hour;
    s = stepHour(s, world, [...acts.filter((a) => a.hour === h), ...repairs.filter((a) => a.hour === h)]);
    if (s.gh.out.ppfd > 50) {
      co2Sum += s.gh.out.co2;
      co2N++;
    }
    for (const e of s.events) {
      events.push(`${e.type}:${e.code}@${Math.floor(e.hour / 24)}`);
      if (e.type === 'equipment') repairs.push({ hour: s.hour, seq: 0, type: 'gh/repair', payload: { device: e.code } });
    }
    if (s.hour % 24 === 0 && s.crop) {
      const t = s.crop.today;
      const g = s.gh.today;
      days.push({ ...t, sPhoto: t.sPhoto / 24, sExpand: t.sExpand / 24, sFruit: t.sFruit / 24, sSet: t.sSet / 24, dli: g.dli, tMean: g.tMean / 24, co2Day: co2N ? co2Sum / co2N : 0 });
      co2Sum = 0;
      co2N = 0;
    }
  }
  return { days, final: s, crop: s.crop!, events, fuelL: s.gh.total.fuelL };
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : NaN);
const f = (v: number, d = 1) => v.toFixed(d);
/** kg m⁻² → kg/10a */
const per10a = (v: number) => v * 1000;

export function summary(r: CropRun) {
  const c = r.crop;
  const market = c.total.top + c.total.mid;
  return {
    yield10a: per10a(market),
    top10a: per10a(c.total.top),
    cull10a: per10a(c.total.cull),
    count: c.total.count,
    firstHarvestDay: c.firstHarvestHour < 0 ? -1 : (c.firstHarvestHour - c.plantedHour) / 24,
    laiMean: mean(r.days.slice(40).map((d) => d.lai)),
    laiMax: Math.max(...r.days.map((d) => d.lai)),
    gross: sum(r.days.map((d) => d.gross)),
    maint: sum(r.days.map((d) => d.maint)),
    net: sum(r.days.map((d) => d.gross - d.maint - d.growthResp)),
    dm: c.cum.dm,
    fruitShare: sum(r.days.map((d) => d.gFruit)) / Math.max(1e-9, sum(r.days.map((d) => d.gLeaf + d.gStem + d.gRoot + d.gFruit))),
    aborted: c.abortedTotal,
    labor: sum(Object.values(c.laborHours)),
    nodes: c.mainNodes,
    etiolation: c.out.etiolation,
    dead: c.dead ? c.deathCause : '',
    ssr: mean(r.days.slice(40).map((d) => (d.demand > 0 ? d.supply / d.demand : 1))),
    fuelL: r.fuelL,
  };
}

if (process.env.RUN === 'crop') {
  const b = { startDate: '2026-02-01', days: 150 };
  const row = (name: string, r: CropRun) => {
    const s = summary(r);
    return `| ${name} | ${f(s.yield10a, 0)} | ${f(s.top10a, 0)} | ${f(s.cull10a, 0)} | ${f(s.count, 0)} | ${s.firstHarvestDay < 0 ? '–' : f(s.firstHarvestDay, 0)} | ${f(s.laiMean, 2)} / ${f(s.laiMax, 2)} | ${f(s.gross, 0)} | ${f(s.net, 0)} | ${f(s.fruitShare * 100, 0)}% | ${f((100 * s.aborted) / Math.max(1e-9, s.aborted + s.count), 0)}% | ${f(s.etiolation, 2)} | ${f(s.labor, 0)} | ${s.dead || '–'} |`;
  };
  const head = '| 조건 | 상품+중품 kg/10a | 상품 | 비상품 | 수확 과실 개/m² | 첫 수확(정식 후 일) | LAI 평균/최대 | 총광합성 g CH2O/m² | 순동화 | 과실 분배 | 유과 퇴화율 | 도장 지수 | 노동 h | 고사 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const std = runCrop(b);
  const ss = summary(std);
  const bench = 9988;
  const out: string[] = [];
  out.push('# Phase 3a 검증 — 작물 생육 코어 + 오이', '', '`RUN=crop npx vite-node tools/validate-crop.ts`가 만든 문서다. 지역 부여, 연동 비닐하우스(이중 피복) 1,000 m², 청춘 백다다기 2.2주/m², 2월 1일 시작·2월 4일 정식, 150일.', '표준 관리: 난방 주간 18°C / 야간 14°C, 28°C부터 환기, 유인 3일·적엽 7일(20매 유지)·수확 매일. 근권 수분·양분은 충분(S = 1), 병해충 없음.', '');
  out.push('## ① 표준 관리와 V4 벤치마크', '', head, row('표준 관리(반촉성)', std), row('촉성(11월 15일 시작, 165일)', runCrop({ startDate: '2026-11-15', days: 165 })), row('억제(8월 20일 시작, 110일)', runCrop({ startDate: '2026-08-20', days: 110 })), row('피복 2년차(평균 농가 조건)', runCrop({ ...b, setup: { coverAge: 2 } })), '');
  out.push(`- 농산물소득자료집 반촉성 오이: **${bench.toLocaleString('ko-KR')} kg/10a**. 모델 표준 관리: **${f(ss.yield10a, 0)} kg/10a (${ss.yield10a > bench ? '+' : ''}${f((ss.yield10a / bench - 1) * 100, 0)}%)**.`, `- 판정: **±25% 범위 ${Math.abs(ss.yield10a / bench - 1) <= 0.25 ? '안' : '밖'}**. 지금 모델은 병해충이 없고 양수분이 항상 충분한 "잠재 수량"이다. 조사 평균에는 토경·지온 부족·노균병·흰가루병·일손 부족으로 인한 감수가 들어 있다. 근권(Phase 4)·생리장해(5)·병해충(6)이 들어간 뒤 다시 판정한다. 수치를 억지로 맞추지 않았다.`, `- 건물 생산 ${f(std.crop.cum.dm, 0)} g/m² (150일), 과실 분배 ${f(ss.fruitShare * 100, 0)}% — Marcelis(1994)의 40–90% 주기 변동 범위 안.`, '');
  out.push('### 주별 경과(표준 관리)', '', '| 정식 후 주 | 평균기온 °C | DLI mol | LAI | 마디 | 달린 과실/주 | 총광합성 | 과실 생장 g/m²/d | 공급/수요 | 주간 수확 kg/10a | 퇴화 개/m² |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (let w = 0; (w + 1) * 7 <= std.days.length; w++) {
    const d = std.days.slice(w * 7, w * 7 + 7);
    const l = d[6]!;
    out.push(`| ${w + 1} | ${f(mean(d.map((x) => x.tMean)))} | ${f(mean(d.map((x) => x.dli)))} | ${f(l.lai, 2)} | ${l.nodes} | ${f(l.fruits, 1)} | ${f(mean(d.map((x) => x.gross)))} | ${f(mean(d.map((x) => x.gFruit)))} | ${f(sum(d.map((x) => x.supply)) / Math.max(1e-9, sum(d.map((x) => x.demand))), 2)} | ${f(per10a(sum(d.map((x) => x.harvest.top + x.harvest.mid))), 0)} | ${f(sum(d.map((x) => x.aborted)), 1)} |`);
  }
  out.push('', '## ② 전 기간 50% 차광 · ③ 야간 고온 + 약광', '', head, row('표준', std), row('② 차광 55% 상시', runCrop({ ...b, setup: { shade: 's55' }, settings: { shadeOnW: 0 } })), row('③ 차광 + 야간 21°C', runCrop({ ...b, setup: { shade: 's55' }, settings: { shadeOnW: 0, heatNight: 21, heatPreDawn: 21, heatDay: 21 } })), '');
  out.push('## ⑥ CO2 800 vs 400 ppm', '', head, row('무시비', std), row('액화탄산 800 ppm(6–18시, 환기 중에도 공급)', runCrop({ ...b, setup: { co2: 'liquid' }, settings: { co2Target: 800, co2VentMax: 100, co2Start: 6, co2End: 18 } })), '', '군락 단위 계산(LAI 2.5, 직달 500 + 산란 300 μmol, 25°C)에서 800 ppm은 400 ppm보다 총광합성이 15–50% 높다(단위 테스트로 확인). 실제 온실에서는 봄철 환기로 농도가 희석되어 수량 효과가 그보다 작다.', '');
  out.push('## ⑦ 재식밀도', '', head, ...[1.5, 2.2, 3, 4].map((d) => row(`${d} 주/m²`, d === 2.2 ? std : runCrop({ ...b, order: { density: d } }))), '');
  out.push('## ⑧ 적엽 · 기타 작업 방치', '', head, row('표준(적엽 7일, 20매)', std), row('적엽 안 함', runCrop({ ...b, plan: { deleafEvery: 0 } })), row('3.5주/m² 적엽함', runCrop({ ...b, order: { density: 3.5 } })), row('3.5주/m² 적엽 안 함', runCrop({ ...b, order: { density: 3.5 }, plan: { deleafEvery: 0 } })), row('유인·곁순 정리 안 함', runCrop({ ...b, plan: { trainEvery: 0 } })), row('수확 3일 간격', runCrop({ ...b, plan: { harvestEvery: 3 } })), row('수확 안 함', runCrop({ ...b, plan: { harvestEvery: 0 } })), '', '- 적엽을 안 하면 LAI가 과다해지고 **잎 면적당 순동화와 유지호흡 효율이 크게 떨어진다.** 다만 군락 전체 순동화는 줄지 않고 포화한다(표준 밀도에서는 오히려 늘어난다). 현장에서 적엽이 필요한 주된 이유인 통풍·습도·병 발생과 과실 착색은 Phase 6(병해충)에서 연결된다 — KNOWN_LIMITS 참조.', '');
  out.push('## 품종', '', head, ...['cheongchun', 'ipchu', 'gyeousari', 'gasiA'].map((v) => row(v, v === 'cheongchun' ? std : runCrop({ ...b, order: { varietyId: v } }))), '');
  out.push('## 실패 허용(N4)', '', head, row('2월 무가온(부여)', runCrop({ ...b, setup: { heater: 'none' } })), row('1월 무가온·커튼 없음(철원, 20일)', runCrop({ startDate: '2026-01-05', days: 20, regionId: 'cheorwon', setup: { heater: 'none', curtainLayers: 0, coverLayers: 1 } })), '');
  const c = std.crop.cum;
  out.push('## 탄소 수지(V2)', '', `- 총광합성 ${f(c.gross)} − 유지호흡 ${f(c.maint)} − 생장에 쓴 당 ${f(c.used)} − 저장고 ${f(std.crop.pool)} = ${(c.gross - c.maint - c.used - std.crop.pool).toExponential(2)} g CH2O/m² (오차 ${(Math.abs(c.gross - c.maint - c.used - std.crop.pool) / c.gross * 100).toExponential(1)}%)`, `- 쓴 당의 탄소 ${f(c.used * 0.4)} = 건물 탄소 ${f(c.dmC)} + 생장호흡 탄소 ${f((c.rgCO2 * 12) / 44)} g C/m²`, '');
  writeFileSync(new URL('../docs/VALIDATION_PHASE3A.md', import.meta.url), out.join('\n') + '\n');
  console.log(out.join('\n'));
}
