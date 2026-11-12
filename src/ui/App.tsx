import { useState, useSyncExternalStore } from 'react';
import { session } from '../sim/session';
import { usePwa } from '../pwa/usePwa';
import { TabBar, type TabId } from './tabs';
import { TitleScreen } from './TitleScreen';
import { Dashboard } from './Dashboard';
import { EnvScreen } from './EnvScreen';
import { MoreScreen } from './MoreScreen';
import { Placeholder } from './Placeholder';
import { TimeBar } from './TimeBar';

export function App() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const view = useSyncExternalStore(session.subscribe, session.getView);
  const pwa = usePwa();
  const hasGame = view.status === 'ready' || (view.status === 'loading' && !!view.save);

  return (
    <div className={`app ${hasGame ? 'has-timebar' : ''}`}>
      {pwa.needRefresh && (
        <div className="update-banner" role="status">
          <span>새 버전이 준비됐습니다. 세이브는 그대로 유지됩니다.</span>
          <button type="button" className="btn btn-small" onClick={pwa.applyUpdate}>
            새 버전 적용
          </button>
        </div>
      )}
      <TimeBar view={view} />
      <main className="screen" data-screen={tab}>
        <div className="screen-inner">
          {view.status === 'error' && (
            <section className="card">
              <p className="error">문제가 생겼습니다: {view.error}</p>
              <p className="muted small">세이브는 지워지지 않았습니다. 더보기에서 다른 작기를 열거나 새 작기를 시작할 수 있습니다.</p>
            </section>
          )}
          {tab === 'dashboard' && (view.status === 'nosave' ? <TitleScreen /> : view.status === 'loading' ? <p className="muted">불러오는 중…</p> : <Dashboard view={view} />)}
          {tab === 'env' && <EnvScreen view={view} />}
          {tab === 'rootzone' && <Placeholder title="근권·양액" phase="이후 Phase" items={['배지 함수율, 근권 EC/pH, 이온별 농도', '급액 처방(mmol/L)·관수 전략·배액률', '원수 성분과 양액 보정']} />}
          {tab === 'crop' && <Placeholder title="작물" phase="이후 Phase" items={['건물 생산·분배, 엽면적지수(LAI), 착과와 과실 생장', '발육 단계(열시간)와 스트레스 원인 분석', '오이 · 딸기 · 와사비']} />}
          {tab === 'ipm' && <Placeholder title="IPM" phase="이후 Phase" items={['스카우팅(노동 시간·탐지 확률)과 병해충 밀도', '천적 방사·농약 살포·저항성 관리', '외부 유입 위험과 방역(biosecurity) 수준']} />}
          {tab === 'more' && <MoreScreen view={view} pwa={pwa} />}
        </div>
      </main>
      <TabBar current={tab} onChange={setTab} />
    </div>
  );
}
