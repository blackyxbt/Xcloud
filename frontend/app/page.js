'use client'

import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { ArrowBigDownIcon, ArrowBigUpDashIcon, NoBreachMark, TrashIcon } from "./icons"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

const ROBINHOOD_CHAIN = {
  chainId: "0x1237",
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"]
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatDate(timestamp) {
  if (!timestamp) return "Unknown"
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(timestamp))
}

function fileTypeLabel(type = "") {
  if (!type) return "FILE"
  const [category, subtype] = type.split("/")
  if (category === "application") return (subtype || "file").slice(0, 4).toUpperCase()
  return category.slice(0, 4).toUpperCase()
}

async function deriveKeyFromMessage(message) {
  const enc = new TextEncoder()

  const messageHash = ethers.hashMessage(message)
  const messageHashBytes = ethers.getBytes(messageHash)

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    messageHashBytes,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  )

  return await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode("private-cloud"),
      info: enc.encode("file-encryption"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

async function encryptBytes(bytes, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes)
  return new Uint8Array([...iv, ...new Uint8Array(encrypted)])
}

async function decryptBytes(bytes, key) {
  const iv = bytes.slice(0, 12)
  const data = bytes.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data)
  return new Uint8Array(decrypted)
}

async function importAesKey(bytes) {
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  )
}

async function encryptFile(file, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await file.arrayBuffer()
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data)
  return { encrypted, iv }
}

async function decryptFile(bytes, key) {
  const iv = bytes.slice(0, 12)
  const data = bytes.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data)
  return new Uint8Array(decrypted)
}

async function encryptMetadata(obj, key) {
  const enc = new TextEncoder()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = enc.encode(JSON.stringify(obj))
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data)
  return new Uint8Array([...iv, ...new Uint8Array(encrypted)])
}

async function decryptMetadata(bytes, key) {
  if (!(bytes instanceof Uint8Array)) throw new Error("Invalid metadata format")
  if (bytes.length < 12) throw new Error("Corrupted metadata: too small")

  const iv = bytes.slice(0, 12)
  const data = bytes.slice(12)

  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data)
    return JSON.parse(new TextDecoder().decode(decrypted))
  } catch {
    throw new Error("Metadata decryption failed: wrong key or corrupted data")
  }
}

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n))
}

export default function Home() {
  const [connected, setConnected] = useState(false)
  const [cryptoKey, setCryptoKey] = useState(null)
  const [files, setFiles] = useState([])
  const [session, setSession] = useState(null)
  const [walletAddress, setWalletAddress] = useState("")
  const [isConnecting, setIsConnecting] = useState(false)
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState(null)
  const [theme, setTheme] = useState("light")
  const [chainName, setChainName] = useState("")
  const [paymentSession, setPaymentSession] = useState(null)
  const [isPaying, setIsPaying] = useState(false)
  const [paymentAsset, setPaymentAsset] = useState("ETH")

  const totalStorage = files.reduce((sum, file) => sum + (file.meta.size || 0), 0)
  const latestUpload = files.reduce((latest, file) => Math.max(latest, file.meta.uploadedAt || 0), 0)

  useEffect(() => {
    const savedTheme = localStorage.getItem("nobreach-theme")
    setTheme(savedTheme === "dark" ? "dark" : "light")
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem("nobreach-theme", theme)
  }, [theme])

  function toggleTheme() {
    setTheme(currentTheme => currentTheme === "dark" ? "light" : "dark")
  }

  async function listFiles(activeSession, activeKey) {
    const filesRes = await fetch(`${API_URL}/files`, {
      headers: { "x-session": activeSession }
    })

    const data = await filesRes.json()

    const decryptedFiles = await Promise.all(
      data.map(async f => {
        const metaBytes = Uint8Array.from(atob(f.metadata), c => c.charCodeAt(0))
        const meta = await decryptMetadata(metaBytes, activeKey)
        return { id: f.id, meta }
      })
    )

    setFiles(decryptedFiles)
  }

  function waitForEthereum(timeout = 3000) {
    return new Promise((resolve) => {
      if (window.ethereum) return resolve(window.ethereum)

      const onInit = () => {
        window.removeEventListener("ethereum#initialized", onInit)
        resolve(window.ethereum)
      }
      window.addEventListener("ethereum#initialized", onInit, { once: true })

      setTimeout(() => {
        window.removeEventListener("ethereum#initialized", onInit)
        resolve(window.ethereum || null)
      }, timeout)
    })
  }

  async function connectRobinhoodChain(ethereum) {
    const currentChainId = await ethereum.request({ method: "eth_chainId" })
    if (currentChainId !== ROBINHOOD_CHAIN.chainId) {
      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ROBINHOOD_CHAIN.chainId }]
        })
      } catch (error) {
        if (error?.code !== 4902) throw error
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [ROBINHOOD_CHAIN]
        })
      }
    }
    setChainName(ROBINHOOD_CHAIN.chainName)
  }

  async function authenticateWallet(ethereum) {
    const provider = new ethers.BrowserProvider(ethereum)
    await provider.send("eth_requestAccounts", [])

    const signer = await provider.getSigner()
    const address = await signer.getAddress()

    const nonceRes = await fetch(`${API_URL}/nonce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address })
    })

    const { nonce } = await nonceRes.json()
    const signature = await signer.signMessage(`Login nonce:${nonce}`)

    const loginRes = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signature })
    })

    if (!loginRes.ok) throw new Error("Login Failed")

      const { sessionToken, paymentRequired } = await loginRes.json()

      if (paymentRequired) {
        return { paymentRequired: true, sessionToken, address, signer }
      }

    const unlockMessage = `PrivateCloud Master Unlock v1
      Address: ${address.toLowerCase()}`
    const unlockSignature = await signer.signMessage(unlockMessage)

    const unlockKey = await deriveKeyFromMessage(unlockSignature)

    const secretRes = await fetch(`${API_URL}/secret`, {
      headers: { "x-session": sessionToken }
    })

    const secretData = await secretRes.json()

    let userSecret

      if (!secretData?.encryptedSecret) {
        userSecret = randomBytes(32)
        const encryptedSecret = await encryptBytes(userSecret, unlockKey)
        await fetch(`${API_URL}/secret`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session": sessionToken
          },
          body: JSON.stringify({
            encryptedSecret: btoa(String.fromCharCode(...encryptedSecret))
          })
        })
    } else {
        const encryptedSecretBytes = Uint8Array.from(
          atob(secretData.encryptedSecret),
          c => c.charCodeAt(0)
        )

        try {
          // Fast path: already migrated to the signature-derived key.
          userSecret = await decryptBytes(encryptedSecretBytes, unlockKey)
        } catch {
          // Fell through: this secret predates the fix and was wrapped with
          // the old, insecure address-derived key. Recover it once with the
          // legacy derivation, then immediately re-wrap with the new key so
          // this branch never has to run again for this user.
          const legacyUnlockKey = await deriveKeyFromMessage(unlockMessage)
          userSecret = await decryptBytes(encryptedSecretBytes, legacyUnlockKey)

          const migratedSecret = await encryptBytes(userSecret, unlockKey)
          await fetch(`${API_URL}/secret`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-session": sessionToken
            },
            body: JSON.stringify({
              encryptedSecret: btoa(String.fromCharCode(...migratedSecret))
            })
          })
        }
    }

    const aesKey = await importAesKey(userSecret)

    setSession(sessionToken)
    setCryptoKey(aesKey)
    setWalletAddress(address)
    await listFiles(sessionToken, aesKey)
    setConnected(true)
  }

  async function connectWallet() {
    const ethereum = await waitForEthereum()
    if (!ethereum) return alert("Install or unlock a browser wallet, then try again.")

    try {
      setIsConnecting(true)
      setIsWalletModalOpen(false)
      await connectRobinhoodChain(ethereum)
      const result = await authenticateWallet(ethereum)
      if (result?.paymentRequired) setPaymentSession(result)
    } catch (err) {
      console.error(err)
      alert("Login failed")
    } finally {
      setIsConnecting(false)
    }
  }

  async function completeOneTimePayment() {
    if (!paymentSession) return
    try {
      setIsPaying(true)
      const optionsRes = await fetch(`${API_URL}/payment/options`)
      const options = await optionsRes.json()
      if (!optionsRes.ok) throw new Error(options.error || "Payment is unavailable")
      const payment = options.options.find(option => option.asset === paymentAsset)
      if (!payment) throw new Error(`${paymentAsset} payments are not configured yet`)
      const transaction = payment.type === "native"
        ? await paymentSession.signer.sendTransaction({ to: options.receiver, value: ethers.parseEther(payment.amount) })
        : await new ethers.Contract(payment.tokenAddress, ["function transfer(address to, uint256 value) returns (bool)"], paymentSession.signer)
          .transfer(options.receiver, ethers.parseUnits(payment.amount, payment.decimals))
      await transaction.wait()
      const verifyRes = await fetch(`${API_URL}/payment/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session": paymentSession.sessionToken },
        body: JSON.stringify({ txHash: transaction.hash, asset: payment.asset })
      })
      const verified = await verifyRes.json()
      if (!verifyRes.ok) throw new Error(verified.error || "Payment verification failed")
      setPaymentSession(null)
      alert("Payment confirmed. Connect your wallet once more to open the vault.")
    } catch (error) {
      console.error(error)
      alert(error.message || "Payment failed")
    } finally {
      setIsPaying(false)
    }
  }

  async function uploadFile(file, input) {
    if (!file || !cryptoKey) return

    setIsUploading(true)
    try {
      const { encrypted, iv } = await encryptFile(file, cryptoKey)
      const encryptedFileBytes = new Uint8Array([...iv, ...new Uint8Array(encrypted)])

      const meta = {
        name: file.name,
        type: file.type,
        size: file.size,
        uploadedAt: Date.now()
      }

      const encryptedMetaBytes = await encryptMetadata(meta, cryptoKey)
      const encryptedMetaBase64 = btoa(String.fromCharCode(...encryptedMetaBytes))

      const formData = new FormData()
      formData.append('file', new Blob([encryptedFileBytes]))
      formData.append("metadata", encryptedMetaBase64)

      await fetch(`${API_URL}/upload`, {
        method: "POST",
        headers: { "x-session": session },
        body: formData
      })

      await listFiles(session, cryptoKey)
    } finally {
      setIsUploading(false)
      input.value = ""
    }
  }

  async function downloadFile(file) {
    try {
      const downloadRes = await fetch(
        `${API_URL}/download/${encodeURIComponent(file.id)}`,
        { headers: { "x-session": session } }
      )

      if (!downloadRes.ok) throw new Error(`Storage request failed (${downloadRes.status})`)

      const encryptedBytes = new Uint8Array(await downloadRes.arrayBuffer())
      if (encryptedBytes.length < 13) throw new Error("Stored file is incomplete")

      const decrypted = await decryptFile(encryptedBytes, cryptoKey)
      const fileDownload = new Blob([decrypted], { type: file.meta.type })
      const url = URL.createObjectURL(fileDownload)
      const a = document.createElement("a")
      a.href = url
      a.download = file.meta.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      console.error("Download failed", error)
      alert(error.message || "Download failed")
    }
  }

  async function deleteFile(file) {
    if (!session || !file?.id) return

    const confirmed = window.confirm(`Delete "${file.meta.name}"?`)
    if (!confirmed) return

    setDeletingFileId(file.id)
    try {
      const deleteRes = await fetch(
        `${API_URL}/files/${encodeURIComponent(file.id)}`,
        {
          method: "DELETE",
          headers: { "x-session": session }
        }
      )

      if (!deleteRes.ok) throw new Error("Delete failed")
      await listFiles(session, cryptoKey)
    } catch (err) {
      console.error(err)
      alert("Delete failed")
    } finally {
      setDeletingFileId(null)
    }
  }

  return (
    <main>
      {!connected ? (
        <div className="auth-container">
          <div className="utility-bar">
            <span className="protocol-brand"><img src="/brand/nobreach-logo-transparent.png" alt="NoBreach" /><span>Protocol</span></span>
            <div className="utility-links">
              <a className="utility-docs" href="/docs">Docs</a>
              <span>Twitter / Soon</span>
              <span>CA / Soon</span>
              <span>Robinhood Chain / 4663</span>
            </div>
          </div>
          <button className="theme-toggle auth-theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            <span>{theme === "dark" ? "Light" : "Dark"}</span>
          </button>

          <section className="auth-card">
            <div className="auth-left">
              <div className="brand-mark"><NoBreachMark size={32} /></div>
              <p className="eyebrow">NoBreach Protocol / encrypted wallet storage</p>
              <h1 className="auth-title">NoBreach</h1>
              <p className="auth-text">
                Your files are encrypted in the browser before storage. Your wallet proves access on Robinhood Chain, without a password or conventional cloud account.
              </p>

              <div className="network-badge">
                <span className="network-dot" aria-hidden="true" />
                <span>Robinhood Chain</span>
                <small>Chain 4663</small>
              </div>

              <button className="connect-btn" onClick={() => setIsWalletModalOpen(true)} disabled={isConnecting}>
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </button>

              <div className="auth-footer">
                No passwords. No plaintext uploads. Your wallet unlocks the vault.
              </div>
            </div>

            <div className="auth-right">
              <div className="vault-preview" aria-hidden="true">
                <div className="vault-topline">
                  <span>Vault status</span>
                  <strong>Ready to unlock</strong>
                </div>
                <div className="vault-ring">
                  <span>256</span>
                  <small>bit AES-GCM</small>
                </div>
                <div className="vault-row">
                  <span>Metadata</span>
                  <strong>Encrypted</strong>
                </div>
                <div className="vault-row">
                  <span>Network</span>
                  <strong>Robinhood Chain</strong>
                </div>
              </div>
            </div>
          </section>

          <section className="scroll-section no-breach-section">
            <div className="section-heading">
              <div><p className="eyebrow">NoBreach Protocol</p><h2>Built to reduce the breach surface.</h2></div>
              <p>NoBreach keeps the encryption and access path deliberately short: encrypt locally, store ciphertext, unlock with a wallet signature.</p>
            </div>
            <div className="no-breach-grid">
              <article><span>01 / No password database</span><h3>No password to leak.</h3><p>There is no NoBreach password for us to store, reset, or expose. Your wallet signs a challenge to prove that you control the address.</p></article>
              <article><span>02 / Local encryption</span><h3>Plaintext stays on your device.</h3><p>Files are encrypted in your browser before upload. Storage receives an encrypted payload, not the readable original.</p></article>
              <article><span>03 / Wallet-owned access</span><h3>No traditional user account.</h3><p>Your wallet address is your identity. There is no email login, password reset flow, or conventional account credential to take over.</p></article>
              <article><span>04 / Practical ownership</span><h3>Your wallet, your responsibility.</h3><p>Only use a wallet you control and protect its recovery phrase. Losing wallet control can also mean losing access to the vault.</p></article>
            </div>
          </section>

          {paymentSession && (
            <section className="payment-panel">
              <p className="eyebrow">One-time vault activation</p>
              <h2>Activate your private vault.</h2>
              <div className="payment-choices">
                <button className={paymentAsset === "ETH" ? "is-selected" : ""} onClick={() => setPaymentAsset("ETH")}>0.0002 ETH</button>
                <button className={paymentAsset === "USDG" ? "is-selected" : ""} onClick={() => setPaymentAsset("USDG")}>2 USDG</button>
                <button disabled>Stock tokens / soon</button>
              </div>
              <div className="payment-summary"><span>Network</span><strong>Robinhood Chain</strong><span>Method</span><strong>{paymentAsset}</strong><span>Wallet</span><strong>{paymentSession.address.slice(0, 6)}...{paymentSession.address.slice(-4)}</strong></div>
              <button className="connect-btn" onClick={completeOneTimePayment} disabled={isPaying}>{isPaying ? "Confirming payment..." : `Pay with ${paymentAsset}`}</button>
            </section>
          )}

          <section className="scroll-section protocol-section">
            <div className="section-heading">
              <div><p className="eyebrow">Protocol flow</p><h2>Local first. Wallet verified.</h2></div>
              <p>Every file follows a short, visible path. Encryption happens before storage; your wallet only proves access.</p>
            </div>
            <div className="flow-chart" aria-label="NoBreach encryption flow">
              <article><span>01</span><strong>Wallet</strong><small>Signature identity</small></article>
              <i aria-hidden="true" />
              <article><span>02</span><strong>Browser</strong><small>AES-256 encryption</small></article>
              <i aria-hidden="true" />
              <article><span>03</span><strong>Vault</strong><small>Encrypted payload</small></article>
              <i aria-hidden="true" />
              <article><span>04</span><strong>Device</strong><small>Local decryption</small></article>
            </div>
          </section>

          <section className="scroll-section technical-section">
            <div className="section-heading"><div><p className="eyebrow">Technical details</p><h2>Built for private access.</h2></div></div>
            <div className="technical-table" role="table" aria-label="NoBreach technical details">
              <div role="row"><span role="cell">Network</span><strong role="cell">Robinhood Chain</strong><code role="cell">eip155:4663</code></div>
              <div role="row"><span role="cell">Authentication</span><strong role="cell">Wallet signature</strong><code role="cell">EIP-1193</code></div>
              <div role="row"><span role="cell">File encryption</span><strong role="cell">AES-GCM 256-bit</strong><code role="cell">Web Crypto API</code></div>
              <div role="row"><span role="cell">Key derivation</span><strong role="cell">HKDF / SHA-256</strong><code role="cell">Client-side</code></div>
              <div role="row"><span role="cell">Metadata</span><strong role="cell">Encrypted at rest</strong><code role="cell">JSON + AES-GCM</code></div>
            </div>
          </section>

          <section className="scroll-section capability-section">
            <div><p className="eyebrow">Session capabilities</p><h2>One signature<br />opens the vault.</h2></div>
            <div className="capability-grid">
              <div><span>Files</span><strong>Encrypted</strong><small>Before upload</small></div>
              <div><span>Metadata</span><strong>Private</strong><small>Before storage</small></div>
              <div><span>Access</span><strong>Signed</strong><small>Per session</small></div>
              <button className="connect-btn" onClick={() => setIsWalletModalOpen(true)} disabled={isConnecting}>{isConnecting ? "Connecting..." : "Connect Wallet"}</button>
            </div>
          </section>

          <section className="scroll-section faq-section">
            <div className="section-heading"><div><p className="eyebrow">FAQ</p><h2>Questions before you connect.</h2></div></div>
            <div className="faq-list">
              <details open><summary>What is NoBreach Protocol?</summary><p>It is NoBreach's wallet-first access and client-side encryption model. Files are encrypted before upload, while a wallet signature verifies access to the vault.</p></details>
              <details><summary>Can NoBreach read my uploaded files?</summary><p>The intended design encrypts files in your browser before they are sent to storage. The storage layer receives encrypted bytes rather than the readable file.</p></details>
              <details><summary>Why is there no email or password login?</summary><p>Your wallet address acts as your identity. This avoids a separate password database and the usual password-reset or credential-stuffing path.</p></details>
              <details><summary>Can my account be blocked like a normal cloud account?</summary><p>There is no conventional email-and-password account to suspend. Access still depends on your wallet, the app, and the underlying network and storage services being available.</p></details>
              <details><summary>What happens if I lose my wallet?</summary><p>NoBreach cannot recover a wallet or its recovery phrase. Keep your wallet backup secure before storing important files.</p></details>
            </div>
          </section>

          {isWalletModalOpen && (
            <div className="wallet-modal-backdrop" role="presentation" onClick={() => setIsWalletModalOpen(false)}>
              <section className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title" onClick={(event) => event.stopPropagation()}>
                <button className="wallet-modal-close" onClick={() => setIsWalletModalOpen(false)} aria-label="Close wallet selection">x</button>
                <p className="eyebrow">Robinhood Chain</p>
                <h2 id="wallet-modal-title">Connect a wallet</h2>
                <p>Choose an installed EVM wallet to access your NoBreach vault.</p>
                <div className="wallet-options">
                  <button onClick={connectWallet}><b>M</b><span><strong>MetaMask</strong><small>Browser wallet</small></span><i>&gt;</i></button>
                  <button onClick={connectWallet}><b>C</b><span><strong>Coinbase Wallet</strong><small>Browser wallet</small></span><i>&gt;</i></button>
                  <button onClick={connectWallet}><b>+</b><span><strong>Other EVM wallet</strong><small>Injected provider</small></span><i>&gt;</i></button>
                </div>
                <small className="wallet-modal-note">Your wallet will request approval before NoBreach can continue.</small>
              </section>
            </div>
          )}
        </div>
      ) : (
        <div className="app-container">
          <header className="app-header">
            <div>
              <p className="eyebrow">Secure vault</p>
              <h1 className="app-logo"><img src="/brand/nobreach-logo-transparent.png" alt="NoBreach" /><span>Protocol</span></h1>
            </div>

            <div className="header-actions">
              <span className="header-network"><i aria-hidden="true" />Robinhood Chain</span>
              <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
                <span>{theme === "dark" ? "Light" : "Dark"}</span>
              </button>

              <label className={`upload-input ${isUploading ? "is-disabled" : ""}`}>
                <ArrowBigUpDashIcon size={22} />
                <span>{isUploading ? "Uploading..." : "Upload File"}</span>
                <input
                  type="file"
                  disabled={isUploading}
                  onChange={(e) => uploadFile(e.target.files[0], e.target)}
                />
              </label>
            </div>
          </header>

          <section className="stats-grid" aria-label="Vault overview">
            <div className="stat-card">
              <span>Total files</span>
              <strong>{files.length}</strong>
            </div>
            <div className="stat-card">
              <span>Encrypted storage</span>
              <strong>{formatBytes(totalStorage)}</strong>
            </div>
            <div className="stat-card">
              <span>Last upload</span>
              <strong>{latestUpload ? formatDate(latestUpload) : "None yet"}</strong>
            </div>
          </section>

          <div className="app-content">
            <section className="app-panel files-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Files</p>
                  <h2>Your encrypted files</h2>
                </div>
              </div>

              <div className="file-list">
                {files.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">+</div>
                    <h3>No files uploaded</h3>
                    <p>Upload your first file to encrypt it locally and store it in your private vault.</p>
                  </div>
                ) : files.map(file => (
                  <div key={file.id} className="file-item">
                    <div className="file-primary">
                      <span className="file-icon">{fileTypeLabel(file.meta.type)}</span>
                      <div className="file-copy">
                        <strong>{file.meta.name}</strong>
                        <span>{formatBytes(file.meta.size)} / {formatDate(file.meta.uploadedAt)}</span>
                      </div>
                    </div>

                    <div className="file-actions">
                      <button
                        aria-label={`Download ${file.meta.name}`}
                        onClick={() => downloadFile(file)}
                        className="file-action-btn"
                      >
                        <ArrowBigDownIcon size={20} />
                      </button>

                      <button
                        aria-label={`Delete ${file.meta.name}`}
                        onClick={() => deleteFile(file)}
                        className="file-action-btn danger"
                        disabled={deletingFileId === file.id}
                      >
                        <TrashIcon size={19} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="app-panel security-panel">
              <p className="eyebrow">Session</p>
              <h3>Private and secure</h3>
              <p className="auth-text">
                Files and metadata are encrypted locally with a key unlocked from your wallet signature.
              </p>
              <div className="session-card">
                <span>Wallet</span>
                <strong>{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</strong>
              </div>
              <div className="session-card network-session">
                <span>Network</span>
                <strong><i aria-hidden="true" />{chainName || ROBINHOOD_CHAIN.chainName}</strong>
              </div>
              <div className="check-list">
                <span>Local encryption</span>
                <span>Signed access</span>
                <span>Robinhood Chain connected</span>
              </div>
            </aside>
          </div>

          <section className="vault-guide">
            <div className="guide-heading">
              <p className="eyebrow">Vault workflow</p>
              <h2>Your files, under your control.</h2>
            </div>
            <div className="guide-steps">
              <article><span>01</span><strong>Add a file</strong><p>Select any file and it is encrypted in this browser before upload.</p></article>
              <article><span>02</span><strong>Keep your key</strong><p>Your wallet signature derives the key that unlocks your encrypted vault.</p></article>
              <article><span>03</span><strong>Retrieve securely</strong><p>Downloads are decrypted locally and never leave your device unprotected.</p></article>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
