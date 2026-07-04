"use client";

import { useCallback, useState } from "react";
import type { WalletClient } from "viem";
import { decodeEventLog, formatEther } from "viem";
import { usePublicClient, useWalletClient, useWriteContract } from "wagmi";
import { decryptForTx, encryptViewTime } from "@/lib/cofhe";
import { veilAdsAbi } from "@/lib/abi";
import { veilAdsContract } from "@/lib/contract";
import { demoLog } from "@/lib/demoLog";

export type MatchFlowState =
  | "idle"
  | "encrypting"
  | "matching"
  | "revealing"
  | "revealed"
  | "engagement"
  | "attention"
  | "ready"
  | "paid"
  | "error";

export type RevealedMatch = {
  matchId: bigint;
  winningCampaignId: bigint;
  clearingPriceWei: bigint;
};

export type PayoutProof = {
  txHash: `0x${string}`;
  balanceBefore: bigint;
  balanceAfter: bigint;
  delta: bigint;
};

export function useMatchReveal() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<MatchFlowState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<RevealedMatch | null>(null);
  const [attentionPassed, setAttentionPassed] = useState<boolean | null>(null);
  const [payoutProof, setPayoutProof] = useState<PayoutProof | null>(null);

  const requireClients = useCallback(() => {
    if (!publicClient || !walletClient) {
      throw new Error("Connect MetaMask before running the flow.");
    }
    return { publicClient, walletClient: walletClient as WalletClient };
  }, [publicClient, walletClient]);

  const revealMatch = useCallback(
    async (matchId: bigint) => {
      const clients = requireClients();
      setState("revealing");
      console.group(`VeilAds reveal match #${matchId.toString()}`);
      demoLog("reveal", "starting reveal", { matchId });

      const [winnerHandle, priceHandle] = await Promise.all([
        clients.publicClient.readContract({
          ...veilAdsContract,
          functionName: "getMatchWinnerHandle",
          args: [matchId],
        }),
        clients.publicClient.readContract({
          ...veilAdsContract,
          functionName: "getMatchPriceHandle",
          args: [matchId],
        }),
      ]);
      console.log("Encrypted winner handle:", winnerHandle);
      console.log("Encrypted clearing price handle:", priceHandle);
      demoLog("reveal", "encrypted handles read", { winnerHandle, priceHandle });

      const [winnerResult, priceResult] = await Promise.all([
        decryptForTx(clients.publicClient, clients.walletClient, winnerHandle),
        decryptForTx(clients.publicClient, clients.walletClient, priceHandle),
      ]);
      console.log("Threshold decrypt winner result:", winnerResult.decryptedValue);
      console.log("Threshold decrypt clearing price:", formatEther(priceResult.decryptedValue), "ETH");
      console.log("Winner signature:", winnerResult.signature);
      console.log("Price signature:", priceResult.signature);
      demoLog("reveal", "threshold decrypt results", {
        winner: winnerResult.decryptedValue,
        clearingPriceWei: priceResult.decryptedValue,
        winnerSignature: winnerResult.signature,
        priceSignature: priceResult.signature,
      });

      const txHash = await writeContractAsync({
        ...veilAdsContract,
        functionName: "submitReveal",
        args: [
          matchId,
          Number(winnerResult.decryptedValue),
          winnerResult.signature,
          priceResult.decryptedValue,
          priceResult.signature,
        ],
      });
      console.log("submitReveal tx hash:", txHash);
      demoLog("reveal", "submitReveal tx submitted", { txHash });
      await clients.publicClient.waitForTransactionReceipt({ hash: txHash });

      const [, winningCampaignId, clearingPriceWei] = await clients.publicClient.readContract({
        ...veilAdsContract,
        functionName: "getMatchResult",
        args: [matchId],
      });

      const result = { matchId, winningCampaignId, clearingPriceWei };
      setMatch(result);
      setState("revealed");
      demoLog("reveal", "match revealed", result);
      console.groupEnd();
      return result;
    },
    [requireClients, writeContractAsync]
  );

  const parseMatchCreated = useCallback((logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[]) => {
    for (const log of logs) {
      try {
        const parsed = decodeEventLog({
          abi: veilAdsAbi,
          data: log.data,
          topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]],
        });
        if (parsed.eventName === "MatchCreated") {
          return parsed.args.matchId;
        }
      } catch {
        // Ignore logs from other contracts.
      }
    }
    throw new Error("MatchCreated event was not found in the transaction receipt.");
  }, []);

  const submitAttention = useCallback(
    async (matchId: bigint, seconds: number) => {
      const clients = requireClients();
      setState("engagement");
      console.group(`VeilAds attention gate for match #${matchId.toString()}`);
      console.log("Measured viewing seconds:", seconds);
      demoLog("attention", "encrypting measured seconds", { matchId, seconds });
      const encrypted = await encryptViewTime(clients.publicClient, clients.walletClient, seconds);
      console.log("Encrypted view-time handle:", encrypted);
      demoLog("attention", "encrypted view-time handle", { encrypted });
      const engagementHash = await writeContractAsync({
        ...veilAdsContract,
        functionName: "submitEngagement",
        args: [matchId, encrypted],
      });
      console.log("submitEngagement tx hash:", engagementHash);
      demoLog("attention", "submitEngagement tx submitted", { txHash: engagementHash });
      await clients.publicClient.waitForTransactionReceipt({ hash: engagementHash });

      setState("attention");
      const attentionHandle = await clients.publicClient.readContract({
        ...veilAdsContract,
        functionName: "getAttentionHandle",
        args: [matchId],
      });
      console.log("Encrypted attention boolean handle:", attentionHandle);
      demoLog("attention", "attention boolean handle read", { attentionHandle });
      const attentionResult = await decryptForTx(clients.publicClient, clients.walletClient, attentionHandle);
      const passed = attentionResult.decryptedValue === 1n;
      console.log("Threshold decrypt attention result:", passed);
      console.log("Attention signature:", attentionResult.signature);
      demoLog("attention", "threshold decrypt attention result", {
        passed,
        signature: attentionResult.signature,
      });

      const publishHash = await writeContractAsync({
        ...veilAdsContract,
        functionName: "submitAttentionResult",
        args: [matchId, passed, attentionResult.signature],
      });
      console.log("submitAttentionResult tx hash:", publishHash);
      demoLog("attention", "submitAttentionResult tx submitted", { txHash: publishHash });
      await clients.publicClient.waitForTransactionReceipt({ hash: publishHash });

      setAttentionPassed(passed);
      setState(passed ? "ready" : "revealed");
      demoLog("attention", "attention state finalized", { passed });
      console.groupEnd();
      return passed;
    },
    [requireClients, writeContractAsync]
  );

  const claimPayout = useCallback(
    async (matchId: bigint) => {
      const clients = requireClients();
      const account = clients.walletClient.account?.address;
      const balanceBefore = account ? await clients.publicClient.getBalance({ address: account }) : 0n;
      console.group(`VeilAds claim payout for match #${matchId.toString()}`);
      console.log("Balance before claim:", formatEther(balanceBefore), "ETH");
      demoLog("payout", "claimPayout starting", { matchId, balanceBefore });
      const hash = await writeContractAsync({
        ...veilAdsContract,
        functionName: "claimPayout",
        args: [matchId],
      });
      console.log("claimPayout tx hash:", hash);
      demoLog("payout", "claimPayout tx submitted", { txHash: hash });
      await clients.publicClient.waitForTransactionReceipt({ hash });
      const balanceAfter = account ? await clients.publicClient.getBalance({ address: account }) : 0n;
      const proof = {
        txHash: hash,
        balanceBefore,
        balanceAfter,
        delta: balanceAfter - balanceBefore,
      };
      console.log("Balance after claim:", formatEther(balanceAfter), "ETH");
      console.log("Net balance delta after gas:", formatEther(proof.delta), "ETH");
      demoLog("payout", "claimPayout confirmed", proof);
      console.groupEnd();
      setPayoutProof(proof);
      setState("paid");
    },
    [requireClients, writeContractAsync]
  );

  const runWithErrorState = useCallback(async <T,>(task: () => Promise<T>) => {
    setError(null);
    try {
      return await task();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Transaction failed.");
      throw err;
    }
  }, []);

  return {
    state,
    setState,
    error,
    match,
    setMatch,
    attentionPassed,
    setAttentionPassed,
    payoutProof,
    revealMatch,
    parseMatchCreated,
    submitAttention,
    claimPayout,
    runWithErrorState,
    formattedPrice: match ? `${Number(formatEther(match.clearingPriceWei)).toFixed(6)} ETH` : null,
  };
}
