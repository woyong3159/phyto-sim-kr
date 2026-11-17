/**
 * 근권·양액 탭(Phase 4): 현황 / 관수 / 양액 / 측정 / 그래프.
 * 관측 모드가 "현실"이면 측정 장비·분석으로 얻은 값만 보인다(헌법 9항).
 */
import { useEffect, useMemo, useState } from 'react';
import { RZ_PARAMS } from '../data';
import { defaultRzConfig, designRecipe, ecOf, ecTargetAt, feedOf, fillTank, groundwaterProfile, rawAlkalinity, rawWaters, recipeKey, solveMix, speciate, stockMix, thetaCC, type CropId, type Ion, type IonVec, type IrrMode, type IrrSettings, type Lab, type NutSettings, type RzSetup, type RzSystem, type SubstrateSys } from '../engine';
import type { RzView } from '../sim/protocol';
import { session, type SessionView } from '../sim/session';
import { Chart } from './EnvScreen';
import { won } from './format';
import { Num, Select, Toggle } from './Num';

const P = RZ_PARAMS;
type Sub = 'now' | 'irr' | 'nut' | 'measure' | 'graph';
const SUBS: [Sub, string][] = [['now', '현황'], ['irr', '관수'], ['nut', '양액'], ['measure', '측정'], ['graph', '그래프']];
const TANKS = ['A', 'B', 'acid'] as const;
type TankKey = (typeof TANKS)[number];
const TANK_NAME: Record<TankKey, string> = { A: 'A 탱크', B: 'B 탱크', acid: '산(알칼리) 탱크' };
const CROP_NAME: Record<CropId, string> = { cucumber: '오이', strawberry: '딸기', wasabi: '와사비' };
const SYS_NAME: Record<RzSystem, string> = { rockwool: '암면 슬래브', coir: '코이어 고설', peatPerlite: '피트+펄라이트 고설', nft: '박막수경(NFT)', dft: '담액수경(DFT)' };
const MODE_NAME: Record<IrrMode, string> = { solar: '일사비례', timer: '타이머', sensor: '배지 수분 센서', continuous: '연속 순환(수경)', off: '관수 끔' };
const ION_NAME: Record<Ion, string> = { NO3: 'NO₃⁻-N', NH4: 'NH₄⁺-N', P: 'H₂PO₄⁻(P)', K: 'K⁺', Ca: 'Ca²⁺', Mg: 'Mg²⁺', S: 'SO₄²⁻(S)', Na: 'Na⁺', Cl: 'Cl⁻', HCO3: '무기탄소(HCO₃⁻)', Fe: 'Fe', Mn: 'Mn', Zn: 'Zn', B: 'B', Cu: 'Cu', Mo: 'Mo' };
const LEAF_NAME: Partial<Record<Ion, string>> = { NO3: 'N', P: 'P', K: 'K', Ca: 'Ca', Mg: 'Mg', S: 'S', Fe: 'Fe', Mn: 'Mn', Zn: 'Zn', B: 'B', Cu: 'Cu', Mo: 'Mo', Na: 'Na', Cl: 'Cl' };
const MICRO = new Set<Ion>(['Fe', 'Mn', 'Zn', 'B', 'Cu', 'Mo']);
const SHOW_IONS: Ion[] = ['NO3', 'NH4', 'P', 'K', 'Ca', 'Mg', 'S', 'Na', 'Cl', 'HCO3', 'Fe', 'Mn', 'Zn', 'B', 'Cu', 'Mo'];
const LAB_NAME: Record<Lab['kind'], string> = { feed: '급액(양액) 분석', drain: '배액·근권 용액 분석', tissue: '식물체(잎) 분석', water: '원수 분석' };
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '–');
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '–');
/** 이온 농도 표시: 다량원소 mmol/L, 미량원소 µmol/L */
const conc = (i: Ion, mmol: number) => (MICRO.has(i) ? `${(mmol * 1000).toFixed(1)} µM` : `${mmol.toFixed(2)} mM`);

const isHydroSys = (s: RzSystem) => P.systems[s].kind === 'hydro';

function Metric({ label, value, unit, sub, warn }: { label: string; value: string; unit?: string; sub?: string; warn?: boolean }) {
  return (
    <div className="metric" data-warn={warn ? '1' : undefined}>
      <span className="muted small">{label}</span>
      <span className="metric-value">
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
      </span>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

/** 엽분석 판정: [심한 결핍, 적정 하한, 적정 상한, 독성] · 어린 잎은 정상 농도 배수(young)를 곱해 판정한다 */
function judge(crop: CropId, i: Ion, v: number, young: boolean): { label: string; cls: string } {
  const l = P.crop[crop].leaf[i];
  if (!l || !Number.isFinite(v)) return { label: '–', cls: '' };
  const y = young ? (P.uptake[i]?.young ?? 1) : 1;
  if (l[1] >= 0 && v < l[0] * y) return { label: '결핍', cls: 'bad' };
  if (l[1] >= 0 && v < l[1] * y) return { label: '부족', cls: 'warn' };
  if (l[3] < 99 && v > l[3]) return { label: '독성', cls: 'bad' };
  if (v > l[2] * (young ? 1 : 1)) return { label: '과잉', cls: 'warn' };
  return { label: '적정', cls: 'ok' };
}

function rawFor(regionId: string, s: RzSetup): IonVec {
  const raw = rawWaters(P, regionId);
  return raw[s.water === 'rain' ? 'rain' : s.water];
}

function TissueTable({ crop, tissue, testId }: { crop: CropId; tissue: Partial<Record<Ion, [number, number]>>; testId?: string }) {
  return (
    <table className="inout" data-testid={testId}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>원소</th>
          <th>신엽</th>
          <th>하위엽</th>
          <th>적정(성엽)</th>
        </tr>
      </thead>
      <tbody>
        {(Object.keys(LEAF_NAME) as Ion[]).map((i) => {
          const t = tissue[i];
          if (!t) return null;
          const l = P.crop[crop].leaf[i];
          const unit = MICRO.has(i) ? 'mg/kg' : '%';
          const ju = judge(crop, i, t[0], true);
          const jl = judge(crop, i, t[1], false);
          const fmt = (v: number) => (MICRO.has(i) ? v.toFixed(0) : v.toFixed(2));
          return (
            <tr key={i}>
              <th style={{ textAlign: 'left' }}>
                {LEAF_NAME[i]} <span className="muted small">{unit}</span>
              </th>
              <td>
                {fmt(t[0])} <span className={`judge judge-${ju.cls}`}>{ju.label}</span>
              </td>
              <td>
                {fmt(t[1])} <span className={`judge judge-${jl.cls}`}>{jl.label}</span>
              </td>
              <td className="muted small">{l ? (l[1] < 0 ? `< ${l[2]}` : `${l[1]}–${l[2]}`) : '–'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function IonTable({ rows, testId }: { rows: { label: string; v: IonVec }[]; testId?: string }) {
  return (
    <table className="inout" data-testid={testId}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>이온</th>
          {rows.map((r) => (
            <th key={r.label}>{r.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {SHOW_IONS.map((i) => (
          <tr key={i}>
            <th style={{ textAlign: 'left' }}>{ION_NAME[i]}</th>
            {rows.map((r) => (
              <td key={r.label}>{conc(i, r.v[i])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function latestLab(labs: Lab[], kind: Lab['kind'], hour: number): Lab | undefined {
  return [...labs].reverse().find((l) => l.kind === kind && l.ready <= hour);
}

// ───────────────────────── 현황 ─────────────────────────

function Now({ rz, crop, real, hour, dap }: { rz: RzView; crop: CropId | null; real: boolean; hour: number; dap: number }) {
  const o = rz.out;
  const hydro = isHydroSys(rz.setup.system);
  const y = rz.yesterday;
  const drainPct = y && y.feed > 0 ? (100 * y.drain) / y.feed : NaN;
  const meter = rz.setup.meter;
  const sensor = rz.irr.mode === 'sensor';
  const s = o.supply;
  const tLab = latestLab(rz.labs, 'tissue', hour);
  const dLab = latestLab(rz.labs, 'drain', hour);
  const fLab = latestLab(rz.labs, 'feed', hour);
  const hidden = <span className="muted small">측정 필요</span>;
  return (
    <>
      <section className="card" data-testid="rz-now">
        <div className="card-head">
          <h2>근권 지금</h2>
          <span className="badge">{SYS_NAME[rz.setup.system]} · {rz.setup.drain === 'open' ? '배출식' : '순환식'}</span>
        </div>
        <div className="metrics">
          {!real ? <Metric label={hydro ? '양액 EC' : '배지 용액 EC'} value={f2(o.ec)} unit="dS/m" sub={`급액 목표 ${f1(ecTargetAt(rz.nut, dap))} dS/m`} warn={o.supply.salt < 0.9} /> : <Metric label="배지 EC(배액으로 추정)" value={meter && y && y.drain > 0 ? f2(y.drainEc / y.drain) : '–'} unit="dS/m" sub={meter ? '어제 배액 평균' : 'EC 미터 없음'} />}
          {!real ? <Metric label={hydro ? '양액 pH' : '배지 용액 pH'} value={f2(o.pH)} warn={o.pH < 5 || o.pH > 7} /> : <Metric label="배지 pH(배액으로 추정)" value={meter && y && y.drain > 0 ? f2(y.drainPh / y.drain) : '–'} sub={meter ? '어제 배액 평균' : 'pH 미터 없음'} />}
          {hydro ? (
            !real ? <Metric label="용존산소(DO)" value={f1(o.dO)} unit="mg/L" sub="4 mg/L 아래면 뿌리 장해" warn={o.dO < 4} /> : <Metric label="용존산소(DO)" value="–" sub="DO 측정기 없음" />
          ) : !real || sensor ? (
            <Metric label="배지 수분(θ)" value={f1(o.theta * 100)} unit="%" sub={`퍼텐셜 ${f1(o.psi)} kPa · 기상률 ${f1(o.afp * 100)}%`} warn={o.psi < -10 || o.afp < 0.05} />
          ) : (
            <Metric label="배지 수분" value="–" sub="수분 센서 없음(배지 무게로 판단)" />
          )}
          <Metric label="근권 온도" value={f1(o.rootT)} unit="°C" />
          {!real && <Metric label="뿌리 활력" value={f2(o.rootAct)} sub={`산소 ${f2(o.o2)} · 건강도 ${f2(o.health)}`} warn={o.rootAct < 0.6} />}
          {!real && !hydro && <Metric label="점적 막힘 지수" value={f2(o.clog)} sub="0.3 주의 · 0.6 경고" warn={o.clog > 0.3} />}
        </div>
      </section>

      <section className="card" data-testid="rz-today">
        <h2>오늘·어제 관수</h2>
        <div className="metrics">
          <Metric label="오늘 급액" value={f2(rz.today.feed)} unit="L/m²" sub={`${rz.today.events}회 · 1회 ×${f2(rz.doseScale)}`} />
          <Metric label="어제 배액률" value={Number.isFinite(drainPct) ? f1(drainPct) : '–'} unit="%" sub={`목표 ${rz.irr.drainTarget}%`} warn={Number.isFinite(drainPct) && drainPct < 5} />
          <Metric label="어제 급액 EC / pH" value={meter && y && y.feed > 0 ? `${f2(y.feedEc / y.feed)} / ${f1(y.feedPh / y.feed)}` : '–'} sub={meter ? '' : '미터 없음'} />
          <Metric label="어제 배액 EC / pH" value={meter && y && y.drain > 0 ? `${f2(y.drainEc / y.drain)} / ${f1(y.drainPh / y.drain)}` : '–'} />
          <Metric label="어제 흡수(증산)" value={y ? f2(y.uptake) : '–'} unit="L/m²" />
          {rz.setup.drain === 'closed' && !hydro && <Metric label="배액 회수 탱크" value={f1(rz.drainTank)} unit="L/m²" />}
          {rz.setup.water === 'rain' && <Metric label="빗물 탱크" value={f1(rz.rain)} unit="L/m²" />}
        </div>
      </section>

      {crop && (
        <section className="card" data-testid="rz-effect">
          <h2>작물에 미치는 영향</h2>
          {real ? (
            <p className="muted small">현실 모드에서는 계수가 보이지 않습니다. 작물 탭의 생육과 식물체 분석 결과로 판단하세요.</p>
          ) : (
            <div className="stress-grid">
              {(
                [
                  ['수분 공급', s.water],
                  ['광합성(위 잎)', s.photo[0]],
                  ['광합성(가운데)', s.photo[1]],
                  ['광합성(아래 잎)', s.photo[2]],
                  ['엽 확장', s.expand],
                  ['과실 비대', s.fruit],
                  ['착과', s.set],
                  ['염류(EC)', s.salt],
                ] as [string, number][]
              ).map(([l, v]) => (
                <div key={l} className={`stress ${v < 0.8 ? 'stress-bad' : ''}`}>
                  <span className="muted small">{l}</span>
                  <strong>{f2(v)}</strong>
                </div>
              ))}
              <div className={`stress ${s.tipburn > 0.3 ? 'stress-bad' : ''}`}>
                <span className="muted small">팁번 위험(칼슘)</span>
                <strong>{f2(s.tipburn)}</strong>
              </div>
            </div>
          )}
        </section>
      )}

      {crop && (
        <section className="card">
          <h2>식물 양분(엽분석)</h2>
          {!real && Object.keys(o.tissue).length ? (
            <TissueTable crop={crop} tissue={o.tissue} testId="rz-tissue" />
          ) : real && tLab?.tissue ? (
            <>
              <p className="muted small">식물체 분석 결과({Math.floor(tLab.ordered / 24) + 1}일째 채취)</p>
              <TissueTable crop={crop} tissue={tLab.tissue} />
            </>
          ) : (
            <p className="muted small">{real ? '측정 탭에서 식물체 분석을 의뢰하면 3일 뒤 결과가 나옵니다.' : '정식 후 계산됩니다.'}</p>
          )}
          <p className="muted small">신엽은 칼슘·붕소·망간이 원래 낮아 판정 기준을 낮춰 적용합니다. 이동성 원소(N·P·K·Mg)는 하위엽부터, 칼슘·붕소·철은 신엽부터 모자랍니다.</p>
        </section>
      )}

      <section className="card">
        <h2>이온 농도</h2>
        {!real ? (
          <IonTable rows={[{ label: '근권', v: o.ions }, { label: '급액', v: o.feedIons }]} testId="rz-ions" />
        ) : dLab?.ions || fLab?.ions ? (
          <IonTable rows={[...(dLab?.ions ? [{ label: `배액(${Math.floor(dLab.ordered / 24) + 1}일)`, v: dLab.ions }] : []), ...(fLab?.ions ? [{ label: `급액(${Math.floor(fLab.ordered / 24) + 1}일)`, v: fLab.ions }] : [])]} />
        ) : (
          hidden
        )}
      </section>

      <Tanks rz={rz} real={real} />

      <section className="card">
        <h2>작기 누적</h2>
        <div className="metrics">
          <Metric label="급액" value={f1(rz.total.feed)} unit="L/m²" sub={`배액 ${f1(rz.total.drain)} L/m²`} />
          <Metric label="근권 비용 합계" value={won(rz.total.won)} sub={`비료 ${won(rz.total.fert)} · 물 ${won(rz.total.water)}`} />
          <Metric label="전기(살균·포기)" value={won(rz.total.elec)} />
          <Metric label="분석 의뢰" value={won(rz.total.lab)} sub={`작업 ${f1(rz.total.labor)} h`} />
        </div>
      </section>
    </>
  );
}

function Tanks({ rz, real }: { rz: RzView; real: boolean }) {
  return (
    <section className="card" data-testid="rz-tanks">
      <h2>원액 탱크</h2>
      <div className="blocks">
        {TANKS.map((k) => {
          const st = rz.stock[k];
          const vol = rz.nut.volume[k];
          const has = Object.values(rz.nut.tanks[k]).some((v) => v > 0);
          const stale = has && st.recipeKey !== recipeKey(rz.nut.tanks[k]);
          return (
            <div key={k} className="block-row">
              <span>
                <strong>{TANK_NAME[k]}</strong>{' '}
                {has ? (
                  <span className="muted small">
                    {f1(st.left)} / {vol} L ({Math.round((100 * st.left) / (vol || 1))}%)
                  </span>
                ) : (
                  <span className="muted small">비어 있음(처방 없음)</span>
                )}
                {stale && <span className="badge badge-warn">처방 변경됨 · 새로 타야 반영</span>}
                {!real && st.precip > 0.001 && <span className="badge badge-warn">침전 {f2(st.precip)} mol/L</span>}
              </span>
              {has && (
                <button type="button" className="btn btn-small" data-refill={k} onClick={() => session.refillTank(k)}>
                  새로 타기
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small">자동 보충 {rz.nut.autoRefill ? '켜짐(비면 같은 처방으로 다시 탄다)' : '꺼짐(비면 사건으로 멈춘다)'}.</p>
    </section>
  );
}

// ───────────────────────── 관수·시설 ─────────────────────────

function IrrEditor({ rz, living, cropId, regionId, density }: { rz: RzView; living: boolean; cropId: CropId | null; regionId: string; density: number }) {
  const [irr, setIrr] = useState(rz.irr);
  const [setup, setSetup] = useState(rz.setup);
  const [confirm, setConfirm] = useState<null | 'apply' | 'defaults'>(null);
  const baseI = JSON.stringify(rz.irr);
  const baseS = JSON.stringify(rz.setup);
  useEffect(() => setIrr(JSON.parse(baseI) as IrrSettings), [baseI]);
  useEffect(() => setSetup(JSON.parse(baseS) as RzSetup), [baseS]);
  const changed = JSON.stringify(irr) !== baseI || JSON.stringify(setup) !== baseS;
  const hydro = isHydroSys(setup.system);
  const sys = P.systems[setup.system];
  const set = <K extends keyof IrrSettings>(k: K, v: IrrSettings[K]) => setIrr({ ...irr, [k]: v });
  const ss = <K extends keyof RzSetup>(k: K, v: RzSetup[K]) => setSetup({ ...setup, [k]: v });
  const cc = sys.kind === 'substrate' ? thetaCC(sys as SubstrateSys) : 0;
  const shotL = ((irr.dose / 1000) * density).toFixed(2);
  return (
    <>
      <section className="card setup">
        <h2>재배 방식·시설</h2>
        <Select label="재배 방식(배지·수경)" value={setup.system} options={(Object.keys(SYS_NAME) as RzSystem[]).map((k) => [k, `${SYS_NAME[k]}${living && k !== rz.setup.system ? ' (작물이 있어 못 바꿈)' : ''}`] as const)} onChange={(v) => (!living || v === rz.setup.system) && ss('system', v)} testId="rz-system" />
        <p className="muted small">{sys.note} {sys.kind === 'substrate' ? `용기용수량 θ ${(cc * 100).toFixed(0)}%, 배지 ${sys.volume} L/m².` : `양액량 ${sys.volume} L/m².`}</p>
        {!hydro && <Select label="배액" value={setup.drain} options={[['open', '배출식(버림)'], ['closed', '순환식(회수해 섞어 씀)']] as const} onChange={(v) => ss('drain', v)} testId="rz-drain" />}
        {(setup.drain === 'closed' || hydro) && <Select label="순환 양액 살균(Phase 6 병해와 연결)" value={setup.disinfect} options={[['none', '없음'], ['uv', '자외선(UV)'], ['heat', '열 살균']] as const} onChange={(v) => ss('disinfect', v)} />}
        {hydro && <Toggle label="에어펌프(포기)" checked={setup.aeration} onChange={(v) => ss('aeration', v)} hint="용존산소 유지" />}
        <Select label="원수" value={setup.water} options={[['groundwater', `지하수 — ${P.water.profiles[groundwaterProfile(P, regionId)]?.name ?? ''}`], ['tap', '상수도'], ['rain', '빗물(탱크 저장)']] as const} onChange={(v) => ss('water', v)} testId="rz-water" />
        {setup.water === 'rain' && (
          <>
            <Select label="빗물이 떨어지면" value={setup.backup} options={[['groundwater', '지하수로'], ['tap', '상수도로']] as const} onChange={(v) => ss('backup', v)} />
            <Num label="빗물 탱크" value={setup.rainTank} step={5} min={0} max={300} unit="L/m²" onChange={(v) => ss('rainTank', v)} />
          </>
        )}
        <Select label="주입기" value={setup.injector} options={[['mixing', '양액 혼합기(EC·pH 자동)'], ['proportional', '비례 주입기(희석 배율 고정)']] as const} onChange={(v) => ss('injector', v)} testId="rz-injector" />
        <Toggle label="EC·pH 미터" checked={setup.meter} onChange={(v) => ss('meter', v)} hint="현실 모드에서 급액·배액 EC/pH가 보인다" />
      </section>

      <section className="card setup">
        <h2>관수 제어</h2>
        {hydro ? (
          <>
            <p className="muted small">수경은 양액이 늘 순환합니다. 증산으로 준 만큼 원수와 원액을 보충하고, 혼합기는 탱크 전체를 목표 EC·pH로 맞춥니다.</p>
            <Num label="상시 소량 갱신" value={irr.bleed ?? 0} min={0} max={100} unit="%/주" hint="일주일에 양액의 몇 %를 버리고 새로 채울지. 0 = 안 함" onChange={(v) => set('bleed', v)} testId="rz-bleed" />
            <Num label="양액 전량 교체 주기" value={irr.renewDays} min={0} max={180} unit="일" hint="0 = 교체 안 함" onChange={(v) => set('renewDays', v)} testId="rz-renew" />
          </>
        ) : (
          <>
            <Select label="관수 방식" value={irr.mode} options={(['solar', 'timer', 'sensor', 'off'] as IrrMode[]).map((m) => [m, MODE_NAME[m]] as const)} onChange={(v) => set('mode', v)} testId="rz-mode" />
            {irr.mode === 'solar' && <Num label="일사 적산" value={irr.solarJ} step={10} min={20} max={1000} unit="J/cm²" hint="바깥 일사가 이만큼 쌓일 때마다 1회" onChange={(v) => set('solarJ', v)} testId="rz-solar" />}
            {irr.mode === 'timer' && <Num label="하루 관수 횟수" value={irr.timerCount} min={0} max={60} unit="회" hint="시작~종료 사이에 고르게" onChange={(v) => set('timerCount', v)} />}
            {irr.mode === 'sensor' && <Num label="관수 시작 수분" value={irr.sensorTheta} min={10} max={95} unit="%" hint={`이 아래로 마르면 관수 · 용기용수량 ${(cc * 100).toFixed(0)}%`} onChange={(v) => set('sensorTheta', v)} />}
            <Num label="1회 관수량" value={irr.dose} step={10} min={10} max={1000} unit="mL/주" hint={`= ${shotL} L/m²`} onChange={(v) => set('dose', v)} testId="rz-dose" />
            <Num label="시작 시각" value={irr.start} min={0} max={23} unit="시" onChange={(v) => set('start', v)} />
            <Num label="종료 시각" value={irr.end} min={1} max={24} unit="시" onChange={(v) => set('end', v)} />
            <Num label="최소 간격" value={irr.minGap} step={5} min={0} max={240} unit="분" onChange={(v) => set('minGap', v)} />
            <Toggle label="시작 시각에 첫 관수" checked={irr.startShot} onChange={(v) => set('startShot', v)} />
            <Num label="목표 배액률" value={irr.drainTarget} min={0} max={80} unit="%" onChange={(v) => set('drainTarget', v)} testId="rz-drain-target" />
            <Toggle label="배액률 자동 보정" checked={irr.autoDrain} onChange={(v) => set('autoDrain', v)} hint="어제 배액률로 1회 관수량을 매일 조정" />
            {setup.drain === 'closed' && <Num label="회수 배액 혼합 비율(최대)" value={Math.round(irr.reuse * 100)} step={5} min={0} max={100} unit="%" onChange={(v) => set('reuse', v / 100)} />}
          </>
        )}
      </section>

      {changed && (
        <div className="apply-bar">
          {confirm === 'apply' ? (
            <div className="confirm" role="alertdialog" aria-label="관수·시설 변경 확인">
              <p>관수·시설 설정을 지금 시각부터 적용할까요?{setup.system !== rz.setup.system ? ' 재배 방식을 바꾸면 근권을 비우고 새 시스템을 급액으로 다시 채웁니다.' : ''}</p>
              <div className="btn-row">
                <button type="button" className="btn" data-testid="confirm-irr" onClick={() => { if (JSON.stringify(setup) !== baseS) session.setRzSetup(setup); if (JSON.stringify(irr) !== baseI) session.setIrrigation(irr); setConfirm(null); }}>적용</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setIrr(rz.irr); setSetup(rz.setup); setConfirm(null); }}>되돌리기</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" data-testid="apply-irr" onClick={() => setConfirm('apply')}>변경 적용</button>
          )}
        </div>
      )}
      {cropId && (
        <section className="card">
          <h2>작물 기본값</h2>
          <p className="muted small">{CROP_NAME[cropId]} 표준 근권(재배 방식·처방·관수)을 이 지역 원수에 맞춰 다시 계산해 한 번에 적용합니다.{living ? ' 작물이 있는 동안 재배 방식은 그대로 둡니다.' : ''}</p>
          {confirm === 'defaults' ? (
            <div className="confirm" role="alertdialog" aria-label="기본값 적용 확인">
              <p>관수·양액 설정과 원액 탱크를 기본값으로 바꾸고 탱크를 새로 탑니다.</p>
              <div className="btn-row">
                <button type="button" className="btn" data-testid="confirm-defaults" onClick={() => { session.applyRzConfig(defaultRzConfig(P, cropId, regionId)); setConfirm(null); }}>적용</button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>취소</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-small" data-testid="rz-defaults" onClick={() => setConfirm('defaults')}>{CROP_NAME[cropId]} 기본값 적용</button>
          )}
        </section>
      )}
    </>
  );
}

// ───────────────────────── 양액 ─────────────────────────

const FERT_IDS = Object.keys(P.ferts);
const RECIPES = Object.entries(P.recipes);

function TankEditor({ k, nut, setTank, real }: { k: TankKey; nut: NutSettings; setTank: (k: TankKey, r: Record<string, number>) => void; real: boolean }) {
  const rec = nut.tanks[k];
  const mix = useMemo(() => stockMix(rec, nut.volume[k], P.ferts, P.chem), [rec, nut.volume, k]);
  const unused = FERT_IDS.filter((id) => !(id in rec));
  const [add, setAdd] = useState(unused[0] ?? '');
  return (
    <div className="tank" data-tank={k}>
      <h3>
        {TANK_NAME[k]} <span className="muted small">{nut.volume[k]} L · 원료비 {won(mix.cost)}</span>
      </h3>
      {Object.entries(rec).map(([id, kg]) => {
        const fp = P.ferts[id];
        return (
          <div key={id} className="fert-row">
            <Num label={`${fp?.name ?? id}`} hint={fp ? `${fp.formula}${fp.tank === 'A' || fp.tank === 'B' ? ` · 보통 ${fp.tank} 탱크` : ''}` : ''} value={kg} step={kg < 1 ? 0.01 : 0.5} min={0} max={500} unit={fp?.liquid ? 'kg(액상)' : 'kg'} onChange={(v) => setTank(k, { ...rec, [id]: v })} />
            <button type="button" className="btn btn-ghost btn-small" aria-label={`${fp?.name ?? id} 빼기`} onClick={() => { const r = { ...rec }; delete r[id]; setTank(k, r); }}>빼기</button>
          </div>
        );
      })}
      <div className="fert-add">
        <Select label="원료 추가" value={add} options={unused.map((id) => [id, `${P.ferts[id]!.name}${P.ferts[id]!.tank === k || (P.ferts[id]!.tank === 'AB' && k !== 'acid') ? '' : P.ferts[id]!.tank === 'acid' ? ' (산·알칼리)' : ` (보통 ${P.ferts[id]!.tank})`}`] as const)} onChange={setAdd} />
        <button type="button" className="btn btn-small" disabled={!add} onClick={() => { setTank(k, { ...rec, [add]: 1 }); setAdd(unused.find((x) => x !== add) ?? ''); }}>추가</button>
      </div>
      {!real && mix.warnings.length > 0 && (
        <ul className="plain-list warn-list" data-testid={`warn-${k}`}>
          {mix.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NutEditor({ rz, regionId, cropId, dap, real }: { rz: RzView; regionId: string; cropId: CropId | null; dap: number; real: boolean }) {
  const [nut, setNut] = useState(rz.nut);
  const [confirm, setConfirm] = useState(false);
  const [target, setTarget] = useState(RECIPES[0]![0]);
  const base = JSON.stringify(rz.nut);
  useEffect(() => setNut(JSON.parse(base) as NutSettings), [base]);
  useEffect(() => {
    if (cropId) setTarget(P.defaults[cropId].recipe);
  }, [cropId]);
  const changed = JSON.stringify(nut) !== base;
  const raw = rawFor(regionId, rz.setup);
  const setTank = (k: TankKey, r: Record<string, number>) => setNut({ ...nut, tanks: { ...nut.tanks, [k]: r } });
  // 정방향 계산: 이 처방을 지금 원수에 1:D로 넣었을 때
  const calc = useMemo(() => {
    const st = { A: fillTank(nut.tanks.A, nut.volume.A, P).tank, B: fillTank(nut.tanks.B, nut.volume.B, P).tank, acid: fillTank(nut.tanks.acid, nut.volume.acid, P).tank };
    const fixed = feedOf(raw, {}, st, nut, 1, 1, 1, P.chem);
    const m = solveMix(raw, {}, st, nut, ecTargetAt(nut, dap), P.chem, { A: 99, B: 99, acid: 99 });
    const mixed = feedOf(raw, {}, st, nut, m.rA, m.rB, m.ra, P.chem);
    return { fixed, mixed, m };
  }, [nut, raw, dap]);
  const tv = P.recipes[target];
  const targetVec = useMemo(() => {
    const v: IonVec = { NO3: 0, NH4: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0, Na: 0, Cl: 0, HCO3: 0, Fe: 0, Mn: 0, Zn: 0, B: 0, Cu: 0, Mo: 0 };
    if (tv) for (const [i, x] of Object.entries(tv.mmol)) v[i as Ion] = MICRO.has(i as Ion) ? (x as number) / 1000 : (x as number);
    return v;
  }, [tv]);
  const rawSp = speciate(raw, P.chem);
  const ecProg = nut.ecProgram;
  return (
    <>
      <section className="card setup">
        <h2>급액 기본</h2>
        <Toggle label="원액 주입" checked={nut.feedOn} onChange={(v) => setNut({ ...nut, feedOn: v })} hint="끄면 원수(물)만 준다" />
        <h3>EC·pH 프로그램(생육 단계별)</h3>
        {ecProg.map((row, idx) => {
          const put = (k: 0 | 1 | 2, v: number) => setNut({ ...nut, ecProgram: ecProg.map((x, j) => (j === idx ? ([x[0], x[1], x[2] ?? nut.phTarget].map((y, q) => (q === k ? v : y)) as [number, number, number]) : x)) });
          return (
            <div key={idx} className="fert-row">
              <Num label={`정식 후 ${idx === 0 ? '0' : ''}일부터`} value={row[0]} min={0} max={720} unit="일" onChange={(v) => put(0, v)} />
              <Num label="목표 EC" value={row[1]} step={0.1} min={0} max={6} unit="dS/m" onChange={(v) => put(1, v)} testId={idx === 0 ? 'rz-ec0' : undefined} />
              <Num label="목표 pH" value={row[2] ?? nut.phTarget} step={0.1} min={4} max={8} onChange={(v) => (idx === 0 && row.length < 3 ? setNut({ ...nut, phTarget: v }) : put(2, v))} testId={idx === 0 ? 'rz-ph' : undefined} />
              {idx > 0 && <button type="button" className="btn btn-ghost btn-small" onClick={() => setNut({ ...nut, ecProgram: ecProg.filter((_, j) => j !== idx) })}>빼기</button>}
            </div>
          );
        })}
        <button type="button" className="btn btn-small" onClick={() => { const last = ecProg[ecProg.length - 1]; setNut({ ...nut, ecProgram: [...ecProg, [(last?.[0] ?? 0) + 30, last?.[1] ?? 1.5, last?.[2] ?? nut.phTarget]] }); }}>단계 추가</button>
        <p className="muted small">EC·pH 목표는 혼합기에서만 자동으로 맞춥니다. 비례 주입기는 희석 배율대로 들어갑니다.</p>
        <Num label="원액 희석 배율 1:" value={nut.dilution} step={10} min={20} max={500} onChange={(v) => setNut({ ...nut, dilution: v })} />
        <Num label="산 희석 배율 1:" value={nut.acidDilution} step={10} min={20} max={2000} onChange={(v) => setNut({ ...nut, acidDilution: v })} />
        <Toggle label="원액 자동 보충" checked={nut.autoRefill} onChange={(v) => setNut({ ...nut, autoRefill: v })} hint="끄면 비었을 때 사건으로 멈춘다" />
      </section>

      <section className="card setup">
        <h2>원액 탱크 처방</h2>
        {TANKS.map((k) => (
          <TankEditor key={k} k={k} nut={nut} setTank={setTank} real={real} />
        ))}
        <p className="muted small">칼슘(질산칼슘)과 황산염·인산염을 같은 탱크에 넣으면 실제로 침전합니다. 경고는 학습 모드에서만 보입니다.</p>
      </section>

      <section className="card" data-testid="rz-calc">
        <h2>정방향 계산기</h2>
        <p className="muted small">
          원수: {rz.setup.water === 'groundwater' ? P.water.profiles[groundwaterProfile(P, regionId)]?.name : rz.setup.water === 'tap' ? '상수도' : '빗물'} · EC {f2(ecOf(raw, P.chem, rawSp))} · pH {f1(rawSp.pH)} · 알칼리도 {f2(rawAlkalinity(P, regionId, rz.setup.water === 'rain' ? 'rain' : rz.setup.water))} mmol/L
        </p>
        <div className="metrics">
          <Metric label={`희석 1:${nut.dilution} 그대로`} value={f2(calc.fixed.ec)} unit="dS/m" sub={`pH ${f1(calc.fixed.pH)}`} />
          <Metric label={`혼합기(목표 EC ${f1(ecTargetAt(nut, dap))})`} value={f2(calc.mixed.ec)} unit="dS/m" sub={`pH ${f1(calc.mixed.pH)} · 원액 ×${f2(calc.m.rA)} · 산 ×${f2(calc.m.ra)}`} />
        </div>
        <IonTable rows={[{ label: '1:D 급액', v: calc.fixed.ions }, ...(tv ? [{ label: '목표 처방', v: targetVec }] : [])]} />
      </section>

      <section className="card setup">
        <h2>역방향 도우미(목표 처방 → 원료 배합)</h2>
        <Select label="목표 처방" value={target} options={RECIPES.map(([id, r]) => [id, `${r.name} [${r.tag}]`] as const)} onChange={setTarget} testId="rz-recipe" />
        {tv && <p className="muted small">{tv.source || tv.note}</p>}
        <button
          type="button"
          className="btn btn-small"
          data-testid="rz-design"
          onClick={() => {
            const r = designRecipe(P, target, raw, rawAlkalinity(P, regionId, rz.setup.water === 'rain' ? 'rain' : rz.setup.water), { dilution: nut.dilution, acidDilution: nut.acidDilution, volume: nut.volume });
            setNut({ ...nut, tanks: r.tanks });
          }}
        >
          원수 성분을 빼고 배합 제안
        </button>
        <p className="muted small">비음수 최소제곱으로 원료 kg을 정하고, 원수의 중탄산은 질산으로 0.5 mmol/L까지 중화합니다. 제안값은 탱크 처방에만 들어가며 "변경 적용" 전까지는 실제로 바뀌지 않습니다.</p>
      </section>

      {changed && (
        <div className="apply-bar">
          {confirm ? (
            <div className="confirm" role="alertdialog" aria-label="양액 변경 확인">
              <p>양액 설정을 적용할까요? 탱크 처방을 바꿨다면 적용 뒤 "새로 타기"를 해야 탱크에 반영됩니다(지금 탱크에는 이전 원액이 남아 있음).</p>
              <div className="btn-row">
                <button type="button" className="btn" data-testid="confirm-nut" onClick={() => { session.setNutrition(nut); setConfirm(false); }}>적용</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setNut(rz.nut); setConfirm(false); }}>되돌리기</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" data-testid="apply-nut" onClick={() => setConfirm(true)}>변경 적용</button>
          )}
        </div>
      )}
      <Tanks rz={rz} real={real} />
    </>
  );
}


// ───────────────────────── 측정 ─────────────────────────

function Measure({ rz, view, cropId }: { rz: RzView; view: SessionView; cropId: CropId | null }) {
  const mode = view.save?.observationMode ?? 'god';
  const hour = view.hour;
  const hydro = isHydroSys(rz.setup.system);
  const fee = (k: Lab['kind']) => (k === 'tissue' ? P.lab.tissue : k === 'water' ? P.lab.water : P.lab.solution);
  return (
    <>
      <section className="card">
        <h2>관측 모드</h2>
        <div className="segmented" role="group" aria-label="관측 모드">
          <button type="button" aria-pressed={mode === 'god'} data-obs="god" onClick={() => session.setObservationMode('god')}>학습(모두 보임)</button>
          <button type="button" aria-pressed={mode === 'realistic'} data-obs="realistic" onClick={() => session.setObservationMode('realistic')}>현실(측정해야 보임)</button>
        </div>
        <p className="muted small">현실 모드: 근권 EC·pH는 EC·pH 미터로 잰 급액·배액 값으로, 이온 농도와 원수 성분은 실험실 분석(비용, {P.lab.delay / 24}일 뒤 결과)으로, 식물 양분은 식물체 분석으로만 보입니다. 작기 중에도 바꿀 수 있고 리포트에 기록됩니다.</p>
      </section>

      <section className="card">
        <h2>실험실 분석 의뢰</h2>
        <div className="blocks">
          {(['feed', 'drain', 'tissue', 'water'] as Lab['kind'][]).map((k) => (
            <div key={k} className="block-row">
              <span>
                <strong>{LAB_NAME[k]}</strong> <span className="muted small">{won(fee(k))}</span>
              </span>
              <button type="button" className="btn btn-small" data-lab={k} disabled={k === 'tissue' && !cropId} onClick={() => session.orderLab(k)}>
                의뢰
              </button>
            </div>
          ))}
        </div>
        {rz.labs.length === 0 ? (
          <p className="muted small">의뢰한 분석이 없습니다.</p>
        ) : (
          [...rz.labs].reverse().map((l, idx) => {
            const left = l.ready - hour;
            return (
              <details key={`${l.kind}-${l.ordered}-${idx}`} className="fold lab">
                <summary>
                  <h3>
                    {LAB_NAME[l.kind]} · {Math.floor(l.ordered / 24) + 1}일째 채취
                  </h3>
                  <span className={`badge ${left > 0 ? '' : 'badge-ok'}`}>{left > 0 ? `${left}시간 남음` : '결과 도착'}</span>
                </summary>
                {left > 0 ? (
                  <p className="muted small">결과를 기다리는 중입니다.</p>
                ) : l.tissue && cropId ? (
                  <TissueTable crop={cropId} tissue={l.tissue} />
                ) : l.ions ? (
                  <>
                    <p className="small">EC {f2(l.ec ?? NaN)} dS/m · pH {f2(l.pH ?? NaN)}</p>
                    <IonTable rows={[{ label: '분석값', v: l.ions }]} />
                  </>
                ) : null}
              </details>
            );
          })
        )}
      </section>

      <section className="card">
        <h2>현장 작업</h2>
        <div className="blocks">
          {!hydro && (
            <div className="block-row">
              <span>
                <strong>점적 라인 세척(산 세척)</strong> <span className="muted small">막힘을 대부분 푼다 · 노동 {f1(P.clog.flushLabor)} h/1000 m²</span>
              </span>
              <button type="button" className="btn btn-small" data-rzwork="flush" onClick={() => session.rzWork('rz/flush')}>세척</button>
            </div>
          )}
          {!hydro && rz.setup.drain === 'closed' && (
            <div className="block-row">
              <span>
                <strong>배액 회수 탱크 비우기</strong> <span className="muted small">염류가 쌓인 회수 배액을 버린다</span>
              </span>
              <button type="button" className="btn btn-small" onClick={() => session.rzWork('rz/dumpDrain')}>비우기</button>
            </div>
          )}
          {hydro && (
            <div className="block-row">
              <span>
                <strong>양액 전량 교체</strong> <span className="muted small">새 급액으로 다시 채운다</span>
              </span>
              <button type="button" className="btn btn-small" data-rzwork="renew" onClick={() => session.rzWork('rz/renew')}>교체</button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// ───────────────────────── 그래프 ─────────────────────────

function Graphs({ view, real }: { view: SessionView; real: boolean }) {
  const rows = view.days.filter((d) => d.rz && d.rz.hours > 0);
  if (rows.length < 2) return <p className="muted">하루 이상 지나면 그래프가 그려집니다.</p>;
  const data = rows.map((d) => {
    const r = d.rz!;
    const h = r.hours || 1;
    return {
      label: `${d.wx.month + 1}/${d.wx.day}`,
      '근권 EC': real ? NaN : +(r.rootEc / h).toFixed(2),
      '급액 EC': r.feed > 0 ? +(r.feedEc / r.feed).toFixed(2) : NaN,
      '배액 EC': r.drain > 0 ? +(r.drainEc / r.drain).toFixed(2) : NaN,
      '근권 pH': real ? NaN : +(r.rootPh / h).toFixed(2),
      '급액 pH': r.feed > 0 ? +(r.feedPh / r.feed).toFixed(2) : NaN,
      '배액 pH': r.drain > 0 ? +(r.drainPh / r.drain).toFixed(2) : NaN,
      급액: +r.feed.toFixed(2),
      배액: +r.drain.toFixed(2),
      흡수: +r.uptake.toFixed(2),
      배액률: r.feed > 0 ? +((100 * r.drain) / r.feed).toFixed(0) : NaN,
      '근권 온도': +(r.rootT / h).toFixed(1),
    };
  });
  return (
    <>
      <p className="muted small">그래프를 누르면 그날 값이 나옵니다(일 평균, 급액·배액은 부피 가중).{real ? ' 현실 모드: 근권 값은 숨김.' : ''}</p>
      <Chart title="EC dS/m" data={data} lines={[['근권 EC', 'var(--accent)'], ['급액 EC', 'var(--cold)', '4 3'], ['배액 EC', 'var(--hot)', '2 2']]} testId="chart-rz-ec" />
      <Chart title="pH" data={data} lines={[['근권 pH', 'var(--accent)'], ['급액 pH', 'var(--cold)', '4 3'], ['배액 pH', 'var(--hot)', '2 2']]} short />
      <Chart title="물 L/m²/일" data={data} lines={[['급액', 'var(--cold)'], ['배액', 'var(--hot)', '4 3'], ['흡수', 'var(--leaf)', '2 2']]} short />
      <Chart title="배액률 %" data={data} lines={[['배액률', 'var(--hot)']]} short />
      <Chart title="근권 온도 °C" data={data} lines={[['근권 온도', 'var(--sun)']]} short />
    </>
  );
}

export function RootzoneScreen({ view }: { view: SessionView }) {
  const [sub, setSub] = useState<Sub>('now');
  const wx = view.wx;
  if (view.status === 'nosave') return <section className="card"><p className="muted">대시보드에서 새 작기를 시작하면 근권·양액을 관리할 수 있습니다.</p></section>;
  if (!wx || !view.save) return <p className="muted">불러오는 중…</p>;
  const rz = wx.rz;
  const crop = wx.crop;
  const cropId = (crop?.cropId ?? view.save.config.crop?.order.cropId ?? null) as CropId | null;
  const living = !!crop && !crop.dead && !crop.ws?.harvested;
  const real = view.save.observationMode === 'realistic';
  const regionId = view.save.config.regionId;
  const dap = crop ? (view.hour - crop.plantedHour) / 24 : 0;
  return (
    <>
      <header className="page-head">
        <h1>근권·양액</h1>
        <span className="badge">{real ? '현실 모드' : '학습 모드'}</span>
      </header>
      <div className="subtabs" role="tablist">
        {SUBS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={sub === id} data-sub={id} onClick={() => setSub(id)}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'now' && <Now rz={rz} crop={living ? cropId : null} real={real} hour={view.hour} dap={dap} />}
      {sub === 'irr' && <IrrEditor rz={rz} living={living} cropId={cropId} regionId={regionId} density={crop?.density ?? 2.5} />}
      {sub === 'nut' && <NutEditor rz={rz} regionId={regionId} cropId={cropId} dap={dap} real={real} />}
      {sub === 'measure' && <Measure rz={rz} view={view} cropId={living ? cropId : null} />}
      {sub === 'graph' && <Graphs view={view} real={real} />}
    </>
  );
}
