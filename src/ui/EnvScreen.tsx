import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SessionView } from '../sim/session';

/** 환경 탭(Phase 1): 최근 30일 외기 그래프. 온실 안 환경은 다음 Phase. */
export function EnvScreen({ view }: { view: SessionView }) {
  const days = view.days.slice(-30);
  const rows = days.map((d) => ({
    label: `${d.month + 1}/${d.day}`,
    최고: +d.tmax.toFixed(1),
    평균: +d.tavg.toFixed(1),
    최저: +d.tmin.toFixed(1),
    일사: +d.solar.toFixed(1),
    강수: +d.precip.toFixed(1),
    습도: +d.rh.toFixed(0),
  }));
  const axis = { fontSize: 11, fill: 'var(--muted)' } as const;
  const tip = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }, labelStyle: { color: 'var(--text)' } } as const;

  return (
    <>
      <header className="page-head">
        <h1>환경</h1>
        <span className="badge">외기 · 최근 {rows.length}일</span>
      </header>
      {rows.length < 2 ? (
        <section className="card">
          <p className="muted">하루가 지나면 그래프가 그려집니다. 위의 "다음 주"를 눌러 보세요.</p>
        </section>
      ) : (
        <>
          <section className="card" data-testid="chart-temp">
            <h2>기온 (°C) — 일최고 · 평균 · 최저</h2>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={axis} domain={['auto', 'auto']} />
                  <Tooltip trigger="click" {...tip} />
                  <Line type="monotone" dataKey="최고" stroke="var(--hot)" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line type="monotone" dataKey="평균" stroke="var(--text)" dot={false} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
                  <Line type="monotone" dataKey="최저" stroke="var(--cold)" dot={false} strokeWidth={2} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card" data-testid="chart-solar">
            <h2>일사 (MJ m⁻² d⁻¹) · 강수 (mm)</h2>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 6, right: -18, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis yAxisId="s" tick={axis} domain={[0, 32]} />
                  <YAxis yAxisId="p" orientation="right" tick={axis} domain={[0, (max: number) => Math.max(40, Math.ceil(max / 20) * 20)]} />
                  <Tooltip trigger="click" {...tip} />
                  <Bar yAxisId="p" dataKey="강수" fill="var(--rain)" isAnimationActive={false} />
                  <Line yAxisId="s" type="monotone" dataKey="일사" stroke="var(--sun)" dot={false} strokeWidth={2} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="muted small">그래프를 누르면 그날 값이 나옵니다. 비 오는 날(파란 막대)에 일사(노란 선)가 떨어지는지 보세요.</p>
          </section>
          <section className="card" data-testid="chart-rh">
            <h2>일평균 상대습도 (%)</h2>
            <div className="chart chart-short">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={axis} domain={[20, 100]} />
                  <Tooltip trigger="click" {...tip} />
                  <Line type="monotone" dataKey="습도" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
      <section className="card">
        <h2>다음 Phase에 들어올 내용</h2>
        <p className="muted small">온실 안 온도·습도·CO2·광, 난방·환기·차광·보광 설정값(setpoint), 에너지·수분 수지.</p>
      </section>
    </>
  );
}
