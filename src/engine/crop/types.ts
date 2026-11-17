/**
 * 작물 모듈 공용 타입. 모든 양은 "평균 한 포기" 기준(마디·잎·과실)과 "온실 바닥 1 m²" 기준(저장고·줄기·뿌리·수량)을 구분한다.
 * 생리일수(pd, physiological day): 최적온도에서 하루 = 1 pd. 발육은 TT = Σ f_T(T)·Δt (헌법 G4).
 */

/** 사다리꼴 반응곡선 [x0, x1, x2, x3] */
export type Curve = [number, number, number, number];

export interface CoreParams {
  photo: {
    scatter: number;
    theta: number;
    quantumMax: number;
    gammaStar25: number;
    gammaStarSlope: number;
    ciA: number;
    ciB: number;
    co2HalfSat: number;
    co2Ref: number;
    poolUse: number;
    poolFeedbackStart: number;
    poolFeedbackFull: number;
    poolFeedbackMin: number;
    q10: number;
    carbonCH2O: number;
  };
  water: { expand: Curve; fruit: Curve; photo: Curve };
}

export interface CucumberParams {
  name: string;
  dev: { tBase: number; tOpt: number; tMax: number };
  photo: { pmax: number; pmaxTemp: Curve; ageX: number[]; ageY: number[]; kDiffuse: number; kLaiSlope: number; kMin: number; lmaExp: number; stomatalMin: number };
  resp: { leaf: number; stem: number; root: number; fruit: number; cvfLeaf: number; cvfStem: number; cvfRoot: number; cvfFruit: number; carbonVeg: number; carbonFruit: number };
  leaf: { rate: number; maxArea: number; expandDays: number; sla: number; slaDliRef: number; slaLightExp: number; slaTemp: number; slaTempRef: number; slaMin: number; slaMax: number; life: number; senescence: number; shadeLight: number; shadeSenescence: number; starveLoss: number; acclimDays: number };
  stem: { ratio: number; rootRatio: number; internode: number; internodeNightRef: number; internodeNight: number; internodeLightExp: number; internodeMin: number; internodeMax: number };
  fruit: {
    wMax: number; rate: number; mid: number; anthesisAge: number; abortWindow: number; preAnthesis: number; ssrLag: number; oversizeCull: number; abortMax: number; setSsr: Curve; setTemp: Curve; growTemp: Curve;
    dmc: number; dmcLight: number; lenA: number; lenB: number; femaleNightRef: number; femaleNight: number; femaleDayRef: number; femaleDay: number; femaleMin: number; femaleLag: number;
    curveStart: number; curveFull: number; colorDli: Curve; staleAge: number; oversize: number;
  };
  lateral: { delay: number; rate: number; maxNodes: number; areaFactor: number; female: number; ssr: Curve };
  training: { limit: number; clump: number; curve: number };
  damage: { chillTemp: number; chillRate: number; frostTemp: number; frostRate: number; heatTemp: number; heatRate: number };
  labor: { plant: number; train: number; deleaf: number; thin: number; pinch: number; harvestBase: number; harvestPerTon: number; remove: number; workHour: number };
  seedling: { leaves: number; leafCap: number; shockFactor: number; leafArea: number; leafW: number; stemW: number; rootW: number; shock: number };
  density: number;
  systems: Record<string, { name: string; sowing: string; harvest: string; transplantMonth: number; transplantDay: number; benchYield: number }>;
}

export interface CucumberVariety {
  name: string;
  type: string;
  desc: string;
  real: boolean;
  female: number;
  pmaxFactor: number;
  leafArea: number;
  fruitWMax: number;
  harvestWeight: number;
  lenA: number;
  curveSens: number;
  coldTol: number;
  heatTol: number;
  firstHarvestDays: number;
  potentialYield: number;
  resistance: Record<string, number>;
  pricePremium: number;
  seedlingPrice: number;
}

export interface CropData {
  core: CoreParams;
  cucumber: CucumberParams;
  varieties: { cucumber: Record<string, CucumberVariety> };
}

export type CropId = 'cucumber';
export type WorkTask = 'train' | 'deleaf' | 'harvest' | 'pinch' | 'thin';

/** 작업 계획(반복 작업). 간격 0 = 하지 않음(방치). */
export interface WorkPlan {
  /** 유인·곁순 정리 간격(일) */
  trainEvery: number;
  /** 곁순을 몇 마디 남기고 자를지(0 = 모두 제거) */
  lateralKeep: number;
  /** 아래 몇 마디까지 암꽃을 따낼지(적화) */
  removeBelowNode: number;
  /** 한 포기에 달아 둘 과실 수 상한(적과, 0 = 제한 없음) */
  maxFruit: number;
  /** 적엽 간격(일)과 남길 잎 수 */
  deleafEvery: number;
  leavesKeep: number;
  /** 적심할 마디(0 = 적심하지 않고 계속 키움) */
  pinchNode: number;
  /** 수확 간격(일)과 수확 기준 무게(g, 0 = 품종 표준) */
  harvestEvery: number;
  harvestWeight: number;
}

export interface PlantOrder {
  cropId: CropId;
  varietyId: string;
  /** 작형(촉성·반촉성·억제) — 권장 시기와 벤치마크 표시에만 쓴다 */
  system: string;
  /** 재식밀도 주 m⁻² */
  density: number;
  plan: WorkPlan;
}

export interface LeafNode {
  /** 전개 후 생리일수 */
  age: number;
  /** 엽면적 m² (한 포기의 이 잎) */
  area: number;
  /** 건물중 g */
  w: number;
  /** 잠재 최대 면적 m² */
  cap: number;
  /** 지금까지의 최대 면적(노화 판정용) */
  peak: number;
  lat: 0 | 1;
}

export interface Fruit {
  /** 마디 번호(원줄기), 곁순 과실은 0 */
  node: number;
  /** 이 마디에 달린 과실 수(평균 한 포기 기준, 암꽃 비율·퇴화가 반영된 분수) */
  n: number;
  /** 개화 후 생리일수(음수 = 개화 전) */
  age: number;
  /** 과실 하나의 건물중 g */
  w: number;
  /** 비대기 동안의 동화산물 부족도 적산, 적산 기간 */
  def: number;
  dur: number;
}

export interface Tip {
  node: number;
  age: number;
  made: number;
}

export interface Yield {
  /** 상품(곧고 규격 안), 중품(약한 곡과·과대과), 비상품 kg m⁻² */
  top: number;
  mid: number;
  cull: number;
  /** 수확 과실 수 개 m⁻² */
  count: number;
}

/** 스트레스 계수(0–1, 1 = 스트레스 없음). 원장에 그대로 기록한다. */
export interface Stress {
  /** 영향 과정별 합성값(G3) */
  photo: number;
  expand: number;
  fruit: number;
  set: number;
  /** 요인별 */
  water: number;
  nutrient: number;
  sinkFeedback: number;
  tempSet: number;
  tempFruit: number;
  ssr: number;
  chill: number;
  heat: number;
  starve: number;
  training: number;
}

export interface CropDay {
  dayIndex: number;
  /** g CH2O m⁻² d⁻¹ */
  gross: number;
  maint: number;
  growthResp: number;
  /** g 건물 m⁻² d⁻¹ */
  gLeaf: number;
  gStem: number;
  gRoot: number;
  gFruit: number;
  demand: number;
  supply: number;
  /** 그날 수확(kg m⁻²) */
  harvest: Yield;
  aborted: number;
  labor: number;
  /** 스트레스 계수 일평균(합계로 쌓다가 마감 때 나눈다) */
  sPhoto: number;
  sExpand: number;
  sFruit: number;
  sSet: number;
  lai: number;
  nodes: number;
  fruits: number;
}

export interface CropOut {
  lai: number;
  /** 한 포기의 살아 있는 잎 수, 원줄기 마디 수, 달린 과실 수(개화 후) */
  leaves: number;
  nodes: number;
  fruits: number;
  flowers: number;
  /** 건물중 g m⁻² */
  wLeaf: number;
  wStem: number;
  wRoot: number;
  wFruit: number;
  pool: number;
  /** 공급/수요 비(이 시간) */
  ssr: number;
  /** 도장 지수(절간장 / 기준 절간장) */
  etiolation: number;
  stemLength: number;
  sla: number;
  femaleRate: number;
  /** 가장 큰 과실의 생체중 g */
  biggestFruit: number;
  stress: Stress;
}

export interface CropState {
  cropId: CropId;
  varietyId: string;
  system: string;
  density: number;
  plan: WorkPlan;
  plantedHour: number;
  /** 살아 있는 포기 비율 */
  alive: number;
  dead: boolean;
  deathCause: string;
  /** 정식 후 생리일수 */
  pd: number;
  /** 동화산물 저장고 g CH2O m⁻² */
  pool: number;
  /** 줄기·뿌리 건물중 g (한 포기) */
  wStem: number;
  wRoot: number;
  /** 다음 한 시간 동안 공기로 나갈 생장호흡 CO2 (kg m⁻² s⁻¹) */
  growthResp: number;
  nodes: LeafNode[];
  fruits: Fruit[];
  tips: Tip[];
  nodeFrac: number;
  mainNodes: number;
  pinched: boolean;
  untrained: number;
  stemLength: number;
  lastInternode: number;
  /** 이동평균(환경 이력) */
  t24: number;
  tAvg: number;
  nightAvg: number;
  nightSum: number;
  nightN: number;
  dayLenAvg: number;
  dliAvg: number;
  dliToday: number;
  ssrAvg: number;
  lastTrain: number;
  lastDeleaf: number;
  lastHarvest: number;
  firstHarvestHour: number;
  /** 누적 */
  total: Yield;
  laborHours: Record<string, number>;
  abortedTotal: number;
  /** 탄소 장부(g CH2O m⁻² 환산): 총광합성, 유지호흡, 생장에 쓴 당, 생장호흡 CO2(g), 만든 건물(g) */
  cum: { gross: number; maint: number; used: number; rgCO2: number; dm: number; dmC: number };
  today: CropDay;
  yesterday: CropDay | null;
  out: CropOut;
}
