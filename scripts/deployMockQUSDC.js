const fs = require("fs");
const os = require("os");
const path = require("path");
const hre = require("hardhat");

const DEPLOYMENT_FILE = path.join(__dirname, "..", "deployments", "qie-testnet.json");
const FRONTEND_DEPLOYMENT_FILE = path.join(__dirname, "..", "frontend", "public", "deployments", "qie-testnet.json");

function upsertEnvFile(values) {
  if (process.env.SPENDGRID_UPDATE_ENV === "false") {
    return null;
  }

  const envPath = path.join(__dirname, "..", ".env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !Object.prototype.hasOwnProperty.call(values, match[1])) {
      return line;
    }

    const key = match[1];
    seen.add(key);
    return `${key}=${values[key]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }

  fs.writeFileSync(envPath, `${nextLines.join(os.EOL)}${os.EOL}`);
  return envPath;
}

function updateDeploymentFile(filePath, tokenAddress) {
  if (process.env.SPENDGRID_UPDATE_DEPLOYMENT === "false" || !fs.existsSync(filePath)) {
    return null;
  }

  const deployment = JSON.parse(fs.readFileSync(filePath, "utf8"));
  deployment.qusdc = tokenAddress;
  deployment.mockQUSDC = tokenAddress;
  deployment.addresses = {
    ...(deployment.addresses || {}),
    qusdc: tokenAddress,
    mockQUSDC: tokenAddress
  };

  fs.writeFileSync(filePath, `${JSON.stringify(deployment, null, 2)}${os.EOL}`);
  return filePath;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer available. Set DEPLOYER_PRIVATE_KEY for the selected Hardhat network.");
  }

  const factory = await hre.ethers.getContractFactory("MockQUSDC");
  const token = await factory.deploy();
  await token.waitForDeployment();

  const address = await token.getAddress();
  console.log(`MockQUSDC deployed at: ${address}`);

  const envPath = upsertEnvFile({
    QUSDC_MODE: "mock",
    QUSDC_ADDRESS: address,
    MOCK_QUSDC_ADDRESS: address
  });
  const deploymentPath = updateDeploymentFile(DEPLOYMENT_FILE, address);
  const frontendDeploymentPath = updateDeploymentFile(FRONTEND_DEPLOYMENT_FILE, address);

  if (envPath) {
    console.log(`Environment file updated at: ${envPath}`);
  }
  if (deploymentPath) {
    console.log(`Deployment file updated at: ${deploymentPath}`);
  }
  if (frontendDeploymentPath) {
    console.log(`Frontend deployment file updated at: ${frontendDeploymentPath}`);
  }

  console.log("Set QUSDC_MODE=mock");
  console.log(`Set QUSDC_ADDRESS=${address}`);
  console.log(`Set MOCK_QUSDC_ADDRESS=${address}`);
  console.log("For executePayment to work, StreamVault.qieStablecoin must be this same MockQUSDC address.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
