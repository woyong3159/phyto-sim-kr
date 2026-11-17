import { GH_PARAMS } from '../data';
import { FACILITY_IDS, curtainSaving, defaultSetup, installCost, type GhSetup, type GhState } from '../engine';
import { won } from './format';
import { Num, Select, Toggle } from './Num';

const P = GH_PARAMS;
const pyeong = (m2: number) => (m2 / 3.3058).toFixed(0);

/** 시설·장비 구성 편집기(새 작기 화면과 환경 탭에서 함께 쓴다). */
export function SetupEditor({ value, onChange }: { value: GhSetup; onChange: (s: GhSetup) => void }) {
  const s = value;
  const set = <K extends keyof GhSetup>(k: K, v: GhSetup[K]) => onChange({ ...s, [k]: v });
  const fac = P.facilities[s.facility];
  const u = fac.uValue * (s.coverLayers === 2 ? P.phys.doubleCoverU : 1);
  const tau = fac.transmissivity * (s.coverLayers === 2 ? P.phys.doubleCoverTau : 1);
  const saving = curtainSaving({ gh: P } as never, { setup: s } as GhState);
  const cost = installCost(P, s);

  return (
    <div className="setup">
      <div className="chips" role="listbox" aria-label="시설 유형">
        {FACILITY_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="option"
            aria-selected={s.facility === id}
            data-facility={id}
            className="chip"
            onClick={() => {
              // 시설을 바꾸면 그 시설에 어울리는 기본 장비로 맞추되 면적은 유지한다
              const d = defaultSetup(id);
              onChange({ ...d, area: s.area, testLai: s.testLai });
            }}
          >
            {P.facilities[id].name}
          </button>
        ))}
      </div>
      <div className="region-card" data-testid="facility-card">
        <strong>
          {fac.name} <span className="muted small">{fac.desc}</span>
        </strong>
        <dl className="facts">
          <div>
            <dt>일사 투과율</dt>
            <dd>{(tau * 100).toFixed(0)}%</dd>
          </div>
          <div>
            <dt>열관류율 (커튼 닫으면)</dt>
            <dd>
              {u.toFixed(1)} ({(u * (1 - saving)).toFixed(1)}) W/m²K
            </dd>
          </div>
          <div>
            <dt>측고 / 평균 높이</dt>
            <dd>
              {fac.eaveHeight} / {fac.meanHeight} m
            </dd>
          </div>
          <div>
            <dt>적설 · 풍속 한계</dt>
            <dd>
              {fac.snowLimit} cm · {fac.windLimit} m/s
            </dd>
          </div>
          <div>
            <dt>시공비</dt>
            <dd>{(fac.buildCost / 10000).toFixed(1)}만 원/m²</dd>
          </div>
          <div>
            <dt>피복 수명</dt>
            <dd>{fac.coverLife}년</dd>
          </div>
        </dl>
      </div>

      <Num label="바닥 면적" value={s.area} step={100} min={100} max={50000} unit="m²" hint={`약 ${pyeong(s.area)}평`} onChange={(v) => set('area', v)} testId="area" />
      <Select label="피복 겹수" value={String(s.coverLayers) as '1' | '2'} options={[['1', '1중'], ['2', '2중 (보온↑, 빛 10%↓)']]} onChange={(v) => set('coverLayers', Number(v) as 1 | 2)} />
      <Num label="피복재 경과 연수" value={s.coverAge} step={1} min={0} max={30} unit="년" onChange={(v) => set('coverAge', v)} />

      <h3>보온 · 차광</h3>
      <Select label="보온커튼 겹수" value={String(s.curtainLayers) as '0' | '1' | '2' | '3'} options={[['0', '없음'], ['1', '1겹'], ['2', '2겹'], ['3', '3겹']]} onChange={(v) => set('curtainLayers', Number(v) as 0 | 1 | 2 | 3)} testId="curtain-layers" />
      {s.curtainLayers > 0 && (
        <Select
          label="보온커튼 소재"
          value={s.curtainMaterial}
          options={(['pe', 'nonwoven', 'aluminum', 'multilayer'] as const).map((k) => [k, `${P.eq.curtain.materials[k].name} (1겹 보온율 ${(P.eq.curtain.materials[k].saving * 100).toFixed(0)}%)`] as const)}
          onChange={(v) => set('curtainMaterial', v)}
        />
      )}
      <Select label="차광막" value={s.shade} options={[['none', '없음'], ['s35', '차광 35%'], ['s55', '차광 55%'], ['s75', '차광 75%']]} onChange={(v) => set('shade', v)} />

      <h3>환기</h3>
      {fac.sideVentArea > 0 && <Toggle label="측창 자동 개폐" checked={s.sideVent} onChange={(v) => set('sideVent', v)} />}
      {fac.roofVentArea > 0 && <Toggle label="천창 자동 개폐" checked={s.roofVent} onChange={(v) => set('roofVent', v)} />}
      <Select
        label="방충망"
        value={s.insectNet}
        options={[['none', '없음'], ...(['m10', 'm06', 'm04'] as const).map((k) => [k, `${P.eq.insectNet[k].name} (환기량 ${(P.eq.insectNet[k].ventFactor * 100).toFixed(0)}%)`] as const)]}
        onChange={(v) => set('insectNet', v)}
      />
      <Toggle label="순환팬(유동팬)" checked={s.circFan} onChange={(v) => set('circFan', v)} />
      <Toggle label="포그 / 미스트" checked={s.fog} onChange={(v) => set('fog', v)} />
      <Toggle label="제습기" checked={s.dehumidifier} onChange={(v) => set('dehumidifier', v)} />

      <h3>난방 · 냉방</h3>
      <Select label="난방기" value={s.heater} options={[['none', '없음(무가온)'], ['oil', '온풍기(경유·등유)'], ['electric', '전기 온풍기'], ['heatpump', '공기열 히트펌프'], ['geothermal', '지열 히트펌프']]} onChange={(v) => set('heater', v)} testId="heater" />
      {s.heater === 'oil' && <Select label="연료" value={s.fuel} options={[['taxFreeKerosene', '면세 등유'], ['taxFreeDiesel', '면세 경유'], ['kerosene', '과세 등유'], ['diesel', '과세 경유']]} onChange={(v) => set('fuel', v)} />}
      {s.heater !== 'none' && <Num label="난방 용량" value={s.heaterCapacity} step={10} min={10} max={600} unit="W/m²" hint={`전체 ${((s.heaterCapacity * s.area) / 1000).toFixed(0)} kW`} onChange={(v) => set('heaterCapacity', v)} testId="heater-capacity" />}
      <Select label="냉방" value={s.cooling} options={[['none', '없음'], ['padfan', '패드앤팬'], ['heatpump', '히트펌프 냉방']]} onChange={(v) => set('cooling', v)} />
      {s.cooling === 'heatpump' && <Num label="냉방 용량" value={s.coolingCapacity} step={10} min={10} max={600} unit="W/m²" onChange={(v) => set('coolingCapacity', v)} />}

      <h3>CO2 · 보광 · 양액 온도</h3>
      <Select label="CO2 공급" value={s.co2} options={[['none', '없음'], ['liquid', '액화탄산가스'], ['burner', '연소식 발생기(등유)']]} onChange={(v) => set('co2', v)} />
      <Select label="보광등" value={s.light} options={[['none', '없음'], ['led', 'LED'], ['hps', '고압나트륨등(HPS)']]} onChange={(v) => set('light', v)} />
      {s.light !== 'none' && <Num label="보광 광량" value={s.lightPpfd} step={10} min={10} max={600} unit="μmol/m²/s" hint={`소비전력 ${(s.lightPpfd / P.eq.light[s.light].efficacy).toFixed(0)} W/m²`} onChange={(v) => set('lightPpfd', v)} />}
      <Toggle label="양액 냉각기(chiller)" checked={s.solutionChiller} onChange={(v) => set('solutionChiller', v)} hint="와사비 필수" />
      <Toggle label="양액 가온기(heater)" checked={s.solutionHeater} onChange={(v) => set('solutionHeater', v)} />

      <h3>시험용 군락</h3>
      <Num label="엽면적지수(LAI)" value={s.testLai} step={0.5} min={0} max={5} hint="작물 모델 전 임시 · 0 = 빈 온실" onChange={(v) => set('testLai', v)} />

      <details className="cost-box">
        <summary>
          설치비 견적 <strong>{won(cost.total)}</strong> <span className="muted small">({(cost.total / s.area / 10000).toFixed(1)}만 원/m²)</span>
        </summary>
        <ul className="rows">
          {cost.lines.map((l) => (
            <li key={l.label}>
              <span>{l.label}</span>
              <span className="nowrap">{won(l.won)}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">추정값입니다. 실제 장부 반영은 경제 Phase에서 합니다.</p>
      </details>
    </div>
  );
}
