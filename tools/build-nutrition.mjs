// Phase 4 데이터 생성기: data/fertilizers.json, data/water_sources.json, data/rootzone.json, crops.json의 nutrition 항목.
// 실행: node tools/build-nutrition.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const P = (value, unit, range, tag, source, note) => ({ value, unit, range, tag, source, note });
const V = (values, unit, range, tag, source, note) => ({ values, unit, range, tag, source, note });
const E = (value, unit, range, note) => P(value, unit, range, 'EST', '', note);
const curve = (values, unit, tag, source, note) => V(values, unit, [-100000, 100000], tag, source, `사다리꼴 반응곡선 [0이 되는 하한, 1이 되는 시작, 1이 끝나는 점, 0이 되는 상한]. ${note}`);

const S_STOICH = '화학식과 원자량(IUPAC)에서 계산한 성분 함량';
const S_WUR_FERT = 'de Kreij, Voogt & Baas (1999) Nutrient solutions and water quality for soilless cultures, Brochure 196, PBG Naaldwijk (edepot.wur.nl/456342) — 비료 성분·분자량 표';
const S_SOL = '용해도: CRC Handbook of Chemistry and Physics 물 100 g당 용해도(20°C)를 물 1 L 기준으로 환산(학습 지식, 원문 미확인)';
const S_CHELATE = 'Eurofins Agro (2016) Manual nutrient solutions: Fe-DTPA 안정 pH 3.5–7.5; Fe-EDTA·Fe-EDDHA 범위는 학습 지식(EDTA 약 6.5까지, EDDHA 9 이상)';
const S_PRICE = '국내 비료상 소매가(20–25 kg 포장)의 통상 수준에 따른 추정. Phase 7에서 KAMIS·농협 가격으로 교체 예정';

// ions: mol 이온 / mol 원료. 산(HNO3, H3PO4, H2SO4)의 H+는 짝이 되는 양이온이 없는 음이온으로 나타난다(전하 수지로 pH가 계산된다).
const fert = (o) => ({
  name: o.name,
  formula: o.formula,
  kind: o.kind ?? 'salt',
  mw: P(o.mw, 'g mol⁻¹ (주성분 1 mol당 제품 질량)', [10, 2000], o.mwTag ?? 'SRC', o.mwSrc ?? S_STOICH, o.mwNote ?? '제품 1 mol(주성분 기준)의 질량.'),
  ions: o.ions,
  solubility: P(o.sol, 'g L⁻¹ (20°C)', [1, 10000], 'EST', S_SOL, o.solNote ?? '원액 탱크에서 이 농도를 넘으면 녹지 않고 가라앉는다.'),
  price: P(o.price, '원 kg⁻¹', [100, 100000], 'EST', S_PRICE, '제품 kg당 가격.'),
  ...(o.liquid ? { liquid: { purity: P(o.liquid.purity, 'g g⁻¹', [0.1, 1], 'EST', '', '시판 농도(w/w).'), density: P(o.liquid.density, 'kg L⁻¹', [0.8, 2], 'SRC', 'CRC Handbook(학습 지식) — 해당 농도 수용액의 밀도', '밀도.') } } : {}),
  ...(o.chelate ? { chelate: o.chelate } : {}),
  ...(o.blend ? { blend: o.blend } : {}),
  tank: o.tank,
  note: o.note ?? '',
});

const fertilizers = {
  ca_nitrate: fert({ name: '질산칼슘(4수염)', formula: 'Ca(NO₃)₂·4H₂O', mw: 236.15, ions: { Ca: 1, NO3: 2 }, sol: 1290, price: 1400, tank: 'A', note: '칼슘의 주 공급원. 황산염·인산염과 같은 원액 탱크에 넣으면 침전한다.' }),
  k_nitrate: fert({ name: '질산칼륨', formula: 'KNO₃', mw: 101.1, ions: { K: 1, NO3: 1 }, sol: 316, price: 2600, tank: 'AB' }),
  nh4_nitrate: fert({ name: '질산암모늄', formula: 'NH₄NO₃', mw: 80.04, ions: { NH4: 1, NO3: 1 }, sol: 1920, price: 1600, tank: 'A', note: '국내에서는 판매·보관 규제가 있는 원료다(게임에서는 구입 가능으로 둔다).' }),
  mkp: fert({ name: '인산일칼륨(MKP)', formula: 'KH₂PO₄', mw: 136.09, ions: { K: 1, P: 1 }, sol: 226, price: 3600, tank: 'B' }),
  map: fert({ name: '인산일암모늄(MAP)', formula: 'NH₄H₂PO₄', mw: 115.03, ions: { NH4: 1, P: 1 }, sol: 370, price: 2900, tank: 'B' }),
  k_sulfate: fert({ name: '황산칼륨', formula: 'K₂SO₄', mw: 174.26, ions: { K: 2, S: 1 }, sol: 111, price: 2100, tank: 'B', note: '용해도가 낮아 원액을 진하게 만들 수 없다.' }),
  kcl: fert({ name: '염화칼륨', formula: 'KCl', mw: 74.55, ions: { K: 1, Cl: 1 }, sol: 340, price: 1200, tank: 'B', note: '염소가 쌓이므로 순환식에서는 피한다.' }),
  mg_sulfate: fert({ name: '황산마그네슘(7수)', formula: 'MgSO₄·7H₂O', mw: 246.47, ions: { Mg: 1, S: 1 }, sol: 710, price: 1000, tank: 'B' }),
  mg_nitrate: fert({ name: '질산마그네슘(6수)', formula: 'Mg(NO₃)₂·6H₂O', mw: 256.41, ions: { Mg: 1, NO3: 2 }, sol: 1250, price: 1900, tank: 'A' }),
  fe_edta: fert({ name: '킬레이트철 Fe-EDTA 13%', formula: 'NaFeEDTA·3H₂O', mw: 429.6, mwTag: 'SRC', mwSrc: S_WUR_FERT, mwNote: 'Fe 13% 제품에서 Fe 1 mol당 질량(55.85 ÷ 0.13).', ions: { Fe: 1, Na: 1 }, sol: 90, price: 16000, tank: 'A', chelate: 'EDTA', note: 'pH 6.5를 넘으면 킬레이트가 풀려 철이 침전한다.' }),
  fe_dtpa: fert({ name: '킬레이트철 Fe-DTPA 11%', formula: 'Fe-DTPA', mw: 507.7, mwTag: 'SRC', mwSrc: S_WUR_FERT, mwNote: 'Fe 11% 제품에서 Fe 1 mol당 질량.', ions: { Fe: 1 }, sol: 100, price: 21000, tank: 'A', chelate: 'DTPA', note: 'pH 7.5까지 안정.' }),
  fe_eddha: fert({ name: '킬레이트철 Fe-EDDHA 6%', formula: 'Fe-EDDHA', mw: 930.8, mwNote: 'Fe 6% 제품에서 Fe 1 mol당 질량.', ions: { Fe: 1 }, sol: 60, price: 32000, tank: 'A', chelate: 'EDDHA', note: '알칼리성(pH 9)에서도 안정. 값이 비싸다.' }),
  mn_sulfate: fert({ name: '황산망간(1수)', formula: 'MnSO₄·H₂O', mw: 169.02, ions: { Mn: 1, S: 1 }, sol: 760, price: 3200, tank: 'B' }),
  zn_sulfate: fert({ name: '황산아연(7수)', formula: 'ZnSO₄·7H₂O', mw: 287.56, ions: { Zn: 1, S: 1 }, sol: 960, price: 3000, tank: 'B' }),
  boric_acid: fert({ name: '붕산', formula: 'H₃BO₃', mw: 61.83, ions: { B: 1 }, sol: 50, price: 3200, tank: 'B', note: '약산이라 전하 수지에는 거의 영향이 없다.' }),
  cu_sulfate: fert({ name: '황산구리(5수)', formula: 'CuSO₄·5H₂O', mw: 249.69, ions: { Cu: 1, S: 1 }, sol: 320, price: 5500, tank: 'B' }),
  na_molybdate: fert({ name: '몰리브덴산나트륨', formula: 'Na₂MoO₄·2H₂O', mw: 241.95, ions: { Mo: 1, Na: 2 }, sol: 840, price: 45000, tank: 'B' }),
  hno3: fert({ name: '질산(60%)', formula: 'HNO₃', kind: 'acid', mw: 63.01, ions: { NO3: 1 }, sol: 9999, solNote: '액체(무한 혼화).', price: 1300, liquid: { purity: 0.6, density: 1.37 }, tank: 'acid', note: '중탄산을 중화하고 질소도 공급한다.' }),
  h3po4: fert({ name: '인산(85%)', formula: 'H₃PO₄', kind: 'acid', mw: 98.0, ions: { P: 1 }, sol: 9999, solNote: '액체(무한 혼화).', price: 2600, liquid: { purity: 0.85, density: 1.69 }, tank: 'acid', note: '인산을 너무 많이 쓰면 인 과잉이 된다.' }),
  h2so4: fert({ name: '황산(98%)', formula: 'H₂SO₄', kind: 'acid', mw: 98.08, ions: { S: 1 }, sol: 9999, solNote: '액체(무한 혼화).', price: 900, liquid: { purity: 0.98, density: 1.84 }, tank: 'acid', note: '수소 이온 2개. 황이 쌓인다.' }),
  koh: fert({ name: '수산화칼륨', formula: 'KOH', kind: 'base', mw: 56.11, ions: { K: 1 }, sol: 1120, price: 3200, tank: 'acid', note: '빗물처럼 산성인 원수의 pH를 올릴 때 쓴다.' }),
  khco3: fert({ name: '중탄산칼륨', formula: 'KHCO₃', kind: 'base', mw: 100.12, ions: { K: 1, HCO3: 1 }, sol: 224, price: 3100, tank: 'acid', note: '완충력(중탄산)을 더한다.' }),
  // 복합비료: 단비 혼합물로 정의한다(전하가 맞는 실제 염의 조합). 이름·성분비는 시판품을 본뜬 가상 제품이다.
  comp_181818: fert({ name: '수용성 복합비료 18-18-18+미량(가상)', formula: '혼합', kind: 'blend', mw: 1000, mwTag: 'EST', mwSrc: '', mwNote: '혼합물이라 1 kg을 1 "mol"로 다룬다(성분은 blend에서 계산).', ions: {}, sol: 300, price: 4200, tank: 'B', blend: { mkp: 0.1, map: 0.21, k_nitrate: 0.313, nh4_nitrate: 0.319, mg_sulfate: 0.04, fe_edta: 0.008, mn_sulfate: 0.004, zn_sulfate: 0.002, boric_acid: 0.003, cu_sulfate: 0.0006, na_molybdate: 0.0004 }, note: '요소 없이 질산·암모늄·인산염으로 만든 범용 복합비료를 본뜸. 칼슘이 없어 질산칼슘과 함께 쓴다.' }),
  comp_13630: fert({ name: '고칼리 복합비료 13-6-30+3MgO(가상)', formula: '혼합', kind: 'blend', mw: 1000, mwTag: 'EST', mwSrc: '', mwNote: '혼합물이라 1 kg을 1 "mol"로 다룬다.', ions: {}, sol: 250, price: 3900, tank: 'B', blend: { mkp: 0.115, k_nitrate: 0.56, nh4_nitrate: 0.15, mg_sulfate: 0.17, fe_edta: 0.004, mn_sulfate: 0.001 }, note: '과실 비대기용 고칼리 비료를 본뜸.' }),
  comp_201020: fert({ name: '생육 초기 복합비료 20-10-20(가상)', formula: '혼합', kind: 'blend', mw: 1000, mwTag: 'EST', mwSrc: '', mwNote: '혼합물이라 1 kg을 1 "mol"로 다룬다.', ions: {}, sol: 300, price: 3800, tank: 'B', blend: { map: 0.164, k_nitrate: 0.429, nh4_nitrate: 0.346, mg_sulfate: 0.05, fe_edta: 0.006, mn_sulfate: 0.003, boric_acid: 0.002 }, note: '생육 초기 질소 위주 비료를 본뜸.' }),
};

// 목표 레시피(mmol/L, 미량은 μmol/L)
const S_PBG_STR = 'PBG Naaldwijk 딸기 피트 배지 기본 배양액(edepot.wur.nl/237303) — Zn은 표가 깨져 5 μmol/L로 추정';
const S_PBG_CUC = 'Sonneveld & Voogt 계열 순환식 오이 공급 평균(Netherlands J. Agric. Sci., library.wur.nl/ojs/16546): NO3 10–13, H2PO4 1.0–1.25, SO4 1.0–1.5, NH4 1.0–1.25, K 6.0–6.5, Ca 2.5–3.0, Mg 1–1.25 mmol/L; Fe 15, Mn 10, Zn 4–5, B 20–25, Cu 0.75, Mo 0.5 μmol/L';
const S_YAMA = '야마자키 배양액(山崎 1976): 딸기 N 5·P 1.5·K 3·Ca 2·Mg 1 me/L, 오이 NO3-N 13·NH4-N 1·P 3·K 6·Ca 7·Mg 4 me/L(학습 지식, 원문 미확인). 국내 딸기 연구가 기준액으로 사용(전하준 등 2013). 미량원소는 원시처방(園試処方) 값';
const recipe = (name, tag, source, note, m) => ({ name, tag, source, note, mmol: m });
const JP_MICRO = { Fe: 54, Mn: 9.1, Zn: 0.76, B: 46, Cu: 0.31, Mo: 0.1 };
const recipes = {
  pbg_cucumber: recipe('네덜란드 오이(순환식 공급액)', 'SRC', S_PBG_CUC, '범위의 중간값.', { NO3: 11.5, NH4: 1.1, P: 1.1, K: 6.25, Ca: 2.75, Mg: 1.1, S: 1.25, Fe: 15, Mn: 10, Zn: 4.5, B: 22.5, Cu: 0.75, Mo: 0.5 }),
  pbg_cucumber_open: recipe('네덜란드 오이(배출식 표준)', 'EST', 'Sonneveld & Straver (1994) 암면 오이 표준액(학습 지식, 원문 미확인)', '배출식은 배지 안 농축을 감안해 순환식보다 진하다.', { NO3: 16, NH4: 1.25, P: 1.25, K: 8, Ca: 4, Mg: 1.375, S: 1.375, Fe: 15, Mn: 10, Zn: 5, B: 25, Cu: 0.75, Mo: 0.5 }),
  pbg_strawberry: recipe('네덜란드 딸기(피트 배지)', 'SRC', S_PBG_STR, '', { NO3: 11.5, NH4: 1, P: 1, K: 5.5, Ca: 3.25, Mg: 1.25, S: 1.5, Fe: 20, Mn: 10, Zn: 5, B: 25, Cu: 0.75, Mo: 0.5 }),
  yamazaki_strawberry: recipe('야마자키 딸기', 'EST', S_YAMA, 'me/L를 mmol/L로 환산(P는 3가로 셈).', { NO3: 5, NH4: 0.5, P: 0.5, K: 3, Ca: 1, Mg: 0.5, S: 0.5, ...JP_MICRO }),
  yamazaki_cucumber: recipe('야마자키 오이', 'EST', S_YAMA, 'me/L를 mmol/L로 환산(P는 3가로 셈).', { NO3: 13, NH4: 1, P: 1, K: 6, Ca: 3.5, Mg: 2, S: 2, ...JP_MICRO }),
  enshi: recipe('원시처방(園試処方) 표준', 'EST', '일본 원예시험장 표준 배양액(학습 지식, 원문 미확인)', '범용 고농도 배양액.', { NO3: 16, NH4: 1.33, P: 1.33, K: 8, Ca: 4, Mg: 2, S: 2, ...JP_MICRO }),
  wasabi_half: recipe('와사비용 1/2 원시처방', 'EST', '', '와사비 수경 전용 표준액을 찾지 못해 원시처방의 절반(EC 1.1 안팎)으로 둔다. 냉량·저광 작물이라 저농도가 관행이라는 일반론에 근거.', { NO3: 8, NH4: 0.67, P: 0.67, K: 4, Ca: 2, Mg: 1, S: 1, Fe: 27, Mn: 4.6, Zn: 0.4, B: 23, Cu: 0.16, Mo: 0.05 }),
};

// ───── 원수 ─────
const S_GW36 = '최기영 등(1995) 양액재배 36개 농가 원수 조사, 생물환경조절학회지(koreascience JAKO199511922404537): pH 평균 6.75, EC 0.35 mS/cm, Ca 26.1, Mg 8.1, HCO3 63.1, Fe 0.14 ppm';
const S_GWGOOD = '시설원예 지하수 수질 평가(koreascience JAKO202007636555043): 양호한 지하수 평균 pH 6.61, EC 0.27, NO3-N 7.64, K 6.26, Ca 18.57, Mg 4.38, Na 20.85, Cl 18.10, HCO3 55.06, Fe 0.09 mg/L';
const S_PAPRIKA = '파프리카 수출단지 지하수(koreascience JAKO201030853097081): 평균 pH 7.2, EC 0.31, HCO3 97.8, Ca 35.7, Mg 7.35, Na 17.9 mg/L, 지역·농가별 차이 큼';
const S_HCO3 = '설향 육묘 중탄산 시험(koreascience JAKO201633056056945): 중탄산 피해는 고양, 논산·부여, 익산, 산청 등에서 많이 발생; 바람직한 HCO3 60–80 mg/L(JAKO201415641085274)';
const water = (o) => ({
  name: o.name,
  note: o.note,
  tag: o.tag,
  source: o.source,
  // mg/L 단위(성분 그대로). pH는 무차원, EC는 dS/m(참고값, 엔진은 이온으로 다시 계산).
  mgL: o.mgL,
  pH: o.pH,
  ec: o.ec,
});
const waterSources = {
  profiles: {
    gw_avg: water({ name: '지하수(내륙 평균)', tag: 'SRC', source: `${S_GW36}; ${S_GWGOOD}`, note: '두 조사의 평균적 성분. 황산은 S로 보고된 값을 SO4-S로 보았다.', mgL: { Ca: 24, Mg: 6.5, Na: 20, K: 5, Cl: 18, S: 8, NO3: 30, HCO3: 60, Fe: 0.12, Mn: 0.02, Zn: 0.04, B: 0.04, Cu: 0.01 }, pH: 6.8, ec: 0.33 }),
    gw_bicarb: water({ name: '지하수(중탄산 과다 평야)', tag: 'EST', source: `${S_HCO3}; ${S_PAPRIKA}`, note: '지역 경향은 문헌(중탄산 피해 지역), 수치는 피해 시험의 240 mg/L와 파프리카 단지 최댓값(161)을 참고한 추정.', mgL: { Ca: 55, Mg: 12, Na: 32, K: 4, Cl: 28, S: 10, NO3: 20, HCO3: 230, Fe: 0.25, Mn: 0.05, Zn: 0.03, B: 0.06, Cu: 0.01 }, pH: 7.6, ec: 0.55 }),
    gw_mountain: water({ name: '지하수(산간 화강암 지대)', tag: 'EST', source: S_PAPRIKA, note: '강원 지역 시료가 대체로 낮은 EC를 보인다는 경향에서 추정.', mgL: { Ca: 10, Mg: 2.5, Na: 7, K: 1.5, Cl: 6, S: 4, NO3: 8, HCO3: 38, Fe: 0.05, Mn: 0.01, Zn: 0.02, B: 0.01, Cu: 0.005 }, pH: 6.7, ec: 0.12 }),
    gw_coastal: water({ name: '지하수(해안·간척지)', tag: 'EST', source: '시설원예 지하수 수질 평가(JAKO202007636555043): 간척지 지하수는 염분이 높아 정수가 필요', note: '나트륨·염소가 높다. 수치는 추정.', mgL: { Ca: 40, Mg: 20, Na: 95, K: 6, Cl: 150, S: 25, NO3: 15, HCO3: 150, Fe: 0.2, Mn: 0.05, Zn: 0.03, B: 0.15, Cu: 0.01 }, pH: 7.4, ec: 0.95 }),
    gw_jeju: water({ name: '지하수(제주 화산암)', tag: 'EST', source: '', note: '제주 지하수는 경도가 낮다는 일반 경향에 따른 추정.', mgL: { Ca: 8, Mg: 6, Na: 14, K: 3, Cl: 15, S: 4, NO3: 12, HCO3: 55, Fe: 0.03, Mn: 0.005, Zn: 0.01, B: 0.02, Cu: 0.005 }, pH: 7.5, ec: 0.16 }),
    tap: water({ name: '상수도', tag: 'EST', source: '', note: '국내 정수장 수돗물의 통상 성분 범위에 따른 추정.', mgL: { Ca: 17, Mg: 4, Na: 11, K: 2.5, Cl: 14, S: 7, NO3: 8, HCO3: 42, Fe: 0.02, Mn: 0.005, Zn: 0.02, B: 0.02, Cu: 0.01 }, pH: 7.2, ec: 0.2 }),
    rain: water({ name: '빗물', tag: 'EST', source: '', note: '대기 중 CO2와 평형인 빗물(pH 5.6) + 미량의 질산·황산·해염.', mgL: { Ca: 0.4, Mg: 0.1, Na: 0.6, K: 0.2, Cl: 1, S: 0.6, NO3: 1.5, HCO3: 0.3 }, pH: 5.6, ec: 0.02 }),
  },
  regions: {
    _note: '지점별 지하수 성분 경향(EST). 문헌이 꼽은 중탄산 피해 지역(고양·논산·부여·익산·산청)과 해안·간척지, 산간, 제주를 지점에 대응시켰다.',
    buyeo: 'gw_bicarb', jeonju: 'gw_bicarb', incheon: 'gw_bicarb', jinju: 'gw_bicarb', cheonan: 'gw_bicarb',
    mokpo: 'gw_coastal', seosan: 'gw_coastal', yeosu: 'gw_coastal', pohang: 'gw_coastal',
    cheorwon: 'gw_mountain', daegwallyeong: 'gw_mountain', taebaek: 'gw_mountain', chuncheon: 'gw_mountain', wonju: 'gw_mountain', gangneung: 'gw_mountain', sokcho: 'gw_mountain', andong: 'gw_mountain', chungju: 'gw_mountain',
    jeju: 'gw_jeju', seogwipo: 'gw_jeju',
  },
  cost: {
    tap: E(800, '원 m⁻³', [300, 3000], '상수도 요금(일반용 누진 하위 구간 수준).'),
    groundwaterPump: E(0.5, 'kWh m⁻³', [0.1, 2], '지하수 양수 전력.'),
    rainCollect: E(0.85, '-', [0.5, 0.95], '지붕 빗물 집수 효율.'),
  },
};

// ───── 근권 시스템·화학·흡수 ─────
const S_DO = 'APHA Standard Methods / Benson & Krause(1984) 담수 포화 용존산소 근사식(학습 지식)';
const S_LAMBDA = 'CRC Handbook — 무한 희석 몰전도도(25°C)(학습 지식, 원문 미확인)';
const S_PKA = '표준 해리상수(25°C): 탄산 6.35·10.33, 인산 2.15·7.20·12.35, 암모늄 9.25, 물 14.0, CO2 헨리상수 0.034 mol L⁻¹ atm⁻¹';
const S_SON_EC = 'WUR(edepot.wur.nl/386055) 예시: 양이온 합 13 me/L 배양액의 EC 1.5 mS/cm';
const vg = (name, o) => ({
  name,
  volume: E(o.vol, 'L m⁻²(바닥)', [2, 60], `바닥 1 m²당 배지 부피. ${o.volNote}`),
  height: E(o.h, 'cm', [3, 30], '배지 높이(용기용수량 계산에 씀: 배지 가운데 높이의 매트릭 퍼텐셜).'),
  thetaS: E(o.ts, 'm³ m⁻³', [0.5, 0.98], '포화 수분(공극률).'),
  thetaR: E(o.tr, 'm³ m⁻³', [0, 0.3], '잔류 수분.'),
  alpha: E(o.a, 'cm⁻¹', [0.005, 0.5], 'van Genuchten α.'),
  n: E(o.n, '-', [1.1, 5], 'van Genuchten n.'),
  bypass: E(o.bp, '-', [0, 0.6], '관수한 양액 가운데 배지 용액과 섞이지 않고 바로 배액으로 빠지는 비율(선택류). 배액 EC가 급액과 배지 사이에 오는 이유.'),
  drainTau: E(0.3, 'h', [0.05, 2], '용기용수량을 넘는 물이 빠지는 시간 상수.'),
  nitrify: E(o.nit, 'h⁻¹', [0, 0.05], `배지 안 암모늄의 질산화 속도(20°C, Q10 2). 질산화는 암모늄 1 mol당 수소 이온 2 mol을 내어 근권을 산성화한다. ${o.nitNote}`),
  installCost: E(o.cost, '원 m⁻²', [0, 200000], '고설 베드·배지·점적 설치비(대략).'),
  note: o.note,
});
const rootzone = {
  systems: {
    rockwool: { kind: 'substrate', ...vg('암면(rockwool)', { vol: 9, volNote: '슬래브 100×20×7.5 cm를 2.2주/m² 재식에 맞춰 놓은 경우.', h: 7.5, ts: 0.95, tr: 0.02, a: 0.15, n: 3.0, bp: 0.05, nit: 0.0005, nitNote: '무기 배지라 미생물이 적어 느리다(하루 약 1%, 추정).', cost: 45000, note: '보수력 곡선이 평평하다가 급하게 꺾여 물 관리가 예민하다.' }) },
    coir: { kind: 'substrate', ...vg('코이어(coir)', { vol: 15, volNote: '딸기 고설 베드(폭 25 cm, 깊이 15 cm 안팎).', h: 12, ts: 0.9, tr: 0.1, a: 0.12, n: 2.0, bp: 0.08, nit: 0.0015, nitNote: '유기 배지라 질산화 미생물이 있다(하루 약 3.5%, 추정).', cost: 55000, note: '보수력이 좋고 완충력이 있다.' }) },
    peatPerlite: { kind: 'substrate', ...vg('피트+펄라이트', { vol: 18, volNote: '혼합 상토 베드.', h: 15, ts: 0.85, tr: 0.1, a: 0.08, n: 1.8, bp: 0.1, nit: 0.002, nitNote: '유기 배지라 질산화 미생물이 많다(하루 약 5%, 추정).', cost: 50000, note: '물을 많이 머금어 과습되기 쉽다.' }) },
    nft: { kind: 'hydro', name: '박막수경(NFT)', volume: E(8, 'L m⁻²', [2, 40], '거터 속 양액 + 순환 탱크 몫.'), kla: E(4, 'h⁻¹', [0.5, 10], '재포기 계수: 얇은 막으로 흘러 산소가 잘 녹는다.'), nitrify: E(0.002, 'h⁻¹', [0, 0.05], '거터·탱크 벽 생물막의 질산화(추정).'), klaAerated: E(4, 'h⁻¹', [0.5, 10], '에어펌프 효과 없음(이미 높음).'), installCost: E(60000, '원 m⁻²', [0, 200000], '설치비.'), note: '양액량이 적어 온도·농도가 빨리 변하고, 펌프가 멈추면 뿌리가 바로 마른다.' },
    dft: { kind: 'hydro', name: '담액수경(DFT)', volume: E(100, 'L m⁻²', [30, 200], '깊이 10 cm 담액.'), kla: E(0.25, 'h⁻¹', [0.05, 2], '포기하지 않을 때 수면 재포기 계수.'), nitrify: E(0.002, 'h⁻¹', [0, 0.05], '탱크 벽 생물막의 질산화(추정).'), klaAerated: E(1.8, 'h⁻¹', [0.3, 6], '에어펌프 포기 시 재포기 계수.'), installCost: E(70000, '원 m⁻²', [0, 200000], '설치비.'), note: '양액량이 많아 온도·농도가 안정적이지만 용존산소가 부족해지기 쉽다.' },
  },
  substrate: {
    psiCurve: curve([-50, -8, 0, 1], 'kPa(배지 매트릭 퍼텐셜)', 'EST', '', '배지 수분 가용도. 고형배지는 −10 kPa 부근부터 물 공급이 줄어든다는 일반론에 근거(−8 kPa 이상 1, −50 kPa에서 0). 포화(0 kPa)의 산소 부족은 기상률로 따로 계산한다.'),
    afp: curve([0.02, 0.1, 9, 10], 'm³ m⁻³(기상률)', 'EST', '', '배지 기상률(air-filled porosity)에 따른 뿌리 산소 가용도. 10% 이상이면 충분, 2% 이하면 산소 결핍.'),
    afpTempRef: E(20, '°C', [10, 30], '산소 요구 기준 온도: 근권 온도가 1°C 오를 때마다 필요한 기상률이 3% 늘어난다(호흡 증가·용존산소 감소).'),
    afpTemp: E(0.03, '°C⁻¹', [0, 0.08], '위 온도 보정 계수.'),
    tempWeight: E(0.6, '-', [0, 1], '배지 온도 = 양액 탱크 온도와 실내 기온의 가중 평균(이 값이 양액 비중). 바닥 1 m²당 열용량은 시설 데이터의 양액·배지 열용량을 공유한다.'),
  },
  hydro: {
    doTarget: curve([0.5, 4, 99, 100], 'mg L⁻¹', 'EST', '', '용존산소에 따른 뿌리 활력. 4 mg/L 이하에서 줄고 0.5 mg/L에서 0(일반 수경 지침).'),
    rootO2: E(1.5, 'mg O₂ g⁻¹ h⁻¹', [0.3, 5], '뿌리 건물 1 g의 산소 소비(20°C). 수경 뿌리 호흡 10–20 µmol O₂/g 생체중/h(건물 환산 약 3–6 mg)의 하한 쪽 추정(학습 지식).'),
    rootO2Q10: E(2, '-', [1.5, 3], '뿌리 호흡 Q10.'),
    bleed: E(8, '% 주⁻¹', [0, 100], '수경 양액 상시 소량 갱신: 일주일에 양액의 8%를 버리고 새 급액으로 채운다. 근거(2026-11 조사): 후쿠시마현 농업 연구 성과의 잎파(葉ネギ) 담액수경 — 양액을 주 8% 안팎씩 상시 갱신해도 수량이 줄지 않음; 히로시마현 잎파 담액수경 — 양액은 작기당 1회 폐기·교체; 오이 배드 재배(J-STAGE 생물환경조절 40(2):187) — 갱신 0회와 2회의 수량 차이 없음; 일반 순환 수경 관행은 2–4주마다 전량 교체(Science in Hydroponics). 와사비는 질산태를 선호하고 양분 요구가 낮다(Soil Sci. Plant Nutr. 2023, doi:10.1080/00380768.2023.2276716) — 와사비 전용 교체 주기 자료는 찾지 못해, 염류(Na·Cl) 축적을 막는 최소 갱신으로 주 8%를 기본값으로 둔다(추정). 전량 교체 주기는 0(안 함)이 기본이며 화면에서 바꿀 수 있다.'),
    pumpFail: E(2, 'h', [0.5, 12], 'NFT 펌프가 멈추면 이 시간 뒤 뿌리가 마르기 시작한다(Phase 6 장비 고장과 연결 예정).'),
  },
  doSat: V([14.62, -0.3898, 0.006969, -5.897e-5], 'mg L⁻¹ (계수: a0 + a1·T + a2·T² + a3·T³)', [-100, 100], 'SRC', S_DO, '담수 포화 용존산소(1기압). 20°C 9.1, 30°C 7.6 mg/L.'),
  chemistry: {
    lambda: { NO3: 71.4, NH4: 73.5, P: 36, K: 73.5, Ca: 119, Mg: 106, S: 160, Na: 50.1, Cl: 76.3, HCO3: 44.5, Fe: 0, Mn: 107, Zn: 106, B: 0, Cu: 107, Mo: 149, H: 349.8, OH: 198.6, CO3: 138.6, HPO4: 114 },
    lambdaInfo: P(0, 'S cm² mol⁻¹', [0, 400], 'SRC', S_LAMBDA, '위 lambda 표: 이온 1 mol당 무한 희석 몰전도도. 킬레이트철·붕산은 전하가 없는 것으로 본다.'),
    ecShrink: P(1.1, '(mol L⁻¹)^-0.5', [0, 3], 'CAL', S_SON_EC, 'EC = Σcλ × (1 − 계수 × √이온세기). 무한 희석 합 1.75 mS/cm인 예시 배양액이 1.5가 되도록 맞춘 값(원래 Kohlrausch 계수는 이온마다 다름).'),
    pKa: { carb1: 6.35, carb2: 10.33, phos1: 2.15, phos2: 7.2, phos3: 12.35, nh4: 9.25, water: 14.0, kH: 0.034 },
    pKaInfo: P(0, '-', [0, 0], 'SRC', S_PKA, '위 pKa 표(온도 보정 없음).'),
    pco2Rootzone: E(10000, 'ppm', [400, 30000], '배지 공극의 CO2 분압(뿌리 호흡으로 대기보다 훨씬 높다, 0.5–2% 범위의 중간 추정). 배지 용액은 이 분압과 평형이라고 본다.'),
    pco2Tank: E(600, 'ppm', [400, 5000], '수경 양액·순환 탱크의 CO2 분압(수면에서 대기와 교환).'),
    kspGypsum: E(1.2e-3, 'mol² L⁻²', [1e-4, 1e-2], '원액 탱크의 석고(CaSO4) 유효 용해도곱. 순수 물의 2.4 g/L(14 mM)보다 진한 질산염 용액에서 더 녹는 것을 감안한 추정.'),
    kspCaP: E(1e-4, 'mol² L⁻²', [1e-6, 1e-2], '원액 탱크의 인산칼슘(CaHPO4) 유효 용해도곱(추정).'),
    caPRate: E(0.02, 'h⁻¹ pH⁻¹', [0, 0.5], '근권 pH가 한계를 1 넘을 때 시간당 침전하는 인산칼슘 비율(Ca·P 가운데 적은 쪽 기준).'),
    caPFeed: E(6.6, '-', [6, 7.5], '희석 양액·배지 용액의 pH가 이보다 높으면 인산칼슘이 서서히 침전한다(점적 막힘·인 가급도 저하).'),
  },
  chelate: {
    EDTA: curve([-100000, -99999, 6.3, 7.3], 'pH', 'SRC', S_CHELATE, 'Fe-EDTA 안정도.'),
    DTPA: curve([-100000, -99999, 7.3, 8.0], 'pH', 'SRC', S_CHELATE, 'Fe-DTPA 안정도(제조사 표: 3.5–7.5).'),
    EDDHA: curve([-100000, -99999, 9.5, 11], 'pH', 'SRC', S_CHELATE, 'Fe-EDDHA 안정도.'),
    free: curve([-100000, -99999, 5.0, 6.0], 'pH', 'EST', '', '킬레이트 없는 철(원수의 철)은 pH 5 위에서 산화·침전한다.'),
    decay: E(0.03, 'h⁻¹', [0.001, 0.2], '안정 범위를 벗어난 킬레이트철이 침전하는 속도(1 − 안정도에 곱한다).'),
    freeRate: E(0.15, 'h⁻¹', [0.01, 1], '킬레이트되지 않은 철이 수산화철로 가라앉는 속도(1 − 가용도에 곱한다). 원수 철이 pH 6 이상에서 수 시간 안에 산화·침전한다는 일반론에서 추정.'),
  },
  // 이온별 흡수 동역학(뿌리 건물 기준). sigma: 증산류에 실려 그대로 들어가는 비율(아포플라스트 경로).
  uptake: {
    _note: 'imax: mmol (g 뿌리 건물)⁻¹ h⁻¹, km: mmol L⁻¹, sigma: 질량류 결합계수(0–1), mobility: 하위엽에서 신생 조직으로의 재전류 이동성(0–1), xylem: 증산류(물관)를 따라 분배되는 몫(나머지는 생장 요구량대로 체관·능동 분배), stem: 줄기·잎자루·뿌리의 정상 농도 ÷ 성엽 정상 농도(칼륨·염소는 줄기·잎자루에 많이 쌓인다), young: 어린 잎의 정상 농도 ÷ 표준 엽분석 시료(성엽) 정상 농도(칼슘·붕소·망간은 어린 잎에서 낮다). 값은 작물 요구량과 전형적 흡수 농도(흡수량/흡수 수분)에 맞춘 추정(EST)이다. Ca·Mg·Na·B는 질량류 의존이 크고, N·P·K는 능동 흡수가 주라는 일반론에 근거.',
    NO3: { imax: 0.12, km: 0.15, sigma: 0.3, mobility: 1, xylem: 0, young: 1, stem: 0.6 },
    NH4: { imax: 0.02, km: 0.03, sigma: 0.02, mobility: 1, xylem: 0, young: 1, stem: 0.6 },
    P: { imax: 0.012, km: 0.02, sigma: 0.02, mobility: 0.9, xylem: 0, young: 1, stem: 0.6 },
    K: { imax: 0.08, km: 0.1, sigma: 0.2, mobility: 1, xylem: 0, young: 1, stem: 1.6 },
    Ca: { imax: 0.004, km: 0.5, sigma: 0.4, mobility: 0, xylem: 1, young: 0.3, stem: 0.4 },
    Mg: { imax: 0.006, km: 0.3, sigma: 0.35, mobility: 0.7, xylem: 0.3, young: 1, stem: 0.6 },
    S: { imax: 0.008, km: 0.1, sigma: 0.15, mobility: 0.3, xylem: 0, young: 1, stem: 0.5 },
    Na: { imax: 0.0005, km: 2, sigma: 0.06, mobility: 0.2, xylem: 0.8, young: 1, stem: 1.0 },
    Cl: { imax: 0.0003, km: 1, sigma: 0.08, mobility: 0.6, xylem: 0.5, young: 1, stem: 1.5 },
    Fe: { imax: 0.00012, km: 0.005, sigma: 0.02, mobility: 0, xylem: 0, young: 1, stem: 0.5 },
    Mn: { imax: 0.00006, km: 0.004, sigma: 0.1, mobility: 0.05, xylem: 0.6, young: 0.6, stem: 0.3 },
    Zn: { imax: 0.00003, km: 0.002, sigma: 0.1, mobility: 0.3, xylem: 0, young: 1, stem: 0.6 },
    B: { imax: 0.00002, km: 0.02, sigma: 0.4, mobility: 0, xylem: 0.9, young: 0.35, stem: 0.5 },
    Cu: { imax: 0.000006, km: 0.0005, sigma: 0.05, mobility: 0.2, xylem: 0, young: 1, stem: 0.6 },
    Mo: { imax: 0.000002, km: 0.0002, sigma: 0.2, mobility: 0.5, xylem: 0, young: 1, stem: 0.5 },
  },
  uptakeInfo: E(0, '-', [0, 0], '위 uptake 표의 출처·근거 표시용(모든 값 EST).'),
  // 길항: 능동 흡수의 Km을 (1 + 길항 이온 농도 / Ki)배로 키운다(경쟁 저해).
  antagonism: {
    _note: '대상 이온: {길항 이온: Ki(mmol/L)}. 칼륨↑ → Ca·Mg 흡수↓, 암모늄↑ → Ca·K·Mg 흡수↓, 나트륨 → K·Ca, 염소 → NO3. Ki는 추정(EST).',
    Ca: { K: 4, NH4: 1.5, Na: 10, Mg: 6 },
    Mg: { K: 3, NH4: 1.5, Ca: 6 },
    K: { NH4: 2, Na: 8 },
    NO3: { Cl: 5 },
  },
  // pH에 따른 가급도(흡수 배수). 고pH: Fe·Mn·Zn·Cu·P·B↓, 저pH: Mn↑(과잉), Ca·Mg↓.
  pHAvail: {
    Fe: curve([3, 4.5, 6.2, 7.6], 'pH', 'EST', '', '철: 고pH에서 3가 철 환원 능력(Strategy I 작물)과 용해도가 떨어진다.'),
    Mn: curve([2, 3, 6.3, 7.8], 'pH', 'EST', '', '망간: 고pH에서 산화되어 가급도↓.'),
    Zn: curve([3, 4, 6.5, 8], 'pH', 'EST', '', '아연.'),
    Cu: curve([3, 4, 6.5, 8], 'pH', 'EST', '', '구리.'),
    P: curve([3, 4.5, 6.8, 8.5], 'pH', 'EST', '', '인: 고pH에서 인산칼슘으로 묶인다.'),
    B: curve([3, 4.5, 7.0, 9], 'pH', 'EST', '', '붕소.'),
    Ca: curve([3, 5, 99, 100], 'pH', 'EST', '', '칼슘: 저pH에서 H⁺ 경쟁으로 흡수↓.'),
    Mg: curve([3, 5, 99, 100], 'pH', 'EST', '', '마그네슘: 저pH에서 흡수↓.'),
  },
  mnLowPH: E(3, '-', [1, 10], 'pH 5.5에서 pH 4.5로 내려갈 때 망간 가급도가 이 배수까지 커진다(망간 과잉·독성).'),
  root: {
    chargeImbalance: E(0.15, '-', [0, 0.5], '음이온 흡수가 양이온보다 많을 수 있는 상한(양이온 당량 대비). 질산 영양에서 뿌리가 OH⁻·HCO₃⁻를 내어 근권이 알칼리화하는 폭을 정한다. 추정.'),
    cationSlack: E(0.03, '-', [0, 0.3], '양이온 흡수가 음이온보다 많을 수 있는 여유(음이온 당량 대비). 여기에 흡수한 암모늄만큼(암모늄 동화가 내는 H⁺)을 더한 것이 상한. 추정.'),
    activeRootShoot: E(0.5, 'g g⁻¹', [0.1, 2], '능동 흡수에 참여하는 뿌리 건물의 상한 = 잎 건물 × 이 값. 묵은 뿌리·저장 뿌리가 많아도 흡수 능력은 지상부가 공급하는 동화산물만큼만 유지된다는 가정(추정).'),
    regulation: E(1.5, '-', [1.05, 3], '잎 평균 농도가 적정의 이 배수에 이르면 능동 흡수가 0까지 줄어든다(하향 조절, 사치 흡수 상한).'),
    upRegulation: E(1.0, '-', [0, 3], '결핍일 때 능동 흡수 증가(1 = 결핍이 심하면 최대 2배).'),
    waterWeight: E(0.3, '-', [0, 1], '뿌리 활력 저하가 물 흡수(수분 가용도)에 미치는 비중.'),
    healthLoss: E(0.02, 'h⁻¹', [0, 0.2], '산소 가용도가 0일 때 시간당 뿌리 손상(뿌리 건강도 감소).'),
    healthGain: E(0.004, 'h⁻¹', [0, 0.05], '산소·온도가 좋을 때 뿌리 건강도 회복 속도.'),
  },
  plant: {
    youngAge: E(0.6, '-', [0.2, 1.5], '잎이 "신엽(상위엽)" 구획에 속하는 엽령(잎 확장 생리일수의 배수). 이후 성엽(하위엽)으로 넘어간다.'),
    remob: E(0.01, 'h⁻¹', [0.001, 0.05], '이동성 원소가 하위엽에서 신생 조직으로 재전류되는 최대 속도(하위엽 최저 농도 초과분에 대한 비율).'),
    senescRemob: E(0.4, '-', [0, 0.8], '낙엽·적엽으로 잃는 잎에서 미리 회수되는 이동성 원소 비율.'),
    strFactor: E(0.5, '-', [0.2, 1], '줄기·뿌리의 적정 농도 = 신엽 적정 농도 × 이 값.'),
    youngTransp: E(0.6, 'kPa', [0.1, 2], '신엽·과실의 상대 증산 = VPD ÷ (VPD + 이 값). 습하면 어린 조직으로 가는 칼슘이 줄어든다(팁번).'),
    fruitTransp: E(0.04, '-', [0, 0.3], '과실의 상대 증산(잎 대비).'),
    defFloor: E(0.2, '-', [0, 0.5], '엽분석의 "심한 결핍" 농도에서 광합성·엽 확장 등 과정이 유지되는 비율(완전히 멈추지 않는다). 질소 결핍 잎도 광합성을 일부 한다는 일반론에서 추정.'),
    rootPressure: E(0.3, '-', [0, 0.8], '물관으로 운반되는 원소(칼슘·붕소 등) 가운데 밤의 근압 흐름으로 자라는 조직에 바로 가는 몫. 나머지는 증산 비율을 따른다.'),
    rootPressureEC: E(8, 'dS m⁻¹', [3, 20], '근권 EC가 이 값이면 근압이 0. 염류가 높으면 근압이 약해져 어린 잎·과실의 칼슘이 줄어든다(팁번·배꼽썩음과 고EC의 관계, 일반론에서 추정).'),
    tipburnDays: E(2, 'd', [0.5, 7], '팁번 위험 지수의 이동평균 기간.'),
  },
  irrigation: {
    maxEventsPerHour: E(6, '회 h⁻¹', [1, 20], '한 시간에 허용하는 최대 관수 횟수(밸브·펌프 한계).'),
    autoDrainStep: E(0.15, '-', [0, 0.5], '배액률 자동 보정 이득: 어제 배액률이 목표에서 10%p 벗어날 때마다 1회 관수량을 이 비율만큼 바꾼다(최대 1.5배 폭).'),
  },
  tanks: {
    stockVolume: E(500, 'L', [50, 5000], '원액 탱크(A·B) 기본 용량.'),
    acidVolume: E(200, 'L', [20, 2000], '산 탱크 기본 용량.'),
    drainVolume: E(20, 'L m⁻²', [2, 100], '순환식 배액 회수 탱크 용량(바닥 면적당).'),
    rainVolume: E(30, 'L m⁻²', [0, 300], '빗물 저장 탱크 기본 용량(바닥 면적당).'),
    mixLabor: E(0.5, 'h 회⁻¹', [0.1, 3], '원액 탱크 한 개를 새로 타는 작업 시간.'),
    renewLabor: E(2, 'h (1000 m²)⁻¹', [0.5, 10], '수경 양액 전량 교체 작업 시간.'),
  },
  clog: {
    stockSuspended: E(0.3, '-', [0, 1], '원액 탱크 침전물 가운데 주입 때 함께 빨려 들어가는 비율.'),
    perMol: E(2, 'mol⁻¹ m²', [0, 10], '바닥 1 m²당 점적 라인으로 들어간 침전물 1 mol이 막힘 지수를 올리는 양.'),
    rawFe: E(0.004, '(mg L⁻¹)⁻¹ m³⁻¹ m²', [0, 0.05], '원수의 비킬레이트 철 1 mg/L로 1 m³(바닥 1 m²당)를 흘렸을 때 막힘 지수 증가.'),
    caP: E(0.03, '(mmol L⁻¹)⁻² m³⁻¹ m²', [0, 1], '급액 pH가 인산칼슘 침전 한계를 넘었을 때 Ca × P 1 (mmol/L)²당 막힘 지수 증가.'),
    flowLoss: E(0.6, '-', [0, 1], '막힘 지수 1일 때 점적 유량 감소 비율.'),
    flushKeep: E(0.15, '-', [0, 1], '산 세척 뒤 남는 막힘 지수 비율.'),
    flushLabor: E(4, 'h (10a)⁻¹', [1, 20], '점적 라인 산 세척 노동.'),
  },
  equipment: {
    injectorProp: E(3000, '원 m⁻²', [0, 50000], '비례 주입기(도사트론류) 설치비.'),
    injectorMix: E(12000, '원 m⁻²', [0, 100000], '양액 혼합기(EC·pH 자동) 설치비.'),
    uv: E(8000, '원 m⁻²', [0, 50000], '자외선 살균기 설치비(순환식).'),
    uvPower: E(0.05, 'kWh m⁻³', [0, 1], '자외선 살균 전력.'),
    heatDisinfect: E(10000, '원 m⁻²', [0, 50000], '열 살균기 설치비.'),
    heatPower: E(6, 'kWh m⁻³', [1, 20], '열 살균(95°C 30초, 열 회수 포함) 에너지.'),
    aeration: E(0.4, 'W m⁻²', [0, 5], 'DFT 에어펌프 전력.'),
    meter: E(350000, '원', [50000, 2000000], '휴대용 EC·pH 미터 구입비.'),
  },
  lab: {
    delay: P(72, 'h', [24, 240], 'SRC', '헌법 9항: 실험실 분석 결과 3일 지연', '분석 의뢰부터 결과까지.'),
    solution: E(20000, '원 건⁻¹', [0, 200000], '양액·배액 분석(농업기술센터·민간 분석기관의 통상 수수료 수준).'),
    tissue: E(30000, '원 건⁻¹', [0, 200000], '식물체(잎) 분석.'),
    water: E(20000, '원 건⁻¹', [0, 200000], '원수 분석.'),
  },
};

// ───── 작물별 양분 기준(잎 건물 기준) ─────
const S_LEAF = 'Mills & Jones (1996) Plant Analysis Handbook II 계열의 엽분석 적정 범위(학습 지식, 원문 미확인)';
const S_CUC_UPTAKE = '이주영 등(2011) 한국토양비료학회지 44(2):215 — 오이 100 kg 생산 양분흡수량 N 0.27, P2O5 0.08, K2O 0.40, CaO 0.31 kg';
// 값: [결핍(심함), 임계(적정 하한), 적정 상한, 독성] — 다량원소·Na·Cl은 %, 미량원소는 mg/kg
const S_LEAF_CUC = `${'Mills & Jones (1996) Plant Analysis Handbook II 계열(학습 지식)'}; 교차 확인(2026-11): OMAFRA 박과 작물 충분 범위(최근 성숙엽, 개화 전 N 3.5–6, Ca 2–4%, B 20–60 ppm), 하와이대 CTAHR(N 3.0–4.5, K 3.0–5.0, Ca 2–3%, B 25–100 ppm), de Kreij 등(1992) 시설 오이 N 4.2–5.6% — 범위 안`;
const S_LEAF_SB = 'Mills & Jones (1996) 계열(학습 지식); 교차 확인(2026-11): UGA AESL 딸기 N 2.8–3.8%, UC 협동지도 자료(수확기 N 2.4–3.0%, 칼슘 0.9% 미만 결핍·1.5% 안팎 충분), Bottoms 등(2013) HortTechnology 23:312 — N·Ca를 이에 맞춤';
const leafRange = (crop, tag, source, t) => ({ tag, source, note: `${crop} 잎(신엽 구획) 농도 기준 [심한 결핍, 적정 하한, 적정 상한, 독성]. 다량원소·Na·Cl은 건물 %, 미량원소는 mg/kg.`, ...t });
const nutrition = {
  cucumber: {
    leaf: leafRange('오이', 'SRC', S_LEAF_CUC, { N: [2.5, 4.5, 6.0, 99], P: [0.15, 0.35, 1.2, 99], K: [1.5, 3.5, 5.5, 99], Ca: [0.8, 2.0, 6.0, 99], Mg: [0.15, 0.4, 1.0, 99], S: [0.1, 0.3, 1.0, 99], Fe: [30, 80, 300, 2000], Mn: [15, 50, 300, 1000], Zn: [10, 25, 200, 500], B: [15, 40, 100, 250], Cu: [2, 6, 20, 60], Mo: [0.1, 0.3, 3, 99], Na: [-1, -1, 0.5, 1.5], Cl: [-1, -1, 1.5, 3.0] }),
    fruit: { tag: 'EST', source: S_CUC_UPTAKE, note: '과실 건물 % / mg/kg. 100 kg 생산 흡수량(N 0.27, K2O 0.40, CaO 0.31 kg)이 잎·줄기 몫과 합쳐 맞도록 정한 추정.', N: 4.0, P: 0.7, K: 5.0, Ca: 0.35, Mg: 0.3, S: 0.3, Fe: 60, Mn: 20, Zn: 30, B: 20, Cu: 6, Mo: 0.5, Na: 0.05, Cl: 0.3 },
    salt: { a: P(2.5, 'dS m⁻¹ (ECe)', [1, 6], 'SRC', 'Maas & Hoffman (1977): 오이 임계 2.5 dS/m, 감수율 13%/dS/m(그리스 HortiMED 보고서·K-State 표 재수록)', '포화 침출액 EC 기준 임계값.'), b: P(13, '% (dS m⁻¹)⁻¹', [1, 50], 'SRC', 'Maas & Hoffman (1977)', '임계 초과 1 dS/m당 상대 수량 감소.') },
    rootTemp: curve([8, 18, 26, 34], '°C(근권)', 'EST', '', '오이 뿌리 활력의 근권 온도 반응. 적정 지온 20–23°C(농진청)를 평탄부에 포함.'),
    tipburn: E(0, '-', [0, 2], '팁번 민감도(오이는 이 지수를 쓰지 않는다).'),
  },
  strawberry: {
    leaf: leafRange('딸기', 'SRC', S_LEAF_SB, { N: [1.8, 2.4, 3.4, 99], P: [0.12, 0.25, 0.6, 99], K: [0.8, 1.5, 3.0, 99], Ca: [0.5, 0.9, 2.0, 99], Mg: [0.15, 0.3, 0.6, 99], S: [0.08, 0.15, 0.5, 99], Fe: [25, 60, 250, 1500], Mn: [15, 40, 300, 800], Zn: [8, 20, 60, 400], B: [15, 30, 70, 150], Cu: [2, 6, 20, 50], Mo: [0.1, 0.3, 3, 99], Na: [-1, -1, 0.15, 1.0], Cl: [-1, -1, 0.5, 1.5] }),
    fruit: { tag: 'EST', source: S_LEAF, note: '과실 건물 % / mg/kg(추정).', N: 1.5, P: 0.3, K: 1.8, Ca: 0.15, Mg: 0.12, S: 0.1, Fe: 40, Mn: 15, Zn: 15, B: 15, Cu: 4, Mo: 0.3, Na: 0.03, Cl: 0.1 },
    salt: { a: P(1.0, 'dS m⁻¹ (ECe)', [0.5, 4], 'SRC', 'Maas & Hoffman (1977); UC Davis 수질 지침(Maas 1990): 딸기 민감(S)', '포화 침출액 EC 기준 임계값.'), b: P(33, '% (dS m⁻¹)⁻¹', [5, 60], 'SRC', 'Maas & Hoffman (1977)', '임계 초과 1 dS/m당 상대 수량 감소.') },
    rootTemp: curve([2, 12, 24, 32], '°C(근권)', 'EST', '', '딸기 뿌리 활력의 근권 온도 반응. 관부 난방 연구의 적정 범위(15–20°C 안팎)를 평탄부에 포함.'),
    tipburn: E(1, '-', [0, 2], '팁번 민감도(딸기는 신엽 팁번이 흔하다).'),
    brixK: E(0.15, '-', [0, 0.5], '과실 칼륨 상태(적정 대비)가 1 낮아질 때 당도(건물률) 감소 비율. 칼륨이 충분하면 당 합성이 늘어 달다는 보고에 근거.'),
    brixEC: E(0.04, '(dS m⁻¹)⁻¹', [0, 0.15], '근권 EC가 기준(1.0)보다 1 dS/m 높을 때 과실 건물률 증가 비율(삼투 스트레스로 과실 수분 유입 감소).'),
    brixECRef: E(1.0, 'dS m⁻¹', [0.5, 2], '당도 EC 효과의 기준 근권 EC.'),
  },
  wasabi: {
    leaf: leafRange('와사비', 'EST', '십자화과 엽채류 적정 범위를 준용(학습 지식, 원문 미확인)', { N: [2.5, 4.0, 5.5, 99], P: [0.15, 0.3, 0.8, 99], K: [1.5, 3.0, 5.5, 99], Ca: [0.6, 1.5, 4.0, 99], Mg: [0.12, 0.25, 0.8, 99], S: [0.2, 0.5, 1.5, 99], Fe: [30, 60, 300, 1500], Mn: [15, 30, 250, 800], Zn: [10, 20, 150, 400], B: [12, 25, 80, 200], Cu: [2, 5, 20, 50], Mo: [0.1, 0.3, 3, 99], Na: [-1, -1, 0.3, 1.5], Cl: [-1, -1, 1.5, 4.0] }),
    fruit: { tag: 'EST', source: '', note: '근경·분얼·꽃대 건물 % / mg/kg(추정, 매운맛 성분 때문에 황이 높다).', N: 2.0, P: 0.4, K: 2.0, Ca: 0.5, Mg: 0.2, S: 0.6, Fe: 50, Mn: 15, Zn: 25, B: 15, Cu: 4, Mo: 0.3, Na: 0.05, Cl: 0.2 },
    salt: { a: E(1.0, 'dS m⁻¹ (ECe)', [0.3, 4], '와사비 염 내성 자료를 찾지 못했다. 맑은 계류에서 자라는 작물이라 민감(딸기 수준)으로 둔다.'), b: E(20, '% (dS m⁻¹)⁻¹', [5, 60], '추정 감수율.') },
    rootTemp: { ref: 'crops.wasabi.root.temp', note: '와사비는 Phase 3c의 근권 온도 곡선을 그대로 쓴다.' },
    tipburn: E(0.7, '-', [0, 2], '팁번 민감도.'),
  },
  salinity: {
    toECe: P(0.7, '-', [0.3, 1.2], 'CAL', 'Sonneveld (1988) 암면 오이 시험: 배지 용액 EC 3.5 mS/cm 안팎에서 감수 시작 → Maas–Hoffman ECe 2.5와 맞추는 환산', '배지 용액 EC(또는 수경 양액 EC) × 이 값 = 포화 침출액 EC(ECe) 상당값. 헌법 G6의 "기질 EC로 환산·보정".'),
  },
  defaults: {
    cucumber: { system: 'rockwool', drain: 'open', recipe: 'pbg_cucumber_open', ec: [[0, 2.0], [30, 2.4]], ph: 5.6, irrigation: { mode: 'solar', solarJ: 100, dose: 150, start: 7, end: 17, minGap: 20, drainTarget: 30 } },
    strawberry: { system: 'coir', drain: 'open', recipe: 'yamazaki_strawberry', ec: [[0, 0.8], [40, 1.0]], ph: 5.8, irrigation: { mode: 'solar', solarJ: 250, dose: 60, start: 8, end: 16, minGap: 30, drainTarget: 30 } },
    wasabi: { system: 'dft', drain: 'closed', recipe: 'wasabi_half', ec: [[0, 1.0]], ph: 6.0, irrigation: { mode: 'continuous', solarJ: 0, dose: 0, start: 0, end: 24, minGap: 0, drainTarget: 0 } },
    note: E(0, '-', [0, 0], '작물별 기본 근권 구성(EST): 오이 암면 배출식, 딸기 코이어 배출식(국내 야마자키 처방 관행), 와사비 DFT 순환식. EC 프로그램은 [정식 후 일, EC dS/m].'),
  },
};

const writeData = (file, title, params, phase = 4) => {
  const path = new URL(`../data/${file}.json`, import.meta.url);
  writeFileSync(path, JSON.stringify({ _meta: { file, title, plannedPhase: phase, schemaVersion: 1 }, params }, null, 1) + '\n');
};

writeData('fertilizers', '비료·양액 원료와 목표 배양액', { fertilizers, recipes, recipeInfo: P(0, '-', [0, 0], 'EST', '', 'recipes 표의 단위: 다량원소 mmol/L, 미량원소(Fe, Mn, Zn, B, Cu, Mo) μmol/L.') });
writeData('water_sources', '원수(지하수·상수·빗물) 성분과 지역 경향', waterSources);
writeData('rootzone', '근권 시스템·양액 화학·흡수 동역학·측정', rootzone);

// crops.json에 nutrition 항목을 덧붙인다(build-crops.mjs가 다시 써도 남도록 그쪽은 기존 params를 보존한다).
const cropsPath = new URL('../data/crops.json', import.meta.url);
const crops = JSON.parse(readFileSync(cropsPath, 'utf8'));
crops.params.nutrition = nutrition;
writeFileSync(cropsPath, JSON.stringify(crops, null, 2) + '\n');
console.log('fertilizers.json, water_sources.json, rootzone.json, crops.json(nutrition) 생성 완료');
