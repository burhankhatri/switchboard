/**
 * Test-only authentication endpoint
 *
 * Creates a test user and returns a valid session token.
 * ONLY enabled when ENABLE_TEST_AUTH=true (should only be set in test environments)
 */

import { prisma } from "@/lib/db/prisma"
import { encode } from "next-auth/jwt"
import { internalError } from "@/lib/db/api-helpers"

export async function POST(req?: Request) {
  // Safety check: only allow in test mode
  if (process.env.ENABLE_TEST_AUTH !== "true") {
    return Response.json(
      { error: "Test auth not enabled. Set ENABLE_TEST_AUTH=true in test environment." },
      { status: 403 }
    )
  }

  try {
    // An optional email lets a test hold two distinct sessions, which is the
    // only way to exercise anything involving one person acting on another —
    // a workspace invite notification, for instance, is never sent to the actor.
    let email = "test@playwright.local"
    let name = "Playwright Test User"
    if (req) {
      const body = await req.json().catch(() => null)
      if (typeof body?.email === "string" && body.email.endsWith(".local")) {
        email = body.email
        name = typeof body?.name === "string" ? body.name : body.email
      }
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name },
    })

    // Generate session token
    const token = await encode({
      token: {
        sub: user.id,
        email: user.email,
        name: user.name,
      },
      secret: process.env.NEXTAUTH_SECRET!,
    })

    return Response.json({
      token,
      userId: user.id,
      email: user.email,
    })
  } catch (error) {
    console.error("Test auth error:", error)
    return internalError(error)
  }
}

// Also support GET for easier testing
export async function GET() {
  return POST()
}
