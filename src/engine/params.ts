/**
 * 데이터 태그 프로토콜(헌법 8항). /data/*.json의 모든 파라미터는 이 형식을 따른다.
 */
export const PARAM_TAGS = ['SRC', 'EST', 'CAL', 'USER'] as const;
export type ParamTag = (typeof PARAM_TAGS)[number];

export interface Param {
  value: number;
  unit: string;
  range: [min: number, max: number];
  tag: ParamTag;
  source: string;
  note: string;
}

export interface DataFile {
  _meta: { file: string; title: string; plannedPhase: number; schemaVersion: number };
  params: Record<string, unknown>;
}

/** 파라미터 하나의 형식 오류 목록을 돌려준다(없으면 빈 배열). */
export function validateParam(path: string, p: unknown): string[] {
  const errs: string[] = [];
  if (p === null || typeof p !== 'object') return [`${path}: 객체가 아님`];
  const o = p as Record<string, unknown>;
  if (typeof o.value !== 'number' || !Number.isFinite(o.value)) errs.push(`${path}: value가 유한한 숫자가 아님`);
  if (typeof o.unit !== 'string') errs.push(`${path}: unit 누락`);
  const r = o.range;
  if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== 'number' || typeof r[1] !== 'number' || r[0] > r[1]) {
    errs.push(`${path}: range는 [min, max] 형식이어야 함`);
  } else if (typeof o.value === 'number' && (o.value < r[0] || o.value > r[1])) {
    errs.push(`${path}: value(${o.value})가 range 밖`);
  }
  if (typeof o.tag !== 'string' || !(PARAM_TAGS as readonly string[]).includes(o.tag)) errs.push(`${path}: tag는 SRC|EST|CAL|USER`);
  if (typeof o.source !== 'string') errs.push(`${path}: source 누락`);
  if (typeof o.note !== 'string') errs.push(`${path}: note 누락`);
  if (o.tag === 'SRC' && typeof o.source === 'string' && o.source.trim() === '') errs.push(`${path}: SRC는 출처 필수`);
  if ((o.tag === 'EST' || o.tag === 'CAL') && typeof o.note === 'string' && o.note.trim() === '') {
    errs.push(`${path}: ${o.tag}는 note(추정 논리·보정 사유) 필수`);
  }
  return errs;
}

function isParamLike(v: unknown): boolean {
  return v !== null && typeof v === 'object' && 'value' in (v as object) && 'tag' in (v as object);
}

/** 데이터 파일 안의 모든 파라미터를 재귀적으로 검사한다. */
export function validateDataFile(file: DataFile): { count: number; errors: string[]; byTag: Record<ParamTag, number> } {
  const errors: string[] = [];
  const byTag: Record<ParamTag, number> = { SRC: 0, EST: 0, CAL: 0, USER: 0 };
  let count = 0;
  const walk = (path: string, node: unknown) => {
    if (isParamLike(node)) {
      count++;
      const e = validateParam(path, node);
      errors.push(...e);
      const tag = (node as { tag: ParamTag }).tag;
      if (tag in byTag) byTag[tag]++;
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(`${path}.${k}`, v);
    }
  };
  walk(file._meta.file, file.params);
  return { count, errors, byTag };
}
