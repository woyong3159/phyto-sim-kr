/**
 * 세이브 내보내기/불러오기: 압축(gzip) JSON 파일.
 * 아이폰: 공유 시트(Web Share API)로 파일 앱·에어드롭에 저장. 미지원이면 다운로드.
 */
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { EXPORT_FORMAT, SAVE_SCHEMA_VERSION, migrateSave, validateSave, type ExportBundle, type SaveRecord, type SnapshotRecord } from './schema';

export function encodeBundle(save: SaveRecord, snapshots: SnapshotRecord[], exportedAt: number): Uint8Array {
  const bundle: ExportBundle = { format: EXPORT_FORMAT, schemaVersion: SAVE_SCHEMA_VERSION, exportedAt, save, snapshots };
  return gzipSync(strToU8(JSON.stringify(bundle)), { mtime: 0 });
}

export function decodeBundle(bytes: Uint8Array): { save: SaveRecord; snapshots: SnapshotRecord[] } {
  let text: string;
  try {
    // gzip 매직 넘버(1f 8b)면 압축 해제, 아니면 일반 JSON으로 본다.
    text = bytes[0] === 0x1f && bytes[1] === 0x8b ? strFromU8(gunzipSync(bytes)) : strFromU8(bytes);
  } catch {
    throw new Error('파일을 읽을 수 없습니다(압축 손상).');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('PHYTO-SIM 세이브 파일이 아닙니다.');
  }
  const b = parsed as Partial<ExportBundle>;
  if (!b || b.format !== EXPORT_FORMAT || !b.save) throw new Error('PHYTO-SIM 세이브 파일이 아닙니다.');
  const save = migrateSave(b.save);
  const errs = validateSave(save);
  if (errs.length) throw new Error(`세이브 내용 오류: ${errs.join(', ')}`);
  const snapshots = Array.isArray(b.snapshots) ? b.snapshots.filter((s) => s && s.saveId === save.id) : [];
  return { save, snapshots };
}

export function exportFileName(save: SaveRecord): string {
  const safe = save.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 30) || 'save';
  return `phyto-sim_${safe}_d${Math.floor(save.hour / 24)}.physim.gz`;
}

/** 브라우저 전용: 공유 시트 → 실패 시 다운로드. */
export async function shareOrDownload(bytes: Uint8Array, fileName: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blobPart = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const file = new File([blobPart], fileName, { type: 'application/gzip' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'PHYTO-SIM KR 세이브' });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // 그 밖의 실패는 다운로드로 대체
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
