# FTGP2526_Group13_DeFinTech13
SEMTM0029: Financial Technology Group Project - Group 13
# 📦 DeFi Lending Protocol 

A simplified decentralized lending protocol 
This project demonstrates core DeFi mechanics including asset supply, borrowing, interest accrual, risk management, and price oracle integration.

---

## 🚀 Overview

This protocol allows users to:

- Deposit assets and earn interest
- Use supplied assets as collateral
- Borrow other assets
- Repay loans with accrued interest
- Interact through a unified router interface

The system is modular and designed for learning, testing, and extension.

---

## 🧱 Architecture

### 🪙 Token Layer

#### `CErc20.sol`
- ERC20-based lending token (cToken)
- Features:
  - Supply assets (`mint`)
  - Redeem assets (`redeem`)
  - Borrow assets (`borrow`)
  - Repay loans (`repay`)
- Integrates with Comptroller for risk checks

---

#### `CEth.sol`
- Native ETH version of cToken
- Uses `payable` for ETH operations
- Same functionality as `CErc20`, adapted for ETH

---

#### `CTokenBase.sol`
- Base contract for all cTokens
- Handles:
  - Interest accrual
  - Account balances
  - Borrow state tracking
- Inherited by both `CErc20` and `CEth`

---

### 🏦 Risk Management

#### `Comptroller.sol`
- Core risk control contract
- Responsibilities:
  - Market listing & management
  - Liquidity calculation
  - Borrow and redeem validation
  - Collateral factor enforcement

---

### 📈 Interest Rate Model

#### `JumpRateInterestStrategy.sol`
- Implements a **jump rate model**
- Interest rate increases with utilization
- Sharp increase after a utilization threshold (kink)

Used for:
- Borrow rate calculation
- Supply rate derivation

---

### 🔮 Price Oracle

#### `MockPriceOracle.sol`
- Mock oracle for asset pricing
- Allows:
  - Setting asset prices manually
  - Returning prices for collateral calculations

---

### 🔁 Router Layer

#### `Router.sol`
- User-facing interaction layer
- Simplifies operations:
  - Supply
  - Borrow
  - Repay
  - Redeem

**Benefits:**
- Cleaner frontend integration
- Reduced interaction complexity

---

### 🧪 Testing & Utilities

#### `MockERC20.sol`
- Mintable ERC20 token for testing

---

#### `Counter.sol`
- Simple example contract
- Demonstrates basic contract functionality

---

#### `Counter.t.sol`
- Foundry test file for `Counter`
- Demonstrates:
  - Unit testing
  - Contract interaction patterns

---

## 🔄 User Flow

1. Deposit assets → receive cTokens  
2. Use assets as collateral  
3. Borrow other assets  
4. Interest accrues over time  
5. Repay or face liquidation (if undercollateralized)

---

## ✨ Features

- Modular architecture
- Supports both ETH and ERC20 markets
- Pluggable interest rate model
- Independent risk management (Comptroller)
- Router abstraction for better UX
- Fully testable with mock components

---

## 🧠 Learning Goals

This project is ideal for understanding:

- DeFi lending protocol design
- Collateralized borrowing mechanics
- Interest rate modeling
- Liquidation and risk control
- Smart contract system architecture
