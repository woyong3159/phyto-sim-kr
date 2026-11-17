/**
 * 엔진 모듈 스텁(헌법 6항). Phase 0에서는 이름·역할·계산 순서만 확정한다.
 * 각 모듈은 해당 Phase에서 자기 폴더(예: engine/crop/)로 분리해 구현한다.
 * 스텁은 상태를 그대로 통과시킬 뿐, 어떤 값도 지어내지 않는다(N1).
 */
import { stubModule, type EngineModule } from './types';
import { timeModule } from './time';
import { weatherModule } from './weather';
import { controlModule, greenhouseModule } from './greenhouse';

export const eventsModule = stubModule('events', '뉴스·재해·시장 충격(기상 특보는 weather가 낸다)', 7);
export const rootzoneModule = stubModule('rootzone', '배지·양액·관수·이온 흡수', 4);
export const cropModule = stubModule('crop', '생육 코어 + 작물별 모듈(딸기·와사비·오이)', 3);
export const physiologyModule = stubModule('physiology', '생리장해·생장조절제(PGR)', 5);
export const protectionModule = stubModule('protection', '병해·해충·바이러스·천적·농약·저항성·방역', 6);
export const laborModule = stubModule('labor', '작업과 노동 시간', 5);
export const marketModule = stubModule('market', '가격·등급·판매 채널', 7);
export const economyModule = stubModule('economy', '자본·토지·시설비·운영비·금융', 7);
export const ledgerModule = stubModule('ledger', '인과 원장(Causal Ledger)', 3);
export const reportModule = stubModule('report', '작기 리포트·반사실 분석·작기 비교·A/B 실험', 8);

/**
 * 1시간 스텝 [h, h+1) 안에서의 계산 순서.
 * 스텝이 시작될 때 state.weather.now 에는 이미 h시의 외기가 들어 있다.
 * 사건 → 제어 → 온실 환경 → 근권 → 작물 → 생리장해 → 병해충 → 작업 → 시장·경제 → 원장 기록
 * → 시계 전진(h+1) → 다음 시각(h+1)의 외기 준비.
 * report는 스텝 루프 밖에서 필요할 때 호출한다.
 */
export const STEP_ORDER: readonly EngineModule[] = [
  eventsModule,
  controlModule,
  greenhouseModule,
  rootzoneModule,
  cropModule,
  physiologyModule,
  protectionModule,
  laborModule,
  marketModule,
  economyModule,
  ledgerModule,
  timeModule,
  weatherModule,
];

export const ALL_MODULES: readonly EngineModule[] = [...STEP_ORDER, reportModule];
