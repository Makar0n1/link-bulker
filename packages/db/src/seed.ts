/**
 * Seed the super admin user.
 *
 * Reads ADMIN_EMAIL and ADMIN_PASSWORD_HASH from env.
 * Idempotent: re-running updates the existing admin's password hash.
 *
 * To generate a hash:
 *   node -e "console.log(require('bcryptjs').hashSync('your_password', 12))"
 */
import { prisma, Role } from './index';

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!email || !passwordHash) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD_HASH must be set in env to seed the super admin.',
    );
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: Role.ADMIN },
    create: { email, passwordHash, role: Role.ADMIN },
  });

  console.log(`[seed] super admin ready: ${user.email} (id=${user.id})`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
