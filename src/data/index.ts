/**
 * /data/*.json 로더. 빌드 시 앱에 함께 묶이므로 오프라인에서도 쓸 수 있다.
 * 엔진은 이 파일을 직접 import하지 않고, 실행기가 데이터를 인자로 넘겨준다(N6).
 */
import type { EngineData } from '../engine';
import type { DataFile } from '../engine/params';

const modules = import.meta.glob<DataFile>('../../data/*.json', { eager: true, import: 'default' });

export const DATA: Record<string, DataFile> = Object.fromEntries(Object.values(modules).map((m) => [m._meta.file, m]));

export const ENGINE_DATA: EngineData = {
  regions: DATA.regions!.params as unknown as EngineData['regions'],
  climate: DATA.climate!.params as unknown as EngineData['climate'],
  events: DATA.events!.params as unknown as EngineData['events'],
};
