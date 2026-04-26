# ✅ DeFinTech Setup Checklist

Work through this top to bottom. Each section must be fully done before moving to the next.
Check off each box as you go. If something fails, the **Why it fails** note tells you exactly what went wrong.

---

## PART A — Prerequisites (do this before touching any code)

### A1. Node.js version
- [ ] Run `node --version` in terminal
- [ ] Must be **v18 or higher** (`v18.x`, `v20.x`, `v22.x` all fine)
- [ ] If lower, go to https://nodejs.org and install LTS version

> **Why it fails:** Next.js 14 drops support for Node below v18. You'll get a cryptic startup error.

---

### A2. MetaMask installed
- [ ] Open Chrome/Firefox/Brave
- [ ] Go to https://metamask.io and install the extension
- [ ] Create or import a wallet
- [ ] Write down your seed phrase somewhere safe (not digitally)

> **Why it fails:** The app reads `window.ethereum`. Without MetaMask, that object doesn't exist and every wallet function throws "MetaMask not found".

---

### A3. Sepolia network in MetaMask
- [ ] Open MetaMask → click the network dropdown (top left)
- [ ] If Sepolia is not listed: Settings → Advanced → turn on **"Show test networks"**
- [ ] Switch to **Sepolia Test Network**
- [ ] Confirm Chain ID shows **11155111**

> **Why it fails:** The app checks `chainId === 11155111`. Wrong network shows the "Switch to Sepolia" warning and blocks all transactions.

---

### A4. Sepolia ETH in your wallet
- [ ] Copy your MetaMask wallet address
- [ ] Go to https://sepoliafaucet.com (requires Alchemy account, free)
- [ ] OR go to https://faucet.quicknode.com/ethereum/sepolia (no account needed)
- [ ] Request Sepolia ETH — you need at least **0.1 ETH** for deployment gas
- [ ] Confirm balance appears in MetaMask (can take 1–2 minutes)

> **Why it fails:** Deploying 7 contracts costs gas. Zero balance = every deployment tx fails immediately.

---

### A5. Alchemy account + API key
- [ ] Go to https://dashboard.alchemy.com and create a free account
- [ ] Create a new app → select **Ethereum** → select **Sepolia**
- [ ] Click **"API Key"** and copy the HTTPS endpoint
  - It looks like: `https://eth-sepolia.g.alchemy.com/v2/abc123xyz...`
- [ ] Keep this tab open — you'll need this URL twice (Hardhat + frontend)

> **Why it fails:** Without an RPC URL, the read-only provider in `lib/ethers.ts` throws on startup. The Markets page, Dashboard, all go blank.

---

## PART B — Hardhat Project (deploy contracts first)

### B1. Copy deploy script into your Hardhat project
- [ ] From `defi-frontend/scripts/deploy.ts` → copy to `<your-hardhat-project>/scripts/deploy.ts`
- [ ] From `defi-frontend/scripts/hardhat.config.ts` → **merge** into your existing `hardhat.config.ts`
  - Add the `sepolia` network block and `etherscan` block
  - Do NOT replace your whole config — just add those sections

---

### B2. Verify your Solidity contract names match the deploy script
The deploy script uses these exact names in `getContractFactory()` — they must match your `.sol` filenames:

- [ ] `"MockPriceOracle"` → your file is `MockPriceOracle.sol`
- [ ] `"JumpRateInterestStrategy"` → your file is `JumpRateInterestStrategy.sol`
- [ ] `"Comptroller"` → your file is `Comptroller.sol`
- [ ] `"CEth"` → your file is `CEth.sol`
- [ ] `"CErc20"` → your file is `CErc20.sol`
- [ ] `"CrossMarketLeverageRouter"` → your file is `Router.sol` — **but the contract name inside it must be `CrossMarketLeverageRouter`**

> Check your `Router.sol` — open it and look at `contract XYZ {`. The name after `contract` is what Hardhat uses, not the filename. If it's different, update the deploy script line:
> ```typescript
> // Change this:
> const RouterFactory = await ethers.getContractFactory("CrossMarketLeverageRouter");
> // To whatever your contract is actually named:
> const RouterFactory = await ethers.getContractFactory("Router"); // or whatever it is
> ```

---

### B3. Verify constructor arguments match your contracts
**This is the most likely place things break.** Open each `.sol` file and check the constructor matches:

- [ ] **JumpRateInterestStrategy** constructor — open `JumpRateInterestStrategy.sol`
  - Deploy script passes: `(baseRate, multiplier, jumpMultiplier, kink, deployer.address)`
  - If your constructor has different params or different order → fix the deploy script

- [ ] **Comptroller** constructor — open `Comptroller.sol`
  - Deploy script passes: `(deployer.address, oracleAddr, closeFactor, liquidationIncentive)`
  - Adjust if yours is different

- [ ] **CEth** constructor — open `CEth.sol`
  - Deploy script passes: `(deployer, name, symbol, comptroller, strategy, exchangeRate, reserveFactor, borrowRateMax)`

- [ ] **CErc20** constructor — open `CErc20.sol`
  - Deploy script passes: `(deployer, underlying, name, symbol, comptroller, strategy, exchangeRate, reserveFactor, borrowRateMax)`

- [ ] **Router** constructor — open `Router.sol`
  - Deploy script passes: `(deployer, WETH_ADDRESS, comptrollerAddr)`

---

### B4. Verify post-deploy function names match your contracts
These function calls happen after deployment. Open each contract and confirm the function names exist:

- [ ] `oracle.setUnderlyingPrice(cTokenAddr, price)` — check `MockPriceOracle.sol`
- [ ] `comptroller._supportMarket(cTokenAddr, collateralFactor)` — check `Comptroller.sol`
- [ ] `cToken.setRouter(routerAddr, true)` — check `CTokenBase.sol` or `CErc20.sol`

> If the function name is different in your contract, update the deploy script. For example if it's `addMarket()` not `_supportMarket()`, change that line.

---

### B5. Create the Hardhat secrets file
- [ ] In your Hardhat project root, create `.env.sepolia` (not `.env`)
- [ ] Add these three lines:
```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY_HERE
DEPLOYER_PRIVATE_KEY=your_wallet_private_key_without_0x_prefix
ETHERSCAN_API_KEY=your_etherscan_key_here
```
- [ ] To get your private key: MetaMask → three dots → Account Details → Export Private Key
- [ ] Remove the `0x` prefix from the private key before pasting
- [ ] Etherscan key: https://etherscan.io/myapikey (free account, optional but needed for verification)
- [ ] Confirm `.env.sepolia` is in your `.gitignore`

> **Why it fails:** Without the private key, Hardhat has no signer and deployment throws "no accounts" error.

---

### B6. Install Hardhat dependencies (if not done)
- [ ] In your Hardhat project root: `npm install`
- [ ] Confirm `@nomicfoundation/hardhat-toolbox` is installed
- [ ] Confirm `dotenv` is installed — if not: `npm install dotenv`

---

### B7. Compile contracts
```bash
npx hardhat compile
```
- [ ] Runs with no errors
- [ ] `artifacts/` folder is created
- [ ] If you see "Source file requires different compiler version" → check `solidity.version` in your `hardhat.config.ts` matches your `.sol` pragma

---

### B8. Deploy to Sepolia
```bash
npx hardhat run scripts/deploy.ts --network sepolia
```
- [ ] Terminal shows each step: `1. Deploying MockPriceOracle… ✓`
- [ ] All 7 contracts deploy successfully
- [ ] Post-deploy config steps complete (prices set, markets listed, router approved)
- [ ] Terminal prints a block of `NEXT_PUBLIC_*=0x...` addresses at the end
- [ ] **Copy that entire block — you need it for Part C**

> **If a step fails mid-way:** The already-deployed contracts stay on chain. Note their addresses from the terminal output, then re-run only the remaining steps manually or redeploy fresh (costs a tiny bit more gas but is simpler).

---

### B9. Verify on Etherscan (optional but recommended)
```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```
- [ ] Go to https://sepolia.etherscan.io and search each address
- [ ] Confirm each shows "Contract" tab with source code
- [ ] This isn't required to run the frontend — skip if you're in a hurry

---

## PART C — Frontend Project Setup

### C1. Place the frontend folder
- [ ] The `defi-frontend/` folder should sit **separately** from your Hardhat project
  ```
  your-workspace/
  ├── hardhat-project/     ← your existing contracts
  └── defi-frontend/       ← the frontend (this folder)
  ```
- [ ] Do NOT put `defi-frontend/` inside the Hardhat project

---

### C2. Install frontend dependencies
```bash
cd defi-frontend
npm install
```
- [ ] Runs without errors
- [ ] `node_modules/` folder is created
- [ ] Confirm ethers v6 installed: `npm list ethers` should show `ethers@6.x.x`

> **Why it fails:** If you see peer dependency warnings about React, that's fine — ignore them. If you see a hard error, delete `node_modules/` and `package-lock.json` then re-run `npm install`.

---

### C3. Create `.env.local`
- [ ] In `defi-frontend/`, copy the template: `cp .env.example .env.local`
- [ ] Open `.env.local` and fill in every value:

```env
# From Alchemy dashboard (same key as Hardhat)
NEXT_PUBLIC_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY

NEXT_PUBLIC_CHAIN_ID=11155111
NEXT_PUBLIC_CHAIN_NAME=Sepolia

# Paste the addresses printed by the deploy script
NEXT_PUBLIC_COMPTROLLER_ADDRESS=0x...
NEXT_PUBLIC_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_ORACLE_ADDRESS=0x...
NEXT_PUBLIC_INTEREST_STRATEGY_ADDRESS=0x...
NEXT_PUBLIC_CETH_ADDRESS=0x...
NEXT_PUBLIC_CUSDC_ADDRESS=0x...
NEXT_PUBLIC_CDAI_ADDRESS=0x...

# These are fixed Sepolia token addresses — already correct in the template
NEXT_PUBLIC_USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
NEXT_PUBLIC_DAI_ADDRESS=0x3e622317f8C93f7328350cF0B56d9eD4C620C5d6

NEXT_PUBLIC_EXPLORER_URL=https://sepolia.etherscan.io
```

- [ ] No address should still be `0x0000000000000000000000000000000000000000`
- [ ] No value should be blank
- [ ] No spaces around the `=` sign
- [ ] File is named exactly `.env.local` (not `.env.local.txt` or `env.local`)

> **Why it fails:** Next.js reads this file at startup. Any missing `NEXT_PUBLIC_` variable silently becomes `undefined`, and the contract address becomes the string `"undefined"` which causes every RPC call to fail with a confusing error.

---

### C4. Run the development server
```bash
npm run dev
```
- [ ] Terminal shows `▲ Next.js 14.x.x`
- [ ] Terminal shows `✓ Ready in Xs`
- [ ] No red error output in terminal
- [ ] Open http://localhost:3000 in browser
- [ ] Page loads (even if it shows "Connect your wallet" — that's correct)

---

## PART D — Browser & Wallet Checks

### D1. Connect wallet
- [ ] Click **"Connect Wallet"** in the navbar
- [ ] MetaMask popup appears asking permission
- [ ] Click **Connect** in MetaMask
- [ ] Navbar shows your address as `0xAbc…1234` with a green dot

> **If MetaMask doesn't pop up:** Check browser console (F12 → Console) for errors. Common cause: ad blocker blocking MetaMask injection.

---

### D2. Network check
- [ ] After connecting, navbar should NOT show "Switch to Sepolia"
- [ ] If it does show that warning, click it → MetaMask will prompt → click Switch
- [ ] Green dot + address = correct network confirmed

---

### D3. Markets page loads data
- [ ] Go to http://localhost:3000/markets
- [ ] Three market cards appear (ETH, USDC, DAI)
- [ ] Cards show APY numbers (may be 0% if no borrows yet — that's fine)
- [ ] Utilization bars render
- [ ] Price shows a number (not `$0.00` or `NaN`)

> **If cards show 0 or NaN for everything:** Your RPC URL is wrong, or contract addresses are wrong in `.env.local`. Check browser console for the actual RPC error.

> **If page is blank/white:** Open browser console (F12). Look for a red error. Most common: `"call revert exception"` means a contract address is wrong. `"could not detect network"` means your RPC URL is wrong.

---

### D4. Dashboard shows your positions
- [ ] Go to http://localhost:3000
- [ ] Wallet connected + correct network
- [ ] Shows "Total Supplied: $0.00", "Total Borrowed: $0.00" (correct for a fresh wallet)
- [ ] Health Factor shows `∞` (correct — nothing borrowed yet)
- [ ] Three market rows appear in the positions table

---

### D5. Supply page works
- [ ] Go to http://localhost:3000/supply
- [ ] Select ETH market
- [ ] Wallet balance shows your Sepolia ETH amount (not 0)
- [ ] Enter `0.01` in the amount field
- [ ] USD estimate appears below the input
- [ ] Click **"Supply ETH"**
- [ ] MetaMask popup appears with transaction details
- [ ] Click Confirm in MetaMask
- [ ] Toast notification appears: "Confirming…" then "Supply successful!"
- [ ] Your cETH balance updates on the page

---

### D6. Enable collateral
- [ ] After supplying, toggle switch appears: "Use as Collateral"
- [ ] Click the toggle → MetaMask popup → Confirm
- [ ] Toggle turns green
- [ ] Go to Dashboard → Health Factor changes from `∞` to a number

---

### D7. Borrow page works
- [ ] Go to http://localhost:3000/borrow
- [ ] "Available to borrow" shows a non-zero USD amount
- [ ] Select USDC market
- [ ] Enter a small amount (e.g. `1` USDC)
- [ ] Health factor preview updates below the input
- [ ] Click **"Borrow USDC"** → MetaMask → Confirm
- [ ] Toast: "Borrow successful!"
- [ ] Dashboard now shows borrowed balance

---

### D8. Repay works
- [ ] Go to http://localhost:3000/borrow → click **Repay** tab
- [ ] Your borrowed balance shows correctly
- [ ] Check "Repay full balance"
- [ ] Click **"Repay USDC"**
- [ ] MetaMask shows **two popups**: first Approve (ERC20 allowance), then Repay
- [ ] Confirm both
- [ ] Borrowed balance returns to 0

> **Important:** ERC20 repay always needs an approval transaction first. ETH repay does not. This is normal behaviour — not a bug.

---

## PART E — Common Errors & Fixes

| Error in browser console | Cause | Fix |
|---|---|---|
| `MetaMask not found` | Extension not installed or disabled | Install MetaMask, refresh page |
| `could not detect network` | Wrong or missing RPC URL | Fix `NEXT_PUBLIC_RPC_URL` in `.env.local` |
| `call revert exception` | Wrong contract address | Check all `NEXT_PUBLIC_*_ADDRESS` values in `.env.local` |
| `user rejected transaction` | You clicked Reject in MetaMask | Normal — just try again |
| `insufficient funds` | Not enough Sepolia ETH for gas | Get more from faucet |
| `execution reverted: mint not allowed` | Market not listed in Comptroller | Re-run the `_supportMarket` step in deploy script |
| `execution reverted: not approved router` | Router not approved in cToken | Re-run the `setRouter` step in deploy script |
| `NEXT_PUBLIC_*` is `undefined` | `.env.local` not created or wrong name | Confirm file is `.env.local` not `.env` |
| Page blank after `npm run dev` | Build error | Check terminal output — look for TypeScript errors |
| `Module not found` error | `npm install` not run | Run `npm install` inside `defi-frontend/` |
| MetaMask popup doesn't appear | Ad blocker or browser blocking | Disable ad blocker for localhost |

---

## PART F — Final Sanity Check

Run through this once everything is set up:

- [ ] `npm run build` completes with no errors (proves it's production-ready)
- [ ] All 4 pages load: `/`, `/markets`, `/supply`, `/borrow`
- [ ] Wallet connects and shows correct address
- [ ] Market data loads on `/markets`
- [ ] Supply → Enable Collateral → Borrow → Repay full cycle works end to end
- [ ] Each transaction shows a toast with an Etherscan link
- [ ] Etherscan link opens and shows the confirmed transaction

---

## Quick Reference — Key URLs

| Resource | URL |
|---|---|
| Local app | http://localhost:3000 |
| Sepolia Etherscan | https://sepolia.etherscan.io |
| Sepolia faucet | https://sepoliafaucet.com |
| Alchemy dashboard | https://dashboard.alchemy.com |
| MetaMask download | https://metamask.io |

## Quick Reference — Key Commands

```bash
# Frontend
cd defi-frontend
npm install          # install dependencies
npm run dev          # start dev server at localhost:3000
npm run build        # production build (good sanity check)
npm run lint         # check for code issues

# Hardhat (run from your hardhat project root)
npx hardhat compile                                    # compile contracts
npx hardhat run scripts/deploy.ts --network sepolia    # deploy
npx hardhat verify --network sepolia <addr> <args>     # verify on Etherscan
```
