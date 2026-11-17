import type { Curve } from '../crop/types';
import type { ChemParams, FertLib, Ion, IonVec } from './chem';

export type RzSystem = 'rockwool' | 'coir' | 'peatPerlite' | 'nft' | 'dft';
export type WaterSource = 'groundwater' | 'tap' | 'rain';
export type IrrMode = 'solar' | 'timer' | 'sensor' | 'continuous' | 'off';

/** 근권 시설 구성(작기 중 재배 방식 자체는 작물이 없을 때만 바꿀 수 있다). */
export interface RzSetup {
  system: RzSystem;
  /** 배액: 버림식 / 순환식 */
  drain: 'open' | 'closed';
  disinfect: 'none' | 'uv' | 'heat';
  /** DFT 에어펌프 */
  aeration: boolean;
  water: WaterSource;
  /** 빗물 탱크가 비었을 때 쓸 원수 */
  backup: 'groundwater' | 'tap';
  /** 빗물 탱크 L/m²(바닥) */
  rainTank: number;
  injector: 'proportional' | 'mixing';
  /** EC·pH 미터 보유 */
  meter: boolean;
}

export interface IrrSettings {
  mode: IrrMode;
  /** 일사비례: 바깥 누적 일사 J/cm²마다 1회 */
  solarJ: number;
  /** 타이머: 하루 횟수 */
  timerCount: number;
  /** 센서: 이 체적 수분율(%) 아래로 떨어지면 관수 */
  sensorTheta: number;
  /** 1회 관수량 mL/주 */
  dose: number;
  start: number;
  end: number;
  /** 최소 간격(분) */
  minGap: number;
  /** 시작 시각에 첫 관수 */
  startShot: boolean;
  /** 목표 배액률 %(자동 보정을 켜면 1회 관수량을 매일 조정) */
  drainTarget: number;
  autoDrain: boolean;
  /** 순환식: 회수 배액을 급액에 섞는 최대 비율 */
  reuse: number;
  /** 수경: 양액 전량 교체 주기(일, 0 = 교체 안 함) */
  renewDays: number;
}

export interface NutSettings {
  /** 원료 kg(탱크 한 번 분량) */
  tanks: { A: Record<string, number>; B: Record<string, number>; acid: Record<string, number> };
  volume: { A: number; B: number; acid: number };
  /** 원액 희석 배율 1:D */
  dilution: number;
  /** 산 탱크 희석 배율(비례 주입기) */
  acidDilution: number;
  /** EC 프로그램 [정식 후 일, EC dS/m] — 혼합기에서만 쓴다 */
  ecProgram: [number, number][];
  phTarget: number;
  /** false = 원액을 넣지 않는다(물만 준다) */
  feedOn: boolean;
  autoRefill: boolean;
}

export interface StockTank {
  /** 남은 원액 L */
  left: number;
  ions: IonVec;
  chelFe: Record<string, number>;
  /** 원액 1 L의 침전물 mol */
  precip: number;
  recipeKey: string;
}

export interface Lab {
  kind: 'feed' | 'drain' | 'tissue' | 'water';
  ordered: number;
  ready: number;
  /** 결과(채취 시점 값) */
  ions?: IonVec;
  ec?: number;
  pH?: number;
  tissue?: Partial<Record<Ion, [number, number]>>;
}

export interface PlantPools {
  cropKey: string;
  /** 구획 건물 g/m²(지난 시간) */
  dm: { up: number; low: number; str: number; fr: number };
  /** 구획별 원소 mmol/m² */
  up: IonVec;
  low: IonVec;
  str: IonVec;
  fr: IonVec;
  /** 지난 시간까지의 그날 생장 누적(시간 증분 계산용) */
  prevG: { day: number; leaf: number; stem: number; root: number; fruit: number };
  /** 팁번: 오늘 신엽으로 간 칼슘과 필요량, 지수 */
  caUp: number;
  caNeed: number;
  /** 어제 어린 잎에 간 칼슘 ÷ 필요량 */
  caRatio: number;
  tipburn: number;
}

export interface RzBalance {
  waterIn: number;
  waterUptake: number;
  waterDrain: number;
  ionIn: IonVec;
  ionUptake: IonVec;
  ionDrain: IonVec;
  ionPrecip: IonVec;
  /** 열린 계 탄산 평형으로 기체와 주고받은 무기탄소(+ = 용액으로 들어옴) */
  gasC: number;
  /** 질산화로 암모늄 → 질산이 된 양(mmol/m²) */
  nitrified: number;
  /** 식물: 정식 때 들여온 양, 수확·낙엽으로 나간 양 */
  plantIn: IonVec;
  plantOut: IonVec;
}

export interface RzDay {
  dayIndex: number;
  /** L/m² */
  feed: number;
  drain: number;
  uptake: number;
  events: number;
  /** 급액·배액 EC/pH(부피 가중 평균) */
  feedEc: number;
  feedPh: number;
  drainEc: number;
  drainPh: number;
  /** 근권(배지·양액) 평균 */
  rootEc: number;
  rootPh: number;
  theta: number;
  rootT: number;
  o2: number;
  won: number;
  /** 작업 시간 h(원액 제조·라인 세척) */
  labor: number;
  hours: number;
}

/** 작기 누적 비용(원)·물(L/m²) */
export interface RzTotal {
  won: number;
  fert: number;
  water: number;
  elec: number;
  lab: number;
  feed: number;
  drain: number;
  labor: number;
}

export interface RzOut {
  /** 근권 용액 */
  ions: IonVec;
  ec: number;
  pH: number;
  /** 배지 체적 수분율, 매트릭 퍼텐셜 kPa, 기상률 */
  theta: number;
  psi: number;
  afp: number;
  /** 수경 용존산소 mg/L */
  dO: number;
  rootT: number;
  /** 산소 가용도·뿌리 활력·뿌리 건강도 */
  o2: number;
  rootAct: number;
  health: number;
  /** 이번 시간 급액·배액 */
  feedEc: number;
  feedPh: number;
  feedIons: IonVec;
  drainEc: number;
  drainPh: number;
  /** 작물에 넘기는 공급 계수 */
  supply: RzSupply;
  /** 식물 양분 상태: 원소별 [신엽 값, 하위엽 값] (%, mg/kg) */
  tissue: Partial<Record<Ion, [number, number]>>;
  /** 이번 시간 흡수 mmol/m² */
  uptake: IonVec;
  clog: number;
}

/** 작물 모듈이 받는 근권 공급(Phase 3의 인터페이스를 채운다). */
export interface RzSupply {
  water: number;
  /** 양분만의 종합 계수(염해 제외, 표시용) */
  nutrient: number;
  /** 군락 깊이별(위·가운데·아래) 광합성 양분 계수 */
  photo: [number, number, number];
  expand: number;
  fruit: number;
  set: number;
  salt: number;
  /** 딸기 당도(과실 건물률) 배수 */
  brix: number;
  /** 신엽 질소 ÷ 적정(딸기 화아분화) */
  plantN: number;
  tRoot: number;
  rootAct: number;
  tipburn: number;
}

export interface RzState {
  setup: RzSetup;
  irr: IrrSettings;
  nut: NutSettings;
  /** 배지(또는 수경 양액) 물 L/m², 이온 mmol/L, 킬레이트철 종류별 mmol/L(배지 안) */
  W: number;
  ions: IonVec;
  chelFe: Record<string, number>;
  /** 순환식 배액 탱크 L/m²와 조성, 빗물 탱크 L/m² */
  drainTank: number;
  drainIons: IonVec;
  rain: number;
  stock: { A: StockTank; B: StockTank; acid: StockTank };
  /** 일사 적산 J/cm², 마지막 관수 시각(h) */
  solarAcc: number;
  lastShot: number;
  /** 배액률 자동 보정으로 바뀐 1회 관수량 배수 */
  doseScale: number;
  dO: number;
  health: number;
  clog: number;
  lastRenew: number;
  labs: Lab[];
  plant: PlantPools | null;
  bal: RzBalance;
  today: RzDay;
  yesterday: RzDay | null;
  total: RzTotal;
  out: RzOut;
}

// ───────── 데이터(rootzone.json 등)에서 만든 파라미터 ─────────

export interface SubstrateSys {
  kind: 'substrate';
  name: string;
  volume: number;
  height: number;
  thetaS: number;
  thetaR: number;
  alpha: number;
  n: number;
  bypass: number;
  drainTau: number;
  nitrify: number;
  installCost: number;
  note: string;
}
export interface HydroSys {
  kind: 'hydro';
  name: string;
  volume: number;
  kla: number;
  klaAerated: number;
  nitrify: number;
  installCost: number;
  note: string;
}

export interface UptakeIon {
  imax: number;
  km: number;
  sigma: number;
  mobility: number;
  xylem: number;
  young: number;
  stem: number;
}

export interface CropNutrition {
  leaf: Partial<Record<Ion, [number, number, number, number]>>;
  fruit: Partial<Record<Ion, number>>;
  salt: { a: number; b: number };
  rootTemp: Curve | null;
  tipburn: number;
  brixK?: number;
  brixEC?: number;
  brixECRef?: number;
}

export interface WaterProfile {
  name: string;
  note: string;
  mgL: Partial<Record<Ion, number>>;
  pH: number;
  ec: number;
}

export interface RzParams {
  systems: Record<RzSystem, SubstrateSys | HydroSys>;
  substrate: { psiCurve: Curve; afp: Curve; afpTempRef: number; afpTemp: number; tempWeight: number };
  hydro: { doTarget: Curve; rootO2: number; rootO2Q10: number; pumpFail: number };
  doSat: number[];
  chem: ChemParams;
  chelate: { EDTA: Curve; DTPA: Curve; EDDHA: Curve; free: Curve; decay: number; freeRate: number };
  uptake: Record<Ion, UptakeIon>;
  antagonism: Partial<Record<Ion, Partial<Record<Ion, number>>>>;
  pHAvail: Partial<Record<Ion, Curve>>;
  mnLowPH: number;
  root: { activeRootShoot: number; chargeImbalance: number; cationSlack: number; regulation: number; upRegulation: number; waterWeight: number; healthLoss: number; healthGain: number };
  plant: { youngAge: number; remob: number; senescRemob: number; strFactor: number; youngTransp: number; fruitTransp: number; rootPressure: number; rootPressureEC: number; defFloor: number; tipburnDays: number };
  irrigation: { maxEventsPerHour: number; autoDrainStep: number };
  tanks: { stockVolume: number; acidVolume: number; drainVolume: number; rainVolume: number; mixLabor: number; renewLabor: number };
  clog: { stockSuspended: number; perMol: number; rawFe: number; caP: number; flowLoss: number; flushKeep: number; flushLabor: number };
  equipment: { injectorProp: number; injectorMix: number; uv: number; uvPower: number; heatDisinfect: number; heatPower: number; aeration: number; meter: number };
  lab: { delay: number; solution: number; tissue: number; water: number };
  ferts: FertLib;
  recipes: Record<string, { name: string; tag: string; source: string; note: string; mmol: Partial<Record<Ion, number>> }>;
  water: { profiles: Record<string, WaterProfile>; regions: Record<string, string>; cost: { tap: number; groundwaterPump: number; rainCollect: number } };
  crop: Record<'cucumber' | 'strawberry' | 'wasabi', CropNutrition>;
  toECe: number;
  defaults: Record<'cucumber' | 'strawberry' | 'wasabi', { system: RzSystem; drain: 'open' | 'closed'; recipe: string; ec: [number, number][]; ph: number; irrigation: { mode: IrrMode; solarJ: number; dose: number; start: number; end: number; minGap: number; drainTarget: number } }>;
}
