/**
 * 세이브 스키마와 마이그레이션.
 * 원칙: 세이브는 절대 지우지 않는다. 구조가 바뀌면 SAVE_SCHEMA_VERSION을 올리고
 * MIGRATIONS에 "이전 버전 → 다음 버전" 변환을 추가한다.
 */
import type { SimConfig, SimState, UserAction } from '../engine';

export const SAVE_SCHEMA_VERSION = 1;
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
export const MIGRATIONS: Record<number, Migration> = {};

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
  if (!s.config || typeof s.config.seed !== 'string' || typeof s.config.startDate !== 'string') errs.push('config(seed, startDate) 누락');
  if (!Array.isArray(s.actions)) errs.push('actions 누락');
  if (typeof s.hour !== 'number' || s.hour < 0) errs.push('hour 오류');
  return errs;
}
