"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { veilAdsAbi } from "@/lib/abi";
import { CampaignInfo, veilAdsContract, veilAdsDeployBlock } from "@/lib/contract";

type CampaignCreatedLog = {
  args?: { campaignId?: bigint };
  transactionHash: `0x${string}`;
};

export function useCampaigns(owner?: Address) {
  const publicClient = usePublicClient();
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicClient) return;
    setLoading(true);
    setError(null);
    try {
      const count = await publicClient.readContract({
        ...veilAdsContract,
        functionName: "getCampaignCount",
      });
      const createdLogs = await publicClient.getLogs({
        address: veilAdsContract.address,
        event: veilAdsAbi.find((item) => item.type === "event" && item.name === "CampaignCreated") as never,
        fromBlock: veilAdsDeployBlock,
        toBlock: "latest",
      });
      const createTxById = new Map<string, `0x${string}`>();
      for (const log of createdLogs as CampaignCreatedLog[]) {
        const campaignId = String(log.args?.campaignId ?? "");
        if (campaignId) createTxById.set(campaignId, log.transactionHash);
      }

      const rows = await Promise.all(
        Array.from({ length: Number(count) }, async (_, index) => {
          const [advertiser, escrow, active, adURI] = await publicClient.readContract({
            ...veilAdsContract,
            functionName: "getCampaignInfo",
            args: [BigInt(index)],
          });
          return {
            id: BigInt(index),
            advertiser,
            escrow,
            active,
            adURI,
            createTxHash: createTxById.get(String(index)),
          } satisfies CampaignInfo;
        })
      );

      const normalizedOwner = owner?.toLowerCase();
      setCampaigns(
        normalizedOwner
          ? rows.filter((campaign) => campaign.advertiser.toLowerCase() === normalizedOwner)
          : rows
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load campaigns.");
    } finally {
      setLoading(false);
    }
  }, [owner, publicClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { campaigns, loading, error, refresh };
}
