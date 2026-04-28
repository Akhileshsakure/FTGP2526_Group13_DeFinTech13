// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

contract ChainlinkPriceOracle {
    uint256 public constant WAD = 1e18;

    address public owner;
    uint256 public maxStaleness;

    mapping(address => AggregatorV3Interface) public feeds;

    event OwnerTransferred(address indexed oldOwner, address indexed newOwner);
    event FeedUpdated(address indexed cToken, address indexed feed);
    event MaxStalenessUpdated(uint256 oldMaxStaleness, uint256 newMaxStaleness);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(address owner_, uint256 maxStaleness_) {
        require(owner_ != address(0), "bad owner");
        owner = owner_;
        maxStaleness = maxStaleness_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "bad owner");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnerTransferred(oldOwner, newOwner);
    }

    function setMaxStaleness(uint256 newMaxStaleness) external onlyOwner {
        uint256 oldMaxStaleness = maxStaleness;
        maxStaleness = newMaxStaleness;
        emit MaxStalenessUpdated(oldMaxStaleness, newMaxStaleness);
    }

    function setFeed(address cToken, AggregatorV3Interface feed) external onlyOwner {
        require(cToken != address(0), "bad market");
        require(address(feed) != address(0), "bad feed");
        feeds[cToken] = feed;
        emit FeedUpdated(cToken, address(feed));
    }

    function getUnderlyingPrice(address cToken) external view returns (uint256) {
        AggregatorV3Interface feed = feeds[cToken];
        require(address(feed) != address(0), "feed missing");

        (, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        require(answer > 0, "bad price");
        require(answeredInRound > 0, "incomplete round");
        require(updatedAt != 0, "stale price");
        if (maxStaleness > 0) {
            require(block.timestamp - updatedAt <= maxStaleness, "stale price");
        }

        uint8 feedDecimals = feed.decimals();
        uint256 price = uint256(answer);
        if (feedDecimals < 18) {
            return price * (10 ** (18 - feedDecimals));
        }
        if (feedDecimals > 18) {
            return price / (10 ** (feedDecimals - 18));
        }
        return price;
    }
}
