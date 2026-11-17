import { useEffect, useState } from 'react';
import type { ControlSettings, GhSetup } from '../engine';
import { session } from '../sim/session';
import { Num, Select, Toggle } from './Num';

type NumKey = { [K in keyof ControlSettings]: ControlSettings[K] extends number ? K : never }[keyof ControlSettings];
type Field = [key: NumKey, label: string, unit: string, step: number, min: number, max: number, hint?: string];

const SECTIONS: { title: string; needs?: (s: GhSetup) => boolean; missing?: string; fields: Field[] }[] = [
  {
    title: '온도 (난방)',
    needs: (s) => s.heater !== 'none',
    missing: '난방기 없음',
    fields: [
      ['heatDay', '주간 설정온도', '°C', 0.5, 0, 35],
      ['heatNight', '야간 설정온도', '°C', 0.5, 0, 35],
      ['heatPreDawn', '일출 전 설정온도', '°C', 0.5, 0, 35],
      ['preDawnHours', '일출 전 구간', '시간', 0.5, 0, 6, '일출 몇 시간 전부터'],
    ],
  },
  {
    title: '환기',
    needs: (s) => s.sideVent || s.roofVent,
    missing: '자동 창 없음',
    fields: [
      ['ventTemp', '환기 개시 온도', '°C', 0.5, 5, 45],
      ['ventBand', '비례대', '°C', 0.5, 0.5, 15, '이만큼 더 오르면 100%'],
      ['ventStep', '개도 단계', '%', 5, 5, 50],
      ['ventMax', '최대 개도', '%', 5, 0, 100],
      ['closeWind', '강풍 닫힘', 'm/s', 1, 3, 40, '순간풍속 기준'],
    ],
  },
  {
    title: '습도',
    fields: [
      ['rhMax', '습도 상한', '%', 1, 50, 100],
      ['humidityVentMax', '습도 환기 최대 개도', '%', 5, 0, 50],
      ['rhMin', '습도 하한(포그 작동)', '%', 1, 10, 90],
      ['fogTemp', '포그 작동 온도', '°C', 0.5, 15, 45],
      ['fogRhMax', '포그 중단 습도', '%', 1, 50, 100],
    ],
  },
  { title: '냉방', needs: (s) => s.cooling !== 'none', missing: '냉방 장비 없음', fields: [['coolTemp', '냉방 개시 온도', '°C', 0.5, 10, 40]] },
  {
    title: 'CO2',
    needs: (s) => s.co2 !== 'none',
    missing: 'CO2 장비 없음',
    fields: [
      ['co2Target', '목표 농도', 'ppm', 50, 400, 2000],
      ['co2Start', '시작 시각', '시', 0.5, 0, 24],
      ['co2End', '종료 시각', '시', 0.5, 0, 24],
      ['co2VentMax', '공급 중단 창 개도', '%', 5, 0, 100, '이보다 많이 열리면 중단 · 100 = 중단 안 함'],
    ],
  },
  { title: '차광', needs: (s) => s.shade !== 'none', missing: '차광막 없음', fields: [['shadeOnW', '작동 일사(외부)', 'W/m²', 50, 100, 1200]] },
  {
    title: '보온커튼',
    needs: (s) => s.curtainLayers > 0,
    missing: '보온커튼 없음',
    fields: [
      ['curtainCloseOffset', '닫는 시각', '시간', 0.5, -3, 3, '일몰 기준(음수 = 일몰 전)'],
      ['curtainOpenOffset', '여는 시각', '시간', 0.5, -3, 4, '일출 기준'],
      ['curtainOutTemp', '외기온 조건', '°C', 1, -30, 40, '외기가 이보다 낮을 때만 닫음'],
    ],
  },
  { title: '양액 온도', needs: (s) => s.solutionChiller || s.solutionHeater, missing: '냉각기·가온기 없음', fields: [['solutionMin', '하한(가온)', '°C', 0.5, 5, 30], ['solutionMax', '상한(냉각)', '°C', 0.5, 8, 35]] },
];

const LIGHT_FIELDS: Field[] = [
  ['lightStart', '점등 시각', '시', 0.5, 0, 24],
  ['lightEnd', '소등 시각', '시', 0.5, 0, 24],
  ['photoperiod', '목표 명기(일장 연장)', '시간', 0.5, 8, 24, '일출부터 이 시간까지 밝게'],
  ['lightOffAboveW', '소등 일사(외부)', 'W/m²', 50, 0, 1200, '해가 이보다 강하면 끔'],
  ['lightTargetDli', '목표 DLI', 'mol/m²/d', 1, 0, 60, '채우면 끔 · 0 = 사용 안 함'],
];

export function ControlPanel({ settings, setup }: { settings: ControlSettings; setup: GhSetup }) {
  const [draft, setDraft] = useState(settings);
  const [confirm, setConfirm] = useState(false);
  const base = JSON.stringify(settings);
  useEffect(() => setDraft(JSON.parse(base) as ControlSettings), [base]);
  const dirty = JSON.stringify(draft) !== base;
  const set = <K extends keyof ControlSettings>(k: K, v: ControlSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const fields = (list: Field[]) => list.map(([k, label, unit, step, min, max, hint]) => <Num key={k} label={label} unit={unit} step={step} min={min} max={max} hint={hint} value={draft[k]} onChange={(v) => set(k, v)} testId={`set-${k}`} />);

  return (
    <>
      {SECTIONS.map((sec) => {
        const has = sec.needs ? sec.needs(setup) : true;
        return (
          <details key={sec.title} className="card fold" open={has && sec.title.startsWith('온도')}>
            <summary>
              <h2>{sec.title}</h2>
              {!has && <span className="badge badge-warn">{sec.missing}</span>}
            </summary>
            {fields(sec.fields)}
            {sec.title === '환기' && <Toggle label="비 올 때 닫기" checked={draft.closeOnRain} onChange={(v) => set('closeOnRain', v)} />}
            {sec.title === '습도' && <Select label="습도 상한 초과 시" value={draft.humidityPriority} options={[['dehumidifier', '제습기 우선(없으면 환기)'], ['vent', '환기 우선']]} onChange={(v) => set('humidityPriority', v)} />}
            {sec.title.startsWith('온도') && (
              <div className="blocks">
                <span className="num-label">
                  시간대별 프로그램 <span className="muted small">있으면 위 설정보다 우선</span>
                </span>
                {draft.blocks.map((b, i) => (
                  <div key={i} className="block-row">
                    <Num label="시작" unit="시" step={0.5} min={0} max={24} value={b.start} onChange={(v) => set('blocks', draft.blocks.map((x, j) => (j === i ? { ...x, start: v } : x)))} />
                    <Num label="종료" unit="시" step={0.5} min={0} max={24} value={b.end} onChange={(v) => set('blocks', draft.blocks.map((x, j) => (j === i ? { ...x, end: v } : x)))} />
                    <Num label="난방" unit="°C" step={0.5} min={0} max={35} value={b.heat} onChange={(v) => set('blocks', draft.blocks.map((x, j) => (j === i ? { ...x, heat: v } : x)))} />
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => set('blocks', draft.blocks.filter((_, j) => j !== i))}>
                      삭제
                    </button>
                  </div>
                ))}
                {draft.blocks.length < 6 && (
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => set('blocks', [...draft.blocks, { start: 16, end: 20, heat: draft.heatNight }])}>
                    시간대 추가
                  </button>
                )}
              </div>
            )}
          </details>
        );
      })}
      <details className="card fold">
        <summary>
          <h2>보광</h2>
          {setup.light === 'none' && <span className="badge badge-warn">보광등 없음</span>}
        </summary>
        <Select label="방식" value={draft.lightMode} options={[['off', '끔'], ['window', '시간대 점등'], ['extend', '일장 연장(전조)']]} onChange={(v) => set('lightMode', v)} testId="set-lightMode" />
        {fields(LIGHT_FIELDS)}
      </details>

      {dirty && (
        <div className="apply-bar" role="region" aria-label="설정 적용">
          {confirm ? (
            <>
              <span>바꾼 설정을 지금 시각부터 적용할까요?</span>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn"
                  data-testid="confirm-apply"
                  onClick={() => {
                    session.setControl(draft);
                    setConfirm(false);
                  }}
                >
                  적용
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>
                  취소
                </button>
              </div>
            </>
          ) : (
            <div className="btn-row">
              <button type="button" className="btn" data-testid="apply-settings" onClick={() => setConfirm(true)}>
                설정 적용
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(JSON.parse(base) as ControlSettings)}>
                되돌리기
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
