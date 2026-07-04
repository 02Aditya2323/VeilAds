// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title VeilAds — Confidential Attention Marketplace
/// @notice Single contract: Campaign Management / Auction / Reveal / Attention Gate / Payout
/// @dev Built on Fhenix CoFHE. All bids and profiles stay encrypted. Only winner + clearing price are ever revealed.
contract VeilAds {

    // ========================
    // === Data Model ==========
    // ========================

    uint256 public constant CATEGORY_COUNT = 5;
    uint256 public constant ATTENTION_THRESHOLD_SECONDS = 5;
    
    /// @dev Toggle between FHE and plaintext attention gate. true = FHE mode (preferred).
    bool public constant ATTENTION_MODE_FHE = true;

    struct Campaign {
        address advertiser;
        euint8[5] targeting;    // encrypted, 0-100 per category: [tech, gaming, fitness, travel, finance]
        euint128 maxBid;        // encrypted, in wei — euint128 ceiling ~3.4e38 safely covers any realistic bid
        uint256 escrow;         // plaintext ETH balance (public by design — funding buffer, not the bid)
        bool active;
        string adURI;           // plaintext IPFS hash/URI of ad creative
    }

    struct Match {
        address user;
        uint256 winningCampaignId;   // set once revealed; type(uint256).max until then
        uint256 clearingPriceWei;    // set once revealed
        bool revealed;
        bool attentionPassed;        // set once attention gate resolves
        bool paidOut;
        // Internal encrypted handles for the reveal flow
        euint32 encryptedWinnerId;
        euint128 encryptedClearingPrice;  // euint128 to match bid type — no overflow at any realistic bid
        // Attention gate handle (FHE mode only)
        ebool encryptedAttentionResult;
    }

    Campaign[] public campaigns;
    mapping(uint256 => Match) public matches;
    uint256 public nextMatchId;

    // ========================
    // === Events ==============
    // ========================

    event CampaignCreated(uint256 indexed campaignId, address indexed advertiser, string adURI, uint256 escrow);
    event CampaignTopUp(uint256 indexed campaignId, uint256 amount, uint256 newEscrow);
    event CampaignDeactivated(uint256 indexed campaignId, uint256 escrowReturned);
    event MatchCreated(uint256 indexed matchId, address indexed user);
    event MatchRevealed(uint256 indexed matchId, uint256 winningCampaignId, uint256 clearingPriceWei);
    event AttentionVerified(uint256 indexed matchId, bool passed);
    event PayoutClaimed(uint256 indexed matchId, address indexed user, uint256 amount);

    // ========================
    // === Errors ==============
    // ========================

    error NotAdvertiser();
    error CampaignNotActive();
    error CampaignNotFound();
    error NoActiveCampaigns();
    error NeedAtLeastTwoCampaigns();
    error MatchNotFound();
    error AlreadyRevealed();
    error MatchNotRevealed();
    error AttentionNotPassed();
    error AlreadyPaidOut();
    error MatchAlreadyFinalized();
    error AttentionAlreadyVerified();
    error NotMatchUser();
    error InsufficientEscrow();
    error EscrowRequired();
    error TransferFailed();

    // ================================================================
    // === Section 1: Campaign Management =============================
    // ================================================================

    /// @notice Create a new campaign with encrypted targeting + bid, funded with ETH escrow
    /// @param targeting Encrypted targeting weights (0-100) for 5 categories
    /// @param maxBidInput Encrypted max bid in wei (submitted as InEuint64, stored as euint128)
    /// @param adURI Plaintext IPFS URI of the ad creative
    function createCampaign(
        InEuint8[5] memory targeting,
        InEuint64 memory maxBidInput,
        string memory adURI
    ) external payable {
        if (msg.value == 0) revert EscrowRequired();

        Campaign storage c = campaigns.push();
        c.advertiser = msg.sender;
        c.escrow = msg.value;
        c.active = true;
        c.adURI = adURI;

        // Convert encrypted targeting inputs and grant contract permission
        for (uint256 i = 0; i < CATEGORY_COUNT; i++) {
            c.targeting[i] = FHE.asEuint8(targeting[i]);
            FHE.allowThis(c.targeting[i]);
        }

        // Accept bid as euint64 (max ~18.4 ETH) then widen to euint128 for auction math.
        // Max effective bid = 50,000 (max relevance) × 18.4 ETH ≈ 9.2e23 — far below euint128 ceiling (~3.4e38).
        euint64 bidAsU64 = FHE.asEuint64(maxBidInput);
        c.maxBid = FHE.asEuint128(bidAsU64);
        FHE.allowThis(c.maxBid);

        emit CampaignCreated(campaigns.length - 1, msg.sender, adURI, msg.value);
    }

    /// @notice Add ETH to an existing campaign's escrow
    function topUpEscrow(uint256 campaignId) external payable {
        if (campaignId >= campaigns.length) revert CampaignNotFound();
        if (msg.value == 0) revert EscrowRequired();

        Campaign storage c = campaigns[campaignId];
        if (msg.sender != c.advertiser) revert NotAdvertiser();

        c.escrow += msg.value;
        emit CampaignTopUp(campaignId, msg.value, c.escrow);
    }

    /// @notice Deactivate a campaign and return remaining escrow to the advertiser
    function deactivateCampaign(uint256 campaignId) external {
        if (campaignId >= campaigns.length) revert CampaignNotFound();

        Campaign storage c = campaigns[campaignId];
        if (msg.sender != c.advertiser) revert NotAdvertiser();
        if (!c.active) revert CampaignNotActive();

        c.active = false;
        uint256 remaining = c.escrow;
        c.escrow = 0;

        if (remaining > 0) {
            (bool ok, ) = payable(msg.sender).call{value: remaining}("");
            if (!ok) revert TransferFailed();
        }

        emit CampaignDeactivated(campaignId, remaining);
    }

    /// @notice Get the total number of campaigns
    function getCampaignCount() external view returns (uint256) {
        return campaigns.length;
    }

    /// @notice Get campaign public info (no encrypted values exposed)
    function getCampaignInfo(uint256 campaignId) external view returns (
        address advertiser,
        uint256 escrow,
        bool active,
        string memory adURI
    ) {
        if (campaignId >= campaigns.length) revert CampaignNotFound();
        Campaign storage c = campaigns[campaignId];
        return (c.advertiser, c.escrow, c.active, c.adURI);
    }

    // ================================================================
    // === Section 2: Auction (matchAd) ===============================
    // ================================================================

    /// @dev Compute encrypted dot-product relevance for one campaign against a user profile
    function _computeRelevance(
        euint8[5] memory userProfile,
        uint256 campaignId
    ) private returns (euint32 relevance) {
        relevance = FHE.asEuint32(0);
        for (uint256 j = 0; j < CATEGORY_COUNT; j++) {
            euint32 pVal = FHE.asEuint32(userProfile[j]);
            euint32 tVal = FHE.asEuint32(campaigns[campaignId].targeting[j]);
            relevance = FHE.add(relevance, FHE.mul(pVal, tVal));
        }
    }

    /// @notice Submit an encrypted interest profile and run a sealed second-price auction
    /// @param profile Encrypted interest values (0-100) for 5 categories
    /// @return matchId The ID of the created match (poll getMatchResult for results)
    function matchAd(InEuint8[5] memory profile) external returns (uint256 matchId) {
        // Count active campaigns
        uint256 activeCount = 0;
        for (uint256 i = 0; i < campaigns.length; i++) {
            if (campaigns[i].active) activeCount++;
        }
        if (activeCount == 0) revert NoActiveCampaigns();
        if (activeCount < 2) revert NeedAtLeastTwoCampaigns();

        // Convert profile inputs
        euint8[5] memory userProfile;
        for (uint256 i = 0; i < CATEGORY_COUNT; i++) {
            userProfile[i] = FHE.asEuint8(profile[i]);
        }

        // Run sealed second-price auction
        (euint32 bestCampaignId, euint128 secondBestEffectiveBid) = _runAuction(userProfile);

        // Create match entry
        matchId = nextMatchId++;
        Match storage m = matches[matchId];
        m.user = msg.sender;
        m.winningCampaignId = type(uint256).max; // sentinel until revealed
        m.encryptedWinnerId = bestCampaignId;
        m.encryptedClearingPrice = secondBestEffectiveBid;

        // Grant permissions for the reveal flow
        FHE.allowThis(m.encryptedWinnerId);
        FHE.allowThis(m.encryptedClearingPrice);
        // Make publicly decryptable so anyone can call decryptForTx
        FHE.allowPublic(m.encryptedWinnerId);
        FHE.allowPublic(m.encryptedClearingPrice);

        emit MatchCreated(matchId, msg.sender);
    }

    /// @dev Inner auction loop — separated to minimize stack usage in matchAd
    function _runAuction(euint8[5] memory userProfile)
        private
        returns (euint32 bestCampaignId, euint128 secondBestEffectiveBid)
    {
        euint128 bestEffectiveBid = FHE.asEuint128(0);
        secondBestEffectiveBid = FHE.asEuint128(0);
        bestCampaignId = FHE.asEuint32(0);
        bool firstActive = true;

        for (uint256 i = 0; i < campaigns.length; i++) {
            if (!campaigns[i].active) continue;

            // Widen relevance (euint32, max 50,000) to euint128 before multiplying by maxBid (euint128).
            // Max effective bid = 50,000 × 18.4 ETH ≈ 9.2e23 — comfortably below euint128 ceiling (~3.4e38).
            euint128 effectiveBid = FHE.mul(
                FHE.asEuint128(_computeRelevance(userProfile, i)),
                campaigns[i].maxBid
            );
            euint32 currentId = FHE.asEuint32(i);

            if (firstActive) {
                bestEffectiveBid = effectiveBid;
                bestCampaignId = currentId;
                firstActive = false;
            } else {
                // Encrypted second-price comparison
                ebool isNewBest = FHE.gt(effectiveBid, bestEffectiveBid);
                ebool beatSecond = FHE.gt(effectiveBid, secondBestEffectiveBid);

                // Second-best = if new winner: old best; else: max(current second, this bid)
                secondBestEffectiveBid = FHE.select(
                    isNewBest,
                    bestEffectiveBid,
                    FHE.select(beatSecond, effectiveBid, secondBestEffectiveBid)
                );
                bestEffectiveBid = FHE.select(isNewBest, effectiveBid, bestEffectiveBid);
                bestCampaignId = FHE.select(isNewBest, currentId, bestCampaignId);
            }

            FHE.allowThis(bestEffectiveBid);
            FHE.allowThis(secondBestEffectiveBid);
            FHE.allowThis(bestCampaignId);
        }
    }

    // ================================================================
    // === Section 3: Reveal ==========================================
    // ================================================================

    /// @notice Submit verified decrypt results for winner ID and clearing price
    /// @dev Called after off-chain decryptForTx returns plaintext + Threshold Network signature
    function submitReveal(
        uint256 matchId,
        uint32 winnerId,
        bytes memory winnerSig,
        uint128 clearingPrice,
        bytes memory priceSig
    ) external {
        if (matchId >= nextMatchId) revert MatchNotFound();
        Match storage m = matches[matchId];
        if (m.revealed) revert AlreadyRevealed();

        // Verify and publish the decrypt results on-chain
        FHE.publishDecryptResult(m.encryptedWinnerId, winnerId, winnerSig);
        FHE.publishDecryptResult(m.encryptedClearingPrice, clearingPrice, priceSig);

        // Store the verified plaintext values
        m.winningCampaignId = uint256(winnerId);
        m.clearingPriceWei = uint256(clearingPrice);
        m.revealed = true;

        emit MatchRevealed(matchId, uint256(winnerId), uint256(clearingPrice));
    }

    /// @notice Check if a match has been revealed and get the result
    function getMatchResult(uint256 matchId) external view returns (
        bool revealed,
        uint256 winningCampaignId,
        uint256 clearingPriceWei
    ) {
        if (matchId >= nextMatchId) revert MatchNotFound();
        Match storage m = matches[matchId];
        return (m.revealed, m.winningCampaignId, m.clearingPriceWei);
    }

    /// @notice Get the encrypted winner handle (for off-chain decryptForTx)
    function getMatchWinnerHandle(uint256 matchId) external view returns (euint32) {
        if (matchId >= nextMatchId) revert MatchNotFound();
        return matches[matchId].encryptedWinnerId;
    }

    /// @notice Get the encrypted clearing price handle (for off-chain decryptForTx)
    function getMatchPriceHandle(uint256 matchId) external view returns (euint128) {
        if (matchId >= nextMatchId) revert MatchNotFound();
        return matches[matchId].encryptedClearingPrice;
    }

    // ================================================================
    // === Section 4: Attention Gate ==================================
    // ================================================================

    /// @notice Submit encrypted engagement time (FHE mode)
    /// @dev Compares encrypted view time against threshold, only reveals boolean result
    function submitEngagement(uint256 matchId, InEuint32 memory viewTimeSeconds) external {
        if (matchId >= nextMatchId) revert MatchNotFound();
        Match storage m = matches[matchId];
        if (!m.revealed) revert MatchNotRevealed();
        // Once paid out, this match is frozen — no further state changes allowed
        if (m.paidOut) revert MatchAlreadyFinalized();
        if (m.attentionPassed) revert AttentionAlreadyVerified();
        if (msg.sender != m.user) revert NotMatchUser();

        euint32 engagement = FHE.asEuint32(viewTimeSeconds);
        euint32 threshold = FHE.asEuint32(ATTENTION_THRESHOLD_SECONDS);

        // Encrypted comparison: engagement >= threshold
        ebool passed = FHE.gte(engagement, threshold);
        m.encryptedAttentionResult = passed;

        FHE.allowThis(m.encryptedAttentionResult);
        FHE.allowPublic(m.encryptedAttentionResult);
    }

    /// @notice Submit the verified attention gate decrypt result (FHE mode)
    function submitAttentionResult(
        uint256 matchId,
        bool result,
        bytes memory signature
    ) external {
        if (matchId >= nextMatchId) revert MatchNotFound();
        Match storage m = matches[matchId];
        if (!m.revealed) revert MatchNotRevealed();
        // Frozen after payout — prevents flipping attentionPassed on settled matches
        if (m.paidOut) revert MatchAlreadyFinalized();
        // Once attention is verified as true it cannot be overwritten
        if (m.attentionPassed) revert AttentionAlreadyVerified();

        FHE.publishDecryptResult(m.encryptedAttentionResult, result, signature);
        m.attentionPassed = result;

        emit AttentionVerified(matchId, result);
    }

    /// @notice Submit plaintext engagement time (fallback mode — no privacy on view time)
    function submitEngagementPlaintext(uint256 matchId, uint256 viewTimeSeconds) external {
        require(!ATTENTION_MODE_FHE, "Use FHE engagement submission");
        if (matchId >= nextMatchId) revert MatchNotFound();
        Match storage m = matches[matchId];
        if (!m.revealed) revert MatchNotRevealed();
        if (m.paidOut) revert MatchAlreadyFinalized();
        if (m.attentionPassed) revert AttentionAlreadyVerified();
        if (msg.sender != m.user) revert NotMatchUser();

        m.attentionPassed = viewTimeSeconds >= ATTENTION_THRESHOLD_SECONDS;
        emit AttentionVerified(matchId, m.attentionPassed);
    }

    /// @notice Get attention gate handle for off-chain decryptForTx
    function getAttentionHandle(uint256 matchId) external view returns (ebool) {
        if (matchId >= nextMatchId) revert MatchNotFound();
        return matches[matchId].encryptedAttentionResult;
    }

    // ================================================================
    // === Section 5: Payout ==========================================
    // ================================================================

    /// @notice Claim ETH payout for a successfully matched and attention-verified match
    function claimPayout(uint256 matchId) external {
        if (matchId >= nextMatchId) revert MatchNotFound();
        Match storage m = matches[matchId];

        // Preconditions — checked in order with clear revert reasons
        if (!m.revealed) revert MatchNotRevealed();
        if (!m.attentionPassed) revert AttentionNotPassed();
        if (m.paidOut) revert AlreadyPaidOut();
        if (msg.sender != m.user) revert NotMatchUser();

        uint256 campaignId = m.winningCampaignId;
        if (campaignId >= campaigns.length) revert CampaignNotFound();

        Campaign storage camp = campaigns[campaignId];
        uint256 payout = m.clearingPriceWei;

        if (camp.escrow < payout) revert InsufficientEscrow();

        // Checks-Effects-Interactions: set paidOut BEFORE sending ETH
        m.paidOut = true;
        camp.escrow -= payout;

        (bool ok, ) = payable(msg.sender).call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit PayoutClaimed(matchId, msg.sender, payout);
    }

    /// @notice Get full match details
    function getMatchDetails(uint256 matchId) external view returns (
        address user,
        uint256 winningCampaignId,
        uint256 clearingPriceWei,
        bool revealed,
        bool attentionPassed,
        bool paidOut
    ) {
        if (matchId >= nextMatchId) revert MatchNotFound();
        Match storage m = matches[matchId];
        return (m.user, m.winningCampaignId, m.clearingPriceWei, m.revealed, m.attentionPassed, m.paidOut);
    }
    // Note: no receive() — direct ETH transfers to this contract are rejected.
    // All escrow must go through createCampaign() or topUpEscrow() to be properly accounted.
}
