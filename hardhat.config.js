require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const QIE_RPC_URL = process.env.QIE_RPC_URL || "http://127.0.0.1:8545";
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
      chainId: 1983
    },
    qieTestnet: {
      url: QIE_RPC_URL,
      chainId: 1983,
      accounts
    }
  }
};
