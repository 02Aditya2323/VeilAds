import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { MatchFlowState } from "@/hooks/useMatchReveal";

const labels: Record<MatchFlowState, string> = {
  idle: "Ready for encrypted matching.",
  encrypting: "Encrypting your profile in the browser.",
  matching: "Submitting sealed auction transaction.",
  revealing: "Decrypting winner and clearing price for on-chain publish.",
  revealed: "Auction result revealed. Attention gate is next.",
  engagement: "Encrypting engagement time.",
  attention: "Publishing encrypted attention result.",
  ready: "Attention verified. Payout is available.",
  paid: "Payout claimed.",
  error: "Flow stopped.",
};

export function RevealStatus({ state, error }: { state: MatchFlowState; error?: string | null }) {
  const done = state === "paid" || state === "ready";
  const failed = state === "error";
  return (
    <div className={failed ? "error-box" : done ? "success-box" : "status-box"}>
      <div className="toolbar">
        {failed ? <XCircle size={18} /> : done ? <CheckCircle2 size={18} /> : <Loader2 size={18} />}
        <strong>{labels[state]}</strong>
      </div>
      {error ? <p style={{ margin: "10px 0 0" }}>{error}</p> : null}
    </div>
  );
}
