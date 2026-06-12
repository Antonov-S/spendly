import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import type { NextAuthConfig } from "next-auth"

export default {
  // Credentials is a placeholder here: the edge-compatible config cannot run
  // bcrypt/Prisma, so authorize is a no-op. The real validation is wired in
  // auth.ts, which overrides the providers list at the Node runtime.
  providers: [Google, Credentials({ authorize: () => null })],
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const { pathname } = nextUrl
      const isAuthPage = pathname === "/sign-in" || pathname === "/register"
      const isProtected =
        pathname.startsWith("/dashboard") || pathname.startsWith("/profile")

      // Signed-in users have no reason to see sign-in/register.
      if (isAuthPage) {
        return isLoggedIn
          ? Response.redirect(new URL("/dashboard", nextUrl))
          : true
      }

      if (isProtected) {
        return isLoggedIn
      }

      return true
    },
  },
} satisfies NextAuthConfig
