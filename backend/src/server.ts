import "dotenv/config";
import { app } from "./app";
// 5050 is the default API port for local development.
const port = Number(process.env.PORT || 5050);
app.listen(port, () => console.log(`SwachhLens API listening on ${port}`));
