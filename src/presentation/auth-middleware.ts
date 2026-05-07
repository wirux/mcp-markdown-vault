import type { RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";

export function createBearerAuthMiddleware(
  token: string | undefined,
): RequestHandler | null {
  if (!token) return null;

  const expectedBuffer = Buffer.from(token, "utf-8");

  const middleware: RequestHandler = (req, res, next) => {
    const header = req.headers["authorization"];

    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing Bearer token" });
      return;
    }

    const provided = header.slice(7);
    const providedBuffer = Buffer.from(provided, "utf-8");

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    next();
  };

  return middleware;
}
