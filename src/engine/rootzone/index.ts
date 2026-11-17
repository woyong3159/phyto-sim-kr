/**
 * rootzone 모듈(Phase 4): 원수·원액·관수·배지(또는 수경 양액)·흡수·식물 양분.
 * 온실 모듈이 이번 시간 증산과 양액 온도를 계산한 뒤, 작물 모듈보다 먼저 돈다.
 * 작물은 state.rz.out.supply(수분·양분·염해·근권 온도 계수)를 읽는다.
 */
import type { EngineModule } from '../types';
import { stepRootzone } from './model';

export const rootzoneModule: EngineModule = {
  id: 'rootzone',
  title: '배지·양액·관수·이온 흡수',
  plannedPhase: 4,
  implemented: true,
  step(state, ctx) {
    const acts = ctx.actions.filter((a) => a.type.startsWith('rz/'));
    const r = stepRootzone(state, ctx.world, acts);
    return { ...state, rz: r.rz, events: r.events.length ? [...state.events, ...r.events] : state.events };
  },
};
