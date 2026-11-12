/**
 * 세션: 저장 계층 + 엔진 워커 + 앱 생명주기를 묶는다(UI 쪽 코드).
 * - 세이브 = seed + 조치 로그 + 스냅샷. 다시 열면 가장 가까운 스냅샷에서 재생해 이어간다.
 * - 화면이 가려지면(visibilitychange/pagehide) 즉시 저장하고 일시정지한다.
 *   저장에는 워커 왕복이 필요 없다: 메인 스레드가 아는 "마지막 게임 시각 + 조치 로그"만 쓰면 된다.
 */
import EngineWorker from './engine.worker?worker&inline';
import type { SimConfig, UserAction } from '../engine';
import { kvGet, kvSet, getSave, latestSnapshot, listSnapshots, openDatabase, putSave, putSnapshot, type Db } from '../storage/db';
import { SAVE_SCHEMA_VERSION, type SaveRecord } from '../storage/schema';
import { decodeBundle, encodeBundle, exportFileName, shareOrDownload } from '../storage/exportImport';
import type { FromWorker, ToWorker } from './protocol';

export interface SessionView {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  save?: SaveRecord;
  hour: number;
  hoursPerSecond: number;
  /** 브라우저가 "영구 저장"을 허용했는지. null = 확인 불가. */
  persisted: boolean | null;
  lastSavedAt: number | null;
  /** 이번 실행에서 저장된 지점부터 이어서 열렸는지. */
  resumedFromHour: number | null;
}

const AUTOSAVE_MS = 5000;
const KV_CURRENT = 'currentSaveId';

function newSeed(): string {
  // seed 생성은 엔진 밖에서 한 번만 한다. 이후 모든 랜덤은 이 seed로 고정된다.
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `${a[0]!.toString(36)}${a[1]!.toString(36)}`;
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export class Session {
  private view: SessionView = { status: 'loading', hour: 0, hoursPerSecond: 0, persisted: null, lastSavedAt: null, resumedFromHour: null };
  private listeners = new Set<() => void>();
  private db: Db | null = null;
  private worker: Worker | null = null;
  private speedBeforeHide = 0;
  private dirty = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getView = () => this.view;

  private set(patch: Partial<SessionView>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  async start(): Promise<void> {
    try {
      this.db = await openDatabase();
      let persisted: boolean | null = null;
      if (navigator.storage?.persist) {
        persisted = (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
      }
      const currentId = await kvGet<string>(this.db, KV_CURRENT);
      let save = currentId ? await getSave(this.db, currentId) : undefined;
      const isNew = !save;
      if (!save) {
        const now = Date.now();
        const config: SimConfig = { seed: newSeed(), startDate: todayKst() };
        save = {
          schemaVersion: SAVE_SCHEMA_VERSION,
          id: `save-${now.toString(36)}`,
          name: '시험 작기',
          createdAt: now,
          updatedAt: now,
          config,
          actions: [],
          hour: 0,
          observationMode: 'god',
        };
        await putSave(this.db, save);
        await kvSet(this.db, KV_CURRENT, save.id);
      }
      this.set({ persisted, save, hour: save.hour, resumedFromHour: isNew || save.hour === 0 ? null : save.hour });
      await this.bootWorker(save);
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('pagehide', this.onHide);
      setInterval(() => {
        if (this.dirty) void this.saveNow();
      }, AUTOSAVE_MS);
    } catch (e) {
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async bootWorker(save: SaveRecord): Promise<void> {
    this.worker?.terminate();
    const snap = await latestSnapshot(this.db!, save.id, save.hour);
    const worker = new EngineWorker();
    this.worker = worker;
    worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onWorker(ev.data);
    worker.onerror = (ev) => this.set({ status: 'error', error: `엔진 오류: ${ev.message}` });
    this.send({ type: 'init', config: save.config, state: snap?.state ?? null, actions: save.actions, targetHour: save.hour });
  }

  private send(msg: ToWorker) {
    this.worker?.postMessage(msg);
  }

  private onWorker(msg: FromWorker) {
    switch (msg.type) {
      case 'ready':
        this.set({ status: 'ready', hour: msg.hour, hoursPerSecond: 0 });
        break;
      case 'tick':
        if (msg.hour !== this.view.hour) this.dirty = true;
        if (msg.hour !== this.view.hour || msg.hoursPerSecond !== this.view.hoursPerSecond) {
          this.set({ hour: msg.hour, hoursPerSecond: msg.hoursPerSecond });
        }
        // 정지 직후 워커가 알려주는 "확정 시각"으로 바로 저장한다.
        if (msg.hoursPerSecond === 0 && this.dirty) void this.saveNow();
        break;
      case 'snapshot':
        if (this.db && this.view.save) {
          void putSnapshot(this.db, { saveId: this.view.save.id, hour: msg.state.hour, state: msg.state, fingerprint: msg.fingerprint });
        }
        break;
      case 'state':
        break;
    }
  }

  setSpeed(hoursPerSecond: number) {
    this.send({ type: 'setSpeed', hoursPerSecond });
  }

  /** 사용자 조치를 로그에 추가한다(Phase 1부터 실제 조치가 생긴다). */
  addAction(type: string, payload: unknown) {
    const save = this.view.save;
    if (!save) return;
    const hour = this.view.hour;
    const seq = save.actions.filter((a) => a.hour === hour).length;
    const action: UserAction = { hour, seq, type, payload };
    this.set({ save: { ...save, actions: [...save.actions, action] } });
    this.send({ type: 'action', action });
    this.dirty = true;
  }

  async saveNow(): Promise<void> {
    const save = this.view.save;
    if (!this.db || !save) return;
    const updated: SaveRecord = { ...save, hour: this.view.hour, updatedAt: Date.now() };
    this.dirty = false;
    await putSave(this.db, updated);
    this.set({ save: updated, lastSavedAt: updated.updatedAt });
  }

  private onHide = () => {
    if (this.view.hoursPerSecond > 0) this.speedBeforeHide = this.view.hoursPerSecond;
    this.send({ type: 'setSpeed', hoursPerSecond: 0 });
    // 1차: 지금 아는 시각으로 즉시 저장(앱이 곧바로 멈춰도 남는다).
    // 2차: 워커의 확정 시각이 도착하면 tick 처리에서 한 번 더 저장한다.
    void this.saveNow();
  };

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      this.onHide();
    } else if (this.speedBeforeHide > 0) {
      // 화면이 다시 보이면 이전 배속으로 이어서 진행한다.
      this.send({ type: 'setSpeed', hoursPerSecond: this.speedBeforeHide });
      this.speedBeforeHide = 0;
    }
  };

  async exportCurrent(): Promise<'shared' | 'downloaded' | 'cancelled'> {
    await this.saveNow();
    const save = this.view.save!;
    const snaps = await listSnapshots(this.db!, save.id);
    return shareOrDownload(encodeBundle(save, snaps, Date.now()), exportFileName(save));
  }

  /** 세이브 파일을 불러와 현재 작기로 연다. 기존 세이브는 지우지 않는다. */
  async importFile(file: File): Promise<void> {
    const { save, snapshots } = decodeBundle(new Uint8Array(await file.arrayBuffer()));
    const db = this.db!;
    await this.saveNow();
    // 같은 id의 세이브가 이미 있으면 덮어쓰지 않고 새 id로 들여온다.
    const exists = await getSave(db, save.id);
    const id = exists ? `${save.id}-i${Date.now().toString(36)}` : save.id;
    const imported: SaveRecord = { ...save, id, updatedAt: Date.now() };
    await putSave(db, imported);
    for (const s of snapshots) await putSnapshot(db, { ...s, saveId: id });
    await kvSet(db, KV_CURRENT, id);
    this.set({ status: 'loading', save: imported, hour: imported.hour, resumedFromHour: imported.hour });
    await this.bootWorker(imported);
  }
}

export const session = new Session();
