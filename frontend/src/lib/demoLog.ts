"use client";

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalize(item)])
    );
  }
  return value;
}

export function demoLog(scope: string, event: string, payload?: unknown) {
  const normalized = normalize(payload);
  console.log(`[VeilAds:${scope}] ${event}`, normalized ?? "");
  void fetch("/api/demo-log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope, event, payload: normalized }),
  }).catch(() => {});
}
