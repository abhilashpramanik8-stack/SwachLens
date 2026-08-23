import { write } from "./store";
write("issues.json", []);
write("reports.json", []);
write("passwordResetTokens.json", []);
console.log(
  "Demo data reset. Campus coordinates remain configurable in backend/data/campuses.json",
);
