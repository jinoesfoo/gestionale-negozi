# OPS-T03 — Lista di controllo: unità di archivio S3

Compito senza test automatici sul fornitore vero (CLAUDE.md §1): progetti, bucket e chiavi li crea l'utente nella console di Hetzner, e le prove sui bucket le fa dal suo terminale, perché le chiavi non passano mai da Claude. Questa lista resta ferma dopo la fase test; gli esiti si scrivono in `docs/verifiche/ops-t03-esito.md`.

Chi esegue: **C** = Claude; **U** = utente, nella console di Hetzner o dal suo terminale con il client S3; **U → C** = l'utente esegue e incolla a Claude l'uscita, che Claude confronta con l'esito atteso. Per le pagine della console bastano una schermata o una risposta per ogni domanda, mai un «ok» per più domande insieme. Chiavi e segreti non passano mai in chat né nelle schermate, nemmeno la sola Access key: se una pagina la mostra, la schermata la lascia fuori; un'uscita che conterrebbe una Access key (una policy nella forma per chiave) la stampa già coperta il comando del README. Il client prende le chiavi solo dall'ambiente della shell (`read -rs` ed `export`), mai da un file di configurazione (`AVVIO.md`, «Fuori da GitHub»). Il suo unico file di configurazione è quello del correttivo (regola del correttivo), che non contiene chiavi.

Valori: i nomi di progetti, bucket e chiavi, i luoghi, i comandi del client e il testo della policy stanno in `infra/README.md`, «Archivi S3 (OPS-T03)». Qui i cinque bucket si chiamano `<file-prod>`, `<backup-prod>`, `<file-test>`, `<backup-test>` e `<specchio>`; `<lettura>` è il progetto senza bucket con le chiavi di sola lettura; `specchio-lettura` e `specchio-scrittura` sono le chiavi dello specchio (`MIRROR_SRC_*` e `MIRROR_DST_*`).

Decisioni del piano: fornitore Hetzner; un progetto per unità, più il progetto `<lettura>`; versioning sui due bucket dei file (versioni precedenti per 30 giorni); i bucket dei backup senza versioning e senza ciclo di vita; lo specchio creato con Object Lock, conservazione predefinita COMPLIANCE di 45 giorni e ciclo di vita a 45 giorni; la policy di `<backup-prod>` dà alle chiavi di `<lettura>` solo `s3:ListBucket` e `s3:GetObject`; file e backup a Falkenstein (`fsn1`), specchio a Norimberga (`nbg1`), non più a Helsinki, dove dal 19/11/2026 non si creano bucket nuovi (piano rifatto il 20/11/2026; specifica 08, OPS-T03, «Luogo dello specchio»).

**Regola dei 15 minuti** (08, OPS-T03): dopo ogni modifica di versioning, Object Lock, conservazione, policy o ciclo di vita, compresa la creazione dello specchio con Object Lock, si aspettano 15 minuti prima di scrivere nel bucket o di provarlo. L'ora di ogni modifica si annota.

**Regola della policy**: dopo E7, ogni modifica della policy di `<backup-prod>` ha la sua ora annotata: il passaggio alla forma per chiave (F), l'aggiunta della chiave temporanea (J2), la sua rimozione (J6), una chiave `specchio-lettura` rifatta per la regola del terminale. Passati i 15 minuti si ripete E7, con le chiavi attese in quel momento, poi F1–F2 con `specchio-lettura`, prima delle prove che usano la policy. Il pulsante «Reset visibility/policy» della console non si usa: potrebbe sostituire la policy.

**Regola del terminale delle chiavi**: ogni terminale in cui si incolla una chiave (da D a J) è una finestra nuova dell'applicazione Terminale di Ubuntu. Non è il terminale integrato di VS Code, che conserva una sua cronologia dei comandi, e da questo terminale non si avvia mai Claude Code, che ne erediterebbe le chiavi. Il suo primo comando è quello del README che spegne la cronologia (A4). Le chiavi si incollano nel Terminale con il tasto destro → «Incolla» o con Ctrl+Maiusc+V: Ctrl+V lì non incolla. Una chiave comparsa sullo schermo, perché incollata fuori dalle richieste senza eco del README o dello script o scritta dentro un comando, conta come esposta: si cancella e si rifà nella console; si aggiornano il gestore di password, la copia sigillata e, se la nomina, la policy; quel terminale si chiude senza incollarne l'uscita a Claude, e le prove di quella chiave si ripetono.

**Regola degli appunti**: dopo l'ultima parte di chiave incollata, negli appunti resta quella parte. L'uscita da dare a Claude si copia dal Terminale con il tasto destro → «Copia» o con Ctrl+Maiusc+C: nel Terminale Ctrl+C non copia, ferma il comando, e negli appunti resta la chiave. Prima di inviare, nella casella di Claude si guarda che ci sia l'uscita attesa, dalla sua prima riga; se c'è altro, per esempio una sola stringa di lettere e cifre, lo si cancella senza inviare e si ricopia. Una parte di chiave inviata a Claude conta come esposta, come dice la regola del terminale.

**Regola della lettura** (`AVVIO.md`, «Fuori da GitHub»): ogni comando del README che gira con le chiavi l'utente lo legge prima di lanciarlo (D0, I1). Un comando aggiunto o cambiato dopo D0, per esempio la forma per chiave della policy o una correzione dopo un controllo fallito, lo rilegge prima di lanciarlo.

**Regola del correttivo** (08, OPS-T03, «Difetto del client S3», piano rifatto il 21/11/2026): il client 2.39.4 si ferma, invece di mostrare il codice, quando Hetzner risponde con un errore senza testo, come fa per `AccessDenied`. Ogni terminale delle chiavi e lo script di I2 scrivono il correttivo del README e lo controllano, prima di qualsiasi chiave. Lo confermano con la riga «correttivo del client: attivo (aws-cli/2.39.4 …)» (A4) oppure «Correttivo del client: caricato (aws/aws-cli#10161)» (I2); senza quella riga non si incolla nessuna chiave. Una riga `argument of type 'NoneType' is not a container or iterable` con codice di uscita 255, oppure «correttivo del client alterato», oppure la riga di conferma che manca (nello script: «ERRORE DI CONFIGURAZIONE: il correttivo del client non risulta caricato…», con la «risposta del client»), vuol dire che il correttivo non è attivo. Non è un esito, e questa regola viene prima di quello che F, H, I e J4 dicono di un errore del client. Ci si ferma e lo si dice a Claude, che decide così:
- se sono sbagliate le righe del correttivo (fra i segni «aws-cli-empty-message», uguali nel README e nello script) o il resto dello script, si scrive `TORNA AI TEST`;
- se è sbagliato il resto del blocco del passo 4, Claude lo corregge con la regola della lettura e rilancia A5;
- se il client non risponde `aws-cli/2.39.4`, lo si reinstalla con il passo 1 del README (A2).

Il passo si ripete in un terminale delle chiavi nuovo. In J4, dopo J3, la serie non vale più: J1–J4 si rifanno con una chiave temporanea nuova. Un codice `(None)` vuol dire che il fornitore non ha mandato il codice: non è un esito, e lo si dice a Claude.

## A. Prima di iniziare

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| A1 | U | Console di Hetzner, elenco dei progetti | La console si apre con l'account dell'utente; schermata |
| A2 | U → C | Installazione del client S3 con la procedura di `infra/README.md` (archivio ufficiale, firma verificata), poi `aws --version` | La verifica della firma risponde «Good signature» con l'impronta scritta nel README; `aws --version` stampa `aws-cli/2.` con la versione fissata nel README |
| A3 | C | Configurazione del client nella cartella di casa dell'utente: `~/.aws/credentials` e `~/.aws/config` | Nessuno dei due file esiste (controllo dell'esistenza, senza leggerne il contenuto) |
| A4 | U → C | In ogni terminale delle chiavi, appena aperto: il primo comando del README, che spegne la cronologia, dice in quale terminale si è e scrive e controlla il correttivo del client | Stampa «cronologia: spenta», il nome del terminale, che non è quello di VS Code, e (dal terminale 2, 21/11/2026) la riga «correttivo del client: attivo (aws-cli/2.39.4 …)», prima di ogni `load_key`; Claude annota una riga per ogni terminale aperto |
| A5 | C | Prova del correttivo del client con il client vero, chiavi finte e un endpoint locale finto: `bash tests/infra/aws-cli-empty-message/run.sh`. Prima del primo terminale delle chiavi con il correttivo, di nuovo dopo ogni modifica del blocco del passo 4 (prima del terminale che lo usa) e in chiusura, sul README finale | `Prove: 44, come attese: 44, diverse: 0`. Senza correttivo il client si ferma ancora (il difetto c'è); con il correttivo ogni rifiuto e ogni configurazione assente con il messaggio vuoto mostra il suo codice, con codice di uscita 254, per ogni operazione del README e dello script; le righe del correttivo sono uguali nel blocco del README e nello script; il blocco intero del README lo scrive, lo conferma e, se cambia, non manda il comando |

## B. Progetti e chiavi (console)

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| B1 | U | Elenco dei progetti | Esistono i sei progetti del README: i cinque delle unità e `<lettura>`; schermata |
| B2 | U | In ciascuno dei sei progetti, l'elenco delle chiavi S3 | Una sola chiave per progetto, con il nome del README; per ciascun progetto una risposta con il nome della chiave, o una schermata che lascia fuori la colonna della Access key |
| B3 | U → C | L'id di ciascun progetto, cioè il numero nell'indirizzo della sua pagina nella console (non è un segreto) | I sei id annotati in `infra/README.md`; quello di `<lettura>` è quello usato nella policy (E7) |
| B4 | U | Gestore di password | Per ciascuna delle sei chiavi una voce con il nome del progetto e della chiave, Access key e Secret key; l'utente riapre ogni voce e controlla che ci siano i due valori. Una risposta scritta per voce, senza schermata della voce. Una chiave il cui segreto non è stato salvato si cancella e si rifà: la console lo mostra una volta sola |

## C. Bucket (console)

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| C1 | U | In ciascuno dei cinque progetti delle unità, l'elenco dei bucket | Un solo bucket per progetto, con il nome e il luogo del README: `fsn1` per i due dei file e i due dei backup, `nbg1` per lo specchio; una schermata per progetto |
| C2 | U | Il progetto `<lettura>`, in tutti i luoghi che la console mostra | Nessun bucket; schermata |
| C3 | U | Visibilità di ciascuno dei cinque bucket | «Private»; una schermata per bucket |
| C4 | U | Object Lock, scelto alla creazione del bucket | Attivo solo su `<specchio>`; ora della creazione dello specchio annotata. Lo confermano E5 ed E6 |
| C5 | U | Protezione dalla cancellazione di ciascuno dei cinque bucket (opzione della console indicata nel README) | Attiva; una schermata per bucket |

## D. Configurazione dal terminale (comandi del README)

Ciascun comando con la chiave del progetto del bucket. Nessuna configurazione su `<backup-test>`; su `<backup-prod>` solo la policy.

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| D0 | U | Lettura, nel README, di tutti i comandi che girano con le chiavi (D–H, il blocco di variabili di I2, J), dopo B3 e prima di esportare la prima chiave | Fatta; risposta dell'utente |
| D1 | U | Versioning su `<file-prod>` e `<file-test>` | I comandi terminano senza errori; ore annotate |
| D2 | U | Ciclo di vita di `<file-prod>` e `<file-test>` | I comandi terminano senza errori; ore annotate |
| D3 | U | Conservazione predefinita dello specchio (COMPLIANCE, 45 giorni) | Il comando termina senza errori; ora annotata |
| D4 | U | Ciclo di vita dello specchio | Il comando termina senza errori; ora annotata |
| D5 | U | Policy di `<backup-prod>` (testo del README, con l'id di `<lettura>`) | Il comando termina senza errori; ora annotata |

## E. Riletture, dopo l'attesa

Prima di E sono passati almeno 15 minuti dall'ultima ora annotata in C4 e in D.

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| E1 | U → C | Versioning dei cinque bucket (`get-bucket-versioning`, senza `--query`) | `<file-prod>`, `<file-test>` e `<specchio>`: `"Status": "Enabled"`. `<backup-prod>` e `<backup-test>`: nessuno stato (uscita vuota), cioè mai versionati |
| E2 | U → C | Ciclo di vita di `<file-prod>` e `<file-test>` (`get-bucket-lifecycle-configuration`) | Le regole del README e nient'altro, ognuna con `"Status": "Enabled"` e valida per tutto il bucket (nessun filtro, o un prefisso vuoto): le versioni non correnti scadono dopo 30 giorni; i delete marker rimasti senza versioni vengono tolti; i caricamenti in più parti interrotti si cancellano dopo 7 giorni. Nessuna regola fa scadere le versioni correnti (nessun `Expiration` con `Days` o `Date`) |
| E3 | U → C | Ciclo di vita dello specchio | Come E2, con 45 giorni al posto di 30 |
| E4 | U → C | Ciclo di vita di `<backup-prod>` e `<backup-test>` | Errore `NoSuchLifecycleConfiguration`: nessuna regola |
| E5 | U → C | Object Lock dello specchio (`get-object-lock-configuration`), prima di qualsiasi scrittura nello specchio | `"ObjectLockEnabled": "Enabled"` e la regola predefinita `"Mode": "COMPLIANCE"`, `"Days": 45`. Claude annota l'esito nella specifica (08, [VERIFICA] di OPS-008) |
| E6 | U → C | Object Lock degli altri quattro bucket | Errore `ObjectLockConfigurationNotFoundError` per tutti e quattro |
| E7 | U → C | Policy di `<backup-prod>` (`get-bucket-policy`), con il comando del README, che non stampa mai una Access key: nella forma per chiave la mostra con il nome della chiave tra parentesi quadre, per esempio `[specchio-lettura]`. Prima di incollarla, l'utente guarda l'uscita: dopo `p<id>:` può esserci solo un nome tra parentesi quadre; se c'è altro non la incolla, lo dice a Claude a parole, ed E7 fallisce | Il testo del README: istruzioni solo `Allow`; come principale solo il progetto `<lettura>` (`arn:aws:iam:::user/p<id di <lettura>>`) oppure, nella forma per chiave, solo le chiavi di `<lettura>` attese in quel momento (regola della policy), mostrate con il loro nome; come azioni solo `s3:ListBucket` e `s3:GetObject`; come risorse solo il bucket e i suoi oggetti. Nessun `Deny`, `NotAction`, `NotPrincipal` né `Condition`. Una Access key visibile, o una chiave che il comando non riconosce, fa fallire E7: si corregge il comando del README, lo si rilegge e si ripete |
| E8 | U → C | Policy degli altri quattro bucket | Errore `NoSuchBucketPolicy` per tutti e quattro |

## F. Prima prova della policy

Subito dopo E, con la chiave `specchio-lettura`. Prima di F1, e a ogni ripetizione, il comando del README controlla quale chiave c'è nel terminale: l'elenco dei suoi bucket, chiesto in ogni luogo usato dai cinque bucket, è vuoto (il comando stampa solo i nomi). Dopo J1, quando in `<lettura>` ci sono due chiavi, il controllo confronta anche la chiave esportata con la voce di `specchio-lettura` nel gestore di password, incollata di nuovo senza eco, e stampa solo «uguale» o «diversa». L'uscita del controllo si incolla insieme a F1. Se l'elenco non è vuoto o il confronto dà «diversa», la chiave è sbagliata: si esporta quella giusta e si ripete. Un errore di chiave (`InvalidAccessKeyId`, `SignatureDoesNotMatch`) o di rete non è un esito: si ricopia la chiave dal gestore di password, o si aspetta qualche minuto, e si ripete. Solo F1 rifiutata con `AccessDenied`, oppure F2 riuscita, porta alla forma per chiave del README (con la regola della policy: E7 si ripete prima di F1–F2); se l'esito resta quello, ci si ferma e il fornitore del bucket dei backup di produzione si rivede con `TORNA AL PIANO` (ripiego su Scaleway, 08 OPS-T03). Ogni altro codice su F1 o su F2, per esempio `NoSuchBucket`, o un errore del client, vuol dire che la prova non è avvenuta: si corregge il comando nel README, lo si rilegge e si ripete; se un comando giusto dà ancora un altro codice, ci si ferma e si decide con `TORNA AI TEST` (08, OPS-T03). Se F2 è riuscita, il file di prova si cancella con la chiave di `<backup-prod>`.

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| F1 | U → C | Lista degli oggetti di `<backup-prod>` (`list-objects-v2`) | Riuscita |
| F2 | U → C | Scrittura di un file di prova in `<backup-prod>` | Rifiutata con `AccessDenied` |

## G. OPS-005: sovrascrittura e recupero di un file

Prima su `<file-prod>`, poi su `<file-test>`, ciascuno con la chiave del suo progetto.

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| G1 | U → C | Scrittura di `prova-ops-005.txt` con il testo «versione 1», poi di nuovo con il testo «versione 2» | Due risposte con due `VersionId` diversi |
| G2 | U → C | `list-object-versions --prefix prova-ops-005.txt` | Due versioni; quella con il `VersionId` della seconda scrittura ha `"IsLatest": true` |
| G3 | U → C | Lettura della prima versione (`get-object --version-id`) | Il file letto contiene «versione 1» |
| G4 | U → C | Recupero: `copy-object` della prima versione sopra il file, poi lettura senza `--version-id` | Il file letto contiene «versione 1»; `list-object-versions` mostra tre versioni |
| G5 | U → C | Pulizia: cancellazione delle tre versioni, ciascuna con il suo `--version-id` | `list-object-versions --prefix prova-ops-005.txt` non mostra più né versioni né delete marker |

## H. Specchio: le versioni bloccate

Dopo E5, con la chiave `specchio-scrittura`, tutto nello stesso terminale. I comandi del README per H2–H5 usano il `VersionId` letto in H1, mai scritto a mano, e lo stampano. Se H2 non mostra COMPLIANCE con la data attesa, ci si ferma prima di H3 e si ripete E5: se E5 è giusta, si decide con `TORNA AL PIANO`. H3 e H4 si decidono dall'effetto: H3 è riuscita solo se `list-object-versions` non mostra più il `VersionId` di H1, H4 solo se `get-object-retention` mostra poi una data precedente a quella di H2. In H3 e H4 conta come rifiuto solo `AccessDenied`: un altro codice (per esempio `InvalidArgument` per una data già passata, `MalformedXML`, `NoSuchKey`), un errore del client, o una risposta senza errore rimasta senza effetto vuol dire che la prova non è avvenuta. Si corregge il comando nel README e si ripete il passo; se un comando giusto dà ancora un altro codice, ci si ferma e si decide con `TORNA AI TEST`. Se H3 o H4 riescono davvero, il blocco non funziona: ci si ferma e si decide con `TORNA AL PIANO`.

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| H1 | U → C | Scrittura di `prova-blocco.txt` con `Content-MD5` | Riuscita; `VersionId` annotato |
| H2 | U → C | `get-object-retention` di quella versione | `"Mode": "COMPLIANCE"` e una `RetainUntilDate` 45 giorni dopo la scrittura (con uno scarto di un giorno al più) |
| H3 | U → C | Cancellazione definitiva di quella versione (`delete-object --version-id`) | Rifiutata con `AccessDenied`; la versione di H1 c'è ancora (`list-object-versions`, stesso `VersionId`) |
| H4 | U → C | `put-object-retention` di quella versione in modalità COMPLIANCE, con una data nel futuro ma precedente a quella di H2 (un giorno prima). La calcola il comando del README, che la scrive come `AAAA-MM-GG`, la mostra accanto a quella di H2 e la manda solo se è nel futuro e precedente: una data più lontana allungherebbe il blocco per sempre | Rifiutato con `AccessDenied`; `get-object-retention` dà ancora la data di H2 |
| H5 | U → C | Cancellazione senza `--version-id`, poi lettura con il `VersionId` di H1 | La cancellazione riesce e la versione corrente diventa un delete marker; la versione di H1 si legge ancora con il suo `VersionId` |
| H6 | U → C | Solo informativo, per OPS-T01b: scrittura senza `Content-MD5` e senza checksum (`AWS_REQUEST_CHECKSUM_CALCULATION=when_required`) | Esito annotato, uno dei tre: accettata, e `get-object-retention` della nuova versione dà COMPLIANCE con la scadenza calcolata come in H2; accettata ma senza conservazione, che per OPS-T01b vale come «richiesto»; rifiutata, con il codice. Decide come `rclone` carica nello specchio (08, OPS-008, «Per OPS-T01b») |

## I. Isolamento delle unità (OPS-007, OPS-008)

Se I2 non riesce, Claude guarda le righe «NO» e decide con la prima voce che si applica; le righe che seguono, sullo stesso bucket, una riga «il proprietario non riesce …» ne sono la conseguenza.

1. **Correttivo non attivo**: righe con «correttivo del client alterato: chiamata non fatta» o con `argument of type 'NoneType'`. Vale la regola del correttivo.
2. **Rete o fornitore**, che non è un esito: righe con «codice di uscita» senza un codice S3 (per esempio «Could not connect to the endpoint URL» o un timeout), o con `SlowDown`, `InternalError`, `ServiceUnavailable`, `RequestTimeout` o un numero 5xx. Si aspettano 15 minuti e si rilancia I2 in un terminale delle chiavi nuovo, al massimo due volte; se resta, ci si ferma e si decide con `TORNA AI TEST`.
3. **Chiave incollata male**: nella parte 1, «non riuscito: InvalidAccessKeyId» o «SignatureDoesNotMatch». Si ricopiano le parti dal gestore di password e si rilancia I2 in un terminale delle chiavi nuovo; se resta, quella chiave si cancella e si rifà (B4, K1 e, se la policy la nomina, la regola della policy). Con «RequestTimeTooSkewed» si rimette l'ora del computer e si rilancia.
4. **Policy della sola lettura**: «lista degli oggetti non riuscita», «lettura non riuscita» o «modifica della policy non provata» per «sola lettura dello specchio» su `<backup-prod>`. Si ripete E7 e si segue F: forma per chiave e, se resta, `TORNA AL PIANO`.
5. **Isolamento violato**: una riga «PERMESSA», «ma l'oggetto di prova è sparito» o «c'erano oggetti che una scrittura rifiutata non doveva lasciare», o un elenco di bucket diverso dall'atteso. Si cerca la causa nella console o nel README (progetto della chiave, policy, visibilità), si corregge con la regola della lettura e, per la policy, con la regola della policy, e si rilancia I2. Se resta con console e README giusti, ci si ferma e si decide con `TORNA AL PIANO`.
6. **Ogni altra riga**, con un codice S3 diverso da `AccessDenied` («risposta inattesa») o non prevista qui sopra: ci si ferma e si decide con `TORNA AI TEST` (08, OPS-T03).

Dopo un'interruzione, o se la pulizia non è riuscita, gli oggetti rimasti sotto `check-bucket-isolation/` si cancellano con il comando del README, con la chiave di ciascun bucket (nello specchio restano bloccati, nascosti da un delete marker), prima di rilanciare I2.

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| I0 | C | Prova a secco dello script con il client finto: `bash tests/infra/check-bucket-isolation/run.sh` | `Scenari: 52, come atteso: 52, diversi: 0` |
| I1 | U | Lettura di `infra/scripts/check-bucket-isolation.sh` per intero, compreso il correttivo del client, prima di lanciarlo, perché gira con tutte le chiavi | Fatta; risposta dell'utente |
| I2 | U → C | `bash infra/scripts/check-bucket-isolation.sh` in un terminale delle chiavi nuovo, senza chiavi esportate, dopo il blocco di variabili del README, incollando le parti delle sei chiavi quando le chiede | Prima delle domande compare «Correttivo del client: caricato (aws/aws-cli#10161)»; per ogni parte chiesta compare «ricevuta»; codice di uscita 0 e ultima riga `RIUSCITO: 148 controlli, nessuno fallito.`. L'utente incolla a Claude solo l'uscita dello script, dalla riga «check-bucket-isolation.sh: isolamento delle unità di archivio S3» all'ultima, dopo averla guardata e con la regola degli appunti: se contiene una riga che lo script non ha scritto, per esempio una chiave, non la incolla e la chiave conta come esposta |
| I3 | C | Lettura dell'uscita di I2 | Per ogni chiave c'è la riga del suo progetto: l'elenco dei bucket «contiene solo» il suo bucket; per `specchio-lettura` l'elenco «è vuoto» in ogni luogo usato dai cinque bucket (gli altri luoghi li guarda C2). La chiave di sola lettura su `<backup-prod>` ha lista e lettura riuscite, e scrittura, cancellazione e modifica della policy rifiutate. Le chiavi di produzione sullo specchio hanno lista, lettura, scrittura e cancellazione rifiutate (OPS-008). Le richieste senza chiave hanno lista, lettura, scrittura e cancellazione rifiutate su tutti e cinque i bucket |

## J. Prova generale della chiave temporanea (OPS-004)

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| J1 | U | Nuova chiave nel progetto `<lettura>`, con il nome del README, salvata nel gestore di password | Creata; ora annotata. Nell'elenco delle chiavi di `<lettura>` ci sono solo `specchio-lettura` e la nuova chiave (risposta, o schermata senza la colonna della Access key) |
| J2 | U → C | Nella forma per chiave, prima l'aggiornamento della policy che il README indica, con la regola della policy. Poi, con la nuova chiave esportata: il comando del README la confronta con quella della sua voce nel gestore di password, incollata di nuovo senza eco, e stampa solo «uguale» o «diversa»; quindi lista degli oggetti di `<backup-prod>` e scrittura di un file di prova | Il confronto dà «uguale» (con «diversa» si esporta la chiave giusta e si ripete). Lista riuscita e scrittura rifiutata con `AccessDenied`; il tempo dalla creazione alla prima lista riuscita è annotato. Un errore di chiave o di rete non è un esito: si ricopia la chiave e si riprova ogni 5 minuti, al massimo per 60 minuti da J1; se resta, la chiave si cancella e si rifà una volta (J1), e se resta ancora ci si ferma e si decide con `TORNA AL PIANO`. Scrittura riuscita, o lista rifiutata con `AccessDenied`: ci si ferma e si ricontrollano J1 e, nella forma per chiave, E7 e i 15 minuti; un errore trovato si corregge e la prova si ripete, entro i 60 minuti. Nella forma per progetto, una lista rifiutata con `AccessDenied` porta prima alla forma per chiave, come in F. Se resta con tutto in ordine, si decide con `TORNA AL PIANO`. Un altro codice: `TORNA AI TEST` (08, OPS-T03). Se la scrittura è riuscita, il file di prova si cancella con la chiave di `<backup-prod>` |
| J3 | U | Cancellazione della chiave nella console | Ora annotata |
| J4 | U → C | Nello stesso terminale di J2 e con lo stesso comando di lista che lì è riuscito: subito dopo J3, poi ogni 5 minuti, finché due prove di fila sono rifiutate, al massimo per 60 minuti | Due prove di fila rifiutate con `InvalidAccessKeyId` entro 60 minuti da J3; annotate l'ora dell'ultima prova riuscita e quella della prima delle due rifiutate (il tempo della revoca, K5). Un errore del client o di rete non conta: si controlla il comando e si ripete. Se la chiave cancellata è sempre rifiutata con un altro codice, lo si annota e si decide con `TORNA AI TEST`. Se dopo 60 minuti la lista riesce ancora, nella forma per chiave si fa subito J6, che toglie la chiave dalla policy; poi ci si ferma: la cancellazione nella console non basta come revoca per OPS-004, e si decide con `TORNA AL PIANO` |
| J5 | U | Voce della chiave temporanea nel gestore di password | Cancellata |
| J6 | U → C | Solo nella forma per chiave, dopo J4: la chiave temporanea si toglie dalla policy con il comando del README, con la regola della policy | E7 mostra di nuovo solo `[specchio-lettura]`, e F1–F2 con `specchio-lettura` danno lo stesso esito di prima. Nella forma per progetto: «non serve», annotato |

## K. Chiusura

| # | Chi | Controllo | Esito atteso |
|---|---|---|---|
| K1 | U | Le sei chiavi nel gestore di password e nella copia sigillata fuori linea (OPS-009) | Una risposta scritta per ciascuna delle sei voci, senza schermate; data dell'aggiornamento della copia sigillata annotata |
| K2 | C | `~/.aws/credentials` e `~/.aws/config` | Ancora assenti, come in A3 |
| K3 | U | Terminali delle chiavi | Tutti chiusi, e per ciascuno c'è la riga di A4; nessuna chiave è stata esposta, nel terminale o in chat, oppure ogni chiave esposta è stata rifatta come dice la regola del terminale |
| K4 | C | `infra/README.md`, «Archivi S3 (OPS-T03)» | Contiene fornitore, progetti con i loro id, bucket con luogo e impostazioni, nomi delle chiavi e dove vanno, testo della policy (nella forma per chiave con un segnaposto al posto della Access key), regole del ciclo di vita, versione del client, il correttivo del client (perché c'è, cosa fa e quando toglierlo), procedure e date; nessun segreto |
| K5 | C | `specs/08-operativita.md` | Annotati: la rilettura della conservazione (E5), l'esito dal vivo della policy (F, I2, J2), il tempo della revoca (J4), l'esito di H6 per OPS-T01b e la conferma dal vivo del correttivo (E4 ed E6 con il loro codice) |

## Test del compito (08 OPS-T03)

- **OPS-005** (versioning dei bucket dei file, versioni precedenti per 30 giorni, sovrascrittura e recupero; i bucket dei backup senza versioni né ciclo di vita): A5, E1, E2, E4, G1–G5.
- **OPS-007** (unità separate senza accesso reciproco; l'unica eccezione è la chiave di sola lettura, che lista e legge il bucket dei backup di produzione e lì non scrive né cancella): A5, B1–B2, C1–C3, E7–E8, F1–F2, I0–I3, J6.
- **OPS-008**, parte dell'archivio (specchio versionato e bloccato, ciclo di vita a 45 giorni, nessun accesso delle chiavi di produzione allo specchio): A5, C4, E1, E3, E5, H1–H5, I2–I3. La copia notturna e il delete marker dopo la sincronizzazione sono di OPS-T01b.
- **[VERIFICA] di OPS-T03** (chiave di sola lettura da un altro progetto con la policy del bucket): F1–F2, I2–I3, J2.
- **[VERIFICA] di OPS-008** (Object Lock in modalità COMPLIANCE, conservazione riletta prima di scrivere nello specchio): E5–E6, H2–H4; la prova della nota «Per OPS-T01b»: H6.
- **OPS-009**, parte delle chiavi: B4, K1.
- **OPS-004**, parte delle chiavi (credenziali temporanee di sola lettura create e revocate dall'utente; la scrittura fallisce): A5, J1–J6.
- Chiavi solo nell'ambiente della shell e nei terminali delle chiavi (`AVVIO.md`, «Fuori da GitHub»; regole del terminale, degli appunti e della lettura): A3, A4, D0, I1, I2, K2, K3.
- Correttivo del client (08 OPS-T03, «Difetto del client S3»; regola del correttivo): A4, A5, I0, I2, K4, K5.
