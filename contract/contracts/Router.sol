// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWrappedNative is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IComptrollerRouterLike {
    function enterMarketsFor(address account, address[] calldata cTokens) external returns (uint256[] memory);
}

interface IRouterCTokenLike {
    function underlying() external view returns (address);

    function mintFor(address beneficiary, uint256 amount) external returns (uint256);
    function borrowFor(address borrower, uint256 amount, address receiver) external returns (uint256);

    function repayBorrowFor(address payer, address borrower, uint256 amount) external returns (uint256);
    function redeemUnderlyingFor(address owner, uint256 redeemAmount, address receiver) external returns (uint256);
}

interface IRouterCEthLike {
    function mintFor(address beneficiary) external payable returns (uint256);
    function borrowFor(address borrower, uint256 amount, address payable receiver) external returns (uint256);

    function repayBorrowFor(address payer, address borrower) external payable returns (uint256);
    function redeemUnderlyingFor(address owner, uint256 redeemAmount, address payable receiver) external returns (uint256);
}

interface ISwapAdapter {
    /**
     * Code comment
     * Code comment
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver,
        bytes calldata data
    ) external payable returns (uint256 amountOut);
}

/**
 * @title CrossMarketLeverageRouter
 * Code comment
 *
 * Code comment
 * Code comment
 * Code comment
 * Code comment
 * Code comment
 *
 * Code comment
 * Code comment
 * Code comment
 *
 * Code comment
 * Code comment
 * Code comment
 */
contract CrossMarketLeverageRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant NO_ERROR = 0;

    address public owner;
    IWrappedNative public immutable wrappedNative;
    IComptrollerRouterLike public comptroller;

    mapping(address => bool) public approvedSwapAdapters;

    event OwnerTransferred(address indexed oldOwner, address indexed newOwner);
    event SwapAdapterUpdated(address indexed adapter, bool approved);
    event ComptrollerUpdated(address indexed oldComptroller, address indexed newComptroller);

    event InitialSupplied(
        address indexed user,
        address indexed cToken,
        uint256 assetsIn,
        bool isNative
    );

    event LoopBorrowAndSupply(
        address indexed user,
        address indexed cTokenBorrow,
        address indexed cTokenSupply,
        uint256 borrowAmount,
        uint256 suppliedAmount,
        bool borrowIsNative,
        bool supplyIsNative
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    struct InitialSupplyParams {
        address cToken;
        uint256 amount;
        bool isNative;
        bool enterMarket;
    }

    struct LoopStep {
        address cTokenBorrow;
        bool borrowIsNative;
        uint256 borrowAmount;

        address swapAdapter;   // Code comment
        address tokenOut;      // Code comment
        uint256 minAmountOut;
        bytes swapData;

        address cTokenSupply;
        bool supplyIsNative;
        bool enterMarket;
    }

    constructor(
        address owner_,
        IWrappedNative wrappedNative_,
        IComptrollerRouterLike comptroller_
    ) {
        require(owner_ != address(0), "bad owner");
        require(address(wrappedNative_) != address(0), "bad wrapped native");
        require(address(comptroller_) != address(0), "bad comptroller");

        owner = owner_;
        wrappedNative = wrappedNative_;
        comptroller = comptroller_;
    }

    receive() external payable {}

    /*//////////////////////////////////////////////////////////////
                              OWNER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "bad owner");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnerTransferred(oldOwner, newOwner);
    }

    function setSwapAdapter(address adapter, bool approved) external onlyOwner {
        approvedSwapAdapters[adapter] = approved;
        emit SwapAdapterUpdated(adapter, approved);
    }

    function setComptroller(IComptrollerRouterLike newComptroller) external onlyOwner {
        require(address(newComptroller) != address(0), "bad comptroller");
        address old = address(comptroller);
        comptroller = newComptroller;
        emit ComptrollerUpdated(old, address(newComptroller));
    }

    /*//////////////////////////////////////////////////////////////
                                MAIN FLOW
    //////////////////////////////////////////////////////////////*/

    /**
     * Code comment
     *
     * Code comment
     * Code comment
     * Code comment
     * Code comment
     * Code comment
     * Code comment
     * Code comment
     * Code comment
     */
    function loopLeverage(
        InitialSupplyParams calldata initialSupply,
        LoopStep[] calldata steps
    ) external payable nonReentrant {
        uint256 nativeValueRemaining = msg.value;
        address[] memory marketsToEnter = new address[](steps.length + 1);
        uint256 marketCount = 0;

        // Code comment
        if (initialSupply.amount > 0) {
            if (initialSupply.isNative) {
                require(nativeValueRemaining >= initialSupply.amount, "insufficient msg.value");

                uint256 err = IRouterCEthLike(initialSupply.cToken).mintFor{value: initialSupply.amount}(msg.sender);
                require(err == NO_ERROR, "initial native mint failed");

                nativeValueRemaining -= initialSupply.amount;
            } else {
                address initialUnderlying = IRouterCTokenLike(initialSupply.cToken).underlying();
                IERC20(initialUnderlying).safeTransferFrom(msg.sender, address(this), initialSupply.amount);
                _approveIfNeeded(initialUnderlying, initialSupply.cToken, initialSupply.amount);

                uint256 err = IRouterCTokenLike(initialSupply.cToken).mintFor(msg.sender, initialSupply.amount);
                require(err == NO_ERROR, "initial erc20 mint failed");
            }

            emit InitialSupplied(msg.sender, initialSupply.cToken, initialSupply.amount, initialSupply.isNative);

            if (initialSupply.enterMarket) {
                marketsToEnter[marketCount] = initialSupply.cToken;
                marketCount++;
            }
        }

        // Code comment
        uint256 stepLen = steps.length;
        for (uint256 i = 0; i < stepLen; i++) {
            LoopStep calldata step = steps[i];

            uint256 borrowedAmount = _borrowForUser(
                msg.sender,
                step.cTokenBorrow,
                step.borrowIsNative,
                step.borrowAmount
            );

            uint256 amountToSupply;

            if (step.swapAdapter == address(0)) {
                // Code comment
                amountToSupply = borrowedAmount;
            } else {
                require(approvedSwapAdapters[step.swapAdapter], "swap adapter not approved");
                amountToSupply = _swapBorrowedAsset(step, borrowedAmount);
            }

            _supplyForUser(
                msg.sender,
                step.cTokenSupply,
                step.supplyIsNative,
                amountToSupply
            );

            if (step.enterMarket) {
                marketsToEnter[marketCount] = step.cTokenSupply;
                marketCount++;
            }

            emit LoopBorrowAndSupply(
                msg.sender,
                step.cTokenBorrow,
                step.cTokenSupply,
                step.borrowAmount,
                amountToSupply,
                step.borrowIsNative,
                step.supplyIsNative
            );
        }

        if (marketCount > 0) {
            address[] memory finalMarkets = new address[](marketCount);
            for (uint256 i = 0; i < marketCount; i++) {
                finalMarkets[i] = marketsToEnter[i];
            }
            comptroller.enterMarketsFor(msg.sender, finalMarkets);
        }

        // Code comment
        if (nativeValueRemaining > 0) {
            (bool ok, ) = payable(msg.sender).call{value: nativeValueRemaining}("");
            require(ok, "refund failed");
        }
    }

    /*//////////////////////////////////////////////////////////////
                             INTERNAL BORROW/SWAP/SUPPLY
    //////////////////////////////////////////////////////////////*/

    function _borrowForUser(
        address user,
        address cTokenBorrow,
        bool borrowIsNative,
        uint256 borrowAmount
    ) internal returns (uint256 borrowedAmount) {
        require(borrowAmount > 0, "zero borrow amount");

        if (borrowIsNative) {
            uint256 balanceBefore = address(this).balance;

            uint256 err = IRouterCEthLike(cTokenBorrow).borrowFor(
                user,
                borrowAmount,
                payable(address(this))
            );
            require(err == NO_ERROR, "native borrow failed");

            uint256 balanceAfter = address(this).balance;
            borrowedAmount = balanceAfter - balanceBefore;
        } else {
            address tokenIn = IRouterCTokenLike(cTokenBorrow).underlying();
            uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));

            uint256 err = IRouterCTokenLike(cTokenBorrow).borrowFor(
                user,
                borrowAmount,
                address(this)
            );
            require(err == NO_ERROR, "erc20 borrow failed");

            uint256 balanceAfter = IERC20(tokenIn).balanceOf(address(this));
            borrowedAmount = balanceAfter - balanceBefore;
        }

        require(borrowedAmount > 0, "nothing borrowed");
    }

    function _swapBorrowedAsset(
        LoopStep calldata step,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        require(step.swapAdapter != address(0), "missing adapter");

        address tokenIn;

        if (step.borrowIsNative) {
            // Code comment
            wrappedNative.deposit{value: amountIn}();
            tokenIn = address(wrappedNative);

            _approveIfNeeded(tokenIn, step.swapAdapter, amountIn);

            amountOut = ISwapAdapter(step.swapAdapter).swap(
                tokenIn,
                step.tokenOut,
                amountIn,
                step.minAmountOut,
                address(this),
                step.swapData
            );
        } else {
            tokenIn = IRouterCTokenLike(step.cTokenBorrow).underlying();
            _approveIfNeeded(tokenIn, step.swapAdapter, amountIn);

            amountOut = ISwapAdapter(step.swapAdapter).swap(
                tokenIn,
                step.tokenOut,
                amountIn,
                step.minAmountOut,
                address(this),
                step.swapData
            );
        }

        require(amountOut >= step.minAmountOut, "slippage too high");
    }

    function _supplyForUser(
        address user,
        address cTokenSupply,
        bool supplyIsNative,
        uint256 amount
    ) internal {
        require(amount > 0, "zero supply amount");

        if (supplyIsNative) {
            // Code comment
            uint256 ethBalance = address(this).balance;
            if (ethBalance < amount) {
                uint256 wethBalance = wrappedNative.balanceOf(address(this));
                require(wethBalance >= amount - ethBalance, "insufficient wrapped native");
                wrappedNative.withdraw(amount - ethBalance);
            }

            uint256 err = IRouterCEthLike(cTokenSupply).mintFor{value: amount}(user);
            require(err == NO_ERROR, "native supply failed");
        } else {
            address supplyUnderlying = IRouterCTokenLike(cTokenSupply).underlying();
            _approveIfNeeded(supplyUnderlying, cTokenSupply, amount);

            uint256 err = IRouterCTokenLike(cTokenSupply).mintFor(user, amount);
            require(err == NO_ERROR, "erc20 supply failed");
        }
    }

    function _approveIfNeeded(address token, address spender, uint256 amount) internal {
        uint256 allowance = IERC20(token).allowance(address(this), spender);
        if (allowance < amount) {
            IERC20(token).forceApprove(spender, type(uint256).max);
        }
    }
}