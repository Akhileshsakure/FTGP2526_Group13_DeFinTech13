// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockPriceOracle {
    mapping(address => uint256) public prices;

    function setUnderlyingPrice(address cToken, uint256 price) external {
        prices[cToken] = price;
    }

    function getUnderlyingPrice(address cToken) external view returns (uint256) {
        return prices[cToken];
    }
}