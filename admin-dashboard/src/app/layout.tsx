import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { DashboardLayout } from "@/components/DashboardLayout";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Delito Admin Dashboard",
  description: "Admin dashboard for Delito food delivery platform",
};

// Phone-first viewport — allows pinch-zoom on the wide report tables
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        <ThemeProvider>
          <DashboardLayout>
            {children}
          </DashboardLayout>
        </ThemeProvider>
      </body>
    </html>
  );
}
