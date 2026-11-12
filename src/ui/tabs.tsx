import type { ReactNode } from 'react';

export type TabId = 'dashboard' | 'env' | 'rootzone' | 'crop' | 'ipm' | 'more';

const icon = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** 하단 탭바. 헌법의 7개 영역 중 장부·리포트는 "더보기"로 묶는다(390pt 폭에서 터치 영역 확보). */
export const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'dashboard', label: '대시보드', icon: icon(<><rect x="3.5" y="3.5" width="7" height="8" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.5" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.5" /><rect x="3.5" y="14.5" width="7" height="6" rx="1.5" /></>) },
  { id: 'env', label: '환경', icon: icon(<><path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0Z" /><path d="M12 9v7" /></>) },
  { id: 'rootzone', label: '근권·양액', icon: icon(<path d="M12 3.5c3 3.6 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0c0-3.400 2.500-6.400 5.500-10Z" />) },
  { id: 'crop', label: '작물', icon: icon(<><path d="M5 19c0-8 5-13 14-14 0 9-5 14-14 14Z" /><path d="M5 19c3-4 6-7 10-10" /></>) },
  { id: 'ipm', label: 'IPM', icon: icon(<><ellipse cx="12" cy="13.500" rx="4.500" ry="6" /><path d="M9.500 6.500 8 4.500M14.500 6.500 16 4.500M7.500 11H4M7.500 15H4.500M16.500 11H20M16.500 15h3M12 8v11.500" /></>) },
  { id: 'more', label: '더보기', icon: icon(<><circle cx="5.500" cy="12" r="1.300" /><circle cx="12" cy="12" r="1.300" /><circle cx="18.500" cy="12" r="1.300" /></>) },
];

export function TabBar({ current, onChange }: { current: TabId; onChange: (id: TabId) => void }) {
  return (
    <nav className="tabbar" aria-label="주 메뉴">
      {TABS.map((t) => (
        <button key={t.id} type="button" className="tab" aria-current={current === t.id ? 'page' : undefined} onClick={() => onChange(t.id)} data-tab={t.id}>
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
