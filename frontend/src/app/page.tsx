import { ArrowRight, CircleDollarSign, Lock, ShieldCheck, Unlock, WalletCards } from "lucide-react";
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
          <div className="hero-copy-stack">
            <div className="eyebrow-row">
              <span className="badge violet">Your attention is already being sold.</span>
            </div>
            <h1 className="hero-title">
              YOU JUST NEVER
              <br />
              <span className="sticker">SAW A CENT.</span>
            </h1>
            <p className="hero-copy">
              Something profiles you every time you browse — sells that shadow version of you to advertisers. You
              never agreed. You never got paid. The ads are still garbage half the time.
            </p>
            <p className="hero-copy hero-copy-secondary">
              VeilAds flips it. Your profile stays encrypted — from us, from advertisers, from the chain itself.
              Get matched, get paid.
            </p>
            <div className="hero-actions">
              <Link className="button primary" href="/app">
                Get Paid to Browse <ArrowRight size={16} />
              </Link>
              <Link className="button" href="/advertiser">
                I&apos;m an Advertiser
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
            <div className="cipher-noise" />
            <div className="sealed-row">
              <div className="mini-card">
                <div>
                  <strong>Sealed Bid</strong>
                  <span>targeting + max payout encrypted</span>
                </div>
                <LockBadge />
              </div>
              <div className="mini-card">
                <div>
                  <strong>Blind Match</strong>
                  <span>ciphertext relevance auction</span>
                </div>
                <span className="badge teal">Verified</span>
              </div>
              <div className="mini-card payout-card">
                <div>
                  <strong>You Get Paid</strong>
                  <span>escrow releases after attention proof</span>
                </div>
                <span className="gold-number">+0.001 ETH</span>
              </div>
            </div>
            <div className="tech-strip">
              <span>FHE.SEALED</span>
              <span>COFHE.LIVE</span>
              <span>ETH.SEPOLIA</span>
            </div>
          </div>
        </div>
      </section>

      <section className="stat-bar" aria-label="Protocol facts">
        <div className="container stat-grid">
          <div className="stat-cell">
            <strong style={{ color: "var(--cipher-violet)" }}>0</strong>
            <span>RAW INTEREST VALUES REVEALED</span>
          </div>
          <div className="stat-cell">
            <strong style={{ color: "var(--ledger-teal)" }}>2</strong>
            <span>VERIFIED REVEALS PER MATCH</span>
          </div>
          <div className="stat-cell">
            <strong>Blind</strong>
            <span>ADVERTISERS BID WITHOUT SEEING YOU</span>
          </div>
          <div className="stat-cell">
            <strong style={{ color: "var(--payout-gold)" }}>ETH</strong>
            <span>PAID FROM NATIVE ESCROW</span>
          </div>
        </div>
      </section>

      <section id="auction-flow" className="section dark">
        <div className="container">
          <span className="badge teal">Auction Flow</span>
          <h2 className="section-title">Sealed bid. Blind match. Paid viewer.</h2>
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
              <CircleDollarSign size={28} />
              <h3>Paid Attention</h3>
              <p>Only the winning campaign, clearing price, and attention pass/fail become verified facts.</p>
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
          <span className="card-meta">Sealed bids. Sealed profiles. Paid attention.</span>
        </div>
      </footer>
    </main>
  );
}
