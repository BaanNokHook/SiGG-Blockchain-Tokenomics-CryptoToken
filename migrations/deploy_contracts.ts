type Network = "development" | "kovan" | "mainnet";

module.exports = (artifacts: Truffle.Artifacts, web3: Web3) => {
  return async (
    deployer: Truffle.Deployer,
    network: Network,
    accounts: string[]
  ) => {
    const CopperOracle = artifacts.require("CopperOracle");
    const NextCopper = artifacts.require("NextCopper");

    await deployer.deploy(CopperOracle);
    const oracleContract = await CopperOracle.deployed();

    await deployer.deploy(NextCopper, oracleContract.address);
    const copperContract = await NextCopper.deployed();

    process.env.NETWORK = network;
    console.log(
      `CopperOracle deployed at ${oracleContract.address} in network: ${network}.`
    );
    console.log(
      `NextCopper deployed at ${copperContract.address} in network: ${network}.`
    );
  };
};
