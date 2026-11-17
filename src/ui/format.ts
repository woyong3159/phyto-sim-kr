import { calendarAt, type DeviceId, type EventType, type SimConfig, type SimEvent } from '../engine';

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
  structure: { name: '시설 붕괴·파손', fromPhase: 2 },
  equipment: { name: '장비 고장', fromPhase: 2 },
  disease: { name: '병해충 발견', fromPhase: 6 },
  news: { name: '뉴스', fromPhase: 7 },
  stock: { name: '원액 탱크 소진', fromPhase: 4 },
  rootzone: { name: '근권(막힘·뿌리 장해·건조·분석 결과)', fromPhase: 4 },
  crop: { name: '작물 고사·첫 수확', fromPhase: 3 },
};

export const DEVICE_LABEL: Record<DeviceId, string> = {
  vent: '창 개폐기',
  curtain: '보온커튼',
  shade: '차광막',
  circFan: '순환팬',
  fog: '포그',
  heater: '난방기',
  cooling: '냉방',
  co2: 'CO2 공급',
  light: '보광등',
  dehumidifier: '제습기',
  solutionChiller: '양액 냉각기',
  solutionHeater: '양액 가온기',
};

export const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`;

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
    case 'structure':
      return e.code === 'collapse' ? `적설로 시설 붕괴 — 지붕 적설 ${v.toFixed(0)} cm` : `강풍으로 피복 파손 — 순간풍속 ${v.toFixed(0)} m/s`;
    case 'equipment':
      return `장비 고장 — ${DEVICE_LABEL[e.code as DeviceId] ?? e.code}`;
    case 'crop': {
      if (e.code === 'firstHarvest') return `첫 수확(와사비는 근경 수확) — 정식 후 ${v.toFixed(0)}일`;
      if (e.code === 'removed') return `작물 철거 — 누적 수확 ${(v * 1000).toFixed(0)} kg/10a`;
      const cause: Record<string, string> = { 'dead:frost': '동해', 'dead:chill': '저온 장해', 'dead:heat': '고온 장해', 'dead:collapse': '잎 소실', 'dead:rot': '고온 근권(뿌리 상함)' };
      return `작물 고사 — ${cause[e.code] ?? e.code} (실내 ${v.toFixed(1)}°C)`;
    }
    default:
      return EVENT_LABEL[e.type].name;
  }
}
