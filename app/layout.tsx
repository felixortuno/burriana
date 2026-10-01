import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BURRIANA - GTR SOLUTIONS-",
  description: "Organización del almacén, viajes de producción, pedidos, camiones e inventario.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
