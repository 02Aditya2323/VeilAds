import { ArrowRight, Lock, ShieldCheck, Unlock, WalletCards } from "lucide-react";
import Link from "next/link";
import { LockBadge } from "@/components/shared/LockBadge";
import { StatChip } from "@/components/shared/StatChip";
import { isContractConfigured, veilAdsAddress } from "@/lib/contract";

export default function LandingPage() {
  const contractUrl = `https://sepolia.etherscan.io/address/${veilAdsAddress}`;

  return (
    <main>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <div className="eyebrow-row">
              <span className="badge violet">FHE.SEALED</span>
              <span className="badge teal">COFHE.LIVE</span>
              <span className="badge">ETH.SEPOLIA</span>
            </div>
            <h1 className="hero-title">
              EVERYTHING&apos;S SEALED.
              <br />
              <span className="sticker">UNTIL ONE ISN&apos;T.</span>
            </h1>
            <p className="hero-copy">
              VeilAds runs advertiser bids and user interest profiles through Fully Homomorphic Encryption on
              Fhenix. Every number stays ciphertext until the auction resolves. Only the winning match and its
              clearing price are revealed.
            </p>
            <div className="hero-actions">
              <Link className="button primary" href="/app">
                Launch Demo <ArrowRight size={16} />
              </Link>
              {isContractConfigured ? (
                <a className="button" href={contractUrl} target="_blank" rel="noreferrer">
                  View Contract
                </a>
              ) : (
                <span className="badge amber">Contract pending deploy</span>
              )}
            </div>
          </div>

          <div className="demo-board" aria-label="Sealed auction preview">
            <div className="sealed-row">
              <div className="mini-card">
                <div>
                  <strong>Campaign A</strong>
                  <span>encrypted targeting + bid</span>
                </div>
                <LockBadge />
              </div>
              <div className="mini-card">
                <div>
                  <strong>FHE Auction</strong>
                  <span>dot product x max bid</span>
                </div>
                <span className="badge amber">2nd price</span>
              </div>
              <div className="mini-card">
                <div>
                  <strong>Winner + Price</strong>
                  <span>published with threshold signature</span>
                </div>
                <LockBadge unlocked />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="stat-bar" aria-label="Protocol facts">
        <div className="container stat-grid">
          <div className="stat-cell">
            <strong style={{ color: "var(--violet-deep)" }}>0</strong>
            <span>RAW VALUES EVER REVEALED</span>
          </div>
          <div className="stat-cell">
            <strong style={{ color: "var(--teal-deep)" }}>2</strong>
            <span>NUMBERS DECRYPTED PER MATCH</span>
          </div>
          <div className="stat-cell">
            <strong>1</strong>
            <span>CONTRACT, NO CROSS-PERMISSION RISK</span>
          </div>
          <div className="stat-cell">
            <strong style={{ color: "var(--teal-deep)" }}>ETH</strong>
            <span>NATIVE ESCROW, NO CUSTOM TOKEN</span>
          </div>
        </div>
      </section>

      <section id="auction-flow" className="section dark">
        <div className="container">
          <span className="badge teal">Auction Flow</span>
          <h2 className="section-title">Watch sealed bids become a public clearing price.</h2>
          <div className="flow-grid">
            <div className="flow-panel">
              <Lock size={28} />
              <h3>Sealed Inputs</h3>
              <p>Advertiser targeting, max bids, and user profiles enter as encrypted CoFHE inputs.</p>
            </div>
            <div className="flow-panel">
              <ShieldCheck size={28} />
              <h3>Ciphertext Compute</h3>
              <p>The contract ranks relevance-weighted effective bids without seeing any raw number.</p>
            </div>
            <div className="flow-panel">
              <Unlock size={28} />
              <h3>Verified Reveal</h3>
              <p>Only the winning campaign id and second-price clearing value get published on-chain.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="mechanics" className="section">
        <div className="container">
          <span className="badge violet">Core Mechanics</span>
          <h2 className="section-title">Built for sealed auctions, not just sealed storage.</h2>
          <div className="mechanics-grid">
            <div className="feature-card">
              <WalletCards />
              <h3>Native ETH Escrow</h3>
              <p>Campaigns are funded directly with ETH and pay users from the winning campaign&apos;s balance.</p>
            </div>
            <div className="feature-card">
              <Lock />
              <h3>FHE Attention Gate</h3>
              <p>View time is encrypted, compared against five seconds, and only a pass/fail boolean is revealed.</p>
            </div>
            <div className="feature-card">
              <ShieldCheck />
              <h3>Publish-Verified Reveal</h3>
              <p>Decrypt results are submitted back with threshold signatures before contract state changes.</p>
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: 20 }}>
            <StatChip value="euint128" label="effective bid guard" tone="violet" />
            <StatChip value="5" label="interest categories" tone="teal" />
            <StatChip value="5s" label="attention threshold" tone="ink" />
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container toolbar" style={{ justifyContent: "space-between" }}>
          <strong>VEILADS</strong>
          <span className="card-meta">Sealed bids. Sealed profiles. One verified reveal.</span>
        </div>
      </footer>
    </main>
  );
}
