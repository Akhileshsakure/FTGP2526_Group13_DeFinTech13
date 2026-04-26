// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockPriceOracle
 * Code comment
 */
contract MockPriceOracle {
    // Price record struct
    struct PriceRecord {
        uint256 price;     // price
        uint256 timestamp; // timestamp
    }

    // Code comment
    mapping(address => uint256) public prices;
    
    // Code comment
    mapping(address => PriceRecord[]) public priceHistory;

    // Code comment
    event PriceUpdated(address indexed cToken, uint256 newPrice, uint256 timestamp);

    /**
     * Code comment
     * @param cToken market token address
     * Code comment
     */
    function setUnderlyingPrice(address cToken, uint256 price) external {
        prices[cToken] = price;
        priceHistory[cToken].push(PriceRecord({
            price: price,
            timestamp: block.timestamp
        }));
        emit PriceUpdated(cToken, price, block.timestamp);
    }

    /**
     * Code comment
     * @param cToken market token address
     */
    function getUnderlyingPrice(address cToken) external view returns (uint256) {
        return prices[cToken];
    }

    /**
     * Code comment
     * @param cToken market token address
     */
    function getPriceHistory(address cToken) external view returns (PriceRecord[] memory) {
        return priceHistory[cToken];
    }
}