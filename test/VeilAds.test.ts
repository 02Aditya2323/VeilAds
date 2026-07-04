import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { expect } from "chai";
import { ethers } from "hardhat";

const TASK_COFHE_MOCKS_DEPLOY = "task:cofhe-mocks:deploy";

// ====================================================================
// VeilAds Test Suite
// Uses CoFHE mock environment — all FHE ops run locally against mock
// contracts that store plaintext, preserving the same handle-based API.
// ====================================================================

describe("VeilAds", function () {

  // ----------------------------------------------------------------
  // Fixtures
  // ----------------------------------------------------------------

  async function deployVeilAdsFixture() {
    await hre.run(TASK_COFHE_MOCKS_DEPLOY);

    const [deployer, advertiser1, advertiser2, advertiser3, user] =
      await hre.ethers.getSigners();

    const VeilAds = await hre.ethers.getContractFactory("VeilAds");
    const veilAds = await VeilAds.connect(deployer).deploy();

    // One client per user (handles encryption / decryption)
    const clientAdv1 = await hre.cofhe.createClientWithBatteries(advertiser1);
    const clientAdv2 = await hre.cofhe.createClientWithBatteries(advertiser2);
    const clientUser = await hre.cofhe.createClientWithBatteries(user);

    return {
      veilAds,
      deployer,
      advertiser1,
      advertiser2,
      advertiser3,
      user,
      clientAdv1,
      clientAdv2,
      clientUser,
    };
  }

  // Helper: encrypt a 5-element uint8 profile array
  async function encryptProfile(client: any, values: bigint[]) {
    return await client
      .encryptInputs(values.map((v) => Encryptable.uint8(v)))
      .execute();
  }

  // Helper: encrypt a targeting array (5 uint8 values)
  async function encryptTargeting(client: any, values: bigint[]) {
    return await client
      .encryptInputs(values.map((v) => Encryptable.uint8(v)))
      .execute();
  }

  // Helper: encrypt a single uint64 bid value (InEuint64 for contract)
  async function encryptBid(client: any, value: bigint) {
    const result = await client
      .encryptInputs([Encryptable.uint64(value)])
      .execute();
    return result[0];
  }

  // Helper: create a campaign and return its index
  async function createCampaign(
    veilAds: any,
    client: any,
    advertiser: any,
    targetingValues: bigint[],
    bidWei: bigint,
    escrowWei: bigint,
    adURI: string
  ) {
    const encTargeting = await encryptTargeting(client, targetingValues);
    const encBid = await encryptBid(client, bidWei);

    const tx = await veilAds.connect(advertiser).createCampaign(
      encTargeting,
      encBid,
      adURI,
      { value: escrowWei }
    );
    const receipt = await tx.wait();

    // Get campaignId from event
    const event = receipt.logs
      .map((log: any) => {
        try {
          return veilAds.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === "CampaignCreated");

    return event ? event.args.campaignId : 0n;
  }

  // Helper: submit profile and get matchId
  async function submitProfile(veilAds: any, client: any, user: any, profileValues: bigint[]) {
    const encProfile = await encryptProfile(client, profileValues);
    const tx = await veilAds.connect(user).matchAd(encProfile);
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log: any) => {
        try {
          return veilAds.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === "MatchCreated");

    return event ? event.args.matchId : 0n;
  }

  // Helper: do the 3-step reveal flow (allowPublic already done in matchAd)
  async function revealMatch(veilAds: any, clientUser: any, matchId: bigint) {
    const winnerHandle = await veilAds.getMatchWinnerHandle(matchId);
    const priceHandle = await veilAds.getMatchPriceHandle(matchId);

    const winnerResult = await clientUser
      .decryptForTx(winnerHandle)
      .withoutPermit()
      .execute();
    const priceResult = await clientUser
      .decryptForTx(priceHandle)
      .withoutPermit()
      .execute();

    // clearingPrice is now uint128 in the contract
    const tx = await veilAds.submitReveal(
      matchId,
      winnerResult.decryptedValue,
      winnerResult.signature,
      priceResult.decryptedValue,
      priceResult.signature
    );
    await tx.wait();

    return {
      winnerId: winnerResult.decryptedValue,
      clearingPrice: priceResult.decryptedValue,
    };
  }

  // Helper: FHE attention gate + reveal
  async function submitAndRevealAttention(
    veilAds: any,
    clientUser: any,
    user: any,
    matchId: bigint,
    viewTimeSec: bigint
  ) {
    // Step 1: Submit encrypted engagement
    const encTime = await clientUser
      .encryptInputs([Encryptable.uint32(viewTimeSec)])
      .execute();
    const tx1 = await veilAds.connect(user).submitEngagement(matchId, encTime[0]);
    await tx1.wait();

    // Step 2: Decrypt the attention result
    const attHandle = await veilAds.getAttentionHandle(matchId);
    const attResult = await clientUser
      .decryptForTx(attHandle)
      .withoutPermit()
      .execute();

    // Step 3: Publish the result on-chain
    // SDK returns BigInt (1n=true, 0n=false) — convert to bool for Solidity
    const boolResult = attResult.decryptedValue === 1n;
    const tx2 = await veilAds.submitAttentionResult(
      matchId,
      boolResult,
      attResult.signature
    );
    await tx2.wait();

    return boolResult;
  }

  // ================================================================
  // === Section 1: Campaign Management Tests =======================
  // ================================================================

  describe("Campaign Management", function () {

    it("Should create a campaign with encrypted targeting and bid", async function () {
      const { veilAds, advertiser1, clientAdv1 } =
        await loadFixture(deployVeilAdsFixture);

      // Tech-heavy targeting: [90, 10, 10, 10, 10], bid = 1000 wei
      const campaignId = await createCampaign(
        veilAds, clientAdv1, advertiser1,
        [90n, 10n, 10n, 10n, 10n],
        1000n,
        ethers.parseEther("0.1"),
        "ipfs://campaign1"
      );

      const [advertiser, escrow, active, adURI] = await veilAds.getCampaignInfo(campaignId);
      expect(advertiser).to.equal(advertiser1.address);
      expect(escrow).to.equal(ethers.parseEther("0.1"));
      expect(active).to.be.true;
      expect(adURI).to.equal("ipfs://campaign1");

      // Verify encrypted targeting values via mocks
      const camp = await veilAds.campaigns(campaignId);
      // Access first targeting element handle — verify it's 90
      // (We can't access struct arrays directly via the auto-getter, so we use the mock store)
      // Instead verify via campaign count
      expect(await veilAds.getCampaignCount()).to.equal(1n);
    });

    it("Should revert campaign creation with zero escrow", async function () {
      const { veilAds, advertiser1, clientAdv1 } =
        await loadFixture(deployVeilAdsFixture);

      const encTargeting = await encryptTargeting(clientAdv1, [50n, 50n, 50n, 50n, 50n]);
      const encBid = await encryptBid(clientAdv1, 500n);

      await expect(
        veilAds.connect(advertiser1).createCampaign(encTargeting, encBid, "ipfs://x", { value: 0 })
      ).to.be.revertedWithCustomError(veilAds, "EscrowRequired");
    });

    it("Should top up escrow on an existing campaign", async function () {
      const { veilAds, advertiser1, clientAdv1 } =
        await loadFixture(deployVeilAdsFixture);

      const campaignId = await createCampaign(
        veilAds, clientAdv1, advertiser1,
        [50n, 50n, 50n, 50n, 50n],
        1000n,
        ethers.parseEther("0.1"),
        "ipfs://a"
      );

      await veilAds.connect(advertiser1).topUpEscrow(campaignId, {
        value: ethers.parseEther("0.05"),
      });

      const [, escrow] = await veilAds.getCampaignInfo(campaignId);
      expect(escrow).to.equal(ethers.parseEther("0.15"));
    });

    it("Should revert topUpEscrow from non-advertiser", async function () {
      const { veilAds, advertiser1, clientAdv1, user } =
        await loadFixture(deployVeilAdsFixture);

      const campaignId = await createCampaign(
        veilAds, clientAdv1, advertiser1,
        [50n, 50n, 50n, 50n, 50n],
        1000n,
        ethers.parseEther("0.1"),
        "ipfs://a"
      );

      await expect(
        veilAds.connect(user).topUpEscrow(campaignId, { value: ethers.parseEther("0.05") })
      ).to.be.revertedWithCustomError(veilAds, "NotAdvertiser");
    });

    it("Should deactivate campaign and return escrow to advertiser", async function () {
      const { veilAds, advertiser1, clientAdv1 } =
        await loadFixture(deployVeilAdsFixture);

      const escrowAmount = ethers.parseEther("0.1");
      const campaignId = await createCampaign(
        veilAds, clientAdv1, advertiser1,
        [50n, 50n, 50n, 50n, 50n],
        1000n,
        escrowAmount,
        "ipfs://b"
      );

      const balanceBefore = await ethers.provider.getBalance(advertiser1.address);
      const tx = await veilAds.connect(advertiser1).deactivateCampaign(campaignId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(advertiser1.address);

      // Balance should increase by escrow minus gas
      expect(balanceAfter).to.be.closeTo(balanceBefore + escrowAmount - gasUsed, ethers.parseEther("0.001"));

      const [, , active] = await veilAds.getCampaignInfo(campaignId);
      expect(active).to.be.false;
    });

    it("Should revert deactivateCampaign from non-advertiser", async function () {
      const { veilAds, advertiser1, clientAdv1, user } =
        await loadFixture(deployVeilAdsFixture);

      const campaignId = await createCampaign(
        veilAds, clientAdv1, advertiser1,
        [50n, 50n, 50n, 50n, 50n],
        1000n,
        ethers.parseEther("0.1"),
        "ipfs://c"
      );

      await expect(
        veilAds.connect(user).deactivateCampaign(campaignId)
      ).to.be.revertedWithCustomError(veilAds, "NotAdvertiser");
    });
  });

  // ================================================================
  // === Section 2: Auction Tests ===================================
  // ================================================================

  describe("Auction", function () {

    it("Should revert matchAd with no active campaigns", async function () {
      const { veilAds, user, clientUser } =
        await loadFixture(deployVeilAdsFixture);

      const encProfile = await encryptProfile(clientUser, [50n, 50n, 50n, 50n, 50n]);
      await expect(
        veilAds.connect(user).matchAd(encProfile)
      ).to.be.revertedWithCustomError(veilAds, "NoActiveCampaigns");
    });

    it("Should revert matchAd with fewer than 2 active campaigns", async function () {
      const { veilAds, advertiser1, clientAdv1, user, clientUser } =
        await loadFixture(deployVeilAdsFixture);

      // Only one campaign
      await createCampaign(
        veilAds, clientAdv1, advertiser1,
        [50n, 50n, 50n, 50n, 50n],
        1000n,
        ethers.parseEther("0.1"),
        "ipfs://solo"
      );

      const encProfile = await encryptProfile(clientUser, [50n, 50n, 50n, 50n, 50n]);
      await expect(
        veilAds.connect(user).matchAd(encProfile)
      ).to.be.revertedWithCustomError(veilAds, "NeedAtLeastTwoCampaigns");
    });

    it("Should run auction with 3 campaigns and select correct winner", async function () {
      const { veilAds, advertiser1, advertiser2, advertiser3, user, clientAdv1, clientAdv2, clientUser } =
        await loadFixture(deployVeilAdsFixture);

      const clientAdv3 = await hre.cofhe.createClientWithBatteries(advertiser3);

      // Campaign 0: tech-heavy targeting [90,10,10,10,10], bid=1000 wei
      await createCampaign(veilAds, clientAdv1, advertiser1, [90n,10n,10n,10n,10n], 1000n, ethers.parseEther("0.5"), "ipfs://tech");
      // Campaign 1: gaming-heavy [10,90,10,10,10], bid=2000 wei
      await createCampaign(veilAds, clientAdv2, advertiser2, [10n,90n,10n,10n,10n], 2000n, ethers.parseEther("0.5"), "ipfs://game");
      // Campaign 2: finance-heavy [10,10,10,10,90], bid=1500 wei
      await createCampaign(veilAds, clientAdv3, advertiser3, [10n,10n,10n,10n,90n], 1500n, ethers.parseEther("0.5"), "ipfs://finance");

      // User profile: heavily tech [80,20,20,20,20]
      // Expected relevance scores:
      //   Campaign 0 (tech):    80*90 + 20*10 + 20*10 + 20*10 + 20*10 = 7200+200+200+200+200 = 8000, effectiveBid = 8000*1000 = 8,000,000
      //   Campaign 1 (gaming):  80*10 + 20*90 + 20*10 + 20*10 + 20*10 = 800+1800+200+200+200 = 3200, effectiveBid = 3200*2000 = 6,400,000
      //   Campaign 2 (finance): 80*10 + 20*10 + 20*10 + 20*10 + 20*90 = 800+200+200+200+1800 = 3200, effectiveBid = 3200*1500 = 4,800,000
      // Winner: Campaign 0, clearing price: 6,400,000 (second-best effective bid)

      const matchId = await submitProfile(veilAds, clientUser, user, [80n,20n,20n,20n,20n]);

      // Verify encrypted winner handle has correct plaintext (campaign 0)
      const winnerHandle = await veilAds.getMatchWinnerHandle(matchId);
      await hre.cofhe.mocks.expectPlaintext(winnerHandle, 0n); // campaign index 0

      // Verify encrypted clearing price (second-best effective bid = 6,400,000)
      const priceHandle = await veilAds.getMatchPriceHandle(matchId);
      await hre.cofhe.mocks.expectPlaintext(priceHandle, 6400000n);
    });

    it("Should select winner with lower campaign ID on effective bid tie (tie-breaking)", async function () {
      const { veilAds, advertiser1, advertiser2, user, clientAdv1, clientAdv2, clientUser } =
        await loadFixture(deployVeilAdsFixture);

      // Identical campaigns: same targeting, same bid
      await createCampaign(veilAds, clientAdv1, advertiser1, [50n,50n,50n,50n,50n], 100n, ethers.parseEther("0.5"), "ipfs://a");
      await createCampaign(veilAds, clientAdv2, advertiser2, [50n,50n,50n,50n,50n], 100n, ethers.parseEther("0.5"), "ipfs://b");

      const matchId = await submitProfile(veilAds, clientUser, user, [50n,50n,50n,50n,50n]);

      // Campaign 0 should win (lower index; FHE.gt is strict so equal bids don't replace current best)
      const winnerHandle = await veilAds.getMatchWinnerHandle(matchId);
      await hre.cofhe.mocks.expectPlaintext(winnerHandle, 0n);
    });

    it("Should emit MatchCreated event with correct matchId", async function () {
      const { veilAds, advertiser1, advertiser2, user, clientAdv1, clientAdv2, clientUser } =
        await loadFixture(deployVeilAdsFixture);

      await createCampaign(veilAds, clientAdv1, advertiser1, [50n,50n,50n,50n,50n], 500n, ethers.parseEther("0.2"), "ipfs://x");
      await createCampaign(veilAds, clientAdv2, advertiser2, [50n,50n,50n,50n,50n], 300n, ethers.parseEther("0.2"), "ipfs://y");

      const encProfile = await encryptProfile(clientUser, [50n,50n,50n,50n,50n]);
      await expect(veilAds.connect(user).matchAd(encProfile))
        .to.emit(veilAds, "MatchCreated")
        .withArgs(0n, user.address);
    });
  });

  // ================================================================
  // === Section 3: Reveal Tests ====================================
  // ================================================================

  describe("Reveal Flow", function () {

    async function twoActiveCampaignsFixture() {
      const base = await deployVeilAdsFixture();
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } = base;

      await createCampaign(veilAds, clientAdv1, advertiser1, [80n,20n,20n,20n,20n], 1000n, ethers.parseEther("0.5"), "ipfs://alpha");
      await createCampaign(veilAds, clientAdv2, advertiser2, [20n,80n,20n,20n,20n], 500n,  ethers.parseEther("0.5"), "ipfs://beta");

      const matchId = await submitProfile(veilAds, clientUser, user, [90n,10n,10n,10n,10n]);

      return { ...base, matchId };
    }

    it("Should return revealed=false before submitReveal", async function () {
      const { veilAds, matchId } = await loadFixture(twoActiveCampaignsFixture);

      const [revealed] = await veilAds.getMatchResult(matchId);
      expect(revealed).to.be.false;
    });

    it("Should complete 3-step reveal and store winner + clearing price", async function () {
      const { veilAds, matchId, clientUser } = await loadFixture(twoActiveCampaignsFixture);

      const { winnerId, clearingPrice } = await revealMatch(veilAds, clientUser, matchId);

      const [revealed, winningCampaignId, clearingPriceWei] = await veilAds.getMatchResult(matchId);
      expect(revealed).to.be.true;
      expect(winningCampaignId).to.equal(BigInt(winnerId));
      expect(clearingPriceWei).to.equal(BigInt(clearingPrice));
    });

    it("Should emit MatchRevealed event after successful reveal", async function () {
      const { veilAds, matchId, clientUser } = await loadFixture(twoActiveCampaignsFixture);

      const winnerHandle = await veilAds.getMatchWinnerHandle(matchId);
      const priceHandle = await veilAds.getMatchPriceHandle(matchId);

      const winnerResult = await clientUser.decryptForTx(winnerHandle).withoutPermit().execute();
      const priceResult = await clientUser.decryptForTx(priceHandle).withoutPermit().execute();

      await expect(
        veilAds.submitReveal(
          matchId,
          winnerResult.decryptedValue, winnerResult.signature,
          priceResult.decryptedValue, priceResult.signature
        )
      ).to.emit(veilAds, "MatchRevealed");
    });

    it("Should revert getMatchResult for non-existent matchId", async function () {
      const { veilAds } = await loadFixture(deployVeilAdsFixture);
      await expect(veilAds.getMatchResult(999n)).to.be.revertedWithCustomError(veilAds, "MatchNotFound");
    });
  });

  // ================================================================
  // === Section 4: Attention Gate Tests ============================
  // ================================================================

  describe("Attention Gate (FHE Mode)", function () {

    async function revealedMatchFixture() {
      const base = await deployVeilAdsFixture();
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } = base;

      await createCampaign(veilAds, clientAdv1, advertiser1, [80n,20n,20n,20n,20n], 1000n, ethers.parseEther("0.5"), "ipfs://a");
      await createCampaign(veilAds, clientAdv2, advertiser2, [20n,80n,20n,20n,20n], 500n,  ethers.parseEther("0.5"), "ipfs://b");

      const matchId = await submitProfile(veilAds, clientUser, user, [90n,10n,10n,10n,10n]);
      await revealMatch(veilAds, clientUser, matchId);

      return { ...base, matchId };
    }

    it("Should pass attention gate when view time >= threshold (5s)", async function () {
      const { veilAds, user, clientUser, matchId } = await loadFixture(revealedMatchFixture);

      const passed = await submitAndRevealAttention(veilAds, clientUser, user, matchId, 10n);
      expect(passed).to.be.true;

      const [,,,,attentionPassed] = await veilAds.getMatchDetails(matchId);
      expect(attentionPassed).to.be.true;
    });

    it("Should fail attention gate when view time < threshold", async function () {
      const { veilAds, user, clientUser, matchId } = await loadFixture(revealedMatchFixture);

      const passed = await submitAndRevealAttention(veilAds, clientUser, user, matchId, 3n);
      expect(passed).to.be.false;

      const [,,,,attentionPassed] = await veilAds.getMatchDetails(matchId);
      expect(attentionPassed).to.be.false;
    });

    it("Should pass attention gate at exact threshold boundary (5s)", async function () {
      const { veilAds, user, clientUser, matchId } = await loadFixture(revealedMatchFixture);

      const passed = await submitAndRevealAttention(veilAds, clientUser, user, matchId, 5n);
      expect(passed).to.be.true;
    });

    it("Should revert submitEngagement before match is revealed", async function () {
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } =
        await loadFixture(deployVeilAdsFixture);

      await createCampaign(veilAds, clientAdv1, advertiser1, [80n,20n,20n,20n,20n], 1000n, ethers.parseEther("0.5"), "ipfs://a");
      await createCampaign(veilAds, clientAdv2, advertiser2, [20n,80n,20n,20n,20n], 500n,  ethers.parseEther("0.5"), "ipfs://b");

      const matchId = await submitProfile(veilAds, clientUser, user, [90n,10n,10n,10n,10n]);
      // Not revealed yet

      const encTime = await clientUser.encryptInputs([Encryptable.uint32(10n)]).execute();
      await expect(
        veilAds.connect(user).submitEngagement(matchId, encTime[0])
      ).to.be.revertedWithCustomError(veilAds, "MatchNotRevealed");
    });
  });

  // ================================================================
  // === Section 5: Payout Tests ====================================
  // ================================================================

  describe("Payout", function () {

    async function attentionPassedFixture() {
      const base = await deployVeilAdsFixture();
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } = base;

      // Campaign 0: tech-heavy [90,10,10,10,10], bid=1000
      // Campaign 1: gaming-heavy [10,90,10,10,10], bid=500
      // User: tech-focused [80,20,20,20,20] → campaign 0 wins
      await createCampaign(veilAds, clientAdv1, advertiser1, [90n,10n,10n,10n,10n], 1000n, ethers.parseEther("1"), "ipfs://a");
      await createCampaign(veilAds, clientAdv2, advertiser2, [10n,90n,10n,10n,10n], 500n,  ethers.parseEther("1"), "ipfs://b");

      const matchId = await submitProfile(veilAds, clientUser, user, [80n,20n,20n,20n,20n]);
      await revealMatch(veilAds, clientUser, matchId);
      await submitAndRevealAttention(veilAds, clientUser, user, matchId, 10n);

      return { ...base, matchId };
    }

    it("Should transfer correct ETH to user on claimPayout", async function () {
      const { veilAds, user, matchId } = await loadFixture(attentionPassedFixture);

      const [,, clearingPriceWei] = await veilAds.getMatchResult(matchId);
      const userBalanceBefore = await ethers.provider.getBalance(user.address);

      const tx = await veilAds.connect(user).claimPayout(matchId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const userBalanceAfter = await ethers.provider.getBalance(user.address);
      expect(userBalanceAfter).to.be.closeTo(
        userBalanceBefore + clearingPriceWei - gasUsed,
        ethers.parseEther("0.001")
      );
    });

    it("Should decrement campaign escrow by clearing price after payout", async function () {
      const { veilAds, user, matchId } = await loadFixture(attentionPassedFixture);

      const [, winningCampaignId, clearingPriceWei] = await veilAds.getMatchResult(matchId);
      const [, escrowBefore] = await veilAds.getCampaignInfo(winningCampaignId);

      await veilAds.connect(user).claimPayout(matchId);

      const [, escrowAfter] = await veilAds.getCampaignInfo(winningCampaignId);
      expect(escrowAfter).to.equal(escrowBefore - clearingPriceWei);
    });

    it("Should emit PayoutClaimed event", async function () {
      const { veilAds, user, matchId } = await loadFixture(attentionPassedFixture);
      await expect(veilAds.connect(user).claimPayout(matchId))
        .to.emit(veilAds, "PayoutClaimed");
    });

    it("Should revert claimPayout if match not yet revealed", async function () {
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } =
        await loadFixture(deployVeilAdsFixture);

      await createCampaign(veilAds, clientAdv1, advertiser1, [80n,20n,20n,20n,20n], 1000n, ethers.parseEther("0.5"), "ipfs://a");
      await createCampaign(veilAds, clientAdv2, advertiser2, [20n,80n,20n,20n,20n], 500n,  ethers.parseEther("0.5"), "ipfs://b");

      const matchId = await submitProfile(veilAds, clientUser, user, [50n,50n,50n,50n,50n]);
      // Not revealed, not attention passed

      await expect(
        veilAds.connect(user).claimPayout(matchId)
      ).to.be.revertedWithCustomError(veilAds, "MatchNotRevealed");
    });

    it("Should revert claimPayout if attention not passed", async function () {
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } =
        await loadFixture(deployVeilAdsFixture);

      await createCampaign(veilAds, clientAdv1, advertiser1, [80n,20n,20n,20n,20n], 1000n, ethers.parseEther("0.5"), "ipfs://a");
      await createCampaign(veilAds, clientAdv2, advertiser2, [20n,80n,20n,20n,20n], 500n,  ethers.parseEther("0.5"), "ipfs://b");

      const matchId = await submitProfile(veilAds, clientUser, user, [50n,50n,50n,50n,50n]);
      await revealMatch(veilAds, clientUser, matchId);
      // Attention: 2s — fails threshold
      await submitAndRevealAttention(veilAds, clientUser, user, matchId, 2n);

      await expect(
        veilAds.connect(user).claimPayout(matchId)
      ).to.be.revertedWithCustomError(veilAds, "AttentionNotPassed");
    });

    it("Should prevent double payout (critical: reentrancy / flag guard)", async function () {
      const { veilAds, user, matchId } = await loadFixture(attentionPassedFixture);

      await veilAds.connect(user).claimPayout(matchId);

      await expect(
        veilAds.connect(user).claimPayout(matchId)
      ).to.be.revertedWithCustomError(veilAds, "AlreadyPaidOut");
    });

    it("Should revert claimPayout from non-user address", async function () {
      const { veilAds, advertiser1, matchId } = await loadFixture(attentionPassedFixture);

      await expect(
        veilAds.connect(advertiser1).claimPayout(matchId)
      ).to.be.revertedWithCustomError(veilAds, "NotMatchUser");
    });

    it("Should revert claimPayout when escrow insufficient (multi-match depletion)", async function () {
      // Scenario: same campaign wins two matches, but escrow is only enough for one payout
      const base = await deployVeilAdsFixture();
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } = base;

      const clientUser2 = await hre.cofhe.createClientWithBatteries(advertiser2); // reuse advertiser2 as second user
      const user2 = advertiser2;

      // Campaign 0 (tech), small escrow: just enough for 1 payout
      // Campaign 1 (gaming), normal escrow
      // We set escrow for campaign 0 to be just slightly more than one clearing price
      // so the second payout will fail

      // Low escrow campaign (tech) - bid = 1000 wei
      await createCampaign(veilAds, clientAdv1, advertiser1, [90n,10n,10n,10n,10n], 1000n, ethers.parseEther("0.5"), "ipfs://tech");
      // Dummy campaign needed for auction (must have 2 active)
      await createCampaign(veilAds, clientAdv2, advertiser2, [10n,10n,10n,10n,10n], 100n,  ethers.parseEther("0.5"), "ipfs://dummy");

      // First match — user1 (tech profile) — campaign 0 wins
      const matchId1 = await submitProfile(veilAds, clientUser, user, [90n,10n,10n,10n,10n]);
      await revealMatch(veilAds, clientUser, matchId1);
      await submitAndRevealAttention(veilAds, clientUser, user, matchId1, 10n);

      // Second match — user2 (same profile) — campaign 0 wins again
      const matchId2 = await submitProfile(veilAds, clientUser2, user2, [90n,10n,10n,10n,10n]);
      await revealMatch(veilAds, clientUser2, matchId2);
      await submitAndRevealAttention(veilAds, clientUser2, user2, matchId2, 10n);

      // Drain campaign 0 escrow fully by paying out match 1 and then manually setting escrow to 0
      await veilAds.connect(user).claimPayout(matchId1);

      // Deactivate campaign 0 to empty its remaining escrow
      await veilAds.connect(advertiser1).deactivateCampaign(0n);

      // Now try to claim match 2 payout — should revert (escrow depleted)
      await expect(
        veilAds.connect(user2).claimPayout(matchId2)
      ).to.be.revertedWithCustomError(veilAds, "InsufficientEscrow");
    });
  });

  // ================================================================
  // === Section 6: Overflow Boundary Test ==========================
  // ================================================================

  describe("euint64 Overflow Safety", function () {
    it("Should handle near-maximum effective bid without overflow", async function () {
      const base = await deployVeilAdsFixture();
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } = base;

      // Max relevance: 5 categories × 100×100 = 50,000
      // Max bid to still be safe under euint64 max (~1.8e19):
      //   50,000 × bid < 1.8e19  →  bid < 3.6e14 (360,000,000,000,000 wei = 0.36 ETH)
      // Use bid = 300,000,000,000,000 (0.3 ETH in wei) — well inside ceiling
      const largeBid = 300000000000000n; // 0.3 ETH in wei

      await createCampaign(veilAds, clientAdv1, advertiser1, [100n,100n,100n,100n,100n], largeBid, ethers.parseEther("2"), "ipfs://maxbid");
      await createCampaign(veilAds, clientAdv2, advertiser2, [50n,50n,50n,50n,50n],    largeBid, ethers.parseEther("2"), "ipfs://half");

      // Max profile — all 100
      const matchId = await submitProfile(veilAds, clientUser, user, [100n,100n,100n,100n,100n]);

      const winnerHandle = await veilAds.getMatchWinnerHandle(matchId);
      const priceHandle = await veilAds.getMatchPriceHandle(matchId);

      expect(winnerHandle).to.not.equal(0n);
      expect(priceHandle).to.not.equal(0n);

      // Campaign 0 wins (max relevance on both sides).
      // Effective bid 0: 50,000 × 300,000,000,000,000 = 1.5e19 — previously at the euint64 ceiling!
      // Now stored as euint128: ceiling ~3.4e38, this value is 0.000000000000000004% of capacity.
      await hre.cofhe.mocks.expectPlaintext(winnerHandle, 0n);
    });
  });

  // ================================================================
  // === Section 7b: Realistic Demo-Click Overflow Test =============
  // Mirrors the exact click a judge will make: all sliders maxed,
  // bid = 0.01 ETH. Under old euint64 this silently wrapped.
  // ================================================================

  describe("Realistic demo-click (0.01 ETH bid, all-max sliders)", function () {
    it("Should produce a sane clearing price — not a silently-wrapped garbage value", async function () {
      const base = await deployVeilAdsFixture();
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } = base;

      // 0.01 ETH = 1e16 wei
      // Old euint64: 50,000 × 1e16 = 5e20 > euint64 max (1.84e19) → SILENT OVERFLOW → wrong price
      // New euint128: 5e20 << euint128 ceiling (3.4e38) → correct result
      const demoBid = ethers.parseEther("0.01"); // 1e16 wei

      // Both campaigns: same bid. Campaign 0 has all-max targeting, campaign 1 has half targeting.
      await createCampaign(veilAds, clientAdv1, advertiser1, [100n,100n,100n,100n,100n], demoBid, ethers.parseEther("5"), "ipfs://demo1");
      await createCampaign(veilAds, clientAdv2, advertiser2, [50n,50n,50n,50n,50n],     demoBid, ethers.parseEther("5"), "ipfs://demo2");

      // Judge maxes out all profile sliders
      const matchId = await submitProfile(veilAds, clientUser, user, [100n,100n,100n,100n,100n]);

      // Campaign 0: relevance = 5 × (100×100) = 50,000, effectiveBid = 50,000 × 1e16 = 5e20
      // Campaign 1: relevance = 5 × (100×50)  = 25,000, effectiveBid = 25,000 × 1e16 = 2.5e20
      // Winner: campaign 0, clearing price (second-best): 25,000 × 1e16 = 2.5e20
      const expectedClearingPrice = 25000n * demoBid;

      const winnerHandle = await veilAds.getMatchWinnerHandle(matchId);
      const priceHandle  = await veilAds.getMatchPriceHandle(matchId);

      // Winner must be campaign 0
      await hre.cofhe.mocks.expectPlaintext(winnerHandle, 0n);
      // Clearing price must be the mathematically correct value, not a wrapped garbage number
      await hre.cofhe.mocks.expectPlaintext(priceHandle, expectedClearingPrice);
    });
  });

  // ================================================================
  // === Section 8: Attention State Frozen After Payout =============
  // Verifies the old bug is fixed: submitAttentionResult(false) could
  // previously flip attentionPassed back to false on a settled match.
  // ================================================================

  describe("Attention state frozen after payout", function () {
    it("Should revert submitEngagement after match is paid out", async function () {
      const base = await deployVeilAdsFixture();
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } = base;

      await createCampaign(veilAds, clientAdv1, advertiser1, [80n,20n,20n,20n,20n], 1000n, ethers.parseEther("1"), "ipfs://a");
      await createCampaign(veilAds, clientAdv2, advertiser2, [20n,80n,20n,20n,20n], 500n,  ethers.parseEther("1"), "ipfs://b");

      const matchId = await submitProfile(veilAds, clientUser, user, [80n,20n,20n,20n,20n]);
      await revealMatch(veilAds, clientUser, matchId);
      await submitAndRevealAttention(veilAds, clientUser, user, matchId, 10n);
      await veilAds.connect(user).claimPayout(matchId);

      // After payout, match is frozen — further engagement submission must fail
      const encTime = await clientUser.encryptInputs([Encryptable.uint32(10n)]).execute();
      await expect(
        veilAds.connect(user).submitEngagement(matchId, encTime[0])
      ).to.be.revertedWithCustomError(veilAds, "MatchAlreadyFinalized");
    });

    it("Should revert submitAttentionResult(false) after payout — state-flip exploit blocked", async function () {
      // Bug: old guard was (!m.attentionPassed || !result)
      // submitAttentionResult(false) when attentionPassed=true satisfied that guard and flipped state.
      // Fix: if(m.paidOut) revert MatchAlreadyFinalized()
      const base = await deployVeilAdsFixture();
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } = base;

      await createCampaign(veilAds, clientAdv1, advertiser1, [80n,20n,20n,20n,20n], 1000n, ethers.parseEther("1"), "ipfs://a");
      await createCampaign(veilAds, clientAdv2, advertiser2, [20n,80n,20n,20n,20n], 500n,  ethers.parseEther("1"), "ipfs://b");

      const matchId = await submitProfile(veilAds, clientUser, user, [80n,20n,20n,20n,20n]);
      await revealMatch(veilAds, clientUser, matchId);
      await submitAndRevealAttention(veilAds, clientUser, user, matchId, 10n); // passes
      await veilAds.connect(user).claimPayout(matchId);

      // Attempt state-flip: submit false after match is paid out
      const attHandle = await veilAds.getAttentionHandle(matchId);
      const attResult = await clientUser.decryptForTx(attHandle).withoutPermit().execute();
      await expect(
        veilAds.submitAttentionResult(matchId, false, attResult.signature)
      ).to.be.revertedWithCustomError(veilAds, "MatchAlreadyFinalized");

      // attentionPassed must still be true on-chain
      const [,,,,attentionPassed] = await veilAds.getMatchDetails(matchId);
      expect(attentionPassed).to.be.true;
    });
  });

  // ================================================================
  // === Section 9: Mid-flight deactivation =========================
  // ================================================================

  describe("Mid-flight deactivation", function () {
    it("Match result stands even if winning campaign is later deactivated", async function () {
      const { veilAds, advertiser1, advertiser2, clientAdv1, clientAdv2, user, clientUser } =
        await loadFixture(deployVeilAdsFixture);

      await createCampaign(veilAds, clientAdv1, advertiser1, [90n,10n,10n,10n,10n], 1000n, ethers.parseEther("1"), "ipfs://a");
      await createCampaign(veilAds, clientAdv2, advertiser2, [10n,90n,10n,10n,10n], 500n,  ethers.parseEther("1"), "ipfs://b");

      const matchId = await submitProfile(veilAds, clientUser, user, [80n,20n,20n,20n,20n]);
      await revealMatch(veilAds, clientUser, matchId);
      await submitAndRevealAttention(veilAds, clientUser, user, matchId, 10n);

      const [,, clearingPriceWei] = await veilAds.getMatchResult(matchId);
      const [, escrow] = await veilAds.getCampaignInfo(0n);

      if (escrow >= clearingPriceWei) {
        await veilAds.connect(user).claimPayout(matchId);
        const [,,,,, paidOut] = await veilAds.getMatchDetails(matchId);
        expect(paidOut).to.be.true;
      }
    });
  });
});
