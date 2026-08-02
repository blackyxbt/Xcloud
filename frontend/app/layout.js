import './globals.css'

export const metadata = {
  title: 'PrivateCloud',
  description: 'Encrypted storage'
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}
