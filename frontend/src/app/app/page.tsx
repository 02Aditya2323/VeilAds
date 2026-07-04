"use client";

import { Play, RefreshCw, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useWalletClient, useWriteContract } from "wagmi";
import { NetworkGuard } from "@/components/layout/NetworkGuard";
import { AttentionPanel } from "@/components/matching/AttentionPanel";
import { CampaignCard } from "@/components/matching/CampaignCard";
import { MatchHistory } from "@/components/matching/MatchHistory";
import { ProfileSliderPanel } from "@/components/matching/ProfileSliderPanel";
import { RevealStatus } from "@/components/matching/RevealStatus";
import { encryptUint8Set } from "@/lib/cofhe";
import { veilAdsContract } from "@/lib/contract";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useMatchReveal } from "@/hooks/useMatchReveal";
import { useUserMatches } from "@/hooks/useUserMatches";
import { txUrl } from "@/lib/explorer";
import { formatEther } from "viem";
import { FlowStep, TxFlow } from "@/components/shared/TxFlow";
import { demoLog } from "@/lib/demoLog";

function buildUserFlowSteps(state: ReturnType<typeof useMatchReveal>["state"], hasMatch: boolean, hasPayout: boolean): FlowStep[] {
  return [
    {
      id: "profile",
      label: "Encrypt user profile",
      status: state === "encrypting" ? "active" : hasMatch || state !== "idle" ? "done" : "pending",
      detail: "Interest values become CoFHE input handles.",
    },
    {
      id: "auction",
      label: "Run sealed auction",
      status: state === "matching" ? "active" : hasMatch ? "done" : "pending",
      detail: "Contract compares encrypted effective bids.",
    },
    {
      id: "reveal",
      label: "Reveal winner + clearing price",
      status: state === "revealing" ? "active" : hasMatch ? "done" : "pending",
      detail: "Threshold signatures are published on-chain.",
    },
    {
      id: "attention",
      label: "Autoplay ad and verify attention",
      status: state === "engagement" || state === "attention" ? "active" : state === "ready" || state === "paid" ? "done" : "pending",
      detail: "The UI waits 6 seconds, then submits encrypted view time.",
    },
    {
      id: "payout",
      label: "Claim payout from escrow",
      status: state === "ready" ? "active" : hasPayout ? "done" : "pending",
      detail: "Payout tx moves ETH from campaign escrow to user wallet.",
    },
  ];
}

export default function MatchingPage() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();
  const { campaigns, loading, error: campaignError, refresh } = useCampaigns();
  const matchHistory = useUserMatches(address);
  const flow = useMatchReveal();
  const [profile, setProfile] = useState([95, 30, 15, 25, 70]);
  const autoClaimedRef = useRef(false);
  const winningCampaign = campaigns.find((campaign) => campaign.id === flow.match?.winningCampaignId);
  const userFlowSteps = buildUserFlowSteps(flow.state, Boolean(flow.match), Boolean(flow.payoutProof));

  useEffect(() => {
    if (flow.state !== "ready" || !flow.match || autoClaimedRef.current) return;
    autoClaimedRef.current = true;
    void claim();
  }, [flow.match, flow.state]);

  async function submitProfile() {
    await flow.runWithErrorState(async () => {
      if (!publicClient || !walletClient) throw new Error("Connect MetaMask first.");
      console.group("VeilAds matchAd");
      console.log("Plain user profile, local only:", profile);
      demoLog("match", "plain user profile local only", { profile });
      flow.setState("encrypting");
      const encryptedProfile = await encryptUint8Set(publicClient, walletClient, profile);
      console.log("Encrypted profile handles:", encryptedProfile);
      demoLog("match", "encrypted profile handles ready", { encryptedProfile });
      flow.setState("matching");
      const hash = await writeContractAsync({
        ...veilAdsContract,
        functionName: "matchAd",
        args: [encryptedProfile],
      });
      console.log("matchAd tx hash:", hash);
      demoLog("match", "matchAd tx submitted", { txHash: hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const matchId = flow.parseMatchCreated(receipt.logs);
      console.log("Created match id:", matchId.toString());
      demoLog("match", "match created", { matchId, blockNumber: receipt.blockNumber });
      console.groupEnd();
      await flow.revealMatch(matchId);
      await matchHistory.refresh();
    });
  }

  async function submitAttention(viewSeconds: number) {
    if (!flow.match) return;
    await flow.runWithErrorState(() => flow.submitAttention(flow.match!.matchId, viewSeconds));
    await matchHistory.refresh();
  }

  async function claim() {
    if (!flow.match) return;
    await flow.runWithErrorState(() => flow.claimPayout(flow.match!.matchId));
    await refresh();
    await matchHistory.refresh();
  }

  return (
    <NetworkGuard>
      <main className="container app-grid">
        <aside className="form-stack">
          <ProfileSliderPanel values={profile} onChange={setProfile} />
          <div className="panel form-stack">
            <button className="button primary" onClick={submitProfile} disabled={flow.state !== "idle" && flow.state !== "error"}>
              <Play size={16} /> Run Sealed Match
            </button>
          </div>
          <TxFlow title="User Match Flow" steps={userFlowSteps} />
          <RevealStatus state={flow.state} error={flow.error} />
          {flow.match ? (
            <div className="success-box">
              <Trophy size={16} /> Winner #{flow.match.winningCampaignId.toString()} at {flow.formattedPrice}
            </div>
          ) : null}
          {flow.payoutProof ? (
            <div className="panel payout-proof">
              <h2>Payout Proof</h2>
              <p className="card-meta">Wallet balance delta includes gas, so it may be slightly below clearing price.</p>
              <div className="proof-grid">
                <span>Before</span>
                <strong>{Number(formatEther(flow.payoutProof.balanceBefore)).toFixed(6)} ETH</strong>
                <span>After</span>
                <strong>{Number(formatEther(flow.payoutProof.balanceAfter)).toFixed(6)} ETH</strong>
                <span>Net delta</span>
                <strong>{Number(formatEther(flow.payoutProof.delta)).toFixed(6)} ETH</strong>
              </div>
              <a className="button" href={txUrl(flow.payoutProof.txHash)} target="_blank" rel="noreferrer">
                View Payout Tx
              </a>
            </div>
          ) : null}
        </aside>

        <section className="panel">
          <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <h1>Campaign Pool</h1>
              <p className="card-meta">Cards stay locked until the auction result is published.</p>
            </div>
            <button className="icon-button" title="Refresh campaigns" onClick={refresh}>
              <RefreshCw size={18} />
            </button>
          </div>
          {campaignError ? <div className="error-box">{campaignError}</div> : null}
          {loading ? <div className="status-box">Loading campaigns.</div> : null}
          {!loading && campaigns.length === 0 ? (
            <div className="status-box">No campaigns yet. Create at least two advertiser campaigns before matching.</div>
          ) : null}
          <div className="campaign-grid">
            {campaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id.toString()}
                campaign={campaign}
                currentAccount={address}
                revealedWinnerId={flow.match?.winningCampaignId ?? null}
              />
            ))}
          </div>
        </section>
        {flow.match && winningCampaign ? (
          <section className="attention-stage">
            <AttentionPanel
              campaign={winningCampaign}
              disabled={flow.state !== "revealed"}
              submitted={flow.state === "ready" || flow.state === "paid" || flow.state === "engagement" || flow.state === "attention"}
              onSubmit={submitAttention}
            />
          </section>
        ) : null}
        <section style={{ gridColumn: "1 / -1" }}>
          <MatchHistory
            matches={matchHistory.matches}
            loading={matchHistory.loading}
            error={matchHistory.error}
            formatPrice={matchHistory.formatPrice}
          />
        </section>
      </main>
    </NetworkGuard>
  );
}
