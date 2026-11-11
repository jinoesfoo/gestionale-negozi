# Divide un comando di shell in parole e operatori, come li vede bash nei casi che servono al metodo.
# Uscita, una riga per elemento:
#   W<TAB><segni><TAB><parola>   segni: d = contiene $ o ` (valore deciso quando gira, o un carattere di $'…' che non si
#                                scrive), g = * ? [ fuori dalle virgolette,
#                                q = c'erano virgolette o barre rovesciate, b = graffe che bash espande ({a,b} o {1..3})
#   O<TAB><operatore>            ; && || | & ( ) e le redirezioni > >> >| < << <<< >& <&
#   S<TAB><testo>                il testo di una sostituzione $(…), `…`, <(…) o >(…), da controllare come un comando
#                                (anche quelle nel testo di un heredoc senza apici, che la shell esegue)
#   H<TAB><testo>                il testo di un heredoc (arriva dopo il comando che lo riceve)
# Nei testi di S e H gli "a capo" diventano il carattere \001. Le virgolette si tolgono, come fa bash; $'…' si
# decodifica ($'\x6d' è m), $"…" vale come "…"; un "a capo" vale come ";"; un "#" a inizio parola apre un commento.
function emit_word() {
  if (has) {
    gsub(/[\t\n]/, " ", w)                       # una parola per riga: tabulazioni e a capo diventano spazi
    if (raw ~ /\{[^}]*(,|\.\.)[^}]*\}/) brace = 1
    printf "W\t%s%s%s%s\t%s\n", (dyn ? "d" : ""), (glob ? "g" : ""), (quoted ? "q" : ""), (brace ? "b" : ""), w
    if (want_delim) { delim = w; want_delim = 0; heredoc = 1; delim_q = quoted }
  }
  w = ""; raw = ""; has = 0; dyn = 0; glob = 0; quoted = 0; brace = 0
}
function emit_text(kind, t) { gsub(/\n/, "\001", t); gsub(/\t/, " ", t); printf "%s\t%s\n", kind, t }
function skip_heredoc(    j, k, line, body, j0) {    # salta il testo di un heredoc fino alla riga col delimitatore
  j = i + 1; j0 = j; body = ""
  while (j <= n) {
    k = index(substr(s, j), "\n"); line = (k ? substr(s, j, k - 1) : substr(s, j))
    if (strip_tabs) sub(/^\t+/, "", line)
    if (line == delim) { i = (k ? j + k - 1 : n + 1); heredoc = 0; if (!delim_q) subst_heredoc(j0, j - 1); emit_text("H", body); return }
    body = body line "\n"
    if (!k) break
    j += k
  }
  i = n + 1; heredoc = 0; if (!delim_q) subst_heredoc(j0, n); emit_text("H", body)
}
function subst_heredoc(a, b,    j, c, k) {   # senza apici nel delimitatore la shell esegue le $(…) e i `…` del testo: escono come S
  for (j = a; j <= b; j++) {
    c = substr(s, j, 1)
    if (c == "\\") { j++; continue }
    if (c == "$" && substr(s, j + 1, 1) == "(") { k = scan_close(j + 1); emit_text("S", substr(s, j + 2, k - j - 2)); j = k; continue }
    if (c == "`") { k = index(substr(s, j + 1), "`"); if (!k) k = b - j + 1; emit_text("S", substr(s, j + 1, k - 1)); j += k; continue }
  }
}
function hexval(t,    k, v) { v = 0; for (k = 1; k <= length(t); k++) v = v * 16 + index("0123456789abcdef", tolower(substr(t, k, 1))) - 1; return v }
function carattere(v) { if (v >= 32 && v < 127) w = w sprintf("%c", v); else dyn = 1 }   # un carattere che non si scrive: la parola cambia
function ansi_c(j,    d, m, t, v, k) {   # j = posizione della barra rovesciata dentro $'…': aggiunge a w il carattere, torna la posizione dopo
  d = substr(s, j + 1, 1)
  if (d == "n" || d == "t" || d == "r" || d == "v" || d == "f") { w = w " "; return j + 2 }
  if (d == "a" || d == "b" || d == "e" || d == "E") { dyn = 1; return j + 2 }
  if (d == "x" || d == "u" || d == "U") {
    t = ""; m = j + 2
    while (length(t) < (d == "x" ? 2 : (d == "u" ? 4 : 8)) && substr(s, m, 1) ~ /[0-9A-Fa-f]/) { t = t substr(s, m, 1); m++ }
    if (t == "") { w = w "\\" d; return j + 2 }
    carattere(hexval(t)); return m
  }
  if (d ~ /[0-7]/) {
    t = ""; m = j + 1
    while (length(t) < 3 && substr(s, m, 1) ~ /[0-7]/) { t = t substr(s, m, 1); m++ }
    v = 0; for (k = 1; k <= length(t); k++) v = v * 8 + substr(t, k, 1)
    carattere(v); return m
  }
  if (d == "c") { dyn = 1; return j + 3 }
  if (d == "\\" || d == "'" || d == "\"" || d == "?") { w = w d; return j + 2 }
  w = w "\\" d; return j + 2
}
function op(o) { emit_word(); printf "O\t%s\n", o }
# Posizione della ")" che chiude la "(" in start, come la cerca bash: salta virgolette, barre rovesciate,
# sostituzioni annidate e il testo degli heredoc (dove un apostrofo, "l'utente", non apre niente).
function scan_close(start,    depth, j, cc, k, dl, pend) {
  depth = 0; pend = ""
  for (j = start; j <= n; j++) {
    cc = substr(s, j, 1)
    if (cc == "\\") { j++; continue }
    if (cc == "'") { k = index(substr(s, j + 1), "'"); if (!k) return n; j += k; continue }
    if (cc == "\"") { j = scan_dq(j + 1); continue }
    if (cc == "`") { k = index(substr(s, j + 1), "`"); if (!k) return n; j += k; continue }
    if (cc == "$" && substr(s, j + 1, 1) == "(") { j = scan_close(j + 1); continue }
    if (cc == "<" && substr(s, j + 1, 1) == "<" && substr(s, j + 2, 1) != "<") {
      j += 2; if (substr(s, j, 1) == "-") j++
      while (substr(s, j, 1) == " " || substr(s, j, 1) == "\t") j++
      dl = ""
      while (j <= n) {
        cc = substr(s, j, 1)
        if (cc ~ /[ \t\n;|&()<>]/) break
        if (cc != "'" && cc != "\"" && cc != "\\") dl = dl cc
        j++
      }
      pend = (pend == "" ? dl : pend "\002" dl); j--; continue
    }
    if (cc == "\n" && pend != "") { j = skip_bodies(j, pend); pend = ""; continue }
    if (cc == "(") depth++
    else if (cc == ")") { depth--; if (depth == 0) return j }
  }
  return n
}
function scan_dq(j,    cc, k) {   # da dentro "…": posizione della " che chiude
  for (; j <= n; j++) {
    cc = substr(s, j, 1)
    if (cc == "\\") { j++; continue }
    if (cc == "\"") return j
    if (cc == "$" && substr(s, j + 1, 1) == "(") { j = scan_close(j + 1); continue }
    if (cc == "`") { k = index(substr(s, j + 1), "`"); if (!k) return n; j += k; continue }
  }
  return n
}
function skip_bodies(j, pend,    m, arr, t, k, line, p) {   # j è un "a capo": salta i testi degli heredoc in sospeso
  m = split(pend, arr, "\002"); p = j + 1
  for (t = 1; t <= m; t++) {
    while (p <= n) {
      k = index(substr(s, p), "\n"); line = (k ? substr(s, p, k - 1) : substr(s, p))
      sub(/^\t+/, "", line); p = (k ? p + k : n + 1)
      if (line == arr[t]) break
    }
  }
  return p - 1
}
function substitution(open,    j) {   # open = posizione della "(": aggiunge la sostituzione alla parola e ne manda il testo
  j = scan_close(open)
  emit_text("S", substr(s, open + 1, j - open - 1))
  return j
}
function backtick(start,    j) {      # start = posizione del primo `
  j = index(substr(s, start + 1), "`")
  emit_text("S", (j ? substr(s, start + 1, j - 1) : substr(s, start + 1)))
  return (j ? start + j : n)
}
{ s = (NR > 1 ? s "\n" : "") $0 }
END {
  n = length(s); i = 1; w = ""; raw = ""; has = 0; dyn = 0; glob = 0; quoted = 0; brace = 0
  while (i <= n) {
    c = substr(s, i, 1)
    if (c == "\\") {
      if (i < n && substr(s, i + 1, 1) != "\n") { w = w substr(s, i + 1, 1); has = 1; quoted = 1 }
      i += 2; continue
    }
    if (c == "'") {
      j = index(substr(s, i + 1), "'"); has = 1; quoted = 1
      if (j == 0) { w = w substr(s, i + 1); i = n + 1; continue }
      w = w substr(s, i + 1, j - 1); i += j + 1; continue
    }
    if (c == "\"") {
      i++; has = 1; quoted = 1
      while (i <= n) {
        c = substr(s, i, 1)
        if (c == "\\" && i < n) {
          d = substr(s, i + 1, 1)
          if (d == "\\" || d == "\"" || d == "$" || d == "`") { w = w d; i += 2; continue }
          if (d == "\n") { i += 2; continue }
        }
        if (c == "\"") { i++; break }
        if (c == "$" && substr(s, i + 1, 1) == "(") { j = substitution(i + 1); w = w substr(s, i, j - i + 1); dyn = 1; i = j + 1; continue }
        if (c == "`") { j = backtick(i); w = w substr(s, i, j - i + 1); dyn = 1; i = j + 1; continue }
        if (c == "$") dyn = 1
        w = w c; i++
      }
      continue
    }
    if (c == "$" && substr(s, i + 1, 1) == "'") {   # $'…': le sequenze con la barra rovesciata si decodificano come fa bash
      i += 2; has = 1; quoted = 1
      while (i <= n) {
        c = substr(s, i, 1)
        if (c == "'") { i++; break }
        if (c == "\\" && i < n) { i = ansi_c(i); continue }
        w = w c; i++
      }
      continue
    }
    if (c == "$" && substr(s, i + 1, 1) == "\"") { i++; continue }   # $"…" si legge come "…"
    if (c == "$" && substr(s, i + 1, 1) == "(") {
      j = substitution(i + 1); w = w substr(s, i, j - i + 1); has = 1; dyn = 1; i = j + 1; continue
    }
    if (c == "`") { j = backtick(i); w = w substr(s, i, j - i + 1); has = 1; dyn = 1; i = j + 1; continue }
    if (c == "$") { dyn = 1; w = w c; has = 1; i++; continue }
    if (c == "#" && !has) { while (i <= n && substr(s, i, 1) != "\n") i++; continue }
    if (c == " " || c == "\t") { emit_word(); i++; continue }
    if (c == "\n") { op(";"); if (heredoc) skip_heredoc(); i++; continue }
    if (c == ";") { op(";"); i++; continue }
    if (c == "&") {
      if (substr(s, i + 1, 1) == "&") { op("&&"); i += 2; continue }
      if (substr(s, i + 1, 1) == ">") { emit_word(); i += 2; if (substr(s, i, 1) == ">") i++; printf "O\t>\n"; continue }
      op("&"); i++; continue
    }
    if (c == "|") { if (substr(s, i + 1, 1) == "|") { op("||"); i += 2 } else { op("|"); i++ }; continue }
    if ((c == "<" || c == ">") && substr(s, i + 1, 1) == "(") {   # sostituzione di processo: una parola dinamica
      emit_word(); j = substitution(i + 1); w = substr(s, i, j - i + 1); has = 1; dyn = 1; emit_word(); i = j + 1; continue
    }
    if (c == "<" || c == ">") {
      if (has && !dyn && !quoted && w ~ /^[0-9]+$/) { w = ""; raw = ""; has = 0 }   # 2> e simili: il numero è un descrittore
      emit_word(); o = c; i++
      if (c == ">" && (substr(s, i, 1) == ">" || substr(s, i, 1) == "|")) { o = o substr(s, i, 1); i++ }
      if (c == "<" && substr(s, i, 1) == "<") {
        o = "<<"; i++
        if (substr(s, i, 1) == "<") { o = "<<<"; i++ }
        else { want_delim = 1; strip_tabs = 0; if (substr(s, i, 1) == "-") { strip_tabs = 1; i++ } }
      }
      if (substr(s, i, 1) == "&") { o = o "&"; i++ }
      printf "O\t%s\n", o; continue
    }
    if (c == "(" || c == ")") { op(c); i++; continue }
    if (c == "*" || c == "?" || c == "[") glob = 1
    w = w c; raw = raw c; has = 1; i++
  }
  emit_word()
  if (heredoc) { i = n; skip_heredoc() }
}
