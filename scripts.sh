#!/bin/bash
# CrowdFundX Foundry Commands

# Compile the contract
echo "Compiling contract..."
forge build --force

# Run all tests with verbose output
echo "Running tests..."
forge test -vv

# Run tests with gas reporting
echo "Running tests with gas report..."
forge test --gas-report

# Deploy to Sepolia testnet
echo "Deploying to Sepolia..."
source .env
forge script script/DeployCrowdfunding.s.sol:DeployCrowdfunding --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify --verifier etherscan --etherscan-api-key $ETHERSCAN_API_KEY

# Deploy to local anvil network (for testing)
echo "Deploying to local Anvil..."
forge script script/DeployCrowdfunding.s.sol:DeployCrowdfunding --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb476caded87c748995ff7c277ac0 --broadcast
