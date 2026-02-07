import "./styles/appShell.css";
import { cookies } from "next/headers"; 
import Topbar from "./components/Topbar";
import BottomNav from "./components/BottomNav";

const GATEWAY_URI = process.env.GATEWAY_URI || "http://gateway-srv:3000";

async function getUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) return null;

  try {
    const res = await fetch(`${GATEWAY_URI}/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
      next: { revalidate: 60 } 
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error("Layout fetch error:", error);
    return null;
  }
}

export default async function RootLayout({ children }) {
  const user = await getUser();

  return (
    <html lang="en">
      <body>
        <div className="app">
          <div className="app-container">
            <Topbar 
              isAdmin={user?.role === "admin" || user?.is_admin === true} 
              userName={user?.user_name || "Guest"} 
            />

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