// Ссылки, которые владелец задаёт сам (src/data/links.json): магазины, почта, свой домен.
// Пустое значение — на сайте плейсхолдер; правка файла в main пересобирает сайт.
import links from '../data/links.json';
type Links = { googlePlay: string | null; appStore: string | null; macDownload: string | null; microsoftStore: string | null; contactEmail: string | null; siteUrl: string | null };
export default links as Links;
