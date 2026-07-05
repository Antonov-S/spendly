import NextAuth, { CredentialsSignin } from "next-auth"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { verifyCredentials } from "@/lib/auth/credentials"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"
import { isTokenRevoked } from "@/lib/auth/session-epoch"
import authConfig from "./auth.config"

/**
 * Thrown from `authorize` when the login rate limit is exceeded. NextAuth
 * normalizes any throw here to a generic CredentialsSignin, so we surface the
 * cause through the `code`, which the sign-in form reads to show a distinct
 * "too many attempts" banner instead of the usual invalid-credentials message.
 */
class RateLimitError extends CredentialsSignin {
  code = "rate_limited"
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  ...authConfig,
  // Override the edge-safe providers from auth.config with the Node-runtime
  // versions. Credentials here runs the real bcrypt/Prisma validation.
  providers: [
    Google,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      // Rate-limit before any DB/bcrypt work. Keyed by IP + email so an
      // attacker can't grind a single account, and a shared IP can't lock out
      // unrelated accounts. This authorize is the single choke point every
      // signIn("credentials") flows through, so the limit can't be bypassed.
      authorize: async (credentials, request) => {
        const ip = getClientIp(request.headers)
        const email = String(credentials?.email ?? "").trim().toLowerCase()
        const { success } = await checkRateLimit("login", `${ip}:${email}`)
        if (!success) {
          throw new RateLimitError()
        }
        return verifyCredentials(credentials)
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Block soft-deleted accounts from signing back in during the grace period.
    // Credentials are already gated in verifyCredentials; this covers the
    // Google OAuth path, where the adapter resolves the user by email.
    async signIn({ user }) {
      if (!user.email) return true
      const existing = await prisma.user.findUnique({
        where: { email: user.email },
        select: { deletedAt: true },
      })
      return !existing?.deletedAt
    },
    async jwt({ token, user }) {
      if (user) {
        const id = user.id ?? token.sub
        const row = id
          ? await prisma.user.findUnique({
              where: { id },
              select: { sessionEpoch: true },
            })
          : null
        token.epoch = row?.sessionEpoch ?? 0
        return token
      }

      if (!token.sub) return token

      const row = await prisma.user.findUnique({
        where: { id: token.sub },
        select: { sessionEpoch: true, deletedAt: true },
      })
      if (isTokenRevoked(token.epoch, row)) return null

      return token
    },
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub
      }
      return session
    },
  },
})
