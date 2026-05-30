type ForgeLogProps = {
  lines: string[];
};

export function ForgeLog({ lines }: ForgeLogProps) {
  return (
    <section className="terminal-panel" aria-labelledby="forge-log-title">
      <div className="terminal-header">
        <span id="forge-log-title">forgekit logs</span>
        <span className="terminal-light">LIVE</span>
      </div>
      <ol className="log-lines">
        {lines.map((line, index) => (
          <li key={`${line}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {line}
          </li>
        ))}
      </ol>
    </section>
  );
}
