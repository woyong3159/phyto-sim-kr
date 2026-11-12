/**
 * IndexedDB 저장 계층(헌법 5항).
 * 저장소 구성:
 *   saves         세이브 본체(seed + 조치 로그)
 *   snapshots     주기적 상태 스냅샷 [saveId, hour]
 *   ledgerHourly  시간 단위 원장(최근 14일) [saveId, hour]      — Phase 1부터 사용
 *   ledgerDaily   일 단위 집계(작기 전체) [saveId, day]         — Phase 1부터 사용
 *   reports       확정 저장된 작기 리포트                         — Phase 8부터 사용
 *   checkpoints   무거운 분석(반사실·A/B)의 이어하기 체크포인트   — Phase 8부터 사용
 *   kv            앱 설정
 * DB 버전을 올릴 때는 저장소를 "추가"만 하고, 기존 저장소는 절대 삭제하지 않는다.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { migrateSave, type SaveRecord, type SnapshotRecord } from './schema';

export const DB_NAME = 'phyto-sim-kr';
export const DB_VERSION = 1;
/** 스냅샷 간격: 게임 시간 7일(헌법 5항). */
export const SNAPSHOT_INTERVAL_HOURS = 7 * 24;

interface PhytoDB extends DBSchema {
  saves: { key: string; value: SaveRecord };
  snapshots: { key: [string, number]; value: SnapshotRecord };
  ledgerHourly: { key: [string, number]; value: { saveId: string; hour: number; data: unknown } };
  ledgerDaily: { key: [string, number]; value: { saveId: string; day: number; data: unknown } };
  reports: { key: string; value: { id: string; saveId: string; createdAt: number; data: unknown }; indexes: { bySave: string } };
  checkpoints: { key: string; value: { id: string; updatedAt: number; data: unknown } };
  kv: { key: string; value: unknown };
}

export type Db = IDBPDatabase<PhytoDB>;

export function openDatabase(name = DB_NAME): Promise<Db> {
  return openDB<PhytoDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('saves', { keyPath: 'id' });
        db.createObjectStore('snapshots', { keyPath: ['saveId', 'hour'] });
        db.createObjectStore('ledgerHourly', { keyPath: ['saveId', 'hour'] });
        db.createObjectStore('ledgerDaily', { keyPath: ['saveId', 'day'] });
        const reports = db.createObjectStore('reports', { keyPath: 'id' });
        reports.createIndex('bySave', 'saveId');
        db.createObjectStore('checkpoints', { keyPath: 'id' });
        db.createObjectStore('kv');
      }
      // 이후 버전: if (oldVersion < 2) { ...추가만... }
    },
  });
}

export async function putSave(db: Db, save: SaveRecord): Promise<void> {
  await db.put('saves', save);
}

/** 읽을 때 항상 현재 스키마로 끌어올린다. 변환된 결과는 다음 저장 때 기록된다. */
export async function getSave(db: Db, id: string): Promise<SaveRecord | undefined> {
  const raw = await db.get('saves', id);
  return raw ? migrateSave(raw) : undefined;
}

export async function listSaves(db: Db): Promise<SaveRecord[]> {
  const all = await db.getAll('saves');
  return all.map((s) => migrateSave(s)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putSnapshot(db: Db, snap: SnapshotRecord): Promise<void> {
  await db.put('snapshots', snap);
}

/** hour 이하에서 가장 최근 스냅샷. */
export async function latestSnapshot(db: Db, saveId: string, atOrBeforeHour = Number.MAX_SAFE_INTEGER): Promise<SnapshotRecord | undefined> {
  const range = IDBKeyRange.bound([saveId, 0], [saveId, atOrBeforeHour]);
  const cursor = await db.transaction('snapshots').store.openCursor(range, 'prev');
  return cursor?.value;
}

export async function listSnapshots(db: Db, saveId: string): Promise<SnapshotRecord[]> {
  return db.getAll('snapshots', IDBKeyRange.bound([saveId, 0], [saveId, Number.MAX_SAFE_INTEGER]));
}

export async function kvGet<T>(db: Db, key: string): Promise<T | undefined> {
  return (await db.get('kv', key)) as T | undefined;
}

export async function kvSet(db: Db, key: string, value: unknown): Promise<void> {
  await db.put('kv', value, key);
}
