/**
 * 세션: 저장 계층 + 엔진 워커 + 앱 생명주기를 묶는다(UI 쪽 코드).
 * - 세이브 = seed + 조치 로그 + 스냅샷. 다시 열면 가장 가까운 스냅샷에서 재생해 이어간다.
 * - 화면이 가려지면(visibilitychange/pagehide) 즉시 저장하고 일시정지한다.
 *   저장에는 워커 왕복이 필요 없다: 메인 스레드가 아는 "마지막 게임 시각 + 조치 로그"만 쓰면 된다.
 */
import EngineWorker from './engine.worker?worker&inline';
import { ENGINE_STATE_VERSION, EVENT_TYPES, type DayWx, type EventType, type SimConfig, type SimEvent, type UserAction } from '../engine';
import { getDailyRows, getSave, kvGet, kvSet, latestSnapshot, listSaves, listSnapshots, openDatabase, putDailyRows, putSave, putSnapshot, type Db } from '../storage/db';
import { SAVE_SCHEMA_VERSION, type SaveRecord } from '../storage/schema';
import { decodeBundle, encodeBundle, exportFileName, shareOrDownload } from '../storage/exportImport';
import type { FromWorker, ToWorker, WxView } from './protocol';

export interface SessionView {
  /** nosave = 아직 작기가 없음(새 작기 화면을 보여준다) */
  status: 'loading' | 'nosave' | 'ready' | 'error';
  error?: string;
  save?: SaveRecord;
  hour: number;
  hoursPerSecond: number;
  /** 턴 버튼으로 진행 중 */
  advancing: boolean;
  wx: WxView | null;
  /** 최근 일 기상(오래된 것부터, 최대 60일) */
  days: DayWx[];
  /** 최근 사건(새것부터, 최대 50건) */
  eventLog: SimEvent[];
  /** 방금 자동 일시정지를 일으킨 사건들. 사용자가 닫으면 비운다. */
  pausedBy: SimEvent[] | null;
  /** 브라우저가 "영구 저장"을 허용했는지. null = 확인 불가. */
  persisted: boolean | null;
  lastSavedAt: number | null;
}

export interface NewGameOptions {
  name: string;
  regionId: string;
  startDate: string;
  /** 비우면 자동 생성 */
  seed?: string;
}

const AUTOSAVE_MS = 5000;
const KV_CURRENT = 'currentSaveId';
const HISTORY_DAYS = 60;
const EVENT_LOG_MAX = 50;

export function newSeed(): string {
  // seed 생성은 엔진 밖에서 한 번만 한다. 이후 모든 랜덤은 이 seed로 고정된다.
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `${a[0]!.toString(36)}${a[1]!.toString(36)}`;
}

export function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function isAutoPauseOn(save: SaveRecord | undefined, type: EventType): boolean {
  return save?.prefs.autoPause[type] !== false;
}

const enabledTypes = (save: SaveRecord): EventType[] => EVENT_TYPES.filter((t) => isAutoPauseOn(save, t));

export class Session {
  private view: SessionView = { status: 'loading', hour: 0, hoursPerSecond: 0, advancing: false, wx: null, days: [], eventLog: [], pausedBy: null, persisted: null, lastSavedAt: null };
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
      this.set({ persisted });
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('pagehide', this.onHide);
      setInterval(() => {
        if (this.dirty) void this.saveNow();
      }, AUTOSAVE_MS);

      const currentId = await kvGet<string>(this.db, KV_CURRENT);
      const save = currentId ? await getSave(this.db, currentId) : undefined;
      if (!save) {
        this.set({ status: 'nosave' });
        return;
      }
      await this.open(save);
    } catch (e) {
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 세이브를 현재 작기로 연다. 실패하면 오류 상태로 알린다(세이브는 지우지 않는다). */
  private async open(save: SaveRecord): Promise<void> {
    try {
      await this.openInner(save);
    } catch (e) {
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async openInner(save: SaveRecord): Promise<void> {
    const db = this.db!;
    await kvSet(db, KV_CURRENT, save.id);
    const today = Math.floor(save.hour / 24);
    const days = await getDailyRows<DayWx>(db, save.id, today - HISTORY_DAYS, today - 1);
    const eventLog = ((await kvGet<SimEvent[]>(db, `events:${save.id}`)) ?? []).filter((e) => e.hour <= save.hour);
    this.dirty = false;
    this.set({ status: 'loading', save, hour: save.hour, hoursPerSecond: 0, advancing: false, wx: null, days, eventLog, pausedBy: null, error: undefined });

    this.worker?.terminate();
    const snap = await latestSnapshot(db, save.id, save.hour);
    // 엔진 상태 구조가 바뀐 옛 스냅샷은 쓰지 않고 처음부터 다시 계산한다(결과는 같다).
    const state = snap && snap.state.stateVersion === ENGINE_STATE_VERSION ? snap.state : null;
    const worker = new EngineWorker();
    this.worker = worker;
    worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onWorker(ev.data);
    worker.onerror = (ev) => this.set({ status: 'error', error: `엔진 오류: ${ev.message}` });
    this.send({ type: 'init', config: save.config, state, actions: save.actions, targetHour: save.hour, autoPause: enabledTypes(save) });
  }

  private send(msg: ToWorker) {
    this.worker?.postMessage(msg);
  }

  private onWorker(msg: FromWorker) {
    switch (msg.type) {
      case 'ready':
        this.set({ status: 'ready', hour: msg.hour, hoursPerSecond: 0, wx: msg.view });
        break;
      case 'tick': {
        if (msg.hour !== this.view.hour) this.dirty = true;
        this.set({ hour: msg.hour, hoursPerSecond: msg.hoursPerSecond, advancing: msg.advancing, wx: msg.view });
        // 정지 직후 워커가 알려주는 "확정 시각"으로 바로 저장한다.
        if (msg.hoursPerSecond === 0 && !msg.advancing && this.dirty) void this.saveNow();
        break;
      }
      case 'snapshot':
        if (this.db && this.view.save) {
          void putSnapshot(this.db, { saveId: this.view.save.id, hour: msg.state.hour, state: msg.state, fingerprint: msg.fingerprint });
        }
        break;
      case 'days': {
        const save = this.view.save;
        if (!save) break;
        const known = new Map(this.view.days.map((d) => [d.dayIndex, d]));
        for (const d of msg.rows) known.set(d.dayIndex, d);
        const days = [...known.values()].sort((a, b) => a.dayIndex - b.dayIndex).slice(-HISTORY_DAYS);
        this.set({ days });
        if (this.db) void putDailyRows(this.db, save.id, msg.rows.map((d) => ({ day: d.dayIndex, data: d })));
        break;
      }
      case 'events': {
        const save = this.view.save;
        const eventLog = [...[...msg.events].reverse(), ...this.view.eventLog].slice(0, EVENT_LOG_MAX);
        const pausing = msg.events.filter((e) => isAutoPauseOn(save, e.type));
        this.set({ eventLog, pausedBy: msg.paused && pausing.length ? pausing : this.view.pausedBy });
        if (this.db && save) void kvSet(this.db, `events:${save.id}`, eventLog);
        break;
      }
      case 'error':
        this.set({ status: 'error', error: msg.message });
        break;
      case 'state':
        break;
    }
  }

  setSpeed(hoursPerSecond: number) {
    if (hoursPerSecond > 0) this.set({ pausedBy: null });
    this.send({ type: 'setSpeed', hoursPerSecond });
  }

  /** 턴 버튼: hours 만큼 진행하고 멈춘다. */
  advance(hours: number) {
    this.set({ pausedBy: null, advancing: true });
    this.send({ type: 'advance', hours });
  }

  dismissPause() {
    this.set({ pausedBy: null });
  }

  setAutoPause(type: EventType, on: boolean) {
    const save = this.view.save;
    if (!save) return;
    const updated: SaveRecord = { ...save, prefs: { ...save.prefs, autoPause: { ...save.prefs.autoPause, [type]: on } } };
    this.set({ save: updated });
    this.send({ type: 'setAutoPause', types: enabledTypes(updated) });
    this.dirty = true;
  }

  /** 사용자 조치를 로그에 추가한다(Phase 2부터 실제 조치가 생긴다). */
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
    if (!this.db || !save || this.view.status !== 'ready') return;
    const updated: SaveRecord = { ...save, hour: this.view.hour, updatedAt: Date.now() };
    this.dirty = false;
    await putSave(this.db, updated);
    if (this.view.save?.id === updated.id) this.set({ save: { ...this.view.save, hour: updated.hour, updatedAt: updated.updatedAt }, lastSavedAt: updated.updatedAt });
  }

  private onHide = () => {
    if (this.view.status !== 'ready') return;
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

  /** 새 작기를 만든다. 이전 작기는 지우지 않는다. */
  async newGame(opts: NewGameOptions): Promise<void> {
    await this.saveNow();
    const now = Date.now();
    const config: SimConfig = { seed: opts.seed?.trim() || newSeed(), startDate: opts.startDate, regionId: opts.regionId };
    const save: SaveRecord = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      id: `save-${now.toString(36)}`,
      name: opts.name.trim() || '새 작기',
      createdAt: now,
      updatedAt: now,
      config,
      actions: [],
      hour: 0,
      observationMode: 'god',
      prefs: { autoPause: {} },
    };
    await putSave(this.db!, save);
    await this.open(save);
  }

  async listSaves(): Promise<SaveRecord[]> {
    return this.db ? listSaves(this.db) : [];
  }

  async loadSave(id: string): Promise<void> {
    await this.saveNow();
    const save = await getSave(this.db!, id);
    if (save) await this.open(save);
  }

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
    await this.open(imported);
  }
}

export const session = new Session();
