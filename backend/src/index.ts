import "dotenv/config";
import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();
app.listen(config.port, () => {
  console.log(`HRIS backend listening on http://localhost:${config.port}`);
});
