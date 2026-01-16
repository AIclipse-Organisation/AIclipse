
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header>
          <h1>AICLIPSE Community</h1>
        </header>
        {children}
      </body>
    </html>
  );
}
