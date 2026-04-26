// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IComptrollerLike {
    function isComptroller() external pure returns (bool);

    function mintAllowed(address cToken, address minter, uint256 mintAmount) external view returns (uint256);
    function redeemAllowed(address cToken, address redeemer, uint256 redeemTokens) external view returns (uint256);
    function borrowAllowed(address cToken, address borrower, uint256 borrowAmount) external returns (uint256);
    function repayBorrowAllowed(address cToken, address payer, address borrower, uint256 repayAmount) external view returns (uint256);
    function liquidateBorrowAllowed(
        address cTokenBorrowed,
        address cTokenCollateral,
        address liquidator,
        address borrower,
        uint256 repayAmount
    ) external view returns (uint256);

    function seizeAllowed(
        address cTokenCollateral,
        address cTokenBorrowed,
        address liquidator,
        address borrower,
        uint256 seizeTokens
    ) external view returns (uint256);

    function redeemVerify(address cToken, address redeemer, uint256 redeemAmount, uint256 redeemTokens) external view;

    function liquidateCalculateSeizeTokens(
        address cTokenBorrowed,
        address cTokenCollateral,
        uint256 actualRepayAmount
    ) external view returns (uint256, uint256);
}

interface IInterestRateStrategyLike {
    function getBorrowRate(
        uint256 cash,
        uint256 totalBorrows,
        uint256 totalReserves
    ) external view returns (uint256);
}

/**
 * @title CTokenBase
 * @notice Abstract base market contract compatible with Compound-style interfaces
 *
 * Features:
 * - Compound-style interfaces:
 *   mint / redeem / redeemUnderlying / borrow / repayBorrow / repayBorrowBehalf
 *   exchangeRateCurrent / exchangeRateStored / borrowBalanceCurrent / borrowBalanceStored
 * - Integrates with Comptroller for unified multi-market risk control
 * - Externalized interest rate strategy
 * - Preserves leverageUp / deleverage extensions
 * - Abstracts underlying transfer logic for CErc20 / CEth implementations
 */
abstract contract CTokenBase is ERC20, ReentrancyGuard {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    uint256 public constant WAD = 1e18;
    uint256 public constant NO_ERROR = 0;

    /*//////////////////////////////////////////////////////////////
                                  ADMIN
    //////////////////////////////////////////////////////////////*/

    address public admin;
    address public pendingAdmin;

    modifier onlyAdmin() {
        require(msg.sender == admin, "only admin");
        _;
    }

    modifier onlyApprovedRouter() {
        require(approvedRouters[msg.sender], "not approved router");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                             CORE STORAGE
    //////////////////////////////////////////////////////////////*/

    IComptrollerLike public comptroller;
    IInterestRateStrategyLike public interestRateStrategy;

    uint256 public initialExchangeRateMantissa;
    uint256 public reserveFactorMantissa;
    uint256 public borrowRateMaxMantissa;

    uint256 public accrualTimestamp;
    uint256 public borrowIndex;
    uint256 public totalBorrows;
    uint256 public totalReserves;

    struct BorrowSnapshot {
        uint256 principal;
        uint256 interestIndex;
    }

    mapping(address => BorrowSnapshot) internal accountBorrows;
    mapping(address => bool) public approvedRouters;
    /*//////////////////////////////////////////////////////////////
                                  EVENTS
    //////////////////////////////////////////////////////////////*/

    event AccrueInterest(
        uint256 cashPrior,
        uint256 interestAccumulated,
        uint256 borrowIndexNew,
        uint256 totalBorrowsNew,
        uint256 totalReservesNew
    );

    event Mint(address indexed minter, uint256 mintAmount, uint256 mintTokens);
    event Redeem(address indexed redeemer, uint256 redeemAmount, uint256 redeemTokens);
    event Borrow(address indexed borrower, uint256 borrowAmount, uint256 accountBorrowsNew, uint256 totalBorrowsNew);
    event RepayBorrow(address indexed payer, address indexed borrower, uint256 repayAmount, uint256 accountBorrowsNew, uint256 totalBorrowsNew);

    event LiquidateBorrow(
        address indexed liquidator,
        address indexed borrower,
        uint256 actualRepayAmount,
        address indexed cTokenCollateral,
        uint256 seizeTokens
    );

    event NewPendingAdmin(address oldPendingAdmin, address newPendingAdmin);
    event NewAdmin(address oldAdmin, address newAdmin);

    event NewComptroller(address oldComptroller, address newComptroller);
    event NewInterestRateStrategy(address oldStrategy, address newStrategy);
    event NewReserveFactor(uint256 oldReserveFactorMantissa, uint256 newReserveFactorMantissa);

    event ReservesAdded(address indexed benefactor, uint256 addAmount, uint256 newTotalReserves);
    event ReservesReduced(address indexed admin, uint256 reduceAmount, uint256 newTotalReserves);

    event LeverageUp(address indexed user, uint256 marginIn, uint256 borrowAmount, uint256 mintedCTokens);
    event Deleverage(address indexed user, uint256 repayAmount, uint256 burnedCTokens);
    event RouterUpdated(address indexed router, bool approved);
    /*//////////////////////////////////////////////////////////////
                               CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        address admin_,
        string memory name_,
        string memory symbol_,
        IComptrollerLike comptroller_,
        IInterestRateStrategyLike interestRateStrategy_,
        uint256 initialExchangeRateMantissa_,
        uint256 reserveFactorMantissa_,
        uint256 borrowRateMaxMantissa_
    ) ERC20(name_, symbol_) {
        require(admin_ != address(0), "bad admin");
        require(address(comptroller_) != address(0), "bad comptroller");
        require(comptroller_.isComptroller(), "not comptroller");
        require(address(interestRateStrategy_) != address(0), "bad ir strategy");
        require(initialExchangeRateMantissa_ > 0, "bad initial exchange rate");
        require(reserveFactorMantissa_ <= WAD, "bad reserve factor");

        admin = admin_;
        comptroller = comptroller_;
        interestRateStrategy = interestRateStrategy_;
        initialExchangeRateMantissa = initialExchangeRateMantissa_;
        reserveFactorMantissa = reserveFactorMantissa_;
        borrowRateMaxMantissa = borrowRateMaxMantissa_;

        borrowIndex = WAD;
        accrualTimestamp = block.timestamp;
    }

    /*//////////////////////////////////////////////////////////////
                               VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function totalBorrowsCurrent() external nonReentrant returns (uint256) {
        accrueInterest();
        return totalBorrows;
    }

    function exchangeRateCurrent() public nonReentrant returns (uint256) {
        accrueInterest();
        return exchangeRateStored();
    }

    function exchangeRateStored() public view returns (uint256) {
        uint256 _totalSupply = totalSupply();

        if (_totalSupply == 0) {
            return initialExchangeRateMantissa;
        }

        uint256 cashPlusBorrowsMinusReserves = getCashPrior() + totalBorrows - totalReserves;
        return (cashPlusBorrowsMinusReserves * WAD) / _totalSupply;
    }

    function borrowBalanceCurrent(address account) external nonReentrant returns (uint256) {
        accrueInterest();
        return borrowBalanceStored(account);
    }

    function borrowBalanceStored(address account) public view returns (uint256) {
        BorrowSnapshot memory snap = accountBorrows[account];
        if (snap.principal == 0) return 0;
        return (snap.principal * borrowIndex) / snap.interestIndex;
    }

    function balanceOfUnderlying(address owner) external nonReentrant returns (uint256) {
        uint256 exchangeRate = exchangeRateCurrent();
        return (balanceOf(owner) * exchangeRate) / WAD;
    }

    function getAccountSnapshot(address account)
        external
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        return (
            NO_ERROR,
            balanceOf(account),
            borrowBalanceStored(account),
            exchangeRateStored()
        );
    }

    /*//////////////////////////////////////////////////////////////
                              INTEREST LOGIC
    //////////////////////////////////////////////////////////////*/

    function accrueInterest() public returns (uint256) {
        uint256 currentTimestamp = block.timestamp;
        uint256 accrualTimestampPrior = accrualTimestamp;

        if (currentTimestamp == accrualTimestampPrior) {
            return NO_ERROR;
        }

        uint256 cashPrior = getCashPrior();
        uint256 borrowsPrior = totalBorrows;
        uint256 reservesPrior = totalReserves;
        uint256 borrowIndexPrior = borrowIndex;

        if (borrowsPrior == 0) {
            accrualTimestamp = currentTimestamp;
            return NO_ERROR;
        }

        uint256 borrowRateMantissa = interestRateStrategy.getBorrowRate(
            cashPrior,
            borrowsPrior,
            reservesPrior
        );
        require(borrowRateMantissa <= borrowRateMaxMantissa, "borrow rate too high");

        uint256 timeDelta = currentTimestamp - accrualTimestampPrior;
        uint256 simpleInterestFactor = borrowRateMantissa * timeDelta;

        uint256 interestAccumulated = (simpleInterestFactor * borrowsPrior) / WAD;
        uint256 totalBorrowsNew = borrowsPrior + interestAccumulated;
        uint256 totalReservesNew = reservesPrior + (interestAccumulated * reserveFactorMantissa) / WAD;
        uint256 borrowIndexNew = borrowIndexPrior + (borrowIndexPrior * simpleInterestFactor) / WAD;

        accrualTimestamp = currentTimestamp;
        borrowIndex = borrowIndexNew;
        totalBorrows = totalBorrowsNew;
        totalReserves = totalReservesNew;

        emit AccrueInterest(
            cashPrior,
            interestAccumulated,
            borrowIndexNew,
            totalBorrowsNew,
            totalReservesNew
        );

        return NO_ERROR;
    }

    /*//////////////////////////////////////////////////////////////
                           INTERNAL BORROW HELPERS
    //////////////////////////////////////////////////////////////*/

    function _setBorrowBalance(address borrower, uint256 newDebt) internal {
        accountBorrows[borrower] = BorrowSnapshot({
            principal: newDebt,
            interestIndex: borrowIndex
        });
    }

    /*//////////////////////////////////////////////////////////////
                               MINT / REDEEM
    //////////////////////////////////////////////////////////////*/

    function mint(uint256 mintAmount) external payable virtual nonReentrant returns (uint256) {
        require(mintAmount > 0, "zero mint");
        accrueInterest();
        _mintFresh(msg.sender, mintAmount);
        return NO_ERROR;
    }

    function _mintFresh(address minter, uint256 mintAmount) internal returns (uint256 mintTokens) {
        uint256 allowed = comptroller.mintAllowed(address(this), minter, mintAmount);
        require(allowed == NO_ERROR, "mint not allowed");

        uint256 exchangeRate = exchangeRateStored();

        uint256 actualMintAmount = doTransferIn(minter, mintAmount);
        mintTokens = (actualMintAmount * WAD) / exchangeRate;

        _mint(minter, mintTokens);

        emit Mint(minter, actualMintAmount, mintTokens);
    }

    function redeem(uint256 redeemTokens) external nonReentrant returns (uint256) {
        require(redeemTokens > 0, "zero redeem");
        accrueInterest();
        _redeemFresh(payable(msg.sender), redeemTokens, 0);
        return NO_ERROR;
    }

    function redeemUnderlying(uint256 redeemAmount) external nonReentrant returns (uint256) {
        require(redeemAmount > 0, "zero redeem");
        accrueInterest();
        _redeemFresh(payable(msg.sender), 0, redeemAmount);
        return NO_ERROR;
    }

    function _redeemFresh(address payable redeemer, uint256 redeemTokensIn, uint256 redeemAmountIn)
        internal
        returns (uint256 redeemTokens, uint256 redeemAmount)
    {
        require(redeemTokensIn == 0 || redeemAmountIn == 0, "one input must be zero");

        uint256 exchangeRate = exchangeRateStored();

        if (redeemTokensIn > 0) {
            redeemTokens = redeemTokensIn;
            redeemAmount = (redeemTokensIn * exchangeRate) / WAD;
        } else {
            redeemAmount = redeemAmountIn;
            redeemTokens = (redeemAmountIn * WAD) / exchangeRate;
        }

        uint256 allowed = comptroller.redeemAllowed(address(this), redeemer, redeemTokens);
        require(allowed == NO_ERROR, "redeem not allowed");

        require(balanceOf(redeemer) >= redeemTokens, "insufficient ctoken");
        require(getCashPrior() >= redeemAmount, "insufficient cash");

        _burn(redeemer, redeemTokens);
        doTransferOut(redeemer, redeemAmount);

        emit Redeem(redeemer, redeemAmount, redeemTokens);

        comptroller.redeemVerify(address(this), redeemer, redeemAmount, redeemTokens);
    }

    /*//////////////////////////////////////////////////////////////
                               BORROW / REPAY
    //////////////////////////////////////////////////////////////*/

    function borrow(uint256 borrowAmount) external nonReentrant returns (uint256) {
        require(borrowAmount > 0, "zero borrow");
        accrueInterest();
        _borrowFresh(payable(msg.sender), borrowAmount);
        return NO_ERROR;
    }

    function _borrowFresh(address payable borrower, uint256 borrowAmount) internal {
        uint256 allowed = comptroller.borrowAllowed(address(this), borrower, borrowAmount);
        require(allowed == NO_ERROR, "borrow not allowed");

        require(getCashPrior() >= borrowAmount, "insufficient cash");

        uint256 accountBorrowsPrev = borrowBalanceStored(borrower);
        uint256 accountBorrowsNew = accountBorrowsPrev + borrowAmount;
        uint256 totalBorrowsNew = totalBorrows + borrowAmount;

        _setBorrowBalance(borrower, accountBorrowsNew);
        totalBorrows = totalBorrowsNew;

        doTransferOut(borrower, borrowAmount);

        emit Borrow(borrower, borrowAmount, accountBorrowsNew, totalBorrowsNew);
    }

    function repayBorrow(uint256 repayAmount) external payable virtual nonReentrant returns (uint256) {
        accrueInterest();
        return _repayBorrowFresh(msg.sender, msg.sender, repayAmount);
    }

    function repayBorrowBehalf(address borrower, uint256 repayAmount) external payable virtual nonReentrant returns (uint256) {
        accrueInterest();
        return _repayBorrowFresh(msg.sender, borrower, repayAmount);
    }

    function _repayBorrowFresh(address payer, address borrower, uint256 repayAmount) internal returns (uint256) {
        uint256 allowed = comptroller.repayBorrowAllowed(address(this), payer, borrower, repayAmount);
        require(allowed == NO_ERROR, "repay not allowed");

        uint256 accountBorrowsPrev = borrowBalanceStored(borrower);
        require(accountBorrowsPrev > 0, "no debt");

        uint256 repayAmountFinal = repayAmount == type(uint256).max
            ? accountBorrowsPrev
            : repayAmount;

        uint256 actualRepayAmountWanted = repayAmountFinal > accountBorrowsPrev
            ? accountBorrowsPrev
            : repayAmountFinal;

        uint256 actualRepayAmount = doTransferIn(payer, actualRepayAmountWanted);

        uint256 accountBorrowsNew = accountBorrowsPrev - actualRepayAmount;
        uint256 totalBorrowsNew = totalBorrows - actualRepayAmount;

        _setBorrowBalance(borrower, accountBorrowsNew);
        totalBorrows = totalBorrowsNew;

        emit RepayBorrow(payer, borrower, actualRepayAmount, accountBorrowsNew, totalBorrowsNew);

        return actualRepayAmount;
    }

    /*//////////////////////////////////////////////////////////////
                             LEVERAGE EXTENSION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Single-market leverage loop
     * @dev marginIn is supplied first, then borrowAmount is borrowed and immediately
     *      re-minted internally into cTokens
     *      Multi-market leverage loops should not be implemented here and should be handled by Router
     */
    function leverageUp(uint256 marginIn, uint256 borrowAmount) external payable virtual nonReentrant returns (uint256) {
        require(marginIn > 0 || borrowAmount > 0, "nothing to do");
        accrueInterest();

        uint256 mintedCTokens;

        if (marginIn > 0) {
            mintedCTokens += _mintFresh(msg.sender, marginIn);
        }

        if (borrowAmount > 0) {
            uint256 allowed = comptroller.borrowAllowed(address(this), msg.sender, borrowAmount);
            require(allowed == NO_ERROR, "leverage borrow not allowed");

            uint256 exchangeRate = exchangeRateStored();
            uint256 loopMintTokens = (borrowAmount * WAD) / exchangeRate;

            uint256 accountBorrowsPrev = borrowBalanceStored(msg.sender);
            uint256 accountBorrowsNew = accountBorrowsPrev + borrowAmount;

            _setBorrowBalance(msg.sender, accountBorrowsNew);
            totalBorrows += borrowAmount;

            // Borrowed funds are directly re-minted within the current market
            _mint(msg.sender, loopMintTokens);

            mintedCTokens += loopMintTokens;

            emit Mint(msg.sender, borrowAmount, loopMintTokens);
            emit Borrow(msg.sender, borrowAmount, accountBorrowsNew, totalBorrows);
        }

        emit LeverageUp(msg.sender, marginIn, borrowAmount, mintedCTokens);
        return NO_ERROR;
    }

    /**
     * @notice Single-market deleverage
     * @dev Reduces debt directly by burning cTokens equivalent to the asset value
     */
    function deleverage(uint256 repayAmount) external virtual nonReentrant returns (uint256) {
        require(repayAmount > 0, "zero repay");
        accrueInterest();

        uint256 debtBefore = borrowBalanceStored(msg.sender);
        require(debtBefore > 0, "no debt");

        uint256 actualRepay = repayAmount > debtBefore ? debtBefore : repayAmount;
        uint256 exchangeRate = exchangeRateStored();
        uint256 burnTokens = (actualRepay * WAD) / exchangeRate;

        require(balanceOf(msg.sender) >= burnTokens, "insufficient ctoken");

        _burn(msg.sender, burnTokens);

        uint256 debtAfter = debtBefore - actualRepay;
        _setBorrowBalance(msg.sender, debtAfter);
        totalBorrows -= actualRepay;

        emit Deleverage(msg.sender, actualRepay, burnTokens);
        return NO_ERROR;
    }

    /*//////////////////////////////////////////////////////////////
                               LIQUIDATION
    //////////////////////////////////////////////////////////////*/

    function liquidateBorrow(
        address borrower,
        uint256 repayAmount,
        CTokenBase cTokenCollateral
    ) external payable virtual nonReentrant returns (uint256) {
        require(borrower != msg.sender, "self liquidate");
        require(repayAmount > 0, "zero repay");

        accrueInterest();
        cTokenCollateral.accrueInterest();

        uint256 allowed = comptroller.liquidateBorrowAllowed(
            address(this),
            address(cTokenCollateral),
            msg.sender,
            borrower,
            repayAmount
        );
        require(allowed == NO_ERROR, "liquidate not allowed");

        uint256 actualRepayAmount = _repayBorrowFresh(msg.sender, borrower, repayAmount);

        (uint256 seizeErr, uint256 seizeTokens) = comptroller.liquidateCalculateSeizeTokens(
            address(this),
            address(cTokenCollateral),
            actualRepayAmount
        );
        require(seizeErr == NO_ERROR, "seize calc failed");

        require(cTokenCollateral.seize(msg.sender, borrower, seizeTokens) == NO_ERROR, "seize failed");

        emit LiquidateBorrow(msg.sender, borrower, actualRepayAmount, address(cTokenCollateral), seizeTokens);
        return NO_ERROR;
    }

    function seize(address liquidator, address borrower, uint256 seizeTokens) external nonReentrant returns (uint256) {
        uint256 allowed = comptroller.seizeAllowed(address(this), msg.sender, liquidator, borrower, seizeTokens);
        require(allowed == NO_ERROR, "seize not allowed");
        require(borrower != liquidator, "bad seize");
        require(balanceOf(borrower) >= seizeTokens, "insufficient collateral");

        _transfer(borrower, liquidator, seizeTokens);
        return NO_ERROR;
    }

    /*//////////////////////////////////////////////////////////////
                             RESERVE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _addReserves(uint256 addAmount) external payable nonReentrant returns (uint256) {
        require(addAmount > 0, "zero add");
        accrueInterest();

        uint256 actualAddAmount = doTransferIn(msg.sender, addAmount);
        totalReserves += actualAddAmount;

        emit ReservesAdded(msg.sender, actualAddAmount, totalReserves);
        return NO_ERROR;
    }

    function _reduceReserves(uint256 reduceAmount) external onlyAdmin nonReentrant returns (uint256) {
        require(reduceAmount > 0, "zero reduce");
        accrueInterest();

        require(reduceAmount <= totalReserves, "reduce > reserves");
        require(reduceAmount <= getCashPrior(), "insufficient cash");

        totalReserves -= reduceAmount;
        doTransferOut(payable(admin), reduceAmount);

        emit ReservesReduced(admin, reduceAmount, totalReserves);
        return NO_ERROR;
    }

    /*//////////////////////////////////////////////////////////////
                              ADMIN SETTERS
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

    function _setComptroller(IComptrollerLike newComptroller) external onlyAdmin returns (uint256) {
        require(address(newComptroller) != address(0), "zero comptroller");
        require(newComptroller.isComptroller(), "not comptroller");

        address oldComptroller = address(comptroller);
        comptroller = newComptroller;

        emit NewComptroller(oldComptroller, address(newComptroller));
        return NO_ERROR;
    }

    function _setReserveFactor(uint256 newReserveFactorMantissa) external onlyAdmin returns (uint256) {
        require(newReserveFactorMantissa <= WAD, "bad reserve factor");
        accrueInterest();

        uint256 oldReserveFactor = reserveFactorMantissa;
        reserveFactorMantissa = newReserveFactorMantissa;

        emit NewReserveFactor(oldReserveFactor, newReserveFactorMantissa);
        return NO_ERROR;
    }

    function _setInterestRateStrategy(IInterestRateStrategyLike newStrategy) external onlyAdmin returns (uint256) {
        require(address(newStrategy) != address(0), "zero strategy");
        accrueInterest();

        address oldStrategy = address(interestRateStrategy);
        interestRateStrategy = newStrategy;

        emit NewInterestRateStrategy(oldStrategy, address(newStrategy));
        return NO_ERROR;
    }
    function setRouter(address router, bool approved) external onlyAdmin returns (uint256) {
        require(router != address(0), "bad router");
        approvedRouters[router] = approved;
        emit RouterUpdated(router, approved);
        return NO_ERROR;
    }
    /*//////////////////////////////////////////////////////////////
                           ABSTRACT TOKEN LAYER
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Returns the amount of underlying assets currently held by this market
     */
    function getCashPrior() public view virtual returns (uint256);

    /**
     * @notice Transfers `amount` underlying assets in from `from` and returns the actual amount received
     */
    function doTransferIn(address from, uint256 amount) internal virtual returns (uint256);

    /**
     * @notice Transfers `amount` underlying assets out to `to`
     */
    function doTransferOut(address payable to, uint256 amount) internal virtual;
    
    function mintFor(address beneficiary, uint256 mintAmount)
        external
        payable
        onlyApprovedRouter
        virtual 
        nonReentrant
        returns (uint256)
    {
        require(beneficiary != address(0), "bad beneficiary");
        require(mintAmount > 0, "zero mint");

        accrueInterest();

        uint256 allowed = comptroller.mintAllowed(address(this), beneficiary, mintAmount);
        require(allowed == NO_ERROR, "mint not allowed");

        uint256 exchangeRate = exchangeRateStored();
        uint256 actualMintAmount = doTransferIn(msg.sender, mintAmount);
        uint256 mintTokens = (actualMintAmount * WAD) / exchangeRate;

        _mint(beneficiary, mintTokens);

        emit Mint(beneficiary, actualMintAmount, mintTokens);
        return NO_ERROR;
    }
    function borrowFor(address borrower, uint256 borrowAmount, address payable receiver)
        external
        onlyApprovedRouter
        nonReentrant
        returns (uint256)
    {
        require(borrower != address(0), "bad borrower");
        require(receiver != address(0), "bad receiver");
        require(borrowAmount > 0, "zero borrow");

        accrueInterest();

        uint256 allowed = comptroller.borrowAllowed(address(this), borrower, borrowAmount);
        require(allowed == NO_ERROR, "borrow not allowed");

        require(getCashPrior() >= borrowAmount, "insufficient cash");

        uint256 accountBorrowsPrev = borrowBalanceStored(borrower);
        uint256 accountBorrowsNew = accountBorrowsPrev + borrowAmount;
        uint256 totalBorrowsNew = totalBorrows + borrowAmount;

        _setBorrowBalance(borrower, accountBorrowsNew);
        totalBorrows = totalBorrowsNew;

        doTransferOut(receiver, borrowAmount);

        emit Borrow(borrower, borrowAmount, accountBorrowsNew, totalBorrowsNew);
        return NO_ERROR;
    }
    function repayBorrowFor(address payer, address borrower, uint256 repayAmount)
        external
        payable
        onlyApprovedRouter
        virtual
        nonReentrant
        returns (uint256)
    {
        require(payer != address(0), "bad payer");
        require(borrower != address(0), "bad borrower");

        accrueInterest();

        uint256 allowed = comptroller.repayBorrowAllowed(address(this), payer, borrower, repayAmount);
        require(allowed == NO_ERROR, "repay not allowed");

        uint256 accountBorrowsPrev = borrowBalanceStored(borrower);
        require(accountBorrowsPrev > 0, "no debt");

        uint256 repayAmountFinal = repayAmount == type(uint256).max
            ? accountBorrowsPrev
            : repayAmount;

        uint256 repayAmountWanted = repayAmountFinal > accountBorrowsPrev
            ? accountBorrowsPrev
            : repayAmountFinal;

        uint256 actualRepayAmount = doTransferIn(msg.sender, repayAmountWanted);

        uint256 accountBorrowsNew = accountBorrowsPrev - actualRepayAmount;
        uint256 totalBorrowsNew = totalBorrows - actualRepayAmount;

        _setBorrowBalance(borrower, accountBorrowsNew);
        totalBorrows = totalBorrowsNew;

        emit RepayBorrow(payer, borrower, actualRepayAmount, accountBorrowsNew, totalBorrowsNew);
        return actualRepayAmount;
    }
    function redeemUnderlyingFor(address owner, uint256 redeemAmount, address payable receiver)
        external
        onlyApprovedRouter
        nonReentrant
        returns (uint256)
    {
        require(owner != address(0), "bad owner");
        require(receiver != address(0), "bad receiver");
        require(redeemAmount > 0, "zero redeem");

        accrueInterest();

        uint256 exchangeRate = exchangeRateStored();
        uint256 redeemTokens = (redeemAmount * WAD) / exchangeRate;

        uint256 allowed = comptroller.redeemAllowed(address(this), owner, redeemTokens);
        require(allowed == NO_ERROR, "redeem not allowed");

        require(balanceOf(owner) >= redeemTokens, "insufficient ctoken");
        require(getCashPrior() >= redeemAmount, "insufficient cash");

        _burn(owner, redeemTokens);
        doTransferOut(receiver, redeemAmount);

        emit Redeem(owner, redeemAmount, redeemTokens);

        comptroller.redeemVerify(address(this), owner, redeemAmount, redeemTokens);
        return NO_ERROR;
    }
}