import { Lock, Unlock } from "lucide-react";

export function LockBadge({ unlocked = false, label }: { unlocked?: boolean; label?: string }) {
  return (
    <span className={unlocked ? "badge teal" : "badge violet"}>
      {unlocked ? <Unlock size={14} /> : <Lock size={14} />}
      {label || (unlocked ? "Revealed" : "Sealed")}
    </span>
  );
}
