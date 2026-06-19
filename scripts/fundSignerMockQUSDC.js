const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const DEFAULT_RUNTIME_SIGNER = "0x00D574Cbd13551ec23892e638252831339b68150";
const DEFAULT_FUND_AMOUNT = "1000";
const TOKEN_ABI = [
  "function faucet(address to,uint256 amount) external",
  "function mint(address to,uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner,address spender) external view returns (uint256)",
  "function approve(address spender,uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)"
];
const VAULT_ABI = [
  "function qieStablecoin() external view returns (address)"
];

function requireAddress(label, value) {
  if (!value || !hre.ethers.isAddress(value)) {
    throw new Error(`${label} must be a valid address`);
  }

  return hre.ethers.getAddress(value);
}

function sameAddress(left, right) {
  return left && right && left.toLowerCase() === right.toLowerCase();
}

function deploymentPath() {
  return path.join(__dirname, "..", process.env.DEPLOYMENT_PATH || "deployments/qie-mainnet.json");
}

function loadDeployment() {
  const filePath = deploymentPath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function deploymentAddress(deployment, ...keys) {
  for (const key of keys) {
    const value = deployment?.addresses?.[key] || deployment?.[key];
    if (value) {
      return value;
    }
  }

  return "";
}

function backendSignerAddress() {
  if (process.env.BACKEND_PRIVATE_KEY) {
    return new hre.ethers.Wallet(process.env.BACKEND_PRIVATE_KEY).address;
  }

  return "";
}

function approvalSigner(recipient, deployer) {
  if (sameAddress(recipient, deployer.address)) {
    return deployer;
  }

  if (process.env.BACKEND_PRIVATE_KEY) {
    const wallet = new hre.ethers.Wallet(process.env.BACKEND_PRIVATE_KEY, hre.ethers.provider);
    if (sameAddress(recipient, wallet.address)) {
      return wallet;
    }
  }

  return null;
}

async function tokenDecimals(token) {
  try {
    return Number(await token.decimals());
  } catch (_error) {
    return 18;
  }
}

async function mintOrFaucet(token, recipient, amount) {
  try {
    return await token.faucet(recipient, amount);
  } catch (faucetError) {
    try {
      return await token.mint(recipient, amount);
    } catch (_mintError) {
      throw faucetError;
    }
  }
}

async function waitForSuccess(tx, label) {
  console.log(`${label} tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} failed: transaction ${tx.hash} was not successful`);
  }

  console.log(`${label} confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

async function main() {
  const deployment = loadDeployment();
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer available. Set DEPLOYER_PRIVATE_KEY for the selected Hardhat network.");
  }

  const tokenAddress = requireAddress(
    "MOCK_QUSDC_ADDRESS or QUSDC_ADDRESS",
    process.env.MOCK_QUSDC_ADDRESS
      || process.env.QUSDC_ADDRESS
      || deploymentAddress(deployment, "mockQUSDC", "mockQusdc", "qusdc")
  );
  const recipient = requireAddress(
    "MOCK_QUSDC_RECIPIENT, BACKEND_SIGNER_ADDRESS, or BACKEND_PRIVATE_KEY",
    process.env.MOCK_QUSDC_RECIPIENT
      || process.env.BACKEND_SIGNER_ADDRESS
      || backendSignerAddress()
      || DEFAULT_RUNTIME_SIGNER
  );

  const token = new hre.ethers.Contract(tokenAddress, TOKEN_ABI, deployer);
  const decimals = await tokenDecimals(token);
  const amount = hre.ethers.parseUnits(process.env.MOCK_QUSDC_FAUCET_AMOUNT || DEFAULT_FUND_AMOUNT, decimals);

  const fundTx = await mintOrFaucet(token, recipient, amount);
  await waitForSuccess(fundTx, "MockQUSDC faucet");

  const balance = await token.balanceOf(recipient);
  console.log(`Funded ${recipient} with ${hre.ethers.formatUnits(amount, decimals)} mock QUSDC`);
  console.log(`MockQUSDC balance: ${hre.ethers.formatUnits(balance, decimals)} mock QUSDC`);

  if (process.env.MOCK_QUSDC_APPROVE_VAULT === "false") {
    return;
  }

  const vaultAddress = process.env.STREAM_VAULT_ADDRESS
    || deploymentAddress(deployment, "streamVault", "vault");
  if (!vaultAddress) {
    console.log("StreamVault approval skipped: STREAM_VAULT_ADDRESS is not configured");
    return;
  }

  const vault = new hre.ethers.Contract(requireAddress("StreamVault", vaultAddress), VAULT_ABI, hre.ethers.provider);
  const vaultToken = await vault.qieStablecoin();
  if (!sameAddress(vaultToken, tokenAddress)) {
    throw new Error(
      `StreamVault token mismatch. Vault uses ${vaultToken}, but MOCK_QUSDC_ADDRESS/QUSDC_ADDRESS is ${tokenAddress}. Redeploy the protocol with QUSDC_MODE=mock so StreamVault is wired to MockQUSDC.`
    );
  }

  const spender = requireAddress("StreamVault", vaultAddress);
  const approveAmount = hre.ethers.parseUnits(
    process.env.MOCK_QUSDC_APPROVE_AMOUNT || process.env.MOCK_QUSDC_FAUCET_AMOUNT || DEFAULT_FUND_AMOUNT,
    decimals
  );
  const signer = approvalSigner(recipient, deployer);
  if (!signer) {
    throw new Error(
      `Cannot approve StreamVault from ${recipient}. Set BACKEND_PRIVATE_KEY for that recipient or set MOCK_QUSDC_APPROVE_VAULT=false.`
    );
  }

  const signerToken = token.connect(signer);
  const allowance = await signerToken.allowance(recipient, spender);
  if (allowance < approveAmount) {
    const approveTx = await signerToken.approve(spender, approveAmount);
    await waitForSuccess(approveTx, "StreamVault approval");
  }

  const nextAllowance = await signerToken.allowance(recipient, spender);
  console.log(`StreamVault allowance: ${hre.ethers.formatUnits(nextAllowance, decimals)} mock QUSDC`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
