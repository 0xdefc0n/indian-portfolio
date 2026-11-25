// Better Auth on Workers + D1 (plan §7.1). Created per request: the D1 binding only exists inside the handler.
// Option names checked against better-auth 1.7.28 types in M5.
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { emailOTP, magicLink } from 'better-auth/plugins'
import { ensureHousehold } from './lib/household'
import { LOGIN_EXPIRY_MINUTES } from './lib/email'
import { d1RateLimitStorage } from './lib/rate-limit'

export type AuthEnv = Pick<
  Env,
  'DB' | 'APP_URL' | 'BETTER_AUTH_SECRET' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'DATA_KEK_V1'
>

/**
 * Filled by the two email plugins during POST /api/login/email, which then sends ONE email holding both the link and
 * the code (§13A.5). Outside that route nothing may send: the plugins' own endpoints are not routed (src/routes/auth.ts),
 * and the callbacks refuse to run without a capture.
 */
export type LoginCapture = { token?: string; otp?: string }

export const SESSION_FIELDS = {
  householdId: { type: 'string', input: false, required: false },
  consentVersion: { type: 'string', input: false, required: false }, // filled once consent exists (M14)
} as const

const NO_TOKENS = { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null }

export function authOptions(env: AuthEnv, capture?: LoginCapture) {
  const secure = env.APP_URL.startsWith('https://')
  return {
    appName: 'PocketFolio',
    baseURL: env.APP_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB, // native D1 (Better Auth ≥ 1.5)
    // Vite dev server (web/, :5173) proxies /api to wrangler dev; it's only trusted when the app itself is local.
    trustedOrigins: secure ? [env.APP_URL] : [env.APP_URL, 'http://localhost:5173'],
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }, // set by Cloudflare; otherwise all users share one bucket
      useSecureCookies: secure,
      // Better Auth otherwise introspects the schema once per instance, and we build one per request: that would be
      // an extra D1 query on every request. migrations/app is the schema, and the auth tests run against it.
      database: { validateSchema: false },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days, rolling
      updateAge: 60 * 60 * 24,
      // Signed cookie: most requests skip the D1 session read (§3.5). A revoked session can keep working on
      // cache-trusting routes for up to maxAge; sensitive routes pass disableCookieCache.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
      additionalFields: SESSION_FIELDS,
    },
    // Only the endpoints that can be hammered are limited; everything else ("/**": false) writes no rate-limit row.
    // Sending emails is limited in /api/login/email (per address and per IP), since the plugins' send endpoints
    // aren't routed. Rule order matters: the first matching key wins.
    rateLimit: {
      enabled: true,
      customStorage: d1RateLimitStorage(env.DB, env.BETTER_AUTH_SECRET),
      customRules: {
        '/sign-in/email-otp': { window: 600, max: 20 }, // per IP; each code also allows only 3 tries
        '/magic-link/verify': { window: 600, max: 30 },
        '/sign-in/social': { window: 600, max: 30 },
        '/**': false,
      },
    },
    account: { accountLinking: { enabled: true, trustedProviders: ['google', 'magic-link', 'email-otp'] } },
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: 'select_account' },
    },
    plugins: [
      magicLink({
        expiresIn: LOGIN_EXPIRY_MINUTES * 60,
        storeToken: 'hashed', // D1 Time Travel keeps old rows for 30 days: store nothing usable
        sendMagicLink: async ({ token }) => {
          if (!capture) throw new Error('login email outside /api/login/email')
          capture.token = token
        },
      }),
      emailOTP({
        expiresIn: LOGIN_EXPIRY_MINUTES * 60,
        storeOTP: 'hashed',
        allowedAttempts: 3,
        sendVerificationOTP: async ({ otp, type }) => {
          if (!capture || type !== 'sign-in') throw new Error('login email outside /api/login/email')
          capture.otp = otp
        },
      }),
    ],
    databaseHooks: {
      // We only need Google to say who the user is. Its OAuth tokens are never used, so they are never stored.
      account: {
        create: { before: async (account) => ({ data: { ...account, ...NO_TOKENS } }) },
        update: { before: async (account) => ({ data: { ...account, ...NO_TOKENS } }) },
      },
      session: {
        create: {
          // Every new session (signup or sign-in, any method) carries its household, so requests never look it up.
          before: async (session) => ({
            data: { ...session, householdId: await ensureHousehold(env, session.userId) },
          }),
        },
      },
    },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions
}

export const createAuth = (env: AuthEnv, capture?: LoginCapture) => betterAuth(authOptions(env, capture))
export type Auth = ReturnType<typeof createAuth>
