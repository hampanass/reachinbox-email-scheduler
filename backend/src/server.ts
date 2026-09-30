import "dotenv/config";
import { createApp } from "./app.js";
import { connectSessionStore } from "./auth/sessionStore.js";

const PORT = process.env.PORT || 5001;
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters");
}

await connectSessionStore();
const app = createApp();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});