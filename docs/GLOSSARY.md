# Словарь терминов «Ось Browser»

Одно понятие — один термин во всех строках и на всех платформах: Android, Windows, сайт, описания
и скриншоты магазинов. Новая строка на любом языке использует только термины из этой таблицы
(в нужной грамматической форме); синонимы запрещены — например, в русском «вкладка», а не «таб»,
«избранное», а не «закладки», «заметки», а не «записи»; в кыргызском «серепчи», а не «браузер».

Правила:
- Источник истины — строки `app/src/main/java/ru/multibrowser/Tr*.kt`; каждая строка таблицы
  привязана к каноническому ключу, и в значении этого ключа должен стоять термин из таблицы.
  Это проверяет юнит-тест `GlossaryTest` (каждое слово термина есть в значении ключа, без учёта регистра).
- Меняется термин — меняются сразу все строки, где он встречается, на всех платформах, и эта таблица.
- Новый язык — сначала строка словаря для него, потом перевод интерфейса по словарю.
- Неизменяемые: «Ось» / «Ось Browser», названия продуктов (Chrome, Windows, Android, GitHub, DuckDuckGo…),
  адреса и подстановки (%s, %d, %1$d…).

| Понятие | Ключ | en | ru | es | pt | fr | de | ar | hi | tr | zh | be | uz | ky | tg | kk | hy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Профиль / профили | `profiles` | Profiles | Профили | Perfiles | Perfis | Profils | Profile | الملفات | प्रोफ़ाइल | Profiller | 配置文件 | Профілі | Profillar | Профилдер | Профилҳо | Профильдер | Պրոֆիլներ |
| Вкладка / вкладки | `tabs` | Tabs | Вкладки | Pestañas | Abas | Onglets | Tabs | علامات التبويب | टैब | Sekmeler | 标签页 | Укладкі | Varaqlar | Өтмөктөр | Варақаҳо | Қойындылар | Ներդիրներ |
| Закреплённые вкладки | `pinned_tabs` | Pinned tabs | Закреплённые вкладки | Pestañas fijadas | Abas fixadas | Onglets épinglés | Angepinnte Tabs | علامات تبويب مثبتة | पिन किए टैब | Sabitlenen sekmeler | 固定标签 | Замацаваныя ўкладкі | Qadalgan varaqlar | Кадалган өтмөктөр | Варақаҳои васлшуда | Бекітілген қойындылар | Ամրացված ներդիրներ |
| Группа вкладок | `new_tab_group` | tab group | группа вкладок | grupo de pestañas | grupo de abas | groupe d'onglets | Tab-Gruppe | مجموعة علامات | टैब समूह | sekme grubu | 标签组 | група ўкладак | varaqlar guruhi | өтмөк тобу | гурӯҳи варақаҳо | қойындылар тобы | ներդիրների խումբ |
| Наборы вкладок | `tab_sets` | Saved tab sets | Наборы вкладок | Grupos de pestañas guardados | Conjuntos de abas salvos | Ensembles d'onglets | Gespeicherte Tab-Sets | مجموعات الألسنة المحفوظة | सहेजे गए टैब सेट | Kayıtlı sekme setleri | 已保存的标签组 | Наборы ўкладак | Varaqlar toʻplamlari | Өтмөк топтомдору | Маҷмӯаҳои варақаҳо | Қойындылар жинақтары | Ներդիրների հավաքածուներ |
| Избранное | `favorites` | Favorites | Избранное | Favoritos | Favoritos | Favoris | Favoriten | المفضلة | पसंदीदा | Sık kullanılanlar | 收藏 | Абранае | Saralanganlar | Тандалмалар | Баргузидаҳо | Таңдаулылар | Ընտրյալներ |
| Скачанные файлы | `dl_title` | Downloads | Скачанные файлы | Descargas | Downloads | Téléchargements | Downloads | التنزيلات | डाउनलोड | İndirilenler | 下载内容 | Спампаваныя файлы | Yuklanmalar | Жүктөлүп алынгандар | Файлҳои боргиришуда | Жүктеп алынған файлдар | Ներբեռնված ֆայլեր |
| Заметки | `notes` | Notes | Заметки | Notas | Notas | Notes | Notizen | الملاحظات | नोट्स | Notlar | 笔记 | Нататкі | Qaydlar | Эскертмелер | Қайдҳо | Жазбалар | Նշումներ |
| Сохранённые страницы | `saved_pages` | Saved pages | Сохранённые страницы | Páginas guardadas | Páginas salvas | Pages enregistrées | Gespeicherte Seiten | الصفحات المحفوظة | सहेजे गए पेज | Kaydedilen sayfalar | 已保存的网页 | Захаваныя старонкі | Saqlangan sahifalar | Сакталган барактар | Саҳифаҳои захирашуда | Сақталған беттер | Պահված էջեր |
| Пароли | `passwords` | Passwords | Пароли | Contraseñas | Senhas | Mots de passe | Passwörter | كلمات المرور | पासवर्ड | Parolalar | 密码 | Паролі | Parollar | Сырсөздөр | Паролҳо | Құпиясөздер | Գաղտնաբառեր |
| Личный кабинет | `cabinet` | Personal account | Личный кабинет | Cuenta personal | Conta pessoal | Espace personnel | Persönlicher Bereich | الحساب الشخصي | व्यक्तिगत खाता | Kişisel alan | 个人中心 | Асабісты кабінет | Shaxsiy kabinet | Жеке кабинет | Кабинети шахсӣ | Жеке кабинет | Անձնական գրասենյակ |
| Настройки | `settings` | Settings | Настройки | Ajustes | Configurações | Paramètres | Einstellungen | الإعدادات | सेटिंग्स | Ayarlar | 设置 | Налады | Sozlamalar | Жөндөөлөр | Танзимот | Баптаулар | Կարգավորումներ |
| История | `history` | History | История | Historial | Histórico | Historique | Verlauf | السجل | इतिहास | Geçmiş | 历史 | Гісторыя | Tarix | Таржымал | Таърих | Тарих | Պատմություն |
| Инкогнито | `incognito` | Incognito | Инкогнито | Incógnito | Anônima | Navigation privée | Inkognito | تصفح خفي | गुप्त | Gizli | 隐身 | Інкогніта | Inkognito | Инкогнито | Инкогнито | Инкогнито | Ինկոգնիտո |
| Разрешения сайта | `site_permissions` | Site permissions | Разрешения сайта | Permisos del sitio | Permissões do site | Autorisations du site | Website-Berechtigungen | أذونات الموقع | साइट अनुमतियाँ | Site izinleri | 网站权限 | Дазволы сайта | Sayt ruxsatlari | Сайттын уруксаттары | Иҷозатҳои сайт | Сайт рұқсаттары | Կայքի թույլտվություններ |
| Резервная копия | `backup` | Backup | Резервная копия | Copia de seguridad | Backup | Sauvegarde | Sicherung | نسخة احتياطية | बैकअप | Yedek | 备份 | Рэзервовая копія | Zaxira nusxa | Камдык көчүрмө | Нусхаи эҳтиётӣ | Сақтық көшірме | Պահուստային պատճեն |
| Папка | `folder` | Folder | Папка | Carpeta | Pasta | Dossier | Ordner | مجلد | फ़ोल्डर | Klasör | 文件夹 | Папка | Jild | Папка | Ҷузвдон | Қалта | Թղթապանակ |
| Вход (в аккаунт, в браузер) | `not_signed_in` | signed in | вход | iniciar sesión | conectado | connecté | angemeldet | تسجيل الدخول | साइन इन | giriş | 登录 | уваход | kirish | кирүү | воридшавӣ | кіру | մուտք |
| Выход из аккаунтов | `logout_clear` | sign out | выйти из аккаунтов | cerrar sesión | sair das contas | se déconnecter | abmelden | تسجيل الخروج | साइन आउट | hesaplardan çık | 退出账户 | выйсці з акаўнтаў | akkauntlardan chiqish | аккаунттардан чыгуу | баромадан аз аккаунтҳо | аккаунттардан шығу | դուրս գալ հաշիվներից |
| Стартовая страница | `start_page` | Start page | Стартовая страница | Página de inicio | Página inicial | Page de démarrage | Startseite | صفحة البداية | आरंभ पेज | Başlangıç sayfası | 起始页 | Стартавая старонка | Boshlangʻich sahifa | Баштапкы барак | Саҳифаи оғоз | Бастапқы бет | Մեկնարկային էջ |
| Адресная строка | `address_tabs` | address bar | адресная строка | barra de direcciones | barra de endereço | barre d'adresse | Adressleiste | شريط العنوان | पता बार | adres çubuğu | 地址栏 | адрасны радок | manzil qatori | дарек тилкеси | сатри суроға | мекенжай жолағы | հասցեի տող |
| Поисковая система | `search_engine` | Search engine | Поисковая система | Buscador | Buscador | Moteur de recherche | Suchmaschine | محرك البحث | सर्च इंजन | Arama motoru | 搜索引擎 | Пошукавая сістэма | Qidiruv tizimi | Издөө системасы | Низоми ҷустуҷӯ | Іздеу жүйесі | Որոնման համակարգ |
| Конфиденциальность | `privacy_security` | privacy | конфиденциальность | privacidad | privacidade | confidentialité | Datenschutz | الخصوصية | गोपनीयता | gizlilik | 隐私 | канфідэнцыяльнасць | maxfiylik | купуялык | махфият | құпиялылық | գաղտնիություն |
| Браузер | `default_browser` | browser | браузер | navegador | navegador | navigateur | browser | المتصفح | ब्राउज़र | tarayıcı | 浏览器 | браўзер | brauzer | серепчи | браузер | браузер | դիտարկիչ |
| Файлы cookie | `cd_cookies` | cookies | файлы cookie | cookies | cookies | cookies | cookies | ملفات تعريف الارتباط | कुकी | çerezler | cookie | файлы cookie | cookie fayllari | cookie файлдары | файлҳои cookie | cookie файлдары | cookie ֆայլեր |
## Запрещённые синонимы

Строки с этими словами тест `GlossaryTest` не пропустит (поиск без учёта регистра, по всем строкам языка).

| Язык | Нельзя | Вместо — термин |
|---|---|---|
| ru | закладк | избранное |
| en | bookmark | favorites |
| ky | браузер | серепчи |
| hy | բրաուզեր | դիտարկիչ |
| kk | бетбелгі | таңдаулылар |
| be | браўзэр | браўзер |
