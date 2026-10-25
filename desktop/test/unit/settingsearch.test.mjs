import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSummary, searchSettings } from '../../src/shared/settingsearch.ts';

const items = [
  { id: 'lang', group: 'general', section: 'Основные', texts: ['Язык'] },
  { id: 'theme', group: 'general', section: 'Основные', texts: ['Тема'] },
  { id: 'home', group: 'general', section: 'Главная страница', texts: ['Ось', 'Пустая', 'Свой адрес'] },
  { id: 'https', group: 'privacy', section: 'Конфиденциальность', texts: ['Только HTTPS', 'Сайты открываются по защищённому соединению'] },
  { id: 'shots', group: 'privacy', section: 'Конфиденциальность', texts: ['Запретить скриншоты', 'Окно чёрное на снимках экрана'] },
  { id: 'cache', group: 'data', section: 'Данные', texts: ['Очистить кеш'] },
];

test('search by titles and descriptions in all groups', () => {
  assert.deepEqual(searchSettings(items, 'https').map((x) => x.id), ['https']);
  assert.deepEqual(searchSettings(items, 'СКРИНШОТ').map((x) => x.id), ['shots']);
  assert.deepEqual(searchSettings(items, 'черное снимках').map((x) => x.id), ['shots']);
  assert.deepEqual(searchSettings(items, 'основные').map((x) => x.id), ['lang', 'theme']);
  assert.deepEqual(searchSettings(items, 'qqqzzz'), []);
  assert.deepEqual(searchSettings(items, '   '), []);
});

test('group summary lists item titles without repeats', () => {
  assert.deepEqual(groupSummary(items, 'general'), ['Язык', 'Тема', 'Ось']);
  assert.deepEqual(groupSummary(items, 'general', 2), ['Язык', 'Тема']);
  assert.deepEqual(groupSummary([...items, { id: 'x', group: 'privacy', section: '', texts: ['только https'] }], 'privacy'), ['Только HTTPS', 'Запретить скриншоты']);
  assert.deepEqual(groupSummary(items, 'about'), []);
});
