import type { SimConfig, SimState, UserAction } from '../engine';

/** 배속: 실제 1초당 게임 시간(h). 0 = 일시정지. */
export const SPEEDS = [
  { id: 'pause', label: '정지', hoursPerSecond: 0 },
  { id: 'd1', label: '1일/초', hoursPerSecond: 24 },
  { id: 'd7', label: '7일/초', hoursPerSecond: 168 },
  { id: 'd30', label: '30일/초', hoursPerSecond: 720 },
] as const;
export type SpeedId = (typeof SPEEDS)[number]['id'];

export type ToWorker =
  /** state(스냅샷)에서 시작해 targetHour까지 조치 로그를 재생한 뒤 정지 상태로 대기한다. */
  | { type: 'init'; config: SimConfig; state: SimState | null; actions: UserAction[]; targetHour: number }
  | { type: 'setSpeed'; hoursPerSecond: number }
  | { type: 'action'; action: UserAction }
  | { type: 'requestState'; requestId: number };

export type FromWorker =
  | { type: 'ready'; hour: number }
  | { type: 'tick'; hour: number; hoursPerSecond: number }
  /** 스냅샷 시점(7일 간격)을 지날 때마다 보낸다. */
  | { type: 'snapshot'; state: SimState; fingerprint: string }
  | { type: 'state'; requestId: number; state: SimState; fingerprint: string; actions: UserAction[] };
