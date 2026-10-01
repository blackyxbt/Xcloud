import { NoBreachMark } from "../icons"

const navigation = [
  ["Start here", ["Overview", "Security model", "Getting started"]],
  ["Protocol", ["Identity and access", "Encryption flow", "Vault records", "Payments"]],
  ["Operations", ["System architecture", "Storage operations", "Configuration", "Recovery limits"]],
  ["Reference", ["API surface", "Network details", "Status and support"]]
]

export const metadata = {
  title: "NoBreach Docs",
  description: "NoBreach Protocol documentation"
}

export default function DocsPage() {
  return (
    <main className="docs-shell">
      <header className="docs-header">
        <a className="docs-brand" href="/"><img src="/brand/nobreach-logo-transparent.png" alt="NoBreach" /><span>Protocol</span></a>
        <nav aria-label="Documentation navigation"><a href="#overview">Protocol</a><a href="#security">Security</a><a href="#operations">Operations</a><a href="#reference">Reference</a></nav>
        <a className="docs-connect" href="/">Open vault</a>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <div className="docs-sidebar-title"><NoBreachMark size={20} /> Documentation</div>
          {navigation.map(([heading, links]) => (
            <section key={heading}><strong>{heading}</strong>{links.map((link) => <a href={`#${link.toLowerCase().replaceAll(" ", "-")}`} key={link}>{link}</a>)}</section>
          ))}
        </aside>

        <article className="docs-content">
          <div className="docs-crumbs">Documentation <span>/</span> NoBreach Protocol</div>
          <section id="overview" className="docs-hero">
            <p className="eyebrow">NoBreach Protocol</p>
            <h1>Private storage without the usual password surface.</h1>
            <p>NoBreach is a wallet-authenticated encrypted file vault on Robinhood Chain. The browser encrypts file content before upload; the server stores encrypted file data and metadata records needed to retrieve it.</p>
            <div className="docs-callout"><strong>Design intent</strong><span>Reduce exposure from password databases and plaintext cloud uploads. A wallet signature verifies access, but wallet custody remains the user's responsibility.</span></div>
          </section>

          <section id="security" className="docs-section">
            <p className="eyebrow">Security model</p><h2>What protects a vault.</h2>
            <div className="docs-grid">
              <div><span>Client-side encryption</span><strong>AES-GCM, 256-bit</strong><p>Files are encrypted in the browser before upload. The object store receives encrypted bytes rather than the original file contents.</p></div>
              <div><span>Wallet authentication</span><strong>Nonce + signature</strong><p>A unique server nonce is signed by the wallet. The server verifies the signature and creates a temporary in-memory session token.</p></div>
              <div><span>Vault secret</span><strong>Encrypted locally</strong><p>A per-vault secret is wrapped using material derived from the wallet unlock signature. The stored secret is encrypted, not plaintext.</p></div>
              <div><span>Access boundary</span><strong>Owner scoped</strong><p>File listing, download, deletion, and vault-secret requests require an authenticated session and are scoped to the wallet owner.</p></div>
            </div>
            <div id="identity-and-access" className="docs-prose"><h3>Identity and access</h3><p>NoBreach does not use email/password accounts. A wallet address is the vault identity. Each login signs a one-time nonce, and that nonce is deleted after successful verification to prevent replay through the same challenge.</p><p>A session is held in the backend process memory. Restarting the backend invalidates active sessions, requiring users to sign in again.</p></div>
            <div id="encryption-flow" className="docs-prose"><h3>Encryption flow</h3><ol><li>The wallet connects to Robinhood Chain.</li><li>The browser signs a login nonce and a vault-unlock message.</li><li>The browser creates or retrieves an encrypted vault secret.</li><li>Files and metadata are encrypted locally with Web Crypto before upload.</li><li>The encrypted object is stored under a generated UUID; PostgreSQL stores ownership and encrypted metadata.</li></ol></div>
          </section>

          <section id="operations" className="docs-section">
            <p className="eyebrow">Operations</p><h2>How the service runs.</h2>
            <div id="system-architecture" className="docs-architecture"><div><b>Browser</b><span>Connect wallet, sign messages, encrypt and decrypt files.</span></div><i>1</i><div><b>API</b><span>Express service verifies signatures, sessions, payments, and ownership.</span></div><i>2</i><div><b>Data</b><span>PostgreSQL/Prisma stores users, payments, nonces, file records, and encrypted vault secrets.</span></div><i>3</i><div><b>Object storage</b><span>S3-compatible R2 stores encrypted file objects.</span></div></div>
            <div id="storage-operations" className="docs-prose"><h3>Storage operations</h3><p>Uploads use in-memory request handling with a 50 MB file-size limit. Each encrypted object uses a generated UUID key. File metadata is persisted with the matching owner record. Downloads first confirm that the requested UUID belongs to the authenticated owner, then stream the encrypted object from storage.</p><p>Deleting a file removes its object from storage and its database record. Storage credentials are server-only and must never be placed in `NEXT_PUBLIC_` frontend variables.</p></div>
            <div id="configuration" className="docs-prose"><h3>Configuration</h3><div className="docs-table"><div><code>DATABASE_URL</code><span>PostgreSQL connection for Prisma</span></div><div><code>DIRECT_URL</code><span>Direct database URL for migrations</span></div><div><code>R2_ENDPOINT / R2_BUCKET</code><span>S3-compatible encrypted object storage location</span></div><div><code>R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY</code><span>Server-only storage credentials</span></div><div><code>PAYMENT_RECEIVER</code><span>Wallet that receives one-time activation payments</span></div><div><code>USDG_TOKEN_ADDRESS</code><span>Configured USDG contract address for token verification</span></div><div><code>FRONTEND_URL</code><span>Allowed CORS origin for the web client</span></div></div></div>
          </section>

          <section id="reference" className="docs-section">
            <p className="eyebrow">Reference</p><h2>Network, payments, and API.</h2>
            <div id="network-details" className="docs-table docs-table-wide"><div><code>Network</code><span>Robinhood Chain</span><em>Chain ID 4663 / eip155:4663</em></div><div><code>Authentication</code><span>EIP-1193 compatible injected wallet</span><em>Personal message signatures</em></div><div><code>Encryption</code><span>Web Crypto AES-GCM</span><em>256-bit file encryption</em></div><div><code>Payments</code><span>ETH and configured USDG</span><em>One-time activation, verified on-chain</em></div><div><code>Stock tokens</code><span>Available soon</span><em>Registry lookup exists; payment acceptance is not enabled</em></div></div>
            <div id="payments" className="docs-prose"><h3>Activation payments</h3><p>New vaults require a one-time payment before file and secret endpoints are available. The API retrieves the submitted transaction from Robinhood Chain, confirms the chain, receipt success, sender, recipient, and required amount before saving the payment record. Existing users may be marked for legacy access so their original vault remains available after an upgrade.</p></div>
            <div id="api-surface" className="docs-prose"><h3>API surface</h3><div className="docs-api"><div><b>POST</b><code>/nonce</code><span>Create or return a wallet login nonce.</span></div><div><b>POST</b><code>/login</code><span>Verify signature and issue a session.</span></div><div><b>GET</b><code>/payment/options</code><span>Return configured activation options.</span></div><div><b>POST</b><code>/payment/verify</code><span>Validate a payment transaction.</span></div><div><b>GET / POST</b><code>/secret</code><span>Retrieve or store the encrypted vault secret.</span></div><div><b>GET / POST</b><code>/files / upload</code><span>List encrypted file records or upload an encrypted payload.</span></div><div><b>GET / DELETE</b><code>/download/:id / files/:id</code><span>Retrieve or remove a vault-owned encrypted file.</span></div></div></div>
            <div id="recovery-limits" className="docs-callout docs-warning"><strong>Recovery limits</strong><span>NoBreach cannot recover a lost wallet, recovery phrase, or signing capability. Keep a secure wallet backup. As with any hosted service, access also depends on the application, network, database, and storage systems operating correctly.</span></div>
            <div id="status-and-support" className="docs-prose"><h3>Status and support</h3><p>Contract address and social channels are marked as coming soon. For production operations, monitor API availability, PostgreSQL health, storage access, payment RPC availability, failed signature checks, and object-storage errors.</p></div>
          </section>
        </article>
      </div>
    </main>
  )
}
