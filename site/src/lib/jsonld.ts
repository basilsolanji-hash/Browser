// Структурированные данные SoftwareApplication; offers — только после решения владельца о цене.
import releases from '../data/releases.json';
import { t } from './i18n';
export const appJsonLd = (lang: string, url: string) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Ось Browser',
  applicationCategory: 'BrowserApplication',
  operatingSystem: 'Android, Windows',
  description: t(lang, 'home_desc'),
  inLanguage: lang,
  url,
  softwareVersion: releases.android?.latest.version,
});
