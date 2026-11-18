/**
 * Phase 5 화면: 작업 일정·노동, 생리장해, 생장조절제(PGR).
 * 숫자는 엔진이 계산한 값을 그대로 보여준다. 현실 모드에서는 생리장해를 순찰(스카우팅)한 결과만 보인다.
 */
import { useEffect, useState } from 'react';
import { PHYS_PARAMS, LABOR_PARAMS } from '../data';
import type { CropId, LaborSettings, PgrMethod, Skill, WorkTask } from '../engine';
import type { CropView, PhysView, WxView } from '../sim/protocol';
import { session, type SessionView } from '../sim/session';
import { dateLabel, won } from './format';
import { Num, Select } from './Num';

const f2 = (v: number) => v.toFixed(2);
const f1 = (v: number) => v.toFixed(1);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function taskName(crop: CropId, t: WorkTask | string): string {
  const base: Record<string, string> = { harvest: '수확', train: '유인·곁순 정리', deleaf: '적엽', pinch: '적심', bees: '벌통 관리', thin: '적화', runner: '런너 제거' };
  if (crop === 'wasabi') return ({ thin: '꽃대 수확', runner: '분얼 정리', harvest: '근경 수확' } as Record<string, string>)[t] ?? base[t] ?? t;
  return base[t] ?? t;
}

/** 2D 그림용 증상 강도(학습 모드 = 실제 발생률, 현실 모드 = 마지막 순찰 결과). */
export interface Symptoms {
  young: number;
  upper: number;
  old: number;
  apex: number;
}

export function symptomsOf(phys: PhysView | undefined, crop: CropView, real: boolean): Symptoms {
  const s: Symptoms = { young: 0, upper: 0, old: 0, apex: 0 };
  if (!phys) return s;
  const defs = PHYS_PARAMS.dis[crop.cropId];
  for (const [k, d] of Object.entries(defs)) {
    const I = real ? phys.scout?.obs[k]?.I ?? 0 : phys.dis[k]?.I ?? 0;
    if (d.mode === 'apex') s.apex = Math.max(s.apex, I);
    else if (d.mode === 'leaf' || (d.mode === 'record' && (k === 'ws_scorch' || k === 'cu_scorch'))) {
      const t = (d.target || 'upper') as keyof Symptoms;
      if (t in s) s[t] = Math.max(s[t], I);
    }
  }
  return s;
}

// ───────────────────────── 작업 일정·노동 ─────────────────────────

const SKILLS: readonly (readonly [Skill, string])[] = [['novice', `초보(${LABOR_PARAMS.skill.novice}배)`], ['normal', '숙련(1배)'], ['expert', `장기 숙련(${LABOR_PARAMS.skill.expert}배)`]];

export function LaborPanel({ view }: { view: SessionView }) {
  const wx = view.wx as WxView;
  const L = wx.labor;
  const crop = wx.crop;
  const [draft, setDraft] = useState<LaborSettings>(L.set);
  const [confirm, setConfirm] = useState(false);
  const setKey = JSON.stringify(L.set);
  useEffect(() => setDraft(L.set), [setKey]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(L.set);
  const set = <K extends keyof LaborSettings>(k: K, v: LaborSettings[K]) => setDraft({ ...draft, [k]: v });
  const capNew = draft.owners * draft.ownerHours + draft.workers * draft.workerHours * (LABOR_PARAMS.skill[draft.skill] ?? 1);
  const cropId = crop?.cropId ?? 'cucumber';
  const due = L.tasks.filter((t) => t.due);
  const upcoming = L.tasks.filter((t) => !t.due);
  const dueH = due.reduce((a, t) => a + t.est, 0);
  const lateList = Object.entries(L.lateSince) as [WorkTask, number][];
  const today = Math.floor(view.hour / 24);
  return (
    <>
      <section className="card" data-testid="labor-today">
        <h2>오늘 일정</h2>
        <div className="metrics">
          <div className="metric"><span className="muted small">가용 시간</span><span className="metric-value">{f1(L.cap)}<span className="metric-unit">시간</span></span><span className="muted small">자가 {L.set.owners}명 · 고용 {L.set.workers}명{L.hired > 0 ? ` · 일용 ${L.hired}명` : ''}</span></div>
          <div className="metric" data-warn={L.over > 0 ? '1' : undefined}><span className="muted small">쓴 시간</span><span className="metric-value">{f1(L.used)}<span className="metric-unit">시간</span></span><span className="muted small">{L.over > 0 ? `초과 ${f1(L.over)}시간` : `남은 ${f1(L.left)}시간`}</span></div>
          <div className="metric" data-warn={dueH > L.left + 0.01 && due.length > 0 ? '1' : undefined}><span className="muted small">오늘 할 일 예상</span><span className="metric-value">{f1(dueH)}<span className="metric-unit">시간</span></span><span className="muted small">작업 시각 {String(7).padStart(2, '0')}:00</span></div>
        </div>
        {!crop ? (
          <p className="muted">작물을 심으면 작업 일정이 나옵니다.</p>
        ) : (
          <ul className="task-list" aria-label="오늘 할 일">
            {due.length === 0 && <li className="muted">오늘 예정된 작업이 없습니다.</li>}
            {due.map((t) => (
              <li key={t.task} data-task={t.task} data-late={t.late > 0 ? '1' : undefined}>
                <strong>{taskName(cropId, t.task)}</strong>
                <span>{f1(t.est)}시간</span>
                <span className="muted small">{t.late > 0 ? `${t.late}일 밀림` : `${t.every}일마다`}</span>
              </li>
            ))}
          </ul>
        )}
        {L.deferred.length > 0 && (
          <p className="warn-text" data-testid="labor-deferred">
            일손이 모자라 미룬 작업: {L.deferred.map((t) => taskName(cropId, t)).join(', ')}
            {L.harvestFrac < 1 ? ` — 익은 과실의 ${pct(L.harvestFrac)}만 땄습니다(남은 과실은 더 커지거나 과숙합니다).` : ''}
          </p>
        )}
        <p className="muted small">작업 순서: 수확 → 유인 → 적엽 → 그 밖의 작업. 남은 시간이 모자라면 뒤 작업부터 미루고, 수확은 할 수 있는 만큼만 합니다. 작업 탭의 "지금 바로 작업"은 시간이 모자라도 하며, 넘친 시간은 초과 근무로 남습니다.</p>
      </section>

      {crop && (
        <section className="card">
          <h2>밀린 작업</h2>
          {lateList.length === 0 ? (
            <p className="muted">밀린 작업이 없습니다.</p>
          ) : (
            <ul className="task-list">
              {lateList.map(([t, d]) => (
                <li key={t} data-late="1">
                  <strong>{taskName(cropId, t)}</strong>
                  <span>{today - d}일째</span>
                  <span className="muted small">{t === 'harvest' ? '과실이 커지거나 과숙 → 상품률↓' : t === 'deleaf' ? '잎이 빽빽 → 그늘·다습(병 위험은 Phase 6에서 연결)' : t === 'train' ? '유인 지연 → 곡과·엽 겹침' : '생육 관리 지연'}</span>
                </li>
              ))}
            </ul>
          )}
          {upcoming.length > 0 && (
            <>
              <h3>다가오는 작업</h3>
              <ul className="task-list">
                {upcoming.map((t) => (
                  <li key={t.task}>
                    <strong>{taskName(cropId, t.task)}</strong>
                    <span>{t.every - (today - t.last)}일 뒤</span>
                    <span className="muted small">약 {f1(t.est)}시간</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2>노동력</h2>
        <h3>자가 노동</h3>
        <Num label="인원" value={draft.owners} min={0} max={10} unit="명" onChange={(v) => set('owners', v)} testId="labor-owners" />
        <Num label="1인 하루 작업 시간" value={draft.ownerHours} step={0.5} min={0} max={16} unit="시간" onChange={(v) => set('ownerHours', v)} testId="labor-owner-hours" />
        <h3>고용 인력(상시)</h3>
        <Num label="인원" value={draft.workers} min={0} max={20} unit="명" hint="매일 일당이 나갑니다" onChange={(v) => set('workers', v)} testId="labor-workers" />
        <Num label="1인 하루 작업 시간" value={draft.workerHours} step={0.5} min={1} max={12} unit="시간" onChange={(v) => set('workerHours', v)} />
        <Num label="일당" value={draft.wage} step={5000} min={60000} max={300000} unit="원" onChange={(v) => set('wage', v)} />
        <Select label="숙련도" value={draft.skill} options={SKILLS} onChange={(v) => set('skill', v)} />
        <h3>일용 인력(자동)</h3>
        <Num label="일이 밀리는 날 부를 최대 인원" value={draft.autoHire} min={0} max={20} unit="명" hint="0 = 부르지 않음. 부른 날만 일당" onChange={(v) => set('autoHire', v)} testId="labor-auto" />
        <p className="muted small">하루 가용 시간 {f1(capNew)}시간(일용 제외). 숙련도는 고용 인력의 작업 속도 배수입니다.</p>
        {dirty &&
          (confirm ? (
            <div className="confirm" role="alertdialog" aria-label="노동력 변경 확인">
              <p>노동력 설정을 바꿀까요? 지금부터 적용되고, 새로 고용한 인원은 오늘 일당이 나갑니다.</p>
              <div className="btn-row">
                <button type="button" className="btn" data-testid="confirm-labor" onClick={() => { session.setLabor(draft); setConfirm(false); }}>적용</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setDraft(L.set); setConfirm(false); }}>되돌리기</button>
              </div>
            </div>
          ) : (
            <div className="btn-row">
              <button type="button" className="btn" data-testid="apply-labor" onClick={() => setConfirm(true)}>변경 적용</button>
            </div>
          ))}
      </section>

      <section className="card">
        <h2>최근 14일</h2>
        <dl className="facts">
          <div><dt>누적 노동</dt><dd>{L.cum.used.toFixed(0)} 시간</dd></div>
          <div><dt>고용 노동</dt><dd>{L.cum.hired.toFixed(0)} 시간(일용 연 {L.cum.days ?? 0}명)</dd></div>
          <div><dt>인건비 누적</dt><dd>{won(L.cum.wage)}</dd></div>
        </dl>
        <ul className="task-list small">
          {[...L.hist].reverse().map((d) => (
            <li key={d.d} data-late={d.late.length ? '1' : undefined}>
              <strong>{d.d + 1}일차</strong>
              <span>{f1(d.used)} / {f1(d.cap)}시간{d.hired ? ` (+일용 ${d.hired})` : ''}</span>
              <span className="muted small">{d.late.length ? `미룸: ${d.late.map((t) => taskName(cropId, t)).join(', ')}${d.hf < 1 ? ` · 수확 ${pct(d.hf)}` : ''}` : '밀림 없음'}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ───────────────────────── 생리장해 ─────────────────────────

export function DisorderPanel({ view }: { view: SessionView }) {
  const wx = view.wx as WxView;
  const crop = wx.crop!;
  const P = wx.phys;
  const real = view.save?.observationMode === 'realistic';
  const defs = PHYS_PARAMS.dis[crop.cropId];
  const scoutH = (PHYS_PARAMS.dis.scoutLabor * wx.gh.setup.area) / 1000;
  const sc = P.scout;
  const cfg = view.save?.config;
  return (
    <>
      <section className="card">
        <h2>순찰(스카우팅)</h2>
        <p className="muted small">한 번 돌아보는 데 {f1(scoutH)}시간. 발생률이 {pct(PHYS_PARAMS.dis.detect)} 이상이고 겉으로 보이는 장해만 찾을 수 있습니다(쓴맛과·근경 속 갈변은 수확해야 드러남).</p>
        <div className="btn-row">
          <button type="button" className="btn" data-testid="phys-scout" disabled={crop.dead || P.scoutPending} onClick={() => session.scoutPhys()}>{P.scoutPending ? '순찰 지시함' : '지금 순찰'}</button>
        </div>
        {sc && cfg && <p className="muted small">마지막 순찰: {dateLabel(cfg, sc.hour).date} {dateLabel(cfg, sc.hour).time}</p>}
        {real && <p className="muted small">현실 모드: 아래 카드는 마지막 순찰 결과만 보여줍니다.</p>}
      </section>
      {Object.entries(defs).map(([k, d]) => {
        const st = P.dis[k];
        const obs = sc?.obs[k];
        const I = real ? obs?.I ?? 0 : st?.I ?? 0;
        const R = st?.R ?? 0;
        const hidden = real && !d.visible;
        const drv = st ? Object.entries(st.drv).sort((a, b) => b[1][1] - a[1][1]) : [];
        return (
          <section key={k} className="card disorder" data-dis={k} data-warn={I >= PHYS_PARAMS.dis.detect ? '1' : undefined}>
            <div className="card-head">
              <h2>{d.name} <span className="muted small">({d.en})</span></h2>
              {hidden ? <span className="badge">수확 때 판정</span> : <span className={I >= 0.1 ? 'badge badge-warn' : 'badge'}>{real && !sc ? '미순찰' : `발생 ${pct(I)}`}</span>}
            </div>
            <p className="small">{d.symptom}</p>
            <p className="muted small">원인: {d.cause}</p>
            {!real && st && (
              <>
                <div className="risk-bar" aria-label={`위험 지수 ${f2(R)}`}>
                  <div style={{ width: `${Math.min(100, (R / 2) * 100)}%` }} data-over={R >= 1 ? '1' : undefined} />
                  <span>위험 지수 R {f2(R)} {R >= 1 ? '— 발생 조건' : ''}</span>
                </div>
                {drv.length > 0 && (
                  <dl className="facts small">
                    {drv.map(([n, [v, c]]) => (
                      <div key={n}><dt>{n}</dt><dd>{Math.abs(v) < 10 ? f2(v) : f1(v)} → R 기여 {f2(c)}</dd></div>
                    ))}
                  </dl>
                )}
                <p className="muted small">심각도 {pct(st.sev)} · 누적 피해 {lossText(d.mode, k, st.loss)}{st.onset >= 0 && cfg ? ` · 첫 발생 ${dateLabel(cfg, st.onset).date}` : ''}</p>
              </>
            )}
            {real && obs && !hidden && <p className="muted small">관찰 심각도 {pct(obs.sev)}</p>}
          </section>
        );
      })}
      {!real && P.log.length > 0 && (
        <section className="card">
          <h2>인과 원장(최근)</h2>
          <p className="muted small">원인 변수 → 위험 지수 → 발생 → 피해량. 하루 단위로 기록되며 작기 리포트(Phase 8)에서 씁니다.</p>
          <ul className="task-list small">
            {[...P.log].reverse().slice(0, 12).map((e, i) => (
              <li key={i}>
                <strong>{e.d + 1}일차 {defs[e.k]?.name ?? e.k}</strong>
                <span>R 최대 {f2(e.rMax)} · {e.hours}시간</span>
                <span className="muted small">{Object.entries(e.drv).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n).join(', ') || '—'} → 발생 {pct(e.I)} → 피해 {lossText(defs[e.k]?.mode ?? 'record', e.k, e.loss)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function lossText(mode: string, k: string, v: number): string {
  if (mode === 'leaf' || k === 'ws_scorch') return `잎 ${(v * 10000).toFixed(0)} cm²/m²`;
  if (mode === 'apex') return `마디 ${v.toFixed(1)}개/포기`;
  if (mode === 'record' && !['cu_curved', 'ws_scorch'].includes(k)) return '작물 모델에 반영';
  return `${(v * 1000).toFixed(0)} kg/10a 등급 하락`;
}

// ───────────────────────── 생장조절제 ─────────────────────────

const METHOD_NAME: Record<PgrMethod, string> = { foliar: '경엽 살포', drench: '관주', spot: '꽃·화방 처리' };

export function PgrPanel({ view }: { view: SessionView }) {
  const wx = view.wx as WxView;
  const crop = wx.crop!;
  const P = wx.phys;
  const products = PHYS_PARAMS.pgr.products;
  const ids = Object.keys(products);
  const [id, setId] = useState(ids[0]!);
  const pr = products[id]!;
  const [method, setMethod] = useState<PgrMethod>(pr.methods[0]!);
  const reg = pr.reg[crop.cropId];
  const [ppm, setPpm] = useState<number>(reg?.dose?.max ?? 10);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setMethod(products[id]!.methods[0]!);
    setPpm(products[id]!.reg[crop.cropId]?.dose?.max ?? (id === 'ethephon' ? 150 : id === 'prohex' ? 100 : id === 'naa' ? 20 : id === 'cppu' ? 5 : 10));
  }, [id, crop.cropId, products]);
  const area = wx.gh.setup.area;
  const m = PHYS_PARAMS.pgr.methods[method];
  const grams = (ppm * m.volume * area) / 1000;
  const registered = reg?.status === 'registered';
  const over = !!(reg?.dose && ppm > reg.dose.max);
  const effects = pr.effects[crop.cropId] ?? [];
  const tox = pr.tox[crop.cropId];
  return (
    <>
      <section className="card">
        <h2>생장조절제 처리</h2>
        <div className="chips" role="listbox" aria-label="약제 선택">
          {ids.map((x) => (
            <button key={x} type="button" role="option" aria-selected={x === id} data-pgr={x} className="chip" onClick={() => setId(x)}>
              {products[x]!.name}
            </button>
          ))}
        </div>
        <p className="small">
          <span className={registered ? 'badge badge-ok' : 'badge badge-warn'} data-testid="pgr-reg">{registered ? '등록' : '미등록 — PLS 위험'}</span> {reg?.use || ''}
          {reg?.dose ? ` · 라벨 ${reg.dose.min}–${reg.dose.max} ppm` : ''}
        </p>
        {reg?.note && <p className="muted small">{reg.note}</p>}
        <Select label="처리 방법" value={method} options={pr.methods.map((x) => [x, METHOD_NAME[x]] as const)} onChange={setMethod} />
        <Num label="농도(유효성분)" value={ppm} step={1} min={0} max={2000} unit="ppm" hint="mg/L" onChange={setPpm} testId="pgr-ppm" />
        <dl className="facts small">
          <div><dt>약량·비용</dt><dd>{grams.toFixed(2)} g · {won(grams * pr.price)}</dd></div>
          <div><dt>노동</dt><dd>{f1((m.labor * area) / 1000)}시간</dd></div>
          <div><dt>체내 반감기</dt><dd>{pr.halfLife}일</dd></div>
          {tox && <div><dt>약해 문턱</dt><dd>체내 활성 {tox.thr} ppm 환산</dd></div>}
        </dl>
        {effects.length > 0 ? (
          <ul className="small">
            {effects.map((e, i) => (
              <li key={i}>{FX_NAME[e.target] ?? e.target}: 최대 {e.emax > 0 ? '+' : ''}{e.target === 'female' || e.target === 'set' ? pct(e.emax) : e.target === 'dorm' || e.target === 'bolt' || e.target === 'senesce' || e.target === 'malform' ? `${e.emax}/일` : pct(e.emax)}, 절반 효과 {e.ec50} ppm</li>
            ))}
          </ul>
        ) : (
          <p className="muted small">이 작물에서 확인된 효과가 없습니다(약해·잔류만 생깁니다).</p>
        )}
        {(!registered || over) && <p className="warn-text">{!registered ? '이 작물에 등록되지 않은 약제입니다. 수확물 잔류가 0.01 mg/kg을 넘으면 PLS 부적합 위험으로 기록됩니다.' : '라벨 농도보다 진합니다(사용 기준 위반·약해 위험).'}</p>}
        {confirm ? (
          <div className="confirm" role="alertdialog" aria-label="생장조절제 처리 확인">
            <p>{pr.name} {ppm} ppm을 {METHOD_NAME[method]}할까요? 되돌릴 수 없습니다.</p>
            <div className="btn-row">
              <button type="button" className="btn" data-testid="confirm-pgr" onClick={() => { session.applyPgr(id, ppm, method); setConfirm(false); }}>처리</button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>취소</button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            <button type="button" className="btn" data-testid="apply-pgr" disabled={crop.dead || !(ppm > 0)} onClick={() => setConfirm(true)}>처리</button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>지금 작용 중</h2>
        <ActiveList P={P} />
        <dl className="facts small">
          <div><dt>절간 신장</dt><dd>× {f2(P.fx.internode)}</dd></div>
          <div><dt>엽 확장</dt><dd>× {f2(P.fx.expand)}</dd></div>
          {crop.cropId === 'cucumber' && <div><dt>암꽃 비율 가감</dt><dd>{P.fx.female >= 0 ? '+' : ''}{pct(P.fx.female)}</dd></div>}
          {crop.cropId === 'cucumber' && <div><dt>착과(퇴화 감소)</dt><dd>{P.fx.set >= 0 ? '+' : ''}{pct(P.fx.set)}</dd></div>}
          <div><dt>마디 생성</dt><dd>× {f2(P.fx.node * (1 - P.fx.arrest))}</dd></div>
          {crop.cropId === 'strawberry' && <div><dt>휴면 해제</dt><dd>{pct(P.fx.dorm)}/일 · 런너 × {f2(P.fx.runner)}</dd></div>}
          {crop.cropId === 'wasabi' && <div><dt>춘화 대체</dt><dd>{f2(P.fx.bolt)}일/일</dd></div>}
          <div><dt>뿌리 생장</dt><dd>× {f2(P.fx.root)}</dd></div>
        </dl>
      </section>

      <section className="card">
        <h2>PLS·잔류</h2>
        <dl className="facts small">
          <div><dt>미등록 처리 횟수</dt><dd>{P.pls.events}회</dd></div>
          <div><dt>현재 미등록 잔류(최대)</dt><dd>{P.pls.residue.toFixed(3)} mg/kg {P.pls.residue > PHYS_PARAMS.pgr.pls.mrl ? '— 기준 초과' : ''}</dd></div>
          <div><dt>부적합 위험 수확량</dt><dd>{(P.pls.kgRisk * 1000).toFixed(0)} kg/10a</dd></div>
          <div><dt>약제비·노동 누적</dt><dd>{won(P.won)} · {f1(P.hours)}시간</dd></div>
        </dl>
        <p className="muted small">실제 단속(출하 전 잔류 검사)은 시장·판매 Phase(7)에서 확률 사건으로 연결됩니다. 지금은 위험 수확량만 기록합니다.</p>
      </section>
    </>
  );
}

const FX_NAME: Record<string, string> = { expand: '엽 확장', internode: '절간 신장', female: '암꽃 비율', node: '마디 생성', dorm: '휴면 해제', runner: '런너 발생', set: '착과(퇴화 감소)', fruitGrow: '어린 과실 비대', root: '뿌리 생장', bolt: '추대(춘화 대체)', senesce: '잎 노화', malform: '기형과', soft: '과실 무름', bitter: '쓴맛과', curved: '곡과' };

function ActiveList({ P }: { P: PhysView }) {
  const act = Object.entries(P.pgr).filter(([, a]) => a.plant > 0.05 || a.flower > 0.05 || a.residue > 0.001);
  if (!act.length) return <p className="muted">작용 중인 생장조절제가 없습니다.</p>;
  return (
    <ul className="task-list small">
      {act.map(([id, a]) => (
        <li key={id} data-pgr-active={id} data-warn={(P.tox[id] ?? 0) > 0.05 ? '1' : undefined}>
          <strong>{PHYS_PARAMS.pgr.products[id]?.name ?? id}</strong>
          <span>체내 {f1(a.plant)} / 꽃 {f1(a.flower)} ppm</span>
          <span className="muted small">{(P.tox[id] ?? 0) > 0.05 ? `약해 ${pct(P.tox[id]!)}` : '약해 없음'} · 잔류 {a.residue.toFixed(3)} mg/kg</span>
        </li>
      ))}
    </ul>
  );
}
