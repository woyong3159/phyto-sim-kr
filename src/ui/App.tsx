import { useState, useSyncExternalStore } from 'react';
import { session } from '../sim/session';
import { usePwa } from '../pwa/usePwa';
import { TabBar, type TabId } from './tabs';
import { TitleScreen } from './TitleScreen';
import { MoreScreen } from './MoreScreen';
import { Placeholder } from './Placeholder';

export function App() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const view = useSyncExternalStore(session.subscribe, session.getView);
  const pwa = usePwa();

  return (
    <div className="app">
      {pwa.needRefresh && (
        <div className="update-banner" role="status">
          <span>새 버전이 준비됐습니다. 세이브는 그대로 유지됩니다.</span>
          <button type="button" className="btn btn-small" onClick={pwa.applyUpdate}>
            새 버전 적용
          </button>
        </div>
      )}
      <main className="screen" data-screen={tab}>
        <div className="screen-inner">
          {tab === 'dashboard' && <TitleScreen view={view} pwa={pwa} />}
          {tab === 'env' && (
            <Placeholder
              title="환경"
              phase="Phase 1"
              items={['기상(지역 평년값 + 편차)과 온실 안 온도·습도·CO2·광', '난방·환기·차광·보광·CO2 시비 설정값(setpoint)', '에너지·수분 수지와 연료·전기 사용량']}
            />
          )}
          {tab === 'rootzone' && (
            <Placeholder
              title="근권·양액"
              phase="Phase 4"
              items={['배지 함수율, 근권 EC/pH, 이온별 농도', '급액 처방(mmol/L)·관수 전략·배액률', '원수 성분과 양액 보정']}
            />
          )}
          {tab === 'crop' && (
            <Placeholder
              title="작물"
              phase="Phase 2–3"
              items={['건물 생산·분배, 엽면적지수(LAI), 착과와 과실 생장', '발육 단계(열시간)와 스트레스 원인 분석', '오이 → 딸기 → 와사비 순으로 추가']}
            />
          )}
          {tab === 'ipm' && (
            <Placeholder
              title="IPM"
              phase="Phase 6"
              items={['스카우팅(노동 시간·탐지 확률)과 병해충 밀도', '천적 방사·농약 살포·저항성 관리', '외부 유입 위험과 방역(biosecurity) 수준']}
            />
          )}
          {tab === 'more' && <MoreScreen view={view} />}
        </div>
      </main>
      <TabBar current={tab} onChange={setTab} />
    </div>
  );
}
