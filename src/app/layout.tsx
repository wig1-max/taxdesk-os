import type { Metadata } from "next";
import { APP_NAME, COMPANY_NAME } from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: `Internal operations command center for ${COMPANY_NAME}.`,
  robots: { index: false, follow: false }, // internal tool — never index
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
