# Option 2: Galxe Space & Zealy Community Setup Guide

> Step-by-step instructions for setting up your campaign platforms

---

## Part A: Galxe Space Setup

### Step 1: Create Account
1. Go to **galxe.com**
2. Click "Connect Wallet" (top right)
3. Connect your wallet: `0x2F1a7d23C0bE593B39352F9fD3BAED37DC9Ff686`
4. Complete profile setup

### Step 2: Create Space
1. Click your profile → "Create Space"
2. Fill in details:

| Field | Value |
|-------|-------|
| Space Name | `EcoCoin` |
| Space Handle | `ecocoin` (lowercase, no spaces) |
| Category | `DeFi` or `Infrastructure` |
| Website | `https://ecocoin2.netlify.app` |
| Twitter | `@EcoCoinOfficial` |
| Discord | `[YOUR_DISCORD_INVITE]` |

3. Upload images:
   - **Logo:** `ecocoin_logo_256x256_v1.png`
   - **Banner:** `ecocoin_banner_galxe_1500x500_v1.png`

4. Write description (copy from below):
```
EcoCoin - Tokenizing carbon credits on blockchain. Offset your footprint, earn rewards, save the planet.

Join our Testnet Pioneer Program to earn OAT badges and guaranteed ECC token airdrop at mainnet launch.
```

5. Click "Create Space"

### Step 3: Create Campaign
1. In your Space → Click "Create Campaign"
2. Select "Quest Campaign"
3. Fill campaign details:

| Field | Value |
|-------|-------|
| Campaign Name | `EcoCoin Testnet Pioneer Program` |
| Start Date | `[YOUR_START_DATE]` |
| End Date | `[START + 90 DAYS]` |
| Chain | `Ethereum` (for OAT minting) |

4. Upload OAT image: `ecocoin_oat_badge_500x500_v1.png`

### Step 4: Add Credentials
1. Go to "Credentials" tab
2. Add each credential type:

**Twitter Follow:**
- Type: Twitter Follow
- Target: `@EcoCoinOfficial`
- Points: 50

**Discord Join:**
- Type: Discord Member
- Server: Select your server
- Points: 50

**Telegram Join:**
- Type: Telegram Member
- Group: Enter invite link
- Points: 50

**Wallet Connection:**
- Type: On-chain (Custom)
- Contract: Your verification contract
- Points: 100

### Step 5: Add Quests
Create quests for each category from `campaign_14day.md`:

1. Click "Add Quest"
2. Select credential type
3. Set points value
4. Add description
5. Repeat for all quests

### Step 6: Review & Publish
1. Preview campaign
2. Test one quest flow yourself
3. Click "Publish"
4. Share campaign link

---

## Part B: Zealy Community Setup

### Step 1: Create Account
1. Go to **zealy.io**
2. Click "Sign Up" or "Connect Wallet"
3. Complete profile

### Step 2: Create Community
1. Click "Create Community"
2. Fill details:

| Field | Value |
|-------|-------|
| Community Name | `EcoCoin` |
| Handle | `ecocoin` |
| Description | See below |
| Category | `Crypto / Web3` |
| Visibility | `Public` |

**Description:**
```
EcoCoin - The Carbon Credit Revolution

We're building the future of carbon offsetting on blockchain. Join our community to:

- Test our platform and earn rewards
- Learn about carbon credits and climate action
- Create content and grow with us
- Get early access to ECC token airdrop

Complete quests, climb the leaderboard, and become a climate champion!

Website: ecocoin2.netlify.app
```

3. Upload images:
   - **Logo:** `ecocoin_logo_256x256_v1.png`
   - **Banner:** `ecocoin_banner_zealy_1920x480_v1.png`

### Step 3: Create Sprint
1. Go to Settings → Sprints
2. Click "Create Sprint"
3. Fill details:

| Field | Value |
|-------|-------|
| Sprint Name | `Testnet Pioneer Campaign` |
| Duration | 90 days |
| Start Date | `[YOUR_START_DATE]` |

### Step 4: Connect Integrations
1. Go to Settings → Integrations
2. Connect:
   - **Twitter:** Authorize your account
   - **Discord:** Add Zealy bot to your server
   - **Telegram:** Add Zealy bot to your group

### Step 5: Create Quest Categories
1. Go to Quests → Categories
2. Create categories:
   - Getting Started
   - Platform Testing
   - Social Engagement
   - Content Creation
   - Referrals

### Step 6: Add Quests
For each category, add quests from `zealy/campaign_14day.md`:

**Example Quest Setup:**

| Field | Value |
|-------|-------|
| Quest Name | `Follow Twitter` |
| Description | `Follow @EcoCoinOfficial on Twitter` |
| XP Reward | `50` |
| Quest Type | `Twitter Follow` |
| Recurrence | `One-time` |
| Auto-verify | `Yes` |

**For Content Quests:**
| Field | Value |
|-------|-------|
| Quest Name | `Create EcoCoin Meme` |
| Description | `Create an original meme about EcoCoin or carbon credits. Must be original, not copyrighted.` |
| XP Reward | `200` |
| Quest Type | `Submission` |
| Review Type | `Manual` |
| Recurrence | `Weekly` (max 1/week) |

### Step 7: Set Up Leaderboard
1. Go to Settings → Rewards
2. Configure tiers (from final campaign doc):
   - Seedling: 3,000+ XP
   - Sapling: 8,000+ XP
   - Tree: 15,000+ XP
   - Forest: 25,000+ XP
   - Guardian: 40,000+ XP

### Step 8: Publish
1. Review all quests
2. Test one quest yourself
3. Toggle community to "Public"
4. Share community link

---

## Quick Reference Links

| Platform | Admin URL |
|----------|-----------|
| Galxe Dashboard | `https://galxe.com/dashboard` |
| Zealy Dashboard | `https://zealy.io/dashboard` |
| Discord Developer | `https://discord.com/developers` |
| Telegram BotFather | `https://t.me/BotFather` |

---

## After Setup Checklist

- [ ] Both platforms created and published
- [ ] All quests added with correct XP/points
- [ ] Social integrations connected
- [ ] Tested one quest flow on each platform
- [ ] Invite links ready for announcements
- [ ] Moderation team assigned (if any)
