/// <reference lib="webworker" />
/**
 * 엔진 실행기(Web Worker). 배속 중에도 화면이 멈추지 않도록 엔진을 별도 스레드에서 돌린다.
 * - 엔진 스텝과 화면 갱신을 분리: 화면으로 보내는 tick은 초당 최대 10회.
 * - 게임 시간은 실제 경과 시간에 비례해 흐르되, 한 번에 처리하는 양에 상한을 둔다
 *   (백그라운드에서 돌아온 직후 밀린 시간을 한꺼번에 계산하지 않기 위해).
 */
import { createInitialState, fingerprint, runTo, stepHour, type SimConfig, type SimState, type UserAction } from '../engine';
import type { FromWorker, ToWorker } from './protocol';

const SNAPSHOT_INTERVAL_HOURS = 7 * 24;
const LOOP_MS = 25;
const TICK_MS = 100;
const MAX_CATCHUP_MS = 250;

let config: SimConfig | null = null;
let state: SimState | null = null;
let actions: UserAction[] = [];
let hoursPerSecond = 0;
let carry = 0;
let lastLoop = 0;
let lastTick = 0;

const post = (msg: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

function loop() {
  const now = performance.now();
  const dt = Math.min(now - lastLoop, MAX_CATCHUP_MS);
  lastLoop = now;
  if (config && state && hoursPerSecond > 0) {
    carry += (dt / 1000) * hoursPerSecond;
    let n = Math.floor(carry);
    carry -= n;
    while (n-- > 0) {
      const h = state.hour;
      state = stepHour(state, config, actions.filter((a) => a.hour === h));
      if (state.hour % SNAPSHOT_INTERVAL_HOURS === 0) post({ type: 'snapshot', state, fingerprint: fingerprint(state) });
    }
  }
  if (state && now - lastTick >= TICK_MS) {
    lastTick = now;
    post({ type: 'tick', hour: state.hour, hoursPerSecond });
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      config = msg.config;
      actions = msg.actions;
      state = runTo(msg.state ?? createInitialState(msg.config), msg.config, actions, msg.targetHour);
      hoursPerSecond = 0;
      carry = 0;
      post({ type: 'ready', hour: state.hour });
      break;
    case 'setSpeed':
      hoursPerSecond = msg.hoursPerSecond;
      carry = 0;
      lastLoop = performance.now();
      if (state) post({ type: 'tick', hour: state.hour, hoursPerSecond });
      break;
    case 'action':
      actions.push(msg.action);
      break;
    case 'requestState':
      if (state) post({ type: 'state', requestId: msg.requestId, state, fingerprint: fingerprint(state), actions });
      break;
  }
};

lastLoop = performance.now();
setInterval(loop, LOOP_MS);
