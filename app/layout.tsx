import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BURRIANA - GTR SOLUTIONS-",
  description: "Gestión de inventario, ubicaciones, tareas 5S y cierre de turno.",
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
