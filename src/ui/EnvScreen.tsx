import { useEffect, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GH_PARAMS } from '../data';
import { DEVICES, type GhSetup } from '../engine';
import type { GhView } from '../sim/protocol';
import { session, type SessionView } from '../sim/session';
import { ControlPanel } from './ControlPanel';
import { DEVICE_LABEL, won } from './format';
import { SetupEditor } from './SetupEditor';

type Sub = 'now' | 'control' | 'setup' | 'outdoor';
const SUBS: [Sub, string][] = [['now', '현황'], ['control', '제어'], ['setup', '시설·장비'], ['outdoor', '외기 30일']];

const axis = { fontSize: 11, fill: 'var(--muted)' } as const;
const tip = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }, labelStyle: { color: 'var(--text)' } } as const;

export function Chart({ title, data, lines, domain, testId, short }: { title: string; data: Record<string, number | string>[]; lines: [key: string, color: string, dash?: string][]; domain?: [number | string, number | string]; testId?: string; short?: boolean }) {
  return (
    <section className="card" data-testid={testId}>
      <h2>{title}</h2>
      <div className={`chart ${short ? 'chart-short' : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tick={axis} domain={domain ?? ['auto', 'auto']} />
            <Tooltip trigger="click" {...tip} />
            {lines.map(([k, color, dash]) => (
              <Line key={k} type="monotone" dataKey={k} stroke={color} dot={false} strokeWidth={dash ? 1.5 : 2} strokeDasharray={dash} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function deviceInstalled(s: GhSetup, d: (typeof DEVICES)[number]): boolean {
  switch (d) {
    case 'vent':
      return s.sideVent || s.roofVent;
    case 'curtain':
      return s.curtainLayers > 0;
    case 'shade':
      return s.shade !== 'none';
    case 'circFan':
      return s.circFan;
    case 'fog':
      return s.fog;
    case 'heater':
      return s.heater !== 'none';
    case 'cooling':
      return s.cooling !== 'none';
    case 'co2':
      return s.co2 !== 'none';
    case 'light':
      return s.light !== 'none';
    case 'dehumidifier':
      return s.dehumidifier;
    case 'solutionChiller':
      return s.solutionChiller;
    case 'solutionHeater':
      return s.solutionHeater;
  }
}

function Now({ view, gh }: { view: SessionView; gh: GhView }) {
  const wx = view.wx!;
  const o = gh.out;
  const out = wx.now;
  const esOut = 0.6108 * Math.exp((17.27 * out.temp) / (out.temp + 237.3));
  const rows: [string, string, string][] = [
    ['기온', `${o.tIn.toFixed(1)}°C`, `${out.temp.toFixed(1)}°C`],
    ['상대습도', `${o.rhIn.toFixed(0)}%`, `${out.rh.toFixed(0)}%`],
    ['VPD', `${o.vpd.toFixed(2)} kPa`, `${(esOut * (1 - out.rh / 100)).toFixed(2)} kPa`],
    ['CO2', `${o.co2.toFixed(0)} ppm`, `${GH_PARAMS.phys.co2Outside} ppm`],
    ['광(PPFD)', `${o.ppfd.toFixed(0)} μmol`, `${(out.solarW * GH_PARAMS.phys.parFraction * GH_PARAMS.phys.parPhotonPerJoule).toFixed(0)} μmol`],
  ];
  const duty: Partial<Record<(typeof DEVICES)[number], string>> = {
    vent: `개도 ${(o.vent * 100).toFixed(0)}%`,
    curtain: o.curtain > 0.5 ? '닫힘' : '열림',
    shade: o.shade > 0.5 ? '펼침' : '걷힘',
    circFan: '가동',
    fog: o.fog > 0 ? `가동 ${(o.fog * 100).toFixed(0)}%` : '대기',
    heater: o.heat > 0 ? `가동 ${(o.heat * 100).toFixed(0)}% · ${o.heatW.toFixed(0)} W/m²` : '대기',
    cooling: o.cool > 0 ? `가동 ${(o.cool * 100).toFixed(0)}%` : '대기',
    co2: o.co2Dose > 0 ? `${o.co2Dose.toFixed(1)} g/m²/h` : '대기',
    light: o.light > 0 ? `점등 ${(o.light * 100).toFixed(0)}%` : '소등',
    dehumidifier: o.dehum > 0 ? `가동 ${(o.dehum * 100).toFixed(0)}%` : '대기',
    solutionChiller: `양액 ${o.tSolution.toFixed(1)}°C`,
    solutionHeater: `양액 ${o.tSolution.toFixed(1)}°C`,
  };
  const hours = view.hours.slice(-48);
  const data = hours.map((r) => ({ label: `${Math.floor(r.hour / 24) + 1}일 ${r.hour % 24}시`, 내부: +r.tIn.toFixed(1), 외부: +r.tOut.toFixed(1), '내부 ': +r.rhIn.toFixed(0), '외부 ': +r.rhOut.toFixed(0), VPD: +r.vpd.toFixed(2), CO2: +r.co2.toFixed(0), PPFD: +r.ppfd.toFixed(0), '외부 광': +(r.solarW * GH_PARAMS.phys.parFraction * GH_PARAMS.phys.parPhotonPerJoule).toFixed(0) }));
  const t = gh.today;

  return (
    <>
      {gh.destroyed && (
        <section className="card confirm" role="alert">
          <strong>시설이 눈 무게로 무너졌습니다.</strong>
          <p className="small">실내가 외기와 같아졌고 장비가 모두 멈췄습니다. "시설·장비"에서 다시 지어야 합니다.</p>
        </section>
      )}
      {gh.breached && !gh.destroyed && (
        <section className="card confirm" role="alert">
          <strong>강풍으로 피복이 찢어졌습니다.</strong>
          <p className="small">틈새 바람이 크게 늘었습니다.</p>
          <button type="button" className="btn btn-small" onClick={() => session.repairCover()}>
            피복 보수
          </button>
        </section>
      )}
      <section className="card" data-testid="inout-card">
        <h2>내부 vs 외부 (지난 1시간 평균)</h2>
        <table className="inout">
          <thead>
            <tr>
              <th />
              <th>내부</th>
              <th>외부</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, a, b]) => (
              <tr key={k}>
                <th>{k}</th>
                <td data-testid={`in-${k}`}>{a}</td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          엽온 {o.tLeaf.toFixed(1)}°C · 이슬점 {o.dewPoint.toFixed(1)}°C · 피복면 {o.tSurface.toFixed(1)}°C · 환기 {o.ach.toFixed(1)}회/h · 증산 {o.transpiration.toFixed(0)} g/m²/h
        </p>
        <p className="muted small">
          오늘: 실내 최저 {t.tMin < 90 ? t.tMin.toFixed(1) : '–'}° / 최고 {t.tMax > -90 ? t.tMax.toFixed(1) : '–'}° · DLI {t.dli.toFixed(1)} mol/m² · 피복 결로 {t.condensationH.toFixed(1)}h · 엽면 습윤 {t.leafWetH.toFixed(1)}h
          {t.heatDeficitH > 0 && <strong className="error"> · 난방 용량 부족 {t.heatDeficitH.toFixed(1)}h</strong>}
        </p>
        <p className="muted small">
          투과율 {(o.transmissivity * 100).toFixed(0)}% (먼지 −{(gh.dust * 100).toFixed(1)}%p{gh.roofSnow > 0.1 ? ` · 지붕 눈 ${gh.roofSnow.toFixed(0)} cm` : ''})
        </p>
      </section>

      <section className="card" data-testid="cost-card">
        <h2>오늘 누적 에너지 비용</h2>
        <p className="wx-main">
          <span className="metric-value" data-testid="cost-today">
            {won(t.won)}
          </span>
          <span className="muted small">작기 누적 {won(gh.total.won)}</span>
        </p>
        <p className="muted small">
          연료 {t.fuelL.toFixed(1)} L · 전력 {t.kWh.toFixed(1)} kWh · CO2 {t.co2Kg.toFixed(1)} kg · 계약전력 {gh.contractKw.toFixed(1)} kW
        </p>
      </section>

      <section className="card" data-testid="device-card">
        <h2>장비 상태</h2>
        <ul className="rows">
          {DEVICES.filter((d) => deviceInstalled(gh.setup, d)).map((d) => {
            const f = gh.failures[d];
            return (
              <li key={d}>
                <span>{DEVICE_LABEL[d]}</span>
                {f === 0 ? (
                  <span className="muted small nowrap">{duty[d]}</span>
                ) : f === -1 ? (
                  <button type="button" className="btn btn-small" data-repair={d} onClick={() => session.repair(d)}>
                    고장 — 수리 맡기기
                  </button>
                ) : (
                  <span className="badge badge-warn">수리 중 · {Math.max(0, f - view.hour)}시간 남음</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {data.length >= 2 ? (
        <>
          <Chart title="기온 (°C) — 최근 48시간" data={data} lines={[['내부', 'var(--hot)'], ['외부', 'var(--cold)', '4 3']]} testId="chart-in-temp" />
          <Chart title="상대습도 (%)" data={data} lines={[['내부 ', 'var(--accent)'], ['외부 ', 'var(--cold)', '4 3']]} domain={[0, 100]} short />
          <Chart title="VPD (kPa) — 내부" data={data} lines={[['VPD', 'var(--hot)']]} domain={[0, 'auto']} short />
          <Chart title="CO2 (ppm) — 내부" data={data} lines={[['CO2', 'var(--text)']]} short testId="chart-co2" />
          <Chart title="광 PPFD (μmol m⁻² s⁻¹)" data={data} lines={[['PPFD', 'var(--sun)'], ['외부 광', 'var(--cold)', '4 3']]} domain={[0, 'auto']} short />
          <p className="muted small">실선 = 내부, 점선 = 외부. 그래프를 누르면 그 시각 값이 나옵니다.</p>
        </>
      ) : (
        <section className="card">
          <p className="muted">몇 시간 지나면 내부 vs 외부 그래프가 그려집니다.</p>
        </section>
      )}
    </>
  );
}

function SetupTab({ gh }: { gh: GhView }) {
  const [draft, setDraft] = useState(gh.setup);
  const [confirm, setConfirm] = useState(false);
  const base = JSON.stringify(gh.setup);
  useEffect(() => setDraft(JSON.parse(base) as GhSetup), [base]);
  const dirty = JSON.stringify(draft) !== base;
  return (
    <>
      <section className="card">
        <h2>관리 작업</h2>
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => session.cleanCover()} disabled={gh.dust < 0.001}>
            피복 세척 (투과율 +{(gh.dust * 100).toFixed(1)}%p)
          </button>
        </div>
      </section>
      <section className="card">
        <h2>시설 · 장비 변경</h2>
        <SetupEditor value={draft} onChange={setDraft} />
      </section>
      {dirty && (
        <div className="apply-bar">
          {confirm ? (
            <>
              <span>시설·장비를 지금 시각부터 바꿀까요? 시설 유형을 바꾸면 새로 짓는 것으로 봅니다.</span>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    session.setSetup(draft);
                    setConfirm(false);
                  }}
                >
                  변경
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>
                  취소
                </button>
              </div>
            </>
          ) : (
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => setConfirm(true)}>
                변경 적용
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(JSON.parse(base) as GhSetup)}>
                되돌리기
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Outdoor({ view }: { view: SessionView }) {
  const rows = view.days.slice(-30).map((r) => ({
    label: `${r.wx.month + 1}/${r.wx.day}`,
    최고: +r.wx.tmax.toFixed(1),
    평균: +r.wx.tavg.toFixed(1),
    최저: +r.wx.tmin.toFixed(1),
    일사: +r.wx.solar.toFixed(1),
    강수: +r.wx.precip.toFixed(1),
    '실내 최저': r.gh ? +r.gh.tMin.toFixed(1) : (undefined as unknown as number),
    난방비: r.gh ? Math.round(r.gh.won / 1000) : 0,
  }));
  if (rows.length < 2)
    return (
      <section className="card">
        <p className="muted">하루가 지나면 그래프가 그려집니다. 위의 "다음 주"를 눌러 보세요.</p>
      </section>
    );
  return (
    <>
      <Chart title="기온 (°C) — 외기 일최고 · 평균 · 최저, 실내 최저" data={rows} lines={[['최고', 'var(--hot)'], ['평균', 'var(--text)', '4 3'], ['최저', 'var(--cold)'], ['실내 최저', 'var(--accent)']]} testId="chart-temp" />
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
      </section>
      <section className="card">
        <h2>일별 에너지 비용 (천 원)</h2>
        <div className="chart chart-short">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={axis} />
              <Tooltip trigger="click" {...tip} />
              <Bar dataKey="난방비" name="에너지 비용" fill="var(--hot)" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}

/** 환경 탭: 현황(내부 vs 외부) / 제어 설정 / 시설·장비 / 외기 30일. */
export function EnvScreen({ view }: { view: SessionView }) {
  const [sub, setSub] = useState<Sub>('now');
  const gh = view.wx?.gh;
  return (
    <>
      <header className="page-head">
        <h1>환경</h1>
        {gh && <span className="badge">{GH_PARAMS.facilities[gh.setup.facility].name} · {gh.setup.area.toLocaleString('ko-KR')} m²</span>}
      </header>
      <div className="subtabs" role="tablist">
        {SUBS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={sub === id} data-sub={id} onClick={() => setSub(id)}>
            {label}
          </button>
        ))}
      </div>
      {!gh || !view.wx ? (
        <p className="muted">불러오는 중…</p>
      ) : sub === 'now' ? (
        <Now view={view} gh={gh} />
      ) : sub === 'control' ? (
        <ControlPanel settings={gh.settings} setup={gh.setup} />
      ) : sub === 'setup' ? (
        <SetupTab gh={gh} />
      ) : (
        <Outdoor view={view} />
      )}
    </>
  );
}
