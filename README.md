# CrowdFundX - Solidity Crowdfunding DApp

A fully decentralized crowdfunding smart contract and frontend DApp for Ethereum Sepolia testnet, built with Solidity and Foundry.

## Project Structure

```
CrowdFundX/
├── src/
│   └── Crowdfunding.sol         # Main crowdfunding smart contract
├── test/
│   └── Crowdfunding.t.sol       # Comprehensive Solidity test suite
├── script/
│   └── DeployCrowdfunding.s.sol # Deployment script
├── frontend/                     # Static HTML/CSS/JS frontend
├── foundry.toml                 # Foundry configuration
├── .env.example                 # Environment variables template
└── README.md                    # This file
```

## Features

### Smart Contract (Solidity 0.8.19)
- **Campaign Creation**: Users create campaigns with title, description, funding goal, and deadline
- **Donations**: Accept ETH donations before campaign deadline
- **Withdrawals**: Campaign owners withdraw funds only after goal is reached
- **Refunds**: Donors get refunds if goal is not met after deadline
- **Reentrancy Protection**: Custom nonReentrant guard
- **Events**: Full event logging for all actions

### Testing (Foundry)
- 30+ comprehensive test cases covering all contract functionality
- Gas optimization testing
- Edge case and security testing

### Deployment
- Sepolia testnet configuration
- Etherscan verification support
- Local Anvil testing support

## Setup

### Prerequisites
- Foundry installed
- Git
- `.env` file with environment variables

### Installation

1. Clone and enter project
```bash
cd CrowdFundX
```

2. Create `.env` from template
```bash
cp .env.example .env
```

3. Fill in environment variables:
```
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
PRIVATE_KEY=0xYOUR_PRIVATE_KEY
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
```

## Commands

### Compile
```bash
forge build
```

### Test
```bash
forge test -vv              # Verbose output
forge test --gas-report     # With gas usage
```

### Deploy to Sepolia
```bash
source .env
forge script script/DeployCrowdfunding.s.sol:DeployCrowdfunding \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --verifier etherscan \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

### Deploy to Local Anvil
```bash
# Terminal 1
anvil

# Terminal 2
forge script script/DeployCrowdfunding.s.sol:DeployCrowdfunding \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb476caded87c748995ff7c277ac0 \
  --broadcast
```

## Smart Contract API

### Functions

- `createCampaign(string title, string description, uint256 goal, uint256 deadline)` - Create campaign
- `donate(uint256 campaignId) payable` - Donate to campaign
- `withdraw(uint256 campaignId)` - Owner withdraws after goal reached
- `refund(uint256 campaignId)` - Donor requests refund after deadline
- `getCampaign(uint256 campaignId)` - View campaign details
- `getContribution(uint256 campaignId, address contributor)` - View contribution

### Events

- `CampaignCreated(uint256 indexed campaignId, address indexed owner, uint256 goal, uint256 deadline)`
- `DonationReceived(uint256 indexed campaignId, address indexed donor, uint256 amount)`
- `FundsWithdrawn(uint256 indexed campaignId, address indexed owner, uint256 amount)`
- `RefundIssued(uint256 indexed campaignId, address indexed contributor, uint256 amount)`

## Frontend

To run the frontend:
```bash
cd frontend
npx http-server -c-1
```

Open `http://localhost:8080` in browser with MetaMask connected to Sepolia.

## Test Coverage

The test suite includes 30+ tests covering:
- Campaign creation and validation
- Donations from single and multiple users
- Deadline enforcement
- Withdrawals and refunds
- Reentrancy protection
- Edge cases and error handling

## Security

- Custom reentrancy guard on withdrawals/refunds
- Input validation on all functions
- Deadline enforcement
- Safe fund transfers using low-level `.call()`

## License

MIT
