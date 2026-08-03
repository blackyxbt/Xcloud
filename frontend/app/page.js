'use client'

import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { ArrowBigDownIcon, ArrowBigUpDashIcon, TrashIcon } from "./icons"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

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
  const [isUploading, setIsUploading] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState(null)
  const [theme, setTheme] = useState("light")

  const totalStorage = files.reduce((sum, file) => sum + (file.meta.size || 0), 0)
  const latestUpload = files.reduce((latest, file) => Math.max(latest, file.meta.uploadedAt || 0), 0)

  useEffect(() => {
    const savedTheme = localStorage.getItem("privatecloud-theme")
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    setTheme(savedTheme || (prefersDark ? "dark" : "light"))
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem("privatecloud-theme", theme)
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

  async function connectWallet() {
    const ethereum = await waitForEthereum()
    if (!ethereum) return alert("Install Wallet")

    try {
      setIsConnecting(true)
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

      const { sessionToken } = await loginRes.json()

      const unlockMessage = `PrivateCloud Master Unlock v1
      Address: ${address.toLowerCase()}`

      const unlockKey = await deriveKeyFromMessage(unlockMessage)

      const secretRes = await fetch(`${API_URL}/secret`, {
        headers: { "x-session": sessionToken }
      })

      const secretData = await secretRes.json()

      let userSecret

      if (!secretData) {
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
        userSecret = await decryptBytes(encryptedSecretBytes, unlockKey)
      }

      const aesKey = await importAesKey(userSecret)

      setSession(sessionToken)
      setCryptoKey(aesKey)
      setWalletAddress(address)
      await listFiles(sessionToken, aesKey)
      setConnected(true)
    } catch (err) {
      console.error(err)
      alert("Login failed")
    } finally {
      setIsConnecting(false)
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
    const downloadRes = await fetch(
      `${API_URL}/download/${encodeURIComponent(file.id)}`,
      { headers: { "x-session": session } }
    )

    if (!downloadRes.ok) {
      alert("Download failed")
      return
    }

    const encryptedBytes = new Uint8Array(await downloadRes.arrayBuffer())
    const decrypted = await decryptFile(encryptedBytes, cryptoKey)
    const fileDownload = new Blob([decrypted], { type: file.meta.type })

    const url = URL.createObjectURL(fileDownload)
    const a = document.createElement("a")
    a.href = url
    a.download = file.meta.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
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
          <button className="theme-toggle auth-theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            <span>{theme === "dark" ? "Light" : "Dark"}</span>
          </button>

          <section className="auth-card">
            <div className="auth-left">
              <div className="brand-mark">PC</div>
              <p className="eyebrow">Encrypted wallet storage</p>
              <h1 className="auth-title">PrivateCloud</h1>
              <p className="auth-text">
                Access private files with wallet-based login and local encryption before anything reaches the server.
              </p>

              <button className="connect-btn" onClick={connectWallet} disabled={isConnecting}>
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
                  <strong>Locked</strong>
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
                  <span>Identity</span>
                  <strong>Wallet signed</strong>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="app-container">
          <header className="app-header">
            <div>
              <p className="eyebrow">Secure vault</p>
              <h1 className="app-logo">PrivateCloud</h1>
            </div>

            <div className="header-actions">
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
                    <p>Upload your first file to encrypt it locally and store it in your private cloud.</p>
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
              <div className="check-list">
                <span>Local encryption</span>
                <span>Signed access</span>
                <span>Encrypted metadata</span>
              </div>
            </aside>
          </div>
        </div>
      )}
    </main>
  )
}
