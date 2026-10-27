import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const origin = "https://lesbunny.github.io";
const siteUrl = "https://lesbunny.github.io/test/";
const workerUrl = "https://little-light-bungie.example.workers.dev";
const env = {
  ALLOWED_ORIGIN: origin,
  SITE_URL: siteUrl,
  BUNGIE_API_KEY: "test-api-key",
  BUNGIE_CLIENT_ID: "123456",
  BUNGIE_CLIENT_SECRET: "test-client-secret",
  STATE_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

async function withFetch(mock, callback) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = previous;
  }
}

function request(path, { method = "GET", headers = {}, body } = {}) {
  return new Request(workerUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("health endpoint exposes readiness without revealing secrets", async () => {
  const response = await worker.fetch(request("/health", { headers: { Origin: origin } }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.oauthConfigured, true);
  assert.equal(data.apiKeyConfigured, true);
  assert.equal(data.stateSecretConfigured, true);
  assert.equal(JSON.stringify(data).includes("test-client-secret"), false);
  assert.equal(JSON.stringify(data).includes("test-api-key"), false);
});

test("health and API proxy reject other origins", async () => {
  const response = await worker.fetch(request("/health", { headers: { Origin: "https://attacker.example" } }), env);
  assert.equal(response.status, 403);
  const api = await worker.fetch(request("/api/User/GetMembershipsForCurrentUser/", {
    headers: { Origin: "https://attacker.example", Authorization: "Bearer user-token" },
  }), env);
  assert.equal(api.status, 403);
});

test("API proxy denies every path outside its allow-list", async () => {
  let upstreamCalled = false;
  const response = await withFetch(async () => {
    upstreamCalled = true;
    return new Response("unexpected");
  }, () => worker.fetch(request("/api/Destiny2/Actions/Items/DismantleItem/", {
    headers: { Origin: origin, Authorization: "Bearer user-token" },
    method: "POST",
    body: {},
  }), env));
  assert.equal(response.status, 404);
  assert.equal(upstreamCalled, false);
});

test("manifest proxy injects the Bungie API key and never needs a user token", async () => {
  await withFetch(async (input, init) => {
    assert.equal(String(input), "https://www.bungie.net/Platform/Destiny2/Manifest/");
    assert.equal(new Headers(init.headers).get("X-API-Key"), env.BUNGIE_API_KEY);
    assert.equal(new Headers(init.headers).get("Authorization"), null);
    return Response.json({ ErrorCode: 1, Response: { version: "test-manifest" } });
  }, async () => {
    const response = await worker.fetch(request("/api/Destiny2/Manifest/", { headers: { Origin: origin } }), env);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.Response.version, "test-manifest");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  });
});

test("authenticated profile proxy forwards the user's bearer token", async () => {
  await withFetch(async (input, init) => {
    assert.equal(String(input), "https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer user-token");
    assert.equal(new Headers(init.headers).get("X-API-Key"), env.BUNGIE_API_KEY);
    return Response.json({ ErrorCode: 1, Response: { destinyMemberships: [] } });
  }, async () => {
    const response = await worker.fetch(request("/api/User/GetMembershipsForCurrentUser/", {
      headers: { Origin: origin, Authorization: "Bearer user-token" },
    }), env);
    assert.equal(response.status, 200);
  });
});

test("OAuth start validates the return URL and signs state", async () => {
  const rejected = await worker.fetch(request("/oauth/start?return_to=" + encodeURIComponent("https://attacker.example/")), env);
  assert.equal(rejected.status, 400);
  const response = await worker.fetch(request("/oauth/start?return_to=" + encodeURIComponent(siteUrl)), env);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("Location"));
  assert.equal(location.origin, "https://www.bungie.net");
  assert.equal(location.pathname, "/en/OAuth/Authorize");
  assert.equal(location.searchParams.get("client_id"), env.BUNGIE_CLIENT_ID);
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.ok(location.searchParams.get("state"));
});

test("OAuth callback exchanges the code server-side and redirects tokens in the fragment", async () => {
  await withFetch(async (input, init) => {
    assert.equal(String(input), "https://www.bungie.net/Platform/App/OAuth/token/");
    const form = new URLSearchParams(init.body);
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "auth-code");
    assert.equal(form.get("client_id"), env.BUNGIE_CLIENT_ID);
    assert.equal(form.get("client_secret"), env.BUNGIE_CLIENT_SECRET);
    return Response.json({
      access_token: "access-test",
      refresh_token: "refresh-test",
      expires_in: 3600,
      refresh_expires_in: 86400,
      membership_id: "123",
    });
  }, async () => {
    const start = await worker.fetch(request("/oauth/start?return_to=" + encodeURIComponent(siteUrl)), env);
    const state = new URL(start.headers.get("Location")).searchParams.get("state");
    const callback = await worker.fetch(request("/oauth/callback?code=auth-code&state=" + encodeURIComponent(state)), env);
    assert.equal(callback.status, 302);
    const target = new URL(callback.headers.get("Location"));
    assert.equal(target.origin + target.pathname, siteUrl);
    const params = new URLSearchParams(target.hash.slice(1));
    const encoded = params.get("bungie-auth");
    assert.ok(encoded);
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(normalized + "=".repeat((4 - normalized.length % 4) % 4), "base64").toString("utf8"));
    assert.equal(payload.access_token, "access-test");
    assert.equal(payload.refresh_token, "refresh-test");
  });
});

test("refresh-token requests keep the client secret inside the Worker", async () => {
  await withFetch(async (input, init) => {
    assert.equal(String(input), "https://www.bungie.net/Platform/App/OAuth/token/");
    const form = new URLSearchParams(init.body);
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "refresh-test");
    assert.equal(form.get("client_secret"), env.BUNGIE_CLIENT_SECRET);
    return Response.json({ access_token: "refreshed-access", refresh_token: "refresh-test", expires_in: 3600, refresh_expires_in: 86400 });
  }, async () => {
    const response = await worker.fetch(request("/oauth/refresh", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: { refresh_token: "refresh-test" },
    }), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).access_token, "refreshed-access");
  });
});
