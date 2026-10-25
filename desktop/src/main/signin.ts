/**
 * Страница входа или подтверждения кода (Gecko.isSignInPage): Apple ID, Google, Microsoft, OAuth, пути
 * с signin/login/2fa… Такие адреса не запоминаем как «последний адрес вкладки»: при перезапуске
 * страница подтверждения отправила бы новый SMS-код, и сайт может временно заблокировать вход.
 */
const HOSTS = new Set([
  'accounts.google.com', 'appleid.apple.com', 'idmsa.apple.com', 'login.microsoftonline.com', 'login.live.com',
  'oauth.yandex.ru', 'passport.yandex.ru', 'id.vk.com',
]);
const PATH = /signin|sign-in|login|2fa|two-factor|verify|challenge|mfa|oauth|authorize/;

export function isSignInPage(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return HOSTS.has(u.hostname) || PATH.test(u.pathname.toLowerCase()) || u.searchParams.get('display') === 'popup';
  } catch {
    return false;
  }
}
