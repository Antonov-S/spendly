"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { credentialsSchema } from "@/lib/validations/auth";

/** Result returned to the sign-in form's `useActionState` hook. */
export interface SignInState {
  error?: string;
}

/**
 * Validate credentials and start a session. On success `signIn` throws a
 * redirect to `/dashboard` (re-thrown here); on bad input or a failed
 * authorize it returns a generic error to avoid leaking which field was wrong.
 */
export async function authenticate(
  _prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Please enter a valid email and password." };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error:
          "Invalid email or password, or your email isn't verified yet.",
      };
    }
    // Re-throw the NEXT_REDIRECT control-flow error on success.
    throw error;
  }
}

/** Start the Google OAuth flow, returning to the dashboard on success. */
export async function signInWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/dashboard" });
}

/** Clear the session and return to the sign-in page. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/sign-in" });
}
