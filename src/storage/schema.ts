/**
 * 세이브 스키마와 마이그레이션.
 * 원칙: 세이브는 절대 지우지 않는다. 구조가 바뀌면 SAVE_SCHEMA_VERSION을 올리고
 * MIGRATIONS에 "이전 버전 → 다음 버전" 변환을 추가한다.
 */
import { defaultSettings, defaultSetup, type EventType, type SimConfig, type SimState, type UserAction } from '../engine';

export const SAVE_SCHEMA_VERSION = 4;
/** v1(Phase 0) 세이브에는 지역이 없었다. 옮겨올 때 넣는 기본 지역. */
export const DEFAULT_REGION_ID = 'buyeo';
export const EXPORT_FORMAT = 'phyto-sim-kr-save';

export type ObservationMode = 'god' | 'realistic';

/** 이벤트 소싱 세이브: seed(config) + 사용자 조치 로그 + (별도 저장소의) 주기적 스냅샷. */
export interface SaveRecord {
  schemaVersion: number;
  id: string;
  name: string;
  /** 실제 시각(ms). 표시용 메타데이터이며 엔진 계산에는 쓰지 않는다. */
  createdAt: number;
  updatedAt: number;
  config: SimConfig;
  actions: UserAction[];
  /** 마지막으로 저장된 게임 시각(h). */
  hour: number;
  observationMode: ObservationMode;
  /** 화면·실행 설정(시뮬레이션 결과에는 영향을 주지 않는다). */
  prefs: SavePrefs;
}

export interface SavePrefs {
  /** 사건 종류별 자동 일시정지. 값이 없으면 켜짐으로 본다. */
  autoPause: Partial<Record<EventType, boolean>>;
}

export interface SnapshotRecord {
  saveId: string;
  hour: number;
  state: SimState;
  /** 상태 지문. 재계산 결과와 대조해 결정론을 검증한다. */
  fingerprint: string;
}

export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  schemaVersion: number;
  exportedAt: number;
  save: SaveRecord;
  snapshots: SnapshotRecord[];
}

type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

/** key = 변환 전 버전. 예) 1: v1 → v2 */
export const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2 (Phase 1): 지역과 자동 일시정지 설정 추가
  1: (old) => {
    const config = { ...(old.config as Record<string, unknown>) };
    if (typeof config.regionId !== 'string') config.regionId = DEFAULT_REGION_ID;
    return { ...old, config, prefs: { autoPause: {} } };
  },
  // v2 → v3 (Phase 2): 시설·장비 구성과 제어 설정 추가(기본값: 연동 비닐하우스)
  2: (old) => {
    const config = { ...(old.config as Record<string, unknown>) };
    if (!config.setup) config.setup = defaultSetup();
    if (!config.settings) config.settings = defaultSettings();
    return { ...old, config };
  },
  // v3 → v4 (Phase 3a): 정식 계획 추가. 옛 작기의 시험용 군락(testLai)은 없앤다(작물 모델이 대신한다).
  3: (old) => {
    const config = { ...(old.config as Record<string, unknown>) };
    if (config.crop === undefined) config.crop = null;
    if (config.setup) config.setup = { ...(config.setup as Record<string, unknown>), testLai: 0 };
    return { ...old, config };
  },
};

export class SaveVersionError extends Error {}

/** 저장된(또는 불러온) 세이브를 현재 스키마로 끌어올린다. 원본은 건드리지 않는다. */
export function migrateSave(raw: unknown, migrations: Record<number, Migration> = MIGRATIONS, target = SAVE_SCHEMA_VERSION): SaveRecord {
  if (raw === null || typeof raw !== 'object') throw new SaveVersionError('세이브 형식이 올바르지 않습니다.');
  let cur = { ...(raw as Record<string, unknown>) };
  let v = cur.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new SaveVersionError('세이브 버전 정보가 없습니다.');
  if (v > target) {
    throw new SaveVersionError(`이 세이브는 더 새로운 앱 버전(스키마 v${v})에서 만들어졌습니다. 앱을 업데이트한 뒤 다시 열어 주세요.`);
  }
  while (v < target) {
    const step = migrations[v];
    if (!step) throw new SaveVersionError(`스키마 v${v} → v${v + 1} 변환이 없습니다.`);
    cur = step(cur);
    v += 1;
    cur.schemaVersion = v;
  }
  return cur as unknown as SaveRecord;
}

export function validateSave(s: SaveRecord): string[] {
  const errs: string[] = [];
  if (typeof s.id !== 'string' || s.id === '') errs.push('id 누락');
  if (typeof s.name !== 'string') errs.push('name 누락');
  if (!s.config || typeof s.config.seed !== 'string' || typeof s.config.startDate !== 'string' || typeof s.config.regionId !== 'string') errs.push('config(seed, startDate, regionId) 누락');
  else if (!s.config.setup || !s.config.settings) errs.push('config(setup, settings) 누락');
  if (!Array.isArray(s.actions)) errs.push('actions 누락');
  if (typeof s.hour !== 'number' || s.hour < 0) errs.push('hour 오류');
  return errs;
}
