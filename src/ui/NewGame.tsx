import { useMemo, useState } from 'react';
import { ENGINE_DATA } from '../data';
import { defaultSettings, defaultSetup, sunDay, MONTH_DAYS, type GhSetup, type PlantOrder } from '../engine';
import { CROPS, OrderEditor, defaultOrderUi } from './CropScreen';
import { Num, Toggle } from './Num';
import { SetupEditor } from './SetupEditor';
import { session, todayKst } from '../sim/session';

const stations = ENGINE_DATA.regions.stations;
const normalsOf = (id: string) => ENGINE_DATA.climate.normals[id]!;
const GROUPS = ['수도권', '강원 영서', '강원 고랭지', '강원 영동', '충청', '호남', '영남', '제주'];
const CLASS_LABEL: Record<string, string> = { inland: '내륙', coastal: '해안', highland: '고랭지', island: '섬' };

/** 일조시간 평년값 → 월별 일평균 일사(MJ/m²/d). 엔진과 같은 Ångström 식. */
function monthlySolar(id: string): number[] {
  const st = stations.find((s) => s.id === id)!;
  const g = ENGINE_DATA.climate.generator as Record<string, { value: number }>;
  const a = g.angstromA!.value;
  const b = g.angstromB!.value;
  const sun = normalsOf(id).SUN.values;
  const out: number[] = [];
  let doy = 1;
  for (let m = 0; m < 12; m++) {
    let s = 0;
    for (let d = 0; d < MONTH_DAYS[m]!; d++, doy++) {
      const sd = sunDay(st.lat.value, st.lon.value, doy);
      s += (a + b * Math.min(1, sun[m]! / MONTH_DAYS[m]! / sd.possibleSunshine)) * sd.ra;
    }
    out.push(s / MONTH_DAYS[m]!);
  }
  return out;
}

/** 월별 기온(최고·최저 띠 + 평균선)과 일사(막대) 미니 그래프. */
function ClimateSpark({ id }: { id: string }) {
  const n = normalsOf(id);
  const solar = useMemo(() => monthlySolar(id), [id]);
  const W = 320;
  const H = 120;
  const x = (m: number) => 14 + (m * (W - 28)) / 11;
  const tLo = -15;
  const tHi = 35;
  const y = (t: number) => 8 + ((tHi - t) / (tHi - tLo)) * (H - 28);
  const band = [...n.TMAX.values.map((v, m) => `${x(m)},${y(v)}`), ...n.TMIN.values.map((v, m) => `${x(m)},${y(v)}`).reverse()].join(' ');
  const line = n.TAVG.values.map((v, m) => `${x(m)},${y(v)}`).join(' ');
  const sMax = 25;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label="월별 기온과 일사 그래프">
      {solar.map((v, m) => {
        const h = (v / sMax) * (H - 28);
        return <rect key={m} x={x(m) - 8} y={H - 20 - h} width={16} height={h} rx={2} fill="var(--sun)" opacity={0.35} />;
      })}
      <line x1={8} x2={W - 8} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeDasharray="3 3" />
      <polygon points={band} fill="var(--hot)" opacity={0.18} />
      <polyline points={line} fill="none" stroke="var(--hot)" strokeWidth={2} />
      {[0, 2, 4, 6, 8, 10].map((m) => (
        <text key={m} x={x(m)} y={H - 5} textAnchor="middle" fontSize={11} fill="var(--muted)">
          {m + 1}월
        </text>
      ))}
      <text x={10} y={y(0) - 3} fontSize={10} fill="var(--muted)">
        0°C
      </text>
    </svg>
  );
}

function RegionCard({ id }: { id: string }) {
  const st = stations.find((s) => s.id === id)!;
  const n = normalsOf(id);
  const solar = useMemo(() => monthlySolar(id), [id]);
  const annualT = n.TAVG.values.reduce((a, v, m) => a + v * MONTH_DAYS[m]!, 0) / 365;
  const rain = n.PRCP.values.reduce((a, b) => a + b, 0);
  const sunH = n.SUN.values.reduce((a, b) => a + b, 0);
  const winterSolar = (solar[11]! + solar[0]! + solar[1]!) / 3;
  return (
    <div className="region-card" data-testid="region-card">
      <div className="card-head">
        <strong>
          {st.name} <span className="muted small">{st.group} · {CLASS_LABEL[st.climateClass]} · 표고 약 {st.elevation.value} m</span>
        </strong>
      </div>
      <ClimateSpark id={id} />
      <p className="muted small">붉은 띠: 월평균 일최고–일최저 · 선: 평균기온 · 노란 막대: 일사</p>
      <dl className="facts">
        <div>
          <dt>연평균기온</dt>
          <dd>{annualT.toFixed(1)}°C</dd>
        </div>
        <div>
          <dt>1월 최저 / 8월 최고</dt>
          <dd>
            {n.TMIN.values[0]!.toFixed(1)}° / {n.TMAX.values[7]!.toFixed(1)}°
          </dd>
        </div>
        <div>
          <dt>연강수량</dt>
          <dd>{rain.toFixed(0)} mm</dd>
        </div>
        <div>
          <dt>연 일조시간</dt>
          <dd>{sunH.toFixed(0)} h</dd>
        </div>
        <div>
          <dt>겨울(12–2월) 일사</dt>
          <dd>{winterSolar.toFixed(1)} MJ/m²/d</dd>
        </div>
        <div>
          <dt>7월 강수일수</dt>
          <dd>{n.PDAY.values[6]!.toFixed(0)}일</dd>
        </div>
      </dl>
      <p className="muted small">기온·강수·일조: 기상청 평년값(1991–2020). 일사는 일조시간에서 환산한 추정값.</p>
    </div>
  );
}

export function NewGame({ onDone, onCancel }: { onDone?: () => void; onCancel?: () => void }) {
  const [regionId, setRegionId] = useState('buyeo');
  const [startDate, setStartDate] = useState(todayKst());
  const [seed, setSeed] = useState('');
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [setup, setSetup] = useState<GhSetup>(defaultSetup());
  const [withCrop, setWithCrop] = useState(true);
  const [order, setOrder] = useState<PlantOrder>(defaultOrderUi());
  const [plantDay, setPlantDay] = useState(1);
  const st = stations.find((s) => s.id === regionId)!;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(startDate);

  const start = async () => {
    await session.newGame({ name: name || `${st.name} ${startDate}`, regionId, startDate, seed, setup, settings: withCrop ? { ...defaultSettings(), ...CROPS[order.cropId].recommend } : undefined, crop: withCrop ? { day: plantDay, order } : null });
    onDone?.();
  };

  return (
    <>
      <section className="card" aria-labelledby="ng-region">
        <h2 id="ng-region">1. 지역</h2>
        <div className="region-list" role="listbox" aria-label="지역 선택">
          {GROUPS.map((g) => (
            <div key={g} className="region-group">
              <span className="muted small">{g}</span>
              <div className="chips">
                {stations
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <button key={s.id} type="button" role="option" aria-selected={s.id === regionId} data-region={s.id} className="chip" onClick={() => setRegionId(s.id)}>
                      {s.name}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
        <RegionCard id={regionId} />
      </section>

      <section className="card" aria-labelledby="ng-date">
        <h2 id="ng-date">2. 시작 날짜와 seed</h2>
        <label className="field">
          <span>작기 시작일</span>
          <input type="date" value={startDate} min="1990-01-01" max="2100-12-31" onChange={(e) => setStartDate(e.target.value)} data-testid="start-date" />
        </label>
        <label className="field">
          <span>
            seed <span className="muted small">(비우면 자동 생성)</span>
          </span>
          <input type="text" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="자동" autoCapitalize="off" autoCorrect="off" spellCheck={false} data-testid="seed" />
        </label>
        <label className="field">
          <span>
            작기 이름 <span className="muted small">(선택)</span>
          </span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${st.name} ${startDate}`} />
        </label>
        <p className="muted small">같은 지역 · 같은 시작일 · 같은 seed면 날씨가 날짜 하나까지 똑같이 다시 나옵니다. 재배 방법만 바꿔 비교할 때 씁니다.</p>
      </section>

      <section className="card" aria-labelledby="ng-setup">
        <h2 id="ng-setup">3. 시설 · 장비</h2>
        <SetupEditor value={setup} onChange={setSetup} />
        <p className="muted small">작기 중에도 "환경 → 시설·장비"에서 바꿀 수 있습니다. 제어 설정값은 시작한 뒤 "환경 → 제어"에서 정합니다.</p>
      </section>

      <section className="card" aria-labelledby="ng-crop">
        <h2 id="ng-crop">4. 작물 · 정식</h2>
        <Toggle label="정식 계획 넣기" checked={withCrop} onChange={setWithCrop} hint="끄면 빈 온실로 시작해 작물 탭에서 직접 심습니다" />
        {withCrop && (
          <>
            <OrderEditor value={order} onChange={setOrder} />
            <p className="muted small">
              제어 설정은 이 작물의 표준값으로 시작합니다(난방 주간 {CROPS[order.cropId].recommend.heatDay}°C / 야간 {CROPS[order.cropId].recommend.heatNight}°C, 환기 {CROPS[order.cropId].recommend.ventTemp}°C부터). 시작한 뒤 "환경 → 제어"에서 바꿀 수 있습니다.
            </p>
            <Num label="정식일" value={plantDay} min={0} max={120} unit="일째" hint="작기 시작일로부터(아침 7시에 심음)" onChange={setPlantDay} testId="plant-day" />
          </>
        )}
      </section>

      {confirm ? (
        <section className="card confirm" role="alertdialog" aria-label="시작 확인">
          <p>
            <strong>{st.name}</strong>에서 <strong>{startDate}</strong>부터 새 작기를 시작할까요? 진행 중이던 작기는 지워지지 않고 "더보기 → 세이브"에 남습니다.
          </p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => void start()} data-testid="confirm-start">
              시작
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>
              취소
            </button>
          </div>
        </section>
      ) : (
        <div className="btn-row">
          <button type="button" className="btn" disabled={!validDate} onClick={() => setConfirm(true)} data-testid="start-game">
            새 작기 시작
          </button>
          {onCancel && (
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              취소
            </button>
          )}
        </div>
      )}
    </>
  );
}
