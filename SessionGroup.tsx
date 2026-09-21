/* ---------------------------------------------------------------------------
   SessionGroup — variante "Fascicolo"

   Linguetta a cartellina sopra, spessore di fogli sotto. Linguetta e fogli
   sono lo stesso materiale (--surface-cap), il pannello un altro
   (--surface-group): è questo che tiene insieme il pezzo invece di farlo
   sembrare una card con due decorazioni.

   Dipendenze: solo React + Tailwind. I colori sono letti dalle variabili CSS
   di tokens.css con valori arbitrari (`bg-[var(--surface-cap)]`), quindi il
   componente funziona senza toccare tailwind.config.js. Se preferisci nomi
   più corti, in fondo al file trovi la mappatura da incollare nel config.
--------------------------------------------------------------------------- */

import { useState } from 'react'

export type Session = {
  id: string
  title: string
  /** riga di metadati sotto il titolo, es. "Claude · OAuth" */
  meta: string
  active?: boolean
}

export type SessionGroupProps = {
  name: string
  sessions: Session[]
  /** true = gruppo selezionato: alza i bordi a --border-strong */
  focused?: boolean
  defaultCollapsed?: boolean
  onAdd?: () => void
  onSelect?: (id: string) => void
  onClose?: (id: string) => void
}

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

/**
 * Quanti fogli spuntano sotto il pannello.
 * Zero sessioni nessun foglio, una o due un foglio, tre o più due fogli.
 * Mai tre: il fondo diventa una frangia. Da collassato resta un foglio solo,
 * ed è la traccia di spessore che distingue un fascicolo chiuso da una
 * linguetta vuota.
 */
function sheetCount(n: number, collapsed: boolean): 0 | 1 | 2 {
  if (n === 0) return 0
  if (collapsed) return 1
  return n < 3 ? 1 : 2
}

export function SessionGroup({
  name,
  sessions,
  focused = false,
  defaultCollapsed = false,
  onAdd,
  onSelect,
  onClose,
}: SessionGroupProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const sheets = sheetCount(sessions.length, collapsed)

  const edge = focused ? 'border-[var(--border-strong)]' : 'border-[var(--border-subtle)]'
  // i fogli restano sempre sullo sfondo: non seguono lo stato di focus
  const sheet =
    'absolute h-3 rounded-b-[var(--radius-lg)] border border-t-0 ' +
    'border-[var(--border-subtle)] bg-[var(--surface-cap)]'

  return (
    // 28px = space-6 + i 4px che i fogli occupano fuori dal pannello.
    // Sotto i 24px la linguetta del gruppo successivo appoggia su questi fogli.
    <section className="relative mt-7 first:mt-0">
      {/* Linguetta a sinistra, "+" all'estremità destra della stessa riga:
          nello spazio libero accanto alla linguetta, dove non entra in
          collisione con la × della prima sessione. */}
      <div className="flex items-end">
        {/* Larga quanto il contenuto, al massimo il 75% del gruppo.
            -mb-px la salda al bordo del pannello. */}
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          aria-expanded={!collapsed}
          className={cx(
            'relative z-10 inline-flex h-[26px] max-w-[75%] items-center gap-2 px-2.5',
            'border bg-[var(--surface-cap)] rounded-t-[var(--radius-md)]',
            edge,
            collapsed ? 'rounded-b-[var(--radius-md)]' : '-mb-px border-b-0',
          )}
        >
          <FolderIcon />
          <span className="truncate text-[13px] font-semibold leading-4 text-[var(--ink)]">
            {name}
          </span>
          <span className="text-[11px] font-semibold leading-[14px] text-[var(--ink-muted)]">
            {sessions.length}
          </span>
        </button>

        <button
          type="button"
          onClick={onAdd}
          aria-label="Nuova sessione"
          className="mb-1 ml-auto mr-1 h-5 w-5 flex-none rounded-full text-sm leading-none text-[var(--ink-faint)] hover:text-[var(--ink)]"
        >
          +
        </button>
      </div>

      {/* I fogli vanno PRIMA del pannello nel DOM: entrambi sono posizionati,
          quindi il pannello — che viene dopo — li copre. Niente z-index
          negativo, che si rompe dentro un antenato con transform/isolate. */}
      {sheets >= 2 && (
        <span aria-hidden className={cx(sheet, 'inset-x-[15px] -bottom-[11px] opacity-[.55]')} />
      )}
      {sheets >= 1 && (
        <span
          aria-hidden
          className={cx(sheet, '-bottom-[6px]', sheets === 1 ? 'inset-x-[9px]' : 'inset-x-[7px]')}
        />
      )}

      {!collapsed && (
        /* Angolo vivo in alto a sinistra: è lì che si innesta la linguetta. */
        <div
          className={cx(
            'relative flex flex-col border p-1',
            'rounded-b-[var(--radius-lg)] rounded-tr-[var(--radius-lg)]',
            'bg-[var(--surface-group)] shadow-[var(--shadow-stack)]',
            edge,
          )}
        >
          {sessions.map(s => (
            <SessionRow key={s.id} session={s} onSelect={onSelect} onClose={onClose} />
          ))}
        </div>
      )}
    </section>
  )
}

function SessionRow({
  session,
  onSelect,
  onClose,
}: {
  session: Session
  onSelect?: (id: string) => void
  onClose?: (id: string) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(session.id)}
      className={cx(
        'flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-[7px]',
        session.active ? 'bg-[var(--surface-row)]' : 'hover:bg-[var(--surface-row)]',
      )}
    >
      <span className="min-h-[28px] w-[3px] flex-none self-stretch rounded-full bg-[var(--accent-violet)]" />
      <span className="h-[7px] w-[7px] flex-none rotate-45 bg-[var(--accent-violet)]" />
      <AgentIcon />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-[18px] text-[var(--ink)]">
          {session.title}
        </span>
        <span className="mt-1 block text-[11px] leading-[14px] text-[var(--ink-muted)]">
          {session.meta}
        </span>
      </span>
      <button
        type="button"
        aria-label="Chiudi sessione"
        onClick={e => {
          e.stopPropagation()
          onClose?.(session.id)
        }}
        className="p-[3px] text-[13px] leading-none text-[var(--ink-faint)] hover:text-[var(--ink)]"
      >
        ✕
      </button>
    </div>
  )
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="flex-none">
      <path
        d="M1.5 4.4c0-.7.6-1.3 1.3-1.3h2.9l1.4 1.5h5.1c.7 0 1.3.6 1.3 1.3v6c0 .7-.6 1.3-1.3 1.3H2.8c-.7 0-1.3-.6-1.3-1.3z"
        fill="var(--folder-amber)"
      />
    </svg>
  )
}

function AgentIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden className="flex-none">
      <path
        d="M5 3.7 4.1 2.3M11 3.7l.9-1.4"
        stroke="var(--agent-green)"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <rect x="3.4" y="4.6" width="9.2" height="7.6" rx="2.6" fill="var(--agent-green)" />
      <circle cx="6.2" cy="7.9" r=".95" fill="#11140f" />
      <circle cx="9.8" cy="7.9" r=".95" fill="#11140f" />
    </svg>
  )
}

/* ---------------------------------------------------------------------------
   Uso

   import './tokens.css'
   import { SessionGroup } from './SessionGroup'

   <div className="bg-[var(--bg-app)] p-4">
     {groups.map(g => (
       <SessionGroup
         key={g.path}
         name={g.name}
         sessions={g.sessions.map(s => ({
           id: s.id,
           title: s.title,
           meta: `${s.provider} · ${s.authMethod}`,
           active: s.id === currentId,
         }))}
         focused={g.path === currentGroupPath}
         onAdd={() => newSession(g.path)}
         onSelect={openSession}
         onClose={closeSession}
       />
     ))}
   </div>

   Opzionale — nomi più corti al posto di var(--…):

   // tailwind.config.js
   theme: { extend: {
     colors: {
       app: 'var(--bg-app)', group: 'var(--surface-group)', cap: 'var(--surface-cap)',
       row: 'var(--surface-row)', hair: 'var(--border-subtle)', edge: 'var(--border-strong)',
       ink: { DEFAULT: 'var(--ink)', muted: 'var(--ink-muted)', faint: 'var(--ink-faint)' },
     },
     borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)' },
     boxShadow: { stack: 'var(--shadow-stack)' },
   }}

   …e allora `bg-[var(--surface-cap)]` diventa `bg-cap`,
   `rounded-b-[var(--radius-lg)]` diventa `rounded-b-lg`, e così via.
--------------------------------------------------------------------------- */
