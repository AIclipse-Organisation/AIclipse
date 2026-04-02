import "./styles/appShell.css";
import "./global.css";
import "./styles/modal/modal.css";

import Script from "next/script";
import ShellWrapper from "./components/ShellWrapper";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLoginUrlFromHeaders } from "../externalOrigin";
import { getTrustedUserFromHeaderStore } from "./lib/trustedUser";

export default async function RootLayout({ children }) {
  const h = await headers();
  const loginUrl = getLoginUrlFromHeaders(h);
  let user = null;
  try {
    user = getTrustedUserFromHeaderStore(h);
  } catch {
    redirect(loginUrl);
  }

  return (
    <html lang="en">
      <head>
        <title>AIclipse</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
        <link rel="stylesheet" href="/static/css/tutorial.css" />
      </head>
      <body data-tutorial-user={String(user?.user_id || "")}>
        <Script src="/static/js/tutorial-core.js" strategy="afterInteractive" />
        <ShellWrapper user={user}>{children}</ShellWrapper>
      </body>
    </html>
  );
}
