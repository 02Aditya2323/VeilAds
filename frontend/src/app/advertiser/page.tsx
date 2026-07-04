"use client";

import { RefreshCw } from "lucide-react";
import { useAccount } from "wagmi";
import { NetworkGuard } from "@/components/layout/NetworkGuard";
import { CampaignForm } from "@/components/advertiser/CampaignForm";
import { CampaignCard } from "@/components/matching/CampaignCard";
import { useCampaigns } from "@/hooks/useCampaigns";

export default function AdvertiserPage() {
  const { address } = useAccount();
  const { campaigns, loading, error, refresh } = useCampaigns(address);

  return (
    <NetworkGuard>
      <main className="container app-grid">
        <section>
          <CampaignForm onCreated={refresh} />
        </section>

        <section className="panel">
          <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <h1>Advertiser Dashboard</h1>
              <p className="card-meta">Only public campaign fields are shown. Targeting and bids stay sealed.</p>
            </div>
            <button className="icon-button" title="Refresh campaigns" onClick={refresh}>
              <RefreshCw size={18} />
            </button>
          </div>
          {error ? <div className="error-box">{error}</div> : null}
          {loading ? <div className="status-box">Loading your campaigns.</div> : null}
          {!loading && campaigns.length === 0 ? <div className="status-box">No campaigns from this wallet yet.</div> : null}
          <div className="campaign-grid">
            {campaigns.map((campaign) => (
              <CampaignCard key={campaign.id.toString()} campaign={campaign} currentAccount={address} />
            ))}
          </div>
        </section>
      </main>
    </NetworkGuard>
  );
}
