const path = require("path");
const dotenv = require("dotenv");

const ENV_PATH = path.join(__dirname, "..", "..", ".env");
let loaded = false;

function loadEnv() {
  if (loaded) {
    return ENV_PATH;
  }

  dotenv.config({ path: ENV_PATH });
  if (!process.env.QUSDC_ADDRESS && process.env.QIE_STABLECOIN_ADDRESS) {
    process.env.QUSDC_ADDRESS = process.env.QIE_STABLECOIN_ADDRESS;
  }
  loaded = true;
  return ENV_PATH;
}

module.exports = {
  ENV_PATH,
  loadEnv
};
