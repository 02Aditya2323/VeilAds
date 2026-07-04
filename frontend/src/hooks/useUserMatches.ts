"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { formatEther } from "viem";
import { usePublicClient } from "wagmi";
import { veilAdsAbi } from "@/lib/abi";
import { veilAdsContract, veilAdsDeployBlock } from "@/lib/contract";

export type UserMatchRow = {
  matchId: bigint;
  txHash: `0x${string}`;
  winningCampaignId: bigint;
  clearingPriceWei: bigint;
  revealed: boolean;
  attentionPassed: boolean;
  paidOut: boolean;
};

type MatchCreatedLog = {
  args?: { matchId?: bigint };
  transactionHash: `0x${string}`;
};

export function useUserMatches(user?: Address) {
  const publicClient = usePublicClient();
  const [matches, setMatches] = useState<UserMatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicClient || !user) return;
    setLoading(true);
    setError(null);
    try {
      const logs = await publicClient.getLogs({
        address: veilAdsContract.address,
        event: veilAdsAbi.find((item) => item.type === "event" && item.name === "MatchCreated") as never,
        args: { user } as never,
        fromBlock: veilAdsDeployBlock,
        toBlock: "latest",
      });

      const rows = await Promise.all(
        (logs as MatchCreatedLog[]).map(async (log) => {
          const matchId = log.args?.matchId ?? 0n;
          const [, winningCampaignId, clearingPriceWei, revealed, attentionPassed, paidOut] =
            await publicClient.readContract({
              ...veilAdsContract,
              functionName: "getMatchDetails",
              args: [matchId],
            });
          return {
            matchId,
            txHash: log.transactionHash,
            winningCampaignId,
            clearingPriceWei,
            revealed,
            attentionPassed,
            paidOut,
          };
        })
      );
      setMatches(rows.reverse());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load match history.");
    } finally {
      setLoading(false);
    }
  }, [publicClient, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    matches,
    loading,
    error,
    refresh,
    formatPrice: (wei: bigint) => `${Number(formatEther(wei)).toFixed(6)} ETH`,
  };
}
