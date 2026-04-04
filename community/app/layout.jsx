import "./styles/appShell.css";
import "./global.css";
import "./styles/modal/modal.css";

import ShellWrapper from "./components/ShellWrapper";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLoginUrlFromHeaders } from "../externalOrigin";
import { getBrowserUserForAppShell } from "./lib/browserUser";

export default async function RootLayout({ children }) {
  const h = await headers();
  const loginUrl = getLoginUrlFromHeaders(h);
  let user = null;
  try {
    user = await getBrowserUserForAppShell();
  } catch (error) {
    console.warn(`[community] layout redirect (${error?.message || "missing_trusted_headers"})`);
    redirect(loginUrl);
  }

  return (
    <html lang="en">
      <head>
        <title>AIclipse</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
      </head>
      <body>
        <ShellWrapper user={user}>{children}</ShellWrapper>
      </body>
    </html>
  );
}
