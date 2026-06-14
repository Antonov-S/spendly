import { NextResponse } from "next/server";
import { registerUser } from "@/lib/auth/register";
import {
  checkRateLimit,
  getClientIp,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

export async function POST(request: Request) {
  const { success, retryAfterSeconds } = await checkRateLimit(
    "register",
    getClientIp(request.headers)
  );
  if (!success) {
    return tooManyRequestsResponse(retryAfterSeconds);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const result = await registerUser(body);

  if (!result.success) {
    const status = result.code === "DUPLICATE" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ success: true, user: result.data }, { status: 201 });
}
