import { useEffect, useState } from 'react';
import { ENGINE_DATA } from '../data';
import { defaultPlan, type CropDay, type CucumberVariety, type PlantOrder, type Stress, type WorkPlan, type WorkTask } from '../engine';
import { strip } from '../engine/greenhouse/params';
import type { CropView } from '../sim/protocol';
import { session, type SessionView } from '../sim/session';
import { Chart } from './EnvScreen';
import { Num, Select } from './Num';

interface CropUi {
  cucumber: { density: number; systems: Record<string, { name: string; sowing: string; harvest: string; transplantMonth: number; transplantDay: number; benchYield: number }>; training: { limit: number } };
}
export const CROPS = strip(ENGINE_DATA.crops) as CropUi;
export const VARIETIES = (strip(ENGINE_DATA.varieties) as { cucumber: Record<string, CucumberVariety> }).cucumber;
export const SYSTEMS = CROPS.cucumber.systems;

type Sub = 'now' | 'work' | 'graph';
const SUBS: [Sub, string][] = [['now', '현황'], ['work', '작업'], ['graph', '생육 그래프']];

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);
/** kg m⁻² → kg/10a */
const per10a = (v: number) => Math.round(v * 1000).toLocaleString('ko-KR');

/** 정식 주문 편집기(새 작기 화면과 작물 탭이 함께 쓴다). */
export function OrderEditor({ value, onChange }: { value: PlantOrder; onChange: (o: PlantOrder) => void }) {
  const v = VARIETIES[value.varietyId]!;
  const sys = SYSTEMS[value.system]!;
  return (
    <>
      <p className="muted small">작물: 오이(Cucumber). 딸기·와사비는 다음 단계(3b·3c)에서 열립니다.</p>
      <div className="chips" role="listbox" aria-label="품종 선택">
        {Object.entries(VARIETIES).map(([id, x]) => (
          <button key={id} type="button" role="option" aria-selected={id === value.varietyId} data-variety={id} className="chip" onClick={() => onChange({ ...value, varietyId: id, plan: defaultPlan(x) })}>
            {x.name}
          </button>
        ))}
      </div>
      <div className="region-card">
        <strong>
          {v.name} <span className="muted small">{v.type}{v.real ? '' : ' · 가상 품종'}</span>
        </strong>
        <p className="muted small">{v.desc}</p>
        <dl className="facts">
          <div><dt>마디 암꽃 비율(기준)</dt><dd>{Math.round(v.female * 100)}%</dd></div>
          <div><dt>표준 수확 무게</dt><dd>{v.harvestWeight} g</dd></div>
          <div><dt>곡과 민감도</dt><dd>×{v.curveSens}</dd></div>
          <div><dt>저온 / 고온 내성</dt><dd>{v.coldTol <= 0 ? '강' : '약'} / {v.heatTol > 0 ? '강' : '보통'}</dd></div>
          <div><dt>흰가루 / 노균 저항성</dt><dd>{v.resistance.powderyMildew} / {v.resistance.downyMildew} (5점)</dd></div>
          <div><dt>접목묘 값</dt><dd>{v.seedlingPrice.toLocaleString('ko-KR')}원/주</dd></div>
        </dl>
        <p className="muted small">품종 수치는 계통 특성에 근거한 추정값(EST)입니다.</p>
      </div>
      <Select label="작형(cropping type)" value={value.system} options={Object.entries(SYSTEMS).map(([id, s]) => [id, s.name] as const)} onChange={(system) => onChange({ ...value, system })} testId="crop-system" />
      <p className="muted small">
        {sys.name}: {sys.sowing}, 수확 {sys.harvest}. 정식 권장 {sys.transplantMonth}월 {sys.transplantDay}일 무렵. 작형은 안내용 이름표이고, 결과는 실제로 심은 날짜와 환경이 결정합니다.
      </p>
      <Num label="재식밀도(planting density)" value={value.density} step={0.1} min={1} max={5} unit="주/m²" hint={`10a당 ${Math.round(value.density * 1000).toLocaleString('ko-KR')}주`} onChange={(density) => onChange({ ...value, density })} testId="crop-density" />
    </>
  );
}

export function defaultOrderUi(): PlantOrder {
  return { cropId: 'cucumber', varietyId: 'cheongchun', system: 'semiforcing', density: CROPS.cucumber.density, plan: defaultPlan(VARIETIES.cheongchun!) };
}

function PlantForm() {
  const [order, setOrder] = useState<PlantOrder>(defaultOrderUi());
  const [confirm, setConfirm] = useState(false);
  return (
    <section className="card" data-testid="plant-form">
      <h2>정식(transplanting)</h2>
      <p className="muted small">지금 온실은 비어 있습니다. 품종과 재식밀도를 정하고 정식하면 이 시각부터 작물이 자랍니다.</p>
      <OrderEditor value={order} onChange={setOrder} />
      {confirm ? (
        <div className="confirm" role="alertdialog" aria-label="정식 확인">
          <p>
            <strong>{VARIETIES[order.varietyId]!.name}</strong>을(를) <strong>{order.density} 주/m²</strong>로 지금 정식할까요?
          </p>
          <div className="btn-row">
            <button type="button" className="btn" data-testid="confirm-plant" onClick={() => { session.plantCrop(order); setConfirm(false); }}>
              정식
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>취소</button>
          </div>
        </div>
      ) : (
        <div className="btn-row">
          <button type="button" className="btn" data-testid="plant-now" onClick={() => setConfirm(true)}>지금 정식하기</button>
        </div>
      )}
    </section>
  );
}

/** 2D 작물 그림: 잎은 면적, 과실은 무게에 비례한다(숫자를 그대로 그린 것이며 꾸밈은 없다). */
function PlantIcon({ crop }: { crop: CropView }) {
  const main = crop.leaves.filter((l) => l.lat === 0);
  const lat = crop.leaves.filter((l) => l.lat === 1);
  const n = Math.max(main.length, 6);
  const W = 240;
  const H = 300;
  const y = (i: number) => H - 24 - (i * (H - 48)) / (n - 1 || 1);
  const leafR = (a: number) => 4 + Math.sqrt(a / 0.06) * 22;
  const firstNode = crop.mainNodes - main.length;
  const fruits = crop.fruitList.filter((f) => f.age >= 0 && f.n > 0.05);
  const flowers = crop.fruitList.filter((f) => f.age < 0 && f.age > -4 && f.n > 0.05);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="plant-icon" role="img" aria-label={`오이 한 포기: 잎 ${main.length}장, 달린 과실 ${f1(crop.out.fruits)}개`} data-testid="plant-icon">
      <line x1={W / 2} x2={W / 2} y1={H - 12} y2={y(main.length - 1) - 8} stroke={crop.dead ? 'var(--muted)' : 'var(--leaf)'} strokeWidth={4} strokeLinecap="round" />
      {main.map((l, i) => {
        const r = leafR(l.area);
        const side = i % 2 === 0 ? -1 : 1;
        const old = l.age > 40;
        return <ellipse key={i} cx={W / 2 + side * (r + 6)} cy={y(i)} rx={r} ry={r * 0.55} fill={crop.dead ? 'var(--muted)' : old ? 'var(--sun)' : 'var(--leaf)'} opacity={0.75} />;
      })}
      {lat.slice(0, 12).map((l, i) => {
        const r = leafR(l.area) * 0.7;
        const side = i % 2 === 0 ? 1 : -1;
        return <ellipse key={`l${i}`} cx={W / 2 + side * (r + 48)} cy={H - 40 - i * 16} rx={r} ry={r * 0.5} fill="var(--leaf)" opacity={0.4} />;
      })}
      {fruits.map((f, i) => {
        const idx = f.node > 0 ? f.node - firstNode - 1 : i;
        if (idx < 0 || idx >= n) return null;
        const len = 6 + Math.min(40, Math.sqrt(f.fw) * 2.4);
        const side = idx % 2 === 0 ? 1 : -1;
        return <rect key={`f${i}`} x={W / 2 + side * 10 - 4} y={y(idx) + 2} width={8} height={len} rx={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} opacity={0.45 + 0.55 * Math.min(1, f.n)} />;
      })}
      {flowers.map((f, i) => {
        const idx = f.node - firstNode - 1;
        if (idx < 0 || idx >= n) return null;
        return <circle key={`b${i}`} cx={W / 2 + (idx % 2 === 0 ? 9 : -9)} cy={y(idx)} r={4} fill="var(--sun)" opacity={0.4 + 0.6 * Math.min(1, f.n)} />;
      })}
    </svg>
  );
}

const STRESS_LABEL: [keyof Stress, string][] = [
  ['photo', '광합성'], ['expand', '엽 확장'], ['fruit', '과실 비대'], ['set', '착과'],
  ['water', '수분'], ['nutrient', '양분'], ['sinkFeedback', '당 축적(sink 부족)'], ['tempSet', '착과 온도'], ['tempFruit', '비대 온도'], ['ssr', '동화산물 수급'], ['chill', '저온'], ['heat', '고온'], ['starve', '기아(호흡 부족)'], ['training', '유인 상태'],
];

const DEATH: Record<string, string> = { frost: '동해(얼어 죽음)', chill: '저온 장해', heat: '고온 장해', collapse: '잎이 모두 소실됨' };

function Now({ crop, hour, area }: { crop: CropView; hour: number; area: number }) {
  const o = crop.out;
  const v = VARIETIES[crop.varietyId]!;
  const dap = Math.floor((hour - crop.plantedHour) / 24);
  const stage = crop.dead ? '고사' : crop.firstHarvestHour >= 0 ? '수확 중' : o.fruits > 0.05 ? '착과·비대' : o.flowers > 0.05 ? '개화 전' : crop.pd < 3 ? '활착 중' : '영양생장';
  const total = crop.total;
  const wAll = o.wLeaf + o.wStem + o.wRoot + o.wFruit;
  return (
    <>
      <section className="card" data-testid="crop-status">
        <div className="card-head">
          <h2>{v.name}</h2>
          <span className={`badge ${crop.dead ? 'badge-warn' : ''}`}>{stage} · 정식 후 {dap}일</span>
        </div>
        {crop.dead && <p className="error">작물이 죽었습니다: {DEATH[crop.deathCause] ?? crop.deathCause}. "작업"에서 작기를 정리(철거)한 뒤 다시 심을 수 있습니다.</p>}
        <div className="crop-figure">
          <PlantIcon crop={crop} />
          <div className="metrics metrics-col">
            <div className="metric"><span className="muted small">엽면적지수(LAI)</span><span className="metric-value" data-testid="crop-lai">{f2(o.lai)}</span></div>
            <div className="metric"><span className="muted small">원줄기 마디 / 잎</span><span className="metric-value">{o.nodes}<span className="metric-unit"> / {o.leaves}장</span></span></div>
            <div className="metric"><span className="muted small">달린 과실 / 꽃봉오리</span><span className="metric-value">{f1(o.fruits)}<span className="metric-unit"> / {f1(o.flowers)}</span></span></div>
            <div className="metric"><span className="muted small">가장 큰 과실</span><span className="metric-value">{o.biggestFruit.toFixed(0)}<span className="metric-unit">g</span></span></div>
          </div>
        </div>
        <p className="muted small">그림: 잎 크기 = 엽면적, 초록 막대 = 과실(길이 = 무게), 노란 점 = 곧 필 암꽃, 누런 잎 = 늙은 잎. 과실 수가 소수인 것은 "평균 한 포기" 기준이기 때문입니다.</p>
      </section>

      <section className="card">
        <h2>생육 상태</h2>
        <dl className="facts">
          <div><dt>동화산물 공급/수요(source/sink)</dt><dd>{Math.round(o.ssr * 100)}% <span className="muted small">3일 평균 {Math.round(crop.ssrAvg * 100)}%</span></dd></div>
          <div><dt>도장 지수(절간장 ÷ 기준)</dt><dd>{f2(o.etiolation)} <span className="muted small">줄기 {f1(o.stemLength)} m</span></dd></div>
          <div><dt>다음 마디 암꽃 비율</dt><dd>{Math.round(o.femaleRate * 100)}%</dd></div>
          <div><dt>비엽면적(SLA)</dt><dd>{Math.round(o.sla * 10000)} cm²/g</dd></div>
          <div><dt>저장 당(assimilate pool)</dt><dd>{f1(o.pool)} g/m²</dd></div>
          <div><dt>유인 안 한 새 마디</dt><dd>{crop.untrained} <span className="muted small">한계 {CROPS.cucumber.training.limit}</span></dd></div>
          <div><dt>곁순(1마디 이상 자란 것)</dt><dd>{crop.laterals}개/주</dd></div>
          <div><dt>최근 일적산광량 / 야온</dt><dd>{f1(crop.dliAvg)} mol · {f1(crop.nightAvg)}°C</dd></div>
        </dl>
        <h3>건물중(dry weight) g/m²</h3>
        <div className="stack-bar" role="img" aria-label="기관별 건물중 비율">
          {([['잎', o.wLeaf, 'var(--leaf)'], ['줄기', o.wStem, 'var(--muted)'], ['뿌리', o.wRoot, 'var(--hot)'], ['과실', o.wFruit, 'var(--accent)']] as const).map(([k, w, c]) => (
            <span key={k} style={{ width: `${wAll > 0 ? (w / wAll) * 100 : 0}%`, background: c }} />
          ))}
        </div>
        <p className="muted small">잎 {f1(o.wLeaf)} · 줄기 {f1(o.wStem)} · 뿌리 {f1(o.wRoot)} · 달린 과실 {f1(o.wFruit)}</p>
      </section>

      <section className="card" data-testid="crop-stress">
        <h2>스트레스 계수</h2>
        <p className="muted small">1.00 = 스트레스 없음. 위 네 개는 과정별 합성값(요인들의 곱), 아래는 요인별 값입니다.</p>
        <div className="stress-grid">
          {STRESS_LABEL.map(([k, label], i) => (
            <div key={k} className={`stress ${o.stress[k] < 0.8 ? 'stress-bad' : ''} ${i < 4 ? 'stress-main' : ''}`}>
              <span className="muted small">{label}</span>
              <strong>{f2(o.stress[k])}</strong>
            </div>
          ))}
        </div>
        <p className="muted small">수분·양분은 근권 모델(Phase 4) 전이라 항상 1.00(충분)입니다.</p>
      </section>

      <section className="card" data-testid="crop-yield">
        <h2>수확</h2>
        <div className="metrics">
          <div className="metric"><span className="muted small">상품(곧은 규격과)</span><span className="metric-value" data-testid="yield-top">{per10a(total.top)}<span className="metric-unit">kg/10a</span></span></div>
          <div className="metric"><span className="muted small">중품(곡과·과대과)</span><span className="metric-value">{per10a(total.mid)}<span className="metric-unit">kg/10a</span></span></div>
          <div className="metric"><span className="muted small">비상품</span><span className="metric-value">{per10a(total.cull)}<span className="metric-unit">kg/10a</span></span></div>
          <div className="metric"><span className="muted small">수확 과실 수</span><span className="metric-value">{Math.round(total.count * area).toLocaleString('ko-KR')}<span className="metric-unit">개</span></span></div>
        </div>
        <p className="muted small">
          이 온실({area.toLocaleString('ko-KR')} m²) 실제 수확량 {Math.round((total.top + total.mid) * area).toLocaleString('ko-KR')} kg · 오늘 {Math.round((crop.today.harvest.top + crop.today.harvest.mid) * area)} kg · 퇴화한 어린 과실 {Math.round(crop.abortedTotal * area).toLocaleString('ko-KR')}개
          {crop.firstHarvestHour >= 0 && ` · 첫 수확 정식 후 ${Math.round((crop.firstHarvestHour - crop.plantedHour) / 24)}일`}
        </p>
        <p className="muted small">참고(반촉성 농가 평균, 농산물소득자료집): {SYSTEMS.semiforcing!.benchYield.toLocaleString('ko-KR')} kg/10a. 지금 모델에는 병해충·양수분 부족이 없어서 평균 농가보다 높게 나옵니다.</p>
      </section>
    </>
  );
}

const TASKS: [WorkTask, string, string][] = [['train', '유인·곁순 정리', '새 마디를 줄에 감고 곁순·아랫마디 암꽃을 정리합니다.'], ['deleaf', '적엽', '아래 늙은 잎을 따서 정한 잎 수만 남깁니다.'], ['harvest', '수확', '기준 무게를 넘은 과실을 땁니다.'], ['pinch', '적심', '원줄기 생장점을 자릅니다. 되돌릴 수 없습니다.']];

function Work({ crop }: { crop: CropView }) {
  const [draft, setDraft] = useState<WorkPlan>(crop.plan);
  const [confirm, setConfirm] = useState<string | null>(null);
  const saved = JSON.stringify(crop.plan);
  useEffect(() => setDraft(JSON.parse(saved) as WorkPlan), [saved]);
  const dirty = JSON.stringify(draft) !== saved;
  const set = <K extends keyof WorkPlan>(k: K, v: WorkPlan[K]) => setDraft({ ...draft, [k]: v });
  const v = VARIETIES[crop.varietyId]!;
  const labor = Object.entries(crop.laborHours);
  const LABEL: Record<string, string> = { plant: '정식', train: '유인', deleaf: '적엽', thin: '적과·적화', pinch: '적심', harvest: '수확' };
  return (
    <>
      <section className="card" data-testid="work-plan">
        <h2>작업 계획(반복)</h2>
        <p className="muted small">정해 둔 간격마다 아침 7시에 작업합니다. 간격을 0으로 두면 그 작업을 하지 않습니다(방치).</p>
        <h3>유인(training)</h3>
        <Num label="유인·곁순 정리 간격" value={draft.trainEvery} min={0} max={30} unit="일" onChange={(x) => set('trainEvery', x)} testId="plan-train" />
        <Num label="곁순 남길 마디" value={draft.lateralKeep} min={0} max={4} unit="마디" hint="0 = 모두 제거" onChange={(x) => set('lateralKeep', x)} />
        <Num label="아랫마디 암꽃 제거(적화)" value={draft.removeBelowNode} min={0} max={15} unit="마디까지" onChange={(x) => set('removeBelowNode', x)} />
        <Num label="포기당 과실 상한(적과)" value={draft.maxFruit} min={0} max={12} unit="개" hint="0 = 제한 없음" onChange={(x) => set('maxFruit', x)} />
        <Num label="적심할 마디" value={draft.pinchNode} min={0} max={120} unit="마디" hint="0 = 적심 안 함(줄내림 재배)" onChange={(x) => set('pinchNode', x)} />
        <h3>적엽(deleafing)</h3>
        <Num label="적엽 간격" value={draft.deleafEvery} min={0} max={30} unit="일" onChange={(x) => set('deleafEvery', x)} testId="plan-deleaf" />
        <Num label="남길 원줄기 잎 수" value={draft.leavesKeep} min={6} max={40} unit="장" onChange={(x) => set('leavesKeep', x)} />
        <h3>수확(harvest)</h3>
        <Num label="수확 간격" value={draft.harvestEvery} min={0} max={7} unit="일" onChange={(x) => set('harvestEvery', x)} testId="plan-harvest" />
        <Num label="수확 기준 무게" value={draft.harvestWeight} step={10} min={0} max={400} unit="g" hint={`0 = 품종 표준 ${v.harvestWeight} g`} onChange={(x) => set('harvestWeight', x)} />
        {dirty &&
          (confirm === 'plan' ? (
            <div className="confirm" role="alertdialog" aria-label="작업 계획 변경 확인">
              <p>작업 계획을 바꿀까요? 다음 작업 시각부터 적용됩니다.</p>
              <div className="btn-row">
                <button type="button" className="btn" data-testid="confirm-plan" onClick={() => { session.setPlan(draft); setConfirm(null); }}>적용</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setDraft(crop.plan); setConfirm(null); }}>되돌리기</button>
              </div>
            </div>
          ) : (
            <div className="btn-row">
              <button type="button" className="btn" data-testid="apply-plan" onClick={() => setConfirm('plan')}>변경 적용</button>
            </div>
          ))}
      </section>

      <section className="card">
        <h2>지금 바로 작업</h2>
        {TASKS.map(([task, label, desc]) => (
          <div key={task} className="toggle-row">
            <span>
              {label} <span className="muted small">{desc}</span>
            </span>
            <button type="button" className="btn btn-small" data-work={task} disabled={crop.dead || (task === 'pinch' && crop.pinched)} onClick={() => (task === 'pinch' ? setConfirm('pinch') : session.cropWork(task))}>
              {task === 'pinch' && crop.pinched ? '완료' : '실행'}
            </button>
          </div>
        ))}
        {confirm === 'pinch' && (
          <div className="confirm" role="alertdialog" aria-label="적심 확인">
            <p>원줄기를 적심하면 새 마디가 더 나오지 않습니다. 계속할까요?</p>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => { session.cropWork('pinch'); setConfirm(null); }}>적심</button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>취소</button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>노동 시간(누적)</h2>
        <dl className="facts">
          {labor.map(([k, h]) => (
            <div key={k}><dt>{LABEL[k] ?? k}</dt><dd>{h.toFixed(0)} 시간</dd></div>
          ))}
          <div><dt>합계</dt><dd>{labor.reduce((a, [, h]) => a + h, 0).toFixed(0)} 시간</dd></div>
        </dl>
        <p className="muted small">작업마다 노동 시간이 쌓입니다. 인건비와 일손 부족은 이후 Phase(작업·경제)에서 연결됩니다.</p>
      </section>

      <section className="card">
        <h2>작기 종료</h2>
        {confirm === 'remove' ? (
          <div className="confirm" role="alertdialog" aria-label="작기 종료 확인">
            <p>작물을 모두 뽑아내고 온실을 비울까요? 되돌릴 수 없습니다. (수확 기록은 그래프에 남습니다)</p>
            <div className="btn-row">
              <button type="button" className="btn" data-testid="confirm-remove" onClick={() => { session.removeCrop(); setConfirm(null); }}>철거</button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>취소</button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" data-testid="remove-crop" onClick={() => setConfirm('remove')}>작물 철거</button>
          </div>
        )}
      </section>
    </>
  );
}

function Graphs({ view }: { view: SessionView }) {
  const rows = view.days.filter((d) => d.crop);
  if (rows.length < 2) return <section className="card"><p className="muted">정식 후 이틀이 지나면 그래프가 나옵니다.</p></section>;
  let cum = 0;
  const data = rows.map((d) => {
    const c = d.crop as CropDay;
    const market = (c.harvest.top + c.harvest.mid) * 1000;
    cum += market;
    return {
      label: `${d.wx.month + 1}/${d.wx.day}`,
      LAI: +c.lai.toFixed(2),
      '과실 생장': +c.gFruit.toFixed(1),
      '잎·줄기·뿌리 생장': +(c.gLeaf + c.gStem + c.gRoot).toFixed(1),
      총광합성: +c.gross.toFixed(1),
      호흡: +(c.maint + c.growthResp).toFixed(1),
      '공급/수요': c.demand > 0 ? +Math.min(1, c.supply / c.demand).toFixed(2) : 1,
      '달린 과실': +c.fruits.toFixed(1),
      '퇴화 과실': +c.aborted.toFixed(2),
      '일 수확': Math.round(market),
      '누적 수확': Math.round(cum),
      광합성: +c.sPhoto.toFixed(2),
      착과: +c.sSet.toFixed(2),
      비대: +c.sFruit.toFixed(2),
    };
  });
  return (
    <>
      <p className="muted small">그래프를 누르면 그날 값이 나옵니다. 하루 단위 값이며 작기 전체를 보여줍니다.</p>
      <Chart title="엽면적지수(LAI)" data={data} lines={[['LAI', 'var(--leaf)']]} testId="chart-lai" short />
      <Chart title="건물 생장 g/m²/일" data={data} lines={[['과실 생장', 'var(--accent)'], ['잎·줄기·뿌리 생장', 'var(--leaf)', '4 3']]} testId="chart-growth" />
      <Chart title="탄소 수지 g CH2O/m²/일" data={data} lines={[['총광합성', 'var(--sun)'], ['호흡', 'var(--hot)', '4 3']]} />
      <Chart title="동화산물 공급/수요와 달린 과실 수" data={data} lines={[['공급/수요', 'var(--cold)'], ['달린 과실', 'var(--accent)', '4 3'], ['퇴화 과실', 'var(--hot)', '2 2']]} />
      <Chart title="일 수확량 kg/10a" data={data} lines={[['일 수확', 'var(--accent)']]} testId="chart-harvest" short />
      <Chart title="누적 수확량 kg/10a" data={data} lines={[['누적 수확', 'var(--accent)']]} short />
      <Chart title="스트레스 계수(일평균)" data={data} lines={[['광합성', 'var(--sun)'], ['착과', 'var(--hot)'], ['비대', 'var(--cold)', '4 3']]} domain={[0, 1]} short />
    </>
  );
}

export function CropScreen({ view }: { view: SessionView }) {
  const [sub, setSub] = useState<Sub>('now');
  const wx = view.wx;
  if (view.status === 'nosave') return <section className="card"><p className="muted">대시보드에서 새 작기를 시작하면 작물을 심을 수 있습니다.</p></section>;
  if (!wx) return <p className="muted">불러오는 중…</p>;
  const crop = wx.crop;
  return (
    <>
      <header className="page-head">
        <h1>작물</h1>
        {crop && <span className="badge">오이 · {crop.density} 주/m²</span>}
      </header>
      <div className="subtabs" role="tablist">
        {SUBS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={sub === id} data-sub={id} onClick={() => setSub(id)}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'graph' ? <Graphs view={view} /> : !crop ? <PlantForm /> : sub === 'now' ? <Now crop={crop} hour={view.hour} area={wx.gh.setup.area} /> : <Work crop={crop} />}
    </>
  );
}
