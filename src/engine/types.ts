/**
 * 엔진 공용 타입. 엔진은 UI·브라우저 API에 전혀 의존하지 않는 순수 모듈이다(N6).
 */

/** 엔진 상태 구조 버전. 상태 구조가 바뀌면 올리고 마이그레이션을 추가한다. */
export const ENGINE_STATE_VERSION = 1;

/** 내부 계산 스텝: 1시간(헌법 6항). */
export const HOURS_PER_DAY = 24;

/** 랜덤이 허용된 영역(N2). 영역마다 독립된 난수 흐름을 써서 서로 영향을 주지 않게 한다. */
export const RNG_STREAMS = ['weather', 'pestIntro', 'market', 'events'] as const;
export type RngStream = (typeof RNG_STREAMS)[number];

/** sfc32 난수 생성기 내부 상태(32비트 정수 4개). */
export type RngState = readonly [number, number, number, number];

/** 작기 설정. 한 번 정하면 작기 동안 바뀌지 않는다. */
export interface SimConfig {
  /** 난수 seed. 같은 seed + 같은 조치 → 같은 결과(N3). */
  seed: string;
  /** 작기 시작일(KST 달력 기준, YYYY-MM-DD). 0시부터 시작한다. */
  startDate: string;
}

/** 시뮬레이션 전체 상태. JSON으로 직렬화 가능한 순수 데이터만 담는다. */
export interface SimState {
  stateVersion: number;
  /** 작기 시작 후 경과 시간(h). */
  hour: number;
  rng: Record<RngStream, RngState>;
}

/** 사용자 조치(이벤트 소싱의 기본 단위). hour 시각의 스텝 시작 전에 적용된다. */
export interface UserAction {
  hour: number;
  /** 같은 시각 안에서의 적용 순서. */
  seq: number;
  type: string;
  payload: unknown;
}

export interface StepContext {
  config: SimConfig;
  /** 이번 시각에 적용할 조치(seq 순). */
  actions: readonly UserAction[];
}

export type ModuleId =
  | 'time'
  | 'weather'
  | 'greenhouse'
  | 'control'
  | 'crop'
  | 'rootzone'
  | 'physiology'
  | 'protection'
  | 'labor'
  | 'economy'
  | 'market'
  | 'events'
  | 'ledger'
  | 'report';

export interface EngineModule {
  id: ModuleId;
  /** 한국어 설명. */
  title: string;
  /** 구현 예정 Phase(로드맵 기준). */
  plannedPhase: number;
  /** 실제 계산이 구현되었는지. false면 상태를 그대로 통과시키는 빈 스텁이다. */
  implemented: boolean;
  step(state: SimState, ctx: StepContext): SimState;
}

/** 빈 스텁 생성 도우미. */
export function stubModule(id: ModuleId, title: string, plannedPhase: number): EngineModule {
  return { id, title, plannedPhase, implemented: false, step: (state) => state };
}
