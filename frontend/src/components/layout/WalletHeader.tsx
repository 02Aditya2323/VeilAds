"use client";

import { AlertTriangle, ExternalLink, PlugZap, Wallet } from "lucide-react";
import Link from "next/link";
import { formatEther } from "viem";
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { ethereumSepolia, REQUIRED_CHAIN_ID, shortAddress } from "@/lib/network";

export function WalletHeader() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { data: balance } = useBalance({ address });
  const wrongNetwork = isConnected && chainId !== REQUIRED_CHAIN_ID;
  const metaMask = connectors.find((connector) => connector.id === "metaMask") || connectors[0];

  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Link className="brand" href="/">
          <span className="brand-mark">V</span>
          <span>VEILADS</span>
        </Link>

        <nav className="nav-links" aria-label="Primary">
          <Link href="/#auction-flow">AUCTION FLOW</Link>
          <Link href="/#mechanics">MECHANICS</Link>
          <Link href="/app">MATCH</Link>
          <Link href="/advertiser">ADVERTISER</Link>
        </nav>

        <div className="wallet-cluster">
          <span className={wrongNetwork ? "badge amber" : "badge teal"}>
            {wrongNetwork ? <AlertTriangle size={14} /> : <PlugZap size={14} />}
            ETH.SEPOLIA
          </span>
          {isConnected ? (
            <>
              <span className="badge">
                <Wallet size={14} />
                {shortAddress(address)}
              </span>
              {balance ? <span className="badge">{Number(formatEther(balance.value)).toFixed(4)} ETH</span> : null}
              {wrongNetwork ? (
                <button
                  className="button warn"
                  disabled={switching}
                  onClick={() => switchChain({ chainId: ethereumSepolia.id })}
                >
                  Switch Network
                </button>
              ) : null}
              <button className="button" onClick={() => disconnect()}>
                Disconnect
              </button>
            </>
          ) : (
            <button className="button primary" disabled={isPending || !metaMask} onClick={() => connect({ connector: metaMask })}>
              <ExternalLink size={16} /> Connect MetaMask
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
