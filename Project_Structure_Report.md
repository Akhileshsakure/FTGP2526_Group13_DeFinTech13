# Protocol Architecture and Structure Report

## I. Project Overview

### 1. Project Positioning
This codebase implements an advanced DeFi lending protocol prototype inspired by Aave V3 and Compound. The core architecture is structured into the following layers:
- **CToken Market Layer**: 
  - `CTokenBase.sol`: The abstract base contract containing shared logic for all markets.
  - `CErc20.sol`: The specific implementation for ERC20 token markets.
  - `CEth.sol`: The specific implementation for the native ETH market.
- **Risk Management Layer**:
  - `Comptroller.sol`: The centralized risk management engine responsible for unified collateral management, liquidity and Health Factor calculations, and liquidation eligibility.
- **Interest Rate Model Layer**:
  - `AaveInterestRateStrategy.sol`: A dynamic, dual-slope (jump rate) borrow interest rate model.
- **Strategy & Routing Layer**:
  - `Router.sol`: A multi-market recursive leverage router supporting automated borrowing, swapping, and re-supplying.
- **Oracle & Analytics Layer**:
  - `MockPriceOracle.sol`: A price oracle upgraded with historical tracking capabilities.
  - `frontend/index.html`: A web-based dashboard for real-time and historical price visualization.

### 2. Core Business Capabilities
The system supports the following standard and advanced DeFi lending operations:
- Depositing underlying assets to mint interest-bearing tokens (`mint`)
- Redeeming underlying assets (`redeem` / `redeemUnderlying`)
- Borrowing assets against collateral (`borrow`)
- Repaying loans (`repayBorrow` / `repayBorrowBehalf`)
- Health Factor-based Liquidations (`liquidateBorrow` + `seize`)
- Automated interest accrual (`accrueInterest`)
- Advanced Risk Interception (`mintAllowed`, `borrowAllowed`, etc.)
- Single-market leverage adjustments (`leverageUp` / `deleverage`)
- Multi-market recursive leverage (`Router.loopLeverage`)

### 3. System Invocation Relationships
The internal interaction flow operates as follows:
- `CErc20` and `CEth` inherit from `CTokenBase`.
- Before executing any critical state change (e.g., minting, borrowing, redeeming), `CTokenBase` calls the `Comptroller` for strict risk control validation.
- During interest accrual, `CTokenBase` queries `AaveInterestRateStrategy` to dynamically fetch the current borrow rate based on market utilization.
- `Router` acts on behalf of users, calling market contracts' extended interfaces (`mintFor`, `borrowFor`, etc.) to execute complex strategies.
- `Comptroller` fetches prices from `MockPriceOracle` to calculate account liquidity, Health Factors, and liquidation seize amounts.

### 4. Key Design Characteristics
This implementation possesses several robust features:
- **Aave V3 Risk Mechanics**: Incorporates advanced risk controls, including decoupled LTV and Liquidation thresholds, strict supply/borrow caps, and comprehensive Health Factor evaluations.
- **Emergency Circuit Breakers**: Administrators can trigger market pauses to halt operations during extreme volatility or identified exploits.
- **Separation of ERC20 and ETH Markets**: Dedicated handling prevents critical vulnerabilities related to `msg.value` mishandling.
- **Centralized Risk Control**: All security, membership, and solvency checks are strictly localized within the `Comptroller`.
- **Automated Leverage Execution**: The `Router` allows users to execute complex, multi-step leveraged positions in a single atomic transaction.

---

## II. Contract-Level Functional Breakdown

### 1. CTokenBase.sol
#### Contract Role
The abstract base class for all lending markets. It defines the core logic for interest accumulation, exchange rate calculation, user interactions (deposit/borrow), liquidations, reserve management, and administrator privileges. It abstracts the underlying asset transfers using `getCashPrior()`, `doTransferIn()`, and `doTransferOut()`, which are explicitly implemented by its child contracts.

#### Key Functions
- **State Queries**: `totalBorrowsCurrent()`, `exchangeRateCurrent()`, `borrowBalanceCurrent()` proactively accrue interest before returning the latest state.
- **Interest Calculation**: `accrueInterest()` updates the market state (total borrows, reserves, and borrow index) based on the time elapsed and the current utilization rate.
- **Deposit/Mint**: `mint()` and `_mintFresh()` handle asset intake and cToken issuance after passing Comptroller authorization.
- **Redemption**: `redeem()` and `redeemUnderlying()` process asset withdrawals and cToken burning, ensuring the user maintains a safe Health Factor.
- **Borrow & Repay**: `borrow()` and `repayBorrow()` manage the issuance and clearance of user debt.
- **Leverage Extensions**: `leverageUp()` and `deleverage()` allow single-market leverage adjustments natively without requiring external flash loans.
- **Liquidation**: `liquidateBorrow()` and `seize()` process third-party debt repayment and the subsequent transfer of collateral.
- **Router Extensions**: `mintFor()`, `borrowFor()`, `repayBorrowFor()` permit approved routers to execute logic safely on a user's behalf.

### 2. CErc20.sol
#### Contract Role
The ERC20 underlying asset market implementation.
#### Key Functions
- `doTransferIn()`: Safely transfers ERC20 tokens from the user. It utilizes a "balance before vs. balance after" check to ensure compatibility with fee-on-transfer tokens.
- `doTransferOut()`: Handles standard ERC20 outbound transfers.

### 3. CEth.sol
#### Contract Role
The native ETH market implementation. Unlike `CErc20`, it processes `msg.value` directly and utilizes `payable` function modifiers.
#### Key Functions
- `receive()`: Allows the market to securely accept raw ETH.
- `doTransferIn()`: Strictly verifies that `msg.value` matches the requested deposit or repayment amount.
- **ETH-Specific Overrides**: Functions such as `mint()`, `repayBorrow()`, and `leverageUp()` are uniquely adapted for `msg.value`. Standard ERC20-style functions from the base contract are explicitly overridden to `revert`, preventing user errors and lost funds.

### 4. Comptroller.sol (Risk Management Core)
#### Contract Role
The centralized risk management brain of the protocol. It handles market listing, collateral qualifications, user market entry, solvency checks, and liquidation mathematics.

#### Advanced Aave Features (Upgraded)
- **Supply and Borrow Caps**: Enforces absolute limits on total deposits and borrows per market, containing systemic risk from oversized single-asset exposure.
- **LTV vs. Liquidation Threshold**: Decouples the maximum borrowing limit (LTV) from the threshold that triggers liquidation, providing a necessary safety buffer for borrowers against minor price fluctuations.
- **Health Factor**: Upgraded from simple liquidity checks. A Health Factor strictly evaluated against a 1.0 threshold determines liquidation eligibility.
- **Emergency Market Pause**: The `_setMarketPause` functionality allows administrators to instantly halt minting, borrowing, redeeming, and liquidating for specific markets during emergencies.

#### Key Functions
- **Admin**: `_supportMarket()`, `_setCollateralFactor()`, `_setCloseFactor()`, `_setLiquidationIncentive()`.
- **Market Membership**: `enterMarkets()`, `exitMarket()`.
- **Risk Hooks**: `mintAllowed()`, `borrowAllowed()`, `redeemAllowed()`, `liquidateBorrowAllowed()`. These are called by markets prior to execution.
- **Liquidity & Solvency**: `getAccountLiquidity()` and `getHypotheticalAccountLiquidity()` simulate the impact of transactions on user solvency.
- **Liquidation Math**: `liquidateCalculateSeizeTokens()` calculates the collateral payout for liquidators, factoring in oracle prices and liquidation incentives.

### 5. AaveInterestRateStrategy.sol
#### Contract Role
A dynamic, dual-slope interest rate model. It adjusts borrow rates based on capital utilization:
- Below the optimal utilization ratio (kink), rates grow slowly and linearly to encourage borrowing and maximize capital efficiency.
- Above the optimal utilization ratio, the slope steepens drastically. This aggressive rate hike encourages borrowers to repay and incentivizes new depositors, thereby protecting protocol liquidity.

### 6. Router.sol (CrossMarketLeverageRouter)
#### Contract Role
A strategy execution module that facilitates complex, multi-step leveraged positions across different markets within a single transaction, significantly improving UX.
#### Key Functions
- `loopLeverage()`: Executes the multi-step leverage loop. It processes the initial deposit, iteratively borrows assets, swaps them via an external adapter, re-supplies them into target markets, and finally registers the supplied markets to the user's collateral portfolio.
- **Internal Routing**: Operations are securely handled by `_borrowForUser()`, `_swapBorrowedAsset()`, and `_supplyForUser()`.

### 7. MockPriceOracle & Frontend Dashboard
#### Contract & System Role
Provides critical pricing data to the Comptroller and historical analytics to the frontend interface.
- **MockPriceOracle.sol**: Upgraded to store an array of historical price records mapped to block timestamps, moving beyond single-point price delivery.
- **Frontend Integration (`frontend/index.html`)**: A web-based dashboard utilizing `Ethers.js` and `Chart.js`. It connects to the local blockchain node, fetches the oracle's on-chain history array, and dynamically renders realistic price trends, demonstrating complete full-stack protocol observability.
