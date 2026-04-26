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
 * @title JumpRateInterestStrategy
 * Code comment
 *
 * Interest Rate Model:
 *
 * utilization = totalBorrows / (cash + totalBorrows - totalReserves)
 *
 * When utilization <= kink:
 *   borrowRate = baseRatePerSecond + utilization * multiplierPerSecond
 *
 * When utilization > kink:
 *   normalRate = baseRatePerSecond + kink * multiplierPerSecond
 *   excessUtil = utilization - kink
 *   borrowRate = normalRate + excessUtil * jumpMultiplierPerSecond
 *
 * All parameters use 1e18 precision
 */
contract JumpRateInterestStrategy is IInterestRateStrategyLike {
    uint256 public constant WAD = 1e18;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    address public owner;

    // Annualized parameters (1e18 precision)
    uint256 public baseRatePerYear;
    uint256 public multiplierPerYear;
    uint256 public jumpMultiplierPerYear;
    uint256 public kink;

    event NewOwner(address indexed oldOwner, address indexed newOwner);
    event NewInterestParams(
        uint256 baseRatePerYear,
        uint256 multiplierPerYear,
        uint256 jumpMultiplierPerYear,
        uint256 kink
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(
        address owner_,
        uint256 baseRatePerYear_,
        uint256 multiplierPerYear_,
        uint256 jumpMultiplierPerYear_,
        uint256 kink_
    ) {
        require(owner_ != address(0), "bad owner");
        require(kink_ <= WAD, "bad kink");

        owner = owner_;
        baseRatePerYear = baseRatePerYear_;
        multiplierPerYear = multiplierPerYear_;
        jumpMultiplierPerYear = jumpMultiplierPerYear_;
        kink = kink_;

        emit NewInterestParams(
            baseRatePerYear_,
            multiplierPerYear_,
            jumpMultiplierPerYear_,
            kink_
        );
    }

    /*//////////////////////////////////////////////////////////////
                               OWNER SETTERS
    //////////////////////////////////////////////////////////////*/

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "bad owner");
        address oldOwner = owner;
        owner = newOwner;
        emit NewOwner(oldOwner, newOwner);
    }

    function setInterestParams(
        uint256 baseRatePerYear_,
        uint256 multiplierPerYear_,
        uint256 jumpMultiplierPerYear_,
        uint256 kink_
    ) external onlyOwner {
        require(kink_ <= WAD, "bad kink");

        baseRatePerYear = baseRatePerYear_;
        multiplierPerYear = multiplierPerYear_;
        jumpMultiplierPerYear = jumpMultiplierPerYear_;
        kink = kink_;

        emit NewInterestParams(
            baseRatePerYear_,
            multiplierPerYear_,
            jumpMultiplierPerYear_,
            kink_
        );
    }

    /*//////////////////////////////////////////////////////////////
                               VIEW HELPERS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Current utilization rate, 1e18 precision
     * @dev utilization = borrows / (cash + borrows - reserves)
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
        return baseRatePerYear / SECONDS_PER_YEAR;
    }

    function multiplierPerSecond() public view returns (uint256) {
        return multiplierPerYear / SECONDS_PER_YEAR;
    }

    function jumpMultiplierPerSecond() public view returns (uint256) {
        return jumpMultiplierPerYear / SECONDS_PER_YEAR;
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
        uint256 _multiplierPerSecond = multiplierPerSecond();
        uint256 _jumpMultiplierPerSecond = jumpMultiplierPerSecond();

        if (util <= kink) {
            // base + util * multiplier
            return _baseRatePerSecond + (util * _multiplierPerSecond) / WAD;
        }

        // normalRate = base + kink * multiplier
        uint256 normalRate = _baseRatePerSecond + (kink * _multiplierPerSecond) / WAD;
        uint256 excessUtil = util - kink;

        return normalRate + (excessUtil * _jumpMultiplierPerSecond) / WAD;
    }
}