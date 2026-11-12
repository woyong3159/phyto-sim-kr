import type { SessionView } from '../sim/session';
import { clock, dateLabel, eventText, hoursMinutes } from './format';

function Metric({ label, value, unit, sub }: { label: string; value: string; unit: string; sub?: string }) {
  return (
    <div className="metric">
      <span className="muted small">{label}</span>
      <span className="metric-value">
        {value}
        <span className="metric-unit">{unit}</span>
      </span>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

export function Dashboard({ view }: { view: SessionView }) {
  const wx = view.wx;
  const save = view.save;
  if (!wx || !save) return <p className="muted">불러오는 중…</p>;
  const { now, today } = wx;
  const tags: string[] = [];
  if (today.jangma) tags.push('장마 기간');
  if (today.typhoon) tags.push('태풍 영향');
  if (today.snowCm >= 0.5) tags.push(`눈 ${today.snowCm.toFixed(0)} cm`);
  if (today.hail) tags.push('우박');
  const sky = now.precip > 0 ? (today.snowCm >= 0.5 ? '눈' : '비') : now.sinElev <= 0 ? '밤' : today.wet ? '흐림' : '맑음';

  return (
    <>
      <section className="card" aria-labelledby="wx-h" data-testid="outdoor-card">
        <div className="card-head">
          <h2 id="wx-h">오늘의 외기</h2>
          <span className="badge">{sky}</span>
        </div>
        <div className="wx-main">
          <span className="wx-temp" data-testid="temp-now">
            {now.temp.toFixed(1)}
            <span className="metric-unit">°C</span>
          </span>
          <span className="muted">
            오늘 최고 {today.tmax.toFixed(1)}° / 최저 {today.tmin.toFixed(1)}°
          </span>
        </div>
        <div className="metrics">
          <Metric label="상대습도" value={now.rh.toFixed(0)} unit="%" sub={`일평균 ${today.rh.toFixed(0)}%`} />
          <Metric label="일사" value={now.solarW.toFixed(0)} unit="W/m²" sub={`오늘 ${today.solar.toFixed(1)} MJ/m²`} />
          <Metric label="풍속" value={now.wind.toFixed(1)} unit="m/s" sub={`순간 최대 ${today.gust.toFixed(0)} m/s`} />
          <Metric label="강수" value={now.precip.toFixed(1)} unit="mm/h" sub={`오늘 ${today.precip.toFixed(1)} mm`} />
        </div>
        <p className="muted small">
          일출 {clock(wx.sunrise)} · 일몰 {clock(wx.sunset)} · 일장(daylength) {hoursMinutes(wx.daylength)}
        </p>
        {tags.length > 0 && (
          <div className="tags">
            {tags.map((t) => (
              <span key={t} className="badge badge-warn">
                {t}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="ev-h">
        <h2 id="ev-h">최근 기상 사건</h2>
        {view.eventLog.length === 0 ? (
          <p className="muted small">아직 없습니다. 폭염·한파·장마·태풍·호우·대설·우박이 생기면 여기에 쌓입니다.</p>
        ) : (
          <ul className="rows">
            {view.eventLog.slice(0, 8).map((e, i) => {
              const d = dateLabel(save.config, e.hour);
              return (
                <li key={i}>
                  <span>{eventText(e)}</span>
                  <span className="muted small nowrap">{d.date.slice(5)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>아직 없는 것</h2>
        <p className="muted small">온실·작물·양액·병해충은 다음 Phase부터 들어옵니다. 지금은 바깥 날씨와 시계만 실제로 계산됩니다.</p>
      </section>
    </>
  );
}
