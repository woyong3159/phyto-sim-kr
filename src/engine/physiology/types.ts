/**
 * Phase 5 — 생장조절제(PGR)·생리장해 공용 타입.
 * 생리장해의 "발생"은 난수가 아니라 기대값(포기·기관 가운데 증상이 나타나는 비율)으로 계산한다.
 * N2(랜덤은 기상·병해충 유입·시장·뉴스에만)를 지키면서도, 발생 확률 = 발생률로 같은 의미를 갖는다(Phase 3a 과실 수와 같은 방식).
 */
import type { CropId } from '../crop/types';

export type PgrMethod = 'foliar' | 'drench' | 'spot';
export type FxTarget = 'expand' | 'internode' | 'female' | 'node' | 'dorm' | 'runner' | 'set' | 'fruitGrow' | 'root' | 'bolt' | 'senesce' | 'malform' | 'soft' | 'bitter' | 'curved';

export interface PgrEffect {
  target: FxTarget;
  comp: 'plant' | 'flower';
  emax: number;
  ec50: number;
  hill: number;
}

export interface PgrReg {
  status: 'registered' | 'unregistered';
  use: string;
  dose: { min: number; max: number } | null;
  source: string;
  note: string;
}

export interface PgrProduct {
  name: string;
  group: string;
  methods: PgrMethod[];
  halfLife: number;
  price: number;
  residue: { dep: number; halfLife: number };
  reg: Record<CropId, PgrReg>;
  effects: Record<CropId, PgrEffect[]>;
  tox: Record<CropId, { thr: number; slope: number; effects: Partial<Record<FxTarget, number>> }>;
}

export interface PgrParams {
  methods: Record<PgrMethod, { name: string; plant: number; flower: number; volume: number; labor: number }>;
  products: Record<string, PgrProduct>;
  pls: { mrl: number };
}

export type LeafTarget = 'young' | 'upper' | 'old' | 'all';
export type DisMode = 'leaf' | 'fruit' | 'apex' | 'rhizome' | 'record';

export interface DisorderDef {
  name: string;
  en: string;
  mode: DisMode;
  /** leaf: young/upper/old/all */
  target: LeafTarget | '';
  /** 수확 때 내려가는 등급 */
  grade: '' | 'mid' | 'cull';
  /** 스카우팅으로 보이는지(쓴맛과·근경 속 갈변은 보이지 않는다) */
  visible: boolean;
  /** fruit: 노출 창 [시작, 끝] — 딸기는 성숙 일수 비율(0–1+), 오이는 개화 후 생리일(음수 = 개화 전) */
  window: [number, number] | null;
  /** window가 성숙 일수 비율인지(딸기) */
  rel: boolean;
  symptom: string;
  cause: string;
  source: string;
  on: number;
  off: number;
  loss: number;
  th: Record<string, number>;
}

export interface DisorderParams {
  detect: number;
  scoutLabor: number;
  strawberry: Record<string, DisorderDef>;
  cucumber: Record<string, DisorderDef>;
  wasabi: Record<string, DisorderDef>;
}

export interface PhysParams {
  pgr: PgrParams;
  dis: DisorderParams;
}

/** 작물 모듈이 다음 한 시간 동안 적용할 효과(생장조절제 + 생리장해). 1 = 영향 없음(배수), 0 = 없음(가감). */
export interface PhysFx {
  expand: number;
  internode: number;
  female: number;
  node: number;
  /** 생장점 정지(순멎이) 비율 0–1 — 마디 생성 = node × (1 − arrest) */
  arrest: number;
  /** 휴면 해제 일⁻¹ */
  dorm: number;
  runner: number;
  /** 퇴화(낙화) 감소 비율(음수 = 증가) */
  set: number;
  fruitGrow: number;
  root: number;
  /** 춘화 대체(일 일⁻¹) */
  bolt: number;
  /** 잎 소실(시간당 비율) — young: 전개 중인 잎, upper: 위쪽 1/3, old: 아래쪽 1/3, all: 전체 */
  leaf: { key: string; target: LeafTarget; rate: number }[];
  /** 과실 노출(생리일당) — 키별 노출 속도와 창 */
  fruitRisk: Record<string, { rate: number; a0: number; a1: number }>;
  /** 근경 노출(일당) */
  rhizome: Record<string, number>;
  /** 수확 때 등급 하락 규칙 */
  grades: Record<string, 'mid' | 'cull'>;
}

export const NEUTRAL_FX: PhysFx = { expand: 1, internode: 1, female: 0, node: 1, arrest: 0, dorm: 0, runner: 1, set: 0, fruitGrow: 1, root: 1, bolt: 0, leaf: [], fruitRisk: {}, rhizome: {}, grades: {} };

export interface PgrActive {
  /** 체내 활성(ppm 환산): 줄기·잎, 꽃·어린 과실 */
  plant: number;
  flower: number;
  /** 과실·근경 잔류 mg/kg */
  residue: number;
  /** 마지막 처리 시각(h) */
  last: number;
  count: number;
}

export interface PgrApp {
  hour: number;
  id: string;
  ppm: number;
  method: PgrMethod;
  registered: boolean;
  won: number;
  hours: number;
}

export interface DisState {
  /** 이번 시간 위험 지수(R ≥ 1이면 발생 조건) */
  R: number;
  /** 오늘 최대 R, 오늘 R>1 시간 */
  rMax: number;
  hoursOver: number;
  /** 발생률(포기·기관 비율, 0–1) */
  I: number;
  /** 심각도(0–1) */
  sev: number;
  /** 누적 피해(잎: m² m⁻², 과실: kg m⁻², 생장점: 잃은 마디 수, 근경: 비율) */
  loss: number;
  /** 처음 증상이 보인 시각(h, −1 = 아직) */
  onset: number;
  /** 원인 변수(이번 시간): 이름 → 값과 R 기여 */
  drv: Record<string, [number, number]>;
  /** 오늘 원인 기여 적산(원장용) */
  drvDay: Record<string, number>;
}

/** 인과 원장 한 줄(Phase 8 인과 리포트용): 원인 변수 → 위험 지수 → 발생 → 피해량 */
export interface DisLedger {
  d: number;
  k: string;
  /** 그날 원인 변수별 R 기여 합(R>1이던 시간들) */
  drv: Record<string, number>;
  rMax: number;
  hours: number;
  I: number;
  loss: number;
}

export interface ScoutResult {
  hour: number;
  /** 키 → 관찰된 발생률(못 보면 0), 심각도 */
  obs: Record<string, { I: number; sev: number }>;
}

export interface PhysState {
  pgr: Record<string, PgrActive>;
  apps: PgrApp[];
  dis: Record<string, DisState>;
  /** 생장점 정지 정도(0–1) */
  arrest: number;
  log: DisLedger[];
  scout: ScoutResult | null;
  /** 미등록 사용·잔류: 위험 수확량 kg m⁻²(누적), 경고 횟수 */
  pls: { kgRisk: number; events: number; residue: number };
  /** 이번 시간 작업 시간(살포·스카우팅, h)과 누적 비용 */
  hoursNow: number;
  won: number;
  hours: number;
  fx: PhysFx;
  /** 약제별 약해 정도(0–1) */
  tox: Record<string, number>;
  /** 직전 시각의 작물 누적값(피해 증분 계산용) */
  prev: { kg: number; day: number; loss: Record<string, number>; crop: string };
  /** 오늘 미등록 잔류 경고를 냈는지 */
  plsDay: number;
}
