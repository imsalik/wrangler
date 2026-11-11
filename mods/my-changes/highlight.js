// Per-line syntax colors from regexes: no parser or language server, so a frame only tokenizes the rows on screen.
const KEYWORDS = new Set(("abstract and as async await break case catch class const continue def default defer del delete do elif else enum except export extends false final finally fn for from func function go if impl import in instanceof interface is lambda let loop match mod mut new nil none None not null or package pass pub raise return self Self static struct super switch this throw trait true True False try type typeof undefined use var void where while with yield").split(" "));
const HASH = new Set(["py", "sh", "bash", "zsh", "fish", "yaml", "yml", "toml", "rb", "r", "conf", "cfg", "tf", "nix", "dockerfile", "makefile", "mk", "pl", "ex", "exs", "gitignore", "env"]);
const DASH = new Set(["sql", "lua", "hs", "elm"]);
const PLAIN = new Set(["md", "markdown", "txt", "json", "lock", "csv", "svg", "html", "xml", "rst"]);
const TOKEN = /(\s+)|("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|`(?:\\.|[^`\\])*`?)|(\b\d[\w.]*)|([A-Za-z_$][\w$]*)|([^\s\w"'`$]+)/g;

export function language(path) {
  const name = path.split("/").pop().toLowerCase();
  if (name === "dockerfile" || name === "makefile" || name.startsWith(".env")) return name.startsWith(".env") ? "env" : name;
  return name.includes(".") ? name.split(".").pop() : "";
}

/** The line as [{text, kind}], kind one of keyword, string, number, comment, function, type, key, or "". */
export function tokens(text, lang) {
  if (lang === "md" || lang === "markdown") return /^\s*#/.test(text) ? [{ text, kind: "keyword" }] : [{ text, kind: "" }];
  const comment = HASH.has(lang) ? "#" : DASH.has(lang) ? "--" : PLAIN.has(lang) ? null : "//";
  if (comment === "//" && /^\s*(\/\*|\*)/.test(text)) return [{ text, kind: "comment" }];
  const out = [];
  let pad = "", m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    const [all, space, str, num, word, punct] = m;
    if (space) { pad += space; continue; }
    let kind = "";
    if (punct && comment && punct.startsWith(comment)) { out.push({ text: pad + text.slice(m.index), kind: "comment" }); pad = ""; break; }
    if (str) kind = /^\s*:/.test(text.slice(m.index + all.length)) && (lang === "json" || lang === "yaml" || lang === "yml") ? "key" : "string";
    else if (num) kind = "number";
    else if (word) {
      const after = text.slice(m.index + all.length);
      kind = KEYWORDS.has(word) ? "keyword" : /^\s*\(/.test(after) ? "function" : (lang === "yaml" || lang === "yml" || lang === "toml") && /^\s*[:=]/.test(after) && !out.length ? "key" : /^[A-Z][a-z]/.test(word) ? "type" : "";
    }
    out.push({ text: pad + all, kind }); pad = "";
  }
  return out.length ? out : [{ text: text || " ", kind: "" }];
}

/** Tokens cut into lines of `cols` characters, for wrapped rows. */
export function wrapTokens(toks, cols) {
  const lines = [[]];
  let used = 0;
  for (const tok of toks) {
    let rest = tok.text;
    while (rest.length) {
      if (used === cols) { lines.push([]); used = 0; }
      const piece = rest.slice(0, cols - used);
      lines.at(-1).push({ text: piece, kind: tok.kind });
      used += piece.length; rest = rest.slice(piece.length);
    }
  }
  return lines;
}
