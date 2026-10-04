import { loadConfig } from './config.ts';
import { startServer } from './app.ts';

const config = loadConfig();
const app = await startServer(config);
console.log(`Papier — serveur de synchronisation sur le port ${app.port}`);
console.log(`  données : ${config.dataDir}`);
console.log(`  adresse publique : ${config.publicUrl}`);
console.log(`  application : ${config.staticDir ?? '(non servie)'}`);
console.log(`  création de comptes : ${config.allowSignup ? 'ouverte' : 'premier compte seulement'}`);

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    console.log('Arrêt…');
    await app.close();
    process.exit(0);
  });
}
