// Данные релизов (src/data/releases.json собирает scripts/fetch-releases.mjs).
import data from '../data/releases.json';
export type Asset = { name: string; size: number; url: string; sha256: string | null };
export type Release = { tag: string; build: number; version: string | null; date: string; page: string; engine: string | null; assets: Asset[]; changes: string[] };
type Platform = { latest: Release; releases: Release[] } | null;
export const android = data.android as Platform;
export const windows = data.windows as Platform;
export const repoReleases = `https://github.com/${data.repo}/releases`;
export const find = (r: Release | undefined, re: RegExp) => r?.assets.find((a) => re.test(a.name));
export const apk = find(android?.latest, /\.apk$/);
export const exe = find(windows?.latest, /Setup.*\.exe$/);
export const zip = find(windows?.latest, /\.zip$/);
