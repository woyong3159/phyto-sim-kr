/**
 * 결정론적 수학 함수(N3).
 * 자바스크립트의 Math.exp·log·sin·cos 등은 브라우저 엔진마다 마지막 자릿수가 다를 수 있다.
 * 사칙연산과 제곱근(Math.sqrt)은 IEEE 754가 결과를 한 가지로 정해 두었으므로,
 * 그것만으로 초월함수를 직접 계산하면 아이폰과 PC에서 비트 단위로 같은 값이 나온다.
 * 정확도는 약 1e-14(상대) — 생리 모델에는 충분하고, 중요한 것은 "어디서나 같은 값"이다.
 * 엔진 안에서는 Math.exp/log/pow/sin/cos/tan/asin/acos/atan 과 ** 연산자를 쓰지 않는다(테스트로 강제).
 */
export const PI = 3.141592653589793;
const LN2 = 0.6931471805599453;
const TWO_PI_HI = 6.283185307179586;
const TWO_PI_LO = 2.4492935982947064e-16;
const HALF_PI_HI = 1.5707963267948966;
const HALF_PI_LO = 6.123233995736766e-17;
const SQRT2 = 1.4142135623730951;

/** 2^k (정확한 값). */
function pow2(k: number): number {
  let n = k < 0 ? -k : k;
  let base = k < 0 ? 0.5 : 2;
  let p = 1;
  while (n > 0) {
    if (n & 1) p *= base;
    n >>= 1;
    if (n > 0) base *= base;
  }
  return p;
}

export function dexp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709) return Infinity;
  if (x < -700) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 16; i++) {
    term *= r / i;
    sum += term;
  }
  return sum * pow2(k);
}

export function dlog(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let m = x;
  let k = 0;
  while (m >= 4294967296) {
    m /= 4294967296;
    k += 32;
  }
  while (m < 1 / 4294967296) {
    m *= 4294967296;
    k -= 32;
  }
  while (m >= 2) {
    m /= 2;
    k += 1;
  }
  while (m < 1) {
    m *= 2;
    k -= 1;
  }
  if (m > SQRT2) {
    m /= 2;
    k += 1;
  }
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let term = s;
  let sum = s;
  for (let i = 3; i <= 31; i += 2) {
    term *= s2;
    sum += term / i;
  }
  return k * LN2 + 2 * sum;
}

export function dpow(a: number, b: number): number {
  if (b === 0) return 1;
  if (a === 0) return b > 0 ? 0 : Infinity;
  if (a < 0) return NaN;
  return dexp(b * dlog(a));
}

/** |t| ≤ π/4 구간의 sin, cos (테일러 급수). */
function sinKernel(t: number): number {
  const t2 = t * t;
  let term = t;
  let sum = t;
  for (let i = 1; i <= 9; i++) {
    term *= -t2 / (2 * i * (2 * i + 1));
    sum += term;
  }
  return sum;
}
function cosKernel(t: number): number {
  const t2 = t * t;
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 9; i++) {
    term *= -t2 / ((2 * i - 1) * (2 * i));
    sum += term;
  }
  return sum;
}

function reduce(x: number): [t: number, quadrant: number] {
  const k = Math.round(x / TWO_PI_HI);
  const r = x - k * TWO_PI_HI - k * TWO_PI_LO;
  const q = Math.round(r / HALF_PI_HI);
  const t = r - q * HALF_PI_HI - q * HALF_PI_LO;
  return [t, ((q % 4) + 4) % 4];
}

export function dsin(x: number): number {
  const [t, q] = reduce(x);
  if (q === 0) return sinKernel(t);
  if (q === 1) return cosKernel(t);
  if (q === 2) return -sinKernel(t);
  return -cosKernel(t);
}

export function dcos(x: number): number {
  const [t, q] = reduce(x);
  if (q === 0) return cosKernel(t);
  if (q === 1) return -sinKernel(t);
  if (q === 2) return -cosKernel(t);
  return sinKernel(t);
}

export function dtan(x: number): number {
  return dsin(x) / dcos(x);
}

export function datan(x: number): number {
  if (x !== x) return NaN;
  if (x < 0) return -datan(-x);
  if (x > 1) return HALF_PI_HI - datan(1 / x);
  let offset = 0;
  let t = x;
  if (t > 0.41421356237309503) {
    offset = PI / 4;
    t = (t - 1) / (t + 1);
  }
  // 반각 공식으로 한 번 더 줄인다: atan(t) = 2·atan(t / (1 + √(1+t²)))
  const u = t / (1 + Math.sqrt(1 + t * t));
  const u2 = u * u;
  let term = u;
  let sum = u;
  for (let i = 1; i <= 14; i++) {
    term *= -u2;
    sum += term / (2 * i + 1);
  }
  return offset + 2 * sum;
}

export function dasin(x: number): number {
  if (x >= 1) return HALF_PI_HI;
  if (x <= -1) return -HALF_PI_HI;
  return datan(x / Math.sqrt(1 - x * x));
}

export function dacos(x: number): number {
  return HALF_PI_HI - dasin(x);
}

export const DEG = PI / 180;
