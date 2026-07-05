import { describe, expect, it } from "vitest";
import authConfig from "@/auth.config";

function request(pathname: string) {
  return {
    nextUrl: new URL(`https://spendly.test${pathname}`),
  };
}

describe("authConfig authorized", () => {
  const authorized = authConfig.callbacks?.authorized;

  it("treats a user object without an id as signed out", () => {
    expect(
      authorized?.({
        auth: { user: {} },
        request: request("/dashboard"),
      })
    ).toBe(false);
  });

  it("redirects signed-in users with an id away from auth pages", () => {
    const result = authorized?.({
      auth: { user: { id: "user-1" } },
      request: request("/sign-in"),
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toBe(
      "https://spendly.test/dashboard"
    );
  });

  it("allows auth pages when there is no user id", () => {
    expect(
      authorized?.({
        auth: { user: {} },
        request: request("/sign-in"),
      })
    ).toBe(true);
  });
});
