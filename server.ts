import express from "express";
import { createServer as createViteServer } from "vite";
import apiApp from "./api/index.js";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Mount the API routes
  app.use(apiApp);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
