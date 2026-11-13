/**
 * Menulis DATABASE_URL dan DATA_SOURCE=postgis ke .env secara interaktif.
 * Password diketik tanpa ditampilkan. Jalankan: npm run db:configure
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '..', '.env');

function ask(question, { hidden = false, fallback = '' } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim() || fallback);
    });
  });
}

async function main() {
  const user = await ask('User PostgreSQL [postgres]: ', { fallback: 'postgres' });
  const password = await ask('Password: ', { hidden: true });
  const host = await ask('Host [localhost]: ', { fallback: 'localhost' });
  const port = await ask('Port [5432]: ', { fallback: '5432' });
  const database = await ask('Nama database [nutrimap]: ', { fallback: 'nutrimap' });

  const url = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;

  let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  env = env.replace(/^#?\s*DATABASE_URL=.*$/m, '').replace(/^DATA_SOURCE=.*$/m, 'DATA_SOURCE=postgis');
  if (!/^DATA_SOURCE=/m.test(env)) env += '\nDATA_SOURCE=postgis';
  env = env.replace(/^DATA_SOURCE=postgis$/m, `DATA_SOURCE=postgis\nDATABASE_URL=${url}`);
  fs.writeFileSync(ENV_PATH, env.replace(/\n{3,}/g, '\n\n'));

  console.log(`\n.env diperbarui (DATA_SOURCE=postgis, database ${database} di ${host}:${port}).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
