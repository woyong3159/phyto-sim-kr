/** Phase 5 — 노동 관리 타입. */
import type { WorkTask } from '../crop/types';

export type Skill = 'novice' | 'normal' | 'expert';

export interface LaborSettings {
  /** 자가 노동 인원과 1인 하루 작업 시간 */
  owners: number;
  ownerHours: number;
  /** 고용 인력: 인원, 1인 하루 작업 시간, 일당(원), 숙련도 */
  workers: number;
  workerHours: number;
  wage: number;
  skill: Skill;
  /** 일이 밀리는 날 자동으로 부를 일용 인력 최대 인원(0 = 안 부름) */
  autoHire: number;
}

export interface LaborParams {
  owners: number;
  ownerHours: number;
  workerHours: number;
  wage: number;
  autoHire: number;
  skill: Record<Skill, number>;
  priority: WorkTask[];
}

export interface LaborDay {
  d: number;
  /** 하루 가용 시간, 실제 쓴 시간(작물·근권·살포·스카우팅), 초과(직접 지시로 넘친 시간) */
  cap: number;
  used: number;
  over: number;
  /** 미룬 작업 */
  late: WorkTask[];
  /** 수확한 비율(1 = 다 땀) */
  hf: number;
  /** 자동 일용 고용 인원 */
  hired: number;
}

export interface LaborState {
  set: LaborSettings;
  day: number;
  cap: number;
  used: number;
  left: number;
  over: number;
  /** 작업이 처음 밀린 날(작업별, 밀리지 않았으면 없음) */
  lateSince: Partial<Record<WorkTask, number>>;
  /** 누적: 사용 시간, 초과, 고용 시간, 인건비(원), 일용 고용 연인원 */
  cum: { used: number; over: number; hired: number; wage: number; days?: number };
  hist: LaborDay[];
  /** 직전 시각까지 반영한 작물·근권 누적 노동(h) */
  seen: { crop: number; rz: number };
}
