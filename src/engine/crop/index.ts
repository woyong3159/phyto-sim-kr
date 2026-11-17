/**
 * crop 모듈: 정식·작업 계획·작업 지시(사용자 조치)를 반영하고 작물을 1시간 전진시킨다.
 * 온실 모델은 cropCanopy()로 군락 요약을 받아 광합성·호흡·증산을 10분 단위로 계산하고,
 * 그 결과(총광합성·유지호흡)를 gh.out에 실어 이 모듈에 돌려준다(CO2 수지와 작물 탄소 수지가 같은 숫자를 쓴다).
 */
import type { EngineModule, SimEvent, SimState } from '../types';
import type { World } from '../world';
import type { CanopyView } from './canopy';
import { canopyOfCucumber, defaultPlan, plantCucumber, stepCucumber, type CropEnv } from './cucumber';
import type { CropData, CropState, PlantOrder, WorkPlan, WorkTask } from './types';

export * from './types';
export { canopyPhoto, diffuseFraction, leafEnv, trap, interp, type CanopyView } from './canopy';
export { beta, defaultPlan } from './cucumber';

/** Phase 4 인터페이스: 근권이 계산하기 전까지 수분 가용도와 양분 스트레스는 1(충분)이다. */
export function rootzoneSupply(_state: SimState): { water: number; nutrient: number } {
  return { water: 1, nutrient: 1 };
}

export function cropCanopy(state: SimState, world: World): CanopyView | null {
  const c = state.crop;
  if (!c) return null;
  const d = world.crops;
  const v = d.varieties.cucumber[c.varietyId];
  if (!v) return null;
  return canopyOfCucumber(c, d.core, d.cucumber, v, rootzoneSupply(state).water);
}

export function defaultOrder(d: CropData, varietyId = 'cheongchun', system = 'semiforcing'): PlantOrder {
  const v = d.varieties.cucumber[varietyId] ?? Object.values(d.varieties.cucumber)[0]!;
  return { cropId: 'cucumber', varietyId, system, density: d.cucumber.density, plan: defaultPlan(v) };
}

function envOf(state: SimState, world: World): CropEnv {
  const o = state.gh.out;
  const rz = rootzoneSupply(state);
  return { hour: state.hour, hod: state.hour % 24, tIn: o.tIn, tLeaf: o.tLeaf, ppfd: o.ppfd, gross: o.cGross, maint: o.cMaint, starve: o.cStarve, daylength: world.clim.sun[state.weather.cur.di]!.daylength, area: state.gh.setup.area, water: rz.water, nutrient: rz.nutrient };
}

function plant(state: SimState, world: World, order: PlantOrder): CropState | null {
  const v = world.crops.varieties.cucumber[order.varietyId];
  if (order.cropId !== 'cucumber' || !v) return null;
  return plantCucumber(order, world.crops.cucumber, v, envOf(state, world));
}

export const cropModule: EngineModule = {
  id: 'crop',
  title: '생육 코어 + 작물별 모듈(오이; 딸기·와사비는 3b·3c)',
  plannedPhase: 3,
  implemented: true,
  step(state, { world, actions }): SimState {
    let crop = state.crop;
    const works: WorkTask[] = [];
    const events: SimEvent[] = [];
    for (const a of actions) {
      if (a.type === 'crop/plant' && !crop) crop = plant(state, world, a.payload as PlantOrder);
      else if (a.type === 'crop/remove' && crop) {
        events.push({ hour: state.hour, type: 'crop', level: 'info', code: 'removed', value: crop.total.top + crop.total.mid });
        crop = null;
      } else if (a.type === 'crop/plan' && crop) crop = { ...crop, plan: a.payload as WorkPlan };
      else if (a.type === 'crop/work' && crop) works.push((a.payload as { task: WorkTask }).task);
    }
    const plan = world.config.crop;
    if (!crop && plan && state.hour === plan.day * 24 + world.crops.cucumber.labor.workHour) crop = plant(state, world, plan.order);
    if (crop && !crop.dead) {
      const v = world.crops.varieties.cucumber[crop.varietyId]!;
      const r = stepCucumber(crop, world.crops.core, world.crops.cucumber, v, envOf(state, world), works);
      crop = r.crop;
      events.push(...r.events);
    }
    if (crop === state.crop && events.length === 0) return state;
    return { ...state, crop, events: events.length ? [...state.events, ...events] : state.events };
  },
};
