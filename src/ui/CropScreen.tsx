import { useEffect, useState } from 'react';
import { ENGINE_DATA } from '../data';
import { defaultPlan, defaultPlanSb, defaultPlanWs, type BeeType, type CropDay, type CropId, type CucumberVariety, type PlantOrder, type StrawberryVariety, type Stress, type WasabiVariety, type WorkPlan, type WorkTask } from '../engine';
import { strip } from '../engine/greenhouse/params';
import type { CropView } from '../sim/protocol';
import { session, type SessionView } from '../sim/session';
import { Chart } from './EnvScreen';
import { Num, Select, Toggle } from './Num';

interface SystemUi { name: string; sowing: string; harvest: string; transplantMonth: number; transplantDay: number; benchYield: number }
type Recommend = Record<string, number>;
interface CropUi {
  cucumber: { recommend: Recommend; density: number; systems: Record<string, SystemUi>; training: { limit: number } };
  strawberry: { recommend: Recommend; density: number; systems: Record<string, SystemUi>; fruit: { maturity: number; topWeight: number; midWeight: number }; induction: { critical: number } };
  wasabi: { recommend: Recommend; density: number; systems: Record<string, SystemUi>; rhizome: { market: number; premium: number }; bolting: { vernDays: number }; dev: { tOpt: number; tMax: number } };
}
export const CROPS = strip(ENGINE_DATA.crops) as CropUi;
const ALL_VARIETIES = strip(ENGINE_DATA.varieties) as { cucumber: Record<string, CucumberVariety>; strawberry: Record<string, StrawberryVariety>; wasabi: Record<string, WasabiVariety> };
export const WS_VARIETIES = ALL_VARIETIES.wasabi;
export const VARIETIES = ALL_VARIETIES.cucumber;
export const SB_VARIETIES = ALL_VARIETIES.strawberry;
export const SYSTEMS = CROPS.cucumber.systems;
const CROP_NAME: Record<CropId, string> = { cucumber: '오이', strawberry: '딸기', wasabi: '와사비' };
const varietyName = (crop: CropId, id: string) => (crop === 'strawberry' ? SB_VARIETIES[id]?.name : crop === 'wasabi' ? WS_VARIETIES[id]?.name : VARIETIES[id]?.name) ?? id;

type Sub = 'now' | 'work' | 'graph';
const SUBS: [Sub, string][] = [['now', '현황'], ['work', '작업'], ['graph', '생육 그래프']];

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);
/** kg m⁻² → kg/10a */
const per10a = (v: number) => Math.round(v * 1000).toLocaleString('ko-KR');

/** 정식 주문 편집기(새 작기 화면과 작물 탭이 함께 쓴다). */
export function OrderEditor({ value, onChange }: { value: PlantOrder; onChange: (o: PlantOrder) => void }) {
  const sbCrop = value.cropId === 'strawberry';
  const systems = CROPS[value.cropId].systems;
  const sys = systems[value.system] ?? Object.values(systems)[0]!;
  const cv = VARIETIES[value.varietyId];
  const sv = SB_VARIETIES[value.varietyId];
  const wsCrop = value.cropId === 'wasabi';
  const wv = WS_VARIETIES[value.varietyId];
  const list: Record<string, { name: string }> = sbCrop ? SB_VARIETIES : wsCrop ? WS_VARIETIES : VARIETIES;
  return (
    <>
      <div className="segmented" role="group" aria-label="작물 선택">
        {(['cucumber', 'strawberry', 'wasabi'] as const).map((id) => (
          <button key={id} type="button" aria-pressed={value.cropId === id} data-crop={id} onClick={() => value.cropId !== id && onChange(defaultOrderUi(id))}>
            {CROP_NAME[id]}
          </button>
        ))}
      </div>
      <div className="chips" role="listbox" aria-label="품종 선택">
        {Object.entries(list).map(([id, x]) => (
          <button key={id} type="button" role="option" aria-selected={id === value.varietyId} data-variety={id} className="chip" onClick={() => onChange({ ...value, varietyId: id, plan: sbCrop || wsCrop ? value.plan : defaultPlan(x as CucumberVariety) })}>
            {x.name}
          </button>
        ))}
      </div>
      {wsCrop && wv ? (
        <div className="region-card">
          <strong>
            {wv.name} <span className="muted small">{wv.type}{wv.real ? '' : ' · 가상 품종'}</span>
          </strong>
          <p className="muted small">{wv.desc}</p>
          <dl className="facts">
            <div><dt>근경 비대 속도</dt><dd>×{wv.rhizome}</dd></div>
            <div><dt>매운맛 지수(최대)</dt><dd>{wv.pungency}</dd></div>
            <div><dt>표준 수확 시기</dt><dd>정식 후 {wv.monthsToHarvest}개월</dd></div>
            <div><dt>내서성</dt><dd>{wv.heatTol > 0.8 ? '강' : wv.heatTol > 0 ? '보통' : '약'}</dd></div>
            <div><dt>분얼 발생</dt><dd>×{wv.offshoot}</dd></div>
            <div><dt>묵입병 / 무름병 저항성</dt><dd>{wv.resistance.blackleg} / {wv.resistance.softRot}</dd></div>
          </dl>
          <p className="muted small">와사비는 생육 적온이 {CROPS.wasabi.dev.tOpt}°C 안팎이고 {CROPS.wasabi.dev.tMax}°C에서 생육이 멈춥니다. 차광막과 여름 냉방(패드앤팬·포그·양액 냉각기)을 "3. 시설·장비"에서 꼭 챙기세요. 품종 수치는 추정값(EST)입니다.</p>
        </div>
      ) : sbCrop && sv ? (
        <div className="region-card">
          <strong>
            {sv.name} <span className="muted small">{sv.type}</span>
          </strong>
          <p className="muted small">{sv.desc}</p>
          <dl className="facts">
            <div><dt>기준 당도</dt><dd>{(1.15 * sv.dmc * 100 - 0.5).toFixed(1)} °Bx</dd></div>
            <div><dt>화방당 꽃 수</dt><dd>{sv.flowers}개</dd></div>
            <div><dt>경도(상대)</dt><dd>{sv.firmness}</dd></div>
            <div><dt>휴면 깊이 / 저온 요구</dt><dd>×{sv.dormancy} / {sv.chillReq} h</dd></div>
            <div><dt>저온기 기형과</dt><dd>{sv.pollenCold >= 2 ? '잘 생김' : sv.pollenCold >= 1 ? '보통' : '적음'}</dd></div>
            <div><dt>흰가루 / 잿빛곰팡이 / 탄저</dt><dd>{sv.resistance.powderyMildew} / {sv.resistance.grayMold} / {sv.resistance.anthracnose}</dd></div>
          </dl>
          <p className="muted small">당도는 농촌진흥청 발표값(설향·금실·죽향)에 맞췄고, 나머지 수치는 품종 특성에 근거한 추정값(EST)입니다.</p>
        </div>
      ) : cv ? (
        <div className="region-card">
          <strong>
            {cv.name} <span className="muted small">{cv.type}{cv.real ? '' : ' · 가상 품종'}</span>
          </strong>
          <p className="muted small">{cv.desc}</p>
          <dl className="facts">
            <div><dt>마디 암꽃 비율(기준)</dt><dd>{Math.round(cv.female * 100)}%</dd></div>
            <div><dt>표준 수확 무게</dt><dd>{cv.harvestWeight} g</dd></div>
            <div><dt>곡과 민감도</dt><dd>×{cv.curveSens}</dd></div>
            <div><dt>저온 / 고온 내성</dt><dd>{cv.coldTol <= 0 ? '강' : '약'} / {cv.heatTol > 0 ? '강' : '보통'}</dd></div>
            <div><dt>흰가루 / 노균 저항성</dt><dd>{cv.resistance.powderyMildew} / {cv.resistance.downyMildew} (5점)</dd></div>
            <div><dt>접목묘 값</dt><dd>{cv.seedlingPrice.toLocaleString('ko-KR')}원/주</dd></div>
          </dl>
          <p className="muted small">품종 수치는 계통 특성에 근거한 추정값(EST)입니다.</p>
        </div>
      ) : null}
      <Select label="작형(cropping type)" value={value.system} options={Object.entries(systems).map(([id, x]) => [id, x.name] as const)} onChange={(system) => onChange({ ...value, system })} testId="crop-system" />
      <p className="muted small">
        {sys.name}: {sys.sowing}, 수확 {sys.harvest}. 정식 권장 {sys.transplantMonth}월 {sys.transplantDay}일 무렵. 작형은 안내용 이름표이고, 결과는 실제로 심은 날짜와 환경이 결정합니다.
      </p>
      {sbCrop && (
        <>
          <Select label="묘(seedling)" value={value.seedling ?? 'buy'} options={[['buy', '구입묘(전문 육묘장, 후기 질소 조절)'], ['own', '자가 육묘(런너 번식)']] as const} onChange={(seedling) => onChange({ ...value, seedling })} testId="sb-seedling" />
          <Toggle label="야냉 단일처리 묘" checked={!!value.nightChill} onChange={(nightChill) => onChange({ ...value, nightChill })} hint="화아분화를 끝낸 묘. 8월 말에도 심을 수 있다" />
          {value.seedling === 'own' && <Num label="육묘기 질소 수준" value={value.plan.nLevel ?? 1} step={0.1} min={0.5} max={1.5} unit="배" hint="1 = 표준 · 육묘 후기 질소를 끊으면(낮게) 화아분화 촉진" onChange={(x) => onChange({ ...value, plan: { ...value.plan, nLevel: x } })} testId="plan-n" />}
          <p className="muted small">야냉 처리를 안 한 묘는 정식일 직전 40일의 그 지역 평년 기온·일장으로 화아분화 진행도를 계산합니다. 중부 지방은 9월 15–20일쯤 분화가 끝납니다. 자가 육묘는 탄저병 잠복 위험이 높습니다(병해충 Phase에서 반영).</p>
        </>
      )}
      <Num label="재식밀도(planting density)" value={value.density} step={sbCrop || wsCrop ? 0.5 : 0.1} min={sbCrop || wsCrop ? 4 : 1} max={sbCrop || wsCrop ? 14 : 5} unit="주/m²" hint={`10a당 ${Math.round(value.density * 1000).toLocaleString('ko-KR')}주`} onChange={(density) => onChange({ ...value, density })} testId="crop-density" />
    </>
  );
}

export function defaultOrderUi(crop: CropId = 'cucumber'): PlantOrder {
  if (crop === 'wasabi') return { cropId: 'wasabi', varietyId: 'daruma', system: 'hydro', density: CROPS.wasabi.density, plan: defaultPlanWs() };
  if (crop === 'strawberry') return { cropId: 'strawberry', varietyId: 'seolhyang', system: 'forcing', density: CROPS.strawberry.density, plan: defaultPlanSb(), seedling: 'buy', nightChill: false };
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
            <strong>{CROP_NAME[order.cropId]} {varietyName(order.cropId, order.varietyId)}</strong>을(를) <strong>{order.density} 주/m²</strong>로 지금 정식할까요?
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

/** 와사비 그림: 긴 엽병 끝에 둥근 잎, 아래에 근경(굵기와 길이 = 무게), 뿌리. */
function WasabiIcon({ crop }: { crop: CropView }) {
  const W = 240;
  const H = 260;
  const cx = W / 2;
  const top = 150;
  const fresh = crop.out.ws?.rhizomeFresh ?? 0;
  const len = 18 + Math.min(70, Math.sqrt(fresh) * 7);
  const wid = 10 + Math.min(22, Math.sqrt(fresh) * 2.4);
  const n = crop.leaves.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="plant-icon" role="img" aria-label={`와사비 한 포기: 잎 ${n}장, 근경 ${fresh.toFixed(0)} g`} data-testid="plant-icon">
      {crop.leaves.map((l, i) => {
        const a = Math.PI * (0.1 + (0.8 * (i + 0.5)) / n);
        const r = 5 + Math.sqrt(l.area / 0.022) * 15;
        const d = i % 2 === 0 ? 110 : 72;
        const x = cx - Math.cos(a) * d;
        const y = top - Math.sin(a) * d;
        return (
          <g key={i}>
            <line x1={cx} y1={top} x2={x} y2={y} stroke="var(--leaf)" strokeWidth={2.5} opacity={0.7} />
            <circle cx={x} cy={y} r={r} fill={crop.dead ? 'var(--muted)' : l.age > 65 ? 'var(--sun)' : 'var(--leaf)'} opacity={0.75} />
          </g>
        );
      })}
      {crop.out.ws?.bolting && <line x1={cx} y1={top} x2={cx} y2={40} stroke="var(--sun)" strokeWidth={3} strokeDasharray="2 5" />}
      <rect x={cx - wid / 2} y={top} width={wid} height={len} rx={wid / 3} fill="var(--accent)" />
      {[-1, 0, 1].map((k) => (
        <line key={k} x1={cx + (k * wid) / 3} y1={top + len} x2={cx + k * 22} y2={top + len + 22} stroke="var(--muted)" strokeWidth={1.5} />
      ))}
    </svg>
  );
}

/** 딸기 그림: 관부에서 잎이 부채꼴로 나오고, 화방마다 과실(빨강 = 익음, 연두 = 비대 중, 흰 점 = 꽃)이 달린다. */
function StrawberryIcon({ crop }: { crop: CropView }) {
  const W = 240;
  const H = 240;
  const cx = W / 2;
  const cy = 138;
  const leaves = crop.leaves;
  const n = leaves.length;
  const maturity = CROPS.strawberry.fruit.maturity;
  const trusses = [...new Set(crop.fruitList.map((f) => f.node))].sort((a, b) => a - b).slice(-4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="plant-icon" role="img" aria-label={`딸기 한 포기: 잎 ${n}장, 화방 ${trusses.length}개`} data-testid="plant-icon">
      {leaves.map((l, i) => {
        const a = Math.PI * (0.08 + (0.84 * (i + 0.5)) / n);
        const r = 4 + Math.sqrt(l.area / 0.02) * 12;
        const d = i % 2 === 0 ? 96 : 60;
        const x = cx - Math.cos(a) * d;
        const y = cy - Math.sin(a) * d;
        return (
          <g key={i}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--leaf)" strokeWidth={2} opacity={0.6} />
            <circle cx={x} cy={y} r={r} fill={crop.dead ? 'var(--muted)' : l.age > 55 ? 'var(--sun)' : 'var(--leaf)'} opacity={0.7} />
          </g>
        );
      })}
      <ellipse cx={cx} cy={cy + 4} rx={12 + 4 * (crop.out.sb?.crowns ?? 1)} ry={9} fill="var(--sun)" />
      {trusses.map((t, ti) => {
        const x0 = cx + (ti - (trusses.length - 1) / 2) * 56;
        const items = crop.fruitList.filter((f) => f.node === t && f.age > -6);
        return (
          <g key={t}>
            <line x1={cx} y1={cy + 6} x2={x0} y2={cy + 40} stroke="var(--leaf)" strokeWidth={1.5} />
            {items.map((f, i) => {
              const x = x0 + (i - (items.length - 1) / 2) * 13;
              const y = cy + 50 + (i % 2) * 20;
              if (f.age < 0) return <circle key={i} cx={x} cy={y} r={3} fill="var(--surface)" stroke="var(--muted)" />;
              const ripe = f.age >= maturity;
              return <circle key={i} cx={x} cy={y} r={4 + Math.min(8, Math.sqrt(f.fw) * 1.5)} fill={ripe ? 'var(--error)' : 'var(--leaf)'} stroke="var(--surface)" strokeWidth={1} opacity={0.5 + 0.5 * Math.min(1, f.n)} />;
            })}
          </g>
        );
      })}
    </svg>
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
  ['water', '수분'], ['nutrient', '양분'], ['sinkFeedback', '당 축적(sink 부족)'], ['tempSet', '착과 온도'], ['tempFruit', '비대 온도'], ['ssr', '동화산물 수급'], ['chill', '저온'], ['heat', '고온'], ['starve', '기아(호흡 부족)'], ['training', '유인 상태'], ['dormancy', '휴면(왜화)'], ['pollination', '수분 조건(오늘)'], ['rootTemp', '근권 온도(뿌리 활력)'], ['light', '강광 장해'], ['salt', '근권 염류(EC, Maas–Hoffman)'],
];

const DEATH: Record<string, string> = { rot: '고온 근권으로 뿌리·근경이 상함', frost: '동해(얼어 죽음)', chill: '저온 장해', heat: '고온 장해', collapse: '잎이 모두 소실됨' };

function Now({ crop, hour, area }: { crop: CropView; hour: number; area: number }) {
  const o = crop.out;
  const isSb = crop.cropId === 'strawberry';
  const sb = o.sb;
  const isWs = crop.cropId === 'wasabi';
  const ws = o.ws;
  const wst = crop.ws;
  const q = crop.quality;
  const bench = CROPS[crop.cropId].systems[crop.system]?.benchYield ?? 0;
  const dap = Math.floor((hour - crop.plantedHour) / 24);
  const stage = wst?.harvested ? '근경 수확 완료' : crop.dead ? '고사' : isWs ? (ws?.bolting ? '추대(꽃대 신장)' : crop.pd < 6 ? '활착 중' : '영양생장·근경 비대') : crop.firstHarvestHour >= 0 ? '수확 중' : o.fruits > 0.05 ? '착과·비대' : o.flowers > 0.05 ? '개화 전' : crop.pd < 3 ? '활착 중' : '영양생장';
  const total = crop.total;
  const wAll = o.wLeaf + o.wStem + o.wRoot + o.wFruit;
  return (
    <>
      <section className="card" data-testid="crop-status">
        <div className="card-head">
          <h2>{varietyName(crop.cropId, crop.varietyId)}</h2>
          <span className={`badge ${crop.dead ? 'badge-warn' : ''}`}>{stage} · 정식 후 {dap}일</span>
        </div>
        {crop.dead && <p className="error">작물이 죽었습니다: {DEATH[crop.deathCause] ?? crop.deathCause}. "작업"에서 작기를 정리(철거)한 뒤 다시 심을 수 있습니다.</p>}
        <div className="crop-figure">
          {isWs ? <WasabiIcon crop={crop} /> : isSb ? <StrawberryIcon crop={crop} /> : <PlantIcon crop={crop} />}
          <div className="metrics metrics-col">
            <div className="metric"><span className="muted small">엽면적지수(LAI)</span><span className="metric-value" data-testid="crop-lai">{f2(o.lai)}</span></div>
            {isWs && ws ? (
              <div className="metric"><span className="muted small">근경 생체중(평균)</span><span className="metric-value" data-testid="ws-rhizome">{ws.rhizomeFresh.toFixed(1)}<span className="metric-unit">g</span></span></div>
            ) : isSb && sb ? (
              <div className="metric"><span className="muted small">잎 / 관부 / 화방</span><span className="metric-value">{o.leaves}<span className="metric-unit">장 / {f1(sb.crowns)} / {sb.trusses}</span></span></div>
            ) : (
              <div className="metric"><span className="muted small">원줄기 마디 / 잎</span><span className="metric-value">{o.nodes}<span className="metric-unit"> / {o.leaves}장</span></span></div>
            )}
            {isWs && ws ? (
              <>
                <div className="metric"><span className="muted small">잎 수 / 상품(40 g↑) 비율</span><span className="metric-value">{o.leaves}<span className="metric-unit">장 / {Math.round(ws.marketShare * 100)}%</span></span></div>
                <div className="metric"><span className="muted small">매운맛 지수</span><span className="metric-value">{f2(ws.pungency)}</span></div>
              </>
            ) : (
              <>
                <div className="metric"><span className="muted small">달린 과실 / 꽃봉오리</span><span className="metric-value">{f1(o.fruits)}<span className="metric-unit"> / {f1(o.flowers)}</span></span></div>
            <div className="metric"><span className="muted small">가장 큰 과실</span><span className="metric-value">{o.biggestFruit.toFixed(0)}<span className="metric-unit">g</span></span></div>
              </>
            )}
          </div>
        </div>
        <p className="muted small">{isWs ? '그림: 둥근 잎(크기 = 엽면적)과 긴 엽병, 아래 진한 막대 = 근경(크기 = 무게), 점선 = 꽃대. 근경 무게는 포기 평균이며 상품 비율은 포기 사이 편차를 반영한 값입니다.' : isSb ? '그림: 잎 크기 = 엽면적, 빨간 과실 = 수확 적기, 연두 = 비대 중, 흰 점 = 꽃봉오리, 가운데 = 관부. 최근 화방 4개까지 보여줍니다.' : '그림: 잎 크기 = 엽면적, 초록 막대 = 과실(길이 = 무게), 노란 점 = 곧 필 암꽃, 누런 잎 = 늙은 잎.'} 과실 수가 소수인 것은 "평균 한 포기" 기준이기 때문입니다.</p>
      </section>

      <section className="card">
        <h2>생육 상태</h2>
        {isWs && ws && wst ? (
          <dl className="facts" data-testid="ws-facts">
            <div><dt>근권 온도(이동평균)</dt><dd>{f1(ws.rootT)}°C <span className="muted small">{crop.system === 'substrate' ? '배지' : '양액'}</span></dd></div>
            <div><dt>낮 최고 광(5일 평균)</dt><dd>{Math.round(ws.peakPpfd)} μmol</dd></div>
            <div><dt>춘화(저온 일수)</dt><dd>{Math.round(ws.vern)}일 <span className="muted small">추대 {wst.bolts}회</span></dd></div>
            <div><dt>분얼</dt><dd>{f1(ws.offshoots)}개/주</dd></div>
            <div><dt>최근 일적산광량 / 평균기온</dt><dd>{f1(crop.dliAvg)} mol · {f1(crop.tAvg)}°C</dd></div>
            <div><dt>정식 후 생리일수</dt><dd>{Math.round(crop.pd)} pd</dd></div>
            <div><dt>동화산물 공급/수요</dt><dd>{Math.round(o.ssr * 100)}%</dd></div>
            <div><dt>저장 당(assimilate pool)</dt><dd>{f1(o.pool)} g/m²</dd></div>
          </dl>
        ) : isSb && sb ? (
          <dl className="facts" data-testid="sb-facts">
            <div><dt>다음 화방 화아분화</dt><dd>{Math.round(sb.induction * 100)}%</dd></div>
            <div><dt>다음 개화까지</dt><dd>{sb.nextAnthesis > -900 ? `${f1(-sb.nextAnthesis)} 생리일` : '분화한 꽃 없음'}</dd></div>
            <div><dt>첫 개화</dt><dd>{sb.firstFlowerDay >= 0 ? `정식 후 ${Math.round(sb.firstFlowerDay)}일` : '아직'}</dd></div>
            <div><dt>휴면(왜화) 정도</dt><dd>{Math.round(sb.dormancy * 100)}% <span className="muted small">저온 누적 {Math.round(sb.chill)} h</span></dd></div>
            <div><dt>일장(전조 포함)</dt><dd>{f1(sb.photoperiod)} h</dd></div>
            <div><dt>런너</dt><dd>{f1(sb.runners)}개/주</dd></div>
            <div><dt>봉군 세력 / 오늘 활동</dt><dd>{Math.round(sb.beeStrength * 100)}% / {Math.round(sb.beeActivity * 100)}%</dd></div>
            <div><dt>동화산물 공급/수요</dt><dd>{Math.round(o.ssr * 100)}% <span className="muted small">평균 {Math.round(crop.ssrAvg * 100)}%</span></dd></div>
            <div><dt>저장 당(assimilate pool)</dt><dd>{f1(o.pool)} g/m²</dd></div>
            <div><dt>최근 일적산광량 / 평균기온</dt><dd>{f1(crop.dliAvg)} mol · {f1(crop.tAvg)}°C</dd></div>
          </dl>
        ) : (
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
        )}
        <h3>건물중(dry weight) g/m²</h3>
        <div className="stack-bar" role="img" aria-label="기관별 건물중 비율">
          {([['잎', o.wLeaf, 'var(--leaf)'], [isWs ? '근경' : isSb ? '관부' : '줄기', o.wStem, 'var(--muted)'], ['뿌리', o.wRoot, 'var(--hot)'], [isWs ? '분얼·꽃대' : '과실', o.wFruit, 'var(--accent)']] as const).map(([k, w, c]) => (
            <span key={k} style={{ width: `${wAll > 0 ? (w / wAll) * 100 : 0}%`, background: c }} />
          ))}
        </div>
        <p className="muted small">잎 {f1(o.wLeaf)} · {isWs ? '근경' : isSb ? '관부' : '줄기'} {f1(o.wStem)} · 뿌리 {f1(o.wRoot)} · {isWs ? '분얼·꽃대' : '달린 과실'} {f1(o.wFruit)}</p>
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
          <div className="metric"><span className="muted small">{isWs ? `특품 근경(${CROPS.wasabi.rhizome.premium} g 이상)` : isSb ? `상품(${CROPS.strawberry.fruit.topWeight} g 이상 정상과)` : '상품(곧은 규격과)'}</span><span className="metric-value" data-testid="yield-top">{per10a(total.top)}<span className="metric-unit">kg/10a</span></span></div>
          <div className="metric"><span className="muted small">{isWs ? `상품 근경(${CROPS.wasabi.rhizome.market}–${CROPS.wasabi.rhizome.premium} g)` : isSb ? '중품(소과·약한 기형)' : '중품(곡과·과대과)'}</span><span className="metric-value">{per10a(total.mid)}<span className="metric-unit">kg/10a</span></span></div>
          <div className="metric"><span className="muted small">비상품</span><span className="metric-value">{per10a(total.cull)}<span className="metric-unit">kg/10a</span></span></div>
          <div className="metric"><span className="muted small">{isWs ? '수확한 포기 수' : '수확 과실 수'}</span><span className="metric-value">{Math.round(total.count * area).toLocaleString('ko-KR')}<span className="metric-unit">{isWs ? '주' : '개'}</span></span></div>
        </div>
        <p className="muted small">
          이 온실({area.toLocaleString('ko-KR')} m²) 실제 수확량 {Math.round((total.top + total.mid) * area).toLocaleString('ko-KR')} kg · 오늘 {Math.round((crop.today.harvest.top + crop.today.harvest.mid) * area)} kg {isWs ? '' : ` · 퇴화한 어린 과실 ${Math.round(crop.abortedTotal * area).toLocaleString('ko-KR')}개`}
          {crop.firstHarvestHour >= 0 && ` · ${isWs ? '근경 수확' : '첫 수확'} 정식 후 ${Math.round((crop.firstHarvestHour - crop.plantedHour) / 24)}일`}
        </p>
        {isWs && wst && (
          <dl className="facts" data-testid="ws-products">
            <div><dt>잎·엽병 수확(누적)</dt><dd>{per10a(wst.leafYield)} kg/10a</dd></div>
            <div><dt>꽃대 수확(누적)</dt><dd>{per10a(wst.stalkYield)} kg/10a</dd></div>
            <div><dt>{wst.harvested ? '캐낸 근경(전체)' : '지금 캐면(근경)'}</dt><dd>{Math.round((ws?.rhizomeFresh ?? 0) * crop.density * crop.alive)} kg/10a</dd></div>
            <div><dt>살아 있는 포기</dt><dd>{Math.round(crop.alive * 100)}%</dd></div>
          </dl>
        )}
        {isSb && q && q.kg > 0 && (
          <dl className="facts" data-testid="sb-quality">
            <div><dt>평균 당도</dt><dd>{f1(q.brix / q.kg)} °Bx</dd></div>
            <div><dt>평균 산도</dt><dd>{f2(q.acid / q.kg)} %</dd></div>
            <div><dt>평균 과중</dt><dd>{f1(q.weight / q.kg)} g</dd></div>
            <div><dt>경도(상대)</dt><dd>{f2(q.firm / q.kg)}</dd></div>
            <div><dt>기형과율</dt><dd>{q.count > 0 ? Math.round((q.malformed / q.count) * 100) : 0}%</dd></div>
            <div><dt>당산비</dt><dd>{f1(q.brix / q.acid)}</dd></div>
          </dl>
        )}
        {bench > 0 && <p className="muted small">참고({CROPS[crop.cropId].systems[crop.system]!.name}, {isWs ? '국내 물재배 시험 성적' : '농가 평균·농산물소득조사'}): {bench.toLocaleString('ko-KR')} kg/10a. 지금 모델에는 병해충·양수분 부족이 없습니다.</p>}
      </section>
    </>
  );
}

const WS_TASKS: [WorkTask, string, string][] = [['deleaf', '잎·엽병 수확', '바깥 잎부터 따서 정한 잎 수만 남깁니다(쌈·장아찌용).'], ['runner', '분얼 제거', '곁에서 나온 새끼 포기를 떼어냅니다.'], ['thin', '꽃대 수확', '올라온 꽃대를 꺾어 수확합니다.'], ['harvest', '근경 수확(굴취)', '포기를 모두 캐서 근경을 수확합니다. 작기가 끝납니다.']];
const SB_TASKS: [WorkTask, string, string][] = [['deleaf', '적엽', '늙은 잎을 따서 관부당 정한 잎 수만 남깁니다.'], ['runner', '런너 제거', '자라고 있는 런너를 모두 자릅니다.'], ['thin', '적화', '화방마다 정한 수만 남기고 아직 안 핀 꽃을 솎습니다.'], ['bees', '벌통 교체', '새 벌통을 넣어 봉군 세력을 100%로 되돌립니다.'], ['harvest', '수확', '익은 과실을 땁니다.']];
const BEE_OPTIONS: readonly (readonly [BeeType, string])[] = [['honey', '꿀벌'], ['bumble', '뒤영벌'], ['none', '없음']];
const TASKS: [WorkTask, string, string][] = [['train', '유인·곁순 정리', '새 마디를 줄에 감고 곁순·아랫마디 암꽃을 정리합니다.'], ['deleaf', '적엽', '아래 늙은 잎을 따서 정한 잎 수만 남깁니다.'], ['harvest', '수확', '기준 무게를 넘은 과실을 땁니다.'], ['pinch', '적심', '원줄기 생장점을 자릅니다. 되돌릴 수 없습니다.']];

function Work({ crop }: { crop: CropView }) {
  const [draft, setDraft] = useState<WorkPlan>(crop.plan);
  const [confirm, setConfirm] = useState<string | null>(null);
  const saved = JSON.stringify(crop.plan);
  useEffect(() => setDraft(JSON.parse(saved) as WorkPlan), [saved]);
  const dirty = JSON.stringify(draft) !== saved;
  const set = <K extends keyof WorkPlan>(k: K, v: WorkPlan[K]) => setDraft({ ...draft, [k]: v });
  const isSb = crop.cropId === 'strawberry';
  const isWs = crop.cropId === 'wasabi';
  const v = VARIETIES[crop.varietyId];
  const labor = Object.entries(crop.laborHours);
  const LABEL: Record<string, string> = { plant: '정식', train: '유인', deleaf: isWs ? '잎 수확' : '적엽', thin: isWs ? '꽃대 수확' : '적과·적화', pinch: '적심', harvest: isWs ? '근경 수확' : '수확', runner: isWs ? '분얼 제거' : '런너 제거', bees: '벌통 관리' };
  return (
    <>
      <section className="card" data-testid="work-plan">
        <h2>작업 계획(반복)</h2>
        <p className="muted small">정해 둔 간격마다 아침 7시에 작업합니다. 간격을 0으로 두면 그 작업을 하지 않습니다(방치).</p>
        {isWs ? (
          <>
            <h3>잎·엽병 수확</h3>
            <Num label="잎 수확 간격" value={draft.deleafEvery} step={5} min={0} max={120} unit="일" hint="0 = 수확 안 함" onChange={(x) => set('deleafEvery', x)} testId="plan-deleaf" />
            <Num label="남길 잎 수" value={draft.leavesKeep} min={3} max={20} unit="장" hint="적게 남기면 근경이 더디게 큰다" onChange={(x) => set('leavesKeep', x)} />
            <h3>분얼·꽃대</h3>
            <Num label="분얼 제거 간격" value={draft.runnerEvery ?? 0} step={10} min={0} max={240} unit="일" hint="0 = 두기" onChange={(x) => set('runnerEvery', x)} />
            <Num label="꽃대 수확 간격" value={draft.stalkEvery ?? 0} step={5} min={0} max={60} unit="일" hint="0 = 두기(추대기에만 해당)" onChange={(x) => set('stalkEvery', x)} />
            <p className="muted small">근경은 반복 수확이 아닙니다. 아래 "지금 바로 작업 → 근경 수확"으로 한 번에 캡니다(보통 정식 후 15–24개월).</p>
          </>
        ) : isSb ? (
          <>
            <h3>수분(pollination)</h3>
            <Select label="수정벌" value={draft.bees ?? 'honey'} options={BEE_OPTIONS} onChange={(x) => set('bees', x)} testId="plan-bees" />
            <Num label="벌통 교체 간격" value={draft.beesEvery ?? 0} step={5} min={0} max={120} unit="일" hint="0 = 교체 안 함" onChange={(x) => set('beesEvery', x)} />
            <h3>화방·관부</h3>
            <Num label="화방당 남길 꽃 수(적화)" value={draft.flowersKeep ?? 0} min={0} max={15} unit="개" hint="0 = 모두 둠" onChange={(x) => set('flowersKeep', x)} testId="plan-flowers" />
            <Num label="남길 관부 수" value={draft.crownsKeep ?? 2} min={1} max={4} unit="개" hint="곁관부(분얼) 정리" onChange={(x) => set('crownsKeep', x)} />
            <h3>적엽·런너</h3>
            <Num label="적엽 간격" value={draft.deleafEvery} min={0} max={60} unit="일" onChange={(x) => set('deleafEvery', x)} testId="plan-deleaf" />
            <Num label="관부당 남길 잎 수" value={draft.leavesKeep} min={4} max={16} unit="장" onChange={(x) => set('leavesKeep', x)} />
            <Num label="런너 제거 간격" value={draft.runnerEvery ?? 0} min={0} max={60} unit="일" onChange={(x) => set('runnerEvery', x)} />
            <h3>수확(harvest)</h3>
            <Num label="수확 간격" value={draft.harvestEvery} min={0} max={10} unit="일" onChange={(x) => set('harvestEvery', x)} testId="plan-harvest" />
            <h3>체내 질소</h3>
            <p className="muted small">정식 뒤의 체내 질소는 근권·양액 탭의 급액 처방과 관수가 정합니다(신엽 질소 ÷ 적정). 질소가 낮을수록 다음 화방의 화아분화가 빨라집니다 — 화방 분화기에 EC를 낮추는 관행과 같은 원리.</p>
          </>
        ) : (
          <>
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
        <Num label="수확 기준 무게" value={draft.harvestWeight} step={10} min={0} max={400} unit="g" hint={`0 = 품종 표준 ${v?.harvestWeight ?? 0} g`} onChange={(x) => set('harvestWeight', x)} />
          </>
        )}
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
        {(isWs ? WS_TASKS : isSb ? SB_TASKS : TASKS).map(([task, label, desc]) => (
          <div key={task} className="toggle-row">
            <span>
              {label} <span className="muted small">{desc}</span>
            </span>
            <button type="button" className="btn btn-small" data-work={task} disabled={crop.dead || !!crop.ws?.harvested || (task === 'pinch' && crop.pinched)} onClick={() => (task === 'pinch' ? setConfirm('pinch') : isWs && task === 'harvest' ? setConfirm('dig') : session.cropWork(task))}>
              {task === 'pinch' && crop.pinched ? '완료' : '실행'}
            </button>
          </div>
        ))}
        {confirm === 'dig' && (
          <div className="confirm" role="alertdialog" aria-label="근경 수확 확인">
            <p>포기를 모두 캐서 근경을 수확할까요? 되돌릴 수 없고, 이 작기의 와사비 재배가 끝납니다.</p>
            <div className="btn-row">
              <button type="button" className="btn" data-testid="confirm-dig" onClick={() => { session.cropWork('harvest'); setConfirm(null); }}>수확</button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>취소</button>
            </div>
          </div>
        )}
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
  const isWs = view.wx?.crop?.cropId === 'wasabi';
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
      {isWs ? (
        <Chart title="근경 생체중 g/주(포기 평균)" data={data} lines={[['달린 과실', 'var(--accent)']]} testId="chart-rhizome" short />
      ) : (
        <>
          <Chart title="동화산물 공급/수요와 달린 과실 수" data={data} lines={[['공급/수요', 'var(--cold)'], ['달린 과실', 'var(--accent)', '4 3'], ['퇴화 과실', 'var(--hot)', '2 2']]} />
          <Chart title="일 수확량 kg/10a" data={data} lines={[['일 수확', 'var(--accent)']]} testId="chart-harvest" short />
          <Chart title="누적 수확량 kg/10a" data={data} lines={[['누적 수확', 'var(--accent)']]} short />
        </>
      )}
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
        {crop && <span className="badge">{CROP_NAME[crop.cropId]} · {crop.density} 주/m²</span>}
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
