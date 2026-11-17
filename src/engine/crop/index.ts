/**
 * crop 모듈: 정식·작업 계획·작업 지시(사용자 조치)를 반영하고 작물을 1시간 전진시킨다.
 * 온실 모델은 cropCanopy()로 군락 요약을 받아 광합성·호흡·증산을 10분 단위로 계산하고,
 * 그 결과(총광합성·유지호흡)를 gh.out에 실어 이 모듈에 돌려준다(CO2 수지와 작물 탄소 수지가 같은 숫자를 쓴다).
 */
import type { EngineModule, SimEvent, SimState } from '../types';
import type { World } from '../world';
import type { CanopyView } from './canopy';
import { canopyOfCucumber, defaultPlan, plantCucumber, stepCucumber, type CropEnv } from './cucumber';
import { canopyOfStrawberry, defaultPlanSb, plantStrawberry, stepStrawberry, type Nursery } from './strawberry';
import { canopyOfWasabi, defaultPlanWs, plantWasabi, stepWasabi } from './wasabi';
import type { CropData, CropId, CropState, PlantOrder, WorkPlan, WorkTask } from './types';

export * from './types';
export { canopyPhoto, diffuseFraction, leafEnv, trap, interp, type CanopyView } from './canopy';
export { beta, defaultPlan } from './cucumber';
export { defaultPlanSb, inductionRate } from './strawberry';
export { defaultPlanWs } from './wasabi';

/** Phase 4 인터페이스: 근권이 계산하기 전까지 수분 가용도와 양분 스트레스는 1(충분)이다. */
export function rootzoneSupply(_state: SimState): { water: number; nutrient: number } {
  return { water: 1, nutrient: 1 };
}

export function cropCanopy(state: SimState, world: World): CanopyView | null {
  const c = state.crop;
  if (!c) return null;
  const d = world.crops;
  const water = rootzoneSupply(state).water;
  if (c.cropId === 'strawberry') {
    const v = d.varieties.strawberry[c.varietyId];
    return v ? canopyOfStrawberry(c, d.core, d.strawberry, v, water) : null;
  }
  if (c.cropId === 'wasabi') {
    const v = d.varieties.wasabi[c.varietyId];
    return v ? canopyOfWasabi(c, d.core, d.wasabi, v, water) : null;
  }
  const v = d.varieties.cucumber[c.varietyId];
  return v ? canopyOfCucumber(c, d.core, d.cucumber, v, water) : null;
}

export function defaultOrder(d: CropData, varietyId = 'cheongchun', system?: string, cropId?: CropId): PlantOrder {
  const crop: CropId = cropId ?? (varietyId in d.varieties.strawberry ? 'strawberry' : varietyId in d.varieties.wasabi ? 'wasabi' : 'cucumber');
  if (crop === 'wasabi') return { cropId: 'wasabi', varietyId: varietyId in d.varieties.wasabi ? varietyId : 'daruma', system: system ?? 'hydro', density: d.wasabi.density, plan: defaultPlanWs() };
  if (crop === 'strawberry') {
    const id = varietyId in d.varieties.strawberry ? varietyId : 'seolhyang';
    return { cropId: 'strawberry', varietyId: id, system: system ?? 'forcing', density: d.strawberry.density, plan: defaultPlanSb(), seedling: 'buy', nightChill: false };
  }
  const v = d.varieties.cucumber[varietyId] ?? Object.values(d.varieties.cucumber)[0]!;
  return { cropId: 'cucumber', varietyId, system: system ?? 'semiforcing', density: d.cucumber.density, plan: defaultPlan(v) };
}

function envOf(state: SimState, world: World): CropEnv {
  const o = state.gh.out;
  const rz = rootzoneSupply(state);
  return { hour: state.hour, hod: state.hour % 24, tIn: o.tIn, tLeaf: o.tLeaf, ppfd: o.ppfd, gross: o.cGross, maint: o.cMaint, starve: o.cStarve, daylength: world.clim.sun[state.weather.cur.di]!.daylength, rh: o.rhIn, tSol: o.tSolution, lamp: o.light, solar: state.weather.now.solarW, area: state.gh.setup.area, water: rz.water, nutrient: rz.nutrient };
}

function plant(state: SimState, world: World, order: PlantOrder): CropState | null {
  const d = world.crops;
  if (order.cropId === 'strawberry') {
    const v = d.varieties.strawberry[order.varietyId];
    if (!v) return null;
    // 육묘장 환경: 정식일 직전의 그 지역 평년 기온과 일장
    const n = Math.round(d.strawberry.induction.nurseryDays);
    const nursery: Nursery = { temp: [], daylength: [] };
    for (let i = n; i >= 1; i--) {
      const di = (((state.weather.cur.di - i) % 365) + 365) % 365;
      nursery.temp.push(world.clim.tavg[di]!);
      nursery.daylength.push(world.clim.sun[di]!.daylength);
    }
    return plantStrawberry(order, d.strawberry, v, envOf(state, world), nursery);
  }
  if (order.cropId === 'wasabi') {
    const wv = d.varieties.wasabi[order.varietyId];
    return wv ? plantWasabi(order, d.wasabi, wv, envOf(state, world)) : null;
  }
  const v = d.varieties.cucumber[order.varietyId];
  if (order.cropId !== 'cucumber' || !v) return null;
  return plantCucumber(order, d.cucumber, v, envOf(state, world));
}

export const cropModule: EngineModule = {
  id: 'crop',
  title: '생육 코어 + 작물별 모듈(오이·딸기·와사비)',
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
    const d = world.crops;
    if (!crop && plan && state.hour === plan.day * 24 + d[plan.order.cropId].labor.workHour) crop = plant(state, world, plan.order);
    if (crop && !crop.dead) {
      const env = envOf(state, world);
      const r = crop.cropId === 'wasabi' ? stepWasabi(crop, d.core, d.wasabi, d.varieties.wasabi[crop.varietyId]!, env, works) : crop.cropId === 'strawberry' ? stepStrawberry(crop, d.core, d.strawberry, d.varieties.strawberry[crop.varietyId]!, env, works) : stepCucumber(crop, d.core, d.cucumber, d.varieties.cucumber[crop.varietyId]!, env, works);
      crop = r.crop;
      events.push(...r.events);
    }
    if (crop === state.crop && events.length === 0) return state;
    return { ...state, crop, events: events.length ? [...state.events, ...events] : state.events };
  },
};
