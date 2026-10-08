'use strict';
const { execFileSync, spawnSync } = require('child_process');

/**
 * Firma, notarizza e timbra i .dmg, dopo che electron-builder li ha costruiti.
 *
 * Perche' serve: `mac.notarize` notarizza il .app, e il .dmg viene costruito
 * DOPO — quindi nasce senza ticket e con la firma adhoc che gli mette hdiutil.
 * Chi scarica riceve il .dmg, ed e' il primo oggetto che macOS valuta: senza
 * questi passi `spctl` lo rifiuta («no usable signature») e lo strumento di
 * Apple dice «not suitable for distribution», anche con l'app dentro perfetta.
 * Misurato il 2026-10-08, vedi docs/plans/44-release-firmata.md.
 *
 * L'ORDINE conta: firmare invalida un francobollo gia' attaccato, perche' il
 * ticket e' legato all'impronta del file. Quindi firma, poi invia, poi timbra.
 *
 * La documentazione di electron-builder sconsiglia `dmg.sign` («will lead to
 * unwanted errors in combination with notarization requirements»): per questo
 * la firma del .dmg la facciamo qui e non con quell'opzione — cosi' resta
 * accanto all'invio, nell'ordine giusto.
 *
 * Non fa niente quando non puo': fuori da macOS, senza identita' di firma o
 * senza credenziali di notarizzazione. Come le guardie di release.yml, un
 * build senza materiale di firma deve riuscire comunque, non fallire.
 */

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

/**
 * Il verdetto di Gatekeeper, qualunque esso sia.
 *
 * Due trappole in un comando solo: `spctl` scrive il verdetto su STDERR, non
 * su stdout, ed esce con codice diverso da zero quando rifiuta. Con execFileSync
 * e lo stderr non catturato si otteneva una stringa vuota quando accettava, e
 * un'eccezione senza motivo leggibile quando rifiutava — cioe' il contrario di
 * quello che serve. spawnSync non lancia e restituisce i due flussi.
 */
function gatekeeperVerdict(path) {
  const r = spawnSync('spctl', ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', path], { encoding: 'utf8' });
  return `${r.stdout || ''}${r.stderr || ''}`.trim();
}

/** Le credenziali per notarytool, nella stessa precedenza di electron-builder. */
function notaryArgs(env) {
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return ['--key', env.APPLE_API_KEY, '--key-id', env.APPLE_API_KEY_ID, '--issuer', env.APPLE_API_ISSUER];
  }
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return ['--apple-id', env.APPLE_ID, '--password', env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', env.APPLE_TEAM_ID];
  }
  // In locale basta il profilo salvato nel portachiavi: la password non passa
  // da una riga di comando (`notarytool store-credentials`).
  if (env.APPLE_KEYCHAIN_PROFILE) return ['--keychain-profile', env.APPLE_KEYCHAIN_PROFILE];
  return null;
}

/** L'identita' Developer ID presente nel portachiavi, o null. */
function signingIdentity() {
  try {
    const out = run('security', ['find-identity', '-v', '-p', 'codesigning']);
    const line = out.split('\n').find((l) => l.includes('Developer ID Application'));
    const m = line && line.match(/"([^"]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Accettato vuol dire accettato E notarizzato: un `accepted` da solo non
 * basterebbe, perche' va cercato nel testo giusto. Il caso che ci e' sfuggito
 * due volte oggi e' «firmato ma senza francobollo», che risponde `rejected`
 * con `no usable signature`.
 */
function isAccepted(verdict) {
  return /: accepted\b/.test(verdict) && /source=Notarized Developer ID/.test(verdict);
}

exports.default = async function notarizeDmg(context) {
  if (process.platform !== 'darwin') return;
  const dmgs = (context.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
  if (!dmgs.length) return;

  const identity = signingIdentity();
  const notary = notaryArgs(process.env);
  if (!identity || !notary) {
    console.log(`  • dmg: firma e notarizzazione saltate (${!identity ? 'nessun Developer ID nel portachiavi' : 'nessuna credenziale di notarizzazione'})`);
    return;
  }

  for (const dmg of dmgs) {
    console.log(`  • dmg: firma ${dmg}`);
    run('codesign', ['--force', '--sign', identity, '--timestamp', dmg]);
    console.log('  • dmg: invio ad Apple, puo\' richiedere qualche minuto');
    run('xcrun', ['notarytool', 'submit', dmg, ...notary, '--wait']);
    console.log('  • dmg: francobollo');
    run('xcrun', ['stapler', 'staple', dmg]);
    // La prova del nove: se Gatekeeper non lo accetta, il build deve fallire
    // qui e non alla prima segnalazione di chi ha scaricato.
    const verdict = gatekeeperVerdict(dmg);
    if (!isAccepted(verdict)) throw new Error(`dmg non accettato da Gatekeeper:\n${verdict}`);
    console.log('  • dmg: accettato da Gatekeeper, notarizzato');
  }
};

// Esportati per i test e per poter verificare un .dmg gia' costruito senza
// rifare il giro di firma e notarizzazione (che costa due invii ad Apple).
exports.gatekeeperVerdict = gatekeeperVerdict;
exports.isAccepted = isAccepted;
exports.notaryArgs = notaryArgs;
