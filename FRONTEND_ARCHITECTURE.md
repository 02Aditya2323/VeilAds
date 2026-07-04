# VeilAds — Frontend Architecture Specification

Companion to `ARCHITECTURE.md` (contract + CoFHE integration spec). This document
covers the frontend only: visual design system, page structure, component
architecture, and how UI actions map to the contract calls defined in the other
document. Read `ARCHITECTURE.md` first — this assumes that contract spec as given.

---

## 1. The app has two distinct areas

1. **Landing page** (`/`) — descriptive, marketing-oriented, explains the product
   and the FHE mechanism to someone who's never seen it. Neo-brutalist visual style.
2. **App** — the actual functional product: matching screen, advertiser dashboard,
   wallet connection. Same visual language as the landing page, carried through,
   not a separate design system.

Do not build more than these two areas. No blog, no docs subsite, no settings page.

---

## 2. Visual design system (neo-brutalism)

Reference aesthetic: thick solid borders, hard offset drop shadows (no blur),
high-contrast flat colors, bold display type, monospace for tags/labels,
sticker-like highlight blocks, alternating light/dark page sections.

### Colors
Carry forward the existing privacy motif from the deck, reframed for brutalism:
- `--ink: #111111` — primary text, all borders
- `--paper: #F5F1E3` — main background (cream, subtle grid-paper texture:
  1px lines every 28px at ~7% black opacity, both axes)
- `--surface: #FFFFFF` — card/stat-bar backgrounds on light sections
- `--dark: #0B0E23` — dark section background (architecture flow section only)
- `--dark-card: #141A3D` — cards on dark background
- `--violet: #7C6FF0` / `--violet-deep: #5B4CD6` — SEALED / PRIVATE, used for
  anything encrypted, never-revealed
- `--teal: #2DD4BF` / `--teal-deep: #0F9E8E` — REVEALED / PUBLIC, used for
  anything decrypted or intentionally public
This color-coding must stay consistent everywhere it appears — a user should be
able to learn "violet = sealed, teal = revealed" once and have it hold across
the whole app, landing page included.

### Borders & shadows
- All cards, buttons, badges: `2px–3px solid var(--ink)` border, minimal or zero
  corner radius (0–4px)
- Shadow style: hard offset, no blur — `box-shadow: Npx Npx 0 <color>`, where
  the shadow color is often an accent (violet/teal) rather than plain black, to
  tie interactive elements back to the sealed/revealed color language
- Hover states on interactive elements: shift position slightly toward the
  shadow (e.g. `transform: translate(2px, 2px)` + shadow reduced to 0) —
  standard neo-brutalist "press" feedback

### Typography
- Display/headline: bold system sans, heavy weight (800), large sizes (44–60px
  for hero), tight line-height
- Body: regular weight, comfortable line-height (1.5+), same sans family
- Tags/badges/code/technical labels: monospace, uppercase, small size (11–12px),
  letter-spacing ~0.3–0.5px

### Motif element
Padlock iconography (locked/unlocked) is the recurring visual signature,
already established in the deck and demo mockup — reuse it on the landing page
wherever the sealed→revealed idea is being illustrated, not just in the app.

---

## 3. Landing page — full section spec

### 3.1 Nav
Logo mark (small square, violet fill, bordered, "V") + "VEILADS" wordmark, left.
Right: text links `AUCTION FLOW`, `MECHANICS`, `DEMO` (anchor-scroll to
corresponding sections below), plus a solid CTA button `Launch App` (bordered,
hard violet shadow) linking to the app.

### 3.2 Hero
- Small pill badges row: `FHE.SEALED` (violet border), `COFHE.LIVE` (teal
  border), `ETH.SEPOLIA` (black border) — monospace, all-caps
- Headline, two lines:
  - Line 1, plain bold: **"EVERYTHING'S SEALED."**
  - Line 2, inside a rotated sticker block (teal fill, black border, hard
    shadow): **"UNTIL ONE ISN'T."**
- Subcopy paragraph, left border accent (violet), max-width ~640px:
  > VeilAds runs advertiser bids and your interest profile entirely through
  > Fully Homomorphic Encryption on Fhenix. Every number stays ciphertext, in
  > and out, until the auction resolves. Only the winning match and its price
  > are ever revealed — you get paid for attention that's genuinely yours.
- Two CTAs: `Launch Demo` (solid black, violet hard shadow) → app;
  `View Contract ↗` (outline) → Etherscan Sepolia link for the deployed
  contract (add the real address once deployed, don't ship a dead link)

### 3.3 Stat bar
Four-column strip, white background, divided by vertical borders:
1. `0` (violet) — RAW VALUES EVER REVEALED
2. `2` (teal) — NUMBERS DECRYPTED PER MATCH
3. `1` (ink) — CONTRACT, NO CROSS-PERMISSION RISK
4. `100%` (teal) — NATIVE ETH, NO CUSTOM TOKEN

Each number must correspond to an actually-true fact about the shipped contract
— if the attention gate ends up in fallback/plaintext mode (see
`ARCHITECTURE.md` §7), re-check stat #1 still holds (it does — profile and bid
values are still never revealed either way; only re-verify if that changes).

### 3.4 Auction flow section (dark background, `--dark`)
Tag: `[AUCTION FLOW]`. Heading: **"Watch a sealed bid become a public price."**
Intro line: "Three campaigns come in locked. The auction runs entirely on
ciphertext. Only one number ever gets shown a price."

Below: adapt the sealed-inputs → FHE-computation → revealed-output diagram
already designed for the pitch deck (three-column layout: locked campaign
cards left, computation steps center in a dark inset panel, unlocked
winner/price right) into an interactive component:
- Cards are hoverable/draggable (matches the reference site's "draggable view"
  affordance) but functionally static — this is an explainer, not a live demo
- Use the same violet-lock / teal-unlock iconography as the rest of the app

### 3.5 Core mechanics section (light background)
Tag: `[CORE MECHANICS]`. Heading: **"Built for sealed auctions, not just sealed storage."**
Filter tabs: `ALL`, `AUCTION`, `PRIVACY`, `PAYOUT` (client-side filter, no
routing needed). Feature cards, each with a short label + one-line description
— keep every card tied to something real in the contract, not generic claims:

**AUCTION**
- Second-Price Clearing — winner pays roughly the runner-up's effective bid, not their own max
- Relevance-Weighted Matching — a 5-category encrypted dot product decides fit, not just budget

**PRIVACY**
- euint64 Overflow Guard — bids are widened before multiplying so relevance × bid never wraps
- Publish-Verified Reveal — every decrypted value is signature-checked on-chain, never trusted blind

**PAYOUT**
- Native ETH Escrow — no custom token, funds sit in the campaign until it wins a match
- Attention-Gated Release — funds move only after encrypted engagement clears a threshold (or the plaintext fallback — reflect whichever mode actually shipped, see `ARCHITECTURE.md` §7)

### 3.6 Footer
Minimal: wordmark, link to GitHub repo, link to deployed contract on Etherscan
Sepolia, one line restating the core claim ("Sealed bids. Sealed profiles. One
verified reveal.").

---

## 4. App architecture (functional product)

Same visual language as the landing page (borders, shadows, color motif),
applied to functional UI instead of marketing copy.

### 4.1 Screens
1. **Matching screen** (`/app`) — profile input (5 sliders) + campaign grid
   (locked/unlocked cards) + submit action. This is the screen already
   prototyped in the interactive mockup — build against that behavior, but
   wire the "submit" action to the real contract flow instead of the mock
   client-side dot-product math used in the prototype.
2. **Advertiser dashboard** (`/advertiser`) — campaign creation form (5
   targeting sliders + bid input + ETH funding amount + IPFS ad URI field) and
   a list of the connected wallet's own campaigns (showing remaining escrow
   and active/inactive status only — never surface their own targeting/bid
   back to them, even though technically the advertiser's own permit could
   decrypt it, don't build that view, it undermines the product's own story)
3. **Wallet header** (shared across both screens) — connect button, address,
   Sepolia ETH balance, network indicator (must show "Ethereum Sepolia"
   explicitly and warn/block if the connected wallet is on a different network)

### 4.2 Component breakdown

```
components/
  layout/
    WalletHeader.tsx
    NetworkGuard.tsx        — blocks interaction if wallet isn't on Ethereum Sepolia
  matching/
    ProfileSliderPanel.tsx  — 5 category sliders, controlled state
    CampaignCard.tsx        — locked / revealed-winner / revealed-loser states
    SubmitProfileButton.tsx — triggers encrypt + matchAd() tx
    RevealStatus.tsx        — polling UI ("Revealing…" state, see 4.3)
  advertiser/
    CampaignForm.tsx        — targeting sliders + bid + ETH amount + IPFS URI
    CampaignList.tsx        — advertiser's own campaigns, escrow + status only
  shared/
    LockBadge.tsx           — the violet-lock / teal-unlock icon, reused everywhere
    StatChip.tsx            — small bordered stat display, reused from landing page
lib/
  cofhe.ts                  — encrypt() / requestReveal() / pollReveal() wrappers
  contract.ts                — wagmi contract config, ABI, address (env-based per network)
  network.ts                — Ethereum Sepolia chain config + guard helper
hooks/
  useMatchReveal.ts          — polling hook, see 4.3
  useCampaigns.ts             — reads active campaigns for the matching screen grid
```

### 4.3 The async reveal, as a hook

This is the single most important piece of frontend logic, since it's the part
that's easy to get wrong if treated as a normal synchronous call. Per
`ARCHITECTURE.md` §3.4, decryption is asynchronous — encapsulate the
wait-and-check pattern once, in one hook, rather than re-implementing polling
logic in multiple components:

```
useMatchReveal(matchId):
  - starts polling getMatchResult(matchId) on an interval (start ~2s,
    consider backoff if it runs long)
  - returns { status: "pending" | "revealed" | "timeout", winningCampaignId, clearingPriceWei }
  - stops polling once revealed === true, or after a reasonable max attempts,
    surfacing "timeout" so the UI can offer a manual retry rather than
    spinning forever silently (per ARCHITECTURE.md §8 edge case)
```

`CampaignCard` and `RevealStatus` both consume this hook's state — cards stay
in their locked visual state while status is `"pending"`, the winning card
flips to its unlocked/revealed state the instant status becomes `"revealed"`.
This is also the natural place to trigger the visual "padlock opens" animation.

### 4.4 UI action → contract call map

| UI action | Contract function | Sync or async |
|---|---|---|
| Advertiser submits campaign form | `createCampaign()` | Sync — confirms in one tx, no reveal needed |
| Advertiser tops up escrow | `topUpEscrow()` | Sync |
| User submits profile sliders | `matchAd()` | Sync tx, but result requires the async reveal (§4.3) afterward |
| Frontend checks for match result | `getMatchResult()` (read, polled) | Async — this is what `useMatchReveal` wraps |
| User submits engagement / attention check | `submitEngagement()` (or plaintext fallback variant) | Sync tx, but boolean result also needs the async reveal pattern |
| User claims payout | `claimPayout()` | Sync — reverts cleanly if reveal/attention not yet resolved, surface that revert reason as a normal expected state, not an error |

### 4.5 Attention gate mode switch, frontend side

`ARCHITECTURE.md` §7 defines a contract-level toggle between real FHE mode and
a plaintext fallback for the attention gate. The frontend should read which
mode is active (a simple config flag, doesn't need to be dynamic/on-chain) and
branch accordingly:
- FHE mode: engagement time gets encrypted client-side before submission
- Plaintext mode: engagement time submitted as a plain number, no `cofhejs`
  involved for this one call

Whichever mode is active, update the landing page's Core Mechanics section
(§3.5) and stat bar (§3.3) to match — do not describe a capability the shipped
build doesn't have.

---

## 5. Non-goals, frontend

- No mobile-specific layout pass — desktop-first is fine for a hackathon demo
- No dark/light mode toggle — the dark section on the landing page is fixed,
  not a theme setting
- No real wallet-agnostic multi-chain support — Ethereum Sepolia only, hard-coded
- No user accounts/auth beyond wallet connection
- No admin panel for managing campaigns beyond what the advertiser dashboard covers
