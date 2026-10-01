const express = require("express")
const multer = require("multer")
const cors = require("cors")
const crypto = require("crypto")
const { ethers } = require("ethers")
const { PrismaClient } = require("@prisma/client")
const storage = require("./storage")
const prisma = new PrismaClient()
const sessions = {}
const PAYMENT_CHAIN_ID = 4663
const PAYMENT_RPC_URL = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"
const PAYMENT_RECEIVER = process.env.PAYMENT_RECEIVER?.toLowerCase()
const ONE_TIME_PAYMENT_ETH = process.env.ONE_TIME_PAYMENT_ETH || "0.002"
const USDG_TOKEN_ADDRESS = process.env.USDG_TOKEN_ADDRESS?.toLowerCase()
const ONE_TIME_PAYMENT_USDG = process.env.ONE_TIME_PAYMENT_USDG || "2"
const rpcProvider = new ethers.JsonRpcProvider(PAYMENT_RPC_URL, PAYMENT_CHAIN_ID)
const ERC20_INTERFACE = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"])

function verifyWallet(req){
  const token = req.headers["x-session"]
  if (!token) return null
  return sessions[token] || null
}

async function requirePaidWallet(req, res, next) {
  const owner = verifyWallet(req)
  if (!owner) return res.sendStatus(401)
  const user = await prisma.user.findFirst({
    where: { owner: { equals: owner, mode: "insensitive" } },
    select: { legacyAccessAt: true }
  })
  const payment = await prisma.payment.findFirst({
    where: { owner: { equals: owner, mode: "insensitive" } }
  })
  if (!payment && !user?.legacyAccessAt) return res.status(402).json({ error: "One-time payment required" })
  req.owner = owner
  next()
}

const app = express()

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000"
}))

app.use(express.json())

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
})

app.post("/nonce", async (req, res) => {
  const { address } = req.body
  if (!address) return res.sendStatus(400)

  const key = address.toLowerCase()

  const record = await prisma.nonce.findUnique({
    where:{
      address:key
    }
  })

  let nonce = record?.nonce

  if(!nonce){
    nonce = crypto.randomBytes(32).toString("hex")

    await prisma.nonce.upsert({
      where:{
        address:key
      },
      update:{
        nonce
      },
      create:{
        address:key,
        nonce
      }
    })
  }

  res.json({ nonce })
})

app.post("/login", async (req,res) => {
  const { address, signature} = req.body

  const key = address.toLowerCase()
  const record = await prisma.nonce.findUnique({
      where:{
          address:key
      }
  })

  const nonce = record?.nonce

  if(!nonce) return res.sendStatus(401)

  const message = `Login nonce:${nonce}`
  const recovered = ethers.verifyMessage(message, signature)

  if (recovered.toLowerCase() !== address.toLowerCase())
    return res.sendStatus(401)

  await prisma.nonce.delete({
    where:{
      address:key
    }
  })
  
  const sessionToken = crypto.randomBytes(32).toString("hex")
  sessions[sessionToken] = address

  let user = await prisma.user.findUnique({ where: { owner: address } })
  const payment = await prisma.payment.findFirst({
    where: { owner: { equals: address, mode: "insensitive" } }
  })
  if (user && !payment && !user.legacyAccessAt) {
    user = await prisma.user.update({ where: { owner: address }, data: { legacyAccessAt: new Date() } })
  }

  res.json({ sessionToken, paymentRequired: !payment && !user?.legacyAccessAt })

})

app.get("/payment/options", async (req, res) => {
  if (!PAYMENT_RECEIVER || !ethers.isAddress(PAYMENT_RECEIVER)) return res.status(503).json({ error: "Payment receiver is not configured" })
  const options = [{ asset: "ETH", amount: ONE_TIME_PAYMENT_ETH, type: "native" }]
  if (USDG_TOKEN_ADDRESS && ethers.isAddress(USDG_TOKEN_ADDRESS)) {
    options.push({ asset: "USDG", amount: ONE_TIME_PAYMENT_USDG, type: "erc20", tokenAddress: USDG_TOKEN_ADDRESS, decimals: 18 })
  }
  res.json({ receiver: PAYMENT_RECEIVER, chainId: PAYMENT_CHAIN_ID, options })
})

app.get("/payment/stock-tokens", async (req, res) => {
  try {
    const response = await fetch("https://api.robinhood.com/rhj/assets")
    if (!response.ok) throw new Error("Asset registry request failed")
    const { assets = [] } = await response.json()
    const tokens = assets
      .filter(asset => ["AAPL", "AMZN", "NVDA"].includes(asset.tokenSymbol))
      .map(asset => ({
        symbol: asset.tokenSymbol,
        name: asset.tokenName,
        contractAddress: asset.deployments?.find(deployment => deployment.chainId === PAYMENT_CHAIN_ID)?.contractAddress,
        decimals: 18
      }))
      .filter(token => token.contractAddress)
    res.json({ chainId: PAYMENT_CHAIN_ID, tokens })
  } catch (error) {
    console.error("Stock token lookup failed", error)
    res.status(502).json({ error: "Robinhood stock token registry is unavailable" })
  }
})

app.post("/payment/verify", async (req, res) => {
  const owner = verifyWallet(req)
  const { txHash, asset = "ETH" } = req.body
  if (!owner || !txHash || !ethers.isHexString(txHash, 32)) return res.sendStatus(400)
  if (!PAYMENT_RECEIVER || !ethers.isAddress(PAYMENT_RECEIVER)) return res.status(503).json({ error: "Payment receiver is not configured" })
  const existing = await prisma.payment.findFirst({ where: { owner } })
  if (existing) return res.json({ paid: true, payment: existing })
  try {
    const [transaction, receipt] = await Promise.all([rpcProvider.getTransaction(txHash), rpcProvider.getTransactionReceipt(txHash)])
    if (!transaction || !receipt || receipt.status !== 1 || transaction.chainId !== BigInt(PAYMENT_CHAIN_ID)) return res.status(400).json({ error: "Payment transaction is not confirmed on Robinhood Chain" })
    if (transaction.from.toLowerCase() !== owner.toLowerCase()) return res.status(400).json({ error: "Payment sender does not match" })
    let amount
    if (asset === "ETH") {
      if (transaction.to?.toLowerCase() !== PAYMENT_RECEIVER || transaction.value < ethers.parseEther(ONE_TIME_PAYMENT_ETH)) return res.status(400).json({ error: `Payment must be at least ${ONE_TIME_PAYMENT_ETH} ETH to the configured receiver` })
      amount = ethers.formatEther(transaction.value)
    } else if (asset === "USDG" && USDG_TOKEN_ADDRESS && ethers.isAddress(USDG_TOKEN_ADDRESS)) {
      if (transaction.to?.toLowerCase() !== USDG_TOKEN_ADDRESS) return res.status(400).json({ error: "Payment was not sent through the configured USDG contract" })
      const transfer = receipt.logs
        .filter(log => log.address.toLowerCase() === USDG_TOKEN_ADDRESS)
        .map(log => { try { return ERC20_INTERFACE.parseLog(log) } catch { return null } })
        .find(log => log?.name === "Transfer" && log.args.from.toLowerCase() === owner && log.args.to.toLowerCase() === PAYMENT_RECEIVER)
      if (!transfer || transfer.args.value < ethers.parseUnits(ONE_TIME_PAYMENT_USDG, 18)) return res.status(400).json({ error: `Payment must be at least ${ONE_TIME_PAYMENT_USDG} USDG` })
      amount = ethers.formatUnits(transfer.args.value, 18)
    } else {
      return res.status(400).json({ error: "Unsupported payment asset" })
    }
    await prisma.user.upsert({ where: { owner }, update: {}, create: { owner } })
    const payment = await prisma.payment.create({ data: { owner, txHash, asset, amount } })
    res.json({ paid: true, payment })
  } catch (error) {
    console.error("Payment verification failed", error)
    res.status(400).json({ error: "Payment transaction could not be verified" })
  }
})

app.post("/secret", requirePaidWallet, async (req, res) => {
  const owner = req.owner

  const { encryptedSecret } = req.body

  await prisma.user.upsert({
    where:{ owner },
    update:{ encryptedSecret },
    create:{
      owner,
      encryptedSecret
    }
  })

  res.sendStatus(200)
})

app.get("/secret", requirePaidWallet, async (req, res) =>{
  const owner = req.owner

  const user = await prisma.user.findUnique({
      where:{
          owner
      }
  })

  if(!user?.encryptedSecret) return res.json(null)

  res.json({
      encryptedSecret:user.encryptedSecret
  })
})

app.post("/upload", requirePaidWallet, upload.fields([
  { name: "file", maxCount: 1 },
  { name: "metadata", maxCount: 1 }
]), async (req, res) => {
  const owner = req.owner
  
  if (!req.files?.file?.[0]) {
    return res.sendStatus(400)
  }
  
  await prisma.user.upsert({
    where: {
      owner
    },
    update: {},
    create: {
      owner
    }
  })

  const id = crypto.randomUUID()
  const file = req.files.file[0]

  await storage.uploadFile(
    id,
    file.buffer,
    file.mimetype
  )

  await prisma.file.create({
    data:{
      id,
      owner,
      metadata:req.body.metadata
    }
  })

  res.json({ success: true })
})

app.get("/files", requirePaidWallet, async (req,res) => {
  const owner = req.owner
  
  const files = await prisma.file.findMany({
    where:{
      owner
    }
  })

  res.json(files)

})

app.get("/download/:id", requirePaidWallet, async (req, res) => {
  const owner = req.owner

  const dbfile = await prisma.file.findFirst({
      where:{
          id: req.params.id,
          owner
      },
      select:{ id: true }
  })

  if (!dbfile) return res.sendStatus(403)

  try {
    const r2file = await storage.downloadFile(req.params.id)

    res.setHeader(
      "Content-Type",
      r2file.ContentType || "application/octet-stream"
    )

    r2file.Body.on("error", (err) => {
      console.error("Stream error:", err)
      res.end()
    })

    r2file.Body.pipe(res)

  } catch (err) {
    console.error("R2 download failed", {
      code: err.Code || err.name,
      status: err.$metadata?.httpStatusCode,
      message: err.message
    })
    res.status(err.$metadata?.httpStatusCode === 404 ? 404 : 502).json({
      error: "Encrypted file storage is unavailable"
    })
  }
})

app.delete("/files/:id", requirePaidWallet, async (req, res) => {
  const owner = req.owner

  const { id } = req.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return res.sendStatus(400)
  }

  const dbfile = await prisma.file.findFirst({
    where:{
      id,
      owner
    },
    select:{ id: true }
  })

  if(!dbfile) return res.sendStatus(403)

  try {
    await storage.deleteFile(id)

    await prisma.file.delete({
      where:{
        id
      }
    })

    res.json({ success: true })
  } catch (err) {
    res.sendStatus(500)
  }
})


const PORT = process.env.PORT || 4000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
});
