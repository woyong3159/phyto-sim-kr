/**
 * 천문 계산: 위도·날짜로 일장(daylength), 태양고도, 대기권 밖 일사(Ra).
 * - 태양 적위·균시차·지구-태양 거리 보정: Spencer (1971) 푸리에 급수.
 * - Ra: FAO-56 식 21. 태양상수 Gsc = 0.0820 MJ m⁻² min⁻¹.
 * 시각은 KST(동경 135° 기준 표준시) 시계 시각이다. 한국은 표준 자오선보다 서쪽이라
 * 태양 남중이 12시 30분 무렵에 온다.
 */
import { DEG, PI, dacos, dcos, dsin } from '../dmath';

const GSC = 0.082;
const KST_MERIDIAN = 135;

export interface SunDay {
  /** 태양 적위(rad) */
  decl: number;
  /** 남중 시각(KST, h) */
  noon: number;
  /** 일출·일몰(KST, h) — 태양 중심 고도 −0.833° 기준(대기 굴절 포함) */
  sunrise: number;
  sunset: number;
  /** 일장(h) = 일몰 − 일출 */
  daylength: number;
  /** 기하학적 가조시간 N(h) — 고도 0° 기준. Ångström 식에 사용 */
  possibleSunshine: number;
  /** 대기권 밖 일사 Ra (MJ m⁻² d⁻¹) */
  ra: number;
  sinLat: number;
  cosLat: number;
  sinDecl: number;
  cosDecl: number;
}

/** dayOfYear: 1–365(366은 365로 취급). */
export function sunDay(latDeg: number, lonDeg: number, dayOfYear: number): SunDay {
  const doy = dayOfYear > 365 ? 365 : dayOfYear;
  const g = (2 * PI * (doy - 1)) / 365;
  const c1 = dcos(g);
  const s1 = dsin(g);
  const c2 = dcos(2 * g);
  const s2 = dsin(2 * g);
  const c3 = dcos(3 * g);
  const s3 = dsin(3 * g);
  const decl = 0.006918 - 0.399912 * c1 + 0.070257 * s1 - 0.006758 * c2 + 0.000907 * s2 - 0.002697 * c3 + 0.00148 * s3;
  const eotMin = 229.18 * (0.000075 + 0.001868 * c1 - 0.032077 * s1 - 0.014615 * c2 - 0.040849 * s2);
  const e0 = 1.00011 + 0.034221 * c1 + 0.00128 * s1 + 0.000719 * c2 + 0.000077 * s2;

  const lat = latDeg * DEG;
  const sinLat = dsin(lat);
  const cosLat = dcos(lat);
  const sinDecl = dsin(decl);
  const cosDecl = dcos(decl);

  const hourAngle = (sinH0: number) => {
    const x = (sinH0 - sinLat * sinDecl) / (cosLat * cosDecl);
    return dacos(x < -1 ? -1 : x > 1 ? 1 : x);
  };
  const ws0 = hourAngle(0);
  const wsR = hourAngle(dsin(-0.833 * DEG));
  const noon = 12 + (KST_MERIDIAN - lonDeg) / 15 - eotMin / 60;
  const half = (wsR / PI) * 12;
  const ra = ((24 * 60) / PI) * GSC * e0 * (ws0 * sinLat * sinDecl + cosLat * cosDecl * dsin(ws0));

  return {
    decl,
    noon,
    sunrise: noon - half,
    sunset: noon + half,
    daylength: 2 * half,
    possibleSunshine: (ws0 / PI) * 24,
    ra,
    sinLat,
    cosLat,
    sinDecl,
    cosDecl,
  };
}

/** KST 시계 시각 t(h)의 태양고도 사인값(음수면 지평선 아래). */
export function sinElevation(sun: SunDay, clockHour: number): number {
  return sun.sinLat * sun.sinDecl + sun.cosLat * sun.cosDecl * dcos((PI / 12) * (clockHour - sun.noon));
}

/** [h0, h0+1) 한 시간 동안의 양(+)의 sin(고도) 합(10분 간격 6점). 일사 시간 분배의 가중치. */
export function hourSinSum(sun: SunDay, h0: number): number {
  let s = 0;
  for (let i = 0; i < 6; i++) {
    const v = sinElevation(sun, h0 + (i + 0.5) / 6);
    if (v > 0) s += v;
  }
  return s;
}

export function daySinSum(sun: SunDay): number {
  let s = 0;
  for (let h = 0; h < 24; h++) s += hourSinSum(sun, h);
  return s;
}
