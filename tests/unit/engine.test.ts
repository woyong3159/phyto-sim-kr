import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_MODULES,
  RNG_STREAMS,
  STEP_ORDER,
  calendarAt,
  createInitialState,
  createStream,
  fingerprint,
  nextFloat,
  nextUint32,
  replay,
  runTo,
  stepHour,
  type SimConfig,
  type UserAction,
} from '../../src/engine';

const config: SimConfig = { seed: 'test-seed-1', startDate: '2026-09-01' };

describe('rng — 결정론적 난수(N2, N3)', () => {
  it('같은 seed는 같은 수열을 만든다', () => {
    let a = createStream('abc', 'weather');
    let b = createStream('abc', 'weather');
    for (let i = 0; i < 1000; i++) {
      const [va, na] = nextUint32(a);
      const [vb, nb] = nextUint32(b);
      expect(va).toBe(vb);
      a = na;
      b = nb;
    }
  });

  it('고정 기준값과 일치한다(구현이 바뀌면 옛 세이브 재생이 달라지므로 반드시 잡아낸다)', () => {
    let s = createStream('PHYTO-SIM', 'weather');
    const out: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [v, n] = nextUint32(s);
      out.push(v);
      s = n;
    }
    expect(out).toMatchInlineSnapshot(`
      [
        1053575097,
        3082227622,
        3985363749,
        2851816901,
      ]
    `);
  });

  it('seed나 영역이 다르면 수열이 다르다', () => {
    const first = (seed: string, stream: (typeof RNG_STREAMS)[number]) => nextUint32(createStream(seed, stream))[0];
    expect(first('abc', 'weather')).not.toBe(first('abd', 'weather'));
    expect(first('abc', 'weather')).not.toBe(first('abc', 'market'));
  });

  it('균등 난수는 0 이상 1 미만이고 평균이 0.5 근처다', () => {
    let s = createStream('uniform', 'events');
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const [v, next] = nextFloat(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      s = next;
    }
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
  });

  it('상태를 JSON으로 저장했다가 되살려도 이어지는 수열이 같다', () => {
    let s = createStream('snap', 'pestIntro');
    for (let i = 0; i < 10; i++) s = nextUint32(s)[1];
    const restored = JSON.parse(JSON.stringify(s));
    expect(nextUint32(restored)).toEqual(nextUint32(s));
  });
});

describe('time — 시계와 달력', () => {
  it('1스텝 = 1시간', () => {
    const s0 = createInitialState(config);
    expect(stepHour(s0, config, []).hour).toBe(1);
  });

  it('달력 계산: 자정 넘김, 월말, 윤년', () => {
    expect(calendarAt(config, 0)).toMatchObject({ year: 2026, month: 9, day: 1, hourOfDay: 0, dayIndex: 0 });
    expect(calendarAt(config, 23)).toMatchObject({ day: 1, hourOfDay: 23, dayIndex: 0 });
    expect(calendarAt(config, 24)).toMatchObject({ day: 2, hourOfDay: 0, dayIndex: 1 });
    expect(calendarAt(config, 30 * 24)).toMatchObject({ month: 10, day: 1 });
    expect(calendarAt({ seed: 'x', startDate: '2028-02-28' }, 24)).toMatchObject({ month: 2, day: 29, dayOfYear: 60 });
    expect(calendarAt({ seed: 'x', startDate: '2026-12-31' }, 24)).toMatchObject({ year: 2027, month: 1, day: 1, dayOfYear: 1 });
  });

  it('잘못된 시작일은 거부한다', () => {
    expect(() => calendarAt({ seed: 'x', startDate: '2026-02-30' }, 0)).toThrow();
    expect(() => calendarAt({ seed: 'x', startDate: '2026/02/01' }, 0)).toThrow();
  });
});

describe('결정론과 이벤트 소싱(N3)', () => {
  const actions: UserAction[] = [
    { hour: 5, seq: 0, type: 'noop', payload: null },
    { hour: 200, seq: 0, type: 'noop', payload: { a: 1 } },
  ];

  it('같은 seed + 같은 조치 → 지문이 같은 상태', () => {
    const a = replay(config, actions, 24 * 120);
    const b = replay(config, actions, 24 * 120);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a).toEqual(b);
  });

  it('스냅샷에서 이어 계산한 결과 = 처음부터 계산한 결과', () => {
    const full = replay(config, actions, 24 * 60);
    const snapshot = JSON.parse(JSON.stringify(replay(config, actions, 24 * 21)));
    const resumed = runTo(snapshot, config, actions, 24 * 60);
    expect(fingerprint(resumed)).toBe(fingerprint(full));
  });

  it('seed가 다르면 상태가 다르다', () => {
    expect(fingerprint(replay(config, [], 24))).not.toBe(fingerprint(replay({ ...config, seed: 'other' }, [], 24)));
  });

  it('스텝은 입력 상태를 바꾸지 않는다(순수 함수)', () => {
    const s0 = createInitialState(config);
    const before = JSON.stringify(s0);
    stepHour(s0, config, []);
    expect(JSON.stringify(s0)).toBe(before);
  });

  it('지문은 키 순서와 무관하다', () => {
    expect(fingerprint({ a: 1, b: [1, 2] })).toBe(fingerprint({ b: [1, 2], a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe('엔진 구조', () => {
  it('헌법 6항의 14개 모듈이 모두 등록되어 있다', () => {
    const ids = ALL_MODULES.map((m) => m.id).sort();
    expect(ids).toEqual(['control', 'crop', 'economy', 'events', 'greenhouse', 'labor', 'ledger', 'market', 'physiology', 'protection', 'report', 'rootzone', 'time', 'weather']);
  });

  it('시계는 스텝의 마지막에 전진한다', () => {
    expect(STEP_ORDER[STEP_ORDER.length - 1]!.id).toBe('time');
  });

  it('엔진은 UI·브라우저에 의존하지 않는다(N6) — Math.random·Date.now도 금지', () => {
    const dir = join(__dirname, '../../src/engine');
    const banned = [/from ['"]react/, /\bdocument\./, /\bwindow\./, /\bnavigator\./, /\bindexedDB\b/, /Math\.random\s*\(/, /Date\.now\s*\(/, /from ['"]\.\.\/(ui|storage|sim|pwa)/];
    for (const f of readdirSync(dir, { recursive: true }) as string[]) {
      if (!f.endsWith('.ts')) continue;
      const code = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const re of banned) expect(re.test(code), `${f} 가 금지된 의존성 ${re} 을 사용`).toBe(false);
    }
  });
});
