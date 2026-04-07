import { NextResponse } from "next/server";
import { Readable } from "stream";
import http from "node:http";
import {
  buildAdminError,
  getAdminAccessToken,
  parseGatewayBody,
  proxyAdminJson,
  sanitizeLogMessage,
} from "@/app/lib/adminGateway";

export const runtime = "nodejs";
const GATEWAY_URL = process.env.GATEWAY_URI;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "750mb",
    },
  },
};

export async function GET(req) {
  return proxyAdminJson({
    path: "/admin/models",
  });
}

export async function POST(req) {
  try {
    const token = await getAdminAccessToken();

    if (!token) {
      return buildAdminError(401, "Unauthorized");
    }

    const contentType = req.headers.get("content-type");
    const contentLength = req.headers.get("content-length");

    if (!contentType?.includes("multipart/form-data")) {
      return buildAdminError(400, "Invalid Content-Type");
    }

    console.log(`[AdminAPI] Piping ${contentLength || "?"} bytes via native HTTP...`);

    const targetUrl = new URL(`${GATEWAY_URL}/admin/models/upload`);
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": contentType,
        ...(contentLength && { "Content-Length": contentLength }),
      },
    };

    return new Promise((resolve) => {
      const proxyReq = http.request(options, (proxyRes) => {
        let responseBody = "";

        proxyRes.on("data", (chunk) => {
          responseBody += chunk;
        });

        proxyRes.on("end", () => {
          const parsed = parseGatewayBody(responseBody);
          if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
            resolve(
              buildAdminError(
                proxyRes.statusCode,
                "Gateway Error",
                parsed || responseBody,
              ),
            );
            return;
          }

          if (typeof parsed === "string") {
            resolve(NextResponse.json({ message: parsed }, { status: proxyRes.statusCode || 200 }));
            return;
          }

          resolve(NextResponse.json(parsed, { status: proxyRes.statusCode || 200 }));
        });
      });

      proxyReq.on("error", (err) => {
        console.error("🔥 [AdminAPI] Proxy Request Error:", sanitizeLogMessage(err && err.message));
        resolve(buildAdminError(502, "Proxy Error", err.message));
      });

      if (req.body) {
        const nodeStream = Readable.fromWeb(req.body);
        nodeStream.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    });

  } catch (err) {
    console.error("🔥 [AdminAPI POST] Exception:", err);
    return buildAdminError(500, "Internal Error", err.message);
  }
}
