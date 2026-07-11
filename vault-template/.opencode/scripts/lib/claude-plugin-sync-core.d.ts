// Type declarations for the .mjs core used by the TypeScript reminder plugin.
// Kept in sync with the JSDoc/exports in claude-plugin-sync-core.mjs.

export type ArtifactKind = "skill" | "command";

export interface ArtifactSource {
  kind: ArtifactKind;
  pluginRef: string;
  name: string;
  sourcePath: string;
}

export interface ManifestEntry {
  pluginRef: string;
  kind: ArtifactKind;
  name: string;
  sourceHash: string;
  targetHash: string;
  copiedAt: string;
}

export interface Manifest {
  version: number;
  buckets?: Record<string, Record<string, ManifestEntry>>;
}

export type DriftStatus =
  | "synced"
  | "stale-source"
  | "diverged"
  | "orphan"
  | "missing"
  | "silent-user-edit"
  | "seeded";

export interface DriftItem {
  kind: ArtifactKind;
  pluginRef: string;
  name: string;
  status: DriftStatus;
  note?: string;
}

export interface DriftReportBucket {
  scope: "project" | "user";
  bucket: string;
  targetRoot: string;
  items: DriftItem[];
  warnings: string[];
}

export interface FullDriftReport {
  projectScope: DriftReportBucket;
  userScope: DriftReportBucket[];
  warnings: string[];
}

export interface DiscoverProjectScopeResult {
  sources: ArtifactSource[];
  warnings: string[];
  targetRoot: string;
}

export interface DiscoverUserScopeResult {
  skillsSources: ArtifactSource[];
  commandsSources: ArtifactSource[];
  targets: { skillsTarget: string; commandsTarget: string };
  warnings: string[];
}

export interface CopyResult {
  copied: boolean;
  reason?: string;
}

export function normalizePath(value: string): string;
export function defaultClaudePluginsRoot(): string;
export function defaultOpenCodeGlobalRoot(): string;
export function defaultProjectManifestPath(cwd: string): string;
export function defaultUserManifestPath(openCodeGlobalRoot: string): string;
export function projectSkillsTargetRoot(cwd: string): string;
export function userSkillsTargetRoot(openCodeGlobalRoot: string): string;
export function userCommandsTargetRoot(openCodeGlobalRoot: string): string;
export function userListCachePath(): string;

export function readProjectEnabledPlugins(
  cwd: string,
): Array<{ pluginRef: string; pluginName: string; marketplace: string }>;

export function resolveProjectPluginRoot(
  plugin: { pluginName: string; marketplace: string },
  claudePluginsRoot?: string,
): string;

export function discoverProjectScopeSources(
  cwd: string,
  claudePluginsRoot?: string,
): DiscoverProjectScopeResult;

export function parseUserScopePluginList(output: string): {
  plugins: Array<{
    pluginName: string;
    marketplace: string;
    version: string | null;
    scope: string | null;
    status: string | null;
  }>;
  warnings: string[];
};

export function readUserScopePluginListCached(): string | null;
export function fetchUserScopePluginListOutput(options?: {
  noThrow?: boolean;
}): Promise<string | null>;

export function discoverUserScopeSources(args: {
  claudePluginsRoot?: string;
  openCodeGlobalRoot?: string;
  listOutput?: string;
}): DiscoverUserScopeResult;

export function hashFile(filePath: string): string;
export function hashDirectory(dirPath: string): string;
export function hashArtifact(absPath: string): string;

export function loadManifest(manifestPath: string): Manifest | null;
export function writeManifest(manifestPath: string, manifest: Manifest): void;
export function emptyManifest(): Manifest;
export function manifestSet(args: {
  manifest: Manifest;
  scopeKey: string;
  source: ArtifactSource;
  sourceHash: string;
  targetHash: string;
  copiedAt: string;
}): void;
export function pruneManifestMissingTargets(
  manifest: Manifest,
  scopeKey: string,
  targetDirForKind: string,
): void;
export function dropOrphanEntries(
  manifest: Manifest,
  scopeKey: string,
  currentPluginRefs: string[],
): void;

export function computeBucketDrift(args: {
  sources: ArtifactSource[];
  targetDir: string;
  manifestBucket?: Record<string, ManifestEntry>;
}): DriftItem[];

export function detectProjectScopeDrift(args: {
  cwd: string;
  claudePluginsRoot?: string;
  manifestPath?: string;
}): DriftReportBucket;

export function detectUserScopeDrift(args: {
  claudePluginsRoot?: string;
  openCodeGlobalRoot?: string;
  manifestPath?: string;
  listOutput?: string;
}): [DriftReportBucket, DriftReportBucket, string[]];

export function detectFullDrift(args?: {
  cwd?: string;
  claudePluginsRoot?: string;
  openCodeGlobalRoot?: string;
  projectManifestPath?: string;
  userManifestPath?: string;
  userListOutput?: string;
}): Promise<FullDriftReport>;

export function hasActionableDrift(report: FullDriftReport): boolean;
export function buildReminderXml(report: FullDriftReport): string | null;

export function copySourceToTarget(
  source: ArtifactSource,
  targetDir: string,
  force: boolean,
): CopyResult;

export function logSection(label: string, items: string[]): void;
export function nowIso(): string;

export const MANIFEST_VERSION: number;
export const MANIFEST_FILENAME: string;
export const DEFAULT_USER_LIST_CACHE_TTL_MS: number;