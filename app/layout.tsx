import type { Metadata, Viewport } from "next";
import { Inter, Lato, Poppins } from "next/font/google";
import AppLoader from "./components/app-loader";
import "./globals.css";

// Apple devices render San Francisco from the system stack; Inter covers the rest.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Brand faces: the loading cube and the sign-in scene (titles in Poppins, text in Lato).
const poppins = Poppins({ subsets: ["latin"], weight: "500", variable: "--font-poppins", display: "swap" });
const lato = Lato({ subsets: ["latin"], weight: ["300", "400"], variable: "--font-lato", display: "swap" });

export const metadata: Metadata = {
  title: "Burriana · Grupo Trimodos",
  description: "Organización del almacén, viajes de producción, pedidos, camiones e inventario.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32 48x48" },
      { url: "/brand/icono-app-redondeado.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/brand/icono-app-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  // The app chrome is light; the installed app uses the brand black from the manifest.
  themeColor: "#f5f5f7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${inter.variable} ${poppins.variable} ${lato.variable}`}>
      <body><AppLoader>{children}</AppLoader></body>
    </html>
  );
}
