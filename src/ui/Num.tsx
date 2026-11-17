import { useEffect, useState } from 'react';

/** 숫자 입력: 숫자 키패드 + 스테퍼(±). */
export function Num({ label, value, onChange, step = 1, min = -999, max = 9999, unit, hint, testId }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; hint?: string; testId?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const digits = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
  const commit = (v: number) => {
    const c = Math.min(max, Math.max(min, Number.isFinite(v) ? v : value));
    const r = Number(c.toFixed(digits));
    onChange(r);
    setText(String(r));
  };
  return (
    <label className="num">
      <span className="num-label">
        {label}
        {hint && <span className="muted small"> {hint}</span>}
      </span>
      <span className="num-row">
        <button type="button" aria-label={`${label} 줄이기`} onClick={() => commit(value - step)}>
          −
        </button>
        <input type="text" inputMode="decimal" value={text} data-testid={testId} onChange={(e) => setText(e.target.value)} onBlur={() => commit(parseFloat(text.replace(',', '.')))} />
        <button type="button" aria-label={`${label} 늘리기`} onClick={() => commit(value + step)}>
          +
        </button>
        {unit && <span className="num-unit">{unit}</span>}
      </span>
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange, testId }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} data-testid={testId} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="toggle-row">
      <span>
        {label}
        {hint && <span className="muted small"> {hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  );
}
