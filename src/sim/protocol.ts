import type { DisLedger, DisState, LaborDay, LaborSettings, LaborState, PgrActive, PgrApp, PgrMethod, PhysFx, ScoutResult, TaskItem, ControlSettings, CropDay, CropState, DayWx, DeviceId, EventType, GhDay, GhHour, GhSetup, HourWx, IrrSettings, Lab, NutSettings, PlantPools, RzDay, RzOut, RzSetup, RzTotal, SimConfig, SimEvent, SimState, StockTank, UserAction } from '../engine';

/** 배속: 실제 1초당 게임 시간(h). 0 = 일시정지. */
export const SPEEDS = [
  { id: 'pause', label: '정지', short: '❚❚', hoursPerSecond: 0 },
  { id: 'h1', label: '1시간/초', short: '1시간', hoursPerSecond: 1 },
  { id: 'h6', label: '6시간/초', short: '6시간', hoursPerSecond: 6 },
  { id: 'd1', label: '1일/초', short: '1일', hoursPerSecond: 24 },
  { id: 'd7', label: '7일/초', short: '7일', hoursPerSecond: 168 },
  { id: 'd30', label: '30일/초', short: '30일', hoursPerSecond: 720 },
] as const;
export type SpeedId = (typeof SPEEDS)[number]['id'];

/** 화면에 보여줄 온실 현황. */
export interface GhView {
  out: GhHour;
  today: GhDay;
  total: { fuelL: number; kWh: number; co2Kg: number; won: number };
  /** 지금 적용 중인 구성·설정(방금 넣은 변경 포함) */
  setup: GhSetup;
  settings: ControlSettings;
  failures: Record<DeviceId, number>;
  breached: boolean;
  destroyed: boolean;
  dust: number;
  roofSnow: number;
  contractKw: number;
}

/** 화면에 보여줄 작물 현황(마디·과실 목록은 그림에 쓸 만큼만 줄여서 보낸다). */
export interface CropView extends Omit<CropState, 'nodes' | 'fruits' | 'tips' | 'cum'> {
  /** 잎(아래→위): 면적 m², 곁순 여부 */
  leaves: { area: number; lat: 0 | 1; age: number }[];
  /** 과실: 마디, 개수(분수), 생체중 g, 개화 후 생리일수 */
  fruitList: { node: number; n: number; fw: number; age: number; rank: number; dis: number }[];
  laterals: number;
}

/** 화면에 보여줄 근권 현황(방금 넣은 설정 변경 포함). */
export interface RzView {
  setup: RzSetup;
  irr: IrrSettings;
  nut: NutSettings;
  out: RzOut;
  today: RzDay;
  yesterday: RzDay | null;
  total: RzTotal;
  stock: { A: Omit<StockTank, 'ions' | 'chelFe'>; B: Omit<StockTank, 'ions' | 'chelFe'>; acid: Omit<StockTank, 'ions' | 'chelFe'> };
  labs: Lab[];
  W: number;
  drainTank: number;
  rain: number;
  doseScale: number;
  plant: Pick<PlantPools, 'tipburn' | 'caRatio'> | null;
}

/** 화면에 보여줄 생리장해·생장조절제 현황. */
export interface PhysView {
  dis: Record<string, Omit<DisState, 'drvDay'>>;
  arrest: number;
  scout: ScoutResult | null;
  /** 방금 순찰을 지시했는지(다음 스텝에 결과가 나온다) */
  scoutPending: boolean;
  pgr: Record<string, PgrActive>;
  apps: PgrApp[];
  pending: { id: string; ppm: number; method: PgrMethod }[];
  fx: Omit<PhysFx, 'leaf' | 'fruitRisk' | 'rhizome' | 'grades'>;
  tox: Record<string, number>;
  pls: { kgRisk: number; events: number; residue: number };
  log: DisLedger[];
  won: number;
  hours: number;
}

/** 화면에 보여줄 노동 현황. */
export interface LaborView {
  set: LaborSettings;
  cap: number;
  used: number;
  left: number;
  over: number;
  lateSince: LaborState['lateSince'];
  cum: LaborState['cum'];
  hist: LaborDay[];
  tasks: TaskItem[];
  /** 오늘 미룬 작업, 수확한 비율, 자동 고용 인원 */
  deferred: string[];
  harvestFrac: number;
  hired: number;
}

/** 화면에 보여줄 현재 외기·온실 요약. */
export interface WxView {
  now: HourWx;
  today: DayWx;
  sunrise: number;
  sunset: number;
  daylength: number;
  gh: GhView;
  crop: CropView | null;
  rz: RzView;
  phys: PhysView;
  labor: LaborView;
}

/** 시간 단위 원장 한 줄(내부 vs 외부 그래프용). */
export interface HourRow {
  hour: number;
  tOut: number;
  rhOut: number;
  solarW: number;
  tIn: number;
  rhIn: number;
  vpd: number;
  co2: number;
  ppfd: number;
  vent: number;
  heatW: number;
  won: number;
}

/** 일 단위 원장 한 줄. */
export interface DayRow {
  dayIndex: number;
  wx: DayWx;
  gh: GhDay | null;
  crop?: CropDay | null;
  rz?: RzDay | null;
}

export type ToWorker =
  /** state(스냅샷)에서 시작해 targetHour까지 조치 로그를 재생한 뒤 정지 상태로 대기한다. */
  | { type: 'init'; config: SimConfig; state: SimState | null; actions: UserAction[]; targetHour: number; autoPause: EventType[] }
  | { type: 'setSpeed'; hoursPerSecond: number }
  /** 턴 버튼: 지정한 시간만큼 최대 속도로 진행한 뒤 멈춘다. */
  | { type: 'advance'; hours: number }
  | { type: 'setAutoPause'; types: EventType[] }
  /** 조치. 적용 시각은 워커가 현재 게임 시각으로 찍는다(화면이 아는 시각은 0.1초 늦을 수 있다). */
  | { type: 'action'; actionType: string; payload: unknown }
  | { type: 'requestState'; requestId: number };

export type FromWorker =
  | { type: 'ready'; hour: number; view: WxView }
  | { type: 'tick'; hour: number; hoursPerSecond: number; advancing: boolean; view: WxView }
  /** 스냅샷 시점(7일 간격)을 지날 때마다 보낸다. */
  | { type: 'snapshot'; state: SimState; fingerprint: string }
  /** 끝난 날들의 일 기상(일 단위 원장). */
  | { type: 'days'; rows: DayRow[] }
  | { type: 'hours'; rows: HourRow[] }
  /** 조치가 로그에 기록됨(세이브에 넣을 확정본) */
  | { type: 'action'; action: UserAction; view: WxView }
  /** 새로 생긴 사건. paused = 이 사건 때문에 자동 일시정지했는지. */
  | { type: 'events'; events: SimEvent[]; paused: boolean }
  | { type: 'state'; requestId: number; state: SimState; fingerprint: string; actions: UserAction[] }
  | { type: 'error'; message: string };
