/**
 * 결정론적 난수(N2, N3).
 * - 정수 연산(sfc32)만 쓰므로 어떤 기기·브라우저에서도 비트 단위로 같은 값이 나온다.
 * - 상태를 값으로 주고받는 순수 함수라서 스냅샷 저장·재개가 그대로 된다.
 * - Math.random()은 엔진 안에서 절대 쓰지 않는다.
 */
import { RNG_STREAMS, type RngState, type RngStream } from './types';

/** 문자열 → 32비트 정수 4개 (cyrb128 해시). */
export function hashSeed(text: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** 난수 하나(0 ≤ 정수 < 2^32)와 다음 상태를 돌려준다. */
export function nextUint32(state: RngState): [value: number, next: RngState] {
  let [a, b, c, d] = state;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  return [t >>> 0, [a >>> 0, b >>> 0, c >>> 0, d >>> 0]];
}

/** 균등 난수 0 ≤ u < 1. */
export function nextFloat(state: RngState): [value: number, next: RngState] {
  const [v, next] = nextUint32(state);
  return [v / 4294967296, next];
}

/** seed와 영역 이름으로 그 영역 전용 난수 흐름을 만든다. */
export function createStream(seed: string, stream: RngStream): RngState {
  let s = hashSeed(`${seed}::${stream}`);
  // 초기 상태의 편향을 없애기 위해 몇 번 돌려 둔다.
  for (let i = 0; i < 16; i++) s = nextUint32(s)[1];
  return s;
}

export function createAllStreams(seed: string): Record<RngStream, RngState> {
  const out = {} as Record<RngStream, RngState>;
  for (const name of RNG_STREAMS) out[name] = createStream(seed, name);
  return out;
}
