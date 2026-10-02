const fs = require("node:fs")
const path = require("node:path")
const solc = require("solc")
const { isAddress, getAddress } = require("ethers")

const networks = {
  "46630": {
    name: "Robinhood Chain Testnet",
    apiUrl: "https://explorer.testnet.chain.robinhood.com/api/"
  },
  "4663": {
    name: "Robinhood Chain",
    apiUrl: "https://robinhoodchain.blockscout.com/api"
  }
}

async function readJson(response) {
  const body = await response.text()
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`Explorer returned HTTP ${response.status} with an unreadable response`)
  }
}

async function main() {
  const rawAddress = process.argv[2]
  if (!rawAddress || !isAddress(rawAddress)) {
    throw new Error("Usage: npm.cmd run verify -- <deployed contract address>")
  }

  const address = getAddress(rawAddress)
  const chainId = process.env.RH_CHAIN_ID || "4663"
  const network = networks[chainId]
  if (!network) throw new Error("RH_CHAIN_ID must be 4663 (mainnet) or 46630 (testnet)")

  const sourcePath = path.join(__dirname, "NoBreachVault.sol")
  const input = {
    language: "Solidity",
    sources: { "NoBreachVault.sol": { content: fs.readFileSync(sourcePath, "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
    }
  }

  const compilerVersion = `v${solc.version().split(" ")[0]}`
  const form = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    codeformat: "solidity-standard-json-input",
    contractaddress: address,
    contractname: "NoBreachVault.sol:NoBreachVault",
    compilerversion: compilerVersion,
    sourceCode: JSON.stringify(input)
  })

  console.log(`Submitting NoBreachVault verification to ${network.name}`)
  const submitResponse = await fetch(network.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  })
  if (submitResponse.status === 403) {
    throw new Error("The Blockscout API denied this terminal request (HTTP 403) before verification. This is an explorer/network access issue, not a contract or constructor-arguments error. Try the explorer's Verify & Publish page or retry from a network where its API is accessible.")
  }
  const submission = await readJson(submitResponse)
  if (!submitResponse.ok || submission.status !== "1") {
    throw new Error(submission.result || submission.message || `Verification submission failed (${submitResponse.status})`)
  }

  const guid = submission.result
  const statusUrl = new URL(network.apiUrl)
  statusUrl.search = new URLSearchParams({
    module: "contract",
    action: "checkverifystatus",
    guid
  }).toString()

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const statusResponse = await fetch(statusUrl)
    const status = await readJson(statusResponse)
    const result = status.result || status.message || "Unknown verification status"

    if (result === "Pass - Verified") {
      console.log(`Verified: ${network.apiUrl.replace(/\/api\/?$/, `/address/${address}`)}`)
      return
    }
    if (result.startsWith("Fail") || result.startsWith("Unknown UID")) {
      throw new Error(result)
    }
  }

  console.log(`Verification is still pending. Check ${network.apiUrl.replace(/\/api\/?$/, `/address/${address}`)}`)
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
