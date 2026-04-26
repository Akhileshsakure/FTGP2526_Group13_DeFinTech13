# Aave Protocol Oracle Dashboard - Setup Guide

This guide explains how to run the local blockchain, inject historical price data into the oracle, and start the frontend dashboard to visualize the price chart.

## Prerequisites
- Node.js installed
- Python 3 installed (for the local web server)

## Step 1: Start the Local Blockchain
Open a new terminal, navigate to the `contract` directory, and start the Hardhat local node:
```bash
cd contract
npx hardhat node
```
*Keep this terminal open and running.*

## Step 2: Deploy Oracle and Inject Data
Open a **second terminal**, navigate to the `contract` directory, and run the deployment script:
```bash
cd contract
npx hardhat run scripts/deploy-and-feed-oracle.ts --network localhost
```
This script will deploy the `MockPriceOracle`, advance the blockchain time by 1 hour for each price point, and inject a realistic price history. 

At the end of the script, it will print an address like this:
`const ORACLE_ADDRESS = "0x...";`
Copy this address, open `frontend/index.html`, and update the `ORACLE_ADDRESS` variable on line 98.

## Step 3: Start the Frontend Web Server
Because modern browsers restrict local `file:///` paths from making cross-origin requests to the blockchain node, you must serve the frontend via a local HTTP server.

Open a **third terminal**, navigate to the `frontend` directory, and run the built-in Python HTTP server:
```bash
cd frontend
python -m http.server 8080
```
*(Note: You can use any port, but 8080 is standard. If you don't have Python, you can also use Node.js by running `npx serve` in the frontend directory).*

## Step 4: View the Dashboard
1. Open your web browser and navigate to: http://localhost:8080/index.html
2. Click the **"Connect to Localhost & Refresh"** button.
3. The dashboard will successfully connect to your local Hardhat node and render the dynamic price chart!

{
    