import type { Metadata, Viewport } from "next"
import { Space_Grotesk, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { Providers } from "@/components/Providers"
import { BRAND } from "@/lib/brand"
import "./globals.css"

// Display face for headings and the product name; body face for everything else.
const display = Space_Grotesk({ subsets: ["latin"], variable: "--ff-display" })
const body = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--ff-body" })
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" })

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.description,
  // PWA-ready metadata
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: BRAND.name,
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  themeColor: "#12100e",
  // Mobile viewport optimization
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Safe area support for notched devices
  viewportFit: "cover",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Resolved here so SessionProvider hydrates with it and no view flashes its
  // signed-out state on a hard refresh.
  const session = await getServerSession(authOptions)
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(window.matchMedia('(prefers-color-scheme:dark)').matches)document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
        {/* Prevent iOS text size adjustment */}
        <meta name="x-apple-disable-message-reformatting" />
      </head>
      <body className={`${display.variable} ${body.variable} ${jetbrainsMono.variable} font-sans antialiased overflow-hidden`}>
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  )
}
