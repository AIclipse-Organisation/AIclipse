import "./styles/appShell.css";
import Topbar from "./components/Topbar";
import BottomNav from "./components/BottomNav";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app">
          <div className="app-container">
            <Topbar />

            <main className="screen">

              <section className="page-header" aria-label="Page title">
                <h1 className="page-title">Home</h1>
                <div className="page-underline" role="presentation" />
              </section>

              {children}

            </main>

            <BottomNav />
          </div>
        </div>
      </body>
    </html>
  );
}
