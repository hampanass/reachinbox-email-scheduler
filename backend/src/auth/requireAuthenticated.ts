import type { NextFunction, Request, Response } from "express";

export function requireAuthenticated(request: Request, response: Response, next: NextFunction): void {
  if (request.isAuthenticated?.() && request.user) {
    next();
    return;
  }

  response.status(401).json({ error: "Authentication required" });
}