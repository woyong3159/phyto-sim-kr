/**
 * 엔진 공용 타입. 엔진은 UI·브라우저 API에 전혀 의존하지 않는 순수 모듈이다(N6).
 */
import type { World } from './world';

/** 엔진 상태 구조 버전. 상태 구조가 바뀌면 올린다(옛 스냅샷은 버리고 조치 로그로 다시 계산). */
export const ENGINE_STATE_VERSION = 2;

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
  /** 지역(data/regions.json의 지점 id). */
  regionId: string;
}

/** 하루치 외기(생성기가 만든 일 단위 값). */
export interface DayWx {
  dayIndex: number;
  year: number;
  /** 0–11 */
  month: number;
  /** 1–31 */
  day: number;
  /** 기준선 색인 0–364 */
  di: number;
  /** °C */
  tavg: number;
  tmax: number;
  tmin: number;
  /** 일평균 상대습도 % */
  rh: number;
  /** 그날의 수증기압 kPa(하루 동안 보존). 그날이 '오늘'이 될 때 계산된다. */
  ea: number;
  /** 일적산 일사 MJ m⁻² d⁻¹ */
  solar: number;
  /** 일강수량 mm */
  precip: number;
  /** 일평균 풍속 m/s */
  wind: number;
  /** 최대순간풍속 m/s */
  gust: number;
  /** 신적설 cm */
  snowCm: number;
  wet: boolean;
  typhoon: boolean;
  hail: boolean;
  jangma: boolean;
  /** 비가 내리는 시간대(시작 시각, 지속 시간) */
  rainStart: number;
  rainHours: number;
}

/** 한 시간치 외기. state.hour 시각부터 1시간 동안의 값이다. */
export interface HourWx {
  /** 기온 °C */
  temp: number;
  /** 상대습도 % */
  rh: number;
  /** 전천 일사: 1시간 적산 MJ m⁻² 과 평균 W m⁻² */
  solarMJ: number;
  solarW: number;
  /** 풍속 m/s */
  wind: number;
  /** 강수 mm/h */
  precip: number;
  /** 태양고도 사인값(시간 중앙) */
  sinElev: number;
}

export interface WeatherGenState {
  epsFast: number;
  epsSlow: number;
  wetPrev: boolean;
  typhoonLeft: number;
  jangmaYear: number;
  /** 그 해 장마 시작·종료(기준선 색인 0–364) */
  jangmaStart: number;
  jangmaEnd: number;
}

export interface WeatherState {
  gen: WeatherGenState;
  prev: DayWx;
  cur: DayWx;
  /** 내일(야간 기온 감쇠 계산에 내일 최저기온이 필요하다) */
  next: DayWx;
  now: HourWx;
  heatStreak: number;
  heatWarnStreak: number;
  coldStreak: number;
  coldWarnStreak: number;
}

/** 자동 일시정지 대상이 되는 사건 종류. Phase 1은 기상 사건만 실제로 발생한다. */
export const EVENT_TYPES = ['heatwave', 'coldwave', 'jangma', 'typhoon', 'heavyRain', 'heavySnow', 'hail', 'disease', 'equipment', 'news', 'stock'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface SimEvent {
  hour: number;
  type: EventType;
  /** advisory 주의보 / warning 경보 / info 알림 */
  level: 'info' | 'advisory' | 'warning';
  /** 세부 구분(예: jangma의 start/end) */
  code: string;
  /** 화면 표시에 쓰는 수치(°C, mm, cm, m/s 등) */
  value: number;
}

/** 시뮬레이션 전체 상태. JSON으로 직렬화 가능한 순수 데이터만 담는다. */
export interface SimState {
  stateVersion: number;
  /** 작기 시작 후 경과 시간(h). */
  hour: number;
  rng: Record<RngStream, RngState>;
  weather: WeatherState;
  /** 직전 스텝에서 새로 생긴 사건(스텝마다 비워진다). */
  events: SimEvent[];
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
  world: World;
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
