"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth, signOut } from "@/auth";
import { changeUserPassword } from "@/lib/auth/change-password";
import { softDeleteAccount } from "@/lib/auth/account";
import { updateProfileSchema } from "@/lib/validations/profile";

/** Result returned to the settings name form's `useActionState` hook. */
export interface UpdateProfileState {
  success?: boolean;
  /** Timestamp of the successful save; a fresh value each call so the client can
   *  re-trigger its auto-dismissing banner even when the name is unchanged. */
  at?: number;
  error?: string;
}

/**
 * Update the signed-in user's display name. Reads the session server-side (S2)
 * and writes only the `name` column of the user's own row (S3) — never `email`,
 * `isPro`, `preferredCurrency`, or `stripe*`. Last-write-wins on a single owned
 * scalar; re-applying the same name is an idempotent no-op write.
 */
export async function updateProfile(
  _prevState: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be signed in to update your profile." };
  }

  const parsed = updateProfileSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid name." };
  }

  await prisma.user.update({
    where: { id: session.user.id }, // session-derived (S2)
    data: { name: parsed.data.name }, // name only (S3)
  });

  revalidatePath("/settings");
  revalidatePath("/profile");
  return { success: true, at: Date.now() };
}

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
