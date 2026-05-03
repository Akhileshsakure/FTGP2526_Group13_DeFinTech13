# FTGP2526 Group 13 - DeFinTech

SEMTM0029 Financial Technology Group Project - Group 13

## Overview

This project implements a simplified DeFi lending protocol with a Next.js frontend and Solidity smart contracts. Users can connect a Sepolia wallet, view lending markets, supply assets, enable collateral, borrow against collateral, repay debt, withdraw supplied assets, and review account activity.

The frontend is designed to reduce unnecessary RPC load. Public market data, price history, TVL, APY, and transaction history are served through cached API routes. User-sensitive actions still use live wallet and contract reads before transaction submission, and the final risk checks are enforced by the Comptroller contract on-chain.

## Current User-Facing Features

- Wallet connection and Sepolia network validation
- Dashboard with supplied value, borrowed value, net APY, health factor, positions, and transaction history
- Markets page with market liquidity, APY, TVL, prices, and cached update time
- Supply page for selected-market supply, collateral enable/disable, and redeem checks
- Borrow page for selected-market borrow and repay actions
- Transaction history panel with cached user activity and Etherscan links
- Admin page at `/admin`, restricted to the Comptroller admin address

## Frontend Pages

### Dashboard

The dashboard summarises the connected wallet's protocol activity. It uses cached market data and reads user positions across the supported markets to show account-level totals, net APY, and health factor.

### Markets

The markets page displays public protocol data including asset prices, supply APY, borrow APY, total supplied, total borrowed, TVL, and price history. This data is cached for a short period to reduce repeated RPC calls during demonstrations.

### Supply

The supply page reads the selected market, the connected wallet balance, and the user's current position in that market. Before redeeming, the frontend calls the Comptroller's hypothetical liquidity check so the UI reflects the same risk logic used by the smart contracts. Final enforcement still happens on-chain.

### Borrow

The borrow page reads the selected market, wallet balance, current debt for that market, and global account liquidity from the Comptroller. Before borrowing, it checks whether the proposed borrow would leave enough collateral. Final borrow validation is performed by the Comptroller contract.

### Transactions

The transactions page shows recent Supply, Withdraw, Borrow, Repay, and collateral events for the connected wallet. Transaction data is cached and includes the latest update time so users can see when the displayed data was refreshed.

### Admin

The admin page is not linked from the main navigation and is available only at `/admin`. It checks the connected wallet against `Comptroller.admin()` before rendering controls. The page supports operational contract settings such as market risk parameters, caps, pause controls, reserve factors, interest strategy configuration, close factor, and oracle updates.

## Smart Contract Architecture

### CToken Markets

- `CErc20.sol`: ERC20 lending market for mint, redeem, borrow, and repay operations.
- `CEth.sol`: ETH lending market using payable ETH operations.
- `CTokenBase.sol`: Shared accounting, interest accrual, supply balances, and borrow balances.

### Risk Management

- `Comptroller.sol`: Lists markets, validates collateral usage, calculates account liquidity, checks borrow and redeem safety, manages market parameters, and enforces protocol risk controls.

### Interest Rate Models

- `JumpRateInterestStrategy.sol`: Utilisation-based jump rate model with a kink point.
- `AaveInterestRateStrategy.sol`: Alternative interest rate strategy included for comparison and extension.

### Price Oracles

- `ChainlinkPriceOracle.sol`: Oracle adapter for Chainlink-style price feeds.
- `MockPriceOracle.sol` and `MockV3Aggregator.sol`: Testing and local demonstration price feeds.

### Testing and Mock Assets

- `MockERC20.sol`: Mintable ERC20 token for testing.
- `Counter.sol` and `Counter.t.sol`: Basic example contract and Foundry test scaffold.

### Router Contract

`Router.sol` is included in the contract folder as an integration helper, but it is not currently exposed as a user-facing frontend feature. The live frontend interacts directly with the market contracts and Comptroller checks.

## Development Commands

Install frontend dependencies:

```bash
cd frontend
npm install
```

Run the frontend:

```bash
cd frontend
npm run dev
```

Build the frontend:

```bash
cd frontend
npm run build
```

Run frontend unit tests:

```bash
cd frontend
npm test
```

## Notes for Evaluation

- Public protocol data is cached to improve stability under RPC rate limits.
- Supply and Borrow pages deliberately use selected-market reads for faster interaction.
- Global risk enforcement is performed on-chain by the Comptroller, not by frontend-only calculations.
- The Admin page is restricted by the actual on-chain admin address.
