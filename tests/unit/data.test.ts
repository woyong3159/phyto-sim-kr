import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateDataFile, validateParam, type DataFile } from '../../src/engine/params';

const dataDir = join(__dirname, '../../data');
const EXPECTED = ['biocontrol', 'biosecurity', 'channels', 'climate', 'crops', 'diseases', 'disorders', 'equipment', 'events', 'facilities', 'fertilizers', 'labor', 'land', 'pests', 'pesticides', 'pgr', 'policy_finance', 'prices', 'regions', 'rootzone', 'varieties', 'viruses', 'water_sources'];

describe('/data — 파라미터 외부화(N5)와 태그 프로토콜(8항)', () => {
  it('헌법 5항의 20개 데이터 파일 + 근권(rootzone)·생리장해(disorders)·노동(labor)이 모두 있다', () => {
    const files = readdirSync(dataDir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort();
    expect(files).toEqual([...EXPECTED].sort());
  });

  it('모든 데이터 파일의 모든 파라미터가 태그 형식을 지킨다', () => {
    for (const name of EXPECTED) {
      const file = JSON.parse(readFileSync(join(dataDir, `${name}.json`), 'utf8')) as DataFile;
      expect(file._meta.file).toBe(name);
      expect(validateDataFile(file).errors).toEqual([]);
    }
  });

  it('검사기가 올바른 파라미터는 통과시키고 잘못된 것은 잡아낸다', () => {
    const good = { value: 5, unit: '°C', range: [0, 10], tag: 'EST', source: '', note: '검사기 시험용 가상 값' };
    expect(validateParam('p', good)).toEqual([]);
    expect(validateParam('p', { ...good, value: 11 }).length).toBe(1);
    expect(validateParam('p', { ...good, tag: 'GUESS' }).length).toBe(1);
    expect(validateParam('p', { ...good, note: '' }).length).toBe(1);
    expect(validateParam('p', { ...good, tag: 'SRC', source: '' }).length).toBe(1);
    expect(validateParam('p', { ...good, range: [10, 0] }).length).toBe(1);
    expect(validateParam('p', 3).length).toBe(1);
  });

  it('중첩된 파라미터를 세고 태그별로 집계한다', () => {
    const file: DataFile = {
      _meta: { file: 't', title: '', plannedPhase: 0, schemaVersion: 1 },
      params: {
        a: { value: 1, unit: '-', range: [0, 2], tag: 'SRC', source: '시험', note: '' },
        g: { b: { value: 1, unit: '-', range: [0, 2], tag: 'EST', source: '', note: '시험' } },
      },
    };
    const r = validateDataFile(file);
    expect(r.count).toBe(2);
    expect(r.byTag).toMatchObject({ SRC: 1, EST: 1 });
    expect(r.errors).toEqual([]);
  });
});
