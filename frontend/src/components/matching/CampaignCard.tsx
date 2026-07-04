import { ExternalLink } from "lucide-react";
import { formatEther } from "viem";
import { CampaignInfo } from "@/lib/contract";
import { LockBadge } from "@/components/shared/LockBadge";
import { txUrl } from "@/lib/explorer";
import { normalizeAdLink } from "@/lib/media";

export function CampaignCard({
  campaign,
  revealedWinnerId,
  currentAccount,
}: {
  campaign: CampaignInfo;
  revealedWinnerId?: bigint | null;
  currentAccount?: string;
}) {
  const isWinner = revealedWinnerId === campaign.id;
  const isLoser = revealedWinnerId !== null && revealedWinnerId !== undefined && !isWinner;
  const mine = currentAccount && campaign.advertiser.toLowerCase() === currentAccount.toLowerCase();
  const className = ["campaign-card", isWinner ? "winner" : "", isLoser ? "loser" : "", mine ? "mine" : ""]
    .filter(Boolean)
    .join(" ");
  const link = normalizeAdLink(campaign.adURI);

  return (
    <article className={className}>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <LockBadge unlocked={isWinner} label={isWinner ? "Winner" : "Sealed"} />
        <strong>#{campaign.id.toString()}</strong>
      </div>
      <div>
        <h3>{campaign.active ? "Active Campaign" : "Inactive Campaign"}</h3>
        <p className="card-meta">{campaign.adURI || "No creative URI"}</p>
      </div>
      <div className={isWinner ? "payout-amount" : "card-meta"}>
        <span>{isWinner ? "Clearing escrow available" : "Public escrow"}</span>
        <strong>{Number(formatEther(campaign.escrow)).toFixed(5)} ETH</strong>
      </div>
      {campaign.adURI ? (
        <a className="button" href={link} target="_blank" rel="noreferrer">
          <ExternalLink size={15} /> Creative
        </a>
      ) : null}
      {campaign.createTxHash ? (
        <a className="button" href={txUrl(campaign.createTxHash)} target="_blank" rel="noreferrer">
          <ExternalLink size={15} /> Creation Tx
        </a>
      ) : null}
    </article>
  );
}
