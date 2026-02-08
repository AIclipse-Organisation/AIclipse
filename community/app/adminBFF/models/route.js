import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Readable } from "stream";
import http from "node:http";

export const runtime = "nodejs";

const GATEWAY_URL = process.env.GATEWAY_URI

// Helper to clean token
function cleanToken(val) {
  if (!val) return null;
  return val.replace("Bearer ", "").replace(/"/g, "").trim();
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '750mb',
    },
  },
};

export async function GET(req) {
  try {
    const cookieStore = await cookies();
    const token = cleanToken(cookieStore.get("access_token")?.value);

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const res = await fetch(`${GATEWAY_URL}/admin/models`, {
      headers: { 
        "Authorization": `Bearer ${token}` 
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Gateway Error: ${res.status}`, detail: errText }, 
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("🔥 [AdminAPI GET] Exception:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const cookieStore = await cookies();
    const token = cleanToken(cookieStore.get("access_token")?.value);

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = req.headers.get("content-type");
    const contentLength = req.headers.get("content-length");

    if (!contentType?.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Invalid Content-Type" }, { status: 400 });
    }

    console.log(`[AdminAPI] Piping ${contentLength || '?'} bytes via native HTTP...`);

    // 1. Setup the Native Node Request
    const targetUrl = new URL(`${GATEWAY_URL}/admin/models/upload`);
    
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": contentType, // Keep boundary exactly as is
        // We explicitly forward Content-Length so Python knows exactly when to stop
        ...(contentLength && { "Content-Length": contentLength }),
      },
    };

    // 2. Create the Promise wrapper for the Node stream
    return new Promise((resolve, reject) => {
      const proxyReq = http.request(options, (proxyRes) => {
        let responseBody = "";

        // Collect the JSON response from Gateway
        proxyRes.on("data", (chunk) => {
          responseBody += chunk;
        });

        proxyRes.on("end", () => {
          // Pass the Gateway's status and body back to the Client
          try {
             // Try parsing JSON if possible, else return text
             const json = JSON.parse(responseBody);
             resolve(NextResponse.json(json, { status: proxyRes.statusCode }));
          } catch (e) {
             console.error(`[AdminAPI] JSON Parse Error. Raw: ${responseBody.substring(0, 100)}`);
             resolve(NextResponse.json(
                { error: "Gateway response invalid", details: responseBody }, 
                { status: proxyRes.statusCode || 500 }
             ));
          }
        });
      });

      proxyReq.on("error", (err) => {
        console.error("🔥 [AdminAPI] Proxy Request Error:", err);
        resolve(NextResponse.json({ error: "Proxy Error", details: err.message }, { status: 502 }));
      });

      // 3. Pipe the incoming Next.js Web Stream into the Node Request
      if (req.body) {
        const nodeStream = Readable.fromWeb(req.body);
        nodeStream.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    });

  } catch (err) {
    console.error("🔥 [AdminAPI POST] Exception:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}