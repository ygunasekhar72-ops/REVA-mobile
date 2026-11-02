/* Unit test: the i18n Engine (js/i18n.js) — subsystem #10.
   Catalogs, fallback chains, interpolation, plural categories, locale
   formatting, best-locale negotiation. */
'use strict';
const assert = require('assert');
const I = require('../js/i18n.js');

(async () => {
  // 1. basic lookup + interpolation
  const i = I.createI18n({
    locale: 'en',
    catalogs: { en: { 'nav.title': 'My App', 'greet.user': 'Hello, {name}!' } }
  });
  assert.strictEqual(i.t('nav.title'), 'My App', 'plain lookup');
  assert.strictEqual(i.t('greet.user', { name: 'Ada' }), 'Hello, Ada!', 'interpolation');
  assert.strictEqual(i.t('greet.user', { name: '<b>x' }), 'Hello, &lt;b&gt;x!', 'sanitize escapes HTML');

  // 2. fallback chain + missing-key behavior
  const miss = [];
  const i2 = I.createI18n({
    locale: 'pt-BR', fallback: 'en',
    catalogs: { en: { 'a': 'EN text' }, pt: { 'b': 'PT text' } },
    onMissing: (k, l) => miss.push(l + ':' + k)
  });
  assert.strictEqual(i2.t('a'), 'EN text', 'pt-BR falls back to en');
  assert.strictEqual(i2.t('b'), 'PT text', 'pt-BR falls back to pt (prefix chain)');
  assert.strictEqual(i2.t('nope'), 'nope', 'total miss returns the key itself');
  assert.deepStrictEqual(miss, ['pt-BR:nope'], 'onMissing fired with locale+key');
  assert.deepStrictEqual(i2.missingKeys(), [{ locale: 'pt-BR', key: 'nope' }], 'missing ledger');

  // 3. mergeCatalog extends a locale at runtime
  i2.mergeCatalog('pt-BR', { c: 'BR text' });
  assert.strictEqual(i2.t('c'), 'BR text', 'merged key resolves in pt-BR');

  // 4. plural categories: english
  const en = I.createI18n({
    catalogs: { en: { items: { one: '{n} item', other: '{n} items' }, uninflected: 'always {n}' } }
  });
  assert.strictEqual(en.plural('items', 1), '1 item', 'en one');
  assert.strictEqual(en.plural('items', 3), '3 items', 'en other');
  assert.strictEqual(en.plural('items', 0), '0 items', 'en zero uses other');
  assert.strictEqual(en.plural('uninflected', 5), 'always 5', 'string entry used for every count');

  // 5. plural categories: russian one/few/many
  const ru = I.createI18n({
    locale: 'ru',
    catalogs: { ru: { files: { one: '{n} файл', few: '{n} файла', many: '{n} файлов', other: '{n} файла' } } }
  });
  assert.strictEqual(ru.plural('files', 1), '1 файл', 'ru 1 -> one');
  assert.strictEqual(ru.plural('files', 21), '21 файл', 'ru 21 -> one');
  assert.strictEqual(ru.plural('files', 3), '3 файла', 'ru 3 -> few');
  assert.strictEqual(ru.plural('files', 5), '5 файлов', 'ru 5 -> many');
  assert.strictEqual(ru.plural('files', 11), '11 файлов', 'ru 11 -> many (teens)');

  // 6. arabic six-form
  const ar = I.createI18n({
    locale: 'ar',
    catalogs: { ar: { msgs: { zero: 'لا رسائل', one: 'رسالة', two: 'رسالتان', few: '{n} رسائل', many: '{n} رسالة', other: '{n}+ رسالة' } } }
  });
  assert.strictEqual(ar.plural('msgs', 0), 'لا رسائل', 'ar zero');
  assert.strictEqual(ar.plural('msgs', 1), 'رسالة', 'ar one');
  assert.strictEqual(ar.plural('msgs', 2), 'رسالتان', 'ar two');
  assert.strictEqual(ar.plural('msgs', 7), '7 رسائل', 'ar few');
  assert.strictEqual(ar.plural('msgs', 15), '15 رسالة', 'ar many');
  assert.strictEqual(ar.plural('msgs', 100), '100+ رسالة', 'ar other');

  // 7. setLocale + onChange
  const flips = [];
  const i3 = I.createI18n({ catalogs: { en: { x: 'on' }, fr: { x: 'oui' } } });
  const off = i3.onChange(l => flips.push(l));
  i3.setLocale('fr');
  assert.strictEqual(i3.t('x'), 'oui', 'locale switched');
  i3.setLocale('fr'); // no-op
  off();
  i3.setLocale('en');
  assert.deepStrictEqual(flips, ['fr'], 'listener fired once, unsubscribe works');

  // 8. number formatting by locale group
  assert.strictEqual(I.createI18n({}).formatNumber('en', 1234.5), '1,234.5', 'en grouping');
  assert.strictEqual(I.createI18n({}).formatNumber('de', 1234.5, { decimals: 1 }), '1.234,5', 'de grouping');
  assert.strictEqual(I.createI18n({}).formatNumber('fr', 9876543.21), '9 876 543,21', 'fr thin-space grouping');
  assert.strictEqual(I.createI18n({}).formatNumber('en', -42), '-42', 'negative sign kept');

  // 9. currency + percent
  assert.strictEqual(I.createI18n({}).formatCurrency('en', 1234.5, 'USD'), '$1,234.50', 'USD before');
  assert.strictEqual(I.createI18n({}).formatCurrency('de', 1234.5, 'EUR'), '1.234,50 €', 'EUR after');
  assert.strictEqual(I.createI18n({}).formatCurrency('en', 500, 'JPY'), '¥500', 'JPY 0 decimals');
  assert.strictEqual(I.createI18n({}).formatCurrency('en', 1000, 'INR'), '₹1,000.00', 'INR before');
  assert.strictEqual(I.createI18n({}).formatPercent('en', 0.123, 1), '12.3 %', 'percent');

  // 10. bestLocale negotiation
  const avail = ['en', 'pt', 'pt-BR', 'zh-Hans'];
  assert.strictEqual(I.bestLocale(avail, ['pt-BR']), 'pt-BR', 'exact match');
  assert.strictEqual(I.bestLocale(avail, ['pt-PT']), 'pt', 'prefix folds to base availability');
  assert.strictEqual(I.bestLocale(avail, ['pt']), 'pt', 'base exact');
  assert.strictEqual(I.bestLocale(avail, ['zh-Hant']), 'zh-Hans', 'script miss folds to language match');
  assert.strictEqual(I.bestLocale(avail, ['ja', 'en-GB']), 'en', 'second preference wins when first absent');
  assert.strictEqual(I.bestLocale(avail, ['ja']), 'en', 'default fallback');

  console.log('i18n: 10/10 scenarios PASS (catalogs + fallback + plurals + formatting + negotiation)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
