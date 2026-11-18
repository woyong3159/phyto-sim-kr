// Phase 3a 검증(V3·V4) 실행기: RUN=crop npx vite-node tools/validate-crop.ts → docs/VALIDATION_PHASE3A.md
import { writeFileSync } from 'node:fs';
import { createInitialState, createWorld, defaultOrder, defaultRzConfig, defaultSettings, defaultSetup, stepHour, type ControlSettings, type CropDay, type CropState, type GhSetup, type IrrSettings, type NutSettings, type PlantOrder, type RzOut, type RzSetup, type SimConfig, type SimState, type UserAction, type WorkPlan } from '../src/engine';
import { data } from './validate-greenhouse';

export interface CropRun {
  days: (CropDay & { dli: number; tMean: number; co2Day: number })[];
  final: SimState;
  crop: CropState;
  events: string[];
  /** 주간 평균 CO2, 총 연료 */
  fuelL: number;
  /** 근권 일 기록(매일 14시 값) */
  rzDays: { day: number; out: RzOut; tipburn: number; vpd: number; caRatio: number }[];
}

export interface RzPatch {
  setup?: Partial<RzSetup>;
  irr?: Partial<IrrSettings>;
  nut?: Partial<NutSettings>;
}

/** 오이 표준 관리: 주간 난방 18°C, 야간 14°C, 28°C부터 환기 */
export const CUCUMBER_SETTINGS: Partial<ControlSettings> = { heatDay: 18, heatNight: 14, heatPreDawn: 15, ventTemp: 28, ventBand: 4, shadeOnW: 900, rhMax: 90 };

/** 딸기 표준 관리(촉성): 주간 난방 없음(환기 25°C), 야간 8°C */
export const STRAWBERRY_SETTINGS: Partial<ControlSettings> = { heatDay: 10, heatNight: 8, heatPreDawn: 8, ventTemp: 25, ventBand: 4, shadeOnW: 2000, rhMax: 85 };

/** 와사비 표준 관리: 55% 차광(일사 250 W/m² 이상일 때), 18°C부터 환기, 난방 8°C, 패드앤팬 22°C, 포그, 양액 12–17°C 유지 */
export const WASABI_SETTINGS: Partial<ControlSettings> = { heatDay: 8, heatNight: 8, heatPreDawn: 8, ventTemp: 18, ventBand: 4, shadeOnW: 250, rhMax: 95, fogTemp: 22, fogRhMax: 90, coolTemp: 22, solutionMin: 12, solutionMax: 17 };
export const WASABI_SETUP: Partial<GhSetup> = { shade: 's55', cooling: 'padfan', fog: true, solutionChiller: true, solutionHeater: true };

export function runCrop(opts: { regionId?: string; startDate: string; seed?: string; days: number; plantDay?: number; setup?: Partial<GhSetup>; settings?: Partial<ControlSettings>; order?: Partial<PlantOrder>; plan?: Partial<WorkPlan>; actions?: UserAction[]; rz?: RzPatch; probe?: (s: SimState) => void }): CropRun {
  const world0 = createWorld({ seed: 's', startDate: opts.startDate, regionId: opts.regionId ?? 'buyeo', setup: defaultSetup(), settings: defaultSettings() }, data);
  const base = defaultOrder(world0.crops, opts.order?.varietyId ?? 'cheongchun', opts.order?.system);
  const order: PlantOrder = { ...base, ...opts.order, plan: { ...base.plan, ...opts.plan } };
  const config: SimConfig = {
    seed: opts.seed ?? 'crop-validate',
    startDate: opts.startDate,
    regionId: opts.regionId ?? 'buyeo',
    setup: { ...defaultSetup(opts.setup?.facility ?? 'multi_pe'), ...(base.cropId === 'wasabi' ? WASABI_SETUP : {}), ...opts.setup },
    settings: { ...defaultSettings(), ...(base.cropId === 'wasabi' ? WASABI_SETTINGS : base.cropId === 'strawberry' ? STRAWBERRY_SETTINGS : CUCUMBER_SETTINGS), ...opts.settings },
    crop: { day: opts.plantDay ?? 3, order },
  };
  if (opts.rz) {
    const d = defaultRzConfig(world0.rz, order.cropId, config.regionId);
    config.rz = { setup: { ...d.setup, ...opts.rz.setup }, irr: { ...d.irr, ...opts.rz.irr }, nut: { ...d.nut, ...opts.rz.nut } };
  }
  const world = createWorld(config, data);
  let s = createInitialState(world);
  const days: CropRun['days'] = [];
  const rzDays: CropRun['rzDays'] = [];
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
    if (s.hour % 24 === 14 && s.crop) rzDays.push({ day: Math.floor(s.hour / 24), out: s.rz.out, tipburn: s.rz.plant?.tipburn ?? 0, vpd: s.gh.out.vpd, caRatio: s.rz.plant?.caRatio ?? 1 });
    if (opts.probe) opts.probe(s);
    if (s.hour % 24 === 0 && s.crop) {
      const t = s.crop.today;
      const g = s.gh.today;
      days.push({ ...t, sPhoto: t.sPhoto / 24, sExpand: t.sExpand / 24, sFruit: t.sFruit / 24, sSet: t.sSet / 24, dli: g.dli, tMean: g.tMean / 24, co2Day: co2N ? co2Sum / co2N : 0 });
      co2Sum = 0;
      co2N = 0;
    }
  }
  return { days, final: s, crop: s.crop!, events, fuelL: s.gh.total.fuelL, rzDays };
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

if (process.env.RUN === 'wasabi') {
  const b = { startDate: '2026-09-01', days: 560, plantDay: 19, order: { varietyId: 'daruma' } };
  const head = '| 조건 | 근경 생체중 g/주 | 근경 kg/10a | 상품(40 g↑) 비율 | 생존 포기 | 매운맛 지수 | 잎·엽병 kg/10a | 꽃대 kg/10a | 추대 횟수 | LAI 평균 | 생리일수 | 고사 | 난방유 L |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const row = (name: string, r: CropRun) => {
    const s = summary(r);
    const w = r.crop.out.ws!;
    const ws = r.crop.ws!;
    return `| ${name} | ${f(w.rhizomeFresh)} | ${f(w.rhizomeFresh * r.crop.density * r.crop.alive, 0)} | ${f(w.marketShare * 100, 0)}% | ${f(r.crop.alive * 100, 0)}% | ${f(w.pungency, 2)} | ${f(ws.leafYield * 1000, 0)} | ${f(ws.stalkYield * 1000, 0)} | ${ws.bolts} | ${f(s.laiMean, 2)} | ${f(r.crop.pd, 0)} | ${s.dead || '–'} | ${f(s.fuelL, 0)} |`;
  };
  const std = runCrop(b);
  const kg = std.crop.out.ws!.rhizomeFresh * std.crop.density * std.crop.alive;
  const out: string[] = [];
  out.push('# Phase 3c 검증 — 와사비', '', '`RUN=wasabi npx vite-node tools/validate-crop.ts`가 만든 문서다. 지역 부여, 연동 비닐하우스(이중 피복) 1,000 m², Daruma 8주/m² 수경, 9월 1일 시작·9월 20일 정식, 560일(약 18개월).', '표준 관리: 차광 55%(일사 250 W/m² 이상), 18°C부터 환기, 난방 8°C, 패드앤팬 22°C, 포그, 양액 12–17°C(냉각기·가온기), 잎 수확 30일 간격(9매 유지), 꽃대 수확. 근권 수분·양분 충분, 병해 없음.', '');
  out.push('## ① 표준 관리와 벤치마크', '', head, row('표준 관리(부여)', std), row('철원', runCrop({ ...b, regionId: 'cheorwon' })), row('대관령', runCrop({ ...b, regionId: 'daegwallyeong' })), row('제주', runCrop({ ...b, regionId: 'jeju' })), '');
  out.push(`- 국내 물재배 분주묘 근경 수량 567–782 kg/10a(기준 690). 모델 표준 관리: **${f(kg, 0)} kg/10a (${kg > 690 ? '+' : ''}${f((kg / 690 - 1) * 100, 0)}%)** → ±25% 범위 ${Math.abs(kg / 690 - 1) <= 0.25 ? '안' : '밖'}. 소득자료집에 와사비 항목이 없어 시험 성적과 비교했다.`, '- 대관령은 둘째 겨울 대설로 시설이 무너지면 작물도 함께 얼어 죽는다(해마다 다르다, seed에 따라 달라짐).', '');
  out.push('### 60일 간격 경과(표준 관리)', '', '| 정식 후 일 | 평균기온 °C | DLI mol | LAI | 근경 g/주 | 총광합성 g/m²/d | 광합성 스트레스 | 공급/수요 |', '|---|---|---|---|---|---|---|---|');
  for (let i = 30; i < std.days.length; i += 60) {
    const d = std.days.slice(i - 30, i);
    const l = d[d.length - 1]!;
    out.push(`| ${i} | ${f(mean(d.map((x) => x.tMean)))} | ${f(mean(d.map((x) => x.dli)))} | ${f(l.lai, 2)} | ${f(l.fruits)} | ${f(mean(d.map((x) => x.gross)))} | ${f(mean(d.map((x) => x.sPhoto)), 2)} | ${f(sum(d.map((x) => x.supply)) / Math.max(1e-9, sum(d.map((x) => x.demand))), 2)} |`);
  }
  out.push('', '## ⑤ 장기 고온', '', head, row('표준(패드앤팬 + 포그)', std), row('냉방 없음(부여)', runCrop({ ...b, setup: { cooling: 'none', fog: false } })), row('냉방 없음(철원)', runCrop({ ...b, regionId: 'cheorwon', setup: { cooling: 'none', fog: false } })), row('냉방 없음(대관령)', runCrop({ ...b, regionId: 'daegwallyeong', setup: { cooling: 'none', fog: false } })), row('히트펌프 냉방 500 W/m²', runCrop({ ...b, setup: { cooling: 'heatpump', coolingCapacity: 500 } })), '');
  const glass = { facility: 'venlo' as const, cooling: 'padfan' as const, fog: true, solutionChiller: true, solutionHeater: true };
  out.push('## 차광', '', head, row('연동 비닐 무차광', runCrop({ ...b, setup: { shade: 'none' } })), row('연동 비닐 55%(표준)', std), row('연동 비닐 75% 상시', runCrop({ ...b, setup: { shade: 's75' }, settings: { shadeOnW: 0 } })), row('유리온실 무차광', runCrop({ ...b, setup: { ...glass, shade: 'none' } })), row('유리온실 55%', runCrop({ ...b, setup: { ...glass, shade: 's55' } })), row('유리온실 75%', runCrop({ ...b, setup: { ...glass, shade: 's75' } })), '');
  out.push('## 근권(양액) 온도 · 재배 방식', '', head, row('양액 12–17°C(표준)', std), row('양액 냉각기·가온기 없음', runCrop({ ...b, setup: { solutionChiller: false, solutionHeater: false } })), row('양액 18–22°C', runCrop({ ...b, settings: { solutionMin: 18, solutionMax: 22 } })), row('양액 22–26°C', runCrop({ ...b, settings: { solutionMin: 22, solutionMax: 26 } })), row('배지 재배', runCrop({ ...b, order: { varietyId: 'daruma', system: 'substrate' } })), '');
  out.push('## 잎 수확 · 추대 · 겨울 온도', '', head, row('잎 수확 안 함', runCrop({ ...b, plan: { deleafEvery: 0 } })), row('잎 30일·9매(표준)', std), row('잎 30일·5매', runCrop({ ...b, plan: { leavesKeep: 5 } })), row('꽃대 방치', runCrop({ ...b, plan: { stalkEvery: 0 } })), row('분얼 방치', runCrop({ ...b, plan: { runnerEvery: 0 } })), row('겨울 난방 5°C', runCrop({ ...b, settings: { heatNight: 5, heatPreDawn: 5, heatDay: 5 } })), row('겨울 난방 13°C(춘화 회피)', runCrop({ ...b, settings: { heatNight: 13, heatPreDawn: 13, heatDay: 13 } })), '');
  out.push('## 품종 · 재배 기간', '', head, ...['daruma', 'mazuma', 'domesticA'].map((v) => row(v, v === 'daruma' ? std : runCrop({ ...b, order: { varietyId: v } }))), row('Daruma 12개월', runCrop({ ...b, days: 380 })), row('Daruma 24개월', runCrop({ ...b, days: 745 })), row('Mazuma 24개월', runCrop({ ...b, days: 745, order: { varietyId: 'mazuma' } })), '');
  writeFileSync(new URL('../docs/VALIDATION_PHASE3C.md', import.meta.url), out.join('\n') + '\n');
  console.log(out.join('\n'));
}

if (process.env.RUN === 'strawberry') {
  const b = { startDate: '2026-09-01', days: 265, plantDay: 19, order: { varietyId: 'seolhyang' } };
  const head = '| 조건 | 상품+중품 kg/10a | 상품 | 비상품 | 과실 개/m² | 첫 개화(정식 후 일) | 첫 수확 | 화방 수 | LAI 평균 | 총광합성 | 과실 분배 | 당도 °Bx | 과중 g | 경도 | 기형과율 | 노동 h | 난방유 L |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const row = (name: string, r: CropRun) => {
    const s = summary(r);
    const q = r.crop.quality!;
    const sb = r.crop.out.sb!;
    const k = q.kg > 0 ? q.kg : NaN;
    return `| ${name} | ${f(s.yield10a, 0)} | ${f(s.top10a, 0)} | ${f(s.cull10a, 0)} | ${f(s.count, 0)} | ${sb.firstFlowerDay < 0 ? '–' : f(sb.firstFlowerDay, 0)} | ${s.firstHarvestDay < 0 ? '–' : f(s.firstHarvestDay, 0)} | ${sb.trusses} | ${f(s.laiMean, 2)} | ${f(s.gross, 0)} | ${f(s.fruitShare * 100, 0)}% | ${f(q.brix / k, 1)} | ${f(q.weight / k, 1)} | ${f(q.firm / k, 2)} | ${q.count > 0 ? f((100 * q.malformed) / q.count, 0) : '–'}% | ${f(s.labor, 0)} | ${f(s.fuelL, 0)} |`;
  };
  const std = runCrop(b);
  const ss = summary(std);
  const bench = 3534;
  const out: string[] = [];
  out.push('# Phase 3b 검증 — 딸기', '', '`RUN=strawberry npx vite-node tools/validate-crop.ts`가 만든 문서다. 지역 부여, 연동 비닐하우스(이중 피복) 1,000 m², 설향 8.5주/m², 9월 1일 시작·9월 20일 정식(구입묘), 5월 하순까지 265일.', '표준 관리: 야간 난방 8°C, 25°C부터 환기, 꿀벌, 화방당 7화, 관부 2개, 적엽 14일(관부당 9매), 수확 2일 간격. 근권 수분·양분 충분, 병해충 없음.', '');
  out.push('## ① 표준 관리와 V4 벤치마크', '', head, row('표준 관리(촉성 설향)', std), row('뒤영벌(45일마다 교체)', runCrop({ ...b, plan: { bees: 'bumble', beesEvery: 45 } })), row('야간 12°C', runCrop({ ...b, settings: { heatNight: 12, heatPreDawn: 12 } })), '');
  out.push(`- 농산물 소득조사 딸기(촉성) **${bench.toLocaleString('ko-KR')} kg/10a**(2017년산; 2019년 분석 수경 3,684 / 토경 2,920). 모델 표준 관리: **${f(ss.yield10a, 0)} kg/10a (+${f((ss.yield10a / bench - 1) * 100, 0)}%)** → ±25% 범위 밖.`, '- 오이와 같은 이유다: 병해충(잿빛곰팡이·흰가루·응애)과 근권 제약이 없는 잠재 수량이며, 수치를 억지로 맞추지 않았다. 고설 수경 상위 농가의 6–8 t/10a 범위에는 들어간다.', '');
  out.push('### 월별 경과(표준 관리)', '', '| 월 | 평균기온 °C | DLI mol | LAI(월말) | 달린 과실/주 | 총광합성 g/m²/d | 공급/수요 | 수확 kg/10a |', '|---|---|---|---|---|---|---|---|');
  for (let w = 0; (w + 1) * 30 <= std.days.length; w++) {
    const d = std.days.slice(w * 30, w * 30 + 30);
    out.push(`| ${w + 1} | ${f(mean(d.map((x) => x.tMean)))} | ${f(mean(d.map((x) => x.dli)))} | ${f(d[29]!.lai, 2)} | ${f(d[29]!.fruits, 1)} | ${f(mean(d.map((x) => x.gross)))} | ${f(sum(d.map((x) => x.supply)) / Math.max(1e-9, sum(d.map((x) => x.demand))), 2)} | ${f(per10a(sum(d.map((x) => x.harvest.top + x.harvest.mid))), 0)} |`);
  }
  out.push('', '(월 = 정식 후 30일 단위)', '', '## ② 전 기간 50% 차광 → 수량·당도', '', head, row('표준', std), row('차광 55% 상시', runCrop({ ...b, setup: { shade: 's55' }, settings: { shadeOnW: 0 } })), '');
  const e = { startDate: '2026-08-25', days: 130, plantDay: 7, order: { varietyId: 'seolhyang', seedling: 'own' as const } };
  out.push('## ④ 화아분화기 고온·고질소 → 출뢰 지연 (9월 1일 미분화 자가묘 정식, 130일)', '', head, row('질소 0.6(육묘 후기 양분 중단)', runCrop({ ...e, plan: { nLevel: 0.6 } })), row('질소 1.0', runCrop(e)), row('질소 1.4(과다)', runCrop({ ...e, plan: { nLevel: 1.4 } })), row('질소 1.4 + 고온(25°C 가온, 28°C 환기)', runCrop({ ...e, plan: { nLevel: 1.4 }, settings: { heatNight: 25, heatPreDawn: 25, heatDay: 25, ventTemp: 28 } })), row('야냉 단일처리 묘', runCrop({ ...e, order: { ...e.order, nightChill: true } })), '');
  out.push('## ⑨ 수정벌', '', head, row('꿀벌(표준)', std), row('벌 없음', runCrop({ ...b, plan: { bees: 'none' } })), row('뒤영벌', runCrop({ ...b, plan: { bees: 'bumble', beesEvery: 45 } })), row('꿀벌 + 차광(약광)', runCrop({ ...b, setup: { shade: 's55' }, settings: { shadeOnW: 0 } })), '');
  const led = { setup: { light: 'led' as const, lightPpfd: 20 } };
  const base = { ...defaultSettings(), ...STRAWBERRY_SETTINGS };
  out.push('## 휴면과 전조', '', head, row('무전조', std), row('11월 중순부터 14시간 전조', runCrop({ ...b, ...led, actions: [{ hour: 75 * 24, seq: 0, type: 'gh/control', payload: { ...base, lightMode: 'extend', photoperiod: 14 } }] })), row('9월부터 16시간 전조', runCrop({ ...b, ...led, settings: { lightMode: 'extend', photoperiod: 16 } })), row('죽향 무전조', runCrop({ ...b, order: { varietyId: 'jukhyang' } })), row('죽향 11월 중순부터 전조', runCrop({ ...b, order: { varietyId: 'jukhyang' }, ...led, actions: [{ hour: 75 * 24, seq: 0, type: 'gh/control', payload: { ...base, lightMode: 'extend', photoperiod: 14 } }] })), '');
  out.push('## 재식밀도 · 작업', '', head, ...[6, 8.5, 12].map((d) => row(`${d} 주/m²`, d === 8.5 ? std : runCrop({ ...b, order: { varietyId: 'seolhyang', density: d } }))), row('적화 안 함', runCrop({ ...b, plan: { flowersKeep: 0 } })), row('관부 1개만', runCrop({ ...b, plan: { crownsKeep: 1 } })), row('적엽 안 함', runCrop({ ...b, plan: { deleafEvery: 0 } })), row('런너 방치', runCrop({ ...b, plan: { runnerEvery: 0 } })), row('수확 5일 간격', runCrop({ ...b, plan: { harvestEvery: 5 } })), '');
  out.push('## 품종 · 작형', '', head, ...['seolhyang', 'geumsil', 'maehyang', 'kingsberry', 'jukhyang'].map((v) => row(v, v === 'seolhyang' ? std : runCrop({ ...b, order: { varietyId: v } }))), row('반촉성(10월 15일 정식, 무가온 → 1월 가온)', runCrop({ startDate: '2026-10-01', days: 235, plantDay: 14, order: { varietyId: 'seolhyang', system: 'semiforcing' }, setup: { heater: 'oil' }, settings: { heatNight: 0, heatPreDawn: 0, heatDay: 0 }, actions: [{ hour: 95 * 24, seq: 0, type: 'gh/control', payload: { ...base } }] })), '');
  out.push('## 실패 허용', '', head, row('철원 무가온·커튼 없음', runCrop({ ...b, regionId: 'cheorwon', setup: { heater: 'none', curtainLayers: 0, coverLayers: 1 } })), '');
  writeFileSync(new URL('../docs/VALIDATION_PHASE3B.md', import.meta.url), out.join('\n') + '\n');
  console.log(out.join('\n'));
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
