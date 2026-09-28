import type { BacklogHome } from './backlog-home.types.js';
import {
  presentGlobalHome,
  presentProjectHome,
} from './home-presentation.js';
import type { HomeProvenance } from './home-provenance.types.js';

/**
 * Project a `BacklogHome` into the provenance every adapter returns with a
 * result (ADR 0112 R-9: `home`, `home_id`, `source_path`), plus render-ready
 * presentation (ADR 0128). One projection shared by HTTP and CLI, so no
 * adapter rebuilds it. Pure (ADR 0090): the composition injects `homeDir`.
 */
export function projectHomeProvenance(
  home: BacklogHome,
  homeDir: string | undefined,
  sourcePath?: string,
): HomeProvenance {
  const presentation = home.kind === 'global'
    ? presentGlobalHome(home.root, homeDir)
    : presentProjectHome(home.root, homeDir);

  return {
    home: home.kind,
    home_id: home.id,
    root: home.root,
    documents_dir: home.documentsDir,
    label: presentation.label,
    display_path: presentation.display_path,
    ...(sourcePath === undefined ? {} : { source_path: sourcePath }),
  };
}
