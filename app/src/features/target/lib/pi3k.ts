/** PDB 4JPS: p110α (chain A) with the p85α niSH2 fragment (chain B) and alpelisib (ligand 1LT). */
export const STRUCTURE_URL = "structures/4jps.bcif";
export const P110 = "A";
export const P85 = "B";
export const LIGAND = "1LT";

/** p110α domain boundaries from UniProt P42336. Colours follow the Okabe-Ito palette. */
export const DOMAINS = [
  { name: "Adaptor-binding (ABD)", start: 16, end: 105, color: 0xe69f00 },
  { name: "Ras-binding (RBD)", start: 187, end: 289, color: 0x56b4e9 },
  { name: "C2", start: 330, end: 487, color: 0x009e73 },
  { name: "Helical", start: 517, end: 694, color: 0xcc79a7 },
  { name: "Kinase", start: 765, end: 1051, color: 0x0072b2 },
] as const;

export const LINKER_COLOR = 0xc7ced8;
export const P85_COLOR = 0x8f99a8;
export const HOTSPOT_COLOR = 0xd55e00;

/** The most frequent PIK3CA cancer mutations. */
export const HOTSPOTS = [
  { residue: 542, label: "E542K", domain: "Helical" },
  { residue: 545, label: "E545K", domain: "Helical" },
  { residue: 1047, label: "H1047R", domain: "Kinase" },
] as const;

export const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
