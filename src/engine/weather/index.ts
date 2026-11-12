/**
 * weather 모듈: 스텝의 마지막에 "다음 시각의 외기"를 준비한다.
 * 자정을 넘기면 하루를 넘긴다(어제←오늘←내일, 새 내일 생성)와 동시에 특보성 사건을 판정한다.
 */
import type { EngineModule, SimState } from '../types';
import { detectDayEvents, generateDay, hourWx, withVaporPressure } from './generator';

export const weatherModule: EngineModule = {
  id: 'weather',
  title: '기상 생성기(지역 평년값 + 확률적 편차)',
  plannedPhase: 1,
  implemented: true,
  step(state, { world }): SimState {
    const hod = state.hour % 24;
    let w = state.weather;
    let rng = state.rng;
    let events = state.events;
    if (hod === 0) {
      const dayIndex = state.hour / 24;
      const r = generateDay(world, w.gen, rng.weather, rng.events, dayIndex + 1);
      w = withVaporPressure(world, { ...w, gen: r.gen, prev: w.cur, cur: w.next, next: r.day });
      rng = { ...rng, weather: r.weatherRng, events: r.eventsRng };
      const det = detectDayEvents(world, w, state.hour);
      w = { ...w, ...det.streaks };
      if (det.events.length) events = [...events, ...det.events];
    }
    w = { ...w, now: hourWx(world, w, hod) };
    return { ...state, weather: w, rng, events };
  },
};

export { generateDay, hourWx, initWeather, detectDayEvents, satVp } from './generator';
export { sunDay, sinElevation } from './astro';
export { buildClimate, interpolateMonthly, MONTH_DAYS, MONTH_OF_DAY, type Climate, type RegionInfo, type MonthlyNormals } from './climate';
