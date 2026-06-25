import { redirect } from "next/navigation";

// `/profile` is a permanent compatibility route — the account-management surface
// is now `/settings`. Kept resolvable indefinitely (it's a plausible bookmark and
// is linked from the UserMenu); the hop is one-directional, so there is no loop.
export default function ProfilePage() {
  redirect("/settings");
}
