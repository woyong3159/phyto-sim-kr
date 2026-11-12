import { useEffect, useRef, useState } from 'react';
import { ENGINE_DATA } from '../data';
import { ALL_MODULES, EVENT_TYPES } from '../engine';
import type { PwaStatus } from '../pwa/usePwa';
import { isAutoPauseOn, session, type SessionView } from '../sim/session';
import { SAVE_SCHEMA_VERSION, type SaveRecord } from '../storage/schema';
import { EVENT_LABEL } from './format';
import { NewGame } from './NewGame';

const regionName = (id: string) => ENGINE_DATA.regions.stations.find((s) => s.id === id)?.name ?? id;

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  const mark = ok === null ? '–' : ok ? '✓' : '!';
  const cls = ok === null ? 'neutral' : ok ? 'ok' : 'warn';
  return (
    <li className="check">
      <span className={`check-mark ${cls}`} aria-hidden="true">
        {mark}
      </span>
      <span className="check-text">
        <strong>{label}</strong>
        <span className="muted small">{detail}</span>
      </span>
    </li>
  );
}

export function MoreScreen({ view, pwa }: { view: SessionView; pwa: PwaStatus }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmImport, setConfirmImport] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [saves, setSaves] = useState<SaveRecord[]>([]);
  const standalone = isStandalone();

  useEffect(() => {
    void session.listSaves().then(setSaves);
  }, [view.save?.id, view.lastSavedAt]);

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

  if (creating) {
    return (
      <>
        <header className="page-head">
          <h1>새 작기</h1>
        </header>
        <NewGame onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <h1>더보기</h1>
      </header>

      <section className="card">
        <h2>작기</h2>
        {view.save && (
          <p className="muted small">
            현재: {view.save.name} · {regionName(view.save.config.regionId)} · {Math.floor(view.hour / 24) + 1}일차 · seed {view.save.config.seed}
          </p>
        )}
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => setCreating(true)} data-testid="new-game">
            새 작기
          </button>
          <button type="button" className="btn btn-ghost" onClick={doExport} disabled={view.status !== 'ready'}>
            내보내기
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
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
        {saves.length > 1 && (
          <ul className="rows">
            {saves.map((s) => (
              <li key={s.id}>
                <span>
                  {s.name}{' '}
                  <span className="muted small">
                    {regionName(s.config.regionId)} · {Math.floor(s.hour / 24) + 1}일차
                  </span>
                </span>
                {s.id === view.save?.id ? (
                  <span className="badge badge-ok">진행 중</span>
                ) : (
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => void session.loadSave(s.id)}>
                    열기
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">아이폰에서 내보내기를 누르면 공유 시트가 열립니다. "파일에 저장"이나 에어드롭을 고르면 됩니다.</p>
      </section>

      {view.save && (
        <section className="card" aria-labelledby="ap-h">
          <h2 id="ap-h">자동 일시정지</h2>
          <p className="muted small">켜 둔 사건이 생기면 배속·턴 진행이 그 시각에 멈춥니다.</p>
          <ul className="rows">
            {EVENT_TYPES.map((t) => {
              const meta = EVENT_LABEL[t];
              const on = isAutoPauseOn(view.save, t);
              return (
                <li key={t}>
                  <span>
                    {meta.name} {meta.fromPhase > 1 && <span className="muted small">Phase {meta.fromPhase}부터 발생</span>}
                  </span>
                  <button type="button" role="switch" aria-checked={on} aria-label={`${meta.name} 자동 일시정지`} data-autopause={t} className="switch" onClick={() => session.setAutoPause(t, !on)}>
                    <span />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="sys-h">
        <h2 id="sys-h">시스템 점검</h2>
        <ul className="checks">
          <Check ok={view.status === 'ready' ? true : view.status === 'error' ? false : null} label="시뮬레이션 엔진" detail={view.status === 'ready' ? '별도 스레드(Web Worker)에서 실행 중' : view.status === 'error' ? `오류: ${view.error}` : '작기를 시작하면 켜집니다'} />
          <Check
            ok={view.persisted === false ? false : view.persisted}
            label="기기 저장소"
            detail={view.persisted === true ? `영구 저장 허용됨 · 세이브 스키마 v${SAVE_SCHEMA_VERSION}` : view.persisted === false ? '저장은 되지만 영구 보장은 아직 아님 — 홈 화면에 추가하면 안전해집니다' : `세이브 스키마 v${SAVE_SCHEMA_VERSION}`}
          />
          <Check ok={__SINGLE_FILE__ ? null : pwa.offlineReady} label="오프라인 실행" detail={__SINGLE_FILE__ ? '단일 파일 빌드(항상 오프라인)' : pwa.offlineReady ? '인터넷 없이 열 수 있습니다' : '준비 중 — 잠시 뒤 다시 확인'} />
          <Check ok={standalone ? true : null} label="홈 화면 앱" detail={standalone ? '전체화면 앱으로 실행 중' : '사파리 → 공유 → "홈 화면에 추가"로 설치'} />
        </ul>
      </section>

      <section className="card">
        <h2>엔진 모듈 현황</h2>
        <ul className="rows">
          {ALL_MODULES.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.id}</strong> <span className="muted small">{m.title}</span>
              </span>
              <span className={`badge ${m.implemented ? 'badge-ok' : ''}`}>{m.implemented ? '구현됨' : '예정'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>앱 정보</h2>
        <p className="muted small">
          PHYTO-SIM KR v{__APP_VERSION__} · 세이브 스키마 v{SAVE_SCHEMA_VERSION} · 지역 {ENGINE_DATA.regions.stations.length}곳
          {__SINGLE_FILE__ ? ' · 단일 파일 빌드' : ''}
        </p>
      </section>
    </>
  );
}
