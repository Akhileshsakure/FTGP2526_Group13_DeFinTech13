// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.24;

interface IInterestRateStrategyLike {
    function getBorrowRate(
        uint256 cash,
        uint256 totalBorrows,
        uint256 totalReserves
    ) external view returns (uint256);
}

/**
 * @title AaveInterestRateStrategy
 * @notice Aave V3 style jump rate model (per second)
 *
 * Interest Rate Model:
 * utilization = totalBorrows / (cash + totalBorrows - totalReserves)
 *
 * When utilization <= optimalUsageRatio:
 *   borrowRate = baseVariableBorrowRate + utilization / optimalUsageRatio * variableRateSlope1
 *
 * When utilization > optimalUsageRatio:
 *   excessUtil = (utilization - optimalUsageRatio) / (1 - optimalUsageRatio)
 *   borrowRate = baseVariableBorrowRate + variableRateSlope1 + excessUtil * variableRateSlope2
 *
 * All parameters use 1e18 precision
 */
contract AaveInterestRateStrategy is IInterestRateStrategyLike {
    uint256 public constant WAD = 1e18;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    address public owner;

    // Annualized parameters (1e18 precision)
    uint256 public optimalUsageRatio;
    uint256 public baseVariableBorrowRate;
    uint256 public variableRateSlope1;
    uint256 public variableRateSlope2;

    event NewOwner(address indexed oldOwner, address indexed newOwner);
    event NewInterestParams(
        uint256 optimalUsageRatio,
        uint256 baseVariableBorrowRate,
        uint256 variableRateSlope1,
        uint256 variableRateSlope2
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(
        address owner_,
        uint256 optimalUsageRatio_,
        uint256 baseVariableBorrowRate_,
        uint256 variableRateSlope1_,
        uint256 variableRateSlope2_
    ) {
        require(owner_ != address(0), "bad owner");
        require(optimalUsageRatio_ <= WAD, "bad optimal usage");

        owner = owner_;
        optimalUsageRatio = optimalUsageRatio_;
        baseVariableBorrowRate = baseVariableBorrowRate_;
        variableRateSlope1 = variableRateSlope1_;
        variableRateSlope2 = variableRateSlope2_;

        emit NewInterestParams(
            optimalUsageRatio_,
            baseVariableBorrowRate_,
            variableRateSlope1_,
            variableRateSlope2_
        );
    }

    /*//////////////////////////////////////////////////////////////
                             ADMIN权限设置
    //////////////////////////////////////////////////////////////*/

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "bad owner");
        address oldOwner = owner;
        owner = newOwner;
        emit NewOwner(oldOwner, newOwner);
    }

    function setInterestParams(
        uint256 optimalUsageRatio_,
        uint256 baseVariableBorrowRate_,
        uint256 variableRateSlope1_,
        uint256 variableRateSlope2_
    ) external onlyOwner {
        require(optimalUsageRatio_ <= WAD, "bad optimal usage");

        optimalUsageRatio = optimalUsageRatio_;
        baseVariableBorrowRate = baseVariableBorrowRate_;
        variableRateSlope1 = variableRateSlope1_;
        variableRateSlope2 = variableRateSlope2_;

        emit NewInterestParams(
            optimalUsageRatio_,
            baseVariableBorrowRate_,
            variableRateSlope1_,
            variableRateSlope2_
        );
    }

    /*//////////////////////////////////////////////////////////////
                                VIEW HELPERS函数
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Current utilization rate, 1e18 precision
     * @dev Utilization = borrows / (cash + borrows - reserves)
     */
    function utilizationRate(
        uint256 cash,
        uint256 totalBorrows,
        uint256 totalReserves
    ) public pure returns (uint256) {
        if (totalBorrows == 0) {
            return 0;
        }

        uint256 denominator = cash + totalBorrows - totalReserves;
        if (denominator == 0) {
            return 0;
        }

        return (totalBorrows * WAD) / denominator;
    }

    function baseRatePerSecond() public view returns (uint256) {
        return baseVariableBorrowRate / SECONDS_PER_YEAR;
    }

    function slope1PerSecond() public view returns (uint256) {
        return variableRateSlope1 / SECONDS_PER_YEAR;
    }

    function slope2PerSecond() public view returns (uint256) {
        return variableRateSlope2 / SECONDS_PER_YEAR;
    }

    /**
     * @notice Returns current borrow rate per second (1e18 precision)
     */
    function getBorrowRate(
        uint256 cash,
        uint256 totalBorrows,
        uint256 totalReserves
    ) external view override returns (uint256) {
        uint256 util = utilizationRate(cash, totalBorrows, totalReserves);

        uint256 _baseRatePerSecond = baseRatePerSecond();
        uint256 _slope1PerSecond = slope1PerSecond();
        uint256 _slope2PerSecond = slope2PerSecond();

        if (util <= optimalUsageRatio) {
            // borrowRate = base + (util / optimalUsageRatio) * slope1
            uint256 currentSlope1 = optimalUsageRatio == 0 ? 0 : (util * _slope1PerSecond) / optimalUsageRatio;
            return _baseRatePerSecond + currentSlope1;
        }

        // normalRate = base + slope1
        uint256 normalRate = _baseRatePerSecond + _slope1PerSecond;
        uint256 excessUtil = util - optimalUsageRatio;
        uint256 excessDenominator = WAD - optimalUsageRatio;

        // excessUtilRatio = excessUtil / (1 - optimalUsageRatio)
        uint256 excessUtilRatio = excessDenominator == 0 ? 0 : (excessUtil * WAD) / excessDenominator;

        return normalRate + (excessUtilRatio * _slope2PerSecond) / WAD;
    }
}
