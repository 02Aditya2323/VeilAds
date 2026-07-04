"use client";

import { ReactNode } from "react";
import { useAccount } from "wagmi";
import { isContractConfigured } from "@/lib/contract";
import { REQUIRED_CHAIN_ID } from "@/lib/network";

export function NetworkGuard({ children }: { children: ReactNode }) {
  const { isConnected, chainId } = useAccount();

  if (!isContractConfigured) {
    return (
      <div className="container section">
        <div className="error-box">
          Set <code>NEXT_PUBLIC_VEILADS_ADDRESS</code> in <code>frontend/.env.local</code> after deploying VeilAds.
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="container section">
        <div className="status-box">Connect MetaMask to use the VeilAds demo.</div>
      </div>
    );
  }

  if (chainId !== REQUIRED_CHAIN_ID) {
    return (
      <div className="container section">
        <div className="error-box">Wrong network. Switch MetaMask to Ethereum Sepolia.</div>
      </div>
    );
  }

  return <>{children}</>;
}
