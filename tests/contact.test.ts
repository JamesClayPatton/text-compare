import { describe, expect, it } from "vitest";
import { contactChoiceToApply } from "../src/account/account";

describe("contactChoiceToApply", () => {
  it("records the sign-in dialog's choice for an account that hasn't chosen", () => {
    expect(contactChoiceToApply(null, true)).toBe(true);
    expect(contactChoiceToApply(null, false)).toBe(false);
  });

  it("never overrides an earlier choice, so signing in again can't re-subscribe anyone", () => {
    expect(contactChoiceToApply(false, true)).toBeNull();
    expect(contactChoiceToApply(true, false)).toBeNull();
  });

  it("does nothing without a pending choice", () => {
    expect(contactChoiceToApply(null, null)).toBeNull();
  });
});
