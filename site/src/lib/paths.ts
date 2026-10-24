import { LANGS } from './i18n';
export const langPaths = () => LANGS.map((lang) => ({ params: { lang } }));
