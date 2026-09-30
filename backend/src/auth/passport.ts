import "dotenv/config";
import type { PrismaClient } from "@prisma/client";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import type { PassportStatic } from "passport";

type PassportInstance = Pick<PassportStatic, "serializeUser" | "deserializeUser" | "use">;

function profileEmail(profile: Profile): { email: string; verified: boolean } | null {
  const emailProfile = profile.emails?.find((candidate) => candidate.verified);
  const email = emailProfile?.value?.trim().toLowerCase();
  return email ? { email, verified: true } : null;
}

export function configurePassport(passport: PassportInstance, prisma: PrismaClient): boolean {
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      done(null, user ?? false);
    } catch (error: unknown) {
      done(error);
    }
  });

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    console.warn("Google OAuth is disabled: configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL");
    return false;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        state: true,
        passReqToCallback: false,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const identity = profileEmail(profile);
          if (!identity || !identity.verified) {
            done(null, false, { message: "Google must provide a verified email address" });
            return;
          }

          const existingByGoogleId = await prisma.user.findUnique({
            where: { googleId: profile.id },
          });

          if (existingByGoogleId) {
            done(null, existingByGoogleId);
            return;
          }

          const existingByEmail = await prisma.user.findUnique({
            where: { email: identity.email },
          });

          const user = existingByEmail
            ? await prisma.user.update({
                where: { id: existingByEmail.id },
                data: {
                  googleId: profile.id,
                  name: profile.displayName || existingByEmail.name,
                },
              })
            : await prisma.user.create({
                data: {
                  googleId: profile.id,
                  email: identity.email,
                  name: profile.displayName || null,
                  passwordHash: null,
                },
              });

          done(null, user);
        } catch (error: unknown) {
          done(error as Error);
        }
      },
    ),
  );

  return true;
}