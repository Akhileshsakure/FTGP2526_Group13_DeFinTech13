// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.24;

import "./CTokenBase.sol";

/**
 * @title CEth
 * @notice CToken implementation for native ETH
 *
 * Features:
 * - Uses msg.value as input
 * - No underlying ERC20 token
 */
contract CEth is CTokenBase {
    uint8 private constant _CETH_DECIMALS = 8;

    constructor(
        address admin_,
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
    {}

    /**
     * @notice cETH typically uses a fixed 8 decimals, aligned with Compound convention
     */
    function decimals() public pure override returns (uint8) {
        return _CETH_DECIMALS;
    }

    /**
     * @notice Accept ETH transfers
     * @dev Acts as a fallback to receive ETH sent directly to the contract;
     *      main flows should still go through mint/repay functions
     */
    receive() external payable {}

    /**
     * @notice Returns the ETH balance held by this contract
     */
    function getCashPrior() public view override returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Receives ETH and returns the actual amount received
     * @dev amount must equal msg.value
     */
    function doTransferIn(address from, uint256 amount) internal override returns (uint256) {
        require(msg.sender == from, "sender mismatch");
        require(msg.value == amount, "msg.value mismatch");
        return amount;
    }

    /**
     * @notice Transfers ETH out to the user
     */
    function doTransferOut(address payable to, uint256 amount) internal override {
        (bool success, ) = to.call{value: amount}("");
        require(success, "eth transfer out failed");
    }

    /*//////////////////////////////////////////////////////////////
                           ETH-SPECIFIC EXTERNALS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Supply ETH and receive cETH
     * @dev User sends ETH via msg.value, no ERC20 amount needed
     */
    function mint() external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "zero mint");
        accrueInterest();
        _mintFresh(msg.sender, msg.value);
        return NO_ERROR;
    }

    /**
     * @notice Repay own borrow
     * @dev Repayment is made via msg.value
     */
    function repayBorrow() external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "zero repay");
        accrueInterest();
        return _repayBorrowFresh(msg.sender, msg.sender, msg.value);
    }
    
    function mintFor(address beneficiary, uint256 mintAmount)
        external
        payable
        override
        onlyApprovedRouter
        nonReentrant
        returns (uint256)
    {
        require(beneficiary != address(0), "bad beneficiary");
        require(msg.value == mintAmount, "msg.value mismatch");
        require(mintAmount > 0, "zero mint");

        accrueInterest();

        uint256 allowed = comptroller.mintAllowed(address(this), beneficiary, mintAmount);
        require(allowed == NO_ERROR, "mint not allowed");

        uint256 exchangeRate = exchangeRateStored();
        uint256 mintTokens = (mintAmount * WAD) / exchangeRate;

        _mint(beneficiary, mintTokens);

        emit Mint(beneficiary, mintAmount, mintTokens);
        return NO_ERROR;
    }

    function repayBorrowFor(address payer, address borrower, uint256 repayAmount)
        external
        payable
        override
        onlyApprovedRouter
        nonReentrant
        returns (uint256)
    {
        require(payer != address(0), "bad payer");
        require(borrower != address(0), "bad borrower");
        require(msg.value == repayAmount, "msg.value mismatch");

        accrueInterest();

        uint256 allowed = comptroller.repayBorrowAllowed(address(this), payer, borrower, repayAmount);
        require(allowed == NO_ERROR, "repay not allowed");

        uint256 accountBorrowsPrev = borrowBalanceStored(borrower);
        require(accountBorrowsPrev > 0, "no debt");

        uint256 actualRepayAmount = repayAmount > accountBorrowsPrev
            ? accountBorrowsPrev
            : repayAmount;

        uint256 accountBorrowsNew = accountBorrowsPrev - actualRepayAmount;
        uint256 totalBorrowsNew = totalBorrows - actualRepayAmount;

        _setBorrowBalance(borrower, accountBorrowsNew);
        totalBorrows = totalBorrowsNew;

        emit RepayBorrow(payer, borrower, actualRepayAmount, accountBorrowsNew, totalBorrowsNew);

        // Refund excess ETH if msg.value exceeds actual repayment
        if (msg.value > actualRepayAmount) {
            (bool ok, ) = payable(msg.sender).call{value: msg.value - actualRepayAmount}("");
            require(ok, "refund failed");
        }

        return actualRepayAmount;
    }

    /**
     * @notice Repay borrow on behalf of another user
     * @dev Repayment is made via msg.value
     */
    function repayBorrowBehalf(address borrower) external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "zero repay");
        accrueInterest();
        return _repayBorrowFresh(msg.sender, borrower, msg.value);
    }

    /**
     * @notice Liquidate ETH borrow positions
     * @dev Liquidator repays borrower's ETH debt via msg.value
     */
    function liquidateBorrow(address borrower, CTokenBase cTokenCollateral)
        external
        payable
        nonReentrant
        returns (uint256)
    {
        require(borrower != msg.sender, "self liquidate");
        require(msg.value > 0, "zero repay");

        accrueInterest();
        cTokenCollateral.accrueInterest();

        uint256 allowed = comptroller.liquidateBorrowAllowed(
            address(this),
            address(cTokenCollateral),
            msg.sender,
            borrower,
            msg.value
        );
        require(allowed == NO_ERROR, "liquidate not allowed");

        uint256 actualRepayAmount = _repayBorrowFresh(msg.sender, borrower, msg.value);

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

    /**
     * @notice Single-market ETH leverage loop
     * @param borrowAmount Additional ETH to borrow and internally re-mint as cETH
     * @dev Initial margin comes from msg.value
     */
    function leverageUp(uint256 borrowAmount) external payable nonReentrant returns (uint256) {
        require(msg.value > 0 || borrowAmount > 0, "nothing to do");
        accrueInterest();

        uint256 mintedCTokens;

        if (msg.value > 0) {
            mintedCTokens += _mintFresh(msg.sender, msg.value);
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

            // Borrowed ETH is not transferred out; it is directly re-minted internally
            _mint(msg.sender, loopMintTokens);

            mintedCTokens += loopMintTokens;

            emit Mint(msg.sender, borrowAmount, loopMintTokens);
            emit Borrow(msg.sender, borrowAmount, accountBorrowsNew, totalBorrows);
        }

        emit LeverageUp(msg.sender, msg.value, borrowAmount, mintedCTokens);
        return NO_ERROR;
    }

    /**
     * @notice Single-market ETH deleverage
     * @param repayAmount Amount of debt to repay using cETH (converted via exchangeRate)
     */
    function deleverage(uint256 repayAmount) external override nonReentrant returns (uint256) {
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
                            DISABLE ERC20-STYLE PAYABLE MINT
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Prevent misuse of base mint(uint256)
     */
    function mint(uint256) external payable override returns (uint256) {
        revert("use mint() with msg.value");
    }

    /**
     * @dev Prevent misuse of base repayBorrow(uint256)
     */
    function repayBorrow(uint256) external payable override returns (uint256) {
        revert("use repayBorrow() with msg.value");
    }

    /**
     * @dev Prevent misuse of base repayBorrowBehalf(address,uint256)
     */
    function repayBorrowBehalf(address, uint256) external payable override returns (uint256) {
        revert("use repayBorrowBehalf(address) with msg.value");
    }

    /**
     * @dev Prevent misuse of base liquidateBorrow(address,uint256,CTokenBase)
     */
    function liquidateBorrow(address, uint256, CTokenBase)
        external
        payable
        override
        returns (uint256)
    {
        revert("use liquidateBorrow(address,CTokenBase) with msg.value");
    }

    /**
     * @dev Prevent misuse of base leverageUp(uint256,uint256)
     */
    function leverageUp(uint256, uint256)
        external
        payable
        override
        returns (uint256)
    {
        revert("use leverageUp(uint256) with msg.value");
    }
}