const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  if (!signer) {
    throw new Error("No signer available");
  }

  const address = await signer.getAddress();
  const balanceWei = await hre.ethers.provider.getBalance(address);
  console.log(JSON.stringify({
    address,
    balanceWei: balanceWei.toString(),
    balanceQie: hre.ethers.formatEther(balanceWei)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
