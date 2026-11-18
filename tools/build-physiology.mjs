// Phase 5 데이터 생성기: data/pgr.json(생장조절제), data/disorders.json(생리장해), data/labor.json(노동).
// 실행: node tools/build-physiology.mjs
import { writeFileSync } from 'node:fs';

const P = (value, unit, range, tag, source, note) => ({ value, unit, range, tag, source, note });
const E = (value, unit, range, note) => P(value, unit, range, 'EST', '', note);

// ── 출처 ──
const S_FM = '팜모닝 농약 정보: 유일지베레린·대유지베레린(지베렐린 3.1% 수용제)·대유 에렐폰(에테폰 39% 액제) 제품 적용작물·사용방법(2026-11 조회)';
const S_NS = '농민신문(1999) 오이 에세폰 처리 지도 기사: 본엽 1·3·5매 때 100–200 ppm 경엽 살포로 암꽃 증가, 고농도는 생육 억제·약해(주로 사엽계)';
const S_KU = 'Ku & Kim (1985) Ethephon과 Gibberellin 처리가 오이의 성발현에 미치는 영향, 농업과학연구 12(1):1–16 — 2·4엽기 ethephon 250 ppm, GA 100 ppm';
const S_KANG = 'Kang et al. (2018) 육묘기 매향 딸기의 생육·런너·자묘 생산에 미치는 지베렐린 처리 방법과 농도, 시설원예·식물공장 27(4):407–414';
const S_KIM = 'Kim et al. (2023, 2024) 딸기 지베렐린 침지·살포 50–150 mg/L 시험, 생물환경조절학회지(Phase 5 조사 기록) — 늦게·고농도 처리 시 기형과·화경 과신장';
const S_CPPU = 'Su et al. (2021) Forchlorfenuron application induced parthenocarpic fruit formation without affecting fruit quality of cucumber, Horticulturae; Liu et al. (2024) CPPU improves fruit setting in oriental melon, HortScience 59(3):340 — 개화 전후 5 mg/L로 착과율 20–30% 증가';
const S_EC = '토양 EC가 오이의 종자발아·유묘 생장·자화착생 및 과실비대에 미치는 영향(2001), KoreaScience JAKO200128066987840 — EC 3.0 dS/m에서 순멎이·잎 황화 발생(불균일)';
const S_PLS = '농림축산식품부·농촌진흥청 PLS(농약 허용물질목록 관리제도, 2019 전면 시행): 등록되지 않은 작물에 쓴 농약은 일률기준 0.01 mg/kg 적용';
const S_NONGSARO_SB = '농사로 딸기 표준영농교본·재배 매뉴얼: 칼슘 결핍(팁번), 기형과, 착색 불량, 정부연질과(과실 무름)를 주요 생리장해로 다룸';

// ── 생장조절제 ──
// 효과: 체내 활성(A, ppm 환산)에 대한 Hill 곡선 E = emax·A^h/(ec50^h + A^h).
// target: expand(엽 확장 배수−1), internode(절간 배수−1), female(암꽃 비율 가감), node(마디 생성 배수−1), dorm(휴면 해제 일⁻¹),
//         runner(런너 발생 배수−1), set(퇴화 감소 비율, 음수 = 낙화 증가), fruitGrow(과실 비대 배수−1), root(뿌리 생장 배수−1),
//         bolt(춘화 대체 일 일⁻¹), senesce(잎 소실 일⁻¹), malform(꽃·과실 기형 노출 생리일⁻¹), soft(과실 무름 노출), bitter(쓴맛과 노출), curved(곡과 노출)
// comp: plant(줄기·잎) 또는 flower(꽃·어린 과실)
const fx = (target, emax, ec50, hill, comp, note) => ({ target, comp: comp ?? 'plant', emax: E(emax, target === 'female' ? '비율' : '배수·비율', [-5, 5], note), ec50: E(ec50, 'ppm(체내 활성 환산)', [0.1, 5000], `반응이 절반이 되는 농도. 추정 논리: 문헌·라벨의 유효 처리 농도(처리 직후 체내 활성 ≈ 처리 농도)가 EC50의 1–2배가 되게 잡아, 적정 처리에서 최대 효과의 50–70%가 나오게 했다. 근거: ${note}`), hill: E(hill, '-', [0.5, 4], `Hill 계수. 추정 논리: 1 = 단순 포화(대부분의 생장 반응), 1.5–2 = 문턱이 있는 반응(성발현·기형처럼 농도 범위가 좁게 보고된 반응). 근거: ${note}`) });
const tox = (thr, slope, effects, note) => ({ thr: E(thr, 'ppm(체내 활성 환산)', [0.1, 10000], `이 농도를 넘으면 약해가 시작된다. 추정 논리: 라벨·지도 농도 상한의 2–3배에서 약해가 보고되는 일반 경향. 근거: ${note}`), slope: E(slope, '배', [0.2, 10], `약해가 최대가 되는 농도 = 문턱 × (1 + slope). 추정 논리: 문턱의 수 배(약제 오조제·중복 살포 수준)에서 증상이 최대가 된다고 보았다. 근거: ${note}`), effects: Object.fromEntries(Object.entries(effects).map(([k, v]) => [k, E(v, '최대 약해 크기', [-5, 5], `약해 최대치(${k}). 추정 논리: 증상 종류는 문헌 방향을 따르고, 크기는 최대 약해에서 해당 과정이 절반 안팎 영향을 받는 수준. 근거: ${note}`)])) });
const reg = (status, use, dose, src, note) => ({ status, use, dose: dose ? { min: P(dose[0], 'ppm', [0, 10000], 'SRC', src, '라벨 희석배수(최대 희석)를 유효성분 농도로 환산.'), max: P(dose[1], 'ppm', [0, 10000], 'SRC', src, '라벨 희석배수(최소 희석)를 유효성분 농도로 환산.') } : null, source: src, note: note ?? '' });

const pgr = {
  methods: {
    foliar: { name: '경엽 살포(foliar)', plant: E(1, '-', [0, 2], '살포 농도의 체내 활성 환산 비율(줄기·잎).'), flower: E(1, '-', [0, 2], '꽃·어린 과실에 닿는 비율.'), volume: E(0.15, 'L m⁻²', [0.05, 0.4], '살포량: 10a당 150 L(시설 동력분무 관행).'), labor: E(2, 'h (10a)⁻¹', [0.5, 6], '동력분무기 살포 노동.') },
    drench: { name: '관주(drench)', plant: E(0.6, '-', [0, 2], '뿌리로 흡수되는 몫.'), flower: E(0.3, '-', [0, 2], '꽃까지 가는 몫(이동성 약제).'), volume: E(0.5, 'L m⁻²', [0.1, 2], '관주량: 10a당 500 L.'), labor: E(1, 'h (10a)⁻¹', [0.2, 4], '양액 관수 라인 이용.') },
    spot: { name: '꽃·화방 처리(spot)', plant: E(0.1, '-', [0, 1], '잎·줄기에 묻는 몫이 적다.'), flower: E(1, '-', [0, 2], '꽃에 직접.'), volume: E(0.02, 'L m⁻²', [0.005, 0.1], '손분무기로 꽃만.'), labor: E(6, 'h (10a)⁻¹', [2, 20], '꽃마다 처리하므로 오래 걸린다.') },
  },
  products: {
    ga3: {
      name: '지베렐린(GA₃) 3.1% 수용제', group: '지베렐린', methods: ['foliar', 'spot'],
      halfLife: E(3, 'd', [0.5, 14], '체내 GA₃ 활성의 반감기. 처리 효과(엽병 신장)가 1–2주 보이는 것에 맞춘 추정.'),
      price: E(150000, '원 (g 유효성분)⁻¹', [1000, 2000000], '3.1% 수용제 소포장 가격 수준에서 환산한 추정.'),
      residue: { dep: E(0.004, '(mg kg⁻¹)/(mg L⁻¹)', [0, 0.1], '살포 농도 1 ppm당 과실 초기 잔류(경엽 살포 일반 수준에서 추정).'), halfLife: E(3, 'd', [0.5, 30], '과실 잔류 반감기(분해 + 비대 희석).') },
      reg: {
        strawberry: reg('registered', '생장 촉진(휴면 타파)', [7, 10], S_FM, '라벨: 3,100–4,430배 희석, 비닐 피복 후 약 1주 경엽처리.'),
        cucumber: reg('registered', '제품 적용작물 목록에 오이 포함', null, S_FM, '용도·희석배수 원문은 확인하지 못했다(KNOWN_LIMITS P1).'),
        wasabi: reg('unregistered', '', null, S_PLS, '와사비 등록 생장조절제 없음.'),
      },
      effects: {
        strawberry: [fx('dorm', 0.08, 5, 1, 'plant', `휴면 정도를 하루에 최대 8%씩 덜어낸다. ${S_FM}의 "휴면 타파" 용도와 엽병 신장 효과를 수치화한 추정.`), fx('expand', 0.25, 8, 1, 'plant', '엽병·잎 신장.'), fx('runner', 1.0, 20, 1.5, 'plant', `${S_KANG}: GA 처리로 런너 발생 증가.`), fx('malform', 0.12, 30, 2, 'flower', `${S_KIM}: 개화기에 진한 GA → 기형과.`)],
        cucumber: [fx('internode', 0.4, 30, 1, 'plant', '절간 신장.'), fx('female', -0.25, 50, 1.5, 'plant', `${S_KU}: GA는 수꽃을 늘리는 쪽으로 성발현을 바꾼다.`)],
        wasabi: [fx('bolt', 1.0, 50, 1.5, 'plant', '배추과 로제트 식물에서 GA는 저온 요구를 일부 대신해 추대를 앞당긴다(일반 원예학 지식, 와사비 직접 시험은 찾지 못함).'), fx('expand', 0.3, 20, 1, 'plant', '엽병 신장.')],
      },
      tox: {
        strawberry: tox(25, 3, { malform: 0.12, soft: 0.1, expand: 0.2 }, `${S_KIM}: 과다 처리 시 기형과·화경 과신장·연약 도장.`),
        cucumber: tox(100, 2, { female: -0.2, expand: 0.15 }, '과다하면 도장하고 암꽃이 준다.'),
        wasabi: tox(100, 2, { bolt: 1.5 }, '과다하면 추대가 크게 앞당겨진다.'),
      },
    },
    ethephon: {
      name: '에테폰 39% 액제', group: '에틸렌', methods: ['foliar'],
      halfLife: E(2.5, 'd', [0.3, 7], '식물 조직 안에서 에테폰이 에틸렌으로 분해되며 효과가 1–2주 이어지는 것(처리 뒤 여러 마디에 암꽃이 는다)에 맞춘 추정.'),
      price: E(400, '원 (g 유효성분)⁻¹', [10, 100000], '39% 액제 가격에서 환산한 추정.'),
      residue: { dep: E(0.004, '(mg kg⁻¹)/(mg L⁻¹)', [0, 0.1], '살포 농도 1 ppm당 과실 초기 잔류.'), halfLife: E(4, 'd', [0.5, 30], '과실 잔류 반감기.') },
      reg: {
        strawberry: reg('unregistered', '', null, S_FM, '적용작물: 토마토·포도·담배·국화 등. 딸기 없음.'),
        cucumber: reg('unregistered', '', null, S_FM, '적용작물에 오이 없음. 현장에서 암꽃 유도에 쓰였다는 지도 기사(1999)가 있으나 현재 PLS 기준으로는 미등록 사용.'),
        wasabi: reg('unregistered', '', null, S_FM, '와사비 등록 없음.'),
      },
      effects: {
        cucumber: [fx('female', 0.4, 120, 2, 'plant', `${S_NS}; ${S_KU}.`), fx('internode', -0.3, 150, 1.5, 'plant', '에틸렌은 절간 신장을 억제한다.')],
        strawberry: [fx('senesce', 0.02, 300, 1.5, 'plant', '에틸렌: 잎 노화 촉진.')],
        wasabi: [fx('senesce', 0.02, 300, 1.5, 'plant', '에틸렌: 잎 노화 촉진.')],
      },
      tox: {
        cucumber: tox(250, 1.5, { expand: -0.5, node: -0.6, senesce: 0.04, set: -0.3 }, `${S_NS}: 고농도는 생장 억제·약해.`),
        strawberry: tox(300, 1.5, { senesce: 0.05, expand: -0.3 }, '잎 황화·생장 억제.'),
        wasabi: tox(300, 1.5, { senesce: 0.05, expand: -0.3 }, '잎 황화·생장 억제.'),
      },
    },
    cppu: {
      name: '포클로르페뉴론(CPPU) 액제', group: '사이토키닌', methods: ['spot', 'foliar'],
      halfLife: E(4, 'd', [0.5, 14], '추정 논리: CPPU는 합성 사이토키닌으로 분해가 느려 착과 효과가 개화 전후 1주 안팎 유지되는 것에 맞춤.'),
      price: E(30000, '원 (g 유효성분)⁻¹', [100, 1000000], '추정 논리: 사이토키닌 액제는 저농도(수 ppm) 고가 약제 — 유효성분 g당 가격을 GA 수준과 에테폰 사이로 둔 비용 규모 감각용 값(Phase 7에서 판매가로 교체).'),
      residue: { dep: E(0.01, '(mg kg⁻¹)/(mg L⁻¹)', [0, 0.1], '꽃·어린 과실에 직접 처리하므로 잔류 비율이 높다(경엽 살포 대비 2–3배로 추정).'), halfLife: E(6, 'd', [0.5, 30], '추정 논리: 과실 비대에 따른 희석 + 느린 분해.') },
      reg: {
        strawberry: reg('unregistered', '', null, S_PLS, '국내 등록은 참외·수박 등 박과 일부로 알려져 있으며 딸기 등록은 확인하지 못했다(보수적으로 미등록).'),
        cucumber: reg('unregistered', '', null, S_PLS, '오이 등록은 확인하지 못했다(보수적으로 미등록, KNOWN_LIMITS P1).'),
        wasabi: reg('unregistered', '', null, S_PLS, '등록 없음.'),
      },
      effects: {
        cucumber: [fx('set', 0.6, 5, 1.5, 'flower', `${S_CPPU}`), fx('fruitGrow', 0.1, 10, 1, 'flower', '어린 과실 비대 촉진.')],
        strawberry: [],
        wasabi: [],
      },
      tox: {
        cucumber: tox(20, 2, { curved: 0.15, bitter: 0.1 }, '과다하면 과실 기형·쓴맛이 생긴다는 박과 일반 지식에 따른 추정.'),
        strawberry: tox(20, 2, { malform: 0.15 }, '추정.'),
        wasabi: tox(20, 2, { expand: -0.1 }, '추정.'),
      },
    },
    naa: {
      name: '옥신계 발근제(NAA)', group: '옥신', methods: ['drench'],
      halfLife: E(2, 'd', [0.3, 10], '추정 논리: 합성 옥신(NAA)은 IAA보다 안정하지만 관주 후 뿌리 흡수·대사로 수일 안에 효과가 줄어든다.'),
      price: E(5000, '원 (g 유효성분)⁻¹', [10, 100000], '추정 논리: 발근제 분제·액제의 소포장 가격 수준에서 환산한 비용 규모 감각용 값(Phase 7에서 판매가로 교체).'),
      residue: { dep: E(0.001, '(mg kg⁻¹)/(mg L⁻¹)', [0, 0.1], '관주라 과실 잔류가 적다(경엽 살포의 1/4 수준 추정).'), halfLife: E(3, 'd', [0.5, 30], '추정 논리: 과실 비대 희석 + 대사.') },
      reg: {
        strawberry: reg('unregistered', '', null, S_PLS, '국내 발근제는 주로 화훼·과수 삽목용으로 등록 — 딸기 등록 확인 못 함(보수적으로 미등록).'),
        cucumber: reg('unregistered', '', null, S_PLS, '오이 등록 확인 못 함(보수적으로 미등록).'),
        wasabi: reg('unregistered', '', null, S_PLS, '등록 없음.'),
      },
      effects: Object.fromEntries(['strawberry', 'cucumber', 'wasabi'].map((c) => [c, [fx('root', 0.5, 20, 1, 'plant', '옥신은 부정근 발생·뿌리 생장을 촉진한다(정식 후 활착기에 효과가 크다).')]])),
      tox: Object.fromEntries(['strawberry', 'cucumber', 'wasabi'].map((c) => [c, tox(100, 2, { expand: -0.4, root: -0.6 }, '과다하면 잎이 오그라들고(상편 생장) 뿌리 생장이 오히려 억제된다.')])),
    },
    prohex: {
      name: '프로헥사디온칼슘 액상수화제', group: '생장억제제', methods: ['foliar'],
      halfLife: E(7, 'd', [1, 30], 'GA 생합성 억제 효과가 2–4주 가는 것에 맞춘 추정.'),
      price: E(3000, '원 (g 유효성분)⁻¹', [10, 100000], '추정 논리: 생장억제제 액상수화제 가격 수준에서 환산한 비용 규모 감각용 값(Phase 7에서 판매가로 교체).'),
      residue: { dep: E(0.003, '(mg kg⁻¹)/(mg L⁻¹)', [0, 0.1], '추정 논리: 경엽 살포 일반 수준(GA·에테폰과 같은 크기).'), halfLife: E(5, 'd', [0.5, 30], '추정 논리: 프로헥사디온칼슘은 식물체에서 비교적 빨리 분해되나 효과는 2–4주 — 잔류 반감기는 효과보다 짧게.') },
      reg: {
        strawberry: reg('unregistered', '', null, S_PLS, '국내 등록은 사과(신초 억제) 등으로 알려져 있다 — 딸기는 미등록 취급.'),
        cucumber: reg('unregistered', '', null, S_PLS, '미등록 취급.'),
        wasabi: reg('unregistered', '', null, S_PLS, '미등록 취급.'),
      },
      effects: {
        strawberry: [fx('runner', -0.6, 50, 1, 'plant', 'GA 생합성 억제 → 런너 발생 감소(딸기 육묘·재배 시험의 일반적 방향).'), fx('expand', -0.15, 100, 1, 'plant', '엽병 단축.')],
        cucumber: [fx('internode', -0.35, 100, 1, 'plant', '절간 단축.')],
        wasabi: [fx('expand', -0.2, 100, 1, 'plant', '엽병 단축.')],
      },
      tox: {
        strawberry: tox(300, 2, { expand: -0.4 }, '과다하면 왜화.'),
        cucumber: tox(300, 2, { expand: -0.3, node: -0.3 }, '과다하면 생장 정지에 가깝게 억제.'),
        wasabi: tox(300, 2, { expand: -0.3 }, '과다하면 왜화.'),
      },
    },
  },
  pls: { mrl: P(0.01, 'mg kg⁻¹', [0.001, 1], 'SRC', S_PLS, '미등록 사용 농산물의 잔류 허용 일률기준.') },
};

// ── 생리장해 ──
// mode: leaf(잎 면적 소실) / fruit(과실 노출 → 수확 때 등급 하락) / apex(생장점 정지) / rhizome(근경 노출) / record(작물 모듈이 이미 피해를 계산 — 기록만)
// R ≥ 1이면 발생 조건. 발생률(I) 변화: dI/dt = on·(R−1)·(1−I) (R>1), 회복 dI/dt = −off·I (R<1)
const dis = (o) => ({
  name: o.name, en: o.en, mode: o.mode, target: o.target ?? '', grade: o.grade ?? '', visible: o.visible ?? true, window: o.window ?? null, rel: o.rel ?? false,
  symptom: o.symptom, cause: o.cause, source: o.source ?? '',
  on: E(o.on ?? 0.5, 'd⁻¹ (R−1)⁻¹', [0, 10], `발생 조건(R>1)에서 발생률이 늘어나는 속도. 추정 논리: 조건이 2–4일 이어지면 눈에 띄는 증상이 포기의 절반 안팎으로 퍼지는 현장 경과에 맞춤(${o.name}).`),
  off: E(o.off ?? 0.07, 'd⁻¹', [0, 2], `조건이 사라진 뒤 발생률이 줄어드는 속도. 추정 논리: 증상 잎은 회복되지 않고 새 잎·마디로 대체되므로 엽 전개·적엽 주기(1–3주)에 맞춤(${o.name}).`),
  loss: E(o.loss ?? 0, o.mode === 'fruit' ? '노출 생리일⁻¹ (R−1)⁻¹' : o.mode === 'rhizome' ? '노출 d⁻¹ (R−1)⁻¹' : o.mode === 'apex' ? '정지 비율' : 'd⁻¹ (R−1)⁻¹ (대상 잎 면적 비율)', [0, 5], `${o.lossNote ?? '피해 속도.'} 추정 논리: 조건이 하루(R=2) 이어질 때 대상 기관의 피해가 수 % 수준이 되게 잡았다(과실은 1 − e^−노출로 등급 하락 비율이 된다). 원인: ${o.cause}`),
  th: Object.fromEntries(Object.entries(o.th ?? {}).map(([k, v]) => [k, E(v[0], v[1], [-1000, 10000], `${v[2]} 원인 근거: ${o.cause}${o.source ? ` (${o.source})` : ''}`)])),
});

const disorders = {
  detect: E(0.02, '발생률', [0, 0.5], '스카우팅에서 증상을 알아볼 수 있는 최소 발생률(포기·기관 비율).'),
  scoutLabor: E(1.0, 'h (10a)⁻¹', [0.2, 5], '생리장해·작물 상태 순찰 1회 노동(IPM 스카우팅 관행 수준 추정).'),
  strawberry: {
    sb_tipburn: dis({ name: '팁번(칼슘 결핍)', en: 'tipburn', mode: 'leaf', target: 'young',  symptom: '새로 나오는 잎 가장자리가 갈색으로 타고 오그라든다.', cause: '고습·저증산으로 어린 잎에 칼슘이 못 가는데 생장은 빠를 때', source: S_NONGSARO_SB, on: 0.3, loss: 0.02, th: { idx: [0.35, '지수', '어린 잎 칼슘 공급 부족 지수(1−공급/요구, 2일 이동평균)가 0.35이면 R = 1. Phase 4 표준 관리의 초겨울 지수(약 0.2)에서는 발생 전, 한겨울·고습·급속 생장에서 넘도록 둔 추정.'] } }),
    sb_malform: dis({ name: '기형과', en: 'malformed fruit', mode: 'fruit', grade: 'cull', window: [-5, 3], symptom: '과실 한쪽이 덜 커서 울퉁불퉁하거나 끝이 뭉툭하다.', cause: '수분 불량(벌 활동·꽃가루 활력), 개화기 저온, 지베렐린 과다', source: `${S_NONGSARO_SB}; ${S_KIM}`, loss: 0.15, th: { poll: [0.5, '수분 조건', '오늘 수분 조건(0–1)이 0.5 이하이면 R ≥ 1.'], cold: [5, '°C', '꽃 기온이 이 아래면 꽃가루·암술 장해.'] } }),
    sb_color: dis({ name: '착색 불량', en: 'poor coloring', mode: 'fruit', grade: 'mid', window: [0.6, 99], rel: true, symptom: '익어도 붉은색이 옅고 얼룩진다(어깨 부분 흰색).', cause: '성숙기 저온·일조 부족, 질소 과다', source: S_NONGSARO_SB, loss: 0.25, th: { t: [9, '°C', '성숙기 일평균 기온이 이 아래로 3°C 내려가면 R = 1.'], dli: [6, 'mol m⁻² d⁻¹', '일적산 광량이 이보다 적으면 위험(절반이면 R = 1).'], n: [1.25, '적정 대비', '체내 질소가 이보다 많으면 위험.'] } }),
    sb_soft: dis({ name: '과실 무름(정부연질과)', en: 'soft fruit', mode: 'fruit', grade: 'cull', window: [0.5, 99], rel: true, symptom: '과실 끝(정부)이 물러지고 광택이 없다. 유통 중 쉽게 상한다.', cause: '성숙기 고온, 칼슘 부족, 고습', source: S_NONGSARO_SB, loss: 0.1, th: { t: [21, '°C', '성숙기 일평균 기온이 이보다 4°C 높으면 R = 1(봄철 고온기 과실 연화).'], ca: [0.6, '지수', '칼슘 부족 지수가 이 값이면 R = 1.'], rh: [92, '%', '상대습도가 이보다 8%p 높으면 R = 1.'] } }),
    sb_frost: dis({ name: '꽃 동해(흑심)', en: 'flower frost (black eye)', mode: 'fruit', grade: 'cull', window: [-3, 2], symptom: '꽃 가운데(암술)가 검게 변하고, 달려도 기형과가 된다.', cause: '개화기 영하 근처 저온', source: S_NONGSARO_SB, loss: 0.6, th: { margin: [2, '°C', '꽃 동해 온도보다 이만큼 위에서부터 위험이 생긴다.'] } }),
    sb_salt: dis({ name: '염류 잎끝 마름', en: 'salt leaf-edge burn', mode: 'leaf', target: 'old', symptom: '아래 잎 가장자리부터 말라 들어간다.', cause: '근권 EC 과다(염류 축적)', source: 'Maas–Hoffman 염해 반응(헌법 G6)과 같은 근권 EC를 쓴다', loss: 0.01, th: { salt: [0.12, '수량 감소 비율', '근권 염류로 수량이 12% 줄어드는 정도면 R = 1.'] } }),
  },
  cucumber: {
    cu_curved: dis({ name: '곡과', en: 'curved fruit', mode: 'record', grade: 'mid', symptom: '과실이 활처럼 굽는다(곡과·끝뾰족과).', cause: '동화산물 부족(착과 과다·일조 부족·초세 약화), 유인 지연', source: 'Phase 3a 곡과 모형(과실 비대기 동화산물 부족 적산)', th: { def: [0.35, '부족도', '비대기 평균 부족도가 이 값이면 R = 1.'] } }),
    cu_arrest: dis({ name: '순멎이(생장점 정지)', en: 'growing-point arrest', mode: 'apex', symptom: '생장점 부근에 암꽃·어린 과실이 몰려 붙고 순이 더 자라지 않는다.', cause: '저야온, 착과 과다(동화산물 부족), 근권 EC 과다, 뿌리 활력 저하', source: `${S_EC}; 저야온·과다 착과 순멎이는 오이 재배 지도 일반`, on: 0.4, off: 0.15, loss: 0.9, lossNote: '완전히 멎었을 때 마디 생성이 줄어드는 비율.', th: { night: [13, '°C', '야간 평균 기온이 이보다 3°C 낮으면 R = 1.'], ssr: [0.65, '공급/수요', '동화산물 공급/수요 비가 0.25 더 낮으면 R = 1.'], salt: [0.15, '수량 감소 비율', '근권 염류로 15% 감소 수준(EC 약 3 dS/m)이면 R = 1.'], root: [0.5, '뿌리 활력', '뿌리 활력이 이만큼 떨어지면 R = 1.'] } }),
    cu_scorch: dis({ name: '엽소(잎 데임)', en: 'leaf scorch', mode: 'leaf', target: 'upper', symptom: '위 잎에 하얗게 바랜 반점이 생기고 마른다.', cause: '강한 햇빛 + 고엽온(환기 부족, 증산 저하)', loss: 0.03, th: { tleaf: [36, '°C', '엽온이 이 값에서 5°C 더 오르면 R = 1.'], ppfd: [400, 'μmol m⁻² s⁻¹', '이 광도 이상에서만 위험.'] } }),
    cu_drop: dis({ name: '유과 낙과(퇴화)', en: 'fruit abortion', mode: 'record', symptom: '개화 전후의 어린 과실이 누렇게 시들어 떨어진다.', cause: '동화산물 부족, 착과 온도 부적합, 근권 스트레스', source: 'Phase 3a 착과·퇴화 모형', th: { set: [0.3, '착과 스트레스', '착과 계수가 0.7이면 R = 1.'] } }),
    cu_mg: dis({ name: '마그네슘 결핍(엽맥 사이 황화)', en: 'Mg deficiency', mode: 'leaf', target: 'old', symptom: '아래 잎부터 잎맥 사이가 노랗게 변하고, 심하면 갈색으로 마른다(착과 부위 잎에 흔함).', cause: '근권 Mg 부족, K·NH₄·Ca 길항, 과실 부하가 클 때 잎 Mg가 과실로 빠져나감', source: '잎 Mg 결핍·적정 하한: data/crops.json 오이 엽분석 기준(Phase 4, SRC)', loss: 0.01, th: {} }),
    cu_bitter: dis({ name: '쓴맛과', en: 'bitter fruit', mode: 'fruit', grade: 'cull', window: [0, 99], visible: false, symptom: '겉으로는 멀쩡하지만 꼭지 쪽이 쓰다(쿠쿠르비타신). 수확·판매 뒤에야 드러난다.', cause: '수분 스트레스, 고온, 질소 과다, 초세 약화', loss: 0.08, th: { water: [0.3, '수분 스트레스', '수분 가용도가 0.7이면 R = 1.'], t: [32, '°C', '기온이 이보다 4°C 높으면 R = 1.'], n: [1.3, '적정 대비', '체내 질소가 이보다 0.3 높으면 R = 1.'] } }),
  },
  wasabi: {
    ws_scorch: dis({ name: '엽소(강광 장해)', en: 'leaf scorch', mode: 'record', symptom: '잎이 누렇게 바래고 가장자리가 탄다.', cause: '차광 부족(강광), 고온', source: 'Phase 3c 와사비 강광 장해 모형', th: { light: [0.2, '광 억제', '강광 억제 계수가 0.8이면 R = 1.'] } }),
    ws_rot: dis({ name: '근경 장해(갈변·부패)', en: 'rhizome injury', mode: 'rhizome', grade: 'cull', symptom: '근경 속이 갈색으로 변하고 물러진다. 캐 보기 전에는 잘 모른다.', cause: '근권 고온, 용존산소 부족', visible: false, loss: 0.03, th: { t: [2, '°C', '근경 부패 온도보다 이만큼 낮은 데서부터 위험.'], o2: [4, 'mg/L', '용존산소가 이보다 2 mg/L 낮으면 R = 1.'] } }),
    ws_bolt: dis({ name: '추대', en: 'bolting', mode: 'record', symptom: '꽃대가 올라오고 근경의 매운맛·품질이 떨어진다.', cause: '저온 감응(춘화) 뒤 기온 상승, 지베렐린', source: 'Phase 3c 와사비 춘화·추대 모형', th: {} }),
    ws_tipburn: dis({ name: '잎끝 마름', en: 'leaf tip burn', mode: 'leaf', target: 'young', symptom: '어린 잎 끝이 갈색으로 마른다.', cause: '칼슘 부족(저증산), 염류(Na·Cl) 과다', loss: 0.015, th: { idx: [0.15, '지수', '어린 잎 칼슘 공급 부족 지수.'], salt: [0.1, '수량 감소 비율', '근권 염류.'] } }),
    ws_heat: dis({ name: '고온 장해', en: 'heat injury', mode: 'record', symptom: '잎이 시들고 생장이 멈춘다.', cause: '기온·엽온 과다', source: 'Phase 3c 고온 장해 모형', th: { s: [0.2, '고온 스트레스', '고온 계수가 0.8이면 R = 1.'] } }),
    ws_cold: dis({ name: '저온 장해', en: 'chilling injury', mode: 'record', symptom: '잎이 검푸르게 데쳐진 듯 변한다.', cause: '실내 저온', source: 'Phase 3c 저온 장해 모형', th: { s: [0.2, '저온 스트레스', '저온 계수가 0.8이면 R = 1.'] } }),
  },
};

// ── 노동 ──
const labor = {
  owners: E(2, '명', [0, 10], '자가 노동 인원 기본값: 부부 2인 가족 경영(국내 시설채소 농가의 흔한 형태로 추정). 사용자에게 묻지 않고 기본값으로 둠(PROGRESS 기록).'),
  ownerHours: E(8, 'h d⁻¹ 명⁻¹', [0, 16], '하루 작업 시간.'),
  workerHours: E(8, 'h d⁻¹ 명⁻¹', [1, 12], '고용 인력 하루 작업 시간.'),
  wage: P(130000, '원 d⁻¹ 명⁻¹', [60000, 300000], 'EST', '더팩트(2025-10-03) 농번기 일당 최대 19만원 보도; 2026 최저임금 10,320원/h × 8h = 82,560원(학습 지식)', '시설채소 일용 고용 일당의 통상 수준 추정. Phase 7에서 농진청 소득자료 고용노임으로 교체 예정.'),
  autoHire: E(2, '명 d⁻¹', [0, 20], '일이 밀리는 날 자동으로 부르는 일용 인력 최대 인원 기본값(인력사무소·이웃 품앗이 관행을 단순화). 0이면 자가 노동만으로 버틴다.'),
  skill: { novice: E(0.7, '배', [0.3, 1.5], '초보 일용: 숙련자 대비 작업 속도.'), normal: E(1, '배', [0.3, 1.5], '숙련.'), expert: E(1.2, '배', [0.3, 1.5], '숙련 장기 근로자.') },
  priority: ['harvest', 'train', 'deleaf', 'thin', 'runner', 'pinch', 'bees'],
};

const file = (name, title, params) => ({ _meta: { file: name, title, plannedPhase: 5, schemaVersion: 2 }, params });
writeFileSync('data/pgr.json', JSON.stringify(file('pgr', '생장조절제', pgr), null, 1) + '\n');
writeFileSync('data/disorders.json', JSON.stringify(file('disorders', '생리장해', disorders), null, 1) + '\n');
writeFileSync('data/labor.json', JSON.stringify(file('labor', '노동', labor), null, 1) + '\n');
console.log('pgr, disorders, labor 저장');
