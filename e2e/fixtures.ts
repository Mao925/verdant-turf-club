import { test, expect, type BrowserContext } from "@playwright/test";
import { type Envelope } from "../src/domain/world";
const uid = "10000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  aud: "authenticated",
  role: "authenticated",
  email: "owner@example.test",
  app_metadata: { provider: "google", providers: ["google"] },
  user_metadata: {},
  created_at: "2026-09-08T00:00:00Z",
};
export async function signInFixture(context: BrowserContext) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access =
    [
      { alg: "HS256", typ: "JWT" },
      { sub: uid, exp, aud: "authenticated", role: "authenticated" },
    ]
      .map((o) => Buffer.from(JSON.stringify(o)).toString("base64url"))
      .join(".") + ".test-signature";
  await context.addInitScript(
    ({ access, exp, user }) => {
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: access,
          refresh_token: "local-test-refresh",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: exp,
          user,
        }),
      );
    },
    { access, exp, user },
  );
}
export function service() {
  return {
    head: null as Envelope | null,
    seen: new Set<string>(),
    fail: false,
    lose: false,
    calls: 0,
    applied: 0,
  };
}
export async function routeService(
  context: BrowserContext,
  db: ReturnType<typeof service>,
) {
  await context.route("http://127.0.0.1:54321/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/user")) return route.fulfill({ json: user });
    if (url.includes("/auth/v1/logout")) return route.fulfill({ status: 204 });
    if (url.includes("/rest/v1/owner_checkpoints"))
      return route.fulfill({ json: [] });
    if (db.fail) return route.abort("internetdisconnected");
    if (url.includes("/rpc/load_owner_save"))
      return route.fulfill({ json: db.head });
    if (url.includes("/rpc/commit_owner_save")) {
      db.calls++;
      const body = route.request().postDataJSON();
      if (db.seen.has(body.p_command_id))
        return route.fulfill({ json: db.head });
      if ((db.head?.revision ?? 0) !== body.p_expected_revision)
        return route.fulfill({
          status: 409,
          json: { code: "PT409", message: "revision conflict" },
        });
      const entities = body.p_replace ? {} : { ...db.head?.state.entities };
      for (const e of body.p_upserts) entities[e.id] = e;
      db.head = {
        revision: body.p_expected_revision + 1,
        state: { core: body.p_core, entities },
      };
      db.seen.add(body.p_command_id);
      db.applied++;
      if (db.lose) {
        db.lose = false;
        return route.abort("connectionreset");
      }
      return route.fulfill({ json: db.head });
    }
    return route.fulfill({
      status: 404,
      json: { message: "unexpected test route" },
    });
  });
}
