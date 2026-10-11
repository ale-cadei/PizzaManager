'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EXE = 'psmux.exe';
/** Il nome della versione fa da nome di cartella: cifre e punti, al piu' un suffisso di build. */
const VERSION_RE = /^\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.]+)?$/;
const VERSION_TIMEOUT_MS = 5000;

const isVersion = (v) => typeof v === 'string' && VERSION_RE.test(v);

/**
 * La versione di psmux dall'output di `-V`. La prima riga dice `tmux 3.3.8` per
 * compatibilita'; la seconda, `psmux 3.3.8 (…)`, e' quella che lo distingue dal
 * tmux di MSYS2, che stampa solo la prima (Q5 di docs/plans/40-risultati.md).
 * null se quella riga manca o se la versione non e' un nome di cartella sicuro.
 */
function parsePsmuxVersion(stdout) {
  const m = String(stdout || '').match(/^psmux (\S+)/m);
  return m && isVersion(m[1]) ? m[1] : null;
}

const defaultRun = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: VERSION_TIMEOUT_MS, windowsHide: true });

/**
 * Il psmux del pacchetto, copiato fuori dall'app (docs/plans/52-psmux-backend.md).
 *
 * Le sessioni vivono ad app chiusa, e ogni server psmux e' un processo dell'exe
 * che l'ha creato: un psmux.exe dentro la cartella dell'app la terrebbe
 * bloccata durante l'aggiornamento automatico. Per questo si lancia da una
 * copia in `localDir/<versione>/`. Una cartella per versione, perche' la copia
 * vecchia e' bloccata finche' le sue sessioni vivono: quella nuova le sta
 * accanto, non sopra.
 *
 * `sourceDir` e' dove il pacchetto tiene psmux.exe, `localDir` la cartella delle
 * copie: le passa main.js, i test una tmpdir. Ogni fallimento (exe assente, -V
 * che non dice psmux, antivirus, disco) da' null: l'app ricade sul
 * comportamento senza psmux, senza errori a schermo.
 */
function createPsmuxInstall({ sourceDir, localDir, run = defaultRun, rm = fs.rmSync } = {}) {
  if (!sourceDir || !localDir) throw new Error('createPsmuxInstall richiede sourceDir e localDir');

  function binFor(version) {
    if (!isVersion(version)) return null;
    const bin = path.join(localDir, version, EXE);
    return fs.existsSync(bin) ? bin : null;
  }

  function install() {
    const source = path.join(sourceDir, EXE);
    if (!fs.existsSync(source)) return null;
    try {
      const version = parsePsmuxVersion(run(source, ['-V']));
      if (!version) return null;
      const existing = binFor(version);
      // Gia' copiato: non si riscrive, potrebbe essere l'exe di una sessione viva.
      if (existing) return { bin: existing, version };
      const dir = path.join(localDir, version);
      fs.mkdirSync(dir, { recursive: true });
      // Copia e poi rinomina: un avvio interrotto a meta' lascia un .tmp, mai
      // un psmux.exe troncato che binFor prenderebbe per buono.
      const bin = path.join(dir, EXE);
      const partial = `${bin}.${process.pid}.tmp`;
      fs.copyFileSync(source, partial);
      fs.renameSync(partial, bin);
      return { bin, version };
    } catch {
      return null;
    }
  }

  function installedVersions() {
    let entries;
    try {
      entries = fs.readdirSync(localDir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.filter((e) => e.isDirectory() && binFor(e.name)).map((e) => e.name);
  }

  /**
   * Toglie le copie delle versioni che non sono in `keep`. Chi chiama ci mette
   * la versione corrente e quelle delle sessioni vive (`@ais_psmux`): un exe in
   * uso non si cancella comunque, e una cartella che resiste non ferma le
   * altre. Restituisce le versioni tolte.
   */
  function prune(keep = []) {
    const kept = new Set(keep);
    const removed = [];
    for (const version of installedVersions()) {
      if (kept.has(version)) continue;
      try {
        rm(path.join(localDir, version), { recursive: true, force: true });
        removed.push(version);
      } catch {
        // bloccata: si riprova al prossimo avvio
      }
    }
    return removed;
  }

  return { install, binFor, installedVersions, prune };
}

module.exports = { createPsmuxInstall, parsePsmuxVersion };
