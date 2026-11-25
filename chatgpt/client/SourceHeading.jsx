export function SourceHeading({ id, title, hint, children }) {
  return <header className="omgpt-source-heading">
    <div><h2 id={id}>{title}</h2>{hint && <p>{hint}</p>}</div>
    {children && <div className="omgpt-actions">{children}</div>}
  </header>;
}
