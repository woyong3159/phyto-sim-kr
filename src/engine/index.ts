/**
 * PHYTO-SIM 엔진 진입점. 순수 함수만 내보낸다.
 *   state(t+1h) = stepHour(state(t), world, 그 시각의 사용자 조치)
 */
import { createAllStreams } from './rng';
import { STEP_ORDER } from './modules';
import { ENGINE_STATE_VERSION, type SimState, type UserAction } from './types';
import { initWeather } from './weather';
import { initGreenhouse } from './greenhouse';
import type { World } from './world';

export * from './types';
export { calendarAt, parseStartDate, type CalendarTime } from './time';
export { fingerprint, stableStringify } from './hash';
export { ALL_MODULES, STEP_ORDER } from './modules';
export { createStream, hashSeed, nextFloat, nextUint32 } from './rng';
export { createWorld, listRegions, type EngineData, type World } from './world';
export * from './greenhouse/types';
export * from './crop/types';
export { defaultOrder, defaultPlan, defaultPlanSb, inductionRate, cropCanopy, beta, canopyPhoto, leafEnv, diffuseFraction, trap, type CanopyView } from './crop';
export { curtainSaving, contractKw, buildGhParams, type GhParams, type FacilityParams } from './greenhouse';
export { installCost, type CostLine } from './greenhouse/cost';
export { sunDay, MONTH_DAYS, type RegionInfo, type MonthlyNormals, type Climate } from './weather';

export function createInitialState(world: World): SimState {
  const rng = createAllStreams(world.config.seed);
  const init = initWeather(world, rng.weather, rng.events);
  return {
    stateVersion: ENGINE_STATE_VERSION,
    hour: 0,
    rng: { ...rng, weather: init.weatherRng, events: init.eventsRng },
    weather: init.weather,
    gh: initGreenhouse(world, init.weather.now.temp, init.weather.now.rh),
    crop: null,
    events: init.events,
  };
}

/** 조치 목록을 (hour, seq) 순으로 정렬한 사본을 만든다. */
export function sortActions(actions: readonly UserAction[]): UserAction[] {
  return [...actions].sort((a, b) => a.hour - b.hour || a.seq - b.seq);
}

function actionsAt(sorted: readonly UserAction[], hour: number): UserAction[] {
  return sorted.length === 0 ? (sorted as UserAction[]) : sorted.filter((a) => a.hour === hour);
}

/** 1시간 전진. */
export function stepHour(state: SimState, world: World, actionsThisHour: readonly UserAction[]): SimState {
  const ctx = { world, actions: actionsThisHour };
  let next: SimState = state.events.length ? { ...state, events: [] } : state;
  for (const mod of STEP_ORDER) next = mod.step(next, ctx);
  return next;
}

/** targetHour까지 전진. actions는 작기 전체 조치 로그여도 된다. */
export function runTo(state: SimState, world: World, actions: readonly UserAction[], targetHour: number): SimState {
  const sorted = sortActions(actions);
  let s = state;
  while (s.hour < targetHour) s = stepHour(s, world, actionsAt(sorted, s.hour));
  return s;
}

/** 이벤트 소싱 재생: seed + 조치 로그만으로 targetHour 시점의 상태를 다시 계산한다. */
export function replay(world: World, actions: readonly UserAction[], targetHour: number): SimState {
  return runTo(createInitialState(world), world, actions, targetHour);
}
