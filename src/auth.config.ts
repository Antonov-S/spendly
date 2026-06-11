import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import type { NextAuthConfig } from "next-auth"

export default {
  // Credentials is a placeholder here: the edge-compatible config cannot run
  // bcrypt/Prisma, so authorize is a no-op. The real validation is wired in
  // auth.ts, which overrides the providers list at the Node runtime.
  providers: [Google, Credentials({ authorize: () => null })],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard")
      if (isOnDashboard) {
        return isLoggedIn
      }
      return true
    },
  },
} satisfies NextAuthConfig
