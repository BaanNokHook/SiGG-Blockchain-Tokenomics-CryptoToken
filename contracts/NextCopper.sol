//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import { ICopperOracle } from "./CopperOracle.sol";

contract NextCopper is ERC20, Ownable, ReentrancyGuard {
    // state
    uint8 public constant decimal = 12;

    uint256 public constant blockProducePerYear = 6311385; //Number of blocks producec per year
    uint256 public constant blockInterval = 50; //500_000;
    uint256 public constant blockRewardDecimal = 100; //0.01 Must divide

    uint256 public constant DAMPLING_DELTAQ_PERCENT = 30; //0.3%
    uint256 public constant PERCENT_BASE = 10000;

    uint256 public blockRewards = 0; // Need to defined
    
    uint256 public q1 = 200_000_000000000000; //200K
    uint256 public p1 = 1_410000000000; //1.41 meaning SDR

    uint256 public maxSupply = 100_000_000 * (10 ** decimal);
    
    uint256 private startBlock;
    mapping(uint256 => bool) private  isRebased;

    ICopperOracle oracleContract;

    
    // structure

    // modifier

    // event
    event OracleDataRequested(
        uint256 indexed blockHeight
    );

    event IntervalActivated(
        uint256 indexed blockHeight,
        uint256 PRE_REBASE,
        uint256 PRE_RPB,
        uint256 REBASE,
        uint256 RPB
    );

    // enumeration

    // function    
    constructor(address _oracleContract) ERC20("NextCopper","NCT") {
        oracleContract = ICopperOracle(_oracleContract);

        uint256 initialSupply = 7_000_000 * 10 ** decimal;
        blockRewards = initialSupply / blockProducePerYear / blockRewardDecimal;

        startBlock = block.number;
        isRebased[0] = true;

        _mint(owner(), initialSupply);
    }

    /**@dev make decimal 9 for mathmatic calculation */
    function decimals() public view virtual override returns (uint8) {
        return decimal; 
    }

    /** @dev Update Oracle contract address */
    function setOracleContract(address _oracleContract) external onlyOwner {
        oracleContract = ICopperOracle(_oracleContract);
    }

    /** @dev get current block height index */
    function getBlockheightIndex() public view returns (uint256) {
        return (block.number - startBlock) / blockInterval;
    }

    /**
     * @dev return if need rebase. Called by outside dApp
     */
    function needRebase() external view returns (bool) {
        return !isRebased[getBlockheightIndex()];
    }

    /** 
     * @dev check whether oracle data is ready. 
     * Called by dApp
     */
    function isRebaseReady() external view returns (bool) {
        (uint256 blockHeightIndex, , ) = oracleContract.getCopperData();
        return blockHeightIndex == getBlockheightIndex();
    }

    /** 
     * @dev requestOracleData.
     * Called by dApp.
     */
    function needRequestOracle() external view returns (bool) {
        return oracleContract.canRequestData(getBlockheightIndex());
    }

    /**
     * @dev requestOracleData
     */
    function requestOracleData() external {
        uint256 blockHeightIndex = getBlockheightIndex();
        oracleContract.requestCopperData(blockHeightIndex);

        emit OracleDataRequested(blockHeightIndex * blockInterval);
    }

    /** @dev Called on interval. every 500 blocks */
    function rebase() public onlyOwner nonReentrant {
        uint256 curBlockHeightIndex = getBlockheightIndex();
        require(!isRebased[curBlockHeightIndex], "Already rebased");

        (
            uint256 blockHeightIndex,
            uint256 purches, 
            uint256 sdr //p2
        ) = oracleContract.getCopperData();

        require(curBlockHeightIndex == blockHeightIndex, "Oracle invalid data");
        
        isRebased[blockHeightIndex] = true;

        // uint256 churn = purches / 10; //10%
        uint256 q2 = purches - purches / 10; // - churn;

        //meaning delta SDR in PES calculation Formula
        uint256 deltaP = sdr > p1 ? (sdr - p1) : (p1 - sdr);
        deltaP = (10 ** decimal) * deltaP * 200 / (p1 + sdr) ;

        uint256 deltaQ = q2 > q1 ? (q2 - q1) : (q1 - q2);
        deltaQ = (10 ** decimal) * deltaQ * 200 / (q2 + q1);
        deltaQ = deltaQ * DAMPLING_DELTAQ_PERCENT / PERCENT_BASE;

        //Keep values for emitting event
        uint256 preSupply = totalSupply();
        uint256 preRPB = blockRewards;

        if (deltaQ < deltaP || deltaP == 0) {
            // PES = deltaQ/deltaP : Meaning PES < 1
            _burn(owner(), q2 * 3 / 100);
            blockRewards = preRPB * 97 / 100;
        } else if (deltaQ > deltaP) {
            // meaning PES > 1
            uint256 newAmount = preSupply + q2 * 3 / 100;
            if (newAmount > maxSupply){
                newAmount = maxSupply;
            }
            _mint(owner(), newAmount - preSupply); //Add 3% supply
            blockRewards = preRPB * 103 / 100;
        }

        emit IntervalActivated(
            blockHeightIndex * blockInterval, 
            preSupply, 
            preRPB, 
            totalSupply(), 
            blockRewards);

        // Update values for next interval
        p1 = sdr;
        q1 = q2;
    }
}