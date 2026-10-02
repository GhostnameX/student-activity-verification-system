import { Elysia } from "elysia";
import { getSession, type SessionUser } from "./auth/session";

/**
 * sessionPlugin — เรียก getSession() ครั้งเดียวต่อ request แล้วแชร์ผ่าน ctx.user
 *
 * ใช้ Elysia `derive` เพื่อให้ทุก route เข้าถึง user ได้โดยไม่ต้องเรียก
 * getSession() ซ้ำๆ ทำให้ลด DB round-trip จาก N ครั้ง (ตามจำนวน middleware
 * ที่เรียก) เหลือแค่ 1 ครั้งต่อ HTTP request
 */
export const sessionPlugin = new Elysia({ name: "session" }).derive(
  { as: "global" },
  async ({ headers }): Promise<{ user: SessionUser | null }> => ({
    user: await getSession(headers),
  }),
);
