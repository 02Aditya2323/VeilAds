import type { Metadata } from "next";
import { Providers } from "@/components/layout/Providers";
import { WalletHeader } from "@/components/layout/WalletHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "VeilAds",
  description: "Confidential attention marketplace on Fhenix CoFHE",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="shell">
            <WalletHeader />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
