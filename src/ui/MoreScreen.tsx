import { useRef, useState } from 'react';
import { ALL_MODULES } from '../engine';
import { session, type SessionView } from '../sim/session';
import { SAVE_SCHEMA_VERSION } from '../storage/schema';

export function MoreScreen({ view }: { view: SessionView }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmImport, setConfirmImport] = useState<File | null>(null);

  const doExport = async () => {
    try {
      const r = await session.exportCurrent();
      setMsg(r === 'shared' ? '공유 시트로 내보냈습니다.' : r === 'downloaded' ? '파일로 내려받았습니다.' : null);
    } catch (e) {
      setMsg(`내보내기 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const doImport = async (file: File) => {
    setConfirmImport(null);
    try {
      await session.importFile(file);
      setMsg('세이브를 불러왔습니다. 이전 세이브도 기기에 그대로 남아 있습니다.');
    } catch (e) {
      setMsg(`불러오기 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <>
      <header className="page-head">
        <h1>더보기</h1>
      </header>

      <section className="card">
        <h2>준비 중인 화면</h2>
        <ul className="rows">
          <li>
            <span>장부</span>
            <span className="badge">Phase 7 예정</span>
          </li>
          <li>
            <span>리포트 · 반사실 분석 · A/B 실험</span>
            <span className="badge">Phase 8 예정</span>
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>세이브</h2>
        {view.save && (
          <p className="muted small">
            현재: {view.save.name} · {Math.floor(view.hour / 24) + 1}일차 · seed {view.save.config.seed}
          </p>
        )}
        <div className="btn-row">
          <button type="button" className="btn" onClick={doExport} disabled={view.status !== 'ready'}>
            내보내기
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={view.status !== 'ready'}>
            불러오기
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".gz,.physim,application/gzip,application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setConfirmImport(f);
          }}
        />
        {confirmImport && (
          <div className="confirm" role="alertdialog" aria-label="불러오기 확인">
            <p>
              <strong>{confirmImport.name}</strong> 을(를) 불러와 현재 작기로 열까요? 지금 작기는 지워지지 않습니다.
            </p>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => void doImport(confirmImport)}>
                불러오기
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmImport(null)}>
                취소
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p className="small" role="status">
            {msg}
          </p>
        )}
        <p className="muted small">아이폰에서는 공유 시트가 열립니다. "파일에 저장"이나 에어드롭을 고르면 됩니다.</p>
      </section>

      <section className="card">
        <h2>엔진 모듈 현황</h2>
        <ul className="rows">
          {ALL_MODULES.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.id}</strong> <span className="muted small">{m.title}</span>
              </span>
              <span className={`badge ${m.implemented ? 'badge-ok' : ''}`}>{m.implemented ? '구현됨' : `Phase ${m.plannedPhase}`}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>앱 정보</h2>
        <p className="muted small">
          PHYTO-SIM KR v{__APP_VERSION__} · 세이브 스키마 v{SAVE_SCHEMA_VERSION}
          {__SINGLE_FILE__ ? ' · 단일 파일 빌드' : ''}
        </p>
      </section>
    </>
  );
}
