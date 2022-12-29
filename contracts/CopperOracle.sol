//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ICopperOracle {
    function canRequestData(uint256 blockHeightIndex) external view returns(bool);

    function requestCopperData(uint256 blockHeightIndex) external;

    function getCopperData() external view returns(uint256, uint256, uint256);

}

contract CopperOracle is Ownable, ICopperOracle {

    /**
     * @dev current data
     */
    CopperData public copperData;

    /**
     * @dev Copeer contract address
     */
    address public copperContractAddress;

    /**
     * @dev decimal for Price value.
     * Must be the same as NextCopper decimal.
     */
    uint256 public constant decimal = 12;

    /**
     * @dev Time limit for one request. 
     * If request not done in this time duration,
     * can make another request
     */
    uint256 public requestPeriodLimit = 10 minutes;

    /**
     * @dev Block limit for one request.
     * If request not done in range of block numbers, can make another request
     */
    uint256 public requestBlockCountLimit = 500;

    /**
     * @dev Fee to request data
     */
    // uint256 public requestPrice = 0.1 ether;

    /**
     * @dev Current Request status.
     */
    RequestInfo internal requestInfo;

    /**
     * @dev Data from external.
     * purches & sdr values must be multipled by 10 ** decimal.
     */
    struct CopperData {
        uint256 blockHeightIndex;
        uint256 purches;
        uint256 sdr;
    }

    /**
     * @dev Request info
     */
    struct RequestInfo {
        uint256 blockHeightIndex;
        uint256 triggeredTime;
        uint256 triggeredBlock;
    }

    // Callback function
    event RequestCopperData(uint256 indexed blockHeightIndex);

    event CopperDataUpdated(uint256 indexed blockHeightIndex, uint256 purches, uint256 sdr);


    constructor() {}

    /**
     * @dev set CopperContractAddress
     * only CopperContract can request data
     */
    function setCopperContractAddress(address _copperContractAddress) public onlyOwner {
        copperContractAddress = _copperContractAddress;
    }

    /**
     * @dev Change RequestPrice. Owner can update this
     * @param _fee new price.
     */
    // function setRequestPrice(uint256 _fee) public onlyOwner {
    //     requestPrice = _fee;
    // }

    /**
     * @dev set requestPeriodLimit
     * @param _timePeriod time in seconds
     */
    function setRequestPeriodLimit(uint256 _timePeriod) public onlyOwner {
        requestPeriodLimit = _timePeriod;
    }

    /**
     * @dev set Block count limit for request
     * @param _blockCount number of blocks
     */
    function setRequestBlockcountLimit(uint256 _blockCount) public onlyOwner {
        requestBlockCountLimit = _blockCount;
    }

    function _canRequestData(uint256 blockHeightIndex) internal view returns(bool) {
        if (blockHeightIndex <= copperData.blockHeightIndex
            || blockHeightIndex < requestInfo.blockHeightIndex 
            || blockHeightIndex == 0){
            return false;
        } else if (blockHeightIndex == requestInfo.blockHeightIndex) {
            uint256 timeDuration = block.timestamp - requestInfo.triggeredTime;
            uint256 blockCount = block.number - requestInfo.triggeredBlock;
            return timeDuration >= requestPeriodLimit || blockCount >= requestBlockCountLimit;
        }
        return true;
    }

    /**
     * @dev return status whether request data to Oracle
     */
    function canRequestData(uint256 blockHeightIndex) external view override returns(bool) {
        return _canRequestData(blockHeightIndex);
    }

    /**
     * @dev request copper data to external. Called by NextCopper contract
     */
    function requestCopperData(uint256 blockHeightIndex) external override {
        require(msg.sender == copperContractAddress, "Invalid caller");
        require(_canRequestData(blockHeightIndex), "Request unavailable");

        requestInfo.blockHeightIndex = blockHeightIndex;
        requestInfo.triggeredBlock = block.number;
        requestInfo.triggeredTime = block.timestamp;

        emit RequestCopperData(blockHeightIndex);
    }

    /**
     * @dev called by external. 
     * External subscribes CallbackGetCopperData event. Pulls necessary data and call this function
     * to send back copperdata
     */
    function setCopperData(uint256 blockHeightIndex, uint256 purches, uint256 sdr) external onlyOwner {
        if (blockHeightIndex > copperData.blockHeightIndex) {
            copperData.blockHeightIndex = blockHeightIndex;
            copperData.purches = purches;
            copperData.sdr = sdr;
            emit CopperDataUpdated(blockHeightIndex, purches, sdr);
        }
    }

    /**
     * @dev called by NextCopper contract to get data.
     * @return (blockHeightIndex, purches, sdr)
     */
    function getCopperData() external view override returns(uint256, uint256, uint256) {
        return (copperData.blockHeightIndex, copperData.purches, copperData.sdr);
    }

    
}