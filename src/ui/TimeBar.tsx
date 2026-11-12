import { ENGINE_DATA } from '../data';
import { SPEEDS } from '../sim/protocol';
import { session, type SessionView } from '../sim/session';
import { dateLabel, eventText } from './format';

const regionName = (id: string) => ENGINE_DATA.regions.stations.find((s) => s.id === id)?.name ?? id;

/** 상단 시간바: 날짜·시각·배속·일시정지·턴 버튼. 모든 탭에서 보인다. */
export function TimeBar({ view }: { view: SessionView }) {
  const save = view.save;
  if (!save || view.status !== 'ready') return null;
  const d = dateLabel(save.config, view.hour);
  const busy = view.advancing;
  return (
    <header className="timebar">
      <div className="timebar-top">
        <div className="timebar-date" data-testid="clock">
          <strong>
            {d.date} ({d.weekday}) {d.time}
          </strong>
          <span className="muted small">
            {regionName(save.config.regionId)} · {d.day}일차
          </span>
        </div>
        <div className="turns" role="group" aria-label="턴 진행">
          <button type="button" data-turn="1" disabled={busy} onClick={() => session.advance(1)}>
            +1시간
          </button>
          <button type="button" data-turn="24" disabled={busy} onClick={() => session.advance(24)}>
            다음 날
          </button>
          <button type="button" data-turn="168" disabled={busy} onClick={() => session.advance(168)}>
            다음 주
          </button>
        </div>
      </div>
      <div className="speeds" role="group" aria-label="배속(실제 1초당 게임 시간)">
        {SPEEDS.map((s) => (
          <button key={s.id} type="button" data-speed={s.id} aria-label={s.label} aria-pressed={!busy && view.hoursPerSecond === s.hoursPerSecond} onClick={() => session.setSpeed(s.hoursPerSecond)}>
            {s.short}
          </button>
        ))}
      </div>
      {view.pausedBy && (
        <div className="pause-banner" role="alert" data-testid="pause-banner">
          <div>
            <strong>자동 일시정지</strong>
            <ul>
              {view.pausedBy.map((e, i) => (
                <li key={i}>{eventText(e)}</li>
              ))}
            </ul>
          </div>
          <button type="button" className="btn btn-small" onClick={() => session.dismissPause()}>
            확인
          </button>
        </div>
      )}
    </header>
  );
}
