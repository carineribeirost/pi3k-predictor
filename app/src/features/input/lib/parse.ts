export type Entry = { smiles: string; inputId: string | null };
export type Table = { header: string[]; rows: string[][] };

/** One SMILES per line; anything after the first whitespace is taken as the molecule's name. */
export function parseLines(text: string): Entry[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const m = /^(\S+)\s+(.+)$/.exec(l);
      return m ? { smiles: m[1], inputId: m[2].trim() } : { smiles: l, inputId: null };
    });
}

/** RFC 4180 CSV with quoted fields; the delimiter is a comma, semicolon or tab, chosen from the header line. */
export function parseCsv(text: string): Table {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].reduce(
    (best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best),
    ",",
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  const [header = [], ...body] = rows;
  return { header: header.map((h) => h.trim()), rows: body };
}

/** Best guesses for the SMILES and ID columns. */
export function guessColumns(header: string[]): { smiles: number; id: number | null } {
  const lower = header.map((h) => h.toLowerCase());
  const smiles = lower.findIndex((h) => h.includes("smiles"));
  const id = lower.findIndex((h, i) => i !== smiles && /(^|_|\s)(id|name|title|compound)($|_|\s)/.test(h));
  return { smiles: smiles === -1 ? 0 : smiles, id: id === -1 ? null : id };
}

export function tableEntries(table: Table, smilesCol: number, idCol: number | null): Entry[] {
  return table.rows
    .map((r) => ({
      smiles: (r[smilesCol] ?? "").trim(),
      inputId: idCol === null ? null : (r[idCol] ?? "").trim() || null,
    }))
    .filter((e) => e.smiles);
}

/** Splits an SD file into its molblocks; the first line of each block is its title. */
export function splitSdf(text: string): { molblock: string; title: string | null }[] {
  // Only the separator's own line break is consumed: a molblock's first (title) line may be blank.
  return text
    .split(/^\$\$\$\$[^\S\r\n]*(?:\r?\n|$)/m)
    .filter((b) => /M\s+END/.test(b))
    .map((b) => {
      const molblock = b.slice(0, b.search(/M\s+END/) + 6);
      const title = molblock.split(/\r?\n/, 1)[0].trim();
      return { molblock, title: title || null };
    });
}
