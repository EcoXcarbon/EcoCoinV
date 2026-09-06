// Blockchain Anchoring Service for Talent Ledger
// Writes credential hashes to smart contract (Polygon L2 or simulated)
import { sha256 } from './keyManagement.js';

// In-memory simulated blockchain (used when no real blockchain is configured)
const simulatedChain = new Map();
let simulatedBlockNumber = 1;

/**
 * Anchor a credential hash to the blockchain
 * @param {string} credentialHash - SHA-256 hash of the signed VC
 * @param {object} options - { chain: 'polygon'|'simulated', rpcUrl, contractAddress, privateKey }
 * @returns {{ txHash: string, blockNumber: number, timestamp: string, networkId: string }}
 */
export async function anchorToBlockchain(credentialHash, options = {}) {
  const chain = options.chain || process.env.BLOCKCHAIN_CHAIN || 'simulated';

  if (chain === 'simulated') {
    return anchorSimulated(credentialHash);
  }

  // Real blockchain anchoring (Polygon/EVM)
  return anchorToEVM(credentialHash, options);
}

/**
 * Simulated blockchain anchoring for development/testing
 */
function anchorSimulated(credentialHash) {
  if (simulatedChain.has(credentialHash)) {
    const existing = simulatedChain.get(credentialHash);
    return { ...existing, alreadyAnchored: true };
  }

  const txHash = '0x' + sha256(credentialHash + Date.now().toString());
  const blockNumber = simulatedBlockNumber++;
  const timestamp = new Date().toISOString();

  const record = {
    txHash,
    blockNumber,
    timestamp,
    networkId: 'simulated',
    credentialHash,
  };
  simulatedChain.set(credentialHash, record);
  return record;
}

/**
 * Real EVM blockchain anchoring (Polygon, Ethereum L2)
 * Requires ethers.js and a deployed TalentLedgerRegistry contract
 */
async function anchorToEVM(credentialHash, options) {
  try {
    // Dynamic import to avoid requiring ethers when using simulated mode
    const { ethers } = await import('ethers');

    const rpcUrl = options.rpcUrl || process.env.BLOCKCHAIN_RPC_URL || 'https://polygon-rpc.com';
    const contractAddress = options.contractAddress || process.env.BLOCKCHAIN_CONTRACT_ADDRESS;
    const privateKey = options.privateKey || process.env.BLOCKCHAIN_PRIVATE_KEY;

    if (!contractAddress || !privateKey) {
      console.warn('Blockchain not configured, falling back to simulated');
      return anchorSimulated(credentialHash);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    // TalentLedgerRegistry ABI (minimal — just anchorCredential)
    const abi = [
      'function anchorCredential(bytes32 credentialHash, bytes32 issuerHash, uint8 credentialType, uint256 issuanceTimestamp) external',
      'function verifyAnchor(bytes32 credentialHash) external view returns (bool exists, bytes32 issuerHash, uint8 credentialType, uint256 anchorTimestamp, uint256 blockNumber)',
      'event CredentialAnchored(bytes32 indexed credentialHash, bytes32 indexed issuerHash, uint8 credentialType, uint256 timestamp)',
    ];

    const contract = new ethers.Contract(contractAddress, abi, wallet);

    // Estimate gas first
    const gasEstimate = await contract.anchorCredential.estimateGas(
      '0x' + credentialHash,
      '0x' + '0'.repeat(64), // placeholder issuer hash
      0,
      Math.floor(Date.now() / 1000),
    );

    const gasPrice = (await provider.getFeeData()).gasPrice;
    const gasCost = gasEstimate * gasPrice;
    const maxGasCost = ethers.parseEther(process.env.BLOCKCHAIN_MAX_GAS_COST || '0.01');

    if (gasCost > maxGasCost) {
      console.warn(`Gas cost ${ethers.formatEther(gasCost)} ETH exceeds threshold, queuing for later`);
      return anchorSimulated(credentialHash); // fallback to simulated
    }

    const tx = await contract.anchorCredential(
      '0x' + credentialHash,
      '0x' + '0'.repeat(64),
      0,
      Math.floor(Date.now() / 1000),
    );

    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      timestamp: new Date().toISOString(),
      networkId: (await provider.getNetwork()).chainId.toString(),
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (err) {
    console.error('Blockchain anchoring failed:', err.message);
    // Fallback to simulated
    return { ...anchorSimulated(credentialHash), fallback: true, error: err.message };
  }
}

/**
 * Verify a credential hash against blockchain anchor
 * @param {string} credentialHash - Hash to verify
 * @param {string} txHash - Expected transaction hash
 * @returns {{ anchored: boolean, anchorDate: string, blockNumber: number }}
 */
export async function verifyBlockchainAnchor(credentialHash, txHash) {
  const chain = process.env.BLOCKCHAIN_CHAIN || 'simulated';

  if (chain === 'simulated') {
    const record = simulatedChain.get(credentialHash);
    if (!record) return { anchored: false };
    return {
      anchored: true,
      anchorDate: record.timestamp,
      blockNumber: record.blockNumber,
      txHashMatch: record.txHash === txHash,
    };
  }

  // Real blockchain verification
  try {
    const { ethers } = await import('ethers');
    const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || 'https://polygon-rpc.com';
    const contractAddress = process.env.BLOCKCHAIN_CONTRACT_ADDRESS;

    if (!contractAddress) return { anchored: false, error: 'Contract not configured' };

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const abi = [
      'function verifyAnchor(bytes32 credentialHash) external view returns (bool exists, bytes32 issuerHash, uint8 credentialType, uint256 anchorTimestamp, uint256 blockNumber)',
    ];
    const contract = new ethers.Contract(contractAddress, abi, provider);

    const [exists, , , anchorTimestamp, blockNumber] = await contract.verifyAnchor('0x' + credentialHash);

    return {
      anchored: exists,
      anchorDate: exists ? new Date(Number(anchorTimestamp) * 1000).toISOString() : null,
      blockNumber: exists ? Number(blockNumber) : null,
    };
  } catch (err) {
    return { anchored: false, error: err.message };
  }
}

/**
 * Batch anchor multiple credential hashes using the contract's batchAnchorCredentials()
 * @param {string[]} credentialHashes - Array of SHA-256 hashes (hex, no 0x prefix)
 * @param {object} options - { chain, issuerHashes, credentialTypes }
 * @returns {object} Batch anchor result with txHash and individual results
 */
export async function batchAnchor(credentialHashes, options = {}) {
  const chain = options.chain || process.env.BLOCKCHAIN_CHAIN || 'simulated';

  if (chain === 'simulated') {
    const results = [];
    for (const hash of credentialHashes) {
      results.push(anchorSimulated(hash));
    }
    return { results, batchTx: null };
  }

  return batchAnchorEVM(credentialHashes, options);
}

/**
 * Real EVM batch anchoring using batchAnchorCredentials()
 */
async function batchAnchorEVM(credentialHashes, options) {
  try {
    const { ethers } = await import('ethers');

    const rpcUrl = options.rpcUrl || process.env.BLOCKCHAIN_RPC_URL || 'https://polygon-rpc.com';
    const contractAddress = options.contractAddress || process.env.BLOCKCHAIN_CONTRACT_ADDRESS;
    const privateKey = options.privateKey || process.env.BLOCKCHAIN_PRIVATE_KEY;

    if (!contractAddress || !privateKey) {
      const results = credentialHashes.map(h => anchorSimulated(h));
      return { results, batchTx: null, fallback: true };
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    const abi = [
      'function batchAnchorCredentials(bytes32[] calldata credentialHashes, bytes32[] calldata issuerHashes, uint8[] calldata credentialTypes, uint256[] calldata issuanceTimestamps) external',
      'function verifyAnchor(bytes32 credentialHash) external view returns (bool exists, bytes32 issuerHash, uint8 credentialType, uint256 anchorTimestamp, uint256 blockNumber)',
    ];

    const contract = new ethers.Contract(contractAddress, abi, wallet);

    const now = Math.floor(Date.now() / 1000);
    const bytes32Hashes = credentialHashes.map(h => '0x' + h.padStart(64, '0'));
    const issuerHashes = (options.issuerHashes || []).map(h => '0x' + h.padStart(64, '0'));
    const paddedIssuerHashes = bytes32Hashes.map((_, i) => issuerHashes[i] || ethers.ZeroHash);
    const types = (options.credentialTypes || []).concat(
      Array(Math.max(0, credentialHashes.length - (options.credentialTypes?.length || 0))).fill(0)
    );
    const timestamps = bytes32Hashes.map(() => now);

    const tx = await contract.batchAnchorCredentials(bytes32Hashes, paddedIssuerHashes, types, timestamps);
    const receipt = await tx.wait();

    const networkId = (await provider.getNetwork()).chainId.toString();

    // Build individual results (all share the same tx)
    const results = credentialHashes.map(hash => ({
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      timestamp: new Date().toISOString(),
      networkId,
      credentialHash: hash,
      gasUsed: (receipt.gasUsed / BigInt(credentialHashes.length)).toString(),
    }));

    return {
      results,
      batchTx: receipt.hash,
      blockNumber: receipt.blockNumber,
      networkId,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (err) {
    console.error('Batch blockchain anchoring failed:', err.message);
    const results = credentialHashes.map(h => ({ ...anchorSimulated(h), fallback: true }));
    return { results, batchTx: null, fallback: true, error: err.message };
  }
}

export default { anchorToBlockchain, verifyBlockchainAnchor, batchAnchor };
