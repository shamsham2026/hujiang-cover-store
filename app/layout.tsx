import type { Metadata } from "next"
import { Noto_Sans_TC, Noto_Serif_TC } from "next/font/google"
import { Shell } from "@/components/shell"
import "./globals.css"

const sans = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-app-sans",
})

const serif = Noto_Serif_TC({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-app-serif",
})

export const metadata: Metadata = {
  title: "滬江小學 調課代課",
  description: "",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body className={`${sans.variable} ${serif.variable} antialiased`}>
        <Shell>{children}</Shell>
      </body>
    </html>
  )
}
