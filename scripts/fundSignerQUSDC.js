const hre = require("hardhat");
const { loadDeployment } = require("../backend/src/deployment");

const DEFAULT_RUNTIME_SIGNER = "0x00D574Cbd13551ec23892e638252831339b68150";
const DEFAULT_MIN_BALANCE = "5";
const MIN_VALIDATION_BALANCE = "0.1";
const GAS_HEADROOM_WEI = hre.ethers.parseEther("0.02");
const MINT_SELECTOR = "0x40c10f19";

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) external returns (bool)",
  "function allowance(address owner,address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function mint(address to,uint256 amount) external"
];

const WQIE_ABI = [
  ...ERC20_ABI,
  "function deposit() external payable"
];

const ROUTER_ABI = [
  "function getAmountOut(uint256 amountIn,address input,address output) external view returns (uint256 amountOut)",
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] calldata path,address to,uint256 deadline) external returns (uint256[] memory amounts)"
];

function requireAddress(label, value) {
  if (!value || !hre.ethers.isAddress(value)) {
    throw new Error(`${label} must be a valid address`);
  }

  return hre.ethers.getAddress(value);
}

function sameAddress(left, right) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function backendSignerAddress() {
  if (process.env.BACKEND_PRIVATE_KEY) {
    return new hre.ethers.Wallet(process.env.BACKEND_PRIVATE_KEY).address;
  }

  return "";
}

async function tokenDecimals(token) {
  try {
    return Number(await token.decimals());
  } catch (_error) {
    return 18;
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

async function detectMintSupport(token, recipient) {
  const tokenAddress = await token.getAddress();
  const code = await hre.ethers.provider.getCode(tokenAddress);
  if (!code || code === "0x") {
    throw new Error(`QUSDC contract is not deployed at ${tokenAddress}`);
  }

  if (code.toLowerCase().includes(MINT_SELECTOR.slice(2))) {
    return { supported: true, reason: "mint selector present in runtime bytecode" };
  }

  try {
    await hre.ethers.provider.call({
      to: tokenAddress,
      data: token.interface.encodeFunctionData("mint", [recipient, 0n])
    });
    return { supported: true, reason: "mint eth_call succeeded" };
  } catch (error) {
    return {
      supported: false,
      reason: error.shortMessage || error.reason || error.message || String(error)
    };
  }
}

async function mintQusdc(token, recipient, amount) {
  const tx = await token.mint(recipient, amount);
  await waitForSuccess(tx, "QUSDC mint");
  return { funded: true, method: "mint", txHash: tx.hash };
}

async function approveIfNeeded(token, owner, spender, amount) {
  const allowance = BigInt(await token.allowance(owner, spender));
  if (allowance >= amount) {
    return null;
  }

  const tx = await token.approve(spender, amount);
  await waitForSuccess(tx, "WQIE approval");
  return tx.hash;
}

async function ensureWqieBalance(wqie, signer, owner, amount) {
  const balance = BigInt(await wqie.balanceOf(owner));
  if (balance >= amount) {
    return { balance, wrapped: false, txHash: null };
  }

  const missing = amount - balance;
  const nativeBalance = BigInt(await hre.ethers.provider.getBalance(owner));
  if (nativeBalance <= missing + GAS_HEADROOM_WEI) {
    throw new Error(
      `Insufficient WQIE for QUSDC swap. Need ${hre.ethers.formatEther(missing)} WQIE or native QIE to wrap, but signer has ${hre.ethers.formatEther(balance)} WQIE and ${hre.ethers.formatEther(nativeBalance)} native QIE.`
    );
  }

  const tx = await wqie.connect(signer).deposit({ value: missing });
  await waitForSuccess(tx, "WQIE deposit");
  return { balance: balance + missing, wrapped: true, txHash: tx.hash };
}

async function swapForQusdc({ router, wqie, qusdc, signer, recipient, missingQusdc }) {
  let amountIn = hre.ethers.parseUnits(process.env.FUND_SIGNER_WQIE_SWAP_AMOUNT || "0.01", 18);
  let expectedOut;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    expectedOut = BigInt(await router.getAmountOut(amountIn, await wqie.getAddress(), await qusdc.getAddress()));
    if (expectedOut >= missingQusdc) {
      break;
    }
    amountIn *= 2n;
  }

  if (!expectedOut || expectedOut < missingQusdc) {
    throw new Error(
      `QIEDex quote cannot satisfy required QUSDC funding. Required ${missingQusdc.toString()} wei QUSDC, quoted ${expectedOut?.toString() || "0"} wei QUSDC for ${amountIn.toString()} wei WQIE.`
    );
  }

  const wqieBalance = await ensureWqieBalance(wqie, signer, recipient, amountIn);
  const approvalHash = await approveIfNeeded(wqie.connect(signer), recipient, await router.getAddress(), amountIn);
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const minOut = (expectedOut * BigInt(10_000 - Number(process.env.FUND_SIGNER_SLIPPAGE_BPS || "100"))) / 10_000n;
  const tx = await router.connect(signer).swapExactTokensForTokens(
    amountIn,
    minOut,
    [await wqie.getAddress(), await qusdc.getAddress()],
    recipient,
    deadline
  );
  await waitForSuccess(tx, "QIEDex WQIE->QUSDC swap");

  return {
    funded: true,
    method: "swap",
    txHash: tx.hash,
    amountIn: amountIn.toString(),
    minOut: minOut.toString(),
    quotedOut: expectedOut.toString(),
    wrappedWqie: wqieBalance.wrapped,
    wrapTxHash: wqieBalance.txHash,
    approvalTxHash: approvalHash
  };
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer available. Set DEPLOYER_PRIVATE_KEY for the selected Hardhat network.");
  }

  const deployment = loadDeployment();
  const recipient = requireAddress(
    "FUND_SIGNER_RECIPIENT, BACKEND_SIGNER_ADDRESS, or BACKEND_PRIVATE_KEY",
    process.env.FUND_SIGNER_RECIPIENT
      || process.env.BACKEND_SIGNER_ADDRESS
      || backendSignerAddress()
      || DEFAULT_RUNTIME_SIGNER
  );
  const qusdcAddress = requireAddress("QUSDC", deployment.addresses.qusdc);
  const wqieAddress = requireAddress("WQIE", deployment.addresses.wqie);
  const routerAddress = requireAddress("QIEDex Router", deployment.addresses.qiedexRouter);

  const backendWallet = process.env.BACKEND_PRIVATE_KEY
    ? new hre.ethers.Wallet(process.env.BACKEND_PRIVATE_KEY, hre.ethers.provider)
    : null;
  const recipientSigner = backendWallet && sameAddress(recipient, backendWallet.address)
    ? backendWallet
    : deployer;

  const qusdc = new hre.ethers.Contract(qusdcAddress, ERC20_ABI, deployer);
  const signerQusdc = qusdc.connect(recipientSigner);
  const wqie = new hre.ethers.Contract(wqieAddress, WQIE_ABI, recipientSigner);
  const router = new hre.ethers.Contract(routerAddress, ROUTER_ABI, recipientSigner);
  const decimals = await tokenDecimals(qusdc);
  const targetBalance = hre.ethers.parseUnits(process.env.FUND_SIGNER_QUSDC_AMOUNT || DEFAULT_MIN_BALANCE, decimals);
  const validationBalance = hre.ethers.parseUnits(MIN_VALIDATION_BALANCE, decimals);
  const before = BigInt(await qusdc.balanceOf(recipient));
  const requiredBalance = targetBalance > validationBalance ? targetBalance : validationBalance;

  console.log(`Backend signer: ${recipient}`);
  console.log(`QUSDC: ${qusdcAddress}`);
  console.log(`QIEDex router: ${routerAddress}`);
  console.log(`Initial QUSDC balance: ${hre.ethers.formatUnits(before, decimals)} QUSDC`);

  let funding = { funded: false, method: "none", reason: "already funded" };
  if (before < requiredBalance) {
    const missing = requiredBalance - before;
    const mintSupport = await detectMintSupport(qusdc, recipient);
    console.log(`QUSDC mint support: ${mintSupport.supported ? "supported" : "not supported"} (${mintSupport.reason})`);
    if (mintSupport.supported) {
      try {
        funding = await mintQusdc(qusdc, recipient, missing);
      } catch (error) {
        throw new Error(
          `QUSDC mint is supported but funding failed: ${error.shortMessage || error.reason || error.message || String(error)}`
        );
      }
    } else {
      console.log(`QUSDC mint unavailable, falling back to QIEDex swap: ${mintSupport.reason}`);
      if (!sameAddress(recipient, await recipientSigner.getAddress())) {
        throw new Error(
          `Swap fallback requires a signer for ${recipient}. Set BACKEND_PRIVATE_KEY for the backend signer or deploy a mintable QUSDC.`
        );
      }
      funding = await swapForQusdc({
        router,
        wqie,
        qusdc: signerQusdc,
        signer: recipientSigner,
        recipient,
        missingQusdc: missing
      });
    }
  }

  const after = BigInt(await qusdc.balanceOf(recipient));
  console.log(`Final QUSDC balance: ${hre.ethers.formatUnits(after, decimals)} QUSDC`);
  console.log(JSON.stringify({
    recipient,
    qusdc: qusdcAddress,
    finalBalanceWei: after.toString(),
    finalBalance: hre.ethers.formatUnits(after, decimals),
    requiredBalanceWei: requiredBalance.toString(),
    requiredBalance: hre.ethers.formatUnits(requiredBalance, decimals),
    funding
  }, null, 2));

  if (after < validationBalance) {
    throw new Error(
      `Backend signer QUSDC balance is below validation minimum. Required at least ${hre.ethers.formatUnits(validationBalance, decimals)} QUSDC, got ${hre.ethers.formatUnits(after, decimals)} QUSDC.`
    );
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.reason || error.message || String(error));
  console.error(error);
  process.exitCode = 1;
});
