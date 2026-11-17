/**
 * control 모듈: 사용자 조치(설정값 변경, 시설·장비 변경, 세척, 수리)를 상태에 반영한다.
 * greenhouse 모듈: 미기상과 제어기를 1시간(10분 × 6) 계산한다.
 */
import type { EngineModule, SimState } from '../types';
import { stepGreenhouse } from './model';
import { DEVICES, type ControlSettings, type DeviceId, type GhSetup } from './types';

function repairHours(world: Parameters<EngineModule['step']>[1]['world'], gh: SimState['gh'], d: DeviceId): number {
  const eq = world.gh.eq;
  const s = gh.setup;
  switch (d) {
    case 'vent':
      return eq.vent.repairHours;
    case 'curtain':
      return eq.curtain.motor.repairHours;
    case 'shade':
      return eq.shade.motor.repairHours;
    case 'circFan':
      return eq.circFan.repairHours;
    case 'fog':
      return eq.fog.repairHours;
    case 'heater':
      return s.heater === 'none' ? 1 : eq.heater[s.heater].repairHours;
    case 'cooling':
      return s.cooling === 'none' ? 1 : eq.cooling[s.cooling].repairHours;
    case 'co2':
      return s.co2 === 'none' ? 1 : eq.co2[s.co2].repairHours;
    case 'light':
      return s.light === 'none' ? 1 : eq.light[s.light].repairHours;
    case 'dehumidifier':
      return eq.dehumidifier.repairHours;
    case 'solutionChiller':
      return eq.solution.chiller.repairHours;
    case 'solutionHeater':
      return eq.solution.heater.repairHours;
  }
}

export const controlModule: EngineModule = {
  id: 'control',
  title: '설정값(setpoint)과 사용자 조치 반영',
  plannedPhase: 2,
  implemented: true,
  step(state, { world, actions }): SimState {
    if (actions.length === 0) return state;
    let gh = state.gh;
    for (const a of actions) {
      switch (a.type) {
        case 'gh/control':
          gh = { ...gh, settings: a.payload as ControlSettings };
          break;
        case 'gh/setup': {
          // 시험용 군락(testLai)은 작기 설정값으로 고정한다(검증 전용, 화면에서는 바꿀 수 없다)
          const setup = { ...(a.payload as GhSetup), testLai: world.config.setup.testLai };
          const rebuilt = setup.facility !== gh.setup.facility || gh.destroyed;
          gh = rebuilt ? { ...gh, setup, destroyed: false, breached: false, roofSnow: 0, dust: 0 } : { ...gh, setup };
          break;
        }
        case 'gh/clean':
          gh = { ...gh, dust: 0 };
          break;
        case 'gh/repairCover':
          gh = { ...gh, breached: false };
          break;
        case 'gh/repair': {
          const d = (a.payload as { device: DeviceId }).device;
          if ((DEVICES as readonly string[]).includes(d) && gh.failures[d] === -1) {
            gh = { ...gh, failures: { ...gh.failures, [d]: state.hour + repairHours(world, gh, d) } };
          }
          break;
        }
      }
    }
    return gh === state.gh ? state : { ...state, gh };
  },
};

export const greenhouseModule: EngineModule = {
  id: 'greenhouse',
  title: '온실 미기상: 에너지·수분·CO2·광 수지(10분 서브스텝) + 제어기',
  plannedPhase: 2,
  implemented: true,
  step(state, { world }): SimState {
    const r = stepGreenhouse(state, world);
    return { ...state, gh: r.gh, rng: { ...state.rng, failure: r.failureRng }, events: r.events.length ? [...state.events, ...r.events] : state.events };
  },
};

export { initGreenhouse, stepGreenhouse, curtainSaving, contractKw } from './model';
export * from './types';
export { buildGhParams, type GhParams, type FacilityParams } from './params';
export { satVp, dewPoint, wetBulb, absHumidity } from './psychro';
