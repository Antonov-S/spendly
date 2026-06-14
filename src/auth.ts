import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { verifyCredentials } from "@/lib/auth/credentials"
import authConfig from "./auth.config"

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
      authorize: (credentials) => verifyCredentials(credentials),
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
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub
      }
      return session
    },
  },
})
