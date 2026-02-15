import "./styles/appShell.css";
import { cookies } from "next/headers"; 
import ShellWrapper from "./components/ShellWrapper"; 
import "./global.css"

import "./styles/modal/modal.css"

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
        <ShellWrapper user={user}>
          {children}
        </ShellWrapper>
      </body>
    </html>
  );
}