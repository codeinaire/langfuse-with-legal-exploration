import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Legal Agent Flow Demo",
  description:
    "AI-driven workflow guidance for legal matter lifecycle management.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
