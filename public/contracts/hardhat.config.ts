import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

/**
 * Only hand Hardhat an account that is actually a key.
 *
 * `.env` ships with `DEPLOYER_PRIVATE_KEY=your_private_key_here` so nobody
 * commits a real one — but Hardhat validates every network's accounts while
 * LOADING the config, so that placeholder made `compile` and `test` fail too,
 * not just `deploy`. Compiling and testing need no key at all; gate on the
 * shape of the value so the whole toolchain works out of the box and only the
 * deploy step asks for a real key.
 */
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const accounts = /^(0x)?[0-9a-fA-F]{64}$/.test(deployerKey)
  ? [deployerKey.startsWith("0x") ? deployerKey : `0x${deployerKey}`]
  : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    amoy: {
      url: process.env.POLYGON_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts,
    },
    polygon: {
      url: "https://polygon-rpc.com",
      chainId: 137,
      accounts,
    },
    hardhat: {
      chainId: 31337,
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  etherscan: {
    apiKey: process.env.POLYGONSCAN_API_KEY || "",
  },
};

export default config;
