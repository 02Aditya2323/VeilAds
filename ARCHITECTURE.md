# VeilAds — Architecture Specification

Confidential Attention Marketplace on Fhenix. This document is the implementation
spec. It assumes the reader (Claude Code or a human) has no prior context beyond
this file. UI/visual design is explicitly out of scope here — this covers contracts,
data flow, and integration only.

---

## 1. What this system does, one paragraph

Advertisers fund campaigns with native ETH escrow and set an encrypted targeting
vector + encrypted max bid. Users submit an encrypted interest profile. A smart
contract runs a relevance-weighted second-price auction entirely on ciphertext
(via Fhenix CoFHE), reveals only the winning campaign and clearing price, then
pays the user in ETH from the winning campaign's escrow, optionally gated behind
an encrypted attention-verification step. No party ever sees another party's raw
numbers — not the user's interests, not any advertiser's targeting or bid.

---

## 2. Non-goals (explicitly do not build these)

- No custom ERC20 token — native ETH only, everywhere (escrow, clearing price, payout)
- No real browser-history scraping / no real local LLM integration — profile input
  is a plain array of 5 uint8 values (0-100), sourced from a UI control, not from
  actual behavioral tracking
- No Data Coalitions feature (encrypted aggregate stats across users) — roadmap only
- No DAO governance / voting — roadmap only
- No multi-contract split — see §3.1 for why
- No polish beyond three screens (matching screen, advertiser dashboard, wallet
  header) — and even those are out of scope for this document specifically

---

## 3. System architecture

Three layers:

**Client layer**: Next.js frontend, `cofhejs` (or `@cofhe/sdk` — check which the
currently-cloned `cofhe-hardhat-starter` template ships with; the SDK generation
is in flux, do not assume method names from memory, check the installed package)
for client-side encryption and decrypt requests, wagmi/viem for wallet + tx submission.

**Chain layer**: Arbitrum Sepolia. One contract, `VeilAds.sol`. Holds all campaign
state, runs auction logic, holds ETH escrow, executes payouts.

**Coprocessor layer**: Fhenix CoFHE. Executes every FHE.* operation the contract
calls (add, mul, gte, select, etc.), off-chain, asynchronously. Handles decryption
requests via its Threshold Network.

### 3.1 Why one contract, not several

Fhenix's `FHE.allow` permission system grants decrypt/compute rights per contract
address. Splitting into CampaignRegistry / AuctionEngine / Payout contracts would
require explicit cross-contract `FHE.allow` calls for every ciphertext handle that
crosses a contract boundary — a common source of "why can't this contract read a
value the other one computed" bugs. Single contract, internally organized into
clearly commented sections: Campaign Management / Auction / Reveal / Attention
Gate / Payout.

### 3.2 Storage vs calldata (gas model)

The contract NEVER stores raw ciphertext. It only ever stores fixed-size ciphertext
**handles** (`euintN` / `ebool` types, which resolve to `bytes32` on-chain — same
storage cost as a `uint256`). The actual sealed data lives off-chain in CoFHE's
Ciphertext Registry.

When a user or advertiser submits an encrypted value, the payload (ciphertext +
ZK proof of correct encryption, shaped as `InEuint8`/`InEuint32`/etc.) arrives as
**calldata** (a function argument) — billed at the standard calldata rate, not
storage rate. The contract calls `FHE.asEuintN(payload)`, which registers the
ciphertext with CoFHE's verifier and returns a handle. Only that handle gets
`SSTORE`'d. This is why storing "encrypted campaign data" does not blow up gas
the way storing raw ciphertext bytes would.

### 3.3 Integer width / overflow handling

`euint8` — category weights (0-100), profile values (0-100)
`euint32` — relevance scores (max ~50,000 for 5 categories × 100×100), safe
`euint64` — REQUIRED for effective bid computation. Relevance (up to ~50,000)
multiplied by a bid expressed in wei will overflow `euint32` (max ~4.29 billion)
almost immediately. Cast both operands up before multiplying:

```
euint64 effectiveBid = FHE.mul(FHE.asEuint64(relevance), FHE.asEuint64(bidWei));
```

`euint64` tops out ~1.8×10^19, comfortable for realistic Sepolia testnet bid sizes
(even generously-sized test bids in the 0.001–1 ETH range × max relevance stay
well under this ceiling). Do not multiply directly in `euint32` and hope it fits —
verify the actual max relevance × max expected bid against the euint64 ceiling
during testing, not just assume it's fine.

### 3.4 Async execution and the two decrypt paths

All FHE operations are asynchronous under the hood, but arithmetic ops (add, mul,
gte, select) can be chained inline within a single Solidity function — each call
returns a usable handle immediately, so a whole computation graph can be written
as normal sequential Solidity code within one transaction.

**Decryption is the one step that is explicitly, unavoidably async**, and there
are two distinct paths — do not conflate them:

1. **View decrypt** (`decryptForView` or `cofhejs.unseal`, depending on SDK
   generation in use): frontend asks CoFHE directly, gets plaintext straight to
   the browser. Never touches contract state. Never becomes verifiable on-chain
   fact. Use ONLY for values that no contract logic depends on (not used anywhere
   in this project's core flow — flagged here so it's never accidentally used for
   winner/price/attention-boolean).

2. **Publish decrypt** (`decryptForTx` + a publish/verify call, or the older
   `FHE.decrypt()` + `FHE.getDecryptResultSafe()` polling pattern — check which
   your installed `cofhe-contracts` version exposes): plaintext comes back
   alongside a Threshold Network signature attesting it's genuine. That plaintext
   + signature gets submitted to the contract, which verifies the signature
   on-chain before treating the number as real. **This is mandatory for winner
   ID, clearing price, and the attention-gate boolean**, because the contract
   must act on these values (transfer real ETH) and cannot trust an unverified
   number a client merely claims is correct — a malicious client could submit any
   number it wants without the signature check.

Practical consequence for the frontend: after submitting a transaction that
triggers a reveal, poll a contract read function (or listen for an emitted event)
every few seconds until the verified result has landed in contract state. This is
a genuine multi-second delay, not an implementation detail to hide — surface it
in the UI as a loading/"revealing" state.

---

## 4. Data model

```solidity
struct Campaign {
    address advertiser;
    euint8[5] targeting;    // encrypted, 0-100 per category:
                             // [tech, gaming, fitness, travel, finance]
    euint64 maxBid;          // encrypted, in wei
    uint256 escrow;           // plaintext ETH balance, public by design
                             // (funding buffer, not the bid itself — see notes)
    bool active;
    string adURI;             // plaintext IPFS hash/URI of ad creative — never encrypted
}

struct Match {
    uint256 userId;                 // or address, depending on identity model chosen
    address user;
    uint256 winningCampaignId;      // set once revealed; sentinel value until then
    uint256 clearingPriceWei;       // set once revealed
    bool revealed;
    bool attentionPassed;           // set once attention gate resolves (or immediately
                                     // true if fallback/no-gate mode is active — see §7)
    bool paidOut;
}

Campaign[] public campaigns;
mapping(uint256 => Match) public matches;
uint256 public nextMatchId;
uint256 public constant CATEGORY_COUNT = 5;
uint256 public constant ATTENTION_THRESHOLD_SECONDS = 5; // plaintext, public — fine to be public
```

Notes:
- `escrow` is intentionally plaintext/public. It's a funding buffer, not the bid
  itself — an advertiser's escrow balance does not reveal their targeting or max
  bid. Treat this the same as any public ad-budget line item.
- `adURI` is plaintext. Ad creative is not sensitive; only targeting/bid are sealed.
- Consider whether `Match` should key by wallet address instead of an incrementing
  ID depending on whether a user can have multiple concurrent pending matches —
  default to ID-based unless there's a clear reason not to.

---

## 5. Full functional flow

### 5.1 Campaign creation

```
function createCampaign(
    InEuint8[5] calldata targeting,
    InEuint32 calldata maxBidInput,   // encrypted as euint32 client-side, widened
                                       // to euint64 inside the contract for later math
    string calldata adURI
) external payable
```

- `require(msg.value > 0)` — escrow must be funded on creation
- Convert each `InEuint8` via `FHE.asEuint8()`, store in `targeting[5]`
- Convert bid via `FHE.asEuint32()` then immediately widen: `FHE.asEuint64(...)`,
  store as `euint64 maxBid`
- Grant permissions: `FHE.allowThis(...)` on each stored handle so the contract
  itself can use them again in future transactions (required — without this,
  the contract loses the ability to reference its own stored ciphertexts later)
- Push new `Campaign` to `campaigns[]`, `active = true`
- Emit an event with the new campaign's index (plaintext-safe: index, advertiser
  address, adURI, escrow amount — none of this is sensitive)

Also implement:
```
function topUpEscrow(uint256 campaignId) external payable
function deactivateCampaign(uint256 campaignId) external  // advertiser-only,
                                                             // returns remaining
                                                             // escrow to advertiser
```

### 5.2 Profile submission & auction

```
function matchAd(InEuint8[5] calldata profile) external returns (uint256 matchId)
```

- Convert profile input via `FHE.asEuint8()` × 5
- Create a new `Match` entry, `matchId = nextMatchId++`
- Loop over all `campaigns` where `active == true`:
  - Compute relevance: `euint32 relevance = Σ FHE.mul(FHE.asEuint32(profile[i]), FHE.asEuint32(campaign.targeting[i]))`
    for i in 0..4 (dot product, 5 terms)
  - Widen and compute effective bid: `euint64 effectiveBid = FHE.mul(FHE.asEuint64(relevance), campaign.maxBid)`
  - Track running best and second-best `effectiveBid`, using `FHE.gte` +
    `FHE.select` to update encrypted "current winner index / current best /
    current second-best" state as you iterate (all in ciphertext — no plaintext
    comparison at any point in this loop)
- After the loop: winner handle and clearing-price handle (the second-best
  effective bid — this is the second-price auction rule) are both ciphertext.
  Request a **publish decrypt** on both (see §3.4). Do NOT decrypt anything else
  computed in this function — relevance scores and losing effective bids should
  never have `FHE.allow`/decrypt requested on them at all.
- Store the pending match, return `matchId`. Winner/price fields remain unset
  until the async reveal resolves.
- Frontend polls (or listens for an event on) the reveal completing, then calls
  a read function to get `winningCampaignId` and `clearingPriceWei` once `revealed == true`.

```
function getMatchResult(uint256 matchId) external view returns (
    bool revealed, uint256 winningCampaignId, uint256 clearingPriceWei
)
```

If your `cofhe-contracts` version requires the client to submit the decrypted
value + Threshold Network signature back to the contract (the newer `decryptForTx`
pattern) rather than the contract self-polling via `FHE.getDecryptResultSafe()`,
implement the corresponding submit/verify function instead — check current SDK
docs at build time, don't guess which pattern applies.

### 5.3 Attention gate

See §7 for the full toggle between real FHE mode and fallback plaintext mode.

Real mode:
```
function submitEngagement(uint256 matchId, InEuint32 calldata viewTimeSeconds) external
```
- Convert to `euint32`
- `ebool passed = FHE.gte(engagement, FHE.asEuint32(ATTENTION_THRESHOLD_SECONDS))`
- Request publish decrypt on `passed` only — never on the raw engagement value
- Once revealed, set `matches[matchId].attentionPassed` accordingly

### 5.4 Payout

```
function claimPayout(uint256 matchId) external
```

Preconditions to check, in order, all with clear revert reasons:
- `matches[matchId].revealed == true` (auction result is in)
- `matches[matchId].attentionPassed == true` (gate cleared — or auto-true if
  fallback mode has attention checking disabled entirely, see §7)
- `matches[matchId].paidOut == false` (prevent double payout — critical, see §8)
- `msg.sender == matches[matchId].user` (only the matched user can claim)

Then:
- Look up the winning campaign, `require(campaign.escrow >= clearingPriceWei)`
- Set `paidOut = true` **before** sending ETH (checks-effects-interactions —
  see §8, reentrancy)
- Decrement `campaign.escrow -= clearingPriceWei`
- Send ETH: `(bool ok, ) = payable(msg.sender).call{value: clearingPriceWei}("")`,
  `require(ok)`
- Emit payout event

---

## 6. Permission management (FHE.allow family) — checklist

Every stored ciphertext handle needs explicit permission grants or later
operations on it will fail. For each value the contract stores and expects to
reuse in a later transaction:
- `FHE.allowThis(value)` — lets the contract itself operate on it again later
- `FHE.allowSender(value)` — lets the calling address decrypt/view it if relevant
  (e.g., an advertiser being able to sanity-check their own submitted campaign
  via a view-decrypt, if you choose to expose that — optional, not core flow)

Missing an `allowThis` call on a value you reference in a subsequent transaction
is a common bug — if a later function reverts with what looks like a permissions
error on a handle you're sure you stored correctly, check this first.

---

## 7. Attention gate: build mode vs fallback mode

Two implementations, controlled by a single constant/flag so switching is a
one-line change, not a rewrite, if time runs out:

**`ATTENTION_MODE = "FHE"` (preferred, build this first):**
As specified in §5.3 — engagement encrypted client-side, compared in ciphertext
against a plain threshold, only the boolean revealed via publish-decrypt.

**`ATTENTION_MODE = "PLAINTEXT"` (fallback only, if FHE version is fighting the clock):**
```
function submitEngagementPlaintext(uint256 matchId, uint256 viewTimeSeconds) external {
    matches[matchId].attentionPassed = viewTimeSeconds >= ATTENTION_THRESHOLD_SECONDS;
}
```
No encryption, no CoFHE round trip, ordinary Solidity. Functionally equivalent
gate behavior, zero privacy on the view-time number itself (it becomes a
permanent public on-chain fact, tied to that user's wallet).

**If fallback mode is used, this is a hard requirement, not optional cleanup:**
the pitch deck's privacy table currently states `User engagement / view time —
Ciphertext — Never [revealed]`. That row must be edited to say `Plaintext` /
`Yes — public` before submission if fallback mode ships. Do not submit a deck
that overclaims what the code actually does — a judge cross-referencing deck
against repo is a realistic risk, and the mismatch reads worse than never having
attempted the feature.

Also acceptable as a third option under real time pressure: skip the attention
gate function entirely, `claimPayout` checks `revealed == true` only, no
engagement check of any kind. If this is the fallback used, remove the
attention-gate row from the deck's flow diagram and privacy table entirely
rather than describing a feature that doesn't exist in the build.

---

## 8. Edge cases and safeguards to implement

- **Double payout / reentrancy**: `paidOut` flag set before the external ETH
  call, not after (checks-effects-interactions pattern). Do not rely solely on
  a reentrancy-guard modifier as the only protection — order of operations matters
  regardless.
- **Insufficient escrow**: if a campaign's remaining escrow is less than the
  clearing price by the time payout is claimed (e.g., it already won and paid
  out other matches in between), `claimPayout` must revert cleanly, not
  underflow or send a partial amount silently.
- **No active campaigns at match time**: `matchAd` should handle an empty or
  fully-inactive campaign list gracefully (revert with a clear reason, don't
  let the loop silently produce a garbage winner).
- **Campaign deactivated mid-flight**: if a campaign is deactivated between a
  user matching against it and claiming payout, decide and document the
  behavior (recommend: match result stands, campaign just stops competing for
  *future* matches — don't retroactively invalidate an already-decided match).
- **Ties in effective bid**: decide a deterministic tie-break (e.g., lower
  campaign index wins) so `FHE.select` logic in the auction loop has
  well-defined behavior rather than undefined/inconsistent results on exact ties.
- **Unrevealed match claimed early**: `claimPayout` and `submitEngagement` must
  both check `revealed == true` first and revert clearly if the async reveal
  hasn't landed yet — this will happen in normal operation given the async
  delay, not just as an attack case, so the revert reason should be a normal,
  expected, clearly-worded state (e.g. "match not yet revealed, try again
  shortly") rather than a generic error.
- **Decrypt request never resolves / times out**: decide a reasonable UX
  fallback for the frontend polling loop (e.g., stop polling after N attempts,
  surface a retry option) — not strictly a contract-level concern but should be
  handled somewhere, don't let the frontend poll forever silently.

---

## 9. Repo structure

```
veilads/
  contracts/
    VeilAds.sol
    test/
      VeilAds.t.sol           (mock-FHE environment tests — write these first,
                                 before ever touching Arbitrum Sepolia)
  frontend/
    lib/
      cofhe.ts                 encrypt/decrypt helper wrappers
      contract.ts               wagmi contract config + ABI
    (page-level structure intentionally not specified here — see separate
     UI-focused planning, out of scope for this document)
  hardhat.config.ts             cofhe-hardhat-plugin configured
  README.md                     privacy table + architecture summary — this is
                                 what judges read first, keep it accurate against
                                 whatever actually shipped, especially the
                                 attention-gate mode (see §7)
```

---

## 10. Build and test strategy

1. Start entirely in the **mock environment** (`cofhe-hardhat-starter` +
   `cofhe-mock-contracts`) — mocks store plaintext under the hood but preserve
   the same handle-based API shape, so contract logic written against mocks
   should port to testnet with minimal changes. Do not attempt testnet first.
2. Write tests for: campaign creation + escrow accounting, the auction loop
   with 2-3 mock campaigns and a known expected winner (verify with
   `assertHashValue`/`expectPlaintext` style mock assertions), the reveal flow,
   the attention gate in whichever mode is active, payout math including the
   insufficient-escrow and double-claim edge cases from §8.
3. Only after mock tests pass, deploy to Arbitrum Sepolia and re-verify the
   same test scenarios manually against the real CoFHE network, specifically
   re-checking the async reveal timing (mocks simulate a random 1-10 second
   delay by design — real network timing will differ, confirm the frontend
   polling interval/timeout is still reasonable against real observed latency).

---

## 11. Deployment target

Arbitrum Sepolia. Confirm `@fhenixprotocol/cofhe-contracts` and the chosen SDK
package are both configured for this network specifically before deploying —
do not assume default hardhat network config is correct without checking.
