import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery stapler", hash)).resolves.toBe(false);
  });

  it("produces a different hash for the same password", async () => {
    const [first, second] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(first).not.toBe(second);
  });

  // A GitHub account has no password hash. The credentials path must fail
  // closed for it rather than throw, so that a failed sign-in cannot be told
  // apart from "this account does not use a password".
  it("rejects accounts without a password hash", async () => {
    await expect(verifyPassword("anything", null)).resolves.toBe(false);
  });

  it("rejects a malformed hash instead of throwing", async () => {
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "scrypt$1$2$3$4$5")).resolves.toBe(false);
  });
});
