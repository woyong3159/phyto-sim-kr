export function Placeholder({ title, phase, items }: { title: string; phase: string; items: string[] }) {
  return (
    <>
      <header className="page-head">
        <h1>{title}</h1>
        <span className="badge">{phase} 예정</span>
      </header>
      <section className="card">
        <h2>이 탭에 들어올 내용</h2>
        <ul className="plain-list">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="muted small">아직 계산 모델이 없어서 숫자를 보여주지 않습니다. 가짜 값은 넣지 않습니다.</p>
      </section>
    </>
  );
}
