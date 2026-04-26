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
     * @notice 执行 swap，返回实际输出数量
     * @dev Router 会先把 tokenIn 授权给 adapter
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
 * @notice 多市场循环加杠杆路由器
 *
 * 支持：
 * - ERC20 市场
 * - Native ETH 市场
 * - 借出后 swap，再存入另一个市场
 * - 多轮循环 leverage
 *
 * 不直接负责：
 * - 风控判断（由 Comptroller / CToken 完成）
 * - 定价（由 oracle / Comptroller 完成）
 *
 * 重要：
 * - 这份代码依赖市场合约开放 router 专用接口
 * - 如果你不改前面的市场合约，这个 Router 不能真正代用户建仓
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

        address swapAdapter;   // 如果不需要 swap，就传 address(0)
        address tokenOut;      // 目标 token（不 swap 时可忽略）
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
     * @notice 多市场循环加杠杆
     *
     * 流程：
     * 1. 用户先给第一市场存入初始保证金
     * 2. 可选 enter initial market
     * 3. 逐轮：
     *    - 从 cTokenBorrow 代用户借款，资产先打到 Router
     *    - 如需 swap，则换成目标资产
     *    - 再存入 cTokenSupply，cToken 直接 mint 给用户
     *    - 可选把 cTokenSupply 加入用户抵押市场
     */
    function loopLeverage(
        InitialSupplyParams calldata initialSupply,
        LoopStep[] calldata steps
    ) external payable nonReentrant {
        uint256 nativeValueRemaining = msg.value;
        address[] memory marketsToEnter = new address[](steps.length + 1);
        uint256 marketCount = 0;

        // 1) 初始保证金
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

        // 2) 循环杠杆
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
                // 不 swap，要求借出资产能直接存入目标市场
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

        // 3) 退回没用掉的 ETH
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
            // 统一把 ETH wrap 成 WETH 再交给 swap adapter
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
            // 如果手里是 WETH，则先 unwrap
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