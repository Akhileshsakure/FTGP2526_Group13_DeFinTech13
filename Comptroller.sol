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
    function totalSupply() external view returns (uint256);
    function totalBorrows() external view returns (uint256);
}

interface IPriceOracle {
    /**
     * Code comment
     */
    function getUnderlyingPrice(address cToken) external view returns (uint256);
}

/**
 * @title Comptroller (Risk Manager)
 * @notice Aave-style multi-market liquidity and risk controller
 *
 * Code comment
 * Code comment
 * Code comment
 * Code comment
 * Code comment
 * Code comment
 * Code comment
 */
contract Comptroller {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    uint256 public constant WAD = 1e18;
    uint256 public constant NO_ERROR = 0;

    // Error codes
    uint256 public constant MARKET_NOT_LISTED = 1;
    uint256 public constant MARKET_ALREADY_LISTED = 2;
    uint256 public constant INSUFFICIENT_LIQUIDITY = 3;
    uint256 public constant INSUFFICIENT_SHORTFALL = 4;
    uint256 public constant PRICE_ERROR = 5;
    uint256 public constant INVALID_COLLATERAL_FACTOR = 6;
    uint256 public constant ACCOUNT_NOT_ENTERED_MARKET = 7;
    uint256 public constant NONZERO_BORROW_BALANCE = 8;
    uint256 public constant EXIT_MARKET_REJECTED = 9;
    uint256 public constant SUPPLY_CAP_EXCEEDED = 10;
    uint256 public constant BORROW_CAP_EXCEEDED = 11;

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
        bool isListed; // Whether listed
        uint256 ltvMantissa; // Max LTV
        uint256 liquidationThresholdMantissa; // Liquidation threshold
        uint256 liquidationBonusMantissa; // Liquidation bonus (e.g. 1.05e18 for 5%)
        uint256 supplyCap; // Supply cap
        uint256 borrowCap; // Borrow cap
    }

    struct LiquidityParams {
        address cTokenModify;
        uint256 redeemTokens;
        uint256 borrowAmount;
    }

    // cToken => Market config
    mapping(address => Market) public markets;

    // cToken => Is market paused
    mapping(address => bool) public isMarketPaused;

    // User market membership
    mapping(address => mapping(address => bool)) public accountMembership;

    // User entered markets
    mapping(address => address[]) public accountAssets;

    // All listed markets
    address[] public allMarkets;

    // Code comment
    IPriceOracle public oracle;

    // Close factor: max percentage of borrow that can be repaid in one liquidation
    uint256 public closeFactorMantissa;

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
    event MarketPaused(address cToken, bool isPaused);

    event NewPriceOracle(address oldOracle, address newOracle);
    event NewCloseFactor(uint256 oldCloseFactorMantissa, uint256 newCloseFactorMantissa);
    event RouterUpdated(address indexed router, bool approved);

    event MarketRiskParametersUpdated(
        address cToken, 
        uint256 ltv, 
        uint256 liquidationThreshold, 
        uint256 liquidationBonus
    );

    event MarketCapsUpdated(
        address cToken,
        uint256 supplyCap,
        uint256 borrowCap
    );

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        address admin_,
        IPriceOracle oracle_,
        uint256 closeFactorMantissa_
    ) {
        require(admin_ != address(0), "bad admin");
        require(address(oracle_) != address(0), "bad oracle");
        require(closeFactorMantissa_ <= WAD, "bad close factor");

        admin = admin_;
        oracle = oracle_;
        closeFactorMantissa = closeFactorMantissa_;
    }

    /*//////////////////////////////////////////////////////////////
                              ADMIN功能
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

    /**
     * @notice Support new market and set Aave risk parameters
     */
    function _supportMarket(
        address cToken, 
        uint256 ltvMantissa,
        uint256 liquidationThresholdMantissa,
        uint256 liquidationBonusMantissa
    ) external onlyAdmin returns (uint256) {
        require(cToken != address(0), "bad market");
        require(!markets[cToken].isListed, "already listed");
        require(ltvMantissa <= liquidationThresholdMantissa, "LTV must be <= Liq Threshold");
        require(liquidationThresholdMantissa <= WAD, "Liq Threshold > WAD");
        require(liquidationBonusMantissa >= WAD, "Liq Bonus < WAD");

        uint256 price = oracle.getUnderlyingPrice(cToken);
        require(price > 0, "price not available");

        markets[cToken] = Market({
            isListed: true,
            ltvMantissa: ltvMantissa,
            liquidationThresholdMantissa: liquidationThresholdMantissa,
            liquidationBonusMantissa: liquidationBonusMantissa,
            supplyCap: type(uint256).max,
            borrowCap: type(uint256).max
        });

        allMarkets.push(cToken);

        emit MarketListed(cToken);
        emit MarketRiskParametersUpdated(cToken, ltvMantissa, liquidationThresholdMantissa, liquidationBonusMantissa);

        return NO_ERROR;
    }

    /**
     * @notice Dynamically adjust market risk parameters
     */
    function _setMarketRiskParameters(
        address cToken,
        uint256 ltvMantissa,
        uint256 liquidationThresholdMantissa,
        uint256 liquidationBonusMantissa
    ) external onlyAdmin returns (uint256) {
        require(markets[cToken].isListed, "market not listed");
        require(ltvMantissa <= liquidationThresholdMantissa, "LTV must be <= Liq Threshold");
        require(liquidationThresholdMantissa <= WAD, "Liq Threshold > WAD");
        require(liquidationBonusMantissa >= WAD, "Liq Bonus < WAD");
        require(oracle.getUnderlyingPrice(cToken) > 0, "price not available");

        markets[cToken].ltvMantissa = ltvMantissa;
        markets[cToken].liquidationThresholdMantissa = liquidationThresholdMantissa;
        markets[cToken].liquidationBonusMantissa = liquidationBonusMantissa;

        emit MarketRiskParametersUpdated(cToken, ltvMantissa, liquidationThresholdMantissa, liquidationBonusMantissa);
        return NO_ERROR;
    }

    /**
     * @notice Set asset caps (supply and borrow)
     */
    function _setMarketCaps(
        address cToken,
        uint256 supplyCap,
        uint256 borrowCap
    ) external onlyAdmin returns (uint256) {
        require(markets[cToken].isListed, "market not listed");

        markets[cToken].supplyCap = supplyCap;
        markets[cToken].borrowCap = borrowCap;

        emit MarketCapsUpdated(cToken, supplyCap, borrowCap);
        return NO_ERROR;
    }

    /**
     * @notice Emergency pause: pause or resume all core operations of a market
     * @param cToken market token address
     * @param state true for pause, false for resume
     */
    function _setMarketPause(address cToken, bool state) external onlyAdmin returns (uint256) {
        require(markets[cToken].isListed, "market not listed");
        isMarketPaused[cToken] = state;
        
        emit MarketPaused(cToken, state);
        return NO_ERROR;
    }

    function _setCloseFactor(uint256 newCloseFactorMantissa) external onlyAdmin returns (uint256) {
        require(newCloseFactorMantissa <= WAD, "bad close factor");

        uint256 oldCloseFactor = closeFactorMantissa;
        closeFactorMantissa = newCloseFactorMantissa;

        emit NewCloseFactor(oldCloseFactor, newCloseFactorMantissa);
        return NO_ERROR;
    }

    function setRouter(address router, bool approved) external onlyAdmin returns (uint256) {
        require(router != address(0), "bad router");
        approvedRouters[router] = approved;
        emit RouterUpdated(router, approved);
        return NO_ERROR;
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

    /**
     * @notice Allow user to use specified asset as collateral
     */
    function enterMarkets(address[] calldata cTokens) external returns (uint256[] memory results) {
        uint256 len = cTokens.length;
        results = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            results[i] = _addToMarketInternal(cTokens[i], msg.sender);
        }
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

    /**
     * @notice Exit market: no longer use asset as collateral
     */
    function exitMarket(address cToken) external returns (uint256) {
        if (!markets[cToken].isListed) {
            return MARKET_NOT_LISTED;
        }

        if (!accountMembership[msg.sender][cToken]) {
            return NO_ERROR;
        }

        // Cannot exit if borrow balance > 0
        uint256 borrowBalance = ICTokenLike(cToken).borrowBalanceStored(msg.sender);
        if (borrowBalance > 0) {
            return NONZERO_BORROW_BALANCE;
        }

        // Simulate account health if all cTokens are removed from collateral
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

        // Reject exit if it leads to shortfall
        if (shortfall > 0) {
            return EXIT_MARKET_REJECTED;
        }

        // Formally remove collateral membership
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

    function mintAllowed(address cToken, address, uint256 mintAmount) external view returns (uint256) {
        require(!isMarketPaused[cToken], "Market is paused");
        if (!markets[cToken].isListed) return MARKET_NOT_LISTED;

        // Supply cap check
        uint256 supplyCap = markets[cToken].supplyCap;
        if (supplyCap != type(uint256).max) {
            uint256 totalSupplyUnderlying = (ICTokenLike(cToken).totalSupply() * ICTokenLike(cToken).exchangeRateStored()) / WAD;
            if (totalSupplyUnderlying + mintAmount > supplyCap) {
                return SUPPLY_CAP_EXCEEDED;
            }
        }

        return NO_ERROR;
    }

    function redeemAllowed(address cToken, address redeemer, uint256 redeemTokens) external view returns (uint256) {
        require(!isMarketPaused[cToken], "Market is paused");
        if (!markets[cToken].isListed) return MARKET_NOT_LISTED;

        // Can redeem directly if not used as collateral
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
        require(!isMarketPaused[cToken], "Market is paused");
        if (!markets[cToken].isListed) return MARKET_NOT_LISTED;

        // Borrow cap check
        uint256 borrowCap = markets[cToken].borrowCap;
        if (borrowCap != type(uint256).max) {
            uint256 totalBorrows = ICTokenLike(cToken).totalBorrows();
            if (totalBorrows + borrowAmount > borrowCap) {
                return BORROW_CAP_EXCEEDED;
            }
        }

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
        require(!isMarketPaused[cToken], "Market is paused");
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
        require(!isMarketPaused[cTokenBorrowed] && !isMarketPaused[cTokenCollateral], "Market is paused");
        if (!markets[cTokenBorrowed].isListed || !markets[cTokenCollateral].isListed) {
            return MARKET_NOT_LISTED;
        }

        (uint256 err, uint256 hf) = getAccountHealthFactor(borrower);
        if (err != NO_ERROR) return err;

        // In Aave model, liquidation is allowed only when Health Factor < 1.0
        if (hf >= WAD) {
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
        require(!isMarketPaused[cTokenCollateral], "Market is paused");
        if (!markets[cTokenCollateral].isListed || !markets[cTokenBorrowed].isListed) {
            return MARKET_NOT_LISTED;
        }
        return NO_ERROR;
    }

    /*//////////////////////////////////////////////////////////////
                           OPTIONAL VERIFY HOOKS
    //////////////////////////////////////////////////////////////*/

    function redeemVerify(address, address, uint256, uint256) external pure {}

    /*//////////////////////////////////////////////////////////////
                         LIQUIDITY & HEALTH FACTOR
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
     * @notice Aave style health factor calculation
     * Health Factor = Sum(Collateral Value * Liquidation Threshold) / Sum(Borrow Value)
     * If no borrows, returns max uint256
     */
    function getAccountHealthFactor(address account) public view returns (uint256 error, uint256 healthFactor) {
        uint256 sumCollateralThresholdValue;
        uint256 sumBorrowValue;

        address[] storage assets = accountAssets[account];

        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            Market memory market = markets[asset];
            if (!market.isListed) {
                return (MARKET_NOT_LISTED, 0);
            }

            (
                uint256 oErr,
                uint256 cTokenBalance,
                uint256 borrowBalance,
                uint256 exchangeRateMantissa
            ) = ICTokenLike(asset).getAccountSnapshot(account);

            if (oErr != NO_ERROR) {
                return (oErr, 0);
            }

            uint256 oraclePriceMantissa = oracle.getUnderlyingPrice(asset);
            if (oraclePriceMantissa == 0) {
                return (PRICE_ERROR, 0);
            }

            uint256 tokensToUnderlying = (cTokenBalance * exchangeRateMantissa) / WAD;
            uint256 underlyingToValue = (tokensToUnderlying * oraclePriceMantissa) / WAD;
            
            sumCollateralThresholdValue += (underlyingToValue * market.liquidationThresholdMantissa) / WAD;
            sumBorrowValue += (borrowBalance * oraclePriceMantissa) / WAD;
        }

        if (sumBorrowValue == 0) {
            return (NO_ERROR, type(uint256).max); // Zero borrows, infinite health factor
        }

        healthFactor = (sumCollateralThresholdValue * WAD) / sumBorrowValue;
        return (NO_ERROR, healthFactor);
    }

    /**
     * @notice Simulate account liquidity based on LTV
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
        uint256 sumCollateralLtvValue;
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

            sumCollateralLtvValue += collateralContribution;
            sumBorrowPlusEffects += borrowContribution;
        }

        if (sumCollateralLtvValue > sumBorrowPlusEffects) {
            return (NO_ERROR, sumCollateralLtvValue - sumBorrowPlusEffects, 0);
        } else {
            return (NO_ERROR, 0, sumBorrowPlusEffects - sumCollateralLtvValue);
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
        
        // Note: Borrow limit is calculated using LTV, not Liquidation Threshold
        collateralContribution = (underlyingToValue * market.ltvMantissa) / WAD;

        borrowContribution = (borrowBalance * oraclePriceMantissa) / WAD;

        if (asset == params.cTokenModify) {
            if (params.redeemTokens > 0) {
                uint256 redeemUnderlying = (params.redeemTokens * exchangeRateMantissa) / WAD;
                uint256 redeemValue = (redeemUnderlying * oraclePriceMantissa) / WAD;
                uint256 redeemCollateralValue = (redeemValue * market.ltvMantissa) / WAD;
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
     * @notice Calculate how much cToken collateral the liquidator should receive after repaying actualRepayAmount
     *
     * Seized underlying value = Repaid underlying value * Liquidation bonus
     * Seized cTokens = Seized underlying value / Exchange rate
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

        Market memory collateralMarket = markets[cTokenCollateral];
        if (!collateralMarket.isListed) {
            return (MARKET_NOT_LISTED, 0);
        }

        uint256 exchangeRateMantissa = ICTokenLike(cTokenCollateral).exchangeRateStored();

        uint256 numerator = (((actualRepayAmount * collateralMarket.liquidationBonusMantissa) / WAD) * priceBorrowedMantissa);
        uint256 seizeAmount = numerator / priceCollateralMantissa;

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