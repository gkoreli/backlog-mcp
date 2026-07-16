/** Stable home identity returned by docs-native viewer APIs. */
export interface HomeProvenance {
  home: 'global' | 'project';
  home_id: string;
  source_path?: string;
}
