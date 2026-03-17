# EcoCoin (ECC) Project Status & History

> **Last Updated:** 2026-01-24
> **Network:** Sepolia Testnet (preparing for Mainnet)
> **Live App:** https://ecocoin2.netlify.app
> **Backend API:** https://us-central1-ecocoin-f32d8.cloudfunctions.net/api

---

## Quick Reference

| Item | Value |
|------|-------|
| Token Symbol | ECC |
| Total Supply | 100,000,000 ECC |
| Contract Address | `0x1D5404994cABc50332b713af77DB020cE571F425` |
| Admin/Treasury Wallet | `0x2F1a7d23C0bE593B39352F9fD3BAED37DC9Ff686` |
| Network | Sepolia Testnet (Chain ID: 11155111) |
| Token Standard | ERC-20 |

---

## Tokenomics Distribution Plan

### Total Supply: 100,000,000 ECC

| Allocation | Percentage | Amount (ECC) | Status | Wallet/Contract |
|------------|------------|--------------|--------|-----------------|
| Community & Ecosystem | 40% | 40,000,000 | Held by Admin | Treasury Wallet |
| Staking Rewards | 25% | 25,000,000 | To be funded | Staking Contract |
| Team & Development | 15% | 15,000,000 | Vested (24 months) | Team Wallet (TBD) |
| Liquidity & Farming | 10% | 10,000,000 | Reserved for DEX | Liquidity Wallet (TBD) |
| Airdrops & Marketing | 10% | 10,000,000 | Faucet + Campaigns | Faucet Contract |

---

## Distribution Strategy for Testnet Launch

### Phase 1: Testnet Seeding (Current)

**Faucet Allocation (from Airdrops & Marketing):**
- Initial Faucet Fund: 1,000,000 ECC (1% of supply)
- Drip Rate: 100 ECC per claim
- Cooldown: 24 hours per wallet
- Max Claims per Wallet: 10 (lifetime on testnet)
- Purpose: Allow users to test staking, marketplace, governance

**Staking Rewards Pool:**
- Initial Fund: 5,000,000 ECC (5% of supply)
- APY Tiers: 8% (Flexible), 10% (30-day), 12% (90-day)
- Distribution: Continuous based on stake duration

**Community Airdrops:**
- Early Tester Airdrop: 500,000 ECC
- Social Campaign: 500,000 ECC
- Bug Bounty Reserve: 200,000 ECC

### Phase 2: Pre-Mainnet (Future)

**Liquidity Preparation:**
- Reserve: 10,000,000 ECC for DEX launch
- Target Pairs: ECC/ETH, ECC/USDC
- Initial Liquidity Target: $50,000 - $100,000 worth

**Private Sale (Optional):**
- Allocation: From Community pool
- Price: TBD based on testnet metrics
- Vesting: 6-month cliff, 12-month linear

### Phase 3: Mainnet Launch (Future)

**DEX Launch Checklist:**
- [ ] Contract audit completed
- [ ] Liquidity locked (minimum 1 year)
- [ ] Launch on Uniswap V3 (Ethereum) or similar
- [ ] CoinGecko / CMC listing application
- [ ] Community announcement

---

## Deployed Contracts (Sepolia)

| Contract | Address | Purpose |
|----------|---------|---------|
| ECC Token (Main) | `0x1D5404994cABc50332b713af77DB020cE571F425` | ERC-20 token with integrated staking |
| Staking Vault | `0x1D5404994cABc50332b713af77DB020cE571F425` | Integrated in main contract |
| MasterChef | `0x1D5404994cABc50332b713af77DB020cE571F425` | Integrated in main contract |
| Carbon Credit NFT | `0x36079478C6439aCea6432Dfec0bf252362D4C665` | NFT certificates for carbon credits |
| Certificate NFT | `0xD58752cEf52aEDAEF72ABD985e7F1d3754Fa6d5C` | Achievement/verification certificates |
| Governor | `0x6abD6CB9648399F9F0BB868C81C7395Dc04a22d7` | Governance voting |
| Rewards Distributor | `0xAFd4C80678aac60d42E2b6bDc6a2f939bd6DEDf7` | Referral & bonus rewards |

---

## Backend Infrastructure

### Firebase (Backend API)
- **Project:** ecocoin-f32d8
- **Functions URL:** https://us-central1-ecocoin-f32d8.cloudfunctions.net/api
- **Database:** Firestore
- **Features:**
  - User authentication (wallet signature)
  - Payment processing (Stripe)
  - Carbon credit registry
  - Escrow management
  - Treasury fee collection (5%)

### Netlify (Frontend)
- **Site:** ecocoin2.netlify.app
- **Source:** `base/desktop/` folder

### Secrets Configured (Firebase)
- `STRIPE_SECRET_KEY` - Stripe payment processing
- `JWT_SECRET` - Authentication tokens
- `TREASURY_WALLET` - Platform fee destination

---

## Platform Fees

| Fee Type | Percentage | Destination |
|----------|------------|-------------|
| Marketplace Sales | 5% | Treasury Wallet |
| Escrow Threshold | >$1000 | Held in escrow until confirmed |

---

## Faucet Configuration

```javascript
FAUCET_CONFIG = {
    enabled: true,
    tokenAddress: '0x1D5404994cABc50332b713af77DB020cE571F425',
    dripAmount: 100,              // ECC per claim
    cooldownHours: 24,            // Hours between claims
    maxClaimsPerWallet: 10,       // Lifetime limit on testnet
    totalAllocation: 1000000,     // Total ECC for faucet
    adminWallet: '0x2F1a7d23C0bE593B39352F9fD3BAED37DC9Ff686'
}
```

---

## Development History

### 2026-01-24
- [x] Firebase backend deployed with Stripe integration
- [x] Netlify frontend deployed
- [x] Treasury wallet configured for platform fees
- [x] Payment flow fixed (Card, Crypto, Bank, Mobile Money)
- [x] Seller Settings & Escrow moved to Marketplace tab
- [x] Faucet system designed based on tokenomics
- [x] **FAUCET SYSTEM IMPLEMENTED:**
  - Backend API endpoints: `/api/faucet/status`, `/api/faucet/claim`, `/api/faucet/pending`
  - Admin endpoints: `/api/faucet/process`, `/api/faucet/batch-process`
  - Frontend UI added to Testnet tab with claim button
  - Config: 100 ECC per claim, 24hr cooldown, max 10 claims per wallet
  - Claims stored in Firestore `faucet_claims` collection
  - Admin must manually send tokens and mark claims as processed
- [x] PROJECT_STATUS.md created for session continuity

### Previous
- Smart contracts deployed to Sepolia
- Frontend UI completed with all tabs
- Staking, farming, governance systems built
- Carbon credit verification system
- Learning management system (LMS)
- Referral system

---

## Active Tasks

**See:** `E:\Eco Coin IV\tasks\` folder for daily tasks

**Current Task (Jan 25, 2026):** Set up Galxe & Zealy campaigns

---

## Next Steps (Priority Order)

1. **Fund Faucet Contract**
   - Transfer 1,000,000 ECC from admin wallet to faucet
   - Enable faucet endpoint in backend

2. **Fund Staking Rewards**
   - Transfer 5,000,000 ECC to staking contract
   - Verify reward distribution works

3. **Beta Testing**
   - Invite 10-20 testers
   - Monitor for bugs
   - Collect feedback

4. **Contract Verification**
   - Verify on Etherscan Sepolia
   - Publish source code

5. **Documentation**
   - User guide
   - API documentation
   - Tokenomics whitepaper

6. **Liquidity Planning**
   - Research DEX options
   - Plan liquidity bootstrapping
   - Explore launchpad partnerships

---

## Wallet Addresses Summary

| Purpose | Address | Balance |
|---------|---------|---------|
| Admin/Deployer | `0x2F1a7d23C0bE593B39352F9fD3BAED37DC9Ff686` | 100,000,000 ECC |
| Treasury (Fees) | `0x2F1a7d23C0bE593B39352F9fD3BAED37DC9Ff686` | Same as admin |
| Staking Contract | `0x1D5404994cABc50332b713af77DB020cE571F425` | To be funded |
| Faucet | To be created or use admin | To be funded |

---

## Important Notes for Future Sessions

1. **All 100M ECC currently held by admin wallet** - needs distribution
2. **Faucet not yet funded** - requires ECC transfer
3. **Staking pool not yet funded** - users can stake but no rewards yet
4. **Liquidity reserved for mainnet** - don't distribute on testnet
5. **Platform fees (5%)** go to treasury wallet on every sale
6. **Stripe is in TEST MODE** - use test cards for payments

---

## Test Credentials

**Stripe Test Cards:**
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Expiry: Any future date
- CVC: Any 3 digits

**Admin Wallet:**
- Address: `0x2F1a7d23C0bE593B39352F9fD3BAED37DC9Ff686`
- Has full admin privileges

---

## Contact & Resources

- **Etherscan (Sepolia):** https://sepolia.etherscan.io/address/0x1D5404994cABc50332b713af77DB020cE571F425
- **Firebase Console:** https://console.firebase.google.com/project/ecocoin-f32d8
- **Netlify Dashboard:** https://app.netlify.com/projects/ecocoin2

---

*This file should be read at the start of every Claude session to understand project context.*
