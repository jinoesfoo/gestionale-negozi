# Divide un comando di shell in parole e operatori, come li vede bash nei casi che servono al metodo.
# Uscita, una riga per elemento:
#   W<TAB><segni><TAB><parola>   segni: d = contiene $ o ` (valore deciso quando gira), g = * ? [ fuori dalle virgolette
#   O<TAB><operatore>            ; && || | & ( ) e le redirezioni > >> >| < << <<< >& <&
# Le virgolette si tolgono, come fa bash; un "a capo" vale come ";"; un "#" a inizio parola apre un commento.
function emit_word() {
  if (has) {
    gsub(/[\t\n]/, " ", w)                       # una parola per riga: tabulazioni e a capo diventano spazi
    printf "W\t%s%s\t%s\n", (dyn ? "d" : ""), (glob ? "g" : ""), w
    if (want_delim) { delim = w; want_delim = 0; heredoc = 1 }
  }
  w = ""; has = 0; dyn = 0; glob = 0
}
function skip_heredoc(    j, k, line) {    # salta il testo di un heredoc fino alla riga col delimitatore
  j = i + 1
  while (j <= n) {
    k = index(substr(s, j), "\n"); line = (k ? substr(s, j, k - 1) : substr(s, j))
    if (strip_tabs) sub(/^\t+/, "", line)
    if (line == delim) { i = (k ? j + k - 1 : n + 1); heredoc = 0; return }
    if (!k) break
    j += k
  }
  i = n + 1; heredoc = 0
}
function op(o) { emit_word(); printf "O\t%s\n", o }
function until_close(start,    depth, j, cc) {   # posizione della parentesi che chiude quella aperta in start
  depth = 0
  for (j = start; j <= n; j++) {
    cc = substr(s, j, 1)
    if (cc == "(") depth++
    else if (cc == ")") { depth--; if (depth == 0) return j }
  }
  return n
}
{ s = (NR > 1 ? s "\n" : "") $0 }
END {
  n = length(s); i = 1; w = ""; has = 0; dyn = 0; glob = 0
  while (i <= n) {
    c = substr(s, i, 1)
    if (c == "\\") {
      if (i < n && substr(s, i + 1, 1) != "\n") { w = w substr(s, i + 1, 1); has = 1 }
      i += 2; continue
    }
    if (c == "'") {
      j = index(substr(s, i + 1), "'"); has = 1
      if (j == 0) { w = w substr(s, i + 1); i = n + 1; continue }
      w = w substr(s, i + 1, j - 1); i += j + 1; continue
    }
    if (c == "\"") {
      i++; has = 1
      while (i <= n) {
        c = substr(s, i, 1)
        if (c == "\\" && i < n) {
          d = substr(s, i + 1, 1)
          if (d == "\\" || d == "\"" || d == "$" || d == "`") { w = w d; i += 2; continue }
          if (d == "\n") { i += 2; continue }
        }
        if (c == "\"") { i++; break }
        if (c == "$" || c == "`") dyn = 1
        w = w c; i++
      }
      continue
    }
    if (c == "$" && substr(s, i + 1, 1) == "(") {
      j = until_close(i + 1); w = w substr(s, i, j - i + 1); has = 1; dyn = 1; i = j + 1; continue
    }
    if (c == "`") {
      j = index(substr(s, i + 1), "`")
      w = w "`" (j ? substr(s, i + 1, j - 1) : substr(s, i + 1)) "`"; has = 1; dyn = 1
      i = (j ? i + j + 1 : n + 1); continue
    }
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
      emit_word(); j = until_close(i + 1); w = substr(s, i, j - i + 1); has = 1; dyn = 1; emit_word(); i = j + 1; continue
    }
    if (c == "<" || c == ">") {
      if (has && !dyn && w ~ /^[0-9]+$/) { w = ""; has = 0 }   # 2> e simili: il numero è un descrittore
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
    w = w c; has = 1; i++
  }
  emit_word()
}
