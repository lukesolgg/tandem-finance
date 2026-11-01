import { formatMoney } from "./ui";

/** Dependency-free SVG charts. Server-rendered; CSS variables theme them. */

export function CashFlowChart({ data }: { data: { key: string; label: string; income: number; spend: number }[] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.spend]));
  const W = 600;
  const H = 180;
  const pad = 22;
  const slot = W / data.length;
  const bw = Math.min(26, slot / 3.2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="Income and spending by month">
      {[0.5, 1].map((f) => (
        <line key={f} x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeDasharray="3 4" />
      ))}
      {data.map((d, i) => {
        const cx = slot * i + slot / 2;
        return (
          <g key={d.key}>
            <rect x={cx - bw - 2} y={y(d.income)} width={bw} height={Math.max(0, H - pad - y(d.income))} rx={4} fill="var(--pos)" opacity={0.85}>
              <title>{`${d.label} income ${formatMoney(d.income)}`}</title>
            </rect>
            <rect x={cx + 2} y={y(d.spend)} width={bw} height={Math.max(0, H - pad - y(d.spend))} rx={4} fill="var(--accent)">
              <title>{`${d.label} spending ${formatMoney(d.spend)}`}</title>
            </rect>
            <text x={cx} y={H - 5} textAnchor="middle" fontSize={12} fill="var(--muted)">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function CompareBars({ rows }: { rows: { label: string; emoji?: string | null; now: number; prev: number }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.now, r.prev]));
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const delta = r.prev ? (r.now - r.prev) / r.prev : null;
        return (
          <li key={r.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{r.emoji} {r.label}</span>
              <span className="tabular whitespace-nowrap">
                {formatMoney(r.now, { whole: true })}
                {delta !== null && Math.abs(delta) >= 0.05 && (
                  <span className={`ml-1.5 text-xs ${delta > 0 ? "text-warn" : "text-pos"}`}>{delta > 0 ? "↑" : "↓"}{Math.abs(Math.round(delta * 100))}%</span>
                )}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-surface-2">
              <div className="absolute inset-y-0 left-0 rounded-full bg-text/15" style={{ width: `${(r.prev / max) * 100}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${(r.now / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Ring({ value, size = 56, stroke = 6, tone = "var(--accent)" }: { value: number; size?: number; stroke?: number; tone?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} />
    </svg>
  );
}
