import { app } from "./app";

app.listen({
  port: Number(process.env.PORT || process.env.API_PORT || 3000),
  hostname: "0.0.0.0",
});

console.log(
  `🦊 API running at http://localhost:${Number(process.env.PORT || process.env.API_PORT || 3000)}`,
);

export type { App } from "./app";
