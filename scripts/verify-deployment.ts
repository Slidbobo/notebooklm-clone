import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Post-deploy verification.
 *
 * A deploy counts as successful when the live URL serves the commit that was
 * pushed and reports every dependency as healthy. Checking only that the build
 * finished is what lets a green pipeline sit in front of a dead application.
 *
 * Polls rather than checking once, because a deployment becomes reachable a few
 * seconds after the build reports success, and because a stale instance can
 * still answer during the switchover. That is exactly what the commit field
 * guards against.
 *
 * Deep mode signs in with a demo account first, since deep checks require a
 * session. It is opt-in: CI verifies the shallow endpoint, which needs no
 * credentials at all.
 */
const DEFAULT_URL = "https://notebooklm-clone.vercel.app";
const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 180_000;

type Args = { url: string; expectedCommit: string | null; deep: boolean };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  return {
    url: (flag("url") ?? process.env.DEPLOYMENT_URL ?? DEFAULT_URL).replace(/\/$/, ""),
    expectedCommit: (flag("commit") ?? process.env.EXPECTED_COMMIT ?? null)?.slice(0, 7) ?? null,
    deep: argv.includes("--deep"),
  };
}

async function signInAsDemo(baseUrl: string): Promise<string | null> {
  const password = process.env.DEMO_A_PASSWORD;
  if (!password) {
    console.error("DEMO_A_PASSWORD is not set; cannot run deep checks.");
    return null;
  }

  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  const cookies = collectCookies(csrfResponse);

  const body = new URLSearchParams({
    email: "demo-a@example.com",
    password,
    csrfToken,
    redirect: "false",
  });

  const signIn = await fetch(`${baseUrl}/api/auth/callback/demo`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies },
    body,
    redirect: "manual",
  });

  const session = collectCookies(signIn, cookies);
  return session.includes("authjs.session-token") ? session : null;
}

function collectCookies(response: Response, existing = ""): string {
  const jar = new Map<string, string>();
  for (const pair of existing.split("; ").filter(Boolean)) {
    const [name, ...rest] = pair.split("=");
    if (name) jar.set(name, rest.join("="));
  }
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const [name, ...rest] = (pair ?? "").split("=");
    if (name) jar.set(name, rest.join("="));
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

type HealthBody = {
  status: string;
  commit: string;
  depth: string;
  checks: Record<string, { status: string; reason?: string }>;
};

async function probe(url: string, cookie: string | null): Promise<HealthBody | null> {
  try {
    const response = await fetch(url, {
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    });
    const body: unknown = await response.json();
    // An older build answers in a different shape. That is not an error, it
    // means the deployment being waited for is not live yet.
    return isHealthBody(body) ? body : null;
  } catch {
    return null;
  }
}

/** True once the endpoint answers in the shape this script understands. */
function isHealthBody(body: unknown): body is HealthBody {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Partial<HealthBody>;
  return typeof candidate.status === "string" && typeof candidate.checks === "object";
}

function render(body: HealthBody) {
  console.log(`  status: ${body.status}  commit: ${body.commit}  depth: ${body.depth}`);
  for (const [name, check] of Object.entries(body.checks ?? {})) {
    const mark = check.status === "ok" ? "✓" : "✗";
    console.log(`  ${mark} ${name}: ${check.status}${check.reason ? ` (${check.reason})` : ""}`);
  }
}

async function main() {
  const { url, expectedCommit, deep } = parseArgs();
  let cookie: string | null = null;

  if (deep) {
    cookie = await signInAsDemo(url);
    if (!cookie) {
      console.error("Could not establish a demo session; deep checks unavailable.");
      process.exit(1);
    }
  }

  const endpoint = `${url}/api/health${deep ? "?deep=1" : ""}`;
  console.log(`Verifying ${endpoint}`);
  if (expectedCommit) console.log(`Expecting commit ${expectedCommit}`);

  const deadline = Date.now() + TIMEOUT_MS;
  let last: HealthBody | null = null;
  let sawUnknownShape = false;

  while (Date.now() < deadline) {
    const body = await probe(endpoint, cookie);
    if (!body) {
      sawUnknownShape = true;
    } else {
      last = body;
      const commitMatches = !expectedCommit || body.commit === expectedCommit;
      if (commitMatches && body.status === "ok") {
        console.log("Deployment verified.");
        render(body);
        return;
      }
      if (!commitMatches) {
        console.log(`  waiting: live commit is ${body.commit}, expected ${expectedCommit}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.error("Deployment verification failed.");
  if (last) {
    render(last);
  } else if (sawUnknownShape) {
    console.error(
      "  the endpoint answered but not in the expected shape, so the deployment under test never went live",
    );
  } else {
    console.error("  the endpoint never returned a readable response");
  }
  process.exit(1);
}

main().catch((error) => {
  console.error("Verification crashed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
