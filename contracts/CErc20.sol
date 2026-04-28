// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./CTokenBase.sol";

interface IERC20NonStandard {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address dst, uint256 amount) external;
    function transferFrom(address src, address dst, uint256 amount) external;
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @title CErc20
 *
 */
contract CErc20 is CTokenBase {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;
    uint8 private immutable _underlyingDecimals;

    constructor(
        address admin_,
        IERC20 underlying_,
        string memory name_,
        string memory symbol_,
        IComptrollerLike comptroller_,
        IInterestRateStrategyLike interestRateStrategy_,
        uint256 initialExchangeRateMantissa_,
        uint256 reserveFactorMantissa_,
        uint256 borrowRateMaxMantissa_
    )
        CTokenBase(
            admin_,
            name_,
            symbol_,
            comptroller_,
            interestRateStrategy_,
            initialExchangeRateMantissa_,
            reserveFactorMantissa_,
            borrowRateMaxMantissa_
        )
    {
        require(address(underlying_) != address(0), "bad underlying");
        underlying = underlying_;
        _underlyingDecimals = IERC20Metadata(address(underlying_)).decimals();
    }
function decimals() public view override returns (uint8) {
        return _underlyingDecimals;
    }
function getCashPrior() public view override returns (uint256) {
        return underlying.balanceOf(address(this));
    }
function doTransferIn(address from, uint256 amount) internal override returns (uint256) {
        require(msg.value == 0, "msg.value not allowed");

        uint256 balanceBefore = underlying.balanceOf(address(this));
        underlying.safeTransferFrom(from, address(this), amount);
        uint256 balanceAfter = underlying.balanceOf(address(this));

        require(balanceAfter >= balanceBefore, "balance overflow");
        return balanceAfter - balanceBefore;
    }
function doTransferOut(address payable to, uint256 amount) internal override {
        require(msg.value == 0, "msg.value not allowed");
        underlying.safeTransfer(to, amount);
    }
}