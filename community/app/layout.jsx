import "./styles/appShell.css";
import "./global.css";

import ShellWrapper from "./components/ShellWrapper";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLoginUrlFromHeaders } from "../externalOrigin";

const GATEWAY_URI = process.env.GATEWAY_URI;

async function getUser(token) {
  if (!token) return null;

  try {
    const res = await fetch(`${GATEWAY_URI}/auth/me`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error("Layout fetch error:", error);
    return null;
  }
}

export default async function RootLayout({ children }) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  const h = await headers();
  const loginUrl = getLoginUrlFromHeaders(h);

  if (!token) redirect(loginUrl);

  const user = await getUser(token);
  if (!user) redirect(loginUrl);

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