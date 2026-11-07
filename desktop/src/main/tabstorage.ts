import type { OpenTab, TabsData } from './tabs';
import { isSignInPage } from './signin';
import { START } from './urls';

/** Снимок на диск не меняет живые вкладки: текущий код подтверждения продолжает работать. */
export function persistedTabs(data: TabsData): TabsData {
  const safe = (tab: OpenTab): OpenTab => isSignInPage(tab.url) ? { ...tab, url: START, title: '' } : { ...tab };
  return {
    ...data,
    profiles: Object.fromEntries(Object.entries(data.profiles).map(([id, profile]) => [id, {
      ...profile,
      tabs: profile.tabs.map(safe),
      closed: (profile.closed ?? []).map(safe),
      pinState: Object.fromEntries(Object.entries(profile.pinState ?? {}).filter(([, pin]) => !isSignInPage(pin.url))),
    }])),
  };
}
