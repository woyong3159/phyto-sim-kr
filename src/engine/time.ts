/**
 * time — 시계. 내부 스텝은 1시간.
 * 달력은 KST 기준이며 대한민국은 일광절약시간이 없으므로 UTC 산술로 단순 계산한다.
 * (배속·자동 일시정지는 엔진 밖 실행기(worker)의 몫이고, 여기서는 게임 시각만 다룬다.)
 */
import { HOURS_PER_DAY, type EngineModule, type SimConfig } from './types';

export interface CalendarTime {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  /** 0–23 */
  hourOfDay: number;
  /** 연중 일수 1–366 */
  dayOfYear: number;
  /** 작기 시작 후 일수(0부터) */
  dayIndex: number;
}

const MS_PER_HOUR = 3_600_000;

export function parseStartDate(startDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!m) throw new Error(`시작일 형식 오류(YYYY-MM-DD): ${startDate}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error(`존재하지 않는 날짜: ${startDate}`);
  }
  return ms;
}

export function calendarAt(config: SimConfig, hour: number): CalendarTime {
  const startMs = parseStartDate(config.startDate);
  const t = new Date(startMs + hour * MS_PER_HOUR);
  const year = t.getUTCFullYear();
  const dayOfYear = Math.floor((Date.UTC(year, t.getUTCMonth(), t.getUTCDate()) - Date.UTC(year, 0, 1)) / (24 * MS_PER_HOUR)) + 1;
  return {
    year,
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hourOfDay: t.getUTCHours(),
    dayOfYear,
    dayIndex: Math.floor(hour / HOURS_PER_DAY),
  };
}

export const timeModule: EngineModule = {
  id: 'time',
  title: '시계',
  plannedPhase: 0,
  implemented: true,
  step: (state) => ({ ...state, hour: state.hour + 1 }),
};
