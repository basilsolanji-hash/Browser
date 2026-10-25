import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSignInPage } from '../../src/main/signin.ts';

test('sign-in and code verification pages', () => {
  for (const u of [
    'https://appleid.apple.com/sign-in', 'https://idmsa.apple.com/appleauth/auth', 'https://accounts.google.com/v3/signin/challenge/pwd',
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', 'https://example.com/account/2fa', 'https://example.com/two-factor',
    'https://example.com/verify?code=1', 'https://example.com/mfa', 'https://example.com/Login',
  ]) assert.equal(isSignInPage(u), true, u);
});

test('ordinary pages are not sign-in pages', () => {
  for (const u of ['https://example.com/', 'https://news.example.com/article/1', 'os://start/', '', null, 'not a url', 'https://apple.com/iphone']) {
    assert.equal(isSignInPage(u), false, String(u));
  }
});
