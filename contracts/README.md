# NoBreachVault

`NoBreachVault.sol` accepts native ETH and ERC-20 transfers. Only its owner can
withdraw assets or transfer ownership. It has no upgrade mechanism or arbitrary
call function.

## Deploy to Robinhood Chain mainnet

This project includes a Node.js deployment script; Foundry, Hardhat, and Remix
are not required. From PowerShell:

```powershell
Set-Location C:\Users\ROHITH\Xcloud\contracts
$env:RH_CHAIN_ID = "4663"
$env:RH_RPC_URL = "https://rpc.mainnet.chain.robinhood.com"
$secureKey = Read-Host -Prompt "Enter FRESH deployment wallet key (hidden)" -AsSecureString
try {
  $env:DEPLOYER_PRIVATE_KEY = ([System.Net.NetworkCredential]::new("", $secureKey)).Password
  if ([string]::IsNullOrWhiteSpace($env:DEPLOYER_PRIVATE_KEY)) { throw "No key was entered" }
  npm.cmd run deploy
} finally {
  Remove-Item Env:DEPLOYER_PRIVATE_KEY -ErrorAction SilentlyContinue
  $secureKey.Dispose()
}
```

Install dependencies once with `npm.cmd install` from this folder before
deploying. Type the key for a **fresh wallet** only after PowerShell displays the
hidden prompt. Never put the key in the command or prompt text. The deployer
wallet becomes the vault owner and needs mainnet ETH for gas. The script checks
the RPC chain ID, compiles locally, waits for the deployment receipt, and prints
the contract address, owner, transaction hash, and explorer link.

The script defaults to mainnet, chain ID `4663`. To deploy to Robinhood Chain
Testnet instead, set `$env:RH_CHAIN_ID = "46630"` and
`$env:RH_RPC_URL = "https://rpc.testnet.chain.robinhood.com"` before running it.
Testnet deployments are separate contracts with separate addresses.

## Connect the app

After confirming the mainnet deployment, set the printed address as
`PAYMENT_RECEIVER` in the backend's production environment. The existing
frontend reads this receiver from the backend and sends both ETH and USDG to
it; backend payment verification already checks for the same recipient.

## Verify the deployed contract

Pass the public contract address printed by deployment. Mainnet is the default:

```powershell
npm.cmd run verify -- 0xYourDeployedNoBreachVaultAddress
```

For a testnet deployment, select the testnet explorer first:

```powershell
$env:RH_CHAIN_ID = "46630"
npm.cmd run verify -- 0xYourTestnetNoBreachVaultAddress
Remove-Item Env:RH_CHAIN_ID
```

Verification uses the locally installed Solidity compiler and the same
optimizer settings as deployment. It does not need a wallet key. The constructor
has no arguments. The script submits standard JSON input to Blockscout and
checks the verification status; Blockscout documents this submission and status
flow in its [contract verification API](https://docs.blockscout.com/devs/apis/rpc/contract).

If the explorer returns HTTP 403, it denied API access before checking the
source. Try **Verify & Publish** on the contract's explorer page, or retry the
terminal command from a network where the explorer API is accessible.

## Withdrawals

Call `withdrawNative(to, amount)` to withdraw ETH, or
`withdrawToken(token, to, amount)` to withdraw an ERC-20 token such as USDG.
Amounts use the asset's smallest unit (wei for ETH; token base units for ERC-20).
Only the current owner can call these functions. Ownership can be transferred
with `transferOwnership(newOwner)`.

Never commit or share the deployer's private key. Do not use the key previously
posted in chat; use a fresh wallet for the mainnet deployment.
