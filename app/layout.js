import "./globals.css";

export const metadata = {
  title: "Predikcia · Alza LOG",
  description: "Predikcia objemov, kapacít a kvality pre sklady Alza LOG",
};

export default function RootLayout({ children }) {
  return (
    <html lang="sk">
      <body>{children}</body>
    </html>
  );
}
