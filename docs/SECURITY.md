# Security Guide — EcoCoin IV

## Critical Rules

### 1. Never Commit Secrets
The following files must NEVER be committed to git:
- `.env` (root, backend, functions)
- Any file containing private keys or API keys
- `*.docx` credential documents

The `.gitignore` is configured to block these. Verify with:
```bash
git init && git add -n . 2>/dev/null | grep -E "\.env|private|secret|password|credential"
```
If any sensitive files appear, do not proceed — add them to `.gitignore` first.

### 2. Private Key Rotation
If your `SEPOLIA_PRIVATE_KEY` was ever:
- Committed to git (even briefly)
- Shared in a chat or email
- Written in a file that was accidentally exposed

**You MUST rotate it immediately:**
1. Transfer all funds from the compromised wallet to a new wallet
2. Generate a new private key
3. Update `SEPOLIA_PRIVATE_KEY` in your `.env`
4. Revoke any roles granted to the old address on-chain

### 3. JWT Secret Requirements
- Minimum 64 characters
- Generated with: `node -e "require('crypto').randomBytes(64).toString('hex')"`
- The backend will throw an error in production if `JWT_SECRET` is not set
- In Firebase Functions, use Secrets Manager: `firebase functions:secrets:set JWT_SECRET`

## Local Setup

```bash
# Copy example files
cp .env.example .env
cp backend/.env.example backend/.env   # if exists

# Edit .env — fill in your real values
# Then install and run
npm install
npx hardhat compile
```

## Firebase Functions Secrets (Production)

```bash
# Set secrets via Firebase CLI (never put real values in .env for production)
firebase functions:secrets:set JWT_SECRET
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

## Reporting Security Issues

Do not open a public GitHub issue for security vulnerabilities.
Contact the project maintainer directly.
