import fs from "fs";
import path from "path";
const root = path.resolve(__dirname, "..", "data");
export function read<T>(file: string): T[] {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) fs.writeFileSync(p, "[]");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
export function write<T>(file: string, value: T[]): void {
  const p = path.join(root, file),
    tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, p);
}
