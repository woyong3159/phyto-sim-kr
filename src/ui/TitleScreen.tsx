import { calendarAt } from '../engine';
import { SPEEDS } from '../sim/protocol';
import { session, type SessionView } from '../sim/session';
import type { PwaStatus } from '../pwa/usePwa';
import { SAVE_SCHEMA_VERSION } from '../storage/schema';

const CROPS = [
  { name: '오이', en: 'Cucumber', phase: 'Phase 2' },
  { name: '딸기', en: 'Strawberry', phase: 'Phase 3a' },
  { name: '와사비', en: 'Wasabi', phase: 'Phase 3b' },
];

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

export function TitleScreen({ view, pwa }: { view: SessionView; pwa: PwaStatus }) {
  const cal = view.save ? calendarAt(view.save.config, view.hour) : null;
  const standalone = isStandalone();
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <>
      <header className="hero">
        <svg className="hero-logo" viewBox="0 0 64 64" aria-hidden="true">
          <rect width="64" height="64" rx="14" fill="var(--accent-strong)" />
          <path d="M16 48c0-18 11-29 32-32 0 21-11 32-32 32Z" fill="#eafff3" />
          <path d="M16 48c7-9 14-16 23-23" stroke="var(--accent-strong)" strokeWidth="3" strokeLinecap="round" fill="none" />
        </svg>
        <h1>PHYTO-SIM KR</h1>
        <p className="hero-sub">대한민국 시설재배 작물 생육 시뮬레이터</p>
        <p className="muted small">
          v{__APP_VERSION__} · Phase 0 (뼈대)
        </p>
      </header>

      <section className="card" aria-labelledby="crops-h">
        <h2 id="crops-h">작물 (v1)</h2>
        <ul className="crop-row">
          {CROPS.map((c) => (
            <li key={c.en} className="crop-chip">
              <strong>{c.name}</strong>
              <span className="muted small">{c.en}</span>
              <span className="badge">{c.phase}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="clock-h">
        <h2 id="clock-h">엔진 시계 시험</h2>
        {view.status === 'error' && <p className="error">문제가 생겼습니다: {view.error}</p>}
        {view.status === 'loading' && <p className="muted">불러오는 중…</p>}
        {view.status === 'ready' && cal && (
          <>
            <p className="clock" data-testid="clock">
              <span className="clock-date">
                {cal.year}.{pad(cal.month)}.{pad(cal.day)} {pad(cal.hourOfDay)}:00
              </span>
              <span className="muted">작기 {cal.dayIndex + 1}일차</span>
            </p>
            <div className="segmented" role="group" aria-label="배속">
              {SPEEDS.map((s) => (
                <button key={s.id} type="button" data-speed={s.id} aria-pressed={view.hoursPerSecond === s.hoursPerSecond} onClick={() => session.setSpeed(s.hoursPerSecond)}>
                  {s.label}
                </button>
              ))}
            </div>
            <p className="muted small">
              지금은 날짜만 흐릅니다. 앱을 닫거나 다른 앱으로 가면 자동 저장 후 멈추고, 다시 열면 그 시각부터 이어집니다.
              {view.resumedFromHour !== null && ` (이번에는 저장된 ${Math.floor(view.resumedFromHour / 24) + 1}일차에서 이어 열었습니다.)`}
            </p>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="sys-h">
        <h2 id="sys-h">시스템 점검</h2>
        <ul className="checks">
          <Check ok={view.status === 'ready' ? true : view.status === 'error' ? false : null} label="시뮬레이션 엔진" detail={view.status === 'ready' ? '별도 스레드(Web Worker)에서 실행 중' : view.status === 'error' ? '시작 실패' : '시작하는 중'} />
          <Check
            ok={view.status === 'ready' ? (view.persisted === false ? false : true) : null}
            label="기기 저장소"
            detail={
              view.persisted === true
                ? `영구 저장 허용됨 · 세이브 스키마 v${SAVE_SCHEMA_VERSION}`
                : view.persisted === false
                  ? '저장은 되지만 영구 보장은 아직 아님 — 홈 화면에 추가하면 안전해집니다'
                  : `세이브 스키마 v${SAVE_SCHEMA_VERSION}`
            }
          />
          <Check ok={__SINGLE_FILE__ ? null : pwa.offlineReady} label="오프라인 실행" detail={__SINGLE_FILE__ ? '단일 파일 빌드(항상 오프라인)' : pwa.offlineReady ? '인터넷 없이 열 수 있습니다' : '준비 중 — 잠시 뒤 다시 확인'} />
          <Check ok={standalone ? true : null} label="홈 화면 앱" detail={standalone ? '전체화면 앱으로 실행 중' : '사파리 → 공유 → "홈 화면에 추가"로 설치'} />
        </ul>
      </section>
    </>
  );
}
