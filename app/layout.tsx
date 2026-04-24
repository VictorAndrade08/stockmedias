import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 🔥 METADATA OPTIMIZADA PARA SEO (SOCKS / MEDIAS) + FAVICONS
export const metadata: Metadata = {
  title: "Wolfe Socks | Medias con diseños únicos y comodidad",
  description: "Encuentra tu par ideal en Wolfe Socks. Colección de medias con diseños exclusivos, deportivas y casuales. Dale personalidad a tus pasos con envío a todo el país.",
  keywords: [
    "medias", 
    "calcetines", 
    "comprar medias online", 
    "medias con diseño", 
    "Wolfe Socks", 
    "medias divertidas", 
    "calcetines originales",
    "medias animadas",
    "medias Ecuador"
  ],
  authors: [{ name: "Wolfe Socks" }],
  openGraph: {
    title: "Wolfe Socks | Encuentra tu par ideal",
    description: "Combina tus favoritos y ahorra con nuestros Precios de Locura. Dale personalidad a tus pasos.",
    url: "https://wolfesocks.com",
    siteName: "Wolfe Socks",
    locale: "es_EC",
    type: "website",
  },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' }
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Agregamos suppressHydrationWarning aquí para ignorar las extensiones de Chrome
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}