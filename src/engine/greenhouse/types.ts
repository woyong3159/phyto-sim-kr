/**
 * 시설·장비 구성(setup), 제어 설정(settings), 온실 상태(state) 타입.
 */
export const FACILITY_IDS = ['single_pe', 'multi_pe', 'multi_po', 'venlo'] as const;
export type FacilityId = (typeof FACILITY_IDS)[number];

export type CurtainMaterial = 'pe' | 'nonwoven' | 'aluminum' | 'multilayer';
export type ShadeId = 'none' | 's35' | 's55' | 's75';
export type NetId = 'none' | 'm10' | 'm06' | 'm04';
export type HeaterId = 'none' | 'oil' | 'electric' | 'heatpump' | 'geothermal';
export type FuelId = 'taxFreeDiesel' | 'taxFreeKerosene' | 'diesel' | 'kerosene';
export type CoolingId = 'none' | 'padfan' | 'heatpump';
export type Co2Id = 'none' | 'liquid' | 'burner';
export type LightId = 'none' | 'led' | 'hps';

/** 시설·장비 구성. 작기 시작 때 정하고, 작기 중에도 바꿀 수 있다(조치로 기록). */
export interface GhSetup {
  facility: FacilityId;
  /** 바닥 면적 m² */
  area: number;
  /** 피복 겹수(1중 / 2중). 2중은 보온이 좋아지고 빛이 조금 준다 */
  coverLayers: 1 | 2;
  /** 피복재 경과 연수 */
  coverAge: number;
  curtainLayers: 0 | 1 | 2 | 3;
  curtainMaterial: CurtainMaterial;
  shade: ShadeId;
  /** 측창·천창 자동 개폐(시설에 해당 창이 있을 때만 의미가 있다) */
  sideVent: boolean;
  roofVent: boolean;
  insectNet: NetId;
  circFan: boolean;
  fog: boolean;
  heater: HeaterId;
  fuel: FuelId;
  /** 난방 용량 W/m² */
  heaterCapacity: number;
  cooling: CoolingId;
  /** 히트펌프 냉방 용량 W/m² */
  coolingCapacity: number;
  co2: Co2Id;
  light: LightId;
  /** 보광 설치 광량 μmol m⁻² s⁻¹ */
  lightPpfd: number;
  dehumidifier: boolean;
  solutionChiller: boolean;
  solutionHeater: boolean;
  /** [임시] 작물 모델(Phase 3) 전까지 쓰는 시험용 군락의 엽면적지수. 0 = 빈 온실 */
  testLai: number;
}

export interface TimeBlock {
  /** 시작·종료 시각(0–24, 종료가 시작보다 작으면 자정을 넘긴다) */
  start: number;
  end: number;
  /** 이 시간대의 난방 설정온도 °C */
  heat: number;
}

/** 제어 설정값. 모두 사용자가 직접 정한다. */
export interface ControlSettings {
  // 온도
  heatDay: number;
  heatNight: number;
  heatPreDawn: number;
  /** 일출 전 몇 시간을 "일출 전" 구간으로 볼지 */
  preDawnHours: number;
  /** 시간대별 프로그램(있으면 주간·야간·일출 전 설정보다 우선) */
  blocks: TimeBlock[];
  // 환기
  ventTemp: number;
  /** 비례대(°C): 환기 개시 온도에서 이만큼 오르면 100% */
  ventBand: number;
  /** 개도 한 단계(%) */
  ventStep: number;
  ventMax: number;
  closeWind: number;
  closeOnRain: boolean;
  // 습도
  rhMax: number;
  rhMin: number;
  /** 습도 상한 초과 시: 제습기 우선 / 환기 우선 */
  humidityPriority: 'dehumidifier' | 'vent';
  /** 습도 환기 시 최대 개도(%) */
  humidityVentMax: number;
  fogTemp: number;
  fogRhMax: number;
  // 냉방
  coolTemp: number;
  // CO2
  co2Target: number;
  co2Start: number;
  co2End: number;
  /** 창 개도가 이 값(%)을 넘으면 공급 중단. 100이면 중단하지 않는다 */
  co2VentMax: number;
  // 차광
  shadeOnW: number;
  // 커튼
  /** 일몰 기준 닫는 시각(시간, 음수면 일몰 전) / 일출 기준 여는 시각 */
  curtainCloseOffset: number;
  curtainOpenOffset: number;
  /** 외기온이 이 값보다 낮을 때만 닫는다 */
  curtainOutTemp: number;
  // 보광
  lightMode: 'off' | 'window' | 'extend';
  lightStart: number;
  lightEnd: number;
  /** 외기 일사가 이 값(W/m²)을 넘으면 끈다 */
  lightOffAboveW: number;
  /** 목표 일적산광량(DLI, mol m⁻² d⁻¹). 0이면 쓰지 않는다 */
  lightTargetDli: number;
  /** 일장 연장 모드의 목표 명기(시간) */
  photoperiod: number;
  // 양액 온도
  solutionMin: number;
  solutionMax: number;
}

export const DEVICES = ['vent', 'curtain', 'shade', 'circFan', 'fog', 'heater', 'cooling', 'co2', 'light', 'dehumidifier', 'solutionChiller', 'solutionHeater'] as const;
export type DeviceId = (typeof DEVICES)[number];

/** 한 시간 동안의 온실 요약(화면·원장용). 평균값 또는 시간 끝 값. */
export interface GhHour {
  tIn: number;
  rhIn: number;
  vpd: number;
  co2: number;
  /** 군락 상단 광양자속밀도 μmol m⁻² s⁻¹ (보광 포함) */
  ppfd: number;
  tLeaf: number;
  dewPoint: number;
  /** 피복 안쪽 면 온도(결로가 맺히는 면) */
  tSurface: number;
  tMass: number;
  tSolution: number;
  /** 환기 횟수 h⁻¹ (창 + 틈새 + 팬) */
  ach: number;
  /** 장치 가동률 0–1 (시간 평균) */
  vent: number;
  curtain: number;
  shade: number;
  heat: number;
  cool: number;
  fog: number;
  dehum: number;
  co2Dose: number;
  light: number;
  /** 평균 열량 W/m² */
  heatW: number;
  /** 증산 g m⁻² h⁻¹ */
  transpiration: number;
  /** 피복면 결로 시간, 엽면 습윤 시간(이 한 시간 중 비율 0–1) */
  condensation: number;
  leafWet: number;
  /** 난방을 100% 돌려도 설정온도에 1°C 넘게 못 미친 시간 비율 */
  heatDeficit: number;
  /** 지붕 적설 cm, 투과율(노후·먼지·적설 반영) */
  roofSnow: number;
  transmissivity: number;
  /** 이 시간의 소모량(온실 전체) */
  fuelL: number;
  kWh: number;
  co2Kg: number;
  won: number;
  /** 에너지 수지(J m⁻², 이 한 시간): 들어온 열, 나간 열, 저장 변화 */
  eIn: number;
  eOut: number;
  eStore: number;
  /** 물 수지(kg m⁻²)와 CO2 수지(kg m⁻²): 들어온 양, 나간 양, 공기 중 저장 변화 */
  wIn: number;
  wOut: number;
  wStore: number;
  cIn: number;
  cOut: number;
  cStore: number;
  /** 작물: 총광합성·유지호흡·호흡 부족분(g CH2O m⁻², 이 한 시간), 군락 PAR 흡수율, 산란광 비율 */
  cGross: number;
  cMaint: number;
  cStarve: number;
  parAbsorbed: number;
  diffuse: number;
}

/** 하루 요약. */
export interface GhDay {
  dayIndex: number;
  tMin: number;
  tMax: number;
  tMean: number;
  rhMean: number;
  /** 일적산광량 mol m⁻² d⁻¹ */
  dli: number;
  condensationH: number;
  leafWetH: number;
  heatDeficitH: number;
  fuelL: number;
  kWh: number;
  co2Kg: number;
  won: number;
}

export interface GhState {
  setup: GhSetup;
  settings: ControlSettings;
  /** 실내 기온 °C, 수증기압 kPa, CO2 ppm, 축열체 온도, 양액 온도 */
  tIn: number;
  vp: number;
  co2: number;
  tMass: number;
  tSolution: number;
  /** 구동기 위치·상태 */
  ventPos: number;
  curtainPos: number;
  shadePos: number;
  heaterOn: boolean;
  /** 먼지로 인한 투과율 감소, 지붕 적설(cm) */
  dust: number;
  roofSnow: number;
  /** 피복 파손(강풍), 붕괴(적설) */
  breached: boolean;
  destroyed: boolean;
  /** 장치 고장: 0 정상, −1 고장(수리 전), 양수 = 복구되는 게임 시각(h) */
  failures: Record<DeviceId, number>;
  /** 다음 스텝에 공기로 돌려줄 응결 잠열(J m⁻²) */
  pendingLatent: number;
  out: GhHour;
  today: GhDay;
  yesterday: GhDay | null;
  /** 작기 누적 */
  total: { fuelL: number; kWh: number; co2Kg: number; won: number };
}

export function defaultSetup(facility: FacilityId = 'multi_pe'): GhSetup {
  const venlo = facility === 'venlo';
  const po = facility === 'multi_po';
  const single = facility === 'single_pe';
  return {
    facility,
    area: 1000,
    coverLayers: venlo ? 1 : 2,
    coverAge: 0,
    curtainLayers: single ? 1 : 2,
    curtainMaterial: venlo || po ? 'aluminum' : single ? 'nonwoven' : 'multilayer',
    shade: 's55',
    sideVent: !venlo,
    roofVent: !single,
    insectNet: 'none',
    circFan: true,
    fog: false,
    heater: 'oil',
    fuel: 'taxFreeKerosene',
    heaterCapacity: 200,
    cooling: 'none',
    coolingCapacity: 150,
    co2: 'none',
    light: 'none',
    lightPpfd: 150,
    dehumidifier: false,
    solutionChiller: false,
    solutionHeater: false,
    testLai: 0,
  };
}

export function defaultSettings(): ControlSettings {
  return {
    heatDay: 14,
    heatNight: 12,
    heatPreDawn: 13,
    preDawnHours: 2,
    blocks: [],
    ventTemp: 25,
    ventBand: 5,
    ventStep: 10,
    ventMax: 100,
    closeWind: 12,
    closeOnRain: true,
    rhMax: 92,
    rhMin: 40,
    humidityPriority: 'dehumidifier',
    humidityVentMax: 10,
    fogTemp: 32,
    fogRhMax: 80,
    coolTemp: 28,
    co2Target: 800,
    co2Start: 7,
    co2End: 15,
    co2VentMax: 10,
    shadeOnW: 700,
    curtainCloseOffset: 0,
    curtainOpenOffset: 0.5,
    curtainOutTemp: 15,
    lightMode: 'off',
    lightStart: 5,
    lightEnd: 9,
    lightOffAboveW: 200,
    lightTargetDli: 0,
    photoperiod: 16,
    solutionMin: 15,
    solutionMax: 23,
  };
}

export const emptyHour = (): GhHour => ({
  tIn: 0, rhIn: 0, vpd: 0, co2: 0, ppfd: 0, tLeaf: 0, dewPoint: 0, tSurface: 0, tMass: 0, tSolution: 0, ach: 0,
  vent: 0, curtain: 0, shade: 0, heat: 0, cool: 0, fog: 0, dehum: 0, co2Dose: 0, light: 0, heatW: 0, transpiration: 0,
  condensation: 0, leafWet: 0, heatDeficit: 0, roofSnow: 0, transmissivity: 0, fuelL: 0, kWh: 0, co2Kg: 0, won: 0, eIn: 0, eOut: 0, eStore: 0, wIn: 0, wOut: 0, wStore: 0, cIn: 0, cOut: 0, cStore: 0, cGross: 0, cMaint: 0, cStarve: 0, parAbsorbed: 0, diffuse: 0,
});

export const emptyDay = (dayIndex: number): GhDay => ({ dayIndex, tMin: 99, tMax: -99, tMean: 0, rhMean: 0, dli: 0, condensationH: 0, leafWetH: 0, heatDeficitH: 0, fuelL: 0, kWh: 0, co2Kg: 0, won: 0 });
