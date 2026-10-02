const fs = require("node:fs")
const path = require("node:path")
const solc = require("solc")
const { ContractFactory, JsonRpcProvider, Wallet } = require("ethers")

const networks = {
  "46630": {
    name: "Robinhood Chain Testnet",
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com/address/"
  },
  "4663": {
    name: "Robinhood Chain",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com/address/"
  }
}

async function main() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) throw new Error("Set DEPLOYER_PRIVATE_KEY in this terminal first")

  const chainId = process.env.RH_CHAIN_ID || "4663"
  const network = networks[chainId]
  if (!network) throw new Error("RH_CHAIN_ID must be 4663 (mainnet) or 46630 (testnet)")

  const rpcUrl = process.env.RH_RPC_URL || network.rpcUrl
  const provider = new JsonRpcProvider(rpcUrl, Number(chainId), { staticNetwork: true })
  const wallet = new Wallet(privateKey, provider)

  const actualNetwork = await provider.getNetwork()
  if (actualNetwork.chainId !== BigInt(chainId)) {
    throw new Error(`RPC chain ID mismatch: expected ${chainId}, got ${actualNetwork.chainId}`)
  }

  const sourcePath = path.join(__dirname, "NoBreachVault.sol")
  const input = {
    language: "Solidity",
    sources: { "NoBreachVault.sol": { content: fs.readFileSync(sourcePath, "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
    }
  }
  const compilation = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (compilation.errors || []).filter(item => item.severity === "error")
  if (errors.length) throw new Error(errors.map(item => item.formattedMessage).join("\n"))

  const artifact = compilation.contracts["NoBreachVault.sol"].NoBreachVault
  const factory = new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, wallet)
  console.log(`Deploying NoBreachVault to ${network.name} from ${wallet.address}`)

  const contract = await factory.deploy()
  const transaction = contract.deploymentTransaction()
  console.log(`Deployment transaction: ${transaction.hash}`)
  await contract.waitForDeployment()

  const address = await contract.getAddress()
  console.log(`NoBreachVault address: ${address}`)
  console.log(`Explorer: ${network.explorer}${address}`)
  console.log(`Owner: ${await contract.owner()}`)
  await provider.destroy()
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
