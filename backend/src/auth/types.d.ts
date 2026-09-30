import "express-serve-static-core";

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string | null;
      googleId?: string | null;
      passwordHash?: string | null;
    }
  }
}

export {};
