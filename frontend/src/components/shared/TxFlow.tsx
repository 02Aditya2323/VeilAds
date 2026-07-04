import { CheckCircle2, Circle, ExternalLink, Loader2, XCircle } from "lucide-react";
import { txUrl } from "@/lib/explorer";

export type FlowStep = {
  id: string;
  label: string;
  detail?: string;
  status: "pending" | "active" | "done" | "error";
  txHash?: `0x${string}`;
};

export function TxFlow({ title, steps }: { title: string; steps: FlowStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="flow-card">
      <h3>{title}</h3>
      <div className="flow-list">
        {steps.map((step, index) => (
          <div className={`flow-step ${step.status}`} key={step.id}>
            <div className="flow-icon">
              {step.status === "done" ? (
                <CheckCircle2 size={18} />
              ) : step.status === "active" ? (
                <Loader2 size={18} />
              ) : step.status === "error" ? (
                <XCircle size={18} />
              ) : (
                <Circle size={18} />
              )}
            </div>
            <div className="flow-copy">
              <strong>
                {index + 1}. {step.label}
              </strong>
              {step.detail ? <span>{step.detail}</span> : null}
              {step.txHash ? (
                <a href={txUrl(step.txHash)} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> Etherscan
                </a>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
