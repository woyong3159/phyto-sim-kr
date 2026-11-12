/// <reference lib="webworker" />
/**
 * 엔진 실행기(Web Worker). 배속 중에도 화면이 멈추지 않도록 엔진을 별도 스레드에서 돌린다.
 * - 엔진 스텝과 화면 갱신을 분리: 화면으로 보내는 tick은 초당 최대 10회.
 * - 게임 시간은 실제 경과 시간에 비례해 흐르되, 한 번에 처리하는 양에 상한을 둔다
 *   (백그라운드에서 돌아온 직후 밀린 시간을 한꺼번에 계산하지 않기 위해).
 * - 사건이 생기면(자동 일시정지가 켜진 종류) 그 시각에서 멈춘다.
 */
import { createInitialState, createWorld, fingerprint, stepHour, type DayWx, type EventType, type SimEvent, type SimState, type UserAction, type World } from '../engine';
import { ENGINE_DATA } from '../data';
import type { FromWorker, ToWorker, WxView } from './protocol';

const SNAPSHOT_INTERVAL_HOURS = 7 * 24;
const LOOP_MS = 25;
const TICK_MS = 100;
const MAX_CATCHUP_MS = 250;
/** 턴 버튼으로 한 루프에 처리하는 최대 스텝 수(다음 주 = 168스텝이 한 번에 끝난다). */
const ADVANCE_STEPS_PER_LOOP = 400;

let world: World | null = null;
let state: SimState | null = null;
let actions: UserAction[] = [];
let autoPause = new Set<EventType>();
let hoursPerSecond = 0;
let advanceLeft = 0;
let carry = 0;
let lastLoop = 0;
let lastTick = 0;
let dayBuffer: DayWx[] = [];
let eventBuffer: SimEvent[] = [];

const post = (msg: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

function view(): WxView {
  const s = state!;
  const sun = world!.clim.sun[s.weather.cur.di]!;
  return { now: s.weather.now, today: s.weather.cur, sunrise: sun.sunrise, sunset: sun.sunset, daylength: sun.daylength };
}

/** 한 스텝 진행. 자동 일시정지 대상 사건이 생기면 true. */
function stepOnce(collect: boolean): boolean {
  const h = state!.hour;
  state = stepHour(state!, world!, actions.length ? actions.filter((a) => a.hour === h) : actions);
  if (state.hour % 24 === 0) dayBuffer.push(state.weather.prev);
  if (collect && state.hour % SNAPSHOT_INTERVAL_HOURS === 0) post({ type: 'snapshot', state, fingerprint: fingerprint(state) });
  if (collect && state.events.length) {
    eventBuffer.push(...state.events);
    return state.events.some((e) => autoPause.has(e.type));
  }
  return false;
}

function flush(paused: boolean) {
  if (dayBuffer.length) {
    post({ type: 'days', rows: dayBuffer });
    dayBuffer = [];
  }
  if (eventBuffer.length) {
    post({ type: 'events', events: eventBuffer, paused });
    eventBuffer = [];
  }
}

function loop() {
  const now = performance.now();
  const dt = Math.min(now - lastLoop, MAX_CATCHUP_MS);
  lastLoop = now;
  let stopped = false;
  if (world && state) {
    let n = 0;
    if (advanceLeft > 0) {
      n = Math.min(advanceLeft, ADVANCE_STEPS_PER_LOOP);
      advanceLeft -= n;
    } else if (hoursPerSecond > 0) {
      carry += (dt / 1000) * hoursPerSecond;
      n = Math.floor(carry);
      carry -= n;
    }
    while (n-- > 0) {
      if (stepOnce(true)) {
        hoursPerSecond = 0;
        advanceLeft = 0;
        carry = 0;
        stopped = true;
        break;
      }
    }
    flush(stopped);
  }
  if (state && (stopped || now - lastTick >= TICK_MS)) {
    lastTick = now;
    post({ type: 'tick', hour: state.hour, hoursPerSecond, advancing: advanceLeft > 0, view: view() });
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init': {
        world = createWorld(msg.config, ENGINE_DATA);
        actions = msg.actions;
        autoPause = new Set(msg.autoPause);
        state = msg.state ?? createInitialState(world);
        const fresh = !msg.state && msg.targetHour === 0;
        dayBuffer = [];
        eventBuffer = [];
        // 스냅샷 → 저장 시각까지 조치 로그 재생(사건으로 멈추지 않는다)
        while (state.hour < msg.targetHour) stepOnce(false);
        hoursPerSecond = 0;
        advanceLeft = 0;
        carry = 0;
        post({ type: 'ready', hour: state.hour, view: view() });
        if (fresh && state.events.length) eventBuffer.push(...state.events);
        flush(false);
        break;
      }
      case 'setSpeed':
        hoursPerSecond = msg.hoursPerSecond;
        advanceLeft = 0;
        carry = 0;
        lastLoop = performance.now();
        if (state) post({ type: 'tick', hour: state.hour, hoursPerSecond, advancing: false, view: view() });
        break;
      case 'advance':
        hoursPerSecond = 0;
        advanceLeft = Math.max(0, Math.floor(msg.hours));
        break;
      case 'setAutoPause':
        autoPause = new Set(msg.types);
        break;
      case 'action':
        actions.push(msg.action);
        break;
      case 'requestState':
        if (state) post({ type: 'state', requestId: msg.requestId, state, fingerprint: fingerprint(state), actions });
        break;
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};

lastLoop = performance.now();
setInterval(loop, LOOP_MS);
