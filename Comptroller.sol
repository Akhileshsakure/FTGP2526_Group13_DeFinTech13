// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.24;

interface ICTokenLike {
    function getAccountSnapshot(address account)
        external
        view
        returns (
            uint256 error,
            uint256 cTokenBalance,
            uint256 borrowBalance,
            uint256 exchangeRateMantissa
        );

    function balanceOf(address owner) external view returns (uint256);
    function borrowBalanceStored(address account) external view returns (uint256);
    function exchangeRateStored() external view returns (uint256);
}

interface IPriceOracle {
    /**
     * @notice Returns the price of the underlying asset for the given cToken, scaled by 1e18
     * @dev For example, if the underlying is ETH, price = 3000e18 (denominated in USD)
     */
    function getUnderlyingPrice(address cToken) external view returns (uint256);
}

/**
 * @title Comptroller
 * @notice Unified liquidity controller for multiple markets
 *
 * Responsibilities:
 * - Manage market listings
 * - Manage which collateral markets a user has entered
 * - Calculate account liquidity / shortfall across markets
 * - Provide allow / verify risk-control hooks for each CToken
 * - Provide seize amount calculations for liquidations
 *
 * Not responsible for:
 * - Asset transfers
 * - Interest accrual
 * - Liquidation execution
 * - Leverage routing execution
 */
contract Comptroller {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    uint256 public constant WAD = 1e18;
    uint256 public constant NO_ERROR = 0;

    // Error codes (can be refactored into an enum later)
    uint256 public constant MARKET_NOT_LISTED = 1;
    uint256 public constant MARKET_ALREADY_LISTED = 2;
    uint256 public constant INSUFFICIENT_LIQUIDITY = 3;
    uint256 public constant INSUFFICIENT_SHORTFALL = 4;
    uint256 public constant PRICE_ERROR = 5;
    uint256 public constant INVALID_COLLATERAL_FACTOR = 6;
    uint256 public constant ACCOUNT_NOT_ENTERED_MARKET = 7;
    uint256 public constant NONZERO_BORROW_BALANCE = 8;
    uint256 public constant EXIT_MARKET_REJECTED = 9;

    /*//////////////////////////////////////////////////////////////
                                  ADMIN
    //////////////////////////////////////////////////////////////*/

    address public admin;
    address public pendingAdmin;

    modifier onlyAdmin() {
        require(msg.sender == admin, "only admin");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                               MARKET STORAGE
    //////////////////////////////////////////////////////////////*/

    struct Market {
        bool isListed;
        uint256 collateralFactorMantissa; // 1e18
    }

    struct LiquidityParams {
        address cTokenModify;
        uint256 redeemTokens;
        uint256 borrowAmount;
    }

    // cToken => market config
    mapping(address => Market) public markets;

    // Whether a user has entered a market as collateral
    mapping(address => mapping(address => bool)) public accountMembership;

    // All markets entered by a user
    mapping(address => address[]) public accountAssets;

    // All listed markets
    address[] public allMarkets;

    // Global price oracle
    IPriceOracle public oracle;

    // Close factor: maximum portion of debt that can be repaid in a single liquidation
    uint256 public closeFactorMantissa;

    // Liquidation incentive, e.g. 1.08e18
    uint256 public liquidationIncentiveMantissa;

    // Approved leverage routers
    mapping(address => bool) public approvedRouters;
    /*//////////////////////////////////////////////////////////////
                                  EVENTS
    //////////////////////////////////////////////////////////////*/

    event NewPendingAdmin(address oldPendingAdmin, address newPendingAdmin);
    event NewAdmin(address oldAdmin, address newAdmin);

    event MarketListed(address cToken);
    event MarketEntered(address cToken, address account);
    event MarketExited(address cToken, address account);

    event NewPriceOracle(address oldOracle, address newOracle);
    event NewCollateralFactor(address cToken, uint256 oldCollateralFactor, uint256 newCollateralFactor);
    event NewCloseFactor(uint256 oldCloseFactorMantissa, uint256 newCloseFactorMantissa);
    event NewLiquidationIncentive(uint256 oldLiquidationIncentiveMantissa, uint256 newLiquidationIncentiveMantissa);
    event RouterUpdated(address indexed router, bool approved);
    /*//////////////////////////////////////////////////////////////
                               CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        address admin_,
        IPriceOracle oracle_,
        uint256 closeFactorMantissa_,
        uint256 liquidationIncentiveMantissa_
    ) {
        require(admin_ != address(0), "bad admin");
        require(address(oracle_) != address(0), "bad oracle");
        require(closeFactorMantissa_ <= WAD, "bad close factor");
        require(liquidationIncentiveMantissa_ >= WAD, "bad liq incentive");

        admin = admin_;
        oracle = oracle_;
        closeFactorMantissa = closeFactorMantissa_;
        liquidationIncentiveMantissa = liquidationIncentiveMantissa_;
    }

    /*//////////////////////////////////////////////////////////////
                              ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _setPendingAdmin(address newPendingAdmin) external onlyAdmin returns (uint256) {
        address oldPendingAdmin = pendingAdmin;
        pendingAdmin = newPendingAdmin;

        emit NewPendingAdmin(oldPendingAdmin, newPendingAdmin);
        return NO_ERROR;
    }

    function _acceptAdmin() external returns (uint256) {
        require(msg.sender == pendingAdmin && msg.sender != address(0), "not pending admin");

        address oldAdmin = admin;
        address oldPendingAdmin = pendingAdmin;

        admin = pendingAdmin;
        pendingAdmin = address(0);

        emit NewAdmin(oldAdmin, admin);
        emit NewPendingAdmin(oldPendingAdmin, address(0));

        return NO_ERROR;
    }

    function _setPriceOracle(IPriceOracle newOracle) external onlyAdmin returns (uint256) {
        require(address(newOracle) != address(0), "bad oracle");
        address oldOracle = address(oracle);
        oracle = newOracle;

        emit NewPriceOracle(oldOracle, address(newOracle));
        return NO_ERROR;
    }

    function _supportMarket(address cToken, uint256 collateralFactorMantissa) external onlyAdmin returns (uint256) {
        require(cToken != address(0), "bad market");
        require(!markets[cToken].isListed, "already listed");
        require(collateralFactorMantissa <= WAD, "bad collateral factor");

        // Require the oracle to provide a valid price before listing the market
        uint256 price = oracle.getUnderlyingPrice(cToken);
        require(price > 0, "price not available");

        markets[cToken] = Market({
            isListed: true,
            collateralFactorMantissa: collateralFactorMantissa
        });

        allMarkets.push(cToken);

        emit MarketListed(cToken);
        emit NewCollateralFactor(cToken, 0, collateralFactorMantissa);

        return NO_ERROR;
    }

    function _setCollateralFactor(address cToken, uint256 newCollateralFactorMantissa)
        external
        onlyAdmin
        returns (uint256)
    {
        require(markets[cToken].isListed, "market not listed");
        require(newCollateralFactorMantissa <= WAD, "bad collateral factor");
        require(oracle.getUnderlyingPrice(cToken) > 0, "price not available");

        uint256 oldCollateralFactor = markets[cToken].collateralFactorMantissa;
        markets[cToken].collateralFactorMantissa = newCollateralFactorMantissa;

        emit NewCollateralFactor(cToken, oldCollateralFactor, newCollateralFactorMantissa);
        return NO_ERROR;
    }

    function _setCloseFactor(uint256 newCloseFactorMantissa) external onlyAdmin returns (uint256) {
        require(newCloseFactorMantissa <= WAD, "bad close factor");

        uint256 oldCloseFactor = closeFactorMantissa;
        closeFactorMantissa = newCloseFactorMantissa;

        emit NewCloseFactor(oldCloseFactor, newCloseFactorMantissa);
        return NO_ERROR;
    }

    function _setLiquidationIncentive(uint256 newLiquidationIncentiveMantissa)
        external
        onlyAdmin
        returns (uint256)
    {
        require(newLiquidationIncentiveMantissa >= WAD, "bad liq incentive");

        uint256 old = liquidationIncentiveMantissa;
        liquidationIncentiveMantissa = newLiquidationIncentiveMantissa;

        emit NewLiquidationIncentive(old, newLiquidationIncentiveMantissa);
        return NO_ERROR;
    }
    function setRouter(address router, bool approved) external onlyAdmin returns (uint256) {
        require(router != address(0), "bad router");
        approvedRouters[router] = approved;
        emit RouterUpdated(router, approved);
        return NO_ERROR;
    }

    function enterMarketsFor(address account, address[] calldata cTokens)
        external
        returns (uint256[] memory results)
    {
        require(approvedRouters[msg.sender], "not approved router");
        require(account != address(0), "bad account");

        uint256 len = cTokens.length;
        results = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            results[i] = _addToMarketInternal(cTokens[i], account);
        }
    }
    /*//////////////////////////////////////////////////////////////
                           MARKET MEMBERSHIP
    //////////////////////////////////////////////////////////////*/

    function getAllMarkets() external view returns (address[] memory) {
        return allMarkets;
    }

    function getAssetsIn(address account) external view returns (address[] memory) {
        return accountAssets[account];
    }

    function checkMembership(address account, address cToken) external view returns (bool) {
        return accountMembership[account][cToken];
    }

    function enterMarkets(address[] calldata cTokens) external returns (uint256[] memory results) {
        uint256 len = cTokens.length;
        results = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            results[i] = _addToMarketInternal(cTokens[i], msg.sender);
        }
    }

    function _addToMarketInternal(address cToken, address borrower) internal returns (uint256) {
        if (!markets[cToken].isListed) {
            return MARKET_NOT_LISTED;
        }

        if (accountMembership[borrower][cToken]) {
            return NO_ERROR;
        }

        accountMembership[borrower][cToken] = true;
        accountAssets[borrower].push(cToken);

        emit MarketEntered(cToken, borrower);
        return NO_ERROR;
    }

    function exitMarket(address cToken) external returns (uint256) {
        if (!markets[cToken].isListed) {
            return MARKET_NOT_LISTED;
        }

        if (!accountMembership[msg.sender][cToken]) {
            return NO_ERROR;
        }

        // Cannot exit while there is still an outstanding borrow in this market
        uint256 borrowBalance = ICTokenLike(cToken).borrowBalanceStored(msg.sender);
        if (borrowBalance > 0) {
            return NONZERO_BORROW_BALANCE;
        }

        // Simulate whether the account remains healthy after removing all cTokens of this market from collateral
        uint256 cTokenBalance = ICTokenLike(cToken).balanceOf(msg.sender);
        (uint256 err, , uint256 shortfall) = getHypotheticalAccountLiquidity(
            msg.sender,
            cToken,
            cTokenBalance,
            0
        );

        if (err != NO_ERROR) {
            return err;
        }

        if (shortfall > 0) {
            return EXIT_MARKET_REJECTED;
        }

        // Remove membership
        accountMembership[msg.sender][cToken] = false;

        address[] storage assets = accountAssets[msg.sender];
        uint256 len = assets.length;
        for (uint256 i = 0; i < len; i++) {
            if (assets[i] == cToken) {
                assets[i] = assets[len - 1];
                assets.pop();
                break;
            }
        }

        emit MarketExited(cToken, msg.sender);
        return NO_ERROR;
    }

    /*//////////////////////////////////////////////////////////////
                              ALLOWED HOOKS
    //////////////////////////////////////////////////////////////*/

    function mintAllowed(address cToken, address, uint256) external view returns (uint256) {
        if (!markets[cToken].isListed) return MARKET_NOT_LISTED;
        return NO_ERROR;
    }

    function redeemAllowed(address cToken, address redeemer, uint256 redeemTokens) external view returns (uint256) {
        if (!markets[cToken].isListed) return MARKET_NOT_LISTED;

        // If the market is not being used as collateral, redemption is always allowed
        if (!accountMembership[redeemer][cToken]) {
            return NO_ERROR;
        }

        (uint256 err, , uint256 shortfall) = getHypotheticalAccountLiquidity(
            redeemer,
            cToken,
            redeemTokens,
            0
        );

        if (err != NO_ERROR) return err;
        if (shortfall > 0) return INSUFFICIENT_LIQUIDITY;

        return NO_ERROR;
    }

    function borrowAllowed(address cToken, address borrower, uint256 borrowAmount) external returns (uint256) {
        if (!markets[cToken].isListed) return MARKET_NOT_LISTED;

        // If the user has not entered this borrow market yet, automatically add membership
        // Note: this does not mean the borrow market itself is used as collateral;
        // it only records that the user has interacted with the market, similar to Compound
        if (!accountMembership[borrower][cToken]) {
            uint256 addErr = _addToMarketInternal(cToken, borrower);
            if (addErr != NO_ERROR) return addErr;
        }

        (uint256 err, uint256 liquidity, uint256 shortfall) = getHypotheticalAccountLiquidity(
            borrower,
            cToken,
            0,
            borrowAmount
        );

        if (err != NO_ERROR) return err;
        if (shortfall > 0 || liquidity == 0) return INSUFFICIENT_LIQUIDITY;

        return NO_ERROR;
    }

    function repayBorrowAllowed(address cToken, address, address, uint256) external view returns (uint256) {
        if (!markets[cToken].isListed) return MARKET_NOT_LISTED;
        return NO_ERROR;
    }

    function liquidateBorrowAllowed(
        address cTokenBorrowed,
        address cTokenCollateral,
        address,
        address borrower,
        uint256 repayAmount
    ) external view returns (uint256) {
        if (!markets[cTokenBorrowed].isListed || !markets[cTokenCollateral].isListed) {
            return MARKET_NOT_LISTED;
        }

        (, uint256 liquidity, uint256 shortfall) = getAccountLiquidity(borrower);
        if (shortfall == 0 || liquidity > 0) {
            return INSUFFICIENT_SHORTFALL;
        }

        uint256 borrowBalance = ICTokenLike(cTokenBorrowed).borrowBalanceStored(borrower);
        uint256 maxClose = (borrowBalance * closeFactorMantissa) / WAD;
        if (repayAmount > maxClose) {
            return INSUFFICIENT_LIQUIDITY;
        }

        return NO_ERROR;
    }

    function seizeAllowed(
        address cTokenCollateral,
        address cTokenBorrowed,
        address,
        address,
        uint256
    ) external view returns (uint256) {
        if (!markets[cTokenCollateral].isListed || !markets[cTokenBorrowed].isListed) {
            return MARKET_NOT_LISTED;
        }
        return NO_ERROR;
    }

    /*//////////////////////////////////////////////////////////////
                           VERIFY HOOKS (OPTIONAL)
    //////////////////////////////////////////////////////////////*/

    function redeemVerify(address, address, uint256, uint256) external pure {}

    /*//////////////////////////////////////////////////////////////
                           LIQUIDITY CALCULATION
    //////////////////////////////////////////////////////////////*/

    function getAccountLiquidity(address account)
        public
        view
        returns (
            uint256 error,
            uint256 liquidity,
            uint256 shortfall
        )
    {
        return getHypotheticalAccountLiquidity(account, address(0), 0, 0);
    }

    /**
     * @notice Simulates account liquidity after redeeming `redeemTokens` cTokens from a market
     *         and additionally borrowing `borrowAmount`
     */
    function getHypotheticalAccountLiquidity(
        address account,
        address cTokenModify,
        uint256 redeemTokens,
        uint256 borrowAmount
    )
        public
        view
        returns (
            uint256 error,
            uint256 liquidity,
            uint256 shortfall
        )
    {
        uint256 sumCollateral;
        uint256 sumBorrowPlusEffects;

        LiquidityParams memory params = LiquidityParams({
            cTokenModify: cTokenModify,
            redeemTokens: redeemTokens,
            borrowAmount: borrowAmount
        });

        address[] storage assets = accountAssets[account];

        for (uint256 i = 0; i < assets.length; i++) {
            (uint256 err, uint256 collateralContribution, uint256 borrowContribution) =
                _getLiquidityContribution(account, assets[i], params);

            if (err != NO_ERROR) {
                return (err, 0, 0);
            }

            sumCollateral += collateralContribution;
            sumBorrowPlusEffects += borrowContribution;
        }

        if (sumCollateral > sumBorrowPlusEffects) {
            return (NO_ERROR, sumCollateral - sumBorrowPlusEffects, 0);
        } else {
            return (NO_ERROR, 0, sumBorrowPlusEffects - sumCollateral);
        }
    }

    function _getLiquidityContribution(
        address account,
        address asset,
        LiquidityParams memory params
    )
        internal
        view
        returns (
            uint256 error,
            uint256 collateralContribution,
            uint256 borrowContribution
        )
    {
        Market memory market = markets[asset];
        if (!market.isListed) {
            return (MARKET_NOT_LISTED, 0, 0);
        }

        (
            uint256 oErr,
            uint256 cTokenBalance,
            uint256 borrowBalance,
            uint256 exchangeRateMantissa
        ) = ICTokenLike(asset).getAccountSnapshot(account);

        if (oErr != NO_ERROR) {
            return (oErr, 0, 0);
        }

        uint256 oraclePriceMantissa = oracle.getUnderlyingPrice(asset);
        if (oraclePriceMantissa == 0) {
            return (PRICE_ERROR, 0, 0);
        }

        uint256 tokensToUnderlying = (cTokenBalance * exchangeRateMantissa) / WAD;
        uint256 underlyingToValue = (tokensToUnderlying * oraclePriceMantissa) / WAD;
        collateralContribution = (underlyingToValue * market.collateralFactorMantissa) / WAD;

        borrowContribution = (borrowBalance * oraclePriceMantissa) / WAD;

        if (asset == params.cTokenModify) {
            if (params.redeemTokens > 0) {
                uint256 redeemUnderlying = (params.redeemTokens * exchangeRateMantissa) / WAD;
                uint256 redeemValue = (redeemUnderlying * oraclePriceMantissa) / WAD;
                uint256 redeemCollateralValue = (redeemValue * market.collateralFactorMantissa) / WAD;
                borrowContribution += redeemCollateralValue;
            }

            if (params.borrowAmount > 0) {
                uint256 borrowValueEffect = (params.borrowAmount * oraclePriceMantissa) / WAD;
                borrowContribution += borrowValueEffect;
            }
        }

        return (NO_ERROR, collateralContribution, borrowContribution);
    }

    /*//////////////////////////////////////////////////////////////
                         LIQUIDATION CALCULATION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Calculates how many cTokenCollateral tokens a liquidator should receive
     *         after repaying `actualRepayAmount`
     *
     * seizeAmount = actualRepayAmount * liquidationIncentive * priceBorrowed / priceCollateral
     * seizeTokens = seizeAmount / exchangeRateCollateral
     */
    function liquidateCalculateSeizeTokens(
        address cTokenBorrowed,
        address cTokenCollateral,
        uint256 actualRepayAmount
    ) external view returns (uint256 error, uint256 seizeTokens) {
        uint256 priceBorrowedMantissa = oracle.getUnderlyingPrice(cTokenBorrowed);
        uint256 priceCollateralMantissa = oracle.getUnderlyingPrice(cTokenCollateral);

        if (priceBorrowedMantissa == 0 || priceCollateralMantissa == 0) {
            return (PRICE_ERROR, 0);
        }

        uint256 exchangeRateMantissa = ICTokenLike(cTokenCollateral).exchangeRateStored();

        // seizeAmount in collateral underlying units:
        // repay * liqIncentive * priceBorrowed / priceCollateral
        uint256 numerator = (((actualRepayAmount * liquidationIncentiveMantissa) / WAD) * priceBorrowedMantissa);
        uint256 seizeAmount = numerator / priceCollateralMantissa;

        // seizeTokens = seizeAmount / exchangeRate
        seizeTokens = (seizeAmount * WAD) / exchangeRateMantissa;

        return (NO_ERROR, seizeTokens);
    }

    /*//////////////////////////////////////////////////////////////
                              VIEW HELPERS
    //////////////////////////////////////////////////////////////*/

    function isComptroller() external pure returns (bool) {
        return true;
    }
}