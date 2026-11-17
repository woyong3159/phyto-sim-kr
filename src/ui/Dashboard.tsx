import type { SessionView } from '../sim/session';
import { clock, dateLabel, eventText, hoursMinutes, won } from './format';

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

      <section className="card" aria-labelledby="gh-h" data-testid="indoor-card">
        <div className="card-head">
          <h2 id="gh-h">온실 안</h2>
          {wx.gh.destroyed ? <span className="badge badge-warn">붕괴</span> : wx.gh.out.heat > 0 ? <span className="badge">난방 중</span> : wx.gh.out.vent > 0.02 ? <span className="badge">환기 {(wx.gh.out.vent * 100).toFixed(0)}%</span> : null}
        </div>
        <div className="metrics">
          <Metric label="기온" value={wx.gh.out.tIn.toFixed(1)} unit="°C" sub={`외기 ${now.temp.toFixed(1)}°C`} />
          <Metric label="상대습도 · VPD" value={wx.gh.out.rhIn.toFixed(0)} unit="%" sub={`VPD ${wx.gh.out.vpd.toFixed(2)} kPa`} />
          <Metric label="CO2" value={wx.gh.out.co2.toFixed(0)} unit="ppm" />
          <Metric label="광(PPFD)" value={wx.gh.out.ppfd.toFixed(0)} unit="μmol" sub={`오늘 DLI ${wx.gh.today.dli.toFixed(1)} mol`} />
        </div>
        <p className="muted small">
          오늘 에너지 비용 {won(wx.gh.today.won)} · 연료 {wx.gh.today.fuelL.toFixed(0)} L · 전력 {wx.gh.today.kWh.toFixed(0)} kWh
          {wx.gh.today.heatDeficitH > 0 && <strong className="error"> · 난방 용량 부족 {wx.gh.today.heatDeficitH.toFixed(1)}h</strong>}
        </p>
      </section>

      <section className="card" aria-labelledby="ev-h">
        <h2 id="ev-h">최근 사건</h2>
        {view.eventLog.length === 0 ? (
          <p className="muted small">아직 없습니다. 기상 특보, 장비 고장, 시설 파손이 생기면 여기에 쌓입니다.</p>
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
        <p className="muted small">작물·양액·병해충은 다음 Phase부터 들어옵니다. 지금 온실 안의 증산과 CO2 흡수는 시험용 군락(엽면적지수 고정)으로 계산합니다.</p>
      </section>
    </>
  );
}
