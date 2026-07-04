import { ExternalLink } from "lucide-react";
import { UserMatchRow } from "@/hooks/useUserMatches";
import { txUrl } from "@/lib/explorer";

export function MatchHistory({
  matches,
  loading,
  error,
  formatPrice,
}: {
  matches: UserMatchRow[];
  loading: boolean;
  error: string | null;
  formatPrice: (wei: bigint) => string;
}) {
  return (
    <div className="panel">
      <h2>Your Match History</h2>
      <p className="card-meta">Read from MatchCreated logs and match state on Ethereum Sepolia.</p>
      {error ? <div className="error-box">{error}</div> : null}
      {loading ? <div className="status-box">Loading match history.</div> : null}
      {!loading && matches.length === 0 ? <div className="status-box">No matches from this wallet yet.</div> : null}
      <div className="history-list">
        {matches.map((match) => (
          <div className="history-row" key={match.matchId.toString()}>
            <div>
              <strong>Match #{match.matchId.toString()}</strong>
              <span className="card-meta">
                Winner #{match.winningCampaignId.toString()} · {formatPrice(match.clearingPriceWei)}
              </span>
            </div>
            <div className="toolbar">
              <span className={match.paidOut ? "badge teal" : match.attentionPassed ? "badge amber" : "badge violet"}>
                {match.paidOut ? "Paid" : match.attentionPassed ? "Ready" : match.revealed ? "Revealed" : "Pending"}
              </span>
              <a className="button" href={txUrl(match.txHash)} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> Match Tx
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
