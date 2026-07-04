export function StatChip({ value, label, tone = "violet" }: { value: string; label: string; tone?: "violet" | "teal" | "ink" }) {
  return (
    <div className="stat-chip" style={{ padding: 14, boxShadow: `5px 5px 0 ${tone === "teal" ? "var(--teal)" : tone === "violet" ? "var(--violet)" : "var(--ink)"}` }}>
      <strong style={{ display: "block", fontSize: 28 }}>{value}</strong>
      <span className="card-meta">{label}</span>
    </div>
  );
}
