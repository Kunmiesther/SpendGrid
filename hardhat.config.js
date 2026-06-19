require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const QIE_MAINNET_RPC_URL = process.env.QIE_RPC_URL || "https://rpc1mainnet.qie.digital/";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 1990
    },
    qieMainnet: {
      url: QIE_MAINNET_RPC_URL,
      chainId: 1990,
      accounts
    }
  }
};
