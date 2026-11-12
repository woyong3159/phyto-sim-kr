import { calendarAt, type EventType, type SimConfig, type SimEvent } from '../engine';

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** 12.53 → "12:32" */
export function clock(h: number): string {
  const m = Math.round(h * 60);
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}

export function hoursMinutes(h: number): string {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

export function dateLabel(config: SimConfig, hour: number): { date: string; time: string; day: number; weekday: string } {
  const c = calendarAt(config, hour);
  const wd = new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
  return { date: `${c.year}.${pad2(c.month)}.${pad2(c.day)}`, time: `${pad2(c.hourOfDay)}:00`, day: c.dayIndex + 1, weekday: WEEKDAY[wd]! };
}

export const EVENT_LABEL: Record<EventType, { name: string; fromPhase: number }> = {
  heatwave: { name: '폭염', fromPhase: 1 },
  coldwave: { name: '한파', fromPhase: 1 },
  jangma: { name: '장마 시작·종료', fromPhase: 1 },
  typhoon: { name: '태풍', fromPhase: 1 },
  heavyRain: { name: '호우', fromPhase: 1 },
  heavySnow: { name: '대설', fromPhase: 1 },
  hail: { name: '우박', fromPhase: 1 },
  disease: { name: '병해충 발견', fromPhase: 6 },
  equipment: { name: '장비 고장', fromPhase: 2 },
  news: { name: '뉴스', fromPhase: 7 },
  stock: { name: '재고 부족', fromPhase: 4 },
};

export function eventText(e: SimEvent): string {
  const v = e.value;
  switch (e.type) {
    case 'heatwave':
      return `${e.level === 'warning' ? '폭염경보' : '폭염주의보'} 수준 — 일최고 ${v.toFixed(1)}°C, 2일 연속`;
    case 'coldwave':
      return `${e.level === 'warning' ? '한파경보' : '한파주의보'} 수준 — 일최저 ${v.toFixed(1)}°C, 2일 연속`;
    case 'jangma':
      return e.code === 'start' ? '장마 시작' : '장마 종료';
    case 'typhoon':
      return `태풍 영향 — 최대순간풍속 ${v.toFixed(0)} m/s 예상`;
    case 'heavyRain':
      return `호우 — 일강수량 ${v.toFixed(0)} mm`;
    case 'heavySnow':
      return `${e.level === 'warning' ? '대설경보' : '대설주의보'} 수준 — 신적설 ${v.toFixed(0)} cm`;
    case 'hail':
      return '우박';
    default:
      return EVENT_LABEL[e.type].name;
  }
}
