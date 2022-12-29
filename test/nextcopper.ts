const CopperOracle = artifacts.require("CopperOracle");
const NextCopper = artifacts.require("NextCopper");
const fetch = require("node-fetch");
const truffleAssert = require("truffle-assertions");

import {
  CopperOracleInstance,
  NextCopperInstance,
} from "../types/truffle-contracts";

contract("NextCopper", (accounts) => {
  const decimal = 12; //Must be the same as decimal of Both contracts;
  const blockInterval = 50; //Fake Interval for test. OrgValue = 500K
  let testOnFVM = false;

  const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

  const evmIncreaseBlock = async (blockNumber: number) => {
    if (testOnFVM) {
      await fetch(
        "http://guest:guest@127.0.0.1:8545",
        getOptions("generatetoaddress", [
          blockNumber,
          "TSy3YBFebUV79oZ1ijAzEEj8ULoV6GZnEQ",
        ])
      );
      await sleep(blockNumber);
    } else {
      while (blockNumber > 0) {
        blockNumber--;
        await new Promise((resolve, reject) => {
          (<any>web3.currentProvider).send(
            {
              jsonrpc: "2.0",
              method: "evm_mine",
              id: new Date().getTime(),
            },
            async (err: any, result: any) => {
              if (err) {
                return reject(err);
              }
              const newBlockHash = (await web3.eth.getBlock("latest")).hash;

              return resolve(newBlockHash);
            }
          );
        });
      }
    }
  };

  const evmIncreaseTime = async (timeInSeconds: number) => {
    await new Promise((resolve, reject) => {
      (<any>web3.currentProvider).send(
        {
          jsonrpc: "2.0",
          method: "evm_increaseTime",
          params: [timeInSeconds],
          id: new Date().getTime(),
        },
        (err: any, result: unknown) => {
          if (err) {
            return reject(err);
          }
          return resolve(result);
        }
      );
    });

    await new Promise((resolve, reject) => {
      (<any>web3.currentProvider).send(
        {
          jsonrpc: "2.0",
          method: "evm_mine",
          id: new Date().getTime(),
        },
        async (err: any, result: any) => {
          if (err) {
            return reject(err);
          }
          const newBlockHash = (await web3.eth.getBlock("latest")).hash;

          return resolve(newBlockHash);
        }
      );
    });
  };

  const getOptions = (method: string, params: any[]) => {
    return {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: Date.now().toString(),
        jsonrpc: "2.0",
        method: method,
        params: params,
      }),
    };
  };

  const currentBlockNumber = async () => {
    const blockNumber = await web3.eth.getBlock("latest");
    console.log("Current Block : ", blockNumber.number);
    return blockNumber;
  };

  const numberWithCommas = (x: number | string) => {
    return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");
  };

  describe("Copper Contract test", function () {
    // requestPeriodLimit in CopperOracle contract
    // Increased block count in this time duration must be less
    // than BlockInterval in NextCopper contract
    const testRequestPeriodLimit = 1 * 60;
    // requestBlockLimit in CopperOracle contract.
    // must be less than BlockInterval in NextCopper contract
    const testRequestBlockLimit = 20;

    let oracleContract: CopperOracleInstance;
    let copperContract: NextCopperInstance;

    const blockHeightIndex = async () => {
      const curIndex = (await copperContract.getBlockheightIndex()).toNumber();
      console.log("BlockHeightIndex : ", curIndex);
      return curIndex;
    };

    beforeEach(async function () {
      oracleContract = await CopperOracle.new();
      copperContract = await NextCopper.new(oracleContract.address);
      await oracleContract.setCopperContractAddress(copperContract.address);
      testOnFVM = process.env.NETWORK === "fvm";

      // Setup Oracle for Test condition
      await oracleContract.setRequestBlockcountLimit(testRequestBlockLimit);
      await oracleContract.setRequestPeriodLimit(testRequestPeriodLimit);
    });

    it("needRebase()", async function () {
      expect(await copperContract.needRebase()).to.be.eq(false);
      await evmIncreaseBlock(blockInterval);
      expect(await copperContract.needRebase()).to.be.eq(true);
    });

    it("needRequestOracle()", async function () {
      if (!testOnFVM) {
        expect(await copperContract.needRebase()).to.be.eq(false);
        expect(await copperContract.needRequestOracle()).to.be.eq(false);

        await evmIncreaseBlock(blockInterval);
        let curIndex = await blockHeightIndex();
        expect(await copperContract.needRebase()).to.be.eq(true);
        expect(await copperContract.needRequestOracle()).to.be.eq(true);

        await copperContract.requestOracleData();
        expect(await copperContract.needRequestOracle()).to.be.eq(false);

        await evmIncreaseBlock(testRequestBlockLimit - 1);
        expect(await copperContract.needRequestOracle()).to.be.eq(false);

        await evmIncreaseBlock(1);
        expect(await copperContract.needRequestOracle()).to.be.eq(true);

        //After block limit, can request again.
        await copperContract.requestOracleData();
        expect(await copperContract.needRequestOracle()).to.be.eq(false);

        await evmIncreaseTime(testRequestPeriodLimit - 1);
        expect(await copperContract.needRequestOracle()).to.be.eq(false);

        //After time limit, can request again
        await evmIncreaseTime(1);
        expect(await copperContract.needRequestOracle()).to.be.eq(true);

        await oracleContract.setCopperData(curIndex, 100, 200);

        //After oracleData set, can't request for same index
        curIndex = await blockHeightIndex();
        expect(await copperContract.needRequestOracle()).to.be.eq(false);

        await evmIncreaseTime(testRequestPeriodLimit);
        expect(curIndex).to.be.eq(await blockHeightIndex());
        expect(await copperContract.needRequestOracle()).to.be.eq(false);

        await evmIncreaseBlock(testRequestBlockLimit);
        expect(curIndex).to.be.eq(await blockHeightIndex());
        expect(await copperContract.needRequestOracle()).to.be.eq(false);
      }
    });

    it("isRebaseReady()", async function () {
      // Pre-setting
      expect(await copperContract.needRebase()).to.be.eq(false);

      await evmIncreaseBlock(blockInterval);
      expect(await copperContract.needRebase()).to.be.eq(true);

      // Test isRebaseReady()
      expect(await copperContract.isRebaseReady()).to.be.eq(false);

      const curIndex = await blockHeightIndex();
      await copperContract.requestOracleData();
      expect(await copperContract.isRebaseReady()).to.be.eq(false);

      await oracleContract.setCopperData(curIndex, 100, 200);
      expect(await copperContract.isRebaseReady()).to.be.eq(true);
    });

    it("rebase()", async function () {
      await truffleAssert.fails(
        copperContract.rebase(),
        truffleAssert.ErrorType.REVERT,
        "Already rebased"
      );

      await evmIncreaseBlock(blockInterval);
      await truffleAssert.fails(
        copperContract.rebase(),
        truffleAssert.ErrorType.REVERT,
        "Oracle invalid data"
      );

      //400,000 * 10 ** 12
      const mockPurches = web3.utils.toBN("400000000000000000");
      // // 1.424 * 10 ** 12
      const mockSDR = web3.utils.toBN("1424000000000");

      const curIndex = await blockHeightIndex();
      await oracleContract.setCopperData(curIndex, mockPurches, mockSDR);

      expect(await copperContract.needRebase()).to.be.eq(true);
      await copperContract.rebase();
      expect(await copperContract.needRebase()).to.be.eq(false);
    });

    it("*** All Test ***", async function () {
      const purchesList = [
        "400000",
        "3600000",
        "12000000",
        "16000000",
        "8000000",
        "4100000",
        "17860000",
        "26790000",
        "43757000",
        "893000",
        "17100000",
        "34200000",
        "51300000",
        "25000000",
      ];
      //P2List
      const sdrList = [
        1424, 1424, 1426, 1427, 1424, 1423, 1424, 1425, 1422, 1420, 1417, 1423,
        1422, 1426,
      ];
      const sdrBase = 1000;

      const coEfficient = web3.utils.toBN(10 ** decimal);

      const result: any = {};
      for (let i = 0; i < purchesList.length; i++) {
        const purches = web3.utils.toBN(purchesList[i]).mul(coEfficient);
        const sdr = web3.utils.toBN(sdrList[i]).mul(coEfficient).divn(sdrBase);

        await evmIncreaseBlock(blockInterval);
        const curIndex = await blockHeightIndex();
        const currentBlock = await currentBlockNumber();
        await oracleContract.setCopperData(curIndex, purches, sdr);
        const copperData: any = await oracleContract.copperData();

        const q1 = await copperContract.q1();
        const q2 = copperData.purches.sub(copperData.purches.divn(10));
        const p1 = await copperContract.p1();

        const absDeltaP = sdr.gt(p1) ? sdr.sub(p1) : p1.sub(sdr);
        const deltaP = absDeltaP
          .mul(web3.utils.toBN(200 * 10 ** decimal))
          .div(p1.add(sdr));
        const absDeltaQ = q2.gt(q1) ? q2.sub(q1) : q1.sub(q2);
        const deltaQ = absDeltaQ
          .mul(web3.utils.toBN(200 * 10 ** decimal))
          .div(q2.add(q1))
          .mul(web3.utils.toBN(30))
          .div(web3.utils.toBN(10000));

        const pes =
          deltaP.toNumber() > 0 ? deltaQ.toNumber() / deltaP.toNumber() : 0;
        const preRebase = await copperContract.balanceOf(accounts[0]);
        const preRPB = await copperContract.blockRewards();

        result[currentBlock.number] = {
          purches: numberWithCommas(
            copperData.purches.div(web3.utils.toBN(10 ** decimal)).toNumber()
          ),
          Q1: numberWithCommas(
            q1.div(web3.utils.toBN(10 ** decimal)).toNumber()
          ),
          Q2: numberWithCommas(
            q2.div(web3.utils.toBN(10 ** decimal)).toNumber()
          ),
          P1: p1.toNumber() / 10 ** decimal,
          P2: sdr.toNumber() / 10 ** decimal,
          DELTA_P: deltaP.toNumber() / 10 ** decimal,
          DELTA_Q: deltaQ.toNumber() / 10 ** decimal,
          PES: pes,
          PRE_REBASE: numberWithCommas(
            preRebase.div(web3.utils.toBN(10 ** decimal)).toNumber()
          ),
        };
        await copperContract.rebase();
        const postRebase = await copperContract.balanceOf(accounts[0]);
        const absRebase = postRebase.gt(preRebase)
          ? postRebase.sub(preRebase)
          : preRebase.sub(postRebase);
        const reRPB = await copperContract.blockRewards();
        result[currentBlock.number].REBASE = numberWithCommas(
          postRebase.div(web3.utils.toBN(10 ** decimal)).toNumber()
        );
        result[currentBlock.number].Diff =
          absRebase
            .mul(web3.utils.toBN(10 ** decimal))
            .div(preRebase)
            .mul(web3.utils.toBN(100))
            .toNumber() /
          10 ** decimal;
        result[currentBlock.number].preRPB = preRPB.toNumber() / 10 ** decimal;
        result[currentBlock.number].reRPB = reRPB.toNumber() / 10 ** decimal;
      }
      console.table(result);
      const firstRound = Object.keys(result)[0];
      const lastRound = Object.keys(result)[13];

      expect(result[firstRound].purches).to.be.eq("400,000");
      expect(result[firstRound].Q1).to.be.eq("200,000");
      expect(result[firstRound].Q2).to.be.eq("360,000");
      expect(result[firstRound].P1).to.be.eq(1.41);
      expect(result[firstRound].P2).to.be.eq(1.424);
      expect(result[firstRound].DELTA_P).to.be.eq(0.988002822865);
      expect(result[firstRound].DELTA_Q).to.be.eq(0.171428571428);
      expect(result[firstRound].PES).to.be.eq(0.17351020408109086);
      expect(result[firstRound].PRE_REBASE).to.be.eq("7,000,000");
      expect(result[firstRound].REBASE).to.be.eq("6,989,200");
      expect(result[firstRound].Diff).to.be.eq(0.1542857142);
      expect(result[firstRound].preRPB).to.be.eq(0.011091067966);
      expect(result[firstRound].reRPB).to.be.eq(0.010758335927);

      expect(result[lastRound].purches).to.be.eq("25,000,000");
      expect(result[lastRound].Q1).to.be.eq("46,170,000");
      expect(result[lastRound].Q2).to.be.eq("22,500,000");
      expect(result[lastRound].P1).to.be.eq(1.422);
      expect(result[lastRound].P2).to.be.eq(1.426);
      expect(result[lastRound].DELTA_P).to.be.eq(0.280898876404);
      expect(result[lastRound].DELTA_Q).to.be.eq(0.206815203145);
      expect(result[lastRound].PES).to.be.eq(0.7362621231974958);
      expect(result[lastRound].PRE_REBASE).to.be.eq("8,514,322");
      expect(result[lastRound].REBASE).to.be.eq("7,839,322");
      expect(result[lastRound].Diff).to.be.eq(7.9278185626);
      expect(result[lastRound].preRPB).to.be.eq(0.012065069708);
      expect(result[lastRound].reRPB).to.be.eq(0.011703117616);
    });
  });
});
