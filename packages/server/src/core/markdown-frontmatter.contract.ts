/** YAML capability owned by document framing; runtime implementations stay outside core (ADR 0139; ADR 0134 R1.2). */
export interface YamlCodec {
  parse(source: string): unknown;
  stringify(value: Readonly<Record<string, unknown>>): string;
}
