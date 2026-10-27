const BUNGIE_BASE = "https://www.bungie.net/Platform";
const OAUTH_TOKEN_URL = "https://www.bungie.net/Platform/App/OAuth/token/";
const encoder = new TextEncoder();

function corsHeaders(origin, env) {
  if (!origin || origin !== env.ALLOWED_ORIGIN) return null;
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  if (!secret || secret.length < 32) throw new Error("STATE_SECRET must contain at least 32 characters.");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signState(value, secret) {
  const payload = b64url(encoder.encode(JSON.stringify(value)));
  const key = await hmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return payload + "." + b64url(signature);
}

async function readState(value, secret) {
  const parts = String(value || "").split(".");
  if (parts.length !== 2) throw new Error("Invalid OAuth state.");
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, fromB64url(parts[1]), encoder.encode(parts[0]));
  if (!valid) throw new Error("OAuth state signature did not match.");
  const decoded = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
  if (!decoded || !decoded.expiresAt || Date.now() > Number(decoded.expiresAt)) throw new Error("OAuth state expired.");
  if (!decoded.returnTo || typeof decoded.returnTo !== "string") throw new Error("Invalid return URL.");
  return decoded;
}

function requiredSecrets(env) {
  const missing = ["BUNGIE_API_KEY", "BUNGIE_CLIENT_ID", "BUNGIE_CLIENT_SECRET", "STATE_SECRET"]
    .filter((name) => !env[name]);
  if (missing.length) throw new Error("Worker secrets missing: " + missing.join(", "));
}

function callbackUrl(request) {
  return new URL("/oauth/callback", request.url).href;
}

function encodeRedirectPayload(value) {
  return b64url(encoder.encode(JSON.stringify(value)));
}

const OAUTH_STATE_COOKIE = "ll_oauth_state";

function cookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
}

function oauthStateCookie(value, maxAge = 600) {
  return OAUTH_STATE_COOKIE + "=" + encodeURIComponent(value) +
    "; Path=/oauth/callback; Secure; HttpOnly; SameSite=Lax; Max-Age=" + maxAge;
}

function redirectWithCookie(location, cookie) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function safeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function appendPageHash(returnTo, name, payload) {
  const url = new URL(returnTo);
  url.hash = name + "=" + encodeRedirectPayload(payload);
  return url.href;
}

function validateOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (origin !== env.ALLOWED_ORIGIN) return null;
  return corsHeaders(origin, env);
}

async function exchangeToken(body, env) {
  const form = new URLSearchParams(body);
  form.set("client_id", env.BUNGIE_CLIENT_ID);
  form.set("client_secret", env.BUNGIE_CLIENT_SECRET);
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const description = data.error_description || data.Message || data.ErrorStatus || ("Bungie token endpoint returned HTTP " + response.status);
    throw new Error(description);
  }
  return data;
}

function isAllowedApiRoute(path, method) {
  if (method === "GET" && path === "/Destiny2/Manifest/") return "manifest";
  if (method === "GET" && path === "/User/GetMembershipsForCurrentUser/") return "authenticated";
  if (method === "GET" && /^\/Destiny2\/\d+\/Profile\/\d+\/?$/.test(path)) return "authenticated";
  if (method === "POST" && [
    "/Destiny2/Actions/Items/TransferItem/",
    "/Destiny2/Actions/Items/PullFromPostmaster/",
    "/Destiny2/Actions/Items/EquipItem/",
    "/Destiny2/Actions/Items/SetLockState/",
  ].includes(path)) return "authenticated";
  return null;
}

async function proxyBungie(request, env, cors) {
  const incoming = new URL(request.url);
  const path = incoming.pathname.slice("/api".length) || "/";
  const routeType = isAllowedApiRoute(path, request.method);
  if (!routeType) return json({ error: "This Bungie API route is not enabled by the Little Light Worker." }, 404, cors);

  const authorization = request.headers.get("Authorization") || "";
  if (routeType === "authenticated" && !/^Bearer\s+\S+$/i.test(authorization)) {
    return json({ error: "Missing Bungie access token." }, 401, cors);
  }

  const upstream = new URL(BUNGIE_BASE + path);
  upstream.search = incoming.search;
  const headers = new Headers({
    "X-API-Key": env.BUNGIE_API_KEY,
    "Accept": "application/json",
  });
  if (routeType === "authenticated") headers.set("Authorization", authorization);
  let body;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
    const contentType = request.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);
  }
  const response = await fetch(upstream.href, { method: request.method, headers, body });
  const data = await response.text();
  return new Response(data, {
    status: response.status,
    headers: {
      ...cors,
      "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/health" && method === "GET") {
    const cors = validateOrigin(request, env);
    if (!cors) return json({ error: "Origin is not allow-listed." }, 403);
    return json({ ok: true, service: "Little Light Bungie Worker", oauthConfigured: Boolean(env.BUNGIE_CLIENT_ID && env.BUNGIE_CLIENT_SECRET), apiKeyConfigured: Boolean(env.BUNGIE_API_KEY), stateSecretConfigured: Boolean(env.STATE_SECRET && env.STATE_SECRET.length >= 32) }, 200, cors);
  }

  if (path === "/oauth/start" && method === "GET") {
    requiredSecrets(env);
    const returnTo = url.searchParams.get("return_to") || "";
    if (!env.SITE_URL || returnTo !== env.SITE_URL) {
      return new Response("Rejected OAuth return URL. Configure SITE_URL and use the exact Little Light Pages URL.", { status: 400 });
    }
    const nonce = crypto.randomUUID();
    const state = await signState({
      returnTo: env.SITE_URL,
      expiresAt: Date.now() + 10 * 60 * 1000,
      nonce,
    }, env.STATE_SECRET);
    const authorize = new URL("https://www.bungie.net/en/OAuth/Authorize");
    authorize.searchParams.set("client_id", env.BUNGIE_CLIENT_ID);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("state", state);
    return redirectWithCookie(authorize.href, oauthStateCookie(nonce));
  }

  if (path === "/oauth/callback" && method === "GET") {
    let state;
    try {
      const rawState = url.searchParams.get("state");
      state = await readState(rawState, env.STATE_SECRET);
      if (state.returnTo !== env.SITE_URL) throw new Error("OAuth return URL does not match Worker configuration.");
      const browserNonce = cookieValue(request, OAUTH_STATE_COOKIE);
      if (!browserNonce || !safeEqual(browserNonce, state.nonce)) {
        throw new Error("OAuth state did not match the browser that started sign-in. Start Bungie sign-in again.");
      }
      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        return redirectWithCookie(appendPageHash(state.returnTo, "bungie-auth-error", {
          error: oauthError,
          description: url.searchParams.get("error_description") || "",
        }), oauthStateCookie("", 0));
      }
      const code = url.searchParams.get("code");
      if (!code) throw new Error("Bungie did not return an authorization code.");
      const data = await exchangeToken({ grant_type: "authorization_code", code }, env);
      return redirectWithCookie(appendPageHash(state.returnTo, "bungie-auth", data), oauthStateCookie("", 0));
    } catch (error) {
      const safeReturn = env.SITE_URL;
      if (safeReturn) {
        return redirectWithCookie(appendPageHash(safeReturn, "bungie-auth-error", {
          error: "oauth_callback_failed",
          description: error instanceof Error ? error.message : "OAuth callback failed.",
        }), oauthStateCookie("", 0));
      }
      return new Response("Little Light OAuth failed. Check the Worker configuration and logs.", { status: 400 });
    }
  }

  const cors = validateOrigin(request, env);
  if (!cors) return json({ error: "Origin is not allow-listed." }, 403);

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (path === "/oauth/refresh" && method === "POST") {
    try {
      requiredSecrets(env);
      const body = await request.json().catch(() => ({}));
      if (!body.refresh_token) return json({ error: "Missing refresh_token." }, 400, cors);
      const data = await exchangeToken({ grant_type: "refresh_token", refresh_token: String(body.refresh_token) }, env);
      return json(data, 200, cors);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Token refresh failed." }, 400, cors);
    }
  }

  if (path.startsWith("/api/")) {
    try {
      if (!env.BUNGIE_API_KEY) return json({ error: "Worker is missing the BUNGIE_API_KEY secret." }, 503, cors);
      if (path !== "/api/Destiny2/Manifest/" && !request.headers.get("Authorization")) {
        return json({ error: "Missing Bungie authorization header." }, 401, cors);
      }
      return await proxyBungie(request, env, cors);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Bungie proxy failed." }, 502, cors);
    }
  }

  return json({ error: "Not found." }, 404, cors);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unexpected Worker error." }, 500);
    }
  },
};
