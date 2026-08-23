import bcrypt from "bcryptjs";

/** Generate a bcrypt value for ADMIN_PASSWORD_HASH without storing the password. */
async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: npm.cmd run hash:admin -- "your-admin-password"');
    process.exitCode = 1;
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  console.log(`ADMIN_PASSWORD_HASH=${hash}`);
}

void main();
