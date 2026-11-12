/**
 * PHYTO-SIM 엔진 진입점. 순수 함수만 내보낸다.
 *   state(t+1h) = stepHour(state(t), config, 그 시각의 사용자 조치)
 */
import { createAllStreams } from './rng';
import { STEP_ORDER } from './modules';
import { ENGINE_STATE_VERSION, type SimConfig, type SimState, type UserAction } from './types';

export * from './types';
export { calendarAt, parseStartDate, type CalendarTime } from './time';
export { fingerprint, stableStringify } from './hash';
export { ALL_MODULES, STEP_ORDER } from './modules';
export { createStream, hashSeed, nextFloat, nextUint32 } from './rng';

export function createInitialState(config: SimConfig): SimState {
  return { stateVersion: ENGINE_STATE_VERSION, hour: 0, rng: createAllStreams(config.seed) };
}

/** 조치 목록을 (hour, seq) 순으로 정렬한 사본을 만든다. */
export function sortActions(actions: readonly UserAction[]): UserAction[] {
  return [...actions].sort((a, b) => a.hour - b.hour || a.seq - b.seq);
}

function actionsAt(sorted: readonly UserAction[], hour: number): UserAction[] {
  return sorted.filter((a) => a.hour === hour);
}

/** 1시간 전진. */
export function stepHour(state: SimState, config: SimConfig, actionsThisHour: readonly UserAction[]): SimState {
  const ctx = { config, actions: actionsThisHour };
  let next = state;
  for (const mod of STEP_ORDER) next = mod.step(next, ctx);
  return next;
}

/** targetHour까지 전진. actions는 작기 전체 조치 로그여도 된다. */
export function runTo(state: SimState, config: SimConfig, actions: readonly UserAction[], targetHour: number): SimState {
  const sorted = sortActions(actions);
  let s = state;
  while (s.hour < targetHour) s = stepHour(s, config, actionsAt(sorted, s.hour));
  return s;
}

/** 이벤트 소싱 재생: seed + 조치 로그만으로 targetHour 시점의 상태를 다시 계산한다. */
export function replay(config: SimConfig, actions: readonly UserAction[], targetHour: number): SimState {
  return runTo(createInitialState(config), config, actions, targetHour);
}
