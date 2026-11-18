/**
 * 세션: 저장 계층 + 엔진 워커 + 앱 생명주기를 묶는다(UI 쪽 코드).
 * - 세이브 = seed + 조치 로그 + 스냅샷. 다시 열면 가장 가까운 스냅샷에서 재생해 이어간다.
 * - 화면이 가려지면(visibilitychange/pagehide) 즉시 저장하고 일시정지한다.
 *   저장에는 워커 왕복이 필요 없다: 메인 스레드가 아는 "마지막 게임 시각 + 조치 로그"만 쓰면 된다.
 */
import EngineWorker from './engine.worker?worker&inline';
import { RZ_PARAMS } from '../data';
import { ENGINE_STATE_VERSION, EVENT_TYPES, defaultRzConfig, defaultSettings, defaultSetup, type ControlSettings, type DayWx, type DeviceId, type EventType, type GhSetup, type IrrSettings, type Lab, type LaborSettings, type PgrMethod, type NutSettings, type PlantOrder, type RzConfig, type RzSetup, type SimConfig, type SimEvent, type WorkPlan, type WorkTask } from '../engine';
import { getDailyRows, getHourlyRows, pruneHourly, putHourlyRows, getSave, kvGet, kvSet, latestSnapshot, listSaves, listSnapshots, openDatabase, putDailyRows, putSave, putSnapshot, type Db } from '../storage/db';
import { SAVE_SCHEMA_VERSION, type ObservationMode, type SaveRecord } from '../storage/schema';
import { decodeBundle, encodeBundle, exportFileName, shareOrDownload } from '../storage/exportImport';
import type { DayRow, FromWorker, HourRow, ToWorker, WxView } from './protocol';

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
  /** 최근 일 기록(오래된 것부터, 최대 60일) */
  days: DayRow[];
  /** 최근 시간 기록(오래된 것부터, 최대 14일 = 336시간) */
  hours: HourRow[];
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
  setup?: GhSetup;
  settings?: ControlSettings;
  /** 정식 계획(시작 후 며칠째에 무엇을 심을지) */
  crop?: { day: number; order: PlantOrder } | null;
}

const AUTOSAVE_MS = 5000;
const KV_CURRENT = 'currentSaveId';
/** 화면에 들고 있는 일 단위 원장(작기 전체 그래프용). */
const HISTORY_DAYS = 500;
const HISTORY_HOURS = 14 * 24;
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
  private view: SessionView = { status: 'loading', hour: 0, hoursPerSecond: 0, advancing: false, wx: null, days: [], hours: [], eventLog: [], pausedBy: null, persisted: null, lastSavedAt: null };
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
    // Phase 1 세이브의 일 기록은 외기만 들어 있다 → 새 형식으로 감싼다
    const rawDays = await getDailyRows<DayRow | DayWx>(db, save.id, today - HISTORY_DAYS, today - 1);
    const days: DayRow[] = rawDays.map((r) => ('wx' in r ? r : { dayIndex: r.dayIndex, wx: r, gh: null }));
    const hours = await getHourlyRows<HourRow>(db, save.id, save.hour - HISTORY_HOURS, save.hour - 1);
    const eventLog = ((await kvGet<SimEvent[]>(db, `events:${save.id}`)) ?? []).filter((e) => e.hour <= save.hour);
    this.dirty = false;
    this.set({ status: 'loading', save, hour: save.hour, hoursPerSecond: 0, advancing: false, wx: null, days, hours, eventLog, pausedBy: null, error: undefined });

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
        if (this.db) {
          void putDailyRows(this.db, save.id, msg.rows.map((d) => ({ day: d.dayIndex, data: d })));
          // 시간 원장 보존 정책: 최근 14일
          void pruneHourly(this.db, save.id, (msg.rows[msg.rows.length - 1]!.dayIndex + 1) * 24 - HISTORY_HOURS);
        }
        break;
      }
      case 'hours': {
        const save = this.view.save;
        if (!save) break;
        const last = msg.rows[msg.rows.length - 1]!.hour;
        const first = msg.rows[0]!.hour;
        const kept = this.view.hours.filter((r) => r.hour < first && r.hour > last - HISTORY_HOURS);
        this.set({ hours: [...kept, ...msg.rows].slice(-HISTORY_HOURS) });
        if (this.db) void putHourlyRows(this.db, save.id, msg.rows.slice(-HISTORY_HOURS).map((r) => ({ hour: r.hour, data: r })));
        break;
      }
      case 'action': {
        const save = this.view.save;
        if (!save) break;
        this.set({ save: { ...save, actions: [...save.actions, msg.action] }, wx: msg.view });
        this.dirty = true;
        void this.saveNow();
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

  /** 사용자 조치. 적용 시각은 워커가 찍고, 확정된 조치가 돌아오면 세이브에 기록한다. */
  addAction(type: string, payload: unknown) {
    if (this.view.status !== 'ready') return;
    this.send({ type: 'action', actionType: type, payload });
  }

  setControl(settings: ControlSettings) {
    this.addAction('gh/control', settings);
  }
  setSetup(setup: GhSetup) {
    this.addAction('gh/setup', setup);
  }
  cleanCover() {
    this.addAction('gh/clean', null);
  }
  repair(device: DeviceId) {
    this.addAction('gh/repair', { device });
  }
  repairCover() {
    this.addAction('gh/repairCover', null);
  }
  plantCrop(order: PlantOrder) {
    this.addAction('crop/plant', order);
    // 근권을 한 번도 손대지 않았고 처음 계획과 다른 작물을 심으면, 그 작물의 기본 근권(배지·처방·관수)으로 맞춘다.
    const save = this.view.save;
    if (save && !save.actions.some((a) => a.type.startsWith('rz/')) && !save.config.rz && (save.config.crop?.order.cropId ?? 'cucumber') !== order.cropId) {
      this.addAction('rz/config', defaultRzConfig(RZ_PARAMS, order.cropId, save.config.regionId));
    }
  }
  setPlan(plan: WorkPlan) {
    this.addAction('crop/plan', plan);
  }
  cropWork(task: WorkTask) {
    this.addAction('crop/work', { task });
  }
  removeCrop() {
    this.addAction('crop/remove', null);
  }
  // ── 근권(Phase 4) ──
  setRzSetup(setup: RzSetup) {
    this.addAction('rz/setup', setup);
  }
  setIrrigation(irr: IrrSettings) {
    this.addAction('rz/irrigation', irr);
  }
  setNutrition(nut: NutSettings) {
    this.addAction('rz/nutrition', nut);
  }
  applyRzConfig(cfg: RzConfig) {
    this.addAction('rz/config', cfg);
  }
  refillTank(tank: 'A' | 'B' | 'acid' | 'all') {
    this.addAction('rz/refill', { tank });
  }
  rzWork(type: 'rz/flush' | 'rz/renew' | 'rz/dumpDrain') {
    this.addAction(type, null);
  }
  orderLab(kind: Lab['kind']) {
    this.addAction('rz/lab', { kind });
  }
  /** 생장조절제 처리(Phase 5) */
  applyPgr(id: string, ppm: number, method: PgrMethod) {
    this.addAction('phys/pgr', { id, ppm, method });
  }
  /** 생리장해 순찰(스카우팅) — 노동 시간이 든다 */
  scoutPhys() {
    this.addAction('phys/scout', null);
  }
  /** 노동력 설정(자가·고용·일용 자동 고용) */
  setLabor(set: Partial<LaborSettings>) {
    this.addAction('labor/set', set);
  }
  /** 관측 모드: 학습(모두 보임) / 현실(측정해야 보임). 화면 표시만 바꾸고 결과에는 영향이 없다(리포트에 기록). */
  setObservationMode(mode: ObservationMode) {
    const save = this.view.save;
    if (!save) return;
    this.set({ save: { ...save, observationMode: mode } });
    this.dirty = true;
    void this.saveNow();
  }

  async saveNow(): Promise<void> {
    const save = this.view.save;
    if (!this.db || !save || this.view.status !== 'ready') return;
    const updated: SaveRecord = { ...save, hour: this.view.hour, updatedAt: Date.now() };
    // 관측 모드는 화면 쪽 상태라 저장 직전의 값을 그대로 쓴다
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
    const config: SimConfig = { seed: opts.seed?.trim() || newSeed(), startDate: opts.startDate, regionId: opts.regionId, setup: opts.setup ?? defaultSetup(), settings: opts.settings ?? defaultSettings(), crop: opts.crop ?? null };
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
