"use client";

import { UploadCloud } from "lucide-react";
import { FormEvent, useState } from "react";
import { decodeEventLog, parseEther } from "viem";
import { usePublicClient, useWalletClient, useWriteContract } from "wagmi";
import { encryptBid, encryptUint8Set } from "@/lib/cofhe";
import { veilAdsAbi } from "@/lib/abi";
import { veilAdsContract } from "@/lib/contract";
import { ProfileSliderPanel } from "@/components/matching/ProfileSliderPanel";
import { FlowStep, TxFlow } from "@/components/shared/TxFlow";
import { demoLog } from "@/lib/demoLog";

const MAX_RELEVANCE = 50_000n;

export function CampaignForm({ onCreated }: { onCreated: () => void }) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();
  const [targeting, setTargeting] = useState([80, 35, 20, 45, 60]);
  const [maxPayoutEth, setMaxPayoutEth] = useState("0.005");
  const [escrowEth, setEscrowEth] = useState("0.02");
  const [adURI, setAdURI] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<FlowStep[]>([]);

  function startFlow() {
    setSteps([
      { id: "pinata", label: "Pin creative to IPFS", status: file ? "active" : "done", detail: file ? "Uploading through Pinata API." : "Using pasted ad URI." },
      { id: "encrypt", label: "Encrypt targeting + scaled bid", status: file ? "pending" : "active", detail: "Plain values stay in browser; contract receives CoFHE handles." },
      { id: "tx", label: "Create campaign transaction", status: "pending", detail: "Escrow is funded on Ethereum Sepolia." },
      { id: "indexed", label: "Campaign visible from chain", status: "pending", detail: "Dashboard refresh reads public campaign info." },
    ]);
  }

  function setStep(id: string, patch: Partial<FlowStep>) {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, ...patch } : step)));
  }

  async function uploadIfNeeded() {
    if (!file) return adURI.trim();
    setStatus("Uploading creative to Pinata.");
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch("/api/pinata", {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json()) as { uri?: string; error?: string };
    if (!response.ok || !payload.uri) {
      throw new Error(payload.error || "Pinata upload failed.");
    }
    setAdURI(payload.uri);
    return payload.uri;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startFlow();
    try {
      if (!publicClient || !walletClient) throw new Error("Connect MetaMask first.");
      console.group("VeilAds createCampaign");
      console.log("Plain targeting values, local only:", targeting);
      console.log("Max payout at perfect match:", `${maxPayoutEth} ETH`);
      console.log("Escrow funding:", `${escrowEth} ETH`);
      demoLog("campaign", "create campaign started", {
        targeting,
        maxPayoutEth,
        escrowEth,
        hasFile: Boolean(file),
      });
      const creativeURI = await uploadIfNeeded();
      if (!creativeURI) throw new Error("Add an IPFS URI or upload a creative file.");
      setStep("pinata", { status: "done", detail: creativeURI });
      demoLog("campaign", "creative uri ready", { creativeURI });

      const maxPayoutWei = parseEther(maxPayoutEth);
      const bidPerRelevanceWei = maxPayoutWei / MAX_RELEVANCE;
      if (bidPerRelevanceWei === 0n) {
        throw new Error("Max payout is too small after relevance scaling.");
      }

      setStep("encrypt", { status: "active" });
      setStatus("Encrypting targeting and scaled bid.");
      const [encryptedTargeting, encryptedBid] = await Promise.all([
        encryptUint8Set(publicClient, walletClient, targeting),
        encryptBid(publicClient, walletClient, bidPerRelevanceWei),
      ]);
      console.log("Encrypted targeting handles:", encryptedTargeting);
      console.log("Encrypted bid handle:", encryptedBid);
      demoLog("campaign", "encrypted campaign inputs ready", {
        encryptedTargeting,
        encryptedBid,
        bidPerRelevanceWei,
      });
      setStep("encrypt", { status: "done", detail: "CoFHE encrypted handles generated." });

      setStep("tx", { status: "active" });
      setStatus("Submitting campaign to Ethereum Sepolia.");
      const hash = await writeContractAsync({
        ...veilAdsContract,
        functionName: "createCampaign",
        args: [encryptedTargeting, encryptedBid, creativeURI],
        value: parseEther(escrowEth),
      });
      console.log("createCampaign tx hash:", hash);
      demoLog("campaign", "createCampaign tx submitted", { txHash: hash });
      setStep("tx", { status: "active", txHash: hash, detail: "Waiting for confirmation." });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setStep("tx", { status: "done", txHash: hash, detail: `Confirmed in block ${receipt.blockNumber.toString()}.` });
      demoLog("campaign", "createCampaign confirmed", { txHash: hash, blockNumber: receipt.blockNumber });
      let campaignId = "";
      for (const log of receipt.logs) {
        try {
          const parsed = decodeEventLog({
            abi: veilAdsAbi,
            data: log.data,
            topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]],
          });
          if (parsed.eventName === "CampaignCreated") campaignId = parsed.args.campaignId.toString();
        } catch {
          // Ignore non-VeilAds logs.
        }
      }
      setStep("indexed", { status: "done", detail: campaignId ? `Campaign #${campaignId} created.` : "Campaign created." });
      setStatus(`Campaign ${campaignId || ""} created.`);
      console.log("Campaign id:", campaignId || "(event not parsed)");
      demoLog("campaign", "campaign indexed", { campaignId });
      console.groupEnd();
      onCreated();
    } catch (err) {
      console.error("createCampaign failed:", err);
      console.groupEnd();
      setSteps((current) => current.map((step) => (step.status === "active" ? { ...step, status: "error" } : step)));
      setError(err instanceof Error ? err.message : "Campaign creation failed.");
      setStatus(null);
    }
  }

  return (
    <form className="form-stack" onSubmit={onSubmit}>
      <ProfileSliderPanel title="Encrypted Targeting" values={targeting} onChange={setTargeting} />
      <div className="panel form-stack">
        <div className="field">
          <label htmlFor="bid">Max payout at perfect match in ETH</label>
          <input
            id="bid"
            inputMode="decimal"
            value={maxPayoutEth}
            onChange={(event) => setMaxPayoutEth(event.target.value)}
          />
          <p className="card-meta">
            Encrypted as wei per relevance point, so a 50,000 relevance match cannot exceed this cap.
          </p>
        </div>
        <div className="field">
          <label htmlFor="escrow">Public escrow funding in ETH</label>
          <input id="escrow" inputMode="decimal" value={escrowEth} onChange={(event) => setEscrowEth(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ad-uri">Ad URI</label>
          <input id="ad-uri" placeholder="ipfs://..." value={adURI} onChange={(event) => setAdURI(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="creative">Upload creative to Pinata</label>
          <input id="creative" type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </div>
        <button className="button primary" type="submit">
          <UploadCloud size={16} /> Create Campaign
        </button>
        <TxFlow title="Campaign Creation Flow" steps={steps} />
        {status ? <div className="success-box">{status}</div> : null}
        {error ? <div className="error-box">{error}</div> : null}
      </div>
    </form>
  );
}
