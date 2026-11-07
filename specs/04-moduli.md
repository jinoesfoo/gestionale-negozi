# 04 — Moduli attivabili

## Requisiti

**MOD-001** Il sistema DEVE avere un catalogo dei moduli definito nel codice (manifest) e sincronizzato nella tabella `modules` da `src/migrate.ts` a ogni esecuzione, con le credenziali del proprietario (`app_user` e `app_worker` hanno solo `SELECT` su `modules`).
- Accettazione: aggiungere un manifest e rieseguire `db:migrate` crea la riga in `modules`; rimuoverlo la marca `retired` senza cancellarla.

**MOD-002** Un modulo DEVE risultare attivo per un negozio se e solo se esiste in `shop_modules` una riga per quel modulo con `starts_at ≤ now()` e (`ends_at` nullo o `ends_at > now()`), e lo stato del negozio lo permette (MOD-006).
- Accettazione: tabella di casi su `isModuleActive(rows, shopStatus, now)` con tutte le combinazioni di origine, date e stato.

**MOD-003** Il sistema DEVE offrire un solo controllo `hasModule(ctx, code)` usato da menu, pagine, route handler e server action.
- Accettazione: le pagine, i route handler e le azioni server dei moduli (che stanno in `src/app/x-gestione/[slug]/<code>/` e importano da `src/modules/<code>/`) si definiscono solo con il wrapper `moduleRoute(code, handler)` / `moduleAction(code, action)`, che chiama al suo interno **prima** `requireShopAccess(slug)` senza `action` (NEG-007, ACC-003, stato `closed`, condizioni: basta una membership attiva), **poi** controlla che il ruolo del membro (`ShopCtx.role`) sia in `manifest.roles` del modulo, altrimenti risponde 403 e scrive `access_denied` in `audit_log` (come ACC-010: il campo `roles` decide l'accesso alle pagine e alle API del modulo, non solo il menu), e **infine** chiama `requireModule`; il test di architettura `tests/architecture/access-boundary.test.ts` (nato in ACC-T05; qui MOD-T03 aggiunge questo controllo) scansiona tutta `src/app/x-gestione/[slug]/` e fallisce se una pagina, una route o un'azione server non chiama `requireShopAccess` direttamente **né** uno dei wrapper `moduleRoute`/`moduleAction`, e se un file che importa da `src/modules/<code>/` esporta un handler o un'azione senza il wrapper. (Nota: lo stesso test scansiona anche `src/app/x-admin/` con `requireAdmin`, ma quella parte nasce con ADM-T01, area 07, e vale da ADM-T01 in poi: non fa parte di questo requisito.)

**MOD-004** QUANDO un utente apre una pagina di un modulo non attivo, il sistema DEVE mostrare in alto la descrizione del modulo e, al solo titolare, il pulsante per attivarlo; se il negozio ha dati di quel modulo (modulo attivo in passato), sotto mostra quei dati in sola lettura (MOD-005). Le API di scrittura del modulo DEVONO rispondere 403 con codice `MODULE_INACTIVE`.

**MOD-005** QUANDO un modulo viene disattivato, i suoi dati NON DEVONO essere cancellati: restano leggibili ed esportabili e le scritture DEVONO essere rifiutate con `MODULE_INACTIVE`.

**MOD-006** In stato `suspended` del negozio, l'unico modulo usabile in scrittura DEVE essere quello indicato in `platform.suspendedWritableModules` (valore iniziale: `['cassa']`); gli altri restano in sola lettura. In stato `closed` nessun modulo è attivo.

**MOD-007** L'amministratore DEVE poter dare un modulo in `trial` (durata predefinita 14 giorni, da `platform.moduleTrialDays`) o in `gift` (con o senza scadenza), una sola prova per modulo e negozio.
- Accettazione: una seconda prova dello stesso modulo per lo stesso negozio è rifiutata.

**MOD-008** QUANDO mancano 3 giorni alla fine di una prova, il sistema DEVE inviare un'email ai titolari una sola volta.

**MOD-009** Le righe di `shop_modules` con origine `plan` o `purchase` DEVONO essere scritte solo dalla sincronizzazione con Stripe (`billing_sync_modules`, area 05); quelle `trial` e `gift` solo dal pannello amministratore (`admin_grant_module`, `admin_revoke_module`). `app_user` e `app_worker` hanno solo `SELECT` su `shop_modules` (R-DATI-5; permessi nel Progetto).
- Accettazione: con il contesto del negozio, `INSERT INTO shop_modules` fallisce per mancanza di permesso sia come `app_user` sia come `app_worker`.

## Progetto

### Manifest (`src/modules/<code>/manifest.ts`)
```ts
export const manifest = {
  code: 'magazzino',            // [a-z_]+, stabile per sempre
  name: 'Magazzino AI',
  description: 'Carico della merce dalle fatture dei fornitori',
  menu: { label: 'Magazzino', href: 'magazzino', icon: 'boxes' },  // relativo a /n/<slug>/
  roles: ['owner', 'manager'],  // chi vede il modulo nel menu e ne usa pagine e API (MOD-003)
  sellable: true,
} as const satisfies ModuleManifest;
```
Fase 0: manifest vuoti per `cassa`, `sospesi`, `magazzino`, `whatsapp`, `report`, `sito`, `vetrina`, `fatture`, `operatori_extra`, `fiscale` (documento commerciale tramite fornitore certificato: modulo **facoltativo** che il negozio sceglie, con `sellable: false` in fase 0, vedi `10-rinviato.md` §6). Prezzi e collegamenti a Stripe sono in `src/config/plans.ts` (area 05), non nel manifest. Il modulo `fatture` (fatture di acquisto e di vendita del negozio) non avrà un elenco proprio: le sue righe, con la propria sorgente, si aggiungono all'elenco unico della pagina di piattaforma `/n/<slug>/fatture` (azione `invoices.view`, 03 ACC-010; 05 §Endpoint, progettata come elenco generico con la colonna sorgente), Per questo il manifest futuro di `fatture` **non** ha `menu` né `href` verso `fatture`: la voce di menu "Fatture" e la pagina `/n/<slug>/fatture` sono della piattaforma (`src/app/x-gestione/[slug]/fatture/page.tsx`), restano fuori da MOD-004 (non mostrano mai la pagina "modulo non attivo") e chiamano `requireShopAccess` direttamente, senza i wrapper. Le pagine e le azioni proprie del modulo, quando esisteranno, staranno in sottocartelle (`src/app/x-gestione/[slug]/fatture/<sezione>/`) con i wrapper di MOD-003.

Registro: `src/modules/registry.ts` importa tutti i manifest; la sincronizzazione scrive `modules (code PK, name, description, sellable, retired, created_at, updated_at)`.

### Tabella `shop_modules` (policy standard)
| Colonna | Tipo | Note |
|---|---|---|
| `id` | uuid | PK |
| `shop_id` | uuid | FK `shops` |
| `module_code` | text | FK `modules.code` |
| `source` | text | CHECK ∈ `plan`, `purchase`, `trial`, `gift` |
| `stripe_subscription_item_id` | text | NULL; valorizzato per `plan` e `purchase` |
| `starts_at` | timestamptz | NOT NULL |
| `ends_at` | timestamptz | NULL |
| `trial_reminder_sent_at` | timestamptz | NULL |
| `created_by` | text | id utente o `system:stripe`; **senza** chiave esterna verso `user` (conserva l'id storico come `audit_log.actor_user_id`, così `purge_shop` può cancellare l'utente; 02 §Funzioni di piattaforma) |
| `created_at` | timestamptz | |

Indice unico parziale: una sola riga `trial` per (`shop_id`, `module_code`) (MOD-007).

Permessi (R-DATI-4 e R-DATI-5, da riportare nell'elenco consentito di NEG-T05): `app_user` `SELECT`; `app_worker` `SELECT`; **nessuna scrittura** (`INSERT`, `UPDATE`, `DELETE`) per nessuno dei due ruoli: le righe si scrivono solo con le funzioni di piattaforma `billing_sync_modules` (W, origini `plan`/`purchase`), `admin_grant_module` e `admin_revoke_module` (U, origini `trial`/`gift`), e `trials_ending` (W) aggiorna da sola `trial_reminder_sent_at`. La migrazione esegue `REVOKE ALL ON shop_modules FROM app_user, app_worker` e poi `GRANT SELECT ON shop_modules TO app_user, app_worker`.

### Funzioni
- `isModuleActive(rows, shopStatus, now): { active: boolean; writable: boolean }` — pura.
- `hasModule(ctx, code)` — legge le righe in `withShop` (cache per richiesta).
- `requireModule(code, { write })` — controllo del modulo, lancia `ModuleInactiveError` (→ 403 `MODULE_INACTIVE`).
- `moduleRoute(code, handler)` / `moduleAction(code, action)` — wrapper per route handler e server action dei moduli: chiamano `requireShopAccess(slug)` senza `action` (area 03), poi controllano che il ruolo del membro sia in `manifest.roles` (altrimenti 403 e `access_denied`, MOD-003), poi `requireModule`, e passano `ShopCtx` all'handler; per il test di architettura valgono come la chiamata diretta a `requireShopAccess` (MOD-003).
- Lavoro giornaliero `modules.trialReminders` alle 9:00 Europe/Rome per MOD-008.

## Compiti

- [ ] **MOD-T01** Tipo `ModuleManifest`, registro, manifest vuoti (compreso `fiscale`), tabella `modules` e sincronizzazione; elenco consentito aggiornato (`modules`: `SELECT` ad `app_user` e `app_worker`). Test: MOD-001; NEG-012 aggiornato.
- [ ] **MOD-T02** Tabella `shop_modules` con policy, indice parziale e i permessi del Progetto (`REVOKE ALL` poi `SELECT` ad `app_user` e ad `app_worker`, nessuna scrittura per entrambi); aggiungila alle fixture di NEG-T05 (le fixture la scrivono con il ruolo proprietario) e all'elenco consentito con esattamente quei permessi; funzione `trials_ending` (con riserva atomica di `trial_reminder_sent_at`) e lavoro `modules.trialReminders` (gestore `work()` e pianificazione `schedule()` alle 9:00 `Europe/Rome` registrati insieme in questo compito, 05 §Lavori periodici). Test: MOD-007 (unicità), MOD-009 (compreso: `app_worker` non può inserire né aggiornare `shop_modules`, mentre `trials_ending` sì), MOD-008 (invio unico; `trials_ending` confronta `ends_at` con `now()` del database, quindi il test scrive con il client del proprietario una prova con `ends_at` fra meno di 3 giorni invece di spostare un orologio, 00 §5), NEG-012 aggiornato.
- [ ] **MOD-T03** `isModuleActive`, `hasModule`, `requireModule`; menu del gestionale filtrato per modulo e ruolo; pagina "modulo non attivo". Test: MOD-002, MOD-005, MOD-006 (tabella di casi), MOD-004 (e2e), MOD-003 (estensione del test di architettura `tests/architecture/access-boundary.test.ts` ai wrapper `moduleRoute`/`moduleAction`; con un modulo di prova il cui manifest non elenca `accountant` in `roles`, un contabile membro attivo riceve 403 sulla pagina e sulla route del modulo, con una riga `access_denied` nel registro del negozio, mentre il titolare, elencato, passa al controllo di `requireModule`).
