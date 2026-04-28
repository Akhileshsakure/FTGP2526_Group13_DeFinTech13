// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAdvancedComptroller {
    function enterMarketsFor(address account, address[] calldata cTokens) external returns (uint256[] memory);
    function oracle() external view returns (address);
}

interface IAdvancedOracle {
    function getUnderlyingPrice(address cToken) external view returns (uint256);
}

interface IAdvancedCToken is IERC20 {
    function underlying() external view returns (address);
    function mintFor(address beneficiary, uint256 amount) external returns (uint256);
    function borrowFor(address borrower, uint256 amount, address payable receiver) external returns (uint256);
    function repayBorrowFor(address payer, address borrower, uint256 amount) external returns (uint256);
    function redeemUnderlyingFor(address owner, uint256 redeemAmount, address payable receiver) external returns (uint256);
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function getCashPrior() external view returns (uint256);
    function borrowBalanceStored(address account) external view returns (uint256);
    function borrowBalanceCurrent(address account) external returns (uint256);
}

interface IAdvancedCEth is IERC20 {
    function mintFor(address beneficiary, uint256 amount) external payable returns (uint256);
    function borrowFor(address borrower, uint256 amount, address payable receiver) external returns (uint256);
    function repayBorrowFor(address payer, address borrower, uint256 amount) external payable returns (uint256);
    function redeemUnderlyingFor(address owner, uint256 redeemAmount, address payable receiver) external returns (uint256);
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function getCashPrior() external view returns (uint256);
    function borrowBalanceStored(address account) external view returns (uint256);
    function borrowBalanceCurrent(address account) external returns (uint256);
}

contract AdvancedLendingProtocol is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant WAD = 1e18;
    uint256 public constant NO_ERROR = 0;

    address public owner;
    IAdvancedComptroller public comptroller;
    bool public emergencyShutdown;

    uint256 public scheduledDelay;
    uint256 public earlyExitPenaltyMantissa;
    uint256 public instantRedemptionFeeMantissa;
    uint256 public stressedInstantRedemptionFeeMantissa;
    uint256 public instantLiquidityThresholdMantissa;
    address public feeRecipient;

    uint256 public nextPositionId = 1;
    uint256 public nextRedemptionBatchId = 1;

    struct Position {
        address owner;
        address collateralMarket;
        address debtMarket;
        uint256 collateralAmount;
        uint256 debtPrincipal;
        uint256 collateralEntryPrice;
        uint256 debtEntryPrice;
        bool collateralIsNative;
        bool debtIsNative;
        bool open;
    }

    struct RedemptionBatch {
        address market;
        bool isNative;
        uint256 readyAt;
        uint256 totalCTokens;
        uint256 totalUnderlyingRequested;
        uint256 totalUnderlyingRedeemed;
        bool processed;
    }

    struct RedemptionRequest {
        address owner;
        uint256 batchId;
        uint256 cTokens;
        uint256 underlyingRequested;
        bool cancelled;
        bool claimed;
    }

    mapping(uint256 => Position) public positions;
    mapping(uint256 => RedemptionBatch) public redemptionBatches;
    mapping(uint256 => RedemptionRequest) public redemptionRequests;
    mapping(address => bool) public marketIsNative;
    mapping(address => uint256) public activeRedemptionBatch;
    uint256 public nextRedemptionRequestId = 1;

    event OwnerTransferred(address indexed oldOwner, address indexed newOwner);
    event EmergencyShutdownSet(bool enabled);
    event MarketNativeFlagSet(address indexed market, bool isNative);
    event RedemptionConfigUpdated(uint256 delay, uint256 earlyExitPenalty, uint256 instantFee, uint256 stressedFee);
    event PositionOpened(uint256 indexed positionId, address indexed user, address collateralMarket, address debtMarket, uint256 collateralAmount, uint256 debtAmount);
    event PositionClosed(uint256 indexed positionId, address indexed user, uint256 repaidAmount, uint256 collateralRedeemed);
    event InstantRedeemed(address indexed user, address indexed market, uint256 grossAmount, uint256 feeAmount);
    event ScheduledRedemptionRequested(uint256 indexed requestId, uint256 indexed batchId, address indexed user, address market, uint256 cTokens, uint256 underlyingRequested);
    event ScheduledRedemptionCancelled(uint256 indexed requestId, uint256 penaltyCTokens);
    event RedemptionBatchProcessed(uint256 indexed batchId, uint256 executableUnderlying, uint256 totalRequested);
    event ScheduledRedemptionClaimed(uint256 indexed requestId, address indexed user, uint256 underlyingPaid);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier whenOpeningAllowed() {
        require(!emergencyShutdown, "emergency shutdown");
        _;
    }

    constructor(
        address owner_,
        IAdvancedComptroller comptroller_,
        uint256 scheduledDelay_,
        address feeRecipient_
    ) {
        require(owner_ != address(0), "bad owner");
        require(address(comptroller_) != address(0), "bad comptroller");
        require(feeRecipient_ != address(0), "bad fee recipient");
        owner = owner_;
        comptroller = comptroller_;
        scheduledDelay = scheduledDelay_;
        feeRecipient = feeRecipient_;
        earlyExitPenaltyMantissa = 0.02e18;
        instantRedemptionFeeMantissa = 0.001e18;
        stressedInstantRedemptionFeeMantissa = 0.01e18;
        instantLiquidityThresholdMantissa = 0.25e18;
    }

    receive() external payable {}

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "bad owner");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnerTransferred(oldOwner, newOwner);
    }

    function setEmergencyShutdown(bool enabled) external onlyOwner {
        emergencyShutdown = enabled;
        emit EmergencyShutdownSet(enabled);
    }

    function setMarketNative(address market, bool isNative) external onlyOwner {
        require(market != address(0), "bad market");
        marketIsNative[market] = isNative;
        emit MarketNativeFlagSet(market, isNative);
    }

    function setRedemptionConfig(
        uint256 scheduledDelay_,
        uint256 earlyExitPenaltyMantissa_,
        uint256 instantRedemptionFeeMantissa_,
        uint256 stressedInstantRedemptionFeeMantissa_,
        uint256 instantLiquidityThresholdMantissa_
    ) external onlyOwner {
        require(earlyExitPenaltyMantissa_ <= WAD, "bad penalty");
        require(instantRedemptionFeeMantissa_ <= WAD, "bad fee");
        require(stressedInstantRedemptionFeeMantissa_ <= WAD, "bad stressed fee");
        require(instantLiquidityThresholdMantissa_ <= WAD, "bad threshold");
        scheduledDelay = scheduledDelay_;
        earlyExitPenaltyMantissa = earlyExitPenaltyMantissa_;
        instantRedemptionFeeMantissa = instantRedemptionFeeMantissa_;
        stressedInstantRedemptionFeeMantissa = stressedInstantRedemptionFeeMantissa_;
        instantLiquidityThresholdMantissa = instantLiquidityThresholdMantissa_;
        emit RedemptionConfigUpdated(
            scheduledDelay_,
            earlyExitPenaltyMantissa_,
            instantRedemptionFeeMantissa_,
            stressedInstantRedemptionFeeMantissa_
        );
    }

    function openPosition(
        address collateralMarket,
        bool collateralIsNative,
        uint256 collateralAmount,
        address debtMarket,
        bool debtIsNative,
        uint256 debtAmount
    ) external payable nonReentrant whenOpeningAllowed returns (uint256 positionId) {
        require(collateralAmount > 0, "zero collateral");
        require(debtAmount > 0, "zero debt");

        _supplyCollateral(collateralMarket, collateralIsNative, collateralAmount);

        address[] memory marketsToEnter = new address[](1);
        marketsToEnter[0] = collateralMarket;
        comptroller.enterMarketsFor(msg.sender, marketsToEnter);

        if (debtIsNative) {
            uint256 err = IAdvancedCEth(debtMarket).borrowFor(msg.sender, debtAmount, payable(msg.sender));
            require(err == NO_ERROR, "native borrow failed");
        } else {
            uint256 err = IAdvancedCToken(debtMarket).borrowFor(msg.sender, debtAmount, payable(msg.sender));
            require(err == NO_ERROR, "erc20 borrow failed");
        }

        IAdvancedOracle priceOracle = _oracle();
        positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: msg.sender,
            collateralMarket: collateralMarket,
            debtMarket: debtMarket,
            collateralAmount: collateralAmount,
            debtPrincipal: debtAmount,
            collateralEntryPrice: priceOracle.getUnderlyingPrice(collateralMarket),
            debtEntryPrice: priceOracle.getUnderlyingPrice(debtMarket),
            collateralIsNative: collateralIsNative,
            debtIsNative: debtIsNative,
            open: true
        });

        emit PositionOpened(positionId, msg.sender, collateralMarket, debtMarket, collateralAmount, debtAmount);
    }

    function closePosition(uint256 positionId, uint256 repayAmount, uint256 collateralToRedeem)
        external
        payable
        nonReentrant
        returns (uint256 actualRepay, uint256 redeemedCollateral)
    {
        Position storage position = positions[positionId];
        require(position.open, "position closed");
        require(position.owner == msg.sender, "not position owner");

        uint256 debtBalance = _borrowBalanceCurrent(position.debtMarket, msg.sender);
        require(debtBalance > 0, "no debt");
        actualRepay = repayAmount == type(uint256).max || repayAmount > debtBalance ? debtBalance : repayAmount;
        require(actualRepay > 0, "zero repay");

        _repayDebt(position.debtMarket, position.debtIsNative, actualRepay);

        redeemedCollateral = collateralToRedeem == type(uint256).max ? position.collateralAmount : collateralToRedeem;
        if (redeemedCollateral > position.collateralAmount) {
            redeemedCollateral = position.collateralAmount;
        }

        if (redeemedCollateral > 0) {
            _redeemCollateral(position.collateralMarket, position.collateralIsNative, redeemedCollateral);
            position.collateralAmount -= redeemedCollateral;
        }

        position.debtPrincipal = debtBalance - actualRepay;
        if (position.debtPrincipal == 0 && position.collateralAmount == 0) {
            position.open = false;
        }

        emit PositionClosed(positionId, msg.sender, actualRepay, redeemedCollateral);
    }

    function getPositionValue(uint256 positionId)
        external
        view
        returns (uint256 collateralValue, uint256 debtValue, int256 pnl)
    {
        Position memory position = positions[positionId];
        require(position.owner != address(0), "position missing");

        IAdvancedOracle priceOracle = _oracle();
        uint256 collateralPrice = priceOracle.getUnderlyingPrice(position.collateralMarket);
        uint256 debtPrice = priceOracle.getUnderlyingPrice(position.debtMarket);
        uint256 currentDebt = _borrowBalance(position.debtMarket, position.owner);

        collateralValue = (position.collateralAmount * collateralPrice) / WAD;
        debtValue = (currentDebt * debtPrice) / WAD;

        uint256 entryCollateralValue = (position.collateralAmount * position.collateralEntryPrice) / WAD;
        uint256 entryDebtValue = (position.debtPrincipal * position.debtEntryPrice) / WAD;
        int256 currentEquity = int256(collateralValue) - int256(debtValue);
        int256 entryEquity = int256(entryCollateralValue) - int256(entryDebtValue);
        pnl = currentEquity - entryEquity;
    }

    function instantRedeem(address market, bool isNative, uint256 redeemAmount)
        external
        nonReentrant
        returns (uint256 netAmount)
    {
        require(!emergencyShutdown, "instant disabled");
        require(redeemAmount > 0, "zero redeem");

        uint256 cash = _cash(market);
        require(cash >= redeemAmount, "insufficient cash");

        uint256 feeMantissa = _instantFeeFor(market, redeemAmount);
        uint256 feeAmount = (redeemAmount * feeMantissa) / WAD;
        netAmount = redeemAmount - feeAmount;

        uint256 err = isNative
            ? IAdvancedCEth(market).redeemUnderlyingFor(msg.sender, redeemAmount, payable(address(this)))
            : IAdvancedCToken(market).redeemUnderlyingFor(msg.sender, redeemAmount, payable(address(this)));
        require(err == NO_ERROR, "redeem failed");

        _payOut(market, isNative, msg.sender, netAmount);
        if (feeAmount > 0) {
            _payOut(market, isNative, feeRecipient, feeAmount);
        }

        emit InstantRedeemed(msg.sender, market, redeemAmount, feeAmount);
    }

    function requestScheduledRedemption(address market, bool isNative, uint256 cTokens)
        external
        nonReentrant
        returns (uint256 requestId, uint256 batchId)
    {
        require(cTokens > 0, "zero ctoken");
        batchId = activeRedemptionBatch[market];
        RedemptionBatch storage batch = redemptionBatches[batchId];

        if (batchId == 0 || batch.processed || block.timestamp >= batch.readyAt) {
            batchId = nextRedemptionBatchId++;
            batch = redemptionBatches[batchId];
            batch.market = market;
            batch.isNative = isNative;
            batch.readyAt = block.timestamp + scheduledDelay;
            activeRedemptionBatch[market] = batchId;
        } else {
            require(batch.market == market, "market mismatch");
            require(batch.isNative == isNative, "native mismatch");
        }

        uint256 exchangeRate = isNative
            ? IAdvancedCEth(market).exchangeRateStored()
            : IAdvancedCToken(market).exchangeRateStored();
        uint256 underlyingRequested = (cTokens * exchangeRate) / WAD;

        IERC20(market).safeTransferFrom(msg.sender, address(this), cTokens);

        batch.totalCTokens += cTokens;
        batch.totalUnderlyingRequested += underlyingRequested;

        requestId = nextRedemptionRequestId++;
        redemptionRequests[requestId] = RedemptionRequest({
            owner: msg.sender,
            batchId: batchId,
            cTokens: cTokens,
            underlyingRequested: underlyingRequested,
            cancelled: false,
            claimed: false
        });

        emit ScheduledRedemptionRequested(requestId, batchId, msg.sender, market, cTokens, underlyingRequested);
    }

    function cancelScheduledRedemption(uint256 requestId) external nonReentrant {
        RedemptionRequest storage request = redemptionRequests[requestId];
        require(request.owner == msg.sender, "not request owner");
        require(!request.cancelled && !request.claimed, "inactive request");

        RedemptionBatch storage batch = redemptionBatches[request.batchId];
        require(!batch.processed, "batch processed");

        request.cancelled = true;
        batch.totalCTokens -= request.cTokens;
        batch.totalUnderlyingRequested -= request.underlyingRequested;

        uint256 penalty = (request.cTokens * earlyExitPenaltyMantissa) / WAD;
        uint256 returnedCTokens = request.cTokens - penalty;
        IERC20(batch.market).safeTransfer(msg.sender, returnedCTokens);
        if (penalty > 0) {
            IERC20(batch.market).safeTransfer(feeRecipient, penalty);
        }

        emit ScheduledRedemptionCancelled(requestId, penalty);
    }

    function processRedemptionBatch(uint256 batchId) external nonReentrant {
        RedemptionBatch storage batch = redemptionBatches[batchId];
        require(batch.market != address(0), "batch missing");
        require(!batch.processed, "already processed");
        require(block.timestamp >= batch.readyAt || emergencyShutdown, "not ready");

        uint256 executable = _min(_cash(batch.market), batch.totalUnderlyingRequested);
        batch.processed = true;

        if (executable > 0) {
            uint256 err = batch.isNative
                ? IAdvancedCEth(batch.market).redeemUnderlying(executable)
                : IAdvancedCToken(batch.market).redeemUnderlying(executable);
            require(err == NO_ERROR, "redeem failed");
        }

        batch.totalUnderlyingRedeemed = executable;
        emit RedemptionBatchProcessed(batchId, executable, batch.totalUnderlyingRequested);
    }

    function claimScheduledRedemption(uint256 requestId) external nonReentrant returns (uint256 amountPaid) {
        RedemptionRequest storage request = redemptionRequests[requestId];
        require(request.owner == msg.sender, "not request owner");
        require(!request.cancelled && !request.claimed, "inactive request");

        RedemptionBatch memory batch = redemptionBatches[request.batchId];
        require(batch.processed, "batch not processed");

        request.claimed = true;
        if (batch.totalUnderlyingRequested > 0) {
            amountPaid = (request.underlyingRequested * batch.totalUnderlyingRedeemed) / batch.totalUnderlyingRequested;
        }

        if (amountPaid > 0) {
            _payOut(batch.market, batch.isNative, msg.sender, amountPaid);
        }

        emit ScheduledRedemptionClaimed(requestId, msg.sender, amountPaid);
    }

    function _supplyCollateral(address market, bool isNative, uint256 amount) internal {
        if (isNative) {
            require(msg.value == amount, "msg.value mismatch");
            uint256 err = IAdvancedCEth(market).mintFor{value: amount}(msg.sender, amount);
            require(err == NO_ERROR, "native mint failed");
        } else {
            require(msg.value == 0, "msg.value not allowed");
            address underlying = IAdvancedCToken(market).underlying();
            IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);
            IERC20(underlying).forceApprove(market, amount);
            uint256 err = IAdvancedCToken(market).mintFor(msg.sender, amount);
            require(err == NO_ERROR, "erc20 mint failed");
        }
    }

    function _repayDebt(address market, bool isNative, uint256 amount) internal {
        if (isNative) {
            require(msg.value >= amount, "insufficient msg.value");
            uint256 repaid = IAdvancedCEth(market).repayBorrowFor{value: amount}(msg.sender, msg.sender, amount);
            require(repaid == amount, "native repay mismatch");
            if (msg.value > amount) {
                (bool ok,) = payable(msg.sender).call{value: msg.value - amount}("");
                require(ok, "refund failed");
            }
        } else {
            require(msg.value == 0, "msg.value not allowed");
            address underlying = IAdvancedCToken(market).underlying();
            IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);
            IERC20(underlying).forceApprove(market, amount);
            uint256 repaid = IAdvancedCToken(market).repayBorrowFor(msg.sender, msg.sender, amount);
            require(repaid == amount, "erc20 repay mismatch");
        }
    }

    function _redeemCollateral(address market, bool isNative, uint256 amount) internal {
        uint256 err = isNative
            ? IAdvancedCEth(market).redeemUnderlyingFor(msg.sender, amount, payable(msg.sender))
            : IAdvancedCToken(market).redeemUnderlyingFor(msg.sender, amount, payable(msg.sender));
        require(err == NO_ERROR, "collateral redeem failed");
    }

    function _payOut(address market, bool isNative, address to, uint256 amount) internal {
        if (isNative) {
            (bool ok,) = payable(to).call{value: amount}("");
            require(ok, "native transfer failed");
        } else {
            IERC20(IAdvancedCToken(market).underlying()).safeTransfer(to, amount);
        }
    }

    function _oracle() internal view returns (IAdvancedOracle) {
        return IAdvancedOracle(comptroller.oracle());
    }

    function _borrowBalance(address market, address account) internal view returns (uint256) {
        return IAdvancedCToken(market).borrowBalanceStored(account);
    }

    function _borrowBalanceCurrent(address market, address account) internal returns (uint256) {
        return IAdvancedCToken(market).borrowBalanceCurrent(account);
    }

    function _cash(address market) internal view returns (uint256) {
        return IAdvancedCToken(market).getCashPrior();
    }

    function _instantFeeFor(address market, uint256 redeemAmount) internal view returns (uint256) {
        uint256 cash = _cash(market);
        if (cash == 0) {
            return stressedInstantRedemptionFeeMantissa;
        }
        uint256 remainingRatio = ((cash - redeemAmount) * WAD) / cash;
        if (remainingRatio < instantLiquidityThresholdMantissa) {
            return stressedInstantRedemptionFeeMantissa;
        }
        return instantRedemptionFeeMantissa;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
