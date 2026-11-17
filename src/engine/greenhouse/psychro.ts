/** 습공기 계산. 포화수증기압은 FAO-56 식 11(Tetens)을 쓴다. */
import { dexp, dlog } from '../dmath';

/** 포화수증기압 kPa */
export function satVp(t: number): number {
  return 0.6108 * dexp((17.27 * t) / (t + 237.3));
}

/** 포화수증기압 곡선의 기울기 kPa/K */
export function satSlope(t: number): number {
  const d = t + 237.3;
  return (4098 * satVp(t)) / (d * d);
}

/** 이슬점 °C (Tetens 역산) */
export function dewPoint(vp: number): number {
  const x = dlog((vp > 1e-6 ? vp : 1e-6) / 0.6108);
  return (237.3 * x) / (17.27 - x);
}

/** 수증기 밀도(절대습도) kg m⁻³ */
export function absHumidity(vp: number, t: number): number {
  return (2.1668 * vp) / (t + 273.15);
}

export function vpFromAbs(chi: number, t: number): number {
  return (chi * (t + 273.15)) / 2.1668;
}

/** 습구온도 °C — 건습계식 e = es(Tw) − γ(T − Tw) 를 이분법으로 푼다(γ = 0.066 kPa/K). */
export function wetBulb(t: number, vp: number): number {
  let lo = t - 40;
  let hi = t;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (satVp(mid) - 0.066 * (t - mid) > vp) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
