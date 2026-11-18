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
    poolOverflow: number;
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

type LeafParams = CucumberParams['leaf'];
type RespParams = CucumberParams['resp'];
type PhotoParams = CucumberParams['photo'];
type DamageParams = CucumberParams['damage'];
interface BeeParams { name: string; temp: Curve; light: Curve; decay: number; rate: number }

export interface StrawberryParams {
  name: string;
  dev: { tBase: number; tOpt: number; tMax: number };
  photo: PhotoParams;
  resp: RespParams;
  leaf: LeafParams;
  crown: { ratio: number; rootRatio: number; leavesBetween: number; branch: number };
  induction: { days: number; temp: Curve; freeTemp: number; sdTemp: number; critical: number; criticalBand: number; nSens: number; anthesisAge: number; rankGap: number; nurseryDays: number; nurseryOffset: number; nurseryN: number };
  dormancy: { photo: Curve; temp: Curve; rateIn: number; rateOut: number; chillTemp: number; chillRelease: number; dwarf: number; slow: number };
  runner: { rate: number; photo: Curve; temp: Curve; grow: number };
  fruit: {
    maturity: number; rankFactor: number[]; rankCount: number[]; receptive: number; pollSinkMin: number; abortWindow: number; abortMax: number; setSsr: Curve; ssrLag: number; growTemp: Curve;
    flowerFrost: number; flowerFrostRate: number; ssrRef: number; dmcSsr: number; dmcTemp: number; dmcTempRef: number; dmcLight: number; dmcMin: number; dmcMax: number; brixSlope: number; brixOffset: number;
    acidTemp: number; firmTemp: number; shelf: number; ripenSpread: number; topWeight: number; midWeight: number;
  };
  bees: { honey: BeeParams; bumble: BeeParams; self: number; pollenTemp: Curve; pollenRhCurve: Curve };
  damage: DamageParams;
  labor: { plant: number; deleaf: number; runner: number; thin: number; bees: number; harvestBase: number; harvestPerTon: number; remove: number; workHour: number };
  seedling: { leaves: number; leafCap: number; leafArea: number; leafW: number; stemW: number; rootW: number; shockFactor: number; shock: number; inducedMax: number; ownRisk: number; buyRisk: number };
  density: number;
  systems: Record<string, { name: string; sowing: string; harvest: string; transplantMonth: number; transplantDay: number; benchYield: number }>;
}

export interface StrawberryVariety {
  name: string;
  type: string;
  desc: string;
  real: boolean;
  pmaxFactor: number;
  leafArea: number;
  fruitW: number;
  flowers: number;
  dmc: number;
  acid: number;
  firmness: number;
  critical: number;
  inductionTemp: number;
  dormancy: number;
  chillReq: number;
  pollenCold: number;
  coldTol: number;
  heatTol: number;
  firstHarvestDays: number;
  potentialYield: number;
  resistance: Record<string, number>;
  pricePremium: number;
  seedlingPrice: number;
}

export interface WasabiParams {
  name: string;
  dev: { tBase: number; tOpt: number; tMax: number };
  photo: PhotoParams;
  resp: RespParams;
  leaf: LeafParams & { dmc: number };
  rhizome: { rate: number; half: number; rootRatio: number; dmc: number; market: number; premium: number; cv: number };
  root: { temp: Curve; substrateAir: number; photoShare: number };
  light: { inhibit: Curve; days: number; scorch: number };
  offshoot: { rate: number; grow: number; max: number };
  bolting: { vernTemp: number; vernDays: number; startTemp: number; duration: number; sink: number; dmc: number; pungencyLoss: number };
  pungency: { age: number; temp: Curve; tempShare: number };
  damage: DamageParams & { rotTemp: number; rotRate: number };
  labor: { plant: number; deleaf: number; runner: number; thin: number; harvestBase: number; harvestPerTon: number; remove: number; workHour: number };
  seedling: { leaves: number; leafCap: number; leafArea: number; leafW: number; stemW: number; rootW: number; shockFactor: number; shock: number };
  density: number;
  systems: Record<string, { name: string; sowing: string; harvest: string; transplantMonth: number; transplantDay: number; benchYield: number }>;
}

export interface WasabiVariety {
  name: string;
  type: string;
  desc: string;
  real: boolean;
  pmaxFactor: number;
  leafArea: number;
  rhizome: number;
  pungency: number;
  heatTol: number;
  boltDays: number;
  offshoot: number;
  monthsToHarvest: number;
  potentialYield: number;
  resistance: Record<string, number>;
  pricePremium: number;
  seedlingPrice: number;
}

export interface CropData {
  core: CoreParams;
  cucumber: CucumberParams;
  strawberry: StrawberryParams;
  wasabi: WasabiParams;
  varieties: { cucumber: Record<string, CucumberVariety>; strawberry: Record<string, StrawberryVariety>; wasabi: Record<string, WasabiVariety> };
}

export type CropId = 'cucumber' | 'strawberry' | 'wasabi';
export type WorkTask = 'train' | 'deleaf' | 'harvest' | 'pinch' | 'thin' | 'runner' | 'bees';
export type BeeType = 'none' | 'honey' | 'bumble';

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
  /** ── 딸기 전용 ── 런너 제거 간격(일), 화방당 남길 꽃 수(0 = 모두 둠), 수정벌, 벌통 교체 간격(일, 0 = 교체 안 함) */
  runnerEvery?: number;
  flowersKeep?: number;
  bees?: BeeType;
  /** 남길 관부 수(곁관부 정리) */
  crownsKeep?: number;
  beesEvery?: number;
  /** 체내 질소 수준(1 = 표준). Phase 4(양액) 전까지 사용자가 직접 정하는 임시 입력이다. */
  nLevel?: number;
  /** ── 와사비 전용 ── 꽃대 수확 간격(일, 0 = 두기) */
  stalkEvery?: number;
}

export interface PlantOrder {
  cropId: CropId;
  varietyId: string;
  /** 작형(촉성·반촉성·억제) — 권장 시기와 벤치마크 표시에만 쓴다 */
  system: string;
  /** 재식밀도 주 m⁻² */
  density: number;
  plan: WorkPlan;
  /** 딸기: 묘 종류(구입 / 자가 육묘), 야냉 단일처리 여부 */
  seedling?: 'buy' | 'own';
  nightChill?: boolean;
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
  /** 딸기: 화방 안 차수(0 = 1번화), 수분 진행(Σ), 비대기 기온 적산(품질 계산용) */
  rank?: number;
  poll?: number;
  tSum?: number;
  /** 생리장해·약해 노출(키별, 수확 때 1 − e^−노출 만큼 등급이 내려간다) */
  dis?: Record<string, number>;
  /** 코호트 가운데 이미 딴 비율(원래 개수 기준, 딸기 숙기 분산) */
  picked?: number;
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
  /** 근권 염류(Maas–Hoffman, G6) */
  salt: number;
  sinkFeedback: number;
  tempSet: number;
  tempFruit: number;
  ssr: number;
  chill: number;
  heat: number;
  starve: number;
  training: number;
  /** 딸기: 휴면(왜화)에 의한 생장 억제, 오늘의 수분 조건(벌 활동 × 꽃가루 활력) */
  dormancy: number;
  pollination: number;
  /** 와사비: 근권 온도에 따른 뿌리 활력, 강광 장해 */
  rootTemp: number;
  light: number;
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
  /** 와사비 전용 표시값 */
  ws?: { rhizomeFresh: number; pungency: number; rootT: number; vern: number; bolting: boolean; offshoots: number; marketShare: number; peakPpfd: number };
  /** 딸기 전용 표시값 */
  sb?: { crowns: number; trusses: number; induction: number; dormancy: number; chill: number; photoperiod: number; runners: number; beeStrength: number; beeActivity: number; nextAnthesis: number; firstFlowerDay: number };
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
  /** 딸기 전용 상태 */
  sb?: SbState;
  /** 와사비 전용 상태 */
  ws?: WsState;
  /** 수확 품질(상품+중품 무게 가중 누적합): 당도·산도·경도·과중 합계와 무게, 기형과 개수 */
  quality?: Quality;
  /** 생리장해 피해 누적(키별: 잎 m² m⁻², 과실 kg m⁻², 마디 수 등) — Phase 5 원장 */
  physLoss?: Record<string, number>;
  /** 근경 장해 노출(와사비) */
  rhz?: Record<string, number>;
  /** 오늘 노동 부족으로 미룬 예정 작업, 마지막 수확에서 딴 비율 */
  deferred?: WorkTask[];
  harvestFrac?: number;
  /** 오늘 자동으로 부른 일용 인력 수 */
  hired?: number;
  hiredDay?: number;
}

export interface SbState {
  seedling: 'buy' | 'own';
  /** 저온 누적 시간, 휴면 정도(0–1) */
  chill: number;
  dorm: number;
  /** 다음 화방의 화아분화 진행(0–1), 분화한 화방 수, 마지막 분화 때의 엽수 */
  induction: number;
  trusses: number;
  leavesAtInduction: number;
  /** 관부 수(분얼 포함, 평균값이라 소수) */
  crowns: number;
  /** 전조 포함 일장(이동평균)과 오늘 밤 조명 시간 */
  photoperiod: number;
  lampNight: number;
  /** 자라고 있는 런너 수(포기당)와 건물중 g */
  runners: number;
  runnerW: number;
  /** 벌: 봉군 세력(0–1), 마지막 투입일, 오늘 활동 적산 */
  beeStrength: number;
  beeDay: number;
  beeAct: number;
  beeHours: number;
  lastRunner: number;
  /** 첫 꽃이 핀 시각(h, 없으면 −1) */
  firstFlowerHour: number;
  /** 탄저병 잠복 위험 지수(Phase 6 인터페이스) */
  anthracnoseRisk: number;
  /** 근권 양분 품질 계수(과실 K·근권 EC → 과실 건물률·당도) 7일 이동평균 */
  nutQ?: number;
}

export interface WsState {
  /** 춘화 누적 일수, 추대 남은 생리일수(0 = 추대 중 아님), 꽃대 건물중 g(포기당) */
  vern: number;
  boltLeft: number;
  stalkW: number;
  bolts: number;
  /** 분얼 수(포기당)와 건물중 g */
  offshoots: number;
  offshootW: number;
  /** 낮 최고 PPFD: 오늘 값과 이동평균 */
  peakToday: number;
  peakAvg: number;
  /** 근권 온도 이동평균 */
  rootT: number;
  /** 최근 고온 장해 적산(서서히 잊는다) — 고사 원인 판정용 */
  heatLoad: number;
  lastOffshoot: number;
  lastStalk: number;
  /** 부산물 누적(kg m⁻² 생체중): 잎·엽병, 꽃대 */
  leafYield: number;
  stalkYield: number;
  /** 근경 수확을 마쳤는지, 수확 때의 매운맛 지수 */
  harvested: boolean;
  pungency: number;
}

export interface Quality {
  kg: number;
  brix: number;
  acid: number;
  firm: number;
  weight: number;
  count: number;
  malformed: number;
}
