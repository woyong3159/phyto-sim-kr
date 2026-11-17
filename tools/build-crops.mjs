// data/crops.json, data/varieties.json 생성기. 실행: node tools/build-crops.mjs
// 수치를 고칠 때는 이 파일을 고친 뒤 다시 실행한다(태그·출처·추정 근거를 한곳에서 관리).
import { readFileSync, writeFileSync } from 'node:fs';

const P = (value, unit, range, tag, source, note) => ({ value, unit, range, tag, source, note });
const V = (values, unit, range, tag, source, note) => ({ values, unit, range, tag, source, note });
const E = (value, unit, range, note) => P(value, unit, range, 'EST', '', note);

const S_MARCELIS = 'Marcelis L.F.M. (1994) A simulation model for dry matter partitioning in cucumber. Annals of Botany 74:43–52 (doi:10.1093/aob/74.1.43); Marcelis (1994) 박사논문 Fruit growth and dry matter partitioning in cucumber, WUR';
const S_RDA_TEMP = '농촌진흥청(2018) 오이 농업기술길잡이 — 생물환경조절학회지 32(2):148 (2023) 서론 인용';
const S_KR_PHOTO = '광도·온도·CO2 농도 및 엽중 질소농도의 변화에 따른 양액재배 오이의 광합성속도에 관한 수리적 모형 (생물환경조절학회지 초록)';
const S_KR_K = '전기범·신종화 (2023) 온실 내 백다다기 오이의 생육단계에 따른 흡광계수 변화 모델 개발. 생물환경조절학회지 (JAKO202314355759881)';
const S_SUCROS = 'Spitters, van Keulen & van Kraalingen (1989) SUCROS87; Goudriaan (1986) 3점 가우스 적분; Penning de Vries et al. (1989)';
const S_GECROS = 'Yin & van Laar (2005) Crop Systems Dynamics: GECROS';
const S_FEMALE = '농촌진흥청(2018) 오이 농업기술길잡이 — 생물환경조절학회지 32(3):226 (2023) 서론 인용: 저온·단일에서 암꽃 분화 촉진';
const S_INCOME = '농촌진흥청 농산물소득자료집(경기도귀농귀촌지원센터 재배 작물 표 전재): 오이(반촉성) 10a당 수량 9,988 kg';
const S_CAL = '농촌진흥청 농업경영종합정보시스템(amis.rda.go.kr) 농산물소득분석 조사 기준표';
const S_CO2 = 'Hand D.W. (1984) Crop responses to winter and summer CO2 enrichment, Acta Hort. 162:45–64; Liu et al. (2025) 오이 CO2 시비 메타분석(73편)';

/** 사다리꼴 반응곡선: x0 이하 0 → x1에서 1 → x2까지 1 → x3 이상 0 */
const curve = (values, unit, tag, source, note) => V(values, unit, [-1000, 1000], tag, source, `사다리꼴 반응곡선 [0이 되는 하한, 1이 되는 시작, 1이 끝나는 점, 0이 되는 상한]. ${note}`);

const core = {
  photo: {
    scatter: P(0.2, '-', [0.1, 0.3], 'SRC', S_SUCROS, '잎의 PAR 산란계수(반사+투과).'),
    theta: E(0.8, '-', [0.5, 0.98], '비직각쌍곡선(non-rectangular hyperbola) 곡률. 온실 채소 잎에서 흔히 쓰는 0.7–0.9의 중간.'),
    quantumMax: E(0.085, 'mol CO2 mol⁻¹ photon', [0.06, 0.11], '광호흡이 없을 때의 흡수광 기준 양자수율. 실제 초기기울기 = 이 값 × (Ci−Γ*)/(Ci+2Γ*) (Farquhar형 전자전달 제한식). 400 ppm에서 약 0.055가 된다.'),
    gammaStar25: P(42.7, 'μmol mol⁻¹', [35, 50], 'SRC', 'Bernacchi et al. (2001) Plant Cell Environ. 24:253 — CO2 보상점 Γ*(25°C)', 'Rubisco CO2 보상점.'),
    gammaStarSlope: E(1.7, 'μmol mol⁻¹ °C⁻¹', [1, 2.5], 'Γ*의 온도 의존(25°C 부근 선형 근사). 고온에서 광호흡이 늘어 순동화가 줄어드는 효과를 만든다.'),
    ciA: P(0.14, '-', [0.05, 0.3], 'SRC', S_GECROS, 'Ci/Ca = 1 − (1 − Γ*/Ca)(a + b·VPD). C3 작물 계수 a.'),
    ciB: P(0.116, 'kPa⁻¹', [0.05, 0.2], 'SRC', S_GECROS, '기공-VPD 반응 계수 b: 공기가 건조할수록 기공이 닫혀 엽내 CO2(Ci)가 떨어진다.'),
    co2HalfSat: E(250, 'μmol mol⁻¹', [100, 500], '광포화 광합성(Pmax)의 CO2 반포화 상수: Pmax ∝ (Ci−Γ*)/(Ci+K). Rubisco 제한(K≈700)과 전자전달 제한(K≈85) 사이. 400→800 ppm에서 Pmax +40% 안팎이 되도록 잡았다(문헌: 순광합성 최대 +50%).'),
    co2Ref: P(400, 'ppm', [350, 450], 'EST', '', 'Pmax 기준값을 정의하는 CO2 농도(현재 대기).'),
    poolUse: E(0.1, 'h⁻¹', [0.03, 0.4], '동화산물 저장고(assimilate pool)에서 시간당 꺼내 쓸 수 있는 비율. 낮에 만든 당이 밤사이에도 생장에 쓰이게 한다(평균 체류 약 10시간).'),
    poolFeedbackStart: E(0.25, 'g CH2O g⁻¹ 엽건물', [0.1, 0.5], '잎 건물 대비 저장 당이 이 비율을 넘으면 광합성 되먹임 억제(sink 제한)가 시작된다. Marcelis: 과실을 오래 모두 제거했을 때만 광합성 저하가 관찰됨 → 문턱을 높게 잡았다.'),
    poolFeedbackFull: E(0.6, 'g CH2O g⁻¹ 엽건물', [0.3, 1.2], '이 비율에서 Pmax가 최저(poolFeedbackMin)까지 떨어진다.'),
    poolFeedbackMin: E(0.4, '-', [0.1, 1], '되먹임 억제 때 Pmax 하한 배수.'),
    q10: P(2, '-', [1.6, 2.4], 'SRC', S_SUCROS, '유지호흡 Q10.'),
    carbonCH2O: P(0.4, 'g C g⁻¹', [0.4, 0.4], 'SRC', '화학양론(CH2O 분자량 30 중 탄소 12)', '당의 탄소 비율.'),
  },
  water: {
    expand: curve([0.45, 0.9, 999, 1000], '상대 수분 가용도', 'EST', '', '엽 확장: 가장 먼저 줄어든다(Hsiao 1973의 민감도 순서: 세포 신장 > 기공·광합성). 수치는 추정. Phase 4에서 근권 모델이 가용도를 계산하기 전까지 입력은 1(충분)이다.'),
    fruit: curve([0.3, 0.75, 999, 1000], '상대 수분 가용도', 'EST', '', '과실 비대: 엽 확장 다음으로 민감.'),
    photo: curve([0.2, 0.6, 999, 1000], '상대 수분 가용도', 'EST', '', '광합성(기공): 가장 늦게 줄어든다.'),
  },
};

const cucumber = {
  name: '오이',
  dev: {
    tBase: P(10, '°C', [5, 13], 'EST', S_RDA_TEMP, '발육 기준온도. 농진청: 생육 적온 22–28°C, 5°C 이하·35°C 이상에서 생육 정지. 발육(마디 분화) 자체는 10–12°C에서 사실상 멈추므로 10°C로 잡았다.'),
    tOpt: P(28, '°C', [24, 32], 'SRC', S_RDA_TEMP, '발육 최적온도(생육 적온 상한 22–28°C).'),
    tMax: E(40, '°C', [35, 45], '발육 상한온도(베타 함수의 0점). 35°C 이상 생육 정지는 착과·비대 스트레스 곡선이 따로 담당한다.'),
  },
  photo: {
    pmax: P(22, 'μmol CO2 m⁻² s⁻¹', [15, 35], 'EST', S_KR_PHOTO, '완전 전개된 젊은 잎의 광포화 총광합성(25°C, 400 ppm). 국내 측정: 광보상점 10–20, 광포화점 1000 μmol m⁻² s⁻¹ 이상 → 이 Pmax와 양자수율 조합이면 광포화점이 1000–1200에서 나온다.'),
    pmaxTemp: curve([6, 24, 32, 42], '°C(엽온)', 'SRC', S_KR_PHOTO, '국내 측정에서 24–32°C 사이는 광합성 속도 차이가 거의 없음. 양 끝(6, 42°C)은 추정.'),
    ageX: V([0, 8, 22, 45, 65], 'pd(생리일수)', [0, 200], 'EST', 'Agricultural Meteorology(Japan) 30(4) 오이 잎 광합성과 엽령(초록)', '엽령(전개 후 생리일수)에 따른 Pmax 배수의 x축. 일본 측정: Pm은 일정 엽령에서 최대가 된 뒤 감소, 늙은 잎은 낮은 고원형 곡선. 구체 수치는 추정.'),
    ageY: V([0.55, 1, 1, 0.45, 0.15], '-', [0, 1], 'EST', '', '엽령별 Pmax 배수. 양자수율은 (0.5 + 0.5×이 값)만큼만 줄인다(늙은 잎의 엽록소 감소).'),
    kDiffuse: P(0.8, '-', [0.5, 1], 'EST', S_KR_K, '산란광 흡광계수(LAI가 작을 때). 넓고 수평에 가까운 잎.'),
    kLaiSlope: P(0.05, 'LAI⁻¹', [0, 0.15], 'EST', S_KR_K, '국내 백다다기 측정: LAI와 초장이 커질수록 흡광계수가 지수적으로 감소. 기울기 수치는 추정(선형 근사).'),
    kMin: E(0.6, '-', [0.4, 0.9], '흡광계수 하한.'),
    lmaExp: E(0.5, '-', [0, 1], '잎 면적당 광합성 능력 ∝ (엽 건물/면적 ÷ 기준)^지수. 얇은 잎(약광·동화산물 부족에서 자란 잎)은 면적당 Pmax가 낮다.'),
    stomatalMin: E(82, 's m⁻¹', [50, 200], 'Stanghellini(1987)형 기공저항의 최솟값(잎 단위). 토마토 값 82를 그대로 쓴다(오이 실측 없음).'),
  },
  resp: {
    leaf: P(0.03, 'g CH2O g⁻¹ d⁻¹', [0.015, 0.04], 'SRC', S_SUCROS, '잎 유지호흡 계수(25°C).'),
    stem: P(0.015, 'g CH2O g⁻¹ d⁻¹', [0.008, 0.02], 'SRC', S_SUCROS, '줄기 유지호흡 계수(25°C).'),
    root: P(0.01, 'g CH2O g⁻¹ d⁻¹', [0.005, 0.02], 'SRC', S_SUCROS, '뿌리 유지호흡 계수(25°C).'),
    fruit: P(0.01, 'g CH2O g⁻¹ d⁻¹', [0.005, 0.02], 'SRC', S_SUCROS, '저장기관(과실) 유지호흡 계수(25°C).'),
    cvfLeaf: P(0.72, 'g 건물 g⁻¹ CH2O', [0.65, 0.78], 'SRC', S_SUCROS, '잎 전환효율(conversion efficiency).'),
    cvfStem: P(0.69, 'g 건물 g⁻¹ CH2O', [0.62, 0.75], 'SRC', S_SUCROS, '줄기 전환효율.'),
    cvfRoot: P(0.72, 'g 건물 g⁻¹ CH2O', [0.65, 0.78], 'SRC', S_SUCROS, '뿌리 전환효율.'),
    cvfFruit: P(0.77, 'g 건물 g⁻¹ CH2O', [0.7, 0.85], 'EST', S_MARCELIS, 'Marcelis: 과실 누적 탄소 요구량의 13–15%가 호흡(생장+유지). 생장호흡 몫을 약 10%로 보고 역산.'),
    carbonVeg: E(0.45, 'g C g⁻¹', [0.4, 0.48], '영양기관 건물의 탄소 비율.'),
    carbonFruit: E(0.42, 'g C g⁻¹', [0.38, 0.46], '과실 건물의 탄소 비율.'),
  },
  leaf: {
    rate: E(0.75, '매 pd⁻¹', [0.5, 1.1], '원줄기 엽 출현 속도(최적온도 1일 = 1 pd). 평균 21°C(f_T≈0.75)에서 하루 0.55매 → 정식 30일에 16–17마디. 현장 감각(반촉성 정식 30일 15–18마디)에 맞춘 추정.'),
    maxArea: E(0.06, 'm² 매⁻¹', [0.03, 0.09], '잎 한 장의 잠재 최대 면적(백다다기 600 cm²). 유럽 장과형(1000 cm² 이상)보다 작다.'),
    expandDays: E(12, 'pd', [8, 20], '잎이 다 펴지는 데 걸리는 생리일수(로지스틱).'),
    sla: E(0.03, 'm² g⁻¹', [0.02, 0.045], '기준 비엽면적(SLA 300 cm² g⁻¹; DLI 15 mol, 22°C).'),
    slaDliRef: E(15, 'mol m⁻² d⁻¹', [8, 25], 'SLA 기준 일적산광량.'),
    slaLightExp: E(0.25, '-', [0, 0.6], 'SLA ∝ (기준 DLI / 실제 DLI)^지수: 약광에서 잎이 얇고 넓어진다(도장).'),
    slaTemp: E(0.02, '°C⁻¹', [0, 0.05], '평균기온 1°C 상승당 SLA 증가율(고온에서 잎이 얇아진다).'),
    slaTempRef: E(22, '°C', [18, 26], 'SLA 기준 평균기온.'),
    slaMin: E(0.02, 'm² g⁻¹', [0.015, 0.03], 'SLA 하한.'),
    slaMax: E(0.045, 'm² g⁻¹', [0.035, 0.06], 'SLA 상한.'),
    life: E(50, 'pd', [35, 80], '잎 수명(이후 노화 시작). 엽령별 Pmax 곡선과 짝을 이룬다.'),
    senescence: E(0.12, 'pd⁻¹', [0.03, 0.4], '수명이 지난 잎의 면적 감소율.'),
    shadeLight: E(0.04, '-', [0.01, 0.15], '군락 위 광의 이 비율보다 어두운 곳에 있는 잎은 그늘 노화가 진행된다.'),
    starveLoss: E(0.05, 'h⁻¹', [0, 0.3], '유지호흡에 쓸 당이 전혀 없을 때 가장 늙은 잎이 시간당 소모되는 비율(기아 상태의 하엽 황화).'),
    acclimDays: E(5, 'd', [2, 14], '잎 두께·절간장이 반응하는 광·온도 이력의 이동평균 기간.'),
    shadeSenescence: E(0.05, 'pd⁻¹', [0, 0.3], '그늘 노화율.'),
  },
  stem: {
    ratio: E(0.45, '-', [0.25, 0.7], '줄기(엽병 포함) 잠재 생장 = 잎 잠재 생장 × 이 비율. Marcelis의 영양기관 분배(잎:줄기 ≈ 2:1)에 근거한 추정.'),
    rootRatio: E(0.15, '-', [0.05, 0.3], '뿌리 잠재 생장 = (잎+줄기) × 이 비율. 수경·양액 오이의 뿌리 분배 5–15%.'),
    internode: E(0.09, 'm', [0.05, 0.15], '기준 절간장(야온 16°C, DLI 15 mol).'),
    internodeNightRef: E(16, '°C', [12, 20], '절간 신장 기준 야온.'),
    internodeNight: E(0.035, '°C⁻¹', [0, 0.08], '야온 1°C 상승당 절간 신장 증가율.'),
    internodeMin: E(0.6, '-', [0.3, 1], '절간장 배수 하한.'),
    internodeMax: E(2.5, '-', [1.2, 4], '절간장 배수 상한.'),
    internodeLightExp: E(0.3, '-', [0, 0.7], '절간장 ∝ (기준 DLI / 실제 DLI)^지수: 약광 도장.'),
  },
  fruit: {
    wMax: P(40, 'g 건물 개⁻¹', [20, 60], 'EST', S_MARCELIS, '따지 않고 두었을 때 과실 하나의 잠재 최종 건물중(Gompertz 상한). Marcelis는 Richards 함수를 썼다. 백다다기는 180–200 g(건물 약 7 g)에서 일찍 따므로 곡선의 앞부분만 쓴다.'),
    rate: E(0.25, 'pd⁻¹', [0.1, 0.5], 'Gompertz 속도 계수. 동화산물이 전혀 모자라지 않는 조건(잠재 생장)에서 개화 후 7 pd에 약 190 g(생체중). 실제 포장은 공급이 수요의 50–70%라 여름 7–10일, 겨울 15–20일이 걸린다는 현장 범위와 맞춘 추정.'),
    mid: E(9, 'pd', [5, 20], 'Gompertz 변곡점(개화 후 생리일수).'),
    anthesisAge: E(10, 'pd', [6, 16], '마디가 생긴 뒤 그 마디 암꽃이 필 때까지의 생리일수.'),
    abortWindow: E(6, 'pd', [2, 10], '개화 후 이 기간 안의 어린 과실만 퇴화(유과 고사)할 수 있다. Marcelis: 퇴화는 어린 과실에서 일어나고 source/sink 비에 좌우.'),
    preAnthesis: E(3, 'pd', [0, 8], '개화 전 이 기간의 꽃봉오리(씨방)도 퇴화할 수 있다.'),
    abortMax: E(1, 'pd⁻¹', [0.1, 2], '착과 조건이 최악일 때 어린 과실의 퇴화율.'),
    setSsr: curve([0.28, 0.62, 999, 1000], 'source/sink 비', 'EST', S_MARCELIS, '동화산물 공급/수요 비(최근 며칠 평균)에 따른 착과 유지 확률. 구간 수치는 과실 비중이 40–90%로 주기 변동한다는 Marcelis 결과가 재현되도록 잡은 추정.'),
    setTemp: curve([10, 17, 30, 37], '°C(일평균 실내기온)', 'EST', S_RDA_TEMP, '착과 온도 반응. 35°C 이상 고온과 저온에서 유과 퇴화 증가.'),
    growTemp: curve([8, 14, 33, 40], '°C(실내기온)', 'EST', S_RDA_TEMP, '과실 비대 온도 스트레스(발육 속도와 별개로 양 끝에서 추가 억제).'),
    dmc: E(0.042, 'g g⁻¹', [0.028, 0.05], '과실 건물률 4.2%. 유럽 장과형(약 3%)보다 짧고 단단한 다다기·일본형은 4% 안팎.'),
    dmcLight: E(0.0003, 'g g⁻¹ (mol m⁻² d⁻¹)⁻¹', [0, 0.001], 'DLI가 기준(15 mol)보다 1 mol 높을 때 건물률 증가(강광에서 과실이 단단하고 건물률이 높다).'),
    lenA: E(2.9, 'cm g^-b', [2, 4.5], '과장 = a × 생체중^b. 180 g에서 21 cm.'),
    lenB: E(0.38, '-', [0.3, 0.45], '과장 지수.'),
    femaleNightRef: E(15, '°C', [10, 20], '암꽃 비율 기준 야온.'),
    femaleNight: P(0.03, '°C⁻¹', [0, 0.08], 'EST', S_FEMALE, '야온 1°C 상승당 마디 암꽃 비율 감소. 방향은 문헌(저온·단일 → 암꽃 촉진), 크기는 추정.'),
    femaleDayRef: E(12, 'h', [10, 14], '암꽃 비율 기준 일장.'),
    femaleDay: P(0.05, 'h⁻¹', [0, 0.12], 'EST', S_FEMALE, '일장 1시간 증가당 암꽃 비율 감소.'),
    femaleMin: E(0.15, '-', [0, 0.5], '암꽃 비율 하한.'),
    femaleLag: E(10, 'd', [3, 20], '암꽃 분화가 결정되는 시기의 환경을 반영하는 이동평균 기간(꽃눈은 전개 10마디쯤 전에 분화).'),
    curveStart: E(0.06, '-', [0.02, 0.6], '곡과가 생기기 시작하는 비대기 평균 동화산물 부족도(1 − 공급/수요).'),
    curveFull: E(0.7, '-', [0.4, 1], '거의 모두 곡과가 되는 부족도.'),
    colorDli: curve([2, 10, 999, 1000], 'mol m⁻² d⁻¹', 'EST', '', '과색(짙은 정도) 지수: 일조 부족이면 색이 옅어진다.'),
    staleAge: E(22, 'pd', [14, 40], '이 생리일수를 넘기도록 수확 크기에 못 미친 과실은 비상품(곤봉과·기형)으로 솎아낸다.'),
    oversizeCull: E(1.4, '-', [1.1, 2.5], '과대과 기준의 이 배수를 넘으면 비상품.'),
    ssrLag: E(3, 'd', [1, 7], '착과에 반영되는 공급/수요 비의 이동평균 기간. Marcelis: source 세기는 지연을 두고 과실 수에 영향.'),
    oversize: E(1.35, '-', [1.1, 2], '수확 기준 무게의 이 배수를 넘으면 과대과(중품), 그 1.4배를 넘으면 비상품.'),
  },
  lateral: {
    delay: E(10, 'pd', [5, 20], '마디가 생긴 뒤 곁순(측지)이 자라기 시작하는 생리일수.'),
    rate: E(0.45, '매 pd⁻¹', [0.2, 0.8], '곁순 한 가지의 엽 출현 속도.'),
    maxNodes: E(6, '매', [2, 12], '정리하지 않았을 때 곁순 하나가 자라는 최대 마디 수.'),
    areaFactor: E(0.7, '-', [0.4, 1], '곁순 잎 크기(원줄기 잎 대비).'),
    ssr: curve([0.3, 0.75, 999, 1000], 'source/sink 비', 'EST', '', '곁순 신장의 동화산물 의존: 당이 모자라면 곁눈이 자라지 않는다(정아우세·탄수화물 상태에 따른 분지 억제).'),
    female: E(0.7, '-', [0.3, 1], '곁순 첫 마디의 암꽃 비율(원줄기 비율과 별개, 곁순은 암꽃이 잘 맺힌다).'),
  },
  training: {
    limit: E(6, '마디', [3, 12], '유인(줄 감기·내리기) 없이 버틸 수 있는 새 마디 수.'),
    clump: E(0.3, '-', [0, 0.6], '유인을 방치했을 때 잎이 뭉쳐 흡광계수가 줄어드는 최대 비율(생장점이 처지고 잎이 겹친다).'),
    curve: E(0.25, '-', [0, 0.6], '유인 방치로 과실이 바닥·줄기에 닿아 생기는 곡과 부족도 가산값.'),
  },
  damage: {
    chillTemp: P(5, '°C', [2, 10], 'SRC', S_RDA_TEMP, '이 온도 아래에서 저온 장해 시작(농진청: 5°C 이하 생육 정지).'),
    chillRate: E(0.004, 'h⁻¹ °C⁻¹', [0.001, 0.02], '저온 장해로 시간당 잃는 엽면적 비율(기준온도보다 1°C 낮을 때).'),
    frostTemp: E(0, '°C', [-2, 2], '동해 온도.'),
    frostRate: E(0.5, 'h⁻¹', [0.1, 1], '동해 때 시간당 고사 비율(잎과 개체).'),
    heatTemp: E(42, '°C', [38, 46], '고온 장해(엽소) 시작 엽온.'),
    heatRate: E(0.005, 'h⁻¹ °C⁻¹', [0.002, 0.05], '고온 장해로 시간당 잃는 엽면적 비율.'),
  },
  labor: {
    plant: E(16, 'h (10a)⁻¹', [8, 40], '정식 노동 시간.'),
    train: E(7, 'h (10a)⁻¹ 회⁻¹', [3, 15], '유인·곁순 정리·덩굴손 제거 1회.'),
    deleaf: E(5, 'h (10a)⁻¹ 회⁻¹', [2, 12], '적엽 1회.'),
    thin: E(3, 'h (10a)⁻¹ 회⁻¹', [1, 8], '적과·적화 1회.'),
    pinch: E(2, 'h (10a)⁻¹', [1, 5], '적심.'),
    harvestBase: E(4, 'h (10a)⁻¹ 회⁻¹', [2, 10], '수확 1회 기본 시간(이동·선별).'),
    harvestPerTon: E(14, 'h t⁻¹', [6, 30], '수확·선별·포장 무게당 시간.'),
    workHour: E(7, '시', [5, 12], '계획 작업을 하는 시각.'),
    remove: E(24, 'h (10a)⁻¹', [10, 50], '작기 종료(철거).'),
  },
  seedling: {
    leaves: E(4, '매', [2, 6], '정식 묘의 본엽 수(접목묘 30–35일).'),
    leafArea: E(0.012, 'm² 매⁻¹', [0.005, 0.03], '정식 묘의 평균 엽면적.'),
    leafW: E(1.6, 'g 주⁻¹', [0.5, 4], '정식 묘의 잎 건물중.'),
    stemW: E(0.9, 'g 주⁻¹', [0.3, 3], '정식 묘의 줄기 건물중.'),
    rootW: E(0.7, 'g 주⁻¹', [0.2, 2], '정식 묘의 뿌리 건물중.'),
    leafCap: E(0.5, '-', [0.2, 1], '육묘 중에 나온 아래 잎의 잠재 크기(정식 후 잎 대비). 묘 시기 잎은 작다.'),
    shockFactor: E(0.5, '-', [0.1, 1], '활착 기간의 마디 발생 속도 배수.'),
    shock: E(3, 'pd', [0, 8], '활착 기간(이 동안 새 마디 발생이 절반).'),
  },
  density: P(2.2, '주 m⁻²', [1.2, 4], 'EST', '생물환경조절학회지 30(1):46 (2021) 다다기 원줄기 재배 2.0주/m²', '기본 재식밀도(10a당 2,200주).'),
  systems: {
    forcing: { name: '촉성', sowing: '10월 상순–11월 중순 파종', harvest: '1월 중순–4월 하순', transplantMonth: P(11, '월', [10, 12], 'SRC', S_CAL, '정식 권장 월(파종 후 30–35일 육묘).'), transplantDay: E(20, '일', [1, 31], '정식 권장 일.'), benchYield: E(15000, 'kg (10a)⁻¹', [9000, 22000], '촉성 10a 수량. 소득자료집 수치를 직접 확인하지 못해 추정값으로 둔다(벤치마크 판정에는 쓰지 않는다).') },
    semiforcing: { name: '반촉성', sowing: '12월 상순–1월 중순 파종', harvest: '3월 중순–6월 하순', transplantMonth: P(2, '월', [1, 3], 'SRC', S_CAL, '정식 권장 월.'), transplantDay: E(5, '일', [1, 31], '정식 권장 일.'), benchYield: P(9988, 'kg (10a)⁻¹', [6000, 16000], 'SRC', S_INCOME, '반촉성 10a 수량(V4 벤치마크 기준).') },
    retarding: { name: '억제', sowing: '7월 하순–8월 중순 파종', harvest: '9월 중순–12월 상순', transplantMonth: E(8, '월', [7, 9], '정식 권장 월(국내 시설 억제 작형 관행).'), transplantDay: E(25, '일', [1, 31], '정식 권장 일.'), benchYield: E(6500, 'kg (10a)⁻¹', [3500, 10000], '억제 10a 수량 추정(수확 기간이 짧고 후기 광 부족). 벤치마크 판정에는 쓰지 않는다.') },
  },
  co2Reference: P(30, '%', [20, 50], 'SRC', S_CO2, '문헌의 CO2 시비 효과 범위 참고값: 순광합성 최대 +50%, 수량 +20–40%(335→1000 vpm). 모델 계산에는 쓰지 않고 검증(V3 ⑥)에서 비교한다.'),
};

const cv = (o) => ({
  name: o.name,
  type: o.type,
  desc: o.desc,
  real: o.real,
  female: E(o.female, '-', [0.2, 1], `기준 조건(야온 15°C, 일장 12시간)에서 원줄기 마디 암꽃 비율. ${o.femaleNote}`),
  pmaxFactor: E(o.pmax, '-', [0.8, 1.2], '품종별 광합성 능력 배수(초세).'),
  leafArea: E(o.leaf, '-', [0.7, 1.4], '잎 크기 배수.'),
  fruitWMax: E(o.wmax, '-', [0.7, 1.6], '과실 잠재 크기 배수.'),
  harvestWeight: E(o.hw, 'g', [100, 400], '표준 수확 무게.'),
  lenA: E(o.lenA, 'cm g^-b', [2, 4.5], '과장 계수(과형).'),
  curveSens: E(o.curve, '-', [0.5, 2], '곡과 민감도 배수.'),
  coldTol: E(o.cold, '°C', [-3, 3], '저온 장해 시작 온도의 이동(음수 = 저온에 강함).'),
  heatTol: E(o.heat, '°C', [-3, 3], '고온 장해·착과 상한의 이동(양수 = 고온에 강함).'),
  firstHarvestDays: E(o.days, '일', [20, 60], '정식 후 첫 수확까지 표준 일수(참고값, 모델이 계산한 결과와 비교용).'),
  potentialYield: E(o.yield, 'kg (10a)⁻¹', [5000, 25000], '반촉성 표준 관리 때 기대 수량(참고값, 계산에는 쓰지 않음).'),
  resistance: { powderyMildew: E(o.pm, '1–5', [1, 5], '흰가루병 저항성(5 = 강). Phase 6에서 사용.'), downyMildew: E(o.dm, '1–5', [1, 5], '노균병 저항성. Phase 6에서 사용.') },
  pricePremium: E(o.premium, '-', [0.6, 1.6], '백다다기 표준 대비 가격 배수(Phase 7에서 사용).'),
  seedlingPrice: E(o.seedling, '원 주⁻¹', [300, 1500], '접목묘 1주 가격(Phase 7에서 사용).'),
});

const cucumberVarieties = {
  cheongchun: cv({ name: '청춘 백다다기', type: '백다다기형', real: true, desc: '다다기 계통 ‘청춘’(해오름종묘). 절성형, 겨울·봄 작형.', female: 0.85, femaleNote: '절성형(마디마다 암꽃).', pmax: 1, leaf: 1, wmax: 1, hw: 180, lenA: 2.9, curve: 1, cold: -0.5, heat: 0, days: 35, yield: 10500, pm: 3, dm: 3, premium: 1, seedling: 700 }),
  ipchu: cv({ name: '입추백다다기', type: '백다다기형', real: true, desc: '억제·촉성 작형에서 추천된 백다다기(자원식물학회지 19(2), 2006). 고온기 암꽃 착생이 안정적.', female: 0.8, femaleNote: '고온·장일에서도 암꽃이 덜 줄어드는 계통으로 보고됨(수치는 추정).', pmax: 0.98, leaf: 1.05, wmax: 1, hw: 180, lenA: 2.9, curve: 0.9, cold: 0, heat: 1, days: 36, yield: 10000, pm: 3, dm: 3, premium: 1, seedling: 700 }),
  gyeousari: cv({ name: '겨우살이청장', type: '취청형', real: true, desc: '청장(취청)계. 촉성 작형 추천 품종(자원식물학회지 19(2), 2006). 저온 신장성이 좋고 과실이 길다.', female: 0.6, femaleNote: '취청계는 마디성이 낮아 원줄기+곁순 착과.', pmax: 1.02, leaf: 1.1, wmax: 1.25, hw: 230, lenA: 3.3, curve: 1.15, cold: -1.5, heat: -0.5, days: 40, yield: 10500, pm: 2, dm: 3, premium: 0.95, seedling: 700 }),
  gasiA: cv({ name: '가시계 A (가상, 실제 계통 특성 기반)', type: '가시계', real: false, desc: '남부 지방 가시오이(흑진주계) 특성을 본뜬 가상 품종. 과실이 길고 가시가 많으며 고온에 강하다.', female: 0.55, femaleNote: '혼성형.', pmax: 1.03, leaf: 1.15, wmax: 1.4, hw: 260, lenA: 3.6, curve: 1.3, cold: 1, heat: 1.5, days: 42, yield: 9500, pm: 3, dm: 2, premium: 0.9, seedling: 650 }),
};

const write = (file, title, params) => {
  const path = new URL(`../data/${file}.json`, import.meta.url);
  let prev = {};
  try {
    prev = JSON.parse(readFileSync(path, 'utf8')).params ?? {};
  } catch {
    /* 새 파일 */
  }
  const out = { _meta: { file, title, plannedPhase: 3, schemaVersion: 1 }, params: { ...prev, ...params } };
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
};

write('crops', '작물 공통 생리 파라미터와 작물별 생육 파라미터', { core, cucumber });
write('varieties', '품종 데이터베이스', { cucumber: cucumberVarieties });
console.log('crops.json, varieties.json 생성 완료');
