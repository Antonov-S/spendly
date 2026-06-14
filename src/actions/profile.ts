"use server";

import { prisma } from "@/lib/prisma";
import { auth, signOut } from "@/auth";
import { changeUserPassword } from "@/lib/auth/change-password";
import { softDeleteAccount } from "@/lib/auth/account";

/** Result returned to the change-password form's `useActionState` hook. */
export interface ChangePasswordState {
  success?: boolean;
  error?: string;
}

/**
 * Change the signed-in user's password. Reads the session server-side so the
 * target account can never be supplied by the client.
 */
export async function changePassword(
  _prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be signed in to change your password." };
  }

  const result = await changeUserPassword(session.user.id, {
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!result.success) {
    return { error: result.error };
  }

  return { success: true };
}

/** Result returned to the delete-account form's `useActionState` hook. */
export interface DeleteAccountState {
  error?: string;
}

/**
 * Soft-delete the signed-in user's account after re-confirming their email,
 * then end the session. On success `signOut` throws a redirect (re-thrown here).
 */
export async function deleteAccount(
  _prevState: DeleteAccountState,
  formData: FormData
): Promise<DeleteAccountState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be signed in to delete your account." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  if (!user) {
    return { error: "Account not found." };
  }

  // Require the typed confirmation to match the account email exactly.
  const confirmation = String(formData.get("confirmEmail") ?? "")
    .trim()
    .toLowerCase();
  if (confirmation !== user.email.toLowerCase()) {
    return { error: "The email you entered does not match your account." };
  }

  const result = await softDeleteAccount(session.user.id);
  if (!result.success) {
    return { error: result.error };
  }

  await signOut({ redirectTo: "/sign-in?deleted=1" });
  return {};
}
