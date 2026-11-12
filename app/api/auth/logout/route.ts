import { seeOther } from "@/lib/session";

export async function GET() {
  const res = seeOther("/");
  res.headers.append("Set-Cookie", "sc_session=; Path=/; Max-Age=0");
  return res;
}
