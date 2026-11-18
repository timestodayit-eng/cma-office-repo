/** A module from the approved design that is built in a later phase. Says so plainly; shows no made-up numbers. */
export function Later({ title, phase, when, points }: { title: string; phase: number; when: string; points: string[] }) {
  return (
    <>
      <h1 className="h1">{title}</h1>
      <div className="card">
        <div className="row"><span className="pill p-amber">Phase {phase}</span><b>{when}</b></div>
        <p className="hint">This module is in the approved design and is not built yet. It will do this:</p>
        <ul className="alist">{points.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>
    </>
  );
}
