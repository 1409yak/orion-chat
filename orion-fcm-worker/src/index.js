/**
 * Cloudflare Worker for Orion FCM HTTP v1 Push Notifications
 * Uses Web Crypto API to sign Google OAuth2 JWTs and send push notifications via FCM HTTP v1 API
 */

// Cache Google OAuth2 access token to avoid signing and fetching on every request
let cachedToken = null;
let tokenExpiresAt = 0;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function base64UrlEncode(data) {
  let base64 = "";
  if (typeof data === "string") {
    base64 = btoa(data);
  } else {
    const bytes = new Uint8Array(data);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer.buffer;
}

async function getGoogleAccessToken(clientEmail, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  // Return cached token if valid for at least another 60 seconds
  if (cachedToken && tokenExpiresAt > now + 60) {
    return cachedToken;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  };

  const encHeader = base64UrlEncode(JSON.stringify(header));
  const encPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encHeader}.${encPayload}`;

  const keyBuffer = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signedJwt = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt,
    }),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    throw new Error(`Google OAuth2 token exchange failed (${tokenResponse.status}): ${errText}`);
  }

  const tokenData = await tokenResponse.json();
  cachedToken = tokenData.access_token;
  tokenExpiresAt = now + (tokenData.expires_in || 3600);
  return cachedToken;
}

async function sendFcmMessage(projectId, accessToken, recipientToken, title, body, dataPayload = {}) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const fcmPayload = {
    message: {
      token: recipientToken,
      notification: {
        title: title || "New Message",
        body: body || "",
      },
      data: {
        ...dataPayload,
        title: title || "New Message",
        body: body || "",
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channel_id: "default",
        },
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(fcmPayload),
  });

  const responseText = await response.text();
  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = { text: responseText };
  }

  return {
    ok: response.ok,
    status: response.status,
    data: responseData,
    token: recipientToken,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

    const otaMatch = url.pathname.match(/\/download-ota\/(v[\d.]+)\/bundle\.zip/i) || 
                     url.pathname.match(/\/download-ota\/([\d.]+)\/bundle\.zip/i);

    if (otaMatch || url.pathname === '/download-ota') {
      let rawVersion = otaMatch ? otaMatch[1] : (url.searchParams.get('version') || 'v1.0.2');
      const targetTag = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`;
      const candidateUrls = [
        `https://github.com/1409yak/orion-chat/releases/download/${targetTag}/bundle.zip?t=${Date.now()}`,
        `https://github.com/1409yak/orion-web/releases/download/${targetTag}/bundle.zip?t=${Date.now()}`
      ];

      try {
        let ghRes = null;
        for (const candidateUrl of candidateUrls) {
          try {
            const res = await fetch(candidateUrl, {
              method: 'GET',
              redirect: 'follow',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OrionUpdater/1.0',
                'Accept': '*/*'
              },
              cf: { cacheTtl: 0 }
            });
            if (res.ok) {
              ghRes = res;
              break;
            }
          } catch (_) {}
        }

        if (!ghRes || !ghRes.ok) {
          return new Response(`GitHub error: ${ghRes ? ghRes.status : 404}`, {
            status: ghRes ? ghRes.status : 404,
            headers: { 'Access-Control-Allow-Origin': '*' }
          });
        }

        const buffer = await ghRes.arrayBuffer();

        const responseHeaders = {
          'Content-Type': 'application/zip',
          'Content-Length': buffer.byteLength.toString(),
          'Content-Disposition': `attachment; filename="bundle-${targetTag}.zip"`,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Expose-Headers': 'Content-Length',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Accept-Ranges': 'bytes'
        };

        if (request.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: responseHeaders
          });
        }

        return new Response(buffer, {
          status: 200,
          headers: responseHeaders
        });
      } catch (err) {
        return new Response(`Proxy Error: ${err.message}`, {
          status: 500,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    if (request.method === "GET" || request.method === "HEAD") {
      if (url.pathname === "/version.json" || url.pathname === "/version") {
        return new Response(
          JSON.stringify({
            version: "1.0.2",
            url: "https://orion-fcm-worker.gaim.workers.dev/download-ota/v1.0.2/bundle.zip",
            checksum: "4ae248bead0ec6a661464214cf7a44127fc9da70e3de229525938d787fdae9ff",
            notes: "Dynamic version display, fixed settings exit, and restored updates channel."
          }, null, 2),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control": "no-store, no-cache, must-revalidate",
            },
          }
        );
      }

      if (url.pathname === "/bundle-1.0.2.zip" || url.pathname === "/bundle.zip") {
        return Response.redirect(`${url.origin}/download-ota/v1.0.2/bundle.zip`, 302);
      }

      return new Response(
        JSON.stringify({
          status: "online",
          service: "orion-fcm-worker",
          versionCheckUrl: "https://orion-fcm-worker.charming-button.workers.dev/version.json",
          bundleUrl: "https://orion-fcm-worker.charming-button.workers.dev/bundle-1.0.2.zip",
          project: env.FIREBASE_PROJECT_ID || "unknown",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const projectId = env.FIREBASE_PROJECT_ID;
      const clientEmail = env.FIREBASE_CLIENT_EMAIL;
      const privateKey = env.FIREBASE_PRIVATE_KEY;

      if (!projectId || !clientEmail || !privateKey) {
        return new Response(
          JSON.stringify({
            error: "Server configuration missing: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const body = await request.json();
      const rawTokens = body.recipientFcmToken || body.token || body.tokens;
      const title = body.senderName || body.title || "New Message";
      const messageText = body.messageText || body.body || body.text || "";
      const chatId = body.chatId ? String(body.chatId) : "";

      if (!rawTokens) {
        return new Response(
          JSON.stringify({ error: "Missing recipientFcmToken or tokens" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokens = Array.isArray(rawTokens) ? rawTokens : [rawTokens];
      const validTokens = tokens.filter((t) => typeof t === "string" && t.trim().length > 0);

      if (validTokens.length === 0) {
        return new Response(
          JSON.stringify({ error: "No valid tokens provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get Google OAuth2 access token
      const accessToken = await getGoogleAccessToken(clientEmail, privateKey);

      // Dispatch to tokens
      const results = await Promise.all(
        validTokens.map((t) =>
          sendFcmMessage(projectId, accessToken, t, title, messageText, {
            chatId: chatId,
            senderId: body.senderId ? String(body.senderId) : "",
          })
        )
      );

      const successCount = results.filter((r) => r.ok).length;
      return new Response(
        JSON.stringify({
          success: successCount > 0,
          total: validTokens.length,
          delivered: successCount,
          results: results,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: err.message || "Internal server error",
          stack: err.stack,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
