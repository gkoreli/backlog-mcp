/** The sole native Bun YAML adapter; document framing and policy remain in core (ADR 0139). */
import type { YamlCodec } from '../../core/index.js';

/** YAML 1.2 parsing and stable readable serialization, without a secondary parser fallback. */
export const bunYamlCodec: YamlCodec = {
  parse: function parseYaml(source) { return Bun.YAML.parse(source); },
  stringify: function stringifyYaml(value) { return Bun.YAML.stringify(value, null, 2); },
};
