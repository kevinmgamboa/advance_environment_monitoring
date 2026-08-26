import type { Metadata } from "next";
import "./globals.css";

export const metadata:Metadata={
  title:"Frontera Data Labs · Home Noise Dashboard",
  description:"Explore daily noise dynamics captured around your home."
};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>{children}</body></html>;
}
