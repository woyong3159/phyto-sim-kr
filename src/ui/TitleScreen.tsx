import { NewGame } from './NewGame';

/** 작기가 하나도 없을 때의 첫 화면. */
export function TitleScreen() {
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
        <p className="muted small">v{__APP_VERSION__} · Phase 2 (시설·미기상·환경 제어)</p>
      </header>
      <NewGame />
    </>
  );
}
