// Dev-only Google bypass for local iPad testing.
// Returns a fake verified Google profile so the app can be tested
// without OAuth round-trips. NEVER enabled in production.
//
// Guard rules:
//  - Throws unconditionally when NODE_ENV === "production"
//  - Only active when AUTH_BYPASS_GOOGLE === "true"
//  - Only imported dynamically (never statically) when the environment
//    above is satisfied. See check-dev-bypass.sh / app.ts wiring.

export interface DevGoogleProfile {
  email: string;
  name: string;
  emailVerified: boolean;
  picture?: string;
}

export async function getDevGoogleProfile(rawEmail?: string): Promise<DevGoogleProfile> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("auth/google.dev is not allowed in production");
  }
  if (process.env.AUTH_BYPASS_GOOGLE !== "true") {
    throw new Error("AUTH_BYPASS_GOOGLE is not 'true'");
  }
  const email = rawEmail || process.env.DEV_GOOGLE_EMAIL || "dev-student@uni.ac.th";
  return {
    email,
    name: "ผู้ทดสอบ (Dev Google)",
    emailVerified: true,
    picture: undefined,
  };
}