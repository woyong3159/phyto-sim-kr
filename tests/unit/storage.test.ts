import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createInitialState, fingerprint, replay, runTo } from '../../src/engine';
import { world } from './helpers';
import { getDailyRows, putDailyRows, getSave, kvGet, kvSet, latestSnapshot, listSaves, listSnapshots, openDatabase, putSave, putSnapshot } from '../../src/storage/db';
import { decodeBundle, encodeBundle, exportFileName } from '../../src/storage/exportImport';
import { SAVE_SCHEMA_VERSION, SaveVersionError, migrateSave, type SaveRecord } from '../../src/storage/schema';

let n = 0;
const freshDb = () => openDatabase(`test-db-${n++}`);

const makeSave = (id = 's1'): SaveRecord => ({
  schemaVersion: SAVE_SCHEMA_VERSION,
  id,
  name: '시험 작기',
  createdAt: 1,
  updatedAt: 2,
  config: world.config,
  actions: [{ hour: 3, seq: 0, type: 'noop', payload: null }],
  hour: 500,
  observationMode: 'god',
  prefs: { autoPause: { heatwave: false } },
});

describe('IndexedDB 저장 계층', () => {
  it('세이브를 저장하고 그대로 읽는다', async () => {
    const db = await freshDb();
    await putSave(db, makeSave());
    expect(await getSave(db, 's1')).toEqual(makeSave());
    expect(await getSave(db, 'none')).toBeUndefined();
  });

  it('세이브 목록은 최근 수정 순', async () => {
    const db = await freshDb();
    await putSave(db, { ...makeSave('a'), updatedAt: 10 });
    await putSave(db, { ...makeSave('b'), updatedAt: 20 });
    expect((await listSaves(db)).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('지정 시각 이하의 가장 최근 스냅샷을 찾는다(다른 세이브와 섞이지 않는다)', async () => {
    const db = await freshDb();
    const save = makeSave();
    for (const h of [0, 168, 336]) {
      const state = replay(world, save.actions, h);
      await putSnapshot(db, { saveId: 's1', hour: h, state, fingerprint: fingerprint(state) });
    }
    const other = replay(world, [], 400);
    await putSnapshot(db, { saveId: 's2', hour: 400, state: other, fingerprint: fingerprint(other) });
    expect((await latestSnapshot(db, 's1', 500))?.hour).toBe(336);
    expect((await latestSnapshot(db, 's1', 335))?.hour).toBe(168);
    expect((await latestSnapshot(db, 's1'))?.hour).toBe(336);
    expect(await latestSnapshot(db, 'none')).toBeUndefined();
    expect((await listSnapshots(db, 's1')).length).toBe(3);
  });

  it('스냅샷 + 조치 로그로 저장 시점 상태를 정확히 복원한다(이벤트 소싱)', async () => {
    const db = await freshDb();
    const save = makeSave();
    const at336 = replay(world, save.actions, 336);
    await putSnapshot(db, { saveId: save.id, hour: 336, state: at336, fingerprint: fingerprint(at336) });
    const snap = await latestSnapshot(db, save.id, save.hour);
    const resumed = runTo(snap?.state ?? createInitialState(world), world, save.actions, save.hour);
    expect(fingerprint(resumed)).toBe(fingerprint(replay(world, save.actions, save.hour)));
  });

  it('일 단위 원장: 범위 조회, 덮어쓰기, 빈 범위(작기 첫날)에도 오류 없음', async () => {
    const db = await freshDb();
    expect(await getDailyRows(db, 's1', -60, -1)).toEqual([]);
    await putDailyRows(db, 's1', [0, 1, 2, 3].map((day) => ({ day, data: { day, v: 1 } })));
    await putDailyRows(db, 's1', [{ day: 2, data: { day: 2, v: 2 } }]);
    await putDailyRows(db, 's2', [{ day: 1, data: { day: 1, v: 9 } }]);
    expect(await getDailyRows(db, 's1', -5, 2)).toEqual([{ day: 0, v: 1 }, { day: 1, v: 1 }, { day: 2, v: 2 }]);
    expect(await getDailyRows(db, 's1', 3, 10)).toEqual([{ day: 3, v: 1 }]);
  });

  it('설정값(kv) 저장', async () => {
    const db = await freshDb();
    expect(await kvGet(db, 'k')).toBeUndefined();
    await kvSet(db, 'k', { a: 1 });
    expect(await kvGet(db, 'k')).toEqual({ a: 1 });
  });

  it('DB를 닫았다 다시 열어도 데이터가 남아 있다', async () => {
    const name = `persist-${n++}`;
    const db1 = await openDatabase(name);
    await putSave(db1, makeSave());
    db1.close();
    const db2 = await openDatabase(name);
    expect((await getSave(db2, 's1'))?.hour).toBe(500);
  });
});

describe('세이브 스키마 마이그레이션', () => {
  it('현재 버전은 그대로 통과', () => {
    expect(migrateSave(makeSave())).toEqual(makeSave());
  });

  it('옛 버전은 단계별 변환을 거쳐 현재 버전이 된다(원본은 변하지 않는다)', () => {
    const old = { schemaVersion: 1, id: 'x', title: '옛 이름' };
    const migrations = {
      1: (o: Record<string, unknown>) => ({ ...o, name: o.title }),
      2: (o: Record<string, unknown>) => ({ ...o, extra: true }),
    };
    const out = migrateSave(old, migrations, 3) as unknown as Record<string, unknown>;
    expect(out).toMatchObject({ schemaVersion: 3, name: '옛 이름', extra: true });
    expect(old.schemaVersion).toBe(1);
  });

  it('Phase 0(v1) 세이브를 v2로 옮긴다: 지역 기본값과 자동 일시정지 설정이 생기고 조치 로그는 그대로', () => {
    const v1 = { schemaVersion: 1, id: 'old', name: '시험 작기', createdAt: 1, updatedAt: 2, config: { seed: 'abc', startDate: '2026-11-12' }, actions: [{ hour: 1, seq: 0, type: 'noop', payload: null }], hour: 100, observationMode: 'god' };
    const out = migrateSave(v1);
    expect(out.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(out.config).toEqual({ seed: 'abc', startDate: '2026-11-12', regionId: 'buyeo' });
    expect(out.prefs).toEqual({ autoPause: {} });
    expect(out.actions).toEqual(v1.actions);
    expect(out.hour).toBe(100);
  });

  it('더 새로운 버전의 세이브는 지우지 않고 거부한다', () => {
    expect(() => migrateSave({ ...makeSave(), schemaVersion: SAVE_SCHEMA_VERSION + 1 })).toThrow(SaveVersionError);
  });

  it('버전 정보가 없거나 변환 경로가 없으면 거부한다', () => {
    expect(() => migrateSave({ id: 'x' })).toThrow(SaveVersionError);
    expect(() => migrateSave(null)).toThrow(SaveVersionError);
    expect(() => migrateSave({ schemaVersion: 1 }, {}, 2)).toThrow(SaveVersionError);
  });
});

describe('세이브 내보내기/불러오기', () => {
  it('압축했다 풀면 원본과 같다', () => {
    const save = makeSave();
    const state = replay(world, save.actions, 168);
    const snaps = [{ saveId: save.id, hour: 168, state, fingerprint: fingerprint(state) }];
    const bytes = encodeBundle(save, snaps, 123);
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
    const back = decodeBundle(bytes);
    expect(back.save).toEqual(save);
    expect(back.snapshots).toEqual(snaps);
  });

  it('같은 내용은 같은 바이트로 내보낸다', () => {
    const a = encodeBundle(makeSave(), [], 1);
    const b = encodeBundle(makeSave(), [], 1);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('엉뚱한 파일과 손상된 세이브는 거부한다', () => {
    const enc = new TextEncoder();
    expect(() => decodeBundle(enc.encode('hello'))).toThrow();
    expect(() => decodeBundle(enc.encode('{"format":"other"}'))).toThrow();
    expect(() => decodeBundle(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))).toThrow();
    const broken = { format: 'phyto-sim-kr-save', schemaVersion: 2, save: { schemaVersion: 2, id: 'x' } };
    expect(() => decodeBundle(enc.encode(JSON.stringify(broken)))).toThrow(/세이브 내용 오류/);
  });

  it('파일 이름에 한글 이름과 일차가 들어간다', () => {
    expect(exportFileName(makeSave())).toBe('phyto-sim_시험_작기_d20.physim.gz');
  });
});
