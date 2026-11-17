// 시설·장비·에너지 가격 데이터 생성기 → data/facilities.json, equipment.json, prices.json
// 실행: node tools/build-facility.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (value, unit, range, tag, source, note) => ({ value, unit, range, tag, source, note });

const U_SRC = '온실 난방부하 설계 관행값(유리 5.3, 폴리에틸렌 5.7 kcal m⁻² h⁻¹ °C⁻¹ 수준)을 W 단위로 환산';
const facility = (o) => ({
  name: o.name,
  desc: o.desc,
  transmissivity: P(o.tau, '-', [0.4, 0.95], 'EST', '', `온실 전체 일사 투과율(피복재 + 골조 그늘 + 입사각 손실, 산란광 평균). 새 피복재 자체는 0.87–0.92이나 골조·이중 구조로 낮아진다. ${o.tauNote}`),
  uValue: P(o.u, 'W m⁻² K⁻¹', [2, 9], 'EST', U_SRC, `피복면 열관류율(보온커튼 없음). ${o.uNote}`),
  coverRatio: P(o.cover, 'm² m⁻²', [1, 2.5], 'EST', '', '바닥 면적 대비 피복 면적(지붕 + 측벽). 1,000 m²(약 300평) 안팎 규모 기준 기하 추정.'),
  eaveHeight: P(o.eave, 'm', [1, 8], 'EST', '', '측고(처마 높이). 국내 보급형 규격의 통상 범위.'),
  meanHeight: P(o.mean, 'm', [1.5, 9], 'EST', '', '평균 높이 = 공기 부피 ÷ 바닥 면적.'),
  leakage: P(o.ach, 'h⁻¹', [0.1, 4], 'EST', '', '창을 다 닫았을 때 틈새 환기 횟수(풍속 4 m/s 기준). 비닐 단동 > 연동 > PO > 유리 순으로 기밀.'),
  sideVentArea: P(o.side, 'm² m⁻²', [0, 0.5], 'EST', '', '측창을 100% 열었을 때 개구 면적 ÷ 바닥 면적.'),
  roofVentArea: P(o.roof, 'm² m⁻²', [0, 0.4], 'EST', '', '천창을 100% 열었을 때 개구 면적 ÷ 바닥 면적.'),
  snowLimit: P(o.snow, 'cm', [10, 80], 'EST', '원예특작시설 내재해 설계기준(지역별 설계 적설심 20–40 cm대)의 범위를 참고', `지붕 적설 한계. 넘으면 붕괴. ${o.snowNote}`),
  windLimit: P(o.wind, 'm/s', [15, 50], 'EST', '원예특작시설 내재해 설계기준(지역별 설계 풍속 22–40 m/s)의 범위를 참고', '최대순간풍속 한계. 넘으면 피복 파손.'),
  snowShed: P(o.shed, '-', [0, 1], 'EST', '', '지붕 형상에 따른 눈 흘러내림 정도(시간당 감소 비율 계수). 아치형 단동은 잘 흘러내리고 연동 곡부·유리 지붕은 쌓인다.'),
  agingLoss: P(o.aging, 'yr⁻¹', [0, 0.1], 'EST', '', '피복재 노후로 인한 연간 투과율 감소.'),
  coverLife: P(o.life, 'yr', [1, 40], 'EST', '', '피복재 교체 주기.'),
  buildCost: P(o.cost, '원/m²', [10000, 800000], 'EST', '', `골조 + 피복 시공비(장비 제외). ${o.costNote} 지역·시기·자동화 수준에 따라 ±40% 차이. Phase 7에서 정밀화.`),
});

const facilities = {
  _meta: { file: 'facilities', title: '시설(온실 유형)', plannedPhase: 2, schemaVersion: 1 },
  params: {
    types: {
      single_pe: facility({ name: '단동 비닐하우스', desc: '폭 6–8 m 아치형, PE 필름 1겹', tau: 0.72, tauNote: 'PE 0.1 mm.', u: 6.6, uNote: 'PE 1겹.', cover: 1.75, eave: 1.5, mean: 2.3, ach: 1.5, side: 0.3, roof: 0, snow: 25, snowNote: '비규격 파이프 하우스는 더 약하다.', wind: 26, shed: 0.6, aging: 0.04, life: 3, cost: 35000, costNote: '평당 약 12만 원.' }),
      multi_pe: facility({ name: '연동 비닐하우스', desc: '1-2W형 등 연동, PE 필름', tau: 0.68, tauNote: '연동 곡부·골조 그늘이 더 많다.', u: 6.6, uNote: 'PE 1겹.', cover: 1.35, eave: 3.0, mean: 3.8, ach: 1.0, side: 0.1, roof: 0.08, snow: 30, snowNote: '곡부에 눈이 쌓인다.', wind: 30, shed: 0.15, aging: 0.04, life: 3, cost: 110000, costNote: '평당 약 36만 원.' }),
      multi_po: facility({ name: '연동 PO필름 온실', desc: '광폭·고측고, PO 필름 0.15 mm', tau: 0.74, tauNote: 'PO 필름은 투과율과 내구성이 PE보다 좋다.', u: 6.2, uNote: 'PO는 장파 차단이 PE보다 나아 약간 낮게 잡았다.', cover: 1.3, eave: 4.5, mean: 5.3, ach: 0.6, side: 0.08, roof: 0.12, snow: 40, snowNote: '', wind: 35, shed: 0.15, aging: 0.015, life: 6, cost: 220000, costNote: '평당 약 73만 원.' }),
      venlo: facility({ name: '벤로형 유리온실', desc: '벤로(Venlo) 지붕, 4 mm 유리', tau: 0.78, tauNote: '유리 + 가는 골조.', u: 6.2, uNote: '유리 1겹.', cover: 1.25, eave: 6.0, mean: 6.8, ach: 0.4, side: 0, roof: 0.18, snow: 50, snowNote: '', wind: 40, shed: 0.1, aging: 0.002, life: 25, cost: 400000, costNote: '평당 약 130만 원.' }),
    },
    physics: {
      doubleCoverU: P(0.62, '-', [0.45, 0.8], 'EST', '', '피복을 2중으로 했을 때 열관류율 배율. 공기층이 열저항을 더해 1겹 6.6 → 2중 약 4.1 W m⁻² K⁻¹(이중 피복 관행값 3.5–4.5 수준).'),
      doubleCoverTau: P(0.9, '-', [0.8, 0.95], 'EST', '', '피복을 2중으로 했을 때 투과율 배율(필름 한 장 더 통과).'),
      thermalMass: P(200, 'kJ m⁻² K⁻¹', [50, 500], 'EST', '', '바닥·토양 표층의 유효 열용량(토양 약 10 cm, 체적열용량 2 MJ m⁻³ K⁻¹). 낮에 받은 열을 밤에 내놓는 축열 효과.'),
      floorDirectFraction: P(0.5, '-', [0, 0.9], 'EST', '', '바닥이 흡수한 일사 가운데 뜨거워진 표면에서 곧바로 공기로 돌아가는 비율. 나머지만 축열체에 저장된다. 표면 온도 절점을 따로 두지 않은 데 대한 보정.'),
      massExchange: P(6, 'W m⁻² K⁻¹', [2, 12], 'EST', '', '바닥 표면과 실내 공기 사이 대류 열전달 계수.'),
      deepConductance: P(1.0, 'W m⁻² K⁻¹', [0.2, 3], 'EST', '', '표층과 심층 토양 사이 열전도(토양 열전도율 약 1 W m⁻¹ K⁻¹, 깊이 약 1 m).'),
      deepTempOffset: P(1.5, '°C', [0, 4], 'EST', '', '심층 지온 = 지역 연평균기온 + 이 값(지중 온도는 연평균기온보다 약간 높다).'),
      airExtraCapacity: P(8, 'kJ m⁻² K⁻¹', [0, 30], 'EST', '', '공기와 함께 빠르게 데워지고 식는 골조·자재의 열용량.'),
      canopyCapacityPerLai: P(4, 'kJ m⁻² K⁻¹', [0, 10], 'EST', '', '엽면적지수 1당 작물체 열용량(생체중 약 1 kg m⁻²).'),
      innerSurfaceCoeff: P(7.5, 'W m⁻² K⁻¹', [4, 12], 'EST', '', '피복 안쪽 면의 대류 + 복사 열전달 계수. 피복면 온도와 결로량 계산에 쓴다.'),
      radiativeCoeff: P(4.6, 'W m⁻² K⁻¹', [3, 6], 'EST', '', '잎·바닥과 피복면 사이 장파 복사 교환의 선형화 계수(4εσT³, ε≈0.85, T≈288 K).'),
      shortwaveAbsorbed: P(0.85, '-', [0.6, 0.95], 'EST', '', '실내로 들어온 일사 중 흡수되는 비율(나머지는 반사되어 다시 나간다).'),
      extinction: P(0.7, '-', [0.4, 1], 'EST', '', '군락 흡광계수 k. 군락이 가로채는 비율 = 1 − e^(−k·LAI).'),
      parFraction: P(0.47, '-', [0.42, 0.52], 'EST', '', '전천 일사 중 광합성유효광(PAR) 에너지 비율. 통상 0.45–0.50.'),
      parPhotonPerJoule: P(4.57, 'μmol J⁻¹', [4.4, 4.7], 'SRC', 'McCree (1972) 태양광 PAR 환산 계수(통용값)', 'PAR 에너지 → 광양자.'),
      dischargeCoeff: P(0.65, '-', [0.4, 0.8], 'EST', '', '창 유량 계수 Cd(온실 환기 연구의 통상 범위 0.6–0.7).'),
      windCoeff: P(0.1, '-', [0.03, 0.2], 'EST', '', '풍압 계수 Cw(온실 환기 연구의 통상 범위 0.07–0.14).'),
      boundaryResistance: P(200, 's m⁻¹', [80, 400], 'EST', '', '잎 경계층 저항(바람 없는 온실). 유동팬을 켜면 boundaryResistanceFan 값을 쓴다.'),
      boundaryResistanceFan: P(120, 's m⁻¹', [50, 300], 'EST', '', '유동팬 가동 시 잎 경계층 저항.'),
      stomatalMin: P(82, 's m⁻¹', [50, 200], 'SRC', 'Stanghellini (1987) 온실 토마토 증산 모델의 기공저항 식 rs = 82·(Is+4.30)/(Is+0.54)', '최소 기공저항(광 항). 온도·VPD·CO2 항은 아래 stomatal* 파라미터.'),
      stomatalVpd: P(0.5, 'kPa⁻²', [0, 5], 'EST', '', '기공저항의 수증기압차 항 (1 + a·VPD²): 형태는 Stanghellini(1987)식 곱셈 구조를 따르고, 계수는 과채류 기공이 VPD 2–3 kPa에서 뚜렷이 닫힌다는 일반 지식에 맞춘 추정(1 kPa에서 1.5배, 2 kPa에서 3배, 3 kPa에서 5.5배). 공기가 건조해도 증산이 무한정 늘지 않게 한다.'),
      stomatalTemp: P(0.023, '°C⁻²', [0, 0.06], 'EST', 'Stanghellini (1987) 기공저항 식의 온도 항 (1 + b·(T − Topt)²) — 계수는 학습 지식', '적온보다 더우면 기공저항 증가(고온 쪽에만 적용 — 저온 쪽 계수는 근거가 약해 쓰지 않는다).'),
      stomatalTempOpt: P(24.5, '°C', [18, 30], 'EST', 'Stanghellini (1987) — 학습 지식', '기공이 가장 잘 열리는 엽온(토마토 기준).'),
      stomatalCo2: P(6.1e-7, 'ppm⁻²', [0, 2e-6], 'EST', 'Stanghellini (1987) 기공저항 식의 CO2 항 (1 + c·(CO2 − 200)²), 1,100 ppm 이상은 일정 — 계수는 학습 지식', 'CO2가 높으면 기공이 닫힌다.'),
      dustRate: P(0.0002, 'd⁻¹', [0, 0.002], 'EST', '', '먼지로 인한 투과율 감소가 하루에 쌓이는 양(연 7%쯤). 세척으로 0이 된다.'),
      dustMax: P(0.2, '-', [0, 0.4], 'EST', '', '먼지로 인한 투과율 감소 상한.'),
      rainWash: P(0.2, '-', [0, 1], 'EST', '', '하루 10 mm 이상 비가 오면 씻겨 나가는 먼지 비율.'),
      snowLightDepth: P(2, 'cm', [0.5, 10], 'EST', '', '지붕 적설이 이 깊이면 투과광이 e⁻¹(37%)로 준다.'),
      snowMeltOut: P(0.15, 'cm h⁻¹ °C⁻¹', [0, 1], 'EST', '', '외기온 0°C 초과분 1°C당 지붕 눈 녹는 속도.'),
      snowMeltIn: P(0.03, 'cm h⁻¹ °C⁻¹', [0, 0.3], 'EST', '', '실내 기온 1°C당 지붕 눈 녹는 속도(보온커튼이 닫혀 있으면 그만큼 줄어든다). 난방하는 온실은 눈이 덜 쌓인다.'),
      co2Outside: P(425, 'ppm', [380, 480], 'EST', '', '외기 CO2 농도(2020년대 중반 전 지구 평균 수준).'),
      testCanopyAmax: P(25, 'μmol m⁻² s⁻¹', [10, 40], 'EST', '', '[임시] 작물 모델(Phase 3) 전까지 쓰는 시험용 군락의 잎 최대 광합성(400 ppm 기준). 과채류 통상 범위.'),
      testCanopyQuantumYield: P(0.05, 'mol mol⁻¹', [0.03, 0.08], 'EST', '', '[임시] 흡수 광양자당 CO2 고정.'),
      testCanopyRespiration: P(1.2, 'μmol m⁻² s⁻¹', [0.3, 3], 'EST', '', '[임시] 25°C에서 엽면적당 호흡. 10°C마다 2배.'),
    },
  },
};

const dev = (o) => ({
  name: o.name,
  installCost: P(o.cost, o.costUnit ?? '원/m²', [0, 5e6], 'EST', '', `설치비. ${o.costNote ?? '국내 시공 견적의 통상 수준에 따른 추정. Phase 7에서 정밀화.'}`),
  life: P(o.life, 'yr', [1, 30], 'EST', '', '내용연수.'),
  mtbf: P(o.mtbf, 'h', [500, 100000], 'EST', '', '평균 고장 간격(가동 시간 기준). 시간당 고장 확률 = 1 ÷ 이 값.'),
  repairHours: P(o.repair, 'h', [1, 240], 'EST', '', '수리를 맡긴 뒤 복구까지 걸리는 시간.'),
  ...o.extra,
});

const equipment = {
  _meta: { file: 'equipment', title: '장비(보온·차광·환기·냉난방·CO2·보광·제습·양액 온도)', plannedPhase: 2, schemaVersion: 1 },
  params: {
    curtain: {
      motor: dev({ name: '커튼 개폐기', cost: 2500, life: 10, mtbf: 8000, repair: 8 }),
      materials: {
        pe: { name: 'PE 필름', saving: P(0.25, '-', [0.1, 0.4], 'EST', '', '1겹의 열절감률(피복 열손실 감소 비율).'), shade: P(0.12, '-', [0, 0.3], 'EST', '', '펼쳤을 때 차광률.'), vapor: P(0.08, '-', [0, 1], 'EST', '', '닫힌 커튼 1겹을 수증기가 통과하는 정도(커튼 없음 = 1). 필름이라 습기가 거의 통하지 않는다(틈새로만). 통과한 습기는 찬 피복면에 맺힌다.'), cost: P(1500, '원/m²', [500, 5000], 'EST', '', '겹당 자재비.') },
        nonwoven: { name: '부직포', saving: P(0.3, '-', [0.15, 0.45], 'EST', '', '1겹의 열절감률.'), shade: P(0.45, '-', [0.2, 0.7], 'EST', '', '펼쳤을 때 차광률.'), vapor: P(0.5, '-', [0, 1], 'EST', '', '닫힌 커튼 1겹을 수증기가 통과하는 정도(커튼 없음 = 1). 직물이라 습기가 잘 통한다. 통과한 습기는 찬 피복면에 맺힌다.'), cost: P(2500, '원/m²', [1000, 6000], 'EST', '', '겹당 자재비.') },
        aluminum: { name: '알루미늄 스크린', saving: P(0.4, '-', [0.25, 0.6], 'SRC', '생물환경조절학회지 수록 부여 16연동 PO 온실 난방부하 실험(2013–2014): 알루미늄 스크린 차광 85%, 보온 40%', '1겹의 열절감률.'), shade: P(0.85, '-', [0.5, 1], 'SRC', '위와 같음', '펼쳤을 때 차광률.'), vapor: P(0.3, '-', [0, 1], 'EST', '', '닫힌 커튼 1겹을 수증기가 통과하는 정도(커튼 없음 = 1). 띠 사이로 일부 통한다. 통과한 습기는 찬 피복면에 맺힌다.'), cost: P(6000, '원/m²', [3000, 12000], 'EST', '', '겹당 자재비.') },
        multilayer: { name: '다겹보온커튼', saving: P(0.55, '-', [0.4, 0.7], 'EST', '농촌진흥청 다겹보온커튼 보급 자료(난방비 절감 46–50% 수준으로 홍보)', '1겹(한 벌)의 열절감률.'), shade: P(0.98, '-', [0.9, 1], 'EST', '', '펼쳤을 때 차광률(거의 암막).'), vapor: P(0.08, '-', [0, 1], 'EST', '', '닫힌 커튼 1겹을 수증기가 통과하는 정도(커튼 없음 = 1). 필름층이 있어 거의 통하지 않는다. 통과한 습기는 찬 피복면에 맺힌다.'), cost: P(9000, '원/m²', [5000, 20000], 'EST', '', '자재비.') },
      },
    },
    shade: {
      motor: dev({ name: '차광막 개폐기', cost: 2500, life: 10, mtbf: 8000, repair: 8 }),
      screens: {
        s35: { name: '차광 35%', shade: P(0.35, '-', [0.3, 0.4], 'EST', '', '차광률(제품 규격).'), cost: P(2000, '원/m²', [1000, 5000], 'EST', '', '자재비.') },
        s55: { name: '차광 55%', shade: P(0.55, '-', [0.5, 0.6], 'EST', '', '차광률(제품 규격).'), cost: P(2500, '원/m²', [1000, 6000], 'EST', '', '자재비.') },
        s75: { name: '차광 75%', shade: P(0.75, '-', [0.7, 0.8], 'EST', '', '차광률(제품 규격).'), cost: P(3000, '원/m²', [1000, 7000], 'EST', '', '자재비.') },
      },
    },
    vent: dev({ name: '측창·천창 자동 개폐기', cost: 4000, life: 10, mtbf: 6000, repair: 6 }),
    insectNet: {
      m10: { name: '방충망 1.0 mm', ventFactor: P(0.8, '-', [0.6, 0.95], 'EST', '', '환기량 배율. 방충망 연구에서 망이 촘촘할수록 환기량이 20–50% 준다는 일반 결과에 따른 추정.'), exclusion: { aphid: P(0.3, '-', [0, 1], 'EST', '', '진딧물 유입 차단율(Phase 6에서 사용).'), whitefly: P(0.1, '-', [0, 1], 'EST', '', '가루이 차단율.'), thrips: P(0, '-', [0, 1], 'EST', '', '총채벌레 차단율.') }, cost: P(800, '원/m²', [300, 3000], 'EST', '', '바닥 면적당 환산 자재비.') },
      m06: { name: '방충망 0.6 mm', ventFactor: P(0.62, '-', [0.45, 0.8], 'EST', '', '환기량 배율.'), exclusion: { aphid: P(0.9, '-', [0, 1], 'EST', '', '진딧물 차단율.'), whitefly: P(0.6, '-', [0, 1], 'EST', '', '가루이 차단율.'), thrips: P(0.1, '-', [0, 1], 'EST', '', '총채벌레 차단율.') }, cost: P(1200, '원/m²', [300, 3000], 'EST', '', '바닥 면적당 환산 자재비.') },
      m04: { name: '방충망 0.4 mm', ventFactor: P(0.45, '-', [0.3, 0.65], 'EST', '', '환기량 배율.'), exclusion: { aphid: P(0.99, '-', [0, 1], 'EST', '', '진딧물 차단율.'), whitefly: P(0.95, '-', [0, 1], 'EST', '', '가루이 차단율.'), thrips: P(0.5, '-', [0, 1], 'EST', '', '총채벌레 차단율(성충 몸 폭 약 0.2 mm라 완전 차단 불가).') }, cost: P(1800, '원/m²', [300, 4000], 'EST', '', '바닥 면적당 환산 자재비.') },
    },
    circFan: dev({ name: '순환팬(유동팬)', cost: 1500, life: 8, mtbf: 15000, repair: 4, extra: { power: P(2, 'W/m²', [0.5, 6], 'EST', '', '소비전력(10a당 60 W급 30여 대).') } }),
    fog: dev({ name: '포그(고압 미스트)', cost: 6000, life: 8, mtbf: 3000, repair: 8, extra: { rate: P(300, 'g m⁻² h⁻¹', [50, 800], 'EST', '', '분무량.'), evapFraction: P(0.8, '-', [0.4, 1], 'EST', '', '분무량 중 공기 중에서 증발하는 비율(나머지는 바닥·잎에 떨어진다).'), power: P(3, 'W/m²', [0.5, 10], 'EST', '', '펌프 소비전력.') } }),
    heater: {
      oil: dev({ name: '온풍기(경유·등유)', cost: 60000, costUnit: '원/kW', life: 10, mtbf: 3000, repair: 12, extra: { efficiency: P(0.85, '-', [0.7, 0.95], 'EST', '', '열효율(순발열량 기준).'), blowerPower: P(0.02, 'W/W', [0, 0.05], 'EST', '', '난방 출력 대비 송풍기 전력.') } }),
      electric: dev({ name: '전기 온풍기', cost: 40000, costUnit: '원/kW', life: 10, mtbf: 8000, repair: 8, extra: { efficiency: P(0.98, '-', [0.9, 1], 'EST', '', '전기 → 열 변환 효율.') } }),
      heatpump: dev({ name: '공기열 히트펌프', cost: 600000, costUnit: '원/kW', life: 12, mtbf: 5000, repair: 24, extra: { copBase: P(2.0, '-', [1.2, 3], 'EST', '', '외기 −10°C에서의 난방 성능계수(COP).'), copSlope: P(0.06, '°C⁻¹', [0, 0.15], 'EST', '', '외기온 1°C 오를 때 COP 증가(상한 4.0, 하한 1.6). 외기가 추울수록 효율이 떨어지는 성질.') } }),
      geothermal: dev({ name: '지열 히트펌프', cost: 1500000, costUnit: '원/kW', life: 15, mtbf: 6000, repair: 24, extra: { cop: P(3.8, '-', [3, 5], 'EST', '', '난방 COP(지중 열원이라 외기온과 거의 무관).') } }),
    },
    cooling: {
      padfan: dev({ name: '패드앤팬', cost: 12000, life: 8, mtbf: 4000, repair: 8, extra: { efficiency: P(0.8, '-', [0.6, 0.9], 'EST', '', '포화 효율: 유입 공기가 습구온도에 접근하는 정도.'), airflow: P(0.05, 'm³ m⁻² s⁻¹', [0.02, 0.1], 'EST', '', '팬 풍량(바닥 면적당). 분당 환기 1회 설계의 절반 수준.'), power: P(8, 'W/m²', [2, 20], 'EST', '', '팬 + 펌프 소비전력.') } }),
      heatpump: dev({ name: '히트펌프 냉방', cost: 600000, costUnit: '원/kW', life: 12, mtbf: 5000, repair: 24, extra: { cop: P(3.0, '-', [2, 4.5], 'EST', '', '냉방 COP.') } }),
    },
    co2: {
      liquid: dev({ name: '액화탄산가스', cost: 3000, life: 10, mtbf: 10000, repair: 6, extra: { rate: P(10, 'g m⁻² h⁻¹', [2, 30], 'EST', '', '최대 공급량(ha당 100 kg/h 수준).') } }),
      burner: dev({ name: '연소식 발생기(등유)', cost: 2500, life: 8, mtbf: 4000, repair: 8, extra: { rate: P(6, 'g m⁻² h⁻¹', [2, 20], 'EST', '', '최대 CO2 발생량.'), co2PerLiter: P(2.48, 'kg/L', [2.3, 2.7], 'EST', '', '등유 1 L 연소 시 CO2. 화학량론: 밀도 0.8 kg/L × 탄소 질량비 → 0.8 × (12×44/170).'), waterPerLiter: P(1.1, 'kg/L', [0.9, 1.3], 'EST', '', '등유 1 L 연소 시 수증기(화학량론). 실내 습도를 올린다.'), heatFraction: P(0.95, '-', [0.8, 1], 'EST', '', '연소열 중 실내에 남는 비율(무배기형).') } }),
    },
    light: {
      led: dev({ name: 'LED 보광등', cost: 600, costUnit: '원/(μmol m⁻² s⁻¹·m²)', life: 10, mtbf: 20000, repair: 12, extra: { efficacy: P(2.7, 'μmol/J', [2, 3.5], 'EST', '', '광양자 효율(원예용 LED 통상 2.5–3.0).'), radiantFraction: P(0.5, '-', [0.3, 0.7], 'EST', '', '소비전력 중 아래로 복사되는 비율(나머지는 등기구에서 대류열).') } }),
      hps: dev({ name: '고압나트륨등(HPS)', cost: 300, costUnit: '원/(μmol m⁻² s⁻¹·m²)', life: 6, mtbf: 10000, repair: 12, extra: { efficacy: P(1.8, 'μmol/J', [1.5, 2.1], 'EST', '', '광양자 효율(통상 1.7–1.85).'), radiantFraction: P(0.75, '-', [0.5, 0.9], 'EST', '', '복사열 비율이 높아 작물체를 데운다.') } }),
    },
    dehumidifier: dev({ name: '제습기', cost: 8000, life: 8, mtbf: 5000, repair: 12, extra: { rate: P(15, 'g m⁻² h⁻¹', [3, 50], 'EST', '', '제습량(10a당 시간당 15 L 수준).'), energyPerKg: P(0.4, 'kWh/kg', [0.2, 0.8], 'EST', '', '물 1 kg 제거에 드는 전력(응축식).'), minRh: P(45, '%', [30, 60], 'EST', '', '이 습도 아래로는 제습 능력이 사라진다.') } }),
    solution: {
      chiller: dev({ name: '양액 냉각기', cost: 15000, life: 8, mtbf: 5000, repair: 24, extra: { capacity: P(40, 'W/m²', [10, 100], 'EST', '', '냉각 능력(바닥 면적당).'), cop: P(2.8, '-', [2, 4], 'EST', '', '냉각 COP.') } }),
      heater: dev({ name: '양액 가온기', cost: 5000, life: 8, mtbf: 8000, repair: 12, extra: { capacity: P(40, 'W/m²', [10, 100], 'EST', '', '가온 능력(전기 히터).'), efficiency: P(0.98, '-', [0.9, 1], 'EST', '', '전기 → 열.') } }),
      capacity: P(42, 'kJ m⁻² K⁻¹', [10, 120], 'EST', '', '바닥 면적당 양액·배지 수분의 열용량(약 10 L m⁻²).'),
      airCoupling: P(4, 'h', [1, 12], 'EST', '', '양액 온도가 실내 기온을 따라가는 시간 상수.'),
    },
  },
};

const prices = {
  _meta: { file: 'prices', title: '가격(에너지·자재·농산물)', plannedPhase: 2, schemaVersion: 1 },
  params: {
    energy: {
      taxFreeDiesel: P(1300, '원/L', [900, 1700], 'SRC', '오피넷 면세유 평균가 보도(헤럴드경제·경향신문 2026-04): 면세 경유 2026-03-01 약 1,104원 → 2026-04-25 약 1,499원', '농업용 면세 경유. 급등 전후의 중간값. 시장 변동은 Phase 7에서.'),
      taxFreeKerosene: P(1250, '원/L', [850, 1700], 'EST', '', '농업용 면세 등유. 면세 경유와 비슷한 수준으로 움직인다는 점에 따른 추정(면세 등유 고시가 미확보).'),
      diesel: P(1750, '원/L', [1300, 2200], 'EST', '', '과세 경유(면세유 한도 초과분).'),
      kerosene: P(1500, '원/L', [1100, 2000], 'EST', '', '과세 실내등유.'),
      dieselHeat: P(35.25, 'MJ/L', [34, 36.5], 'SRC', '에너지법 시행규칙 에너지열량 환산기준: 경유 순발열량 0.842×10⁻³ toe/L (1 toe = 41.868 GJ)', '순발열량.'),
      keroseneHeat: P(34.12, 'MJ/L', [33, 35.5], 'SRC', '에너지법 시행규칙 에너지열량 환산기준: 등유 순발열량 0.815×10⁻³ toe/L', '순발열량.'),
      elecEnergy: P(57, '원/kWh', [35, 90], 'EST', '해양수산부 보도자료: 농사용(을) 전력량요금 34.2원(2022.1) → 53원(2023.12)', '농사용(을) 저압 전력량요금. 53원에 이후 분할 인상분(3.8원)을 한 번 더한 추정. 현행 요금표 미확보.'),
      elecLevy: P(14, '원/kWh', [5, 25], 'EST', '연료비조정단가 kWh당 +5원 유지(2025년 보도)', '기후환경요금(약 9원) + 연료비조정요금(5원).'),
      elecBasic: P(1150, '원/kW·월', [300, 3000], 'EST', '', '농사용(을) 저압 기본요금(계약전력 kW당). 현행 요금표 미확보.'),
      elecSurcharge: P(1.127, '-', [1.1, 1.15], 'SRC', '부가가치세 10% + 전력산업기반기금 2.7%(2025-07부터)', '요금 합계에 곱하는 배율.'),
      liquidCo2: P(500, '원/kg', [200, 1000], 'EST', '', '액화탄산가스 공급가(벌크·용기 구분 없이 대략). 가격 자료 미확보.'),
    },
  },
};

writeFileSync(join(root, 'data/facilities.json'), JSON.stringify(facilities, null, 1) + '\n');
writeFileSync(join(root, 'data/equipment.json'), JSON.stringify(equipment, null, 1) + '\n');
writeFileSync(join(root, 'data/prices.json'), JSON.stringify(prices, null, 1) + '\n');
console.log('data/facilities.json, equipment.json, prices.json 생성.');
