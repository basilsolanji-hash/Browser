import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchQuery } from '../../src/main/query.ts';

test('query from search result addresses', () => {
  assert.equal(searchQuery('https://duckduckgo.com/?q=hello+world'), 'hello world');
  assert.equal(searchQuery('https://yandex.ru/search/?text=%D0%BF%D0%BE%D0%B3%D0%BE%D0%B4%D0%B0&lr=213'), 'погода');
  assert.equal(searchQuery('https://www.google.com/search?q=os+browser'), 'os browser');
  assert.equal(searchQuery('https://www.startpage.com/do/search?query=test'), 'test');
  assert.equal(searchQuery('https://search.brave.com/search?q=a'), 'a');
  assert.equal(searchQuery('https://www.bing.com/search?q=b'), 'b');
});

test('not a query', () => {
  assert.equal(searchQuery('https://www.google.com/maps?q=moscow'), null);
  assert.equal(searchQuery('https://duckduckgo.com/?q='), null);
  assert.equal(searchQuery('https://duckduckgo.com/?q=+'), null);
  assert.equal(searchQuery('https://example.com/?q=x'), null);
  assert.equal(searchQuery('os://start/'), null);
  assert.equal(searchQuery('not a url'), null);
});
